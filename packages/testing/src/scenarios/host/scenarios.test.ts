import {
  ChatRefSchema,
  ComposerStateSchema,
  CoverageEventSchema,
  FreshnessCheckpointSchema,
  HostAccountSchema,
  HostContractReportSchema,
  HostIdentitySchema,
  HostThemeSchema,
  HumanSendFactSchema,
  SendFuseFactSchema,
  IncomingFactSchema,
  InsertReceiptSchema,
  MountPointsSchema,
  NavigationReceiptSchema,
  PREVIEW_SEND_CONDITION_CODES,
  PreviewSendCommitSchema,
  PreviewSendPreflightSchema,
  RouteStateSchema,
  SEND_ATTEMPT_STATES,
  SEND_ATTEMPT_TRANSITIONS,
  SendAttemptViewSchema,
  previewSendStateOf,
  type HostEvent,
  type HostSnapshot,
  type PreviewSendCommit,
  type SendAttemptState,
  type SendAttemptView,
} from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { FakeHostPort, HostContractViolation, type HostStep } from './fake-host-port';
import { HOST_SCENARIOS, HOST_TOPICS, type HostCall, type HostScenario } from './scenarios';
import { ACTION_TOKEN, DOCUMENT, HOST_T0, hostCause, hostUuid, openChat, previewChat, previewCheckpoint } from './world';

const T = SEND_ATTEMPT_TRANSITIONS as Record<SendAttemptState, readonly SendAttemptState[]>;

function eventValid(event: HostEvent): boolean {
  switch (event.type) {
    case 'route':
      return RouteStateSchema.safeParse(event.route).success;
    case 'composer':
      return event.composer === null || ComposerStateSchema.safeParse(event.composer).success;
    case 'accounts':
      return event.accounts.every((account) => HostAccountSchema.safeParse(account).success);
    case 'chatCache':
      return ChatRefSchema.safeParse(event.chat).success;
    case 'incoming':
      return IncomingFactSchema.safeParse(event.fact).success;
    case 'coverage':
      return CoverageEventSchema.safeParse(event.coverage).success;
    case 'humanSend':
      return HumanSendFactSchema.safeParse(event.fact).success;
    case 'sendFuse':
      return SendFuseFactSchema.safeParse(event.fuse).success;
    case 'reloadNeeded':
      return true;
  }
}

function snapshotValid(snapshot: HostSnapshot): boolean {
  return (
    (snapshot.identity === null || HostIdentitySchema.safeParse(snapshot.identity).success) &&
    RouteStateSchema.safeParse(snapshot.route).success &&
    (snapshot.composer === null || ComposerStateSchema.safeParse(snapshot.composer).success) &&
    snapshot.accounts.every((account) => HostAccountSchema.safeParse(account).success) &&
    HostContractReportSchema.safeParse(snapshot.contract).success &&
    MountPointsSchema.safeParse(snapshot.mounts).success &&
    HostThemeSchema.safeParse(snapshot.theme).success
  );
}

function stepValid(step: HostStep): boolean {
  switch (step.kind) {
    case 'event':
      return eventValid(step.event);
    case 'send-state':
      return SendAttemptViewSchema.safeParse(step.view).success;
    case 'contract':
      return HostContractReportSchema.safeParse(step.report).success;
    case 'mounts':
      return MountPointsSchema.safeParse(step.mounts).success;
    case 'theme':
      return HostThemeSchema.safeParse(step.theme).success;
  }
}

/** Runs the scenario's calls against a fresh fake and returns each answer. */
async function play(s: HostScenario): Promise<{ host: FakeHostPort; answers: unknown[] }> {
  const host = new FakeHostPort(s.script, HOST_T0);
  const answers: unknown[] = [];
  for (const call of s.calls) answers.push(await callOn(host, call));
  return { host, answers };
}

function callOn(host: FakeHostPort, call: HostCall): Promise<unknown> {
  switch (call.call) {
    case 'insert':
      return host.insert(call.intent);
    case 'navigate':
      return host.navigate(call.intent);
    case 'checkpoint':
      return host.checkpoint(call.chat);
    case 'preflight':
      if (host.previewSend === null) throw new Error('no PreviewSendPort');
      return host.previewSend.preflight(call.request);
    case 'commit':
      if (host.previewSend === null) throw new Error('no PreviewSendPort');
      return host.previewSend.commit(call.request, call.ticket);
  }
}

