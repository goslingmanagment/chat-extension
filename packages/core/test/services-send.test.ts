// core/services SendCoordinator and PreviewSendDriver against the fake host
// port (@cg/testing/host), the hub custody scripts and a fake clock
// (architecture.md §6.7.4–§6.7.11): journal before dispatch, one dispatch
// and one queue call per attempt, twenty fast clicks as one attempt, locks
// per fan, custody reports only on proof, uncertain never retried, and a
// crash at every boundary between dispatch and enqueue.

import { describe, expect, it } from 'vitest';

import {
  ClaimBodySchema,
  SendJournalEntrySchema,
  STORAGE_KEYS,
  type ClaimState,
  type CustodyState,
  type OpView,
  type SendAttemptView,
  type SendBegin,
  type ServedContext,
} from '@cg/contracts';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, PreviewSendDriver, SendCoordinator, sendPageGate, type BackgroundSendPort, type SendClick } from '@cg/core/services';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_ON, resolveHubErrorReference } from '@cg/testing/hub';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { FakeHub, type ClaimAnswer } from './support/fake-hub';
import { NOW_MS, WORLD, checkpointFor, persona, session, targetOf, uuid, withX8 } from './support/world';

const TAB = uuid(0xa1);
const OP = uuid(0x100);
const GEN = uuid(0x200);
const previewTarget = targetOf(WORLD.otherFan);
const checkpoint = checkpointFor(WORLD.otherFan);
const at = (seconds: number): string => new Date(NOW_MS + seconds * 1000).toISOString();
const PAGE_LABEL = WORLD.pages.one.pageLabel;

const served: ServedContext = {
  source: 'union',
  servedHead: { messageRef: WORLD.messages.fanLatest, at: at(-60) },
  knownFanMessages: [
    { id: WORLD.messages.fanLatest, state: 'included' },
    { id: WORLD.messages.fanFirst, state: 'included' },
  ],
  live: { status: 'not_sent', accepted: 0, rejected: 0 },
};

const doneView = (over: Partial<OpView> = {}): OpView => ({
  opId: OP,
  feature: 'reply',
  surface: 'preview',
  target: previewTarget,
  state: 'done',
  phase: { name: 'settled', since: NOW_MS },
  startedAt: NOW_MS,
  endedAt: NOW_MS,
  generationRef: GEN,
  result: { kind: 'parts', parts: ['first part text', 'second part text'], splitRequested: true },
  servedContext: served,
  toneUsed: null,
  ...over,
});

const claim = (custody: { attemptId: string; state: CustodyState; ticket?: string | null } | null, over: Partial<ClaimState> = {}): ClaimState => ({
  greeting: { state: 'none', at: null, messageRef: null, source: null },
  lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
  group: { generationRef: GEN, variant: 0, partCount: 2, sentParts: [], heldParts: [] },
  custody:
    custody === null
      ? null
      : { attemptId: custody.attemptId, state: custody.state, ticket: custody.ticket ?? null, ticketExpiresAt: custody.ticket === undefined || custody.ticket === null ? null : at(10) },
  serverNow: at(0),
  flagRevision: WORLD.configRevision,
  ...over,
});
const ticketFor = (attemptId: string): ClaimAnswer => ({ kind: 'ok', state: claim({ attemptId, state: 'dispatching', ticket: `tkt-${attemptId.slice(-3)}` }) });
const okAnswer = (attemptId: string, state: CustodyState): ClaimAnswer => ({ kind: 'ok', state: claim({ attemptId, state }) });

interface SendHarness {
  readonly clock: FakeClock;
  readonly hub: FakeHub;
  readonly store: MemoryStore;
  readonly events: EventLog;
  readonly log: LogRecorder;
  readonly tokens: ActionTokens;
  readonly coordinator: SendCoordinator;
  readonly sent: unknown[];
  readonly ops: Map<string, OpView>;
  env: OpsEnvironment;
  begin(over?: Partial<SendBegin>): SendBegin;
}

