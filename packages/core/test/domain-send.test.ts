// core/domain/send: the X8 attempt machine linked by id, locks and attempt
// keys, hub custody bodies and reports, Split groups, freshness and the
// served-context hold, the background's send conditions and the attempt
// journal (architecture.md §6.7.4–§6.7.11). Tests are named after the parity
// rows they prove; the host scenarios' attempt paths are replayed exactly.

import { describe, expect, it } from 'vitest';

import {
  ClaimBodySchema,
  SEND_ATTEMPT_STATES,
  SEND_ATTEMPT_TRANSITIONS,
  SEND_CUSTODY_REPORTS,
  SendJournalEntrySchema,
  isRetryableEnd,
  sendLockKey,
  type ClaimState,
  type FreshnessCheckpoint,
  type OpResult,
  type SendAttemptInput,
  type SendAttemptState,
  type SendBegin,
  type ServedContext,
} from '@cg/contracts';
import {
  ECHO_BUFFER_MAX,
  SendLockTable,
  applyAttemptInput,
  applyReportedView,
  attemptKeyOf,
  attemptReachable,
  beginCondition,
  canMoveAttempt,
  compareCheckpoints,
  custodyReport,
  dispatchBody,
  freshnessCode,
  groupProgress,
  holdsLock,
  isEnded,
  journalEntryOf,
  journalWithView,
  newAttempt,
  parseJournal,
  partBlock,
  partDelivered,
  readDispatch,
  restoreAction,
  sendOrderOf,
  servedContextHold,
  silenceDeadline,
  type AttemptTrack,
  type FanAttempt,
  type OpForSend,
  type SendGate,
} from '@cg/core/domain/send';
import { HOST_SCENARIOS, hostCause } from '@cg/testing/host';

import { seeded } from './support/random';
import { NOW_MS, WORLD, causeOf, checkpointFor, session, targetOf, tokenN, uuid } from './support/world';

const ATTEMPT = uuid(0x500);
const GEN = uuid(0x200);
const OP = uuid(0x100);
const previewTarget = targetOf(WORLD.otherFan);
const checkpoint = checkpointFor(WORLD.otherFan);

function beginOf(over: Partial<SendBegin> = {}): SendBegin {
  return {
    attemptId: ATTEMPT,
    opId: OP,
    target: previewTarget,
    purpose: 'preview-reply',
    group: { generationRef: GEN, variant: 0, partCount: 2 },
    part: { index: 0 },
    previewRevision: 0,
    textRevision: 0,
    checkpoint,
    documentEpoch: checkpoint.documentEpoch,
    cause: causeOf(tokenN(9)),
    ...over,
  };
}

const twoParts: OpResult = { kind: 'parts', parts: ['first', 'second'], splitRequested: true };
const served: ServedContext = {
  source: 'union',
  servedHead: { messageRef: WORLD.messages.fanLatest, at: '2026-10-03T09:59:00.000Z' },
  knownFanMessages: [
    { id: WORLD.messages.fanLatest, state: 'included' },
    { id: WORLD.messages.fanFirst, state: 'included' },
  ],
  live: { status: 'not_sent', accepted: 0, rejected: 0 },
};

function opOf(over: Partial<OpForSend> = {}): OpForSend {
  return {
    opId: OP,
    feature: 'reply',
    surface: 'preview',
    state: 'done',
    target: previewTarget,
    generationRef: GEN,
    result: twoParts,
    checkpoint,
    servedContext: served,
    stale: false,
    personaDefinitionId: WORLD.persona.definitionId,
    session: { hubOrigin: session.hubOrigin, userId: session.userId, epoch: session.epoch },
    ...over,
  };
}

const gate: SendGate = {
  session: { hubOrigin: session.hubOrigin, userId: session.userId, epoch: session.epoch },
  personaDefinitionId: WORLD.persona.definitionId,
  bindingRevision: WORLD.pages.one.bindingRevision,
  previewSend: true,
  newcomers: true,
  receiptProfiles: 1,
};