const viewOfCommit = (attemptId: string, commit: PreviewSendCommit): SendAttemptView =>
  commit.state === 'nativeEnqueued' ? { attemptId, state: commit.state } : { attemptId, state: commit.state, code: commit.code };

describe('HostPort scenarios: the data keeps the contracts', () => {
  it('cover every topic, have unique names and a time-ordered timeline', () => {
    const covered = new Set(HOST_SCENARIOS.flatMap((s) => s.covers));
    expect(HOST_TOPICS.filter((topic) => !covered.has(topic))).toEqual([]);
    expect(new Set(HOST_SCENARIOS.map((s) => s.name)).size).toBe(HOST_SCENARIOS.length);
    for (const s of HOST_SCENARIOS) {
      const times = s.script.timeline.map((step) => step.at);
      expect([...times].sort((a, b) => a - b), s.name).toEqual(times);
    }
  });

  for (const s of HOST_SCENARIOS) {
    it(`${s.name}: every step and answer passes its schema`, () => {
      expect(snapshotValid(s.script.start), `${s.name} start`).toBe(true);
      s.script.timeline.forEach((step, i) => expect(stepValid(step), `${s.name} step ${i} (${step.kind})`).toBe(true));
      const a = s.script.answers;
      for (const receipt of a.insert ?? []) expect(InsertReceiptSchema.safeParse(receipt).success).toBe(true);
      for (const receipt of a.navigate ?? []) expect(NavigationReceiptSchema.safeParse(receipt).success).toBe(true);
      for (const checkpoint of a.checkpoint ?? []) expect(checkpoint === null || FreshnessCheckpointSchema.safeParse(checkpoint).success).toBe(true);
      for (const preflight of a.preflight ?? []) expect(PreviewSendPreflightSchema.safeParse(preflight).success).toBe(true);
      for (const commit of a.commit ?? []) expect(PreviewSendCommitSchema.safeParse(commit).success).toBe(true);
    });

    it(`${s.name}: the fake answers what the scenario says`, async () => {
      const { answers } = await play(s);
      expect(answers).toEqual(s.calls.map((call) => call.expect));
    });
  }

  it('every X8 attempt path follows §6.7.7 from preparing and ends in its row', async () => {
    for (const s of HOST_SCENARIOS) {
      if (s.attempts.length === 0) continue;
      const { host } = await play(s);
      const seen = new Map<string, SendAttemptView[]>();
      for (const attempt of s.attempts) {
        const first = host.calls.commits.find((c) => c.request.attemptId === attempt.attemptId);
        const commit = s.calls.find((c): c is Extract<HostCall, { call: 'commit' }> => c.call === 'commit' && c.request.attemptId === attempt.attemptId);
        expect(first, `${s.name}: one queue call`).toBeDefined();
        if (commit === undefined) throw new Error(`${s.name}: no commit for ${attempt.attemptId}`);
        seen.set(attempt.attemptId, [viewOfCommit(attempt.attemptId, commit.expect)]);
        host.previewSend?.onState(attempt.attemptId, (view) => seen.get(attempt.attemptId)?.push(view));
      }
      host.run();
      for (const attempt of s.attempts) {
        const views = seen.get(attempt.attemptId) ?? [];
        const path: SendAttemptState[] = ['preparing', ...views.map((v) => v.state)];
        expect(path, `${s.name} ${attempt.attemptId}`).toEqual(attempt.path);
        path.slice(1).forEach((state, i) => expect(T[path[i] ?? 'ready'], `${s.name}: ${path[i]} → ${state}`).toContain(state));
        const last = views[views.length - 1];
        if (last === undefined) throw new Error('no state');
        expect(previewSendStateOf(last, { ok: true }).s, `${s.name} row`).toBe(attempt.row);
      }
    }
  });

  it('together they reach every attempt state, every insert and navigation outcome and every send condition', () => {
    const states = new Set(HOST_SCENARIOS.flatMap((s) => s.attempts.flatMap((a) => a.path)));
    expect(SEND_ATTEMPT_STATES.filter((state) => state !== 'ready' && !states.has(state))).toEqual([]);
    const inserts = new Set(HOST_SCENARIOS.flatMap((s) => s.calls.flatMap((c) => (c.call === 'insert' ? [c.expect.state] : []))));
    expect([...inserts].sort()).toEqual(['applied', 'rejected', 'uncertain']);
    const navigations = new Set(HOST_SCENARIOS.flatMap((s) => s.calls.flatMap((c) => (c.call === 'navigate' ? [c.expect.state] : []))));
    expect([...navigations].sort()).toEqual(['failed', 'navigated']);
    const refusals = new Set(HOST_SCENARIOS.flatMap((s) => s.calls.flatMap((c) => (c.call === 'preflight' && !c.expect.ok ? [c.expect.code] : []))));
    expect(PREVIEW_SEND_CONDITION_CODES.filter((code) => !refusals.has(code))).toEqual([]);
  });

  it('a human send counts as `sent` only with a receipt id and our insert behind it', () => {
    for (const s of HOST_SCENARIOS) {
      for (const expected of s.humanSends) {
        const step = s.script.timeline.find((t) => t.kind === 'event' && t.event.type === 'humanSend' && t.event.fact.pendingId === expected.pendingId);
        if (step?.kind !== 'event' || step.event.type !== 'humanSend') throw new Error(expected.pendingId);
        const fact = step.event.fact;
        const echoed = s.script.timeline.some(
          (t) => t.kind === 'event' && t.event.type === 'incoming' && !t.event.fact.fromFan && t.event.fact.platformMessageId === fact.platformMessageId,
        );
        const attributed = fact.platformMessageId !== null && fact.draft.insertIntentId !== null && echoed;
        expect(attributed, expected.pendingId).toBe(expected.sent);
        expect(attributed ? fact.draft.editedSinceInsert : null).toBe(expected.edited);
      }
    }
  });
});