function sendHarness(over: { clock?: FakeClock; store?: MemoryStore; hub?: FakeHub } = {}): SendHarness {
  const clock = over.clock ?? new FakeClock(NOW_MS);
  const hub = over.hub ?? new FakeHub(clock);
  const store = over.store ?? new MemoryStore();
  const events = new EventLog();
  const log = new LogRecorder();
  const ids = sequentialIds(0xb00);
  const tokens = new ActionTokens(clock, ids);
  const sent: unknown[] = [];
  const ops = new Map<string, OpView>([[OP, doneView()]]);
  const h: SendHarness = {
    clock,
    hub,
    store,
    events,
    log,
    tokens,
    sent,
    ops,
    env: { session, bootstrap: withX8(BOOTSTRAP_PILOT_ON), persona: () => persona, debug: false, settingsLoaded: true },
    coordinator: undefined as unknown as SendCoordinator,
    begin: (b = {}) => ({
      attemptId: uuid(0x500),
      opId: OP,
      target: previewTarget,
      purpose: 'preview-reply',
      group: { generationRef: GEN, variant: 0, partCount: 2 },
      part: { index: 0 },
      previewRevision: 0,
      textRevision: 0,
      checkpoint,
      documentEpoch: checkpoint.documentEpoch,
      cause: { kind: 'click', actionToken: tokens.issue(TAB, 'send', b.purpose === 'greeting' ? 'newcomers' : 'preview').actionToken },
      ...b,
    }),
  };
  (h as { coordinator: SendCoordinator }).coordinator = new SendCoordinator({
    clock,
    hub,
    resolve: resolveHubErrorReference,
    tokens,
    events,
    store,
    ops: {
      forSend: (opId) => {
        const view = ops.get(opId);
        if (view === undefined) return null;
        return {
          view,
          checkpoint,
          tag: { hubOrigin: session.hubOrigin, userId: session.userId, signInEpoch: session.epoch, pageId: WORLD.pages.one.pageId, personaKey: persona.key, personaDefinitionId: persona.definitionId },
        };
      },
    },
    environment: () => h.env,
    instanceId: WORLD.instanceId,
    log,
    onSent: (fact) => sent.push(fact),
  });
  return h;
}

const report = (h: SendHarness, attempt: string, state: SendAttemptView['state'], extra: Partial<SendAttemptView> = {}, pendingId?: string): Promise<boolean> =>
  h.coordinator.report({ attemptId: uuid(attempt === 'a' ? 0x500 : Number.parseInt(attempt, 16)), state, ...extra }, pendingId);

const A = uuid(0x500);
const actions = (h: SendHarness): string[] => h.hub.claims.map((c) => `${c.body.action}${c.body.action === 'failed' ? `:${c.body.reason}` : ''}`);