describe('[AI-120] [RB-007] [NF-022] the attempt machine: linked by id, never re-sent', () => {
  const run = (inputs: readonly SendAttemptInput[], from: AttemptTrack = newAttempt(ATTEMPT)): { track: AttemptTrack; path: SendAttemptState[] } => {
    let track = from;
    const path: SendAttemptState[] = [];
    for (const input of inputs) {
      const step = applyAttemptInput(track, input);
      if (step.changed && step.track.view.state !== track.view.state) path.push(step.track.view.state);
      track = step.track;
    }
    return { track, path };
  };

  it('[SP-054] the happy path: click → queue → receipt id → echo with the same id', () => {
    const { track, path } = run([
      { type: 'click', cause: hostCause },
      { type: 'nativeEnqueued', pendingId: 'pending-1' },
      { type: 'receipt', httpStatus: 200, platformMessageId: '4100' },
      { type: 'echo', platformMessageId: '4100' },
    ]);
    expect(path).toEqual(['preparing', 'nativeEnqueued', 'nativeAccepted', 'sentObserved']);
    expect(track.view).toEqual({ attemptId: ATTEMPT, state: 'sentObserved', platformMessageId: '4100' });
    expect(track.pendingId).toBe('pending-1');
  });

  it('[RB-007] a 401 is not an outcome; 5xx, an id-less 2xx or a second receipt are uncertain; a 4xx is a proven refusal', () => {
    const enqueued: SendAttemptInput[] = [{ type: 'click', cause: hostCause }, { type: 'nativeEnqueued', pendingId: 'p' }];
    expect(run([...enqueued, { type: 'receipt', httpStatus: 401, platformMessageId: null }]).track.view.state).toBe('nativeEnqueued');
    expect(run([...enqueued, { type: 'receipt', httpStatus: 502, platformMessageId: null }]).track.view).toEqual({ attemptId: ATTEMPT, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(run([...enqueued, { type: 'receipt', httpStatus: 200, platformMessageId: null }]).track.view.state).toBe('uncertain');
    const twice = run([...enqueued, { type: 'receipt', httpStatus: 200, platformMessageId: '4100' }, { type: 'receipt', httpStatus: 200, platformMessageId: '4101' }]);
    expect(twice.track.view).toEqual({ attemptId: ATTEMPT, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: '4100' });
    const refused = run([...enqueued, { type: 'receipt', httpStatus: 422, platformMessageId: null }]);
    expect(refused.track.view).toEqual({ attemptId: ATTEMPT, state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 422 });
    const guard = run([...enqueued, { type: 'nativeRejected', httpStatus: 401, code: 'CG-SEND-GUARD', guardTopics: ['contact-info'] }]);
    expect(guard.track.view).toEqual({ attemptId: ATTEMPT, state: 'rejected', code: 'CG-SEND-GUARD', detail: { guardTopics: ['contact-info'] } });
  });

  it('[NF-022] uncertain moves only to sentObserved, and only on the late second half of the linked pair', () => {
    const lost = run([{ type: 'click', cause: hostCause }, { type: 'nativeEnqueued', pendingId: 'p' }, { type: 'receipt', httpStatus: 200, platformMessageId: '4100' }, { type: 'lost', code: 'CG-SEND-UNCERTAIN' }]);
    expect(lost.track.view.state).toBe('uncertain');
    for (const input of [
      { type: 'click', cause: hostCause },
      { type: 'held', code: 'CG-SEND-STALE' },
      { type: 'notEnqueued', code: 'CG-SEND-QUEUE' },
      { type: 'nativeEnqueued', pendingId: 'p2' },
      { type: 'nativeRejected', httpStatus: 422, code: 'CG-SEND-REJECTED' },
      { type: 'lost', code: 'CG-SEND-UNCERTAIN' },
      { type: 'echo', platformMessageId: '4101' },
      { type: 'receipt', httpStatus: 200, platformMessageId: '4101' },
    ] as const satisfies readonly SendAttemptInput[]) {
      expect(applyAttemptInput(lost.track, input).track.view.state).toBe('uncertain');
    }
    expect(applyAttemptInput(lost.track, { type: 'echo', platformMessageId: '4100' }).track.view.state).toBe('sentObserved');
    // Without a receipt, an echo alone never proves the send: it is buffered until its receipt.
    const blind = run([{ type: 'click', cause: hostCause }, { type: 'lost', code: 'CG-SEND-UNCERTAIN' }, { type: 'echo', platformMessageId: '4100' }]);
    expect(blind.track.view.state).toBe('uncertain');
    expect(blind.track.echoes).toEqual(['4100']);
    expect(run([{ type: 'receipt', httpStatus: 200, platformMessageId: '4100' }], blind.track).track.view.state).toBe('sentObserved');
    expect(isRetryableEnd('uncertain', 'CG-SEND-UNCERTAIN')).toBe(false);
  });

  it('[SP-054] delayed frames: an echo before its receipt waits in a bounded buffer and completes the pair', () => {
    const early = run([{ type: 'click', cause: hostCause }, { type: 'nativeEnqueued', pendingId: 'p' }, { type: 'echo', platformMessageId: '4100' }, { type: 'echo', platformMessageId: '4100' }]);
    expect(early.track.view.state).toBe('nativeEnqueued');
    expect(early.track.echoes).toEqual(['4100']);
    expect(run([{ type: 'receipt', httpStatus: 200, platformMessageId: '4100' }], early.track).path).toEqual(['sentObserved']);
    let flood = early.track;
    for (let i = 0; i < 20; i += 1) flood = applyAttemptInput(flood, { type: 'echo', platformMessageId: String(5000 + i) }).track;
    expect(flood.echoes).toHaveLength(ECHO_BUFFER_MAX);
    const otherEcho = run([{ type: 'receipt', httpStatus: 200, platformMessageId: '4100' }, { type: 'echo', platformMessageId: '4999' }], newAttempt(ATTEMPT));
    expect(otherEcho.track.view.state).toBe('ready');
  });

  it('[AI-120] property: random inputs only move along the frozen transitions; sentObserved needs the same id twice; 401 never moves', () => {
    const rnd = seeded(8);
    const ids = ['4100', '4101'];
    const inputs = (): SendAttemptInput => {
      switch (rnd.int(9)) {
        case 0:
          return { type: 'click', cause: hostCause };
        case 1:
          return { type: 'held', code: 'CG-SEND-STALE' };
        case 2:
          return { type: 'notEnqueued', code: 'CG-SEND-QUEUE' };
        case 3:
          return { type: 'nativeEnqueued', pendingId: 'p' };
        case 4:
          return { type: 'receipt', httpStatus: rnd.pick([200, 201, 401, 422, 500]), platformMessageId: rnd.chance(0.2) ? null : rnd.pick(ids) };
        case 5:
          return { type: 'echo', platformMessageId: rnd.pick(ids) };
        case 6:
          return { type: 'nativeRejected', httpStatus: rnd.pick([401, 403, 422]), code: 'CG-SEND-GUARD' };
        case 7:
          return { type: 'lost', code: 'CG-SEND-UNCERTAIN' };
        default:
          return { type: 'receipt', httpStatus: 401, platformMessageId: rnd.pick(ids) };
      }
    };
    for (let run = 0; run < 500; run += 1) {
      let track = newAttempt(ATTEMPT);
      const receipts = new Set<string>();
      const echoes = new Set<string>();
      let left = false;
      for (let i = 0; i < 12; i += 1) {
        const input = inputs();
        const step = applyAttemptInput(track, input);
        const from = track.view.state;
        const to = step.track.view.state;
        if (input.type === 'receipt' && input.httpStatus === 401) expect(step.changed).toBe(false);
        if (from !== to) expect(canMoveAttempt(from, to) || attemptReachable(from, to)).toBe(true);
        if (isEnded(from)) expect(to).toBe(from);
        if (input.type === 'receipt' && input.httpStatus >= 200 && input.httpStatus < 300 && input.platformMessageId !== null) receipts.add(input.platformMessageId);
        if (input.type === 'echo') echoes.add(input.platformMessageId);
        if (to === 'sentObserved') {
          const id = step.track.view.platformMessageId;
          expect(id !== undefined && receipts.has(id) && echoes.has(id)).toBe(true);
        }
        if (from !== 'ready') left = true;
        if (left) expect(to).not.toBe('ready');
        track = step.track;
      }
    }
  });

  it('[AI-120] every host scenario attempt replays to its exact path', () => {
    const scenarios = HOST_SCENARIOS.filter((scenario) => scenario.attempts.length > 0);
    expect(scenarios.length).toBeGreaterThanOrEqual(8);
    for (const scenario of scenarios) {
      for (const expected of scenario.attempts) {
        let track = newAttempt(expected.attemptId);
        const path: SendAttemptState[] = [];
        const take = (step: { readonly track: AttemptTrack; readonly changed: boolean }): void => {
          if (step.changed && step.track.view.state !== track.view.state) path.push(step.track.view.state);
          track = step.track;
        };
        take(applyAttemptInput(track, { type: 'click', cause: hostCause }));
        for (const call of scenario.calls) {
          if (call.call !== 'commit' || call.request.attemptId !== expected.attemptId) continue;
          const commit = call.expect;
          switch (commit.state) {
            case 'nativeEnqueued':
              take(applyAttemptInput(track, { type: 'nativeEnqueued', pendingId: commit.pendingId }));
              break;
            case 'notEnqueued':
              take(applyAttemptInput(track, { type: 'notEnqueued', code: commit.code }));
              break;
            case 'held':
              take(applyAttemptInput(track, { type: 'held', code: commit.code }));
              break;
            case 'uncertain':
              take(applyAttemptInput(track, { type: 'lost', code: commit.code }));
              break;
          }
        }
        for (const step of scenario.script.timeline) if (step.kind === 'send-state' && step.view.attemptId === expected.attemptId) take(applyReportedView(track, step.view));
        expect({ scenario: scenario.name, path }).toEqual({ scenario: scenario.name, path: expected.path });
      }
    }
  });

  it('[RB-020] reported views out of order, repeated or for another attempt change nothing', () => {
    const enqueued = applyAttemptInput(applyAttemptInput(newAttempt(ATTEMPT), { type: 'click', cause: hostCause }).track, { type: 'nativeEnqueued', pendingId: 'p' }).track;
    expect(applyReportedView(enqueued, { attemptId: uuid(0x501), state: 'sentObserved', platformMessageId: '4100' }).changed).toBe(false);
    expect(applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'held', code: 'CG-SEND-STALE' }).changed).toBe(false);
    expect(applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'preparing' }).changed).toBe(false);
    expect(applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'nativeAccepted' }).changed).toBe(false);
    expect(applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'sentObserved' }).changed).toBe(false);
    const sent = applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'sentObserved', platformMessageId: '4100' });
    expect(sent.track.view.state).toBe('sentObserved');
    expect(applyReportedView(sent.track, { attemptId: ATTEMPT, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }).changed).toBe(false);
    const rejected = applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 403 });
    expect(rejected.track.view).toEqual({ attemptId: ATTEMPT, state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 403 });
    const noCode = applyReportedView(enqueued, { attemptId: ATTEMPT, state: 'rejected' });
    expect(noCode.track.view.code).toBe('CG-SEND-HOST');
    const preparing = applyAttemptInput(newAttempt(ATTEMPT), { type: 'click', cause: hostCause }).track;
    expect(applyReportedView(preparing, { attemptId: ATTEMPT, state: 'nativeEnqueued' }).track.pendingId).toBeNull();
    expect(applyReportedView(preparing, { attemptId: ATTEMPT, state: 'held' }).track.view.code).toBe('CG-SEND-HOST');
    expect(applyReportedView(preparing, { attemptId: ATTEMPT, state: 'notEnqueued' }).track.view.code).toBe('CG-SEND-QUEUE');
  });
});