describe('the fake HostPort holds the consumer to the contracts', () => {
  const base = HOST_SCENARIOS[0];
  if (base === undefined) throw new Error('no scenarios');
  const insert = {
    intentId: hostUuid(0x900),
    operationId: hostUuid(0x901),
    part: { index: 0 },
    target: openChat,
    expected: { kind: 'open', documentEpoch: DOCUMENT, routeEpoch: 5, composerInstanceId: 'composer-1', draftRevision: 4, draftDigest: 'feedbeef00000004' },
    mode: 'replace',
    text: 'Hi',
    confirmationId: null,
    createdAt: HOST_T0,
    expiresAt: HOST_T0 + 20_000,
    cause: hostCause,
  } as const;

  it('refuses an insert without its action token, and a deferred one through insert()', () => {
    const host = new FakeHostPort(base.script);
    const { cause: _cause, ...withoutCause } = insert;
    expect(() => host.insert(withoutCause as never)).toThrow(HostContractViolation);
    expect(() => host.insert({ ...insert, expected: { kind: 'deferred', documentEpoch: DOCUMENT } })).toThrow(HostContractViolation);
    expect(host.calls.inserts).toEqual([]);
  });

  it('spends the token once per intent and writes nothing when it is refused', async () => {
    const host = new FakeHostPort({ ...base.script, answers: { redeem: [false] } });
    expect(await host.insert(insert)).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    expect(host.calls.inserts).toEqual([]);
    expect(host.calls.redeemed).toEqual([{ kind: 'insert', intentId: insert.intentId, actionToken: ACTION_TOKEN, redeemed: false }]);
  });

  it('calls the queue once per attempt and refuses a ticket of another attempt', async () => {
    const s = HOST_SCENARIOS.find((x) => x.name === 'x8-duplicate-command');
    if (s === undefined) throw new Error('x8-duplicate-command');
    const { host } = await play(s);
    expect(host.calls.commits).toHaveLength(1);
    const request = s.calls.find((c) => c.call === 'commit');
    if (request?.call !== 'commit') throw new Error('commit');
    expect(() => host.previewSend?.commit(request.request, { ...request.ticket, attemptId: hostUuid(0x999) })).toThrow(HostContractViolation);
  });

  it('has no PreviewSendPort while the X8 capability is off', () => {
    const s = HOST_SCENARIOS.find((x) => x.name === 'contract-degraded');
    if (s === undefined) throw new Error('contract-degraded');
    const host = new FakeHostPort(s.script);
    expect(host.previewSend).toBeNull();
    const reports: unknown[] = [];
    host.onContract((report) => reports.push(report));
    host.run();
    expect(reports).toHaveLength(1);
    expect(host.current().contract.capabilities.insert.state).toBe('contractBroken');
  });

  it('reads page memory only and gives the checkpoint MAIN took', async () => {
    const host = new FakeHostPort(base.script);
    expect(host.chatWindow(openChat)?.state).toBe('ready');
    expect(host.chatWindow(previewChat)).toBeNull();
    expect(host.listCachedChats(openChat.hostAccountId, 1)).toHaveLength(1);
    expect(await host.checkpoint(previewChat)).toEqual(previewCheckpoint);
  });
});