describe('[SP-054] [X8-07] [X8-08] [X8-09] the coordinator: journal, one dispatch, reports on proof', () => {
  it('[X8-07] the journal record exists before dispatch; [X8-09] dispatch carries the flag revision; the ticket is local-clock', async () => {
    const h = sendHarness();
    const journalAtDispatch: unknown[] = [];
    const claimFn = h.hub.claim.bind(h.hub);
    h.hub.claim = (op) => {
      journalAtDispatch.push(h.store.data.get(STORAGE_KEYS.sendJournal));
      return claimFn(op);
    };
    h.hub.claimScript.push(ticketFor(A));
    const result = await h.coordinator.begin(TAB, h.begin());
    expect(result).toEqual({ ok: true, ticket: { attemptId: A, ticket: 'tkt-500', expiresAt: NOW_MS + 9_000 } });
    const journal = journalAtDispatch[0] as unknown[];
    expect(journal).toHaveLength(1);
    expect(SendJournalEntrySchema.safeParse(journal[0]).success).toBe(true);
    expect(JSON.stringify(journal)).not.toContain('part text');
    const dispatch = h.hub.claims[0];
    expect(dispatch?.pageLabel).toBe(PAGE_LABEL);
    expect(dispatch?.fanRef).toBe(WORLD.otherFan);
    expect(dispatch?.body).toMatchObject({ action: 'dispatch', attemptId: A, instanceId: WORLD.instanceId, purpose: 'preview-reply', partIndex: 0, flagRevision: WORLD.configRevision });
    expect(ClaimBodySchema.safeParse(dispatch?.body).success).toBe(true);
  });

  it('[SP-054] enqueued → accepted → echo: sentObserved, custody `sent` with the id, telemetry hook, lock released', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin());
    expect(await report(h, 'a', 'nativeEnqueued', {}, 'pending-1')).toBe(true);
    expect(await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    expect(await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    await h.coordinator.idle();
    expect(h.coordinator.status(A)).toEqual({ attemptId: A, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs });
    expect(actions(h)).toEqual(['dispatch', 'sent']);
    expect(h.hub.claims[1]?.body).toEqual({ action: 'sent', attemptId: A, instanceId: WORLD.instanceId, platformMessageId: WORLD.messages.sentByUs, evidence: 'receipt+echo' });
    expect(h.sent).toEqual([{ attemptId: A, opId: OP, purpose: 'preview-reply', part: 0, variant: 0, generationRef: GEN, platformMessageId: WORLD.messages.sentByUs }]);
    const journal = h.store.data.get(STORAGE_KEYS.sendJournal) as { state: string; pendingId?: string }[];
    expect(journal[0]).toMatchObject({ state: 'sentObserved', pendingId: 'pending-1' });
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 0 });
    // The next part of the group is a new click with its own dispatch.
    h.hub.claimScript.push(ticketFor(uuid(0x501)));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: 1 } }))).ok).toBe(true);
    expect(h.events.of('send.state').length).toBeGreaterThanOrEqual(3);
  });

  it('[X8-01] twenty fast clicks of one part are one attempt, one dispatch, one ticket', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x500 + i) }))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.view.attemptId === A)).toBe(true);
    expect(h.hub.claims).toHaveLength(1);
    // The same attempt asking again never gets a second ticket.
    expect(await h.coordinator.begin(TAB, h.begin())).toEqual({ ok: false, view: { attemptId: A, state: 'preparing' } });
    expect(h.hub.claims).toHaveLength(1);
  });

  it('[X8-08] one attempt at a time per fan: another part waits behind a running one', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p1');
    const second = await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: 1 } }));
    expect(second).toEqual({ ok: false, view: { attemptId: uuid(0x501), state: 'held', code: 'CG-SEND-BUSY' } });
    expect(h.hub.claims).toHaveLength(1);
    expect(h.coordinator.counts()).toEqual({ open: 1, uncertain: 0 });
  });

  it('[AI-120] [SP-054] refusals before the journal: no token, the background conditions; nothing reaches the hub', async () => {
    const h = sendHarness();
    const forged = await h.coordinator.begin(TAB, { ...h.begin(), cause: { kind: 'click', actionToken: 'tok_forged_00000000000' } });
    expect(forged).toEqual({ ok: false, view: { attemptId: A, state: 'held', code: 'CG-SEND-PART' } });
    h.ops.set(OP, doneView({ stale: { reason: 'fan-wrote', at: null } }));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), previewRevision: 1 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-STALE' } });
    h.ops.set(OP, doneView());
    h.env = { ...h.env, bootstrap: BOOTSTRAP_PILOT_ON };
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502), previewRevision: 2 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-OFF' } });
    h.env = { ...h.env, bootstrap: withX8(BOOTSTRAP_PILOT_ON), persona: () => ({ ...persona, definitionId: WORLD.persona.otherDefinitionId }) };
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x503), previewRevision: 3 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-CONTEXT-CHANGED' } });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x504), opId: uuid(0x199), previewRevision: 4 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-PART' } });
    expect(h.hub.claims).toHaveLength(0);
    expect(h.store.writes).toBe(0);
    expect(await h.coordinator.report({ attemptId: A, state: 'nativeEnqueued' })).toBe(false);
    expect(await h.coordinator.report({ attemptId: uuid(0xdead), state: 'nativeEnqueued' })).toBe(false);
  });

  it('[X8-07] a journal that cannot be written means no dispatch', async () => {
    const h = sendHarness();
    h.store.failWrites = true;
    expect(await h.coordinator.begin(TAB, h.begin())).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-STORAGE-WRITE' } });
    expect(h.hub.claims).toHaveLength(0);
  });

  it('[X8-09] dispatch refusals hold without a second dispatch; a lost answer reports not_enqueued', async () => {
    const cases: { answer: ClaimAnswer; code: string; reports: string[] }[] = [
      { answer: { kind: 'http', status: 409, error: 'custody_held' }, code: 'CG-SEND-UNCERTAIN', reports: [] },
      { answer: { kind: 'http', status: 409, error: 'client_feature_disabled', reason: 'flag_off' }, code: 'CG-SEND-OFF', reports: [] },
      { answer: { kind: 'http', status: 409, error: 'part_already_sent' }, code: 'CG-SEND-PART', reports: [] },
      { answer: { kind: 'http', status: 429, error: 'preview_send_rate_limited' }, code: 'CG-HUB-RATE-LIMIT', reports: [] },
      { answer: { kind: 'transport', failure: 'network' }, code: 'CG-NETWORK', reports: ['failed:not_enqueued'] },
      { answer: { kind: 'transport', failure: 'timeout' }, code: 'CG-HUB-TIMEOUT', reports: ['failed:not_enqueued'] },
      { answer: { kind: 'ok', state: claim({ attemptId: uuid(0x777), state: 'uncertain-held' }) }, code: 'CG-SEND-UNCERTAIN', reports: [] },
      { answer: { kind: 'ok', state: claim({ attemptId: A, state: 'dispatching', ticket: null }) }, code: 'CG-HUB-REQUEST', reports: ['failed:not_enqueued'] },
    ];
    for (const c of cases) {
      const h = sendHarness();
      h.hub.claimScript.push(c.answer, okAnswer(A, 'failed'));
      expect(await h.coordinator.begin(TAB, h.begin())).toMatchObject({ ok: false, view: { attemptId: A, state: 'held', code: c.code } });
      await h.coordinator.idle();
      expect({ code: c.code, claims: actions(h) }).toEqual({ code: c.code, claims: ['dispatch', ...c.reports] });
      // The fan is free again: the lock went with the held attempt.
      expect(h.coordinator.counts().open).toBe(0);
    }
  });

  it('[SP-054] MAIN held or notEnqueued: custody hears not_enqueued; a queue refusal may be clicked again, a stale hold may not', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'failed:not_enqueued']);
    h.hub.claimScript.push(ticketFor(uuid(0x501)), okAnswer(uuid(0x501), 'failed'));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501) }))).ok).toBe(true);
    await report(h, '501', 'held', { code: 'CG-SEND-STALE' });
    await h.coordinator.idle();
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502) }))).toEqual({ ok: false, view: { attemptId: uuid(0x501), state: 'held', code: 'CG-SEND-STALE' } });
    expect(actions(h)).toEqual(['dispatch', 'failed:not_enqueued', 'dispatch', 'failed:not_enqueued']);
  });

  it('[SP-054] Message Guard: a proven 4xx is reported with its status and the same part is never sent again', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'rejected', { code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['contact-info'] } });
    await h.coordinator.idle();
    expect(h.hub.claims[1]?.body).toEqual({ action: 'failed', attemptId: A, instanceId: WORLD.instanceId, reason: 'native_rejected', httpStatus: 422 });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), previewRevision: 1 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-PART' } });
  });

  it('[NF-022] [RB-007] uncertain reports nothing, holds the fan, is never retried; the late linked pair ends it as sent', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'uncertain', { code: 'CG-SEND-UNCERTAIN', platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch']);
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 1 });
    // Another part, another click: held by the uncertain one (after a safe read of the hub custody).
    h.hub.statusScript.push(okAnswer(A, 'uncertain-held'));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: 1 } }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-UNCERTAIN' } });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502) }))).toEqual({ ok: false, view: h.coordinator.status(A) });
    expect(h.hub.claims.filter((c) => c.body.action === 'dispatch')).toHaveLength(1);
    // The late echo with the same id completes the already linked pair.
    h.hub.claimScript.push(okAnswer(A, 'sent'));
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(h.coordinator.status(A)?.state).toBe('sentObserved');
    expect(actions(h)).toEqual(['dispatch', 'sent']);
  });

  it('[NF-022] only the hub resolve frees an uncertain fan; a resolved «sent» part counts as delivered', async () => {
    for (const resolved of ['resolved-not-sent', 'resolved-sent'] as const) {
      const h = sendHarness();
      h.hub.claimScript.push(ticketFor(A));
      await h.coordinator.begin(TAB, h.begin());
      await report(h, 'a', 'uncertain', { code: 'CG-SEND-UNCERTAIN' });
      h.hub.statusScript.push(okAnswer(A, resolved));
      h.hub.claimScript.push(ticketFor(uuid(0x501)));
      const next = await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: resolved === 'resolved-sent' ? 1 : 0 }, previewRevision: 1 }));
      expect({ resolved, ok: next.ok }).toEqual({ resolved, ok: true });
      expect(h.coordinator.counts().uncertain).toBe(0);
    }
  });

  it('[NF-022] a ticket that is never reported turns uncertain after its deadline, and nothing is sent again', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    await h.clock.advance(10_000 + 2_000 + 4_000);
    expect(h.coordinator.status(A)?.state).toBe('preparing');
    await h.clock.advance(2_000);
    expect(h.coordinator.status(A)).toEqual({ attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    await h.clock.advance(60_000);
    expect(actions(h)).toEqual(['dispatch']);
    // An enqueued attempt waits for ChatSpace's own 30 s native timeout, then uncertain.
    const g = sendHarness();
    g.hub.claimScript.push(ticketFor(A));
    await g.coordinator.begin(TAB, g.begin());
    await report(g, 'a', 'nativeEnqueued', {}, 'p');
    await g.clock.advance(34_000);
    expect(g.coordinator.status(A)?.state).toBe('nativeEnqueued');
    await g.clock.advance(2_000);
    expect(g.coordinator.status(A)?.state).toBe('uncertain');
  });

  it('[NF-019] a greeting: newcomers surface token, the lease travels with dispatch, a second greeting is refused', async () => {
    const h = sendHarness();
    h.ops.set(OP, doneView({ feature: 'hi', surface: 'newcomers', result: { kind: 'variants', variants: [['hello there'], ['hey', 'you']] } }));
    const lease = uuid(0x300);
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    const begun = await h.coordinator.begin(TAB, h.begin({ purpose: 'greeting', group: { generationRef: GEN, variant: 1, partCount: 2 }, part: { variant: 1, index: 0 }, leaseToken: lease }));
    expect(begun.ok).toBe(true);
    expect(h.hub.claims[0]?.body).toMatchObject({ action: 'dispatch', purpose: 'greeting', leaseToken: lease, group: { variant: 1, partCount: 2 } });
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    // MAIN's sentObserved names the id of the linked receipt and echo.
    expect(await report(h, 'a', 'sentObserved', {})).toBe(false);
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(h.coordinator.status(A)?.state).toBe('sentObserved');
    // Another generation to the same fan would be a second greeting.
    h.ops.set(uuid(0x101), doneView({ opId: uuid(0x101), generationRef: uuid(0x201), feature: 'hi', surface: 'newcomers', result: { kind: 'variants', variants: [['again']] } }));
    const second = await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), opId: uuid(0x101), purpose: 'greeting', group: { generationRef: uuid(0x201), variant: 0, partCount: 1 } }));
    expect(second).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-CLAIM-BUSY' } });
  });

  it('[X8-09] the page gate reads the switches, the receipt profiles, the ticket lifetime and the page label', () => {
    expect(sendPageGate(null, 11)).toEqual({ previewSend: false, newcomers: false, receiptProfiles: 0, flagRevision: 0, ticketSec: 0, pageLabel: null });
    expect(sendPageGate(withX8(BOOTSTRAP_PILOT_ON), 11)).toEqual({ previewSend: true, newcomers: true, receiptProfiles: 1, flagRevision: WORLD.configRevision, ticketSec: 10, pageLabel: PAGE_LABEL });
    expect(sendPageGate(BOOTSTRAP_PILOT_ON, 11).previewSend).toBe(false);
    expect(sendPageGate(withX8(BOOTSTRAP_PILOT_ON), 999).pageLabel).toBeNull();
  });

  it('[X8-08] a report that fails in transport is repeated a bounded number of times with the same attemptId', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), { kind: 'transport', failure: 'network' }, { kind: 'transport', failure: 'network' }, okAnswer(A, 'failed'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await h.clock.advance(10_000);
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'failed:not_enqueued', 'failed:not_enqueued', 'failed:not_enqueued']);
    const g = sendHarness();
    g.hub.claimScript.push(ticketFor(A), { kind: 'http', status: 409, error: 'custody_not_owned' });
    await g.coordinator.begin(TAB, g.begin());
    await report(g, 'a', 'held', { code: 'CG-SEND-FRESHNESS' });
    await g.clock.advance(10_000);
    expect(actions(g)).toEqual(['dispatch', 'failed:not_enqueued']);
    expect(g.log.entries.some((e) => e.msg === 'custody report not delivered')).toBe(true);
  });
});