describe('[X8-08] [X8-01] locks and one attempt per part', () => {
  it('[X8-01] a double click of one part and revision is one attempt key; a new preview revision is another', () => {
    const key = attemptKeyOf({ generationRef: GEN, variant: 0, partIndex: 1, previewRevision: 3 });
    expect(attemptKeyOf({ generationRef: GEN, variant: 0, partIndex: 1, previewRevision: 3 })).toBe(key);
    expect(attemptKeyOf({ generationRef: GEN, variant: 0, partIndex: 1, previewRevision: 4 })).not.toBe(key);
    expect(attemptKeyOf({ generationRef: GEN, variant: 1, partIndex: 1, previewRevision: 3 })).not.toBe(key);
  });

  it('[X8-08] one attempt per (hubOrigin, pageId, platform, fanRef); only the holder releases', () => {
    const locks = new SendLockTable();
    const key = sendLockKey({ hubOrigin: WORLD.hubOrigin, pageId: 11, platform: 'onlyfans', fanRef: WORLD.otherFan });
    expect(locks.acquire(key, uuid(1))).toBe(true);
    expect(locks.acquire(key, uuid(1))).toBe(true);
    expect(locks.acquire(key, uuid(2))).toBe(false);
    locks.release(key, uuid(2));
    expect(locks.holder(key)).toBe(uuid(1));
    locks.release(key, uuid(1));
    expect(locks.holder(key)).toBeNull();
    expect(locks.size).toBe(0);
    expect(SEND_ATTEMPT_STATES.filter(holdsLock)).toEqual(['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain']);
    locks.acquire(key, uuid(3));
    locks.clear();
    expect(locks.size).toBe(0);
  });
});

describe('[X8-08] [X8-09] hub custody', () => {
  const state = (custody: ClaimState['custody'], over: Partial<ClaimState> = {}): ClaimState => ({
    greeting: { state: 'none', at: null, messageRef: null, source: null },
    lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
    group: { generationRef: GEN, variant: 0, partCount: 2, sentParts: [], heldParts: [] },
    custody,
    serverNow: '2026-10-03T10:00:00.000Z',
    flagRevision: 4,
    ...over,
  });

  it('[X8-09] every click asks dispatch with the flag revision; the body is the hub schema', () => {
    const body = dispatchBody({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, purpose: 'greeting', group: { generationRef: GEN, variant: 0, partCount: 2 }, partIndex: 1, textRevision: 0, leaseToken: uuid(0x700), flagRevision: 4 });
    expect(ClaimBodySchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ action: 'dispatch', flagRevision: 4, leaseToken: uuid(0x700) });
    expect('leaseToken' in dispatchBody({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, purpose: 'preview-reply', group: { generationRef: GEN, variant: 0, partCount: 1 }, partIndex: 0, textRevision: 0, flagRevision: 4 })).toBe(false);
  });

  it('[HB-008] the ticket deadline moves onto the local clock from the server time, whatever the skew', () => {
    const custody = { attemptId: ATTEMPT, state: 'dispatching' as const, ticket: 'tkt-once', ticketExpiresAt: '2026-10-03T10:00:10.000Z' };
    for (const skew of [-300_000, 0, 7_200_000]) {
      const receivedAt = NOW_MS + skew;
      const reading = readDispatch(state(custody), ATTEMPT, 0, receivedAt);
      expect(reading).toEqual({ kind: 'ticket', ticket: { attemptId: ATTEMPT, ticket: 'tkt-once', expiresAt: receivedAt + 9_000 } });
    }
    expect(readDispatch(state({ ...custody, ticketExpiresAt: '2026-10-03T10:00:00.500Z' }), ATTEMPT, 0, NOW_MS)).toEqual({ kind: 'no-ticket', code: 'CG-TIMEOUT', opened: true });
    expect(readDispatch(state({ ...custody, ticket: null }), ATTEMPT, 0, NOW_MS)).toEqual({ kind: 'no-ticket', code: 'CG-HUB-REQUEST', opened: true });
  });

  it('[X8-08] no ticket without a custody of this very attempt: sent parts, another unresolved send, repeated dispatch', () => {
    expect(readDispatch(state(null, { group: { generationRef: GEN, variant: 0, partCount: 2, sentParts: [0], heldParts: [] } }), ATTEMPT, 0, NOW_MS)).toMatchObject({ code: 'CG-SEND-PART' });
    expect(readDispatch(state({ attemptId: uuid(0x501), state: 'uncertain-held', ticket: null, ticketExpiresAt: null }), ATTEMPT, 0, NOW_MS)).toMatchObject({ code: 'CG-SEND-UNCERTAIN', opened: false });
    expect(readDispatch(state({ attemptId: uuid(0x501), state: 'failed', ticket: null, ticketExpiresAt: null }), ATTEMPT, 0, NOW_MS)).toMatchObject({ code: 'CG-HUB-REQUEST' });
    expect(readDispatch(state({ attemptId: ATTEMPT, state: 'sent', ticket: null, ticketExpiresAt: null }), ATTEMPT, 0, NOW_MS)).toMatchObject({ code: 'CG-SEND-PART' });
    expect(readDispatch(state({ attemptId: ATTEMPT, state: 'failed', ticket: null, ticketExpiresAt: null }), ATTEMPT, 0, NOW_MS)).toMatchObject({ code: 'CG-HUB-REQUEST' });
  });

  it('[X8-08] reports follow SEND_CUSTODY_REPORTS and only on proof; nothing for an attempt that never reached dispatch', () => {
    for (const s of SEND_ATTEMPT_STATES) {
      const body = custodyReport({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, state: s, httpStatus: 422, platformMessageId: '4100', dispatched: true });
      const expected = SEND_CUSTODY_REPORTS[s];
      if (expected === null) expect(body).toBeNull();
      else {
        expect(body).not.toBeNull();
        expect(ClaimBodySchema.safeParse(body).success).toBe(true);
        expect(body?.action).toBe(expected === 'sent' ? 'sent' : 'failed');
      }
      expect(custodyReport({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, state: s, dispatched: false })).toBeNull();
    }
    expect(custodyReport({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, state: 'rejected', dispatched: true })).toBeNull();
    expect(custodyReport({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, state: 'rejected', httpStatus: 401, dispatched: true })).toBeNull();
    expect(custodyReport({ attemptId: ATTEMPT, instanceId: WORLD.instanceId, state: 'sentObserved', dispatched: true })).toBeNull();
  });
});