describe('[X8-07] [RB-007] a crash at every boundary between dispatch and enqueue never sends twice', () => {
  /** Runs the first instance up to a boundary, then «unloads» it and restores a new one from the same storage. */
  async function crashAt(boundary: 'after-journal' | 'dispatch-answer-lost' | 'after-ticket' | 'after-enqueue' | 'main-held' | 'journal-enqueued'): Promise<{ second: SendHarness; host: FakeHostPort; first: SendHarness }> {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = sendHarness({ clock, store });
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint, answers: {}, timeline: [] });
    const begin = first.begin();
    if (boundary === 'after-journal') first.hub.claimScript.push({ kind: 'hang' });
    else first.hub.claimScript.push(ticketFor(A));
    const begun = first.coordinator.begin(TAB, begin);
    await clock.advance(1);
    if (boundary !== 'after-journal' && boundary !== 'dispatch-answer-lost') {
      const result = await begun;
      if (!result.ok) throw new Error('expected a ticket');
      if (boundary === 'after-enqueue' || boundary === 'main-held' || boundary === 'journal-enqueued') {
        const commit = await host.previewSend?.commit({ attemptId: A, target: previewTarget, generationRef: GEN, part: { index: 0 }, previewRevision: 0, plainText: 'first part text', isAiGenerated: true, checkpoint, cause: begin.cause }, result.ticket);
        expect(commit?.state).toBe('nativeEnqueued');
        if (boundary === 'journal-enqueued') await report(first, 'a', 'nativeEnqueued', {}, 'pending-x');
      }
    }
    await first.coordinator.idle();
    // The event page unloads here. A new instance restores from storage.local.
    const second = sendHarness({ clock, store });
    if (boundary === 'after-journal') second.hub.statusScript.push({ kind: 'ok', state: claim(null) });
    else second.hub.statusScript.push(okAnswer(A, 'dispatching'));
    await second.coordinator.restore();
    return { second, host, first };
  }

  it('[X8-07] journal written, dispatch never answered: the hub has no custody of it → held, the fan is free, nothing reported', async () => {
    const { second } = await crashAt('after-journal');
    expect(second.coordinator.status(A)).toEqual({ attemptId: A, state: 'held', code: 'CG-RUNTIME-RELOADED' });
    expect(second.hub.claims).toHaveLength(0);
    second.hub.claimScript.push(ticketFor(uuid(0x501)));
    expect((await second.coordinator.begin(TAB, second.begin({ attemptId: uuid(0x501) }))).ok).toBe(true);
  });

  it('[X8-07] dispatch opened a custody but its answer was lost: wait, then uncertain; never re-dispatched or re-sent', async () => {
    const { second } = await crashAt('dispatch-answer-lost');
    expect(second.coordinator.status(A)?.state).toBe('preparing');
    await second.clock.advance(20_000);
    expect(second.coordinator.status(A)?.state).toBe('uncertain');
    second.hub.statusScript.push(okAnswer(A, 'uncertain-held'));
    expect(await second.coordinator.begin(TAB, second.begin({ attemptId: uuid(0x501), part: { index: 1 } }))).toMatchObject({ ok: false, view: { code: 'CG-SEND-UNCERTAIN' } });
    expect(second.hub.claims).toHaveLength(0);
  });

  it('[X8-07] ticket handed to the tab before the crash: the tab may still commit and report; the new instance follows it to the end', async () => {
    const { second, host } = await crashAt('after-ticket');
    expect(host.calls.commits).toHaveLength(0);
    await report(second, 'a', 'nativeEnqueued', {}, 'pending-1');
    await report(second, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    second.hub.claimScript.push(okAnswer(A, 'sent'));
    await report(second, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await second.coordinator.idle();
    expect(second.coordinator.status(A)?.state).toBe('sentObserved');
    expect(actions(second)).toEqual(['sent']);
  });

  it('[X8-07] enqueued and the report lost: uncertain after the deadline; a late linked pair still proves it; one queue call in all', async () => {
    const { second, host } = await crashAt('after-enqueue');
    await second.clock.advance(20_000);
    expect(second.coordinator.status(A)?.state).toBe('uncertain');
    await report(second, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    second.hub.claimScript.push(okAnswer(A, 'sent'));
    await report(second, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await second.coordinator.idle();
    expect(second.coordinator.status(A)?.state).toBe('sentObserved');
    expect(host.calls.commits).toHaveLength(1);
  });

  it('[X8-07] MAIN refused in the same live document and the report comes after the restart: positive knowledge → held, not_enqueued', async () => {
    const { second } = await crashAt('main-held');
    second.hub.claimScript.push(okAnswer(A, 'failed'));
    await report(second, 'a', 'held', { code: 'CG-SEND-STALE' });
    await second.coordinator.idle();
    expect(second.coordinator.status(A)).toEqual({ attemptId: A, state: 'held', code: 'CG-SEND-STALE' });
    expect(actions(second)).toEqual(['failed:not_enqueued']);
  });

  it('[X8-07] the journal says enqueued: the native timeout passes, then uncertain; restart never re-sends', async () => {
    const { second, host } = await crashAt('journal-enqueued');
    expect(second.coordinator.status(A)?.state).toBe('nativeEnqueued');
    await second.clock.advance(40_000);
    expect(second.coordinator.status(A)?.state).toBe('uncertain');
    expect(host.calls.commits).toHaveLength(1);
    expect(second.hub.claims).toHaveLength(0);
    // A third instance keeps the uncertain record as it is.
    const third = sendHarness({ clock: second.clock, store: second.store });
    third.hub.statusScript.push(okAnswer(A, 'uncertain-held'));
    expect(await third.coordinator.restore()).toMatchObject({ kept: 1, uncertain: 1 });
    expect(third.coordinator.status(A)?.state).toBe('uncertain');
  });

  it('[X8-07] restore: damaged records and old ended ones go; an unreachable hub changes nothing', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = sendHarness({ clock, store });
    first.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
    await first.coordinator.begin(TAB, first.begin());
    await report(first, 'a', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await first.coordinator.idle();
    const journal = store.data.get(STORAGE_KEYS.sendJournal) as unknown[];
    store.data.set(STORAGE_KEYS.sendJournal, [...journal, { attemptId: 'broken' }]);
    const second = sendHarness({ clock, store });
    expect(await second.coordinator.restore()).toMatchObject({ kept: 1, dropped: 1 });
    await clock.advance(31 * 60_000);
    const third = sendHarness({ clock, store });
    expect(await third.coordinator.restore()).toMatchObject({ kept: 0, dropped: 1 });
  });
});

describe('[SP-054] [RB-007] the tab-side driver over the fake host port', () => {
  function driverHarness(timeline: ConstructorParameters<typeof FakeHostPort>[0]['timeline'] = []): { h: SendHarness; host: FakeHostPort; driver: PreviewSendDriver; views: SendAttemptView[]; click: () => SendClick } {
    const h = sendHarness();
    const host = new FakeHostPort({ start: startSnapshot, memory, checkpoint, answers: {}, timeline });
    const views: SendAttemptView[] = [];
    const background: BackgroundSendPort = {
      begin: (b) => h.coordinator.begin(TAB, b),
      report: async (view, pendingId) => {
        await h.coordinator.report(view, pendingId);
      },
    };
    const driver = new PreviewSendDriver({ port: host.previewSend, background, ids: sequentialIds(0x500), onView: (v) => views.push(v) });
    const click = (): SendClick => {
      const { attemptId: _a, ...begin } = h.begin();
      return { ...begin, plainText: 'first part text', isAiGenerated: true };
    };
    return { h, host, driver, views, click };
  }

  it('[SP-054] preflight → begin → one queue call → MAIN states reported until sent', async () => {
    const { h, host, driver, click } = driverHarness([
      { kind: 'send-state', at: 400, view: { attemptId: A, state: 'nativeAccepted', platformMessageId: WORLD.messages.sentByUs } },
      { kind: 'send-state', at: 660, view: { attemptId: A, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs } },
    ]);
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    const view = await driver.send(click());
    expect(view).toEqual({ attemptId: A, state: 'nativeEnqueued' });
    expect(host.calls.preflights).toHaveLength(1);
    expect(host.calls.commits).toHaveLength(1);
    expect(host.calls.commits[0]?.ticket).toEqual({ attemptId: A, ticket: 'tkt-500', expiresAt: NOW_MS + 9_000 });
    host.run();
    await h.coordinator.idle();
    await h.clock.advance(1);
    expect(h.coordinator.status(A)?.state).toBe('sentObserved');
    expect(actions(h)).toEqual(['dispatch', 'sent']);
    driver.dispose();
  });

  it('[X8-01] twenty fast clicks while one is in flight are one attempt and one queue call', async () => {
    const { h, host, driver, click } = driverHarness();
    h.hub.claimScript.push(ticketFor(A));
    const views = await Promise.all(Array.from({ length: 20 }, () => driver.send(click())));
    expect(new Set(views.map((v) => v.attemptId))).toEqual(new Set([A]));
    expect(host.calls.preflights).toHaveLength(1);
    expect(host.calls.commits).toHaveLength(1);
    expect(h.hub.claims).toHaveLength(1);
    // A later click of the same part gets the background's existing attempt, not a second queue call.
    const again = await driver.send(click());
    expect(again).toEqual({ attemptId: A, state: 'nativeEnqueued' });
    expect(host.calls.commits).toHaveLength(1);
  });

  it('[RB-007] a queue call that times out in the bridge is uncertain and is never sent again', async () => {
    const { h, host, driver, click } = driverHarness();
    const port = host.previewSend;
    if (port === null) throw new Error('X8 port');
    port.commit = () => Promise.reject(new Error('bridge timeout'));
    h.hub.claimScript.push(ticketFor(A));
    expect(await driver.send(click())).toEqual({ attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    await h.coordinator.idle();
    expect(h.coordinator.status(A)?.state).toBe('uncertain');
    expect(await driver.send(click())).toEqual({ attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(h.hub.claims.filter((c) => c.body.action === 'dispatch')).toHaveLength(1);
  });

  it('[SP-054] a preflight refusal, a missing port or a failing preflight hold the click before the background', async () => {
    const refused = driverHarness();
    const port = refused.host.previewSend;
    if (port === null) throw new Error('X8 port');
    port.preflight = () => Promise.resolve({ ok: false, code: 'CG-SEND-MIMIC' });
    expect(await refused.driver.send(refused.click())).toEqual({ attemptId: A, state: 'held', code: 'CG-SEND-MIMIC' });
    port.preflight = () => Promise.reject(new Error('bridge down'));
    expect(await refused.driver.send(refused.click())).toMatchObject({ state: 'held', code: 'CG-SEND-HOST' });
    expect(refused.h.hub.claims).toHaveLength(0);
    const none = new PreviewSendDriver({ port: null, background: { begin: () => Promise.reject(new Error('unused')), report: () => Promise.resolve() }, ids: sequentialIds(0x500) });
    expect(await none.send(refused.click())).toEqual({ attemptId: A, state: 'held', code: 'CG-SEND-HOST' });
  });

  it('[SP-054] MAIN answers held, notEnqueued or uncertain: reported once, no further listening', async () => {
    for (const commit of [{ state: 'held', code: 'CG-TIMEOUT' }, { state: 'notEnqueued', code: 'CG-SEND-QUEUE' }, { state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }] as const) {
      const { h, host, driver, click } = driverHarness();
      const port = host.previewSend;
      if (port === null) throw new Error('X8 port');
      port.commit = () => Promise.resolve(commit);
      h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
      expect(await driver.send(click())).toEqual({ attemptId: A, ...commit });
      await h.coordinator.idle();
      expect(h.coordinator.status(A)?.state).toBe(commit.state);
    }
  });

  it('[SP-054] a background refusal comes back as the view; a lost report is left to the silence deadline', async () => {
    const { h, driver, click } = driverHarness();
    h.env = { ...h.env, bootstrap: BOOTSTRAP_PILOT_ON };
    expect(await driver.send(click())).toMatchObject({ state: 'held', code: 'CG-SEND-OFF' });
    const lossy = driverHarness();
    lossy.h.hub.claimScript.push(ticketFor(A));
    const lost = new PreviewSendDriver({
      port: lossy.host.previewSend,
      background: { begin: (b) => lossy.h.coordinator.begin(TAB, b), report: () => Promise.reject(new Error('port closed')) },
      ids: sequentialIds(0x500),
    });
    expect(await lost.send(lossy.click())).toEqual({ attemptId: A, state: 'nativeEnqueued' });
    await lossy.h.clock.advance(60_000);
    expect(lossy.h.coordinator.status(A)?.state).toBe('uncertain');
  });
});