describe('[X8-08] Split groups (§6.7.9)', () => {
  const group = { generationRef: GEN, variant: 0, partCount: 3 };
  const attempt = (partIndex: number, state: SendAttemptState, over: Partial<FanAttempt> = {}): FanAttempt => ({ attemptId: uuid(0x600 + partIndex), purpose: 'greeting', group, partIndex, state, ...over });

  it('[X8-08] a delivered or refused part is never sent again; one uncertain part holds the fan', () => {
    expect(partBlock({ purpose: 'greeting', group, partIndex: 0 }, [])).toBeNull();
    expect(partBlock({ purpose: 'greeting', group, partIndex: 0 }, [attempt(0, 'sentObserved')])).toBe('CG-SEND-PART');
    expect(partBlock({ purpose: 'greeting', group, partIndex: 0 }, [attempt(0, 'rejected')])).toBe('CG-SEND-PART');
    expect(partBlock({ purpose: 'greeting', group, partIndex: 1 }, [attempt(0, 'sentObserved')])).toBeNull();
    expect(partBlock({ purpose: 'greeting', group, partIndex: 2 }, [attempt(0, 'uncertain')])).toBe('CG-SEND-UNCERTAIN');
    expect(partBlock({ purpose: 'greeting', group, partIndex: 0 }, [attempt(0, 'held'), attempt(0, 'notEnqueued')])).toBeNull();
  });

  it('[NF-019] after a confirmed greeting another generation is a second greeting; a hub resolve counts', () => {
    const other = { generationRef: uuid(0x201), variant: 0, partCount: 1 };
    expect(partBlock({ purpose: 'greeting', group: other, partIndex: 0 }, [attempt(0, 'sentObserved')])).toBe('CG-CLAIM-BUSY');
    expect(partBlock({ purpose: 'preview-reply', group: other, partIndex: 0 }, [attempt(0, 'sentObserved')])).toBeNull();
    expect(partBlock({ purpose: 'greeting', group, partIndex: 0 }, [attempt(0, 'uncertain', { resolved: 'sent' })])).toBe('CG-SEND-PART');
    expect(partBlock({ purpose: 'greeting', group, partIndex: 1 }, [attempt(0, 'uncertain', { resolved: 'not-sent' })])).toBeNull();
    expect(partDelivered(attempt(0, 'uncertain', { resolved: 'sent' }))).toBe(true);
  });

  it('[X8-08] order hints and progress: held behind an uncertain part, «after part N», N of M', () => {
    expect(sendOrderOf(group, 0, [])).toBeNull();
    expect(sendOrderOf(group, 2, [])).toEqual({ kind: 'after', part: 1 });
    expect(sendOrderOf(group, 2, [attempt(0, 'sentObserved')])).toEqual({ kind: 'after', part: 2 });
    expect(sendOrderOf(group, 2, [attempt(0, 'sentObserved'), attempt(1, 'uncertain')])).toEqual({ kind: 'held', part: 2 });
    expect(sendOrderOf(group, 2, [attempt(0, 'sentObserved'), attempt(1, 'sentObserved')])).toBeNull();
    expect(groupProgress(group, [attempt(0, 'sentObserved'), attempt(1, 'uncertain'), attempt(0, 'sentObserved', { attemptId: uuid(0x699) })])).toEqual({ sent: 1, total: 3 });
  });
});

describe('[X8-04] freshness and the served context (§6.7.5)', () => {
  it('[X8-04] property: monotonic counters — anything new is stale, a broken observation is unknown, nothing new is fresh', () => {
    const rnd = seeded(5);
    for (let run = 0; run < 500; run += 1) {
      const atGenerate = checkpointFor(WORLD.otherFan, { fanSequence: rnd.int(50) });
      const grew = rnd.int(3);
      const later: FreshnessCheckpoint = {
        ...atGenerate,
        fanSequence: atGenerate.fanSequence + grew,
        lastFanMessageId: grew === 0 ? atGenerate.lastFanMessageId : String(9000 + run),
        socketEpoch: rnd.chance(0.1) ? atGenerate.socketEpoch + 1 : atGenerate.socketEpoch,
        coverage: rnd.chance(0.1) ? 'unknown' : 'ok',
        observedAt: atGenerate.observedAt + rnd.int(60_000),
      };
      const verdict = compareCheckpoints(atGenerate, later);
      if (later.coverage !== 'ok' || later.socketEpoch !== atGenerate.socketEpoch) expect(verdict).toBe('unknown');
      else if (grew > 0) expect(verdict).toBe('stale');
      else expect(verdict).toBe('fresh');
    }
    expect(compareCheckpoints(checkpoint, { ...checkpoint, fanSequence: 1 })).toBe('unknown');
    expect(compareCheckpoints(checkpoint, { ...checkpoint, platformFanId: WORLD.fan })).toBe('unknown');
    expect(compareCheckpoints(checkpoint, { ...checkpoint, documentEpoch: 'doc-2' })).toBe('unknown');
    expect(compareCheckpoints(checkpoint, { ...checkpoint, lastFanMessageId: '4999' })).toBe('stale');
    expect([freshnessCode('fresh'), freshnessCode('stale'), freshnessCode('unknown')]).toEqual([null, 'CG-SEND-STALE', 'CG-SEND-FRESHNESS']);
  });

  it('[X8-04] the hold lifts only when the served context included every known id', () => {
    expect(servedContextHold(checkpoint, served)).toBeNull();
    expect(servedContextHold(undefined, served)).toBe('CG-SEND-FRESHNESS');
    expect(servedContextHold({ ...checkpoint, coverage: 'unknown' }, served)).toBe('CG-SEND-FRESHNESS');
    expect(servedContextHold({ ...checkpoint, knownFanMessageIds: [], lastFanMessageId: null }, null)).toBeNull();
    expect(servedContextHold(checkpoint, null)).toBe('CG-SEND-FRESHNESS');
    expect(servedContextHold(checkpoint, { ...served, source: null })).toBe('CG-SEND-FRESHNESS');
    expect(servedContextHold(checkpoint, { ...served, knownFanMessages: [{ id: WORLD.messages.fanLatest, state: 'included' }, { id: WORLD.messages.fanFirst, state: 'absent' }] })).toBe('CG-SEND-STALE');
    expect(servedContextHold(checkpoint, { ...served, knownFanMessages: [{ id: WORLD.messages.fanLatest, state: 'deleted' }] })).toBe('CG-SEND-STALE');
    expect(servedContextHold(checkpoint, { ...served, knownFanMessages: [{ id: WORLD.messages.fanLatest, state: 'unknown' }] })).toBe('CG-SEND-FRESHNESS');
    expect(servedContextHold(checkpoint, { ...served, knownFanMessages: [{ id: WORLD.messages.fanLatest, state: null }] })).toBe('CG-SEND-FRESHNESS');
  });
});

describe('[SP-054] [NF-019] the background send conditions (§6.7.4: 1–4, 14)', () => {
  it('[SP-054] a finished draft of the right surface, the frozen identity, the switches and freshness pass', () => {
    expect(beginCondition(beginOf(), opOf(), gate)).toBeNull();
  });

  it('[SP-054] [X8-03] [AU-024] [AU-028] each failed condition has its code, in table order', () => {
    expect(beginCondition(beginOf(), null, gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf(), opOf({ state: 'streaming' }), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf(), opOf({ feature: 'review' }), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf(), opOf({ surface: 'dock' }), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf({ group: { generationRef: GEN, variant: 0, partCount: 3 } }), opOf(), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf(), opOf({ result: { kind: 'review', doc: null, raw: 'x' } }), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf({ group: { generationRef: GEN, variant: 1, partCount: 2 }, part: { variant: 1, index: 0 } }), opOf(), gate)).toBe('CG-SEND-PART');
    expect(beginCondition(beginOf(), opOf({ generationRef: uuid(0x201) }), gate)).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf({ target: targetOf('2050'), checkpoint: checkpointFor('2050') }), opOf(), gate)).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, session: null })).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, session: { ...gate.session!, epoch: 4 } })).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, personaDefinitionId: WORLD.persona.otherDefinitionId })).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, bindingRevision: WORLD.pages.one.bindingRevision + 1 })).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, bindingRevision: null })).toBe('CG-CONTEXT-CHANGED');
    expect(beginCondition(beginOf(), opOf(), { ...gate, previewSend: false })).toBe('CG-SEND-OFF');
    expect(beginCondition(beginOf({ purpose: 'greeting' }), opOf({ surface: 'newcomers' }), { ...gate, newcomers: false })).toBe('CG-SEND-OFF');
    expect(beginCondition(beginOf(), opOf(), { ...gate, receiptProfiles: 0 })).toBe('CG-SEND-RECEIPT');
    expect(beginCondition(beginOf(), opOf({ checkpoint: undefined }), gate)).toBe('CG-SEND-FRESHNESS');
    expect(beginCondition(beginOf({ checkpoint: { ...checkpoint, fanSequence: 3 } }), opOf(), gate)).toBe('CG-SEND-FRESHNESS');
    expect(beginCondition(beginOf({ checkpoint: { ...checkpoint, observedAt: NOW_MS + 5000 } }), opOf(), gate)).toBeNull();
    expect(beginCondition(beginOf(), opOf({ stale: true }), gate)).toBe('CG-SEND-STALE');
    expect(beginCondition(beginOf(), opOf({ servedContext: undefined }), gate)).toBe('CG-SEND-FRESHNESS');
  });

  it('[NF-019] a Hi variant is a group of its own parts', () => {
    const hi = opOf({ feature: 'hi', surface: 'newcomers', result: { kind: 'variants', variants: [['a'], ['b', 'c']] } });
    expect(beginCondition(beginOf({ purpose: 'greeting', group: { generationRef: GEN, variant: 1, partCount: 2 }, part: { variant: 1, index: 1 } }), hi, gate)).toBeNull();
    expect(beginCondition(beginOf({ purpose: 'greeting', group: { generationRef: GEN, variant: 2, partCount: 1 }, part: { variant: 2, index: 0 } }), hi, gate)).toBe('CG-SEND-PART');
  });
});

describe('[X8-07] the attempt journal: no text, written first, restored without re-sending', () => {
  it('[X8-07] an entry is the contract record, carries no text, and only moves forward in time', () => {
    const entry = journalEntryOf(beginOf(), NOW_MS);
    expect(SendJournalEntrySchema.safeParse(entry).success).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/first|second/);
    const enqueued = journalWithView(entry, { attemptId: ATTEMPT, state: 'nativeEnqueued' }, NOW_MS + 10, 'pending-1');
    expect(enqueued).toMatchObject({ state: 'nativeEnqueued', pendingId: 'pending-1', updatedAt: NOW_MS + 10 });
    const late = journalWithView(enqueued, { attemptId: ATTEMPT, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: '4100' }, NOW_MS - 50, null);
    expect(late).toMatchObject({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: '4100', updatedAt: NOW_MS + 10, pendingId: 'pending-1' });
    expect('code' in journalWithView(late, { attemptId: ATTEMPT, state: 'sentObserved', platformMessageId: '4100' }, NOW_MS + 20)).toBe(false);
    expect(SendJournalEntrySchema.safeParse(late).success).toBe(true);
  });

  it('[X8-07] a damaged journal keeps its valid records and drops the rest and duplicates', () => {
    const entry = journalEntryOf(beginOf(), NOW_MS);
    expect(parseJournal([entry, entry, { attemptId: 'x' }, journalEntryOf(beginOf({ attemptId: uuid(0x501) }), NOW_MS)])).toEqual({
      entries: [entry, journalEntryOf(beginOf({ attemptId: uuid(0x501) }), NOW_MS)],
      dropped: 2,
    });
    expect(parseJournal(undefined)).toEqual({ entries: [], dropped: 0 });
    expect(parseJournal('garbage')).toEqual({ entries: [], dropped: 1 });
  });

  it('[X8-07] after a restart: uncertain stays, ended records age out, a possible queue call waits then turns uncertain', () => {
    const entry = journalEntryOf(beginOf(), NOW_MS);
    const ticketSec = 10;
    const prepUntil = silenceDeadline(entry, ticketSec);
    expect(prepUntil).toBe(NOW_MS + 10_000 + 2_000 + 5_000);
    expect(restoreAction(entry, NOW_MS + 1000, ticketSec)).toEqual({ kind: 'await', until: prepUntil });
    expect(restoreAction(entry, NOW_MS + 60_000, ticketSec)).toEqual({ kind: 'uncertain' });
    const enqueued = { ...entry, state: 'nativeEnqueued' as const };
    expect(silenceDeadline(enqueued, ticketSec)).toBe(NOW_MS + 35_000);
    expect(restoreAction({ ...entry, state: 'uncertain' }, NOW_MS + 86_400_000, ticketSec)).toEqual({ kind: 'keep' });
    expect(restoreAction({ ...entry, state: 'sentObserved' }, NOW_MS + 60_000, ticketSec)).toEqual({ kind: 'keep' });
    expect(restoreAction({ ...entry, state: 'held' }, NOW_MS + 31 * 60_000, ticketSec)).toEqual({ kind: 'drop' });
    expect(restoreAction({ ...entry, state: 'ready' }, NOW_MS, ticketSec)).toEqual({ kind: 'drop' });
    for (const s of ['ready', 'held', 'notEnqueued', 'sentObserved', 'rejected', 'uncertain'] as const) expect(silenceDeadline({ state: s, updatedAt: NOW_MS }, ticketSec)).toBeNull();
    expect(SEND_ATTEMPT_TRANSITIONS.uncertain).toEqual(['sentObserved']);
  });
});
