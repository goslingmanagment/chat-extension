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
  type SendJournalEntry,
  SendListItemSchema,
  STORAGE_KEYS,
  sendLockKey,
  type ClaimBody,
  type ClaimState,
  type CustodyState,
  type FreshnessCheckpoint,
  type OpView,
  type SendAttemptView,
  type SendBegin,
  type ServedContext,
} from '@cg/contracts';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, LATE_PAIR_LISTEN_MS, PreviewSendDriver, type BackgroundSendPort, type SendClick } from '@cg/core/services';
import { SendCoordinator } from '@cg/core/services/custody';
import { FakeHostPort, memory, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, HTTP_SCENARIOS, resolveHubErrorReference } from '@cg/testing/hub';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { FakeHub, type ClaimAnswer } from './support/fake-hub';
import { ScenarioHub } from './support/scenario-hub';
import { featuresOf } from './support/features';
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
  /** The checkpoint the operation was generated with (forSend). */
  opCheckpoint: FreshnessCheckpoint;
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
    env: { session, bootstrap: withX8(BOOTSTRAP_PILOT_PAGES), persona: () => persona, debug: false, settingsLoaded: true, features: featuresOf },
    opCheckpoint: checkpoint,
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
          checkpoint: h.opCheckpoint,
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
  h.coordinator.report(TAB, { attemptId: uuid(attempt === 'a' ? 0x500 : Number.parseInt(attempt, 16)), state, ...extra }, pendingId);

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

  it('[X53] a part with media: their two marks go to the journal and, once sent, to who sent it — after a restart too; never the media', async () => {
    const store = new MemoryStore();
    const clock = new FakeClock(NOW_MS);
    const h = sendHarness({ clock, store });
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin({ marks: { priced: true, withMedia: true } }));
    expect(await report(h, 'a', 'nativeEnqueued', {}, 'pending-1')).toBe(true);
    const journal = store.data.get(STORAGE_KEYS.sendJournal) as SendJournalEntry[];
    expect(journal[0]?.marks).toEqual({ priced: true, withMedia: true });
    expect(SendJournalEntrySchema.safeParse(journal[0]).success).toBe(true);
    // The event page unloads before the receipt; the next instance reports who sent it with the same marks.
    const second = sendHarness({ clock, store });
    second.hub.claimScript.push(okAnswer(A, 'sent'));
    await second.coordinator.restore();
    expect(await report(second, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    expect(await report(second, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    await second.coordinator.idle();
    expect(second.sent).toMatchObject([{ attemptId: A, priced: true, withMedia: true }]);
    // Whether the person edited the part is not journaled: a restored attempt does not guess it.
    expect(second.sent[0]).not.toHaveProperty('edited');
  });

  it('a part the person edited before the send goes to who sent it as edited; a restored attempt says nothing of it', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin({ textRevision: 1 }));
    expect(await report(h, 'a', 'nativeEnqueued', {}, 'pending-1')).toBe(true);
    expect(await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    expect(await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    await h.coordinator.idle();
    expect(h.sent).toMatchObject([{ attemptId: A, edited: true }]);
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
    // With its page and fan: who sent the message is the background's to record (decision X48).
    expect(h.sent).toEqual([{ attemptId: A, opId: OP, purpose: 'preview-reply', part: 0, variant: 0, generationRef: GEN, platformMessageId: WORLD.messages.sentByUs, pageId: previewTarget.binding.pageId, fanRef: previewTarget.fanRef, priced: false, withMedia: false, edited: false }]);
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

  it('[AI-120] [SP-054] [AU-024] refusals before the journal: no token, the background conditions; nothing reaches the hub', async () => {
    const h = sendHarness();
    const forged = await h.coordinator.begin(TAB, { ...h.begin(), cause: { kind: 'click', actionToken: 'tok_forged_00000000000' } });
    expect(forged).toEqual({ ok: false, view: { attemptId: A, state: 'held', code: 'CG-SEND-PART' } });
    h.ops.set(OP, doneView({ stale: { reason: 'fan-wrote', at: null } }));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), previewRevision: 1 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-STALE' } });
    h.ops.set(OP, doneView());
    h.env = { ...h.env, bootstrap: BOOTSTRAP_PILOT_PAGES };
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502), previewRevision: 2 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-OFF' } });
    // Another persona of the page (an owner's edit of the same one — another definition, the same key — is no other).
    h.env = { ...h.env, bootstrap: withX8(BOOTSTRAP_PILOT_PAGES), persona: () => ({ key: 'second', definitionId: WORLD.persona.otherDefinitionId }) };
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x503), previewRevision: 3 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-CONTEXT-CHANGED' } });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x504), opId: uuid(0x199), previewRevision: 4 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-PART' } });
    h.env = { ...h.env, persona: () => persona, bootstrap: { ...withX8(BOOTSTRAP_PILOT_PAGES), pages: withX8(BOOTSTRAP_PILOT_PAGES).pages.map((p) => ({ ...p, bindingRevision: p.bindingRevision + 1 })) } };
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x505), previewRevision: 5 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-CONTEXT-CHANGED' } });
    expect(h.hub.claims).toHaveLength(0);
    expect(h.store.writes).toBe(0);
    expect(await h.coordinator.report(TAB, { attemptId: A, state: 'nativeEnqueued' })).toBe(false);
    expect(await h.coordinator.report(TAB, { attemptId: uuid(0xdead), state: 'nativeEnqueued' })).toBe(false);
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

  it('[SP-054] MAIN held or notEnqueued: custody hears not_enqueued; a queue refusal may be clicked again, a stale hold only by «Отправить всё равно»', async () => {
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
    // The person read the fan's new message and passed the warning (2026-10-20 audit, row 3): a new attempt, its own dispatch.
    h.hub.claimScript.push(ticketFor(uuid(0x503)));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x503), acceptFreshness: true }))).toMatchObject({ ok: true, ticket: { attemptId: uuid(0x503) } });
    expect(actions(h)).toEqual(['dispatch', 'failed:not_enqueued', 'dispatch', 'failed:not_enqueued', 'dispatch']);
  });

  it('[X8-04] the background’s own stale hold: a plain click of the part still holds, «Отправить всё равно» is dispatched (2026-10-23 audit)', async () => {
    const h = sendHarness();
    h.ops.set(OP, doneView({ stale: { reason: 'fan-wrote', at: null } }));
    const stale = { ok: false, view: { attemptId: A, state: 'held', code: 'CG-SEND-STALE' } };
    expect(await h.coordinator.begin(TAB, h.begin())).toEqual(stale);
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501) }))).toEqual(stale);
    expect(h.hub.claims).toHaveLength(0);
    h.hub.claimScript.push(ticketFor(uuid(0x502)));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502), acceptFreshness: true }))).toMatchObject({ ok: true, ticket: { attemptId: uuid(0x502) } });
    expect(actions(h)).toEqual(['dispatch']);
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

  it('[NF-022] [RB-007] uncertain reports nothing and is never repeated by itself; the person may send the part again; the late linked pair still ends it as sent (audit 2026-10-20, row 2)', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'uncertain', { code: 'CG-SEND-UNCERTAIN', platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch']);
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 1 });
    // The same part, the person's own new click: a new attempt and its own dispatch; the fan is not held.
    h.hub.claimScript.push(ticketFor(uuid(0x502)));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502) }))).ok).toBe(true);
    expect(h.hub.claims.filter((c) => c.body.action === 'dispatch')).toHaveLength(2);
    // The late echo of the first one with the same id completes its linked pair.
    h.hub.claimScript.push(okAnswer(A, 'sent'));
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(h.coordinator.status(A)?.state).toBe('sentObserved');
  });

  it('[X8-09] a click inside another send’s ticket is refused by the hub (`custody_held`) and holds nothing: the next click past the ticket is dispatched, and the unknown outcome stays as it is (2026-10-23 audit)', async () => {
    const h = sendHarness();
    // The hub as it decides (client-claim-transition.ts): A's custody is in flight for its ticket, unknown after it.
    const ticketEnd = NOW_MS + 10_000;
    h.hub.claimStatus = (pageLabel, fanRef) => {
      h.hub.statusReads.push({ pageLabel, fanRef });
      return Promise.resolve(claim({ attemptId: A, state: h.clock.now() < ticketEnd ? 'dispatching' : 'uncertain-held' }));
    };
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    // ChatSpace's POST answers 5xx at once: A's outcome is unknown well inside its ticket.
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'uncertain', { code: 'CG-SEND-UNCERTAIN' });
    // «Отправить ещё раз» of part 1 and «Отправить» of part 2 inside the ticket: one dispatch each, each refused.
    const custodyHeld: ClaimAnswer = { kind: 'http', status: 409, error: 'custody_held' };
    h.hub.claimScript.push(custodyHeld, custodyHeld);
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501) }))).toEqual({ ok: false, view: { attemptId: uuid(0x501), state: 'held', code: 'CG-SEND-UNCERTAIN' } });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502), part: { index: 1 } }))).toEqual({ ok: false, view: { attemptId: uuid(0x502), state: 'held', code: 'CG-SEND-UNCERTAIN' } });
    await h.coordinator.idle();
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 1 });
    // Nothing moves by itself while the person waits.
    await h.clock.advance(10_000);
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'dispatch', 'dispatch']);
    // Past the ticket the next click of each part is dispatched as usual: the hub sets A aside then.
    h.hub.claimScript.push(ticketFor(uuid(0x503)), okAnswer(uuid(0x503), 'sent'));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x503) }))).toMatchObject({ ok: true, ticket: { attemptId: uuid(0x503) } });
    await report(h, '503', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, '503', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    h.hub.claimScript.push(ticketFor(uuid(0x504)));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x504), part: { index: 1 } }))).toMatchObject({ ok: true, ticket: { attemptId: uuid(0x504) } });
    await h.coordinator.idle();
    // One dispatch per click and nothing else; A was never sent again, and is still unknown.
    expect(actions(h)).toEqual(['dispatch', 'dispatch', 'dispatch', 'dispatch', 'sent', 'dispatch']);
    expect(h.coordinator.status(A)).toEqual({ attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
  });

  it('[NF-022] `send.list`: a tab that lost its tracking reads the fan’s journaled attempts back — after a restart too; a resolved one and one that never reached the journal are not listed', async () => {
    const lock = sendLockKey({ hubOrigin: previewTarget.binding.hubOrigin, pageId: previewTarget.binding.pageId, platform: previewTarget.binding.platform, fanRef: previewTarget.fanRef });
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const h = sendHarness({ clock, store });
    expect(h.coordinator.attemptsOf(lock)).toEqual({ attempts: [], truncated: false });
    // Part 0 is proven sent, part 1 ends with an unknown outcome.
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    await clock.advance(1000);
    const B = uuid(0x501);
    h.hub.claimScript.push(ticketFor(B));
    await h.coordinator.begin(TAB, h.begin({ attemptId: B, part: { index: 1 } }));
    await h.coordinator.report(TAB, { attemptId: B, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    // A click refused before the journal (no token) reached nothing.
    await h.coordinator.begin(TAB, { ...h.begin({ attemptId: uuid(0x502), part: { index: 1 }, previewRevision: 3 }), cause: { kind: 'click', actionToken: 'stale-token-000000000000' } });
    await h.coordinator.idle();
    const group = { generationRef: GEN, variant: 0, partCount: 2 };
    const listed = h.coordinator.attemptsOf(lock);
    // The one that holds the fan comes first.
    expect(listed).toEqual({
      attempts: [
        { opId: OP, purpose: 'preview-reply', group, partIndex: 1, view: { attemptId: B, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' }, updatedAt: NOW_MS + 1000 },
        { opId: OP, purpose: 'preview-reply', group, partIndex: 0, view: { attemptId: A, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs }, updatedAt: NOW_MS },
      ],
      truncated: false,
    });
    for (const item of listed.attempts) expect(SendListItemSchema.safeParse(item).success).toBe(true);
    expect(JSON.stringify(listed)).not.toContain('part text');
    expect(h.coordinator.attemptsOf(lock, 1)).toMatchObject({ attempts: [{ view: { attemptId: B } }], truncated: true });
    expect(h.coordinator.attemptsOf(sendLockKey({ hubOrigin: previewTarget.binding.hubOrigin, pageId: previewTarget.binding.pageId, platform: previewTarget.binding.platform, fanRef: '9999' })).attempts).toEqual([]);
    // The event page unloads; the next instance answers the same from the journal.
    const second = sendHarness({ clock, store });
    second.hub.statusScript.push(okAnswer(B, 'uncertain-held'));
    await second.coordinator.restore();
    expect(second.coordinator.attemptsOf(lock).attempts.map((item) => [item.partIndex, item.view.state])).toEqual([[1, 'uncertain'], [0, 'sentObserved']]);
    // The hub resolved the uncertain one: it no longer holds the fan, and the list says how it was resolved.
    second.hub.statusScript.push(okAnswer(B, 'resolved-not-sent'));
    await clock.advance(1000);
    await second.coordinator.reconcileFan(lock);
    expect(second.coordinator.attemptsOf(lock).attempts.map((item) => [item.view.attemptId, item.resolved])).toEqual([[B, 'not-sent'], [A, undefined]]);
    // A background that restarts after the resolve no longer knows the attempt at all.
    const third = sendHarness({ clock, store });
    await third.coordinator.restore();
    expect(third.coordinator.attemptsOf(lock).attempts.map((item) => item.view.attemptId)).toEqual([A]);
  });

  it('[TL-004] §6.6 a part the person sent from the composer is journaled as delivered: `send.list` names it, the tabs hear it, the next part of the group may go — and nothing is dispatched, locked or reported for it', async () => {
    const lock = sendLockKey({ hubOrigin: previewTarget.binding.hubOrigin, pageId: previewTarget.binding.pageId, platform: previewTarget.binding.platform, fanRef: previewTarget.fanRef });
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const h = sendHarness({ clock, store });
    const N = uuid(0x600);
    const group = { generationRef: GEN, variant: 0, partCount: 2 };
    const sentView = { attemptId: N, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs } as const;
    expect(h.coordinator.nativeSent({ attemptId: N, view: doneView(), part: { index: 0 }, platformMessageId: WORLD.messages.sentByUs })).toEqual(sentView);
    await h.coordinator.idle();
    // A fact about what the person did: the hub was asked nothing, no lock is held, no preview-send telemetry is told.
    expect(h.hub.claims).toEqual([]);
    expect(h.hub.statusReads).toEqual([]);
    expect(h.sent).toEqual([]);
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 0 });
    expect(h.events.of('send.state')).toEqual([{ to: null, payload: { view: sentView } }]);
    const listed = h.coordinator.attemptsOf(lock);
    expect(listed).toEqual({ attempts: [{ opId: OP, purpose: 'preview-reply', group, partIndex: 0, view: sentView, updatedAt: NOW_MS }], truncated: false });
    expect(SendListItemSchema.safeParse(listed.attempts[0]).success).toBe(true);
    const journal = store.data.get(STORAGE_KEYS.sendJournal) as unknown[];
    expect(journal).toHaveLength(1);
    expect(SendJournalEntrySchema.safeParse(journal[0]).success).toBe(true);
    expect(journal[0]).toMatchObject({ attemptId: N, state: 'sentObserved', partIndex: 0, platformMessageId: WORLD.messages.sentByUs, documentEpoch: 'native-send' });
    expect(JSON.stringify(journal)).not.toContain('part text');
    // The tab says it again (its first report was never acknowledged): the same record, no second one, no second event.
    expect(h.coordinator.nativeSent({ attemptId: uuid(0x601), view: doneView(), part: { index: 0 }, platformMessageId: WORLD.messages.sentByUs })).toEqual(sentView);
    expect(h.coordinator.attemptsOf(lock).attempts).toHaveLength(1);
    expect(h.events.of('send.state')).toHaveLength(1);
    // X8 never sends that part a second time — by a click of any preview revision — and nothing reaches the hub for the click.
    expect(await h.coordinator.begin(TAB, h.begin())).toEqual({ ok: false, view: sentView });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x502), previewRevision: 4 }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-PART' } });
    expect(h.hub.claims).toEqual([]);
    await h.coordinator.idle();
    // The event page unloads: the next instance still knows the part is delivered, and asks the hub nothing about it.
    const second = sendHarness({ clock, store });
    await second.coordinator.restore();
    expect(second.coordinator.attemptsOf(lock).attempts).toEqual([{ opId: OP, purpose: 'preview-reply', group, partIndex: 0, view: sentView, updatedAt: NOW_MS }]);
    expect(second.hub.claims).toEqual([]);
    expect(second.hub.statusReads).toEqual([]);
    expect(await second.coordinator.begin(TAB, second.begin())).toEqual({ ok: false, view: sentView });
    // The next part of the group is free to go: by its own click, with its own dispatch.
    second.hub.claimScript.push(ticketFor(uuid(0x503)), okAnswer(uuid(0x503), 'failed'));
    expect((await second.coordinator.begin(TAB, second.begin({ attemptId: uuid(0x503), part: { index: 1 } }))).ok).toBe(true);
    await second.coordinator.report(TAB, { attemptId: uuid(0x503), state: 'held', code: 'CG-SEND-HOST' });
    await second.coordinator.idle();
    expect(actions(second)).toEqual(['dispatch', 'failed:not_enqueued']);
    // It ages out with the results, like any ended record.
    await clock.advance(31 * 60_000);
    const third = sendHarness({ clock, store });
    await third.coordinator.restore();
    expect(third.coordinator.attemptsOf(lock).attempts).toEqual([]);
  });

  it('[TL-004] §6.6 a part an X8 attempt already delivered is not recorded twice; an unknown outcome of that part still holds the fan', async () => {
    const lock = sendLockKey({ hubOrigin: previewTarget.binding.hubOrigin, pageId: previewTarget.binding.pageId, platform: previewTarget.binding.platform, fanRef: previewTarget.fanRef });
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeEnqueued', {}, 'p');
    await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    expect(h.coordinator.nativeSent({ attemptId: uuid(0x600), view: doneView(), part: { index: 0 }, platformMessageId: WORLD.messages.fanLatest })).toMatchObject({ attemptId: A, state: 'sentObserved' });
    expect(h.coordinator.attemptsOf(lock).attempts.map((item) => item.view.attemptId)).toEqual([A]);
    // Part 1 went through X8 and its outcome is unknown; the person then sent it by hand. Both are known, and the fan stays held.
    const B = uuid(0x501);
    h.hub.claimScript.push(ticketFor(B));
    await h.coordinator.begin(TAB, h.begin({ attemptId: B, part: { index: 1 } }));
    await h.coordinator.report(TAB, { attemptId: B, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(h.coordinator.nativeSent({ attemptId: uuid(0x601), view: doneView(), part: { index: 1 }, platformMessageId: WORLD.messages.fanFirst })).toMatchObject({ attemptId: uuid(0x601), state: 'sentObserved' });
    expect(h.coordinator.counts()).toEqual({ open: 0, uncertain: 1 });
    expect(h.coordinator.attemptsOf(lock).attempts.map((item) => [item.partIndex, item.view.state])).toEqual([[1, 'uncertain'], [0, 'sentObserved'], [1, 'sentObserved']]);
  });

  it('[X8-01] a stale token does not burn the part; after a hub resolve «not sent» the same part may be clicked again', async () => {
    const h = sendHarness();
    expect(await h.coordinator.begin(TAB, { ...h.begin(), cause: { kind: 'click', actionToken: 'tok_expired_0000000000' } })).toMatchObject({ ok: false, view: { code: 'CG-SEND-PART' } });
    h.hub.claimScript.push(ticketFor(uuid(0x501)));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501) }))).ok).toBe(true);
    await report(h, '501', 'uncertain', { code: 'CG-SEND-UNCERTAIN' });
    // Another part goes at once: an unknown outcome holds nothing (row 2).
    h.hub.claimScript.push(ticketFor(uuid(0x503)));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x503), part: { index: 1 } }))).ok).toBe(true);
    h.hub.claimScript.push(okAnswer(uuid(0x503), 'failed'));
    await report(h, '503', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await h.coordinator.idle();
    h.hub.claimScript.push(ticketFor(uuid(0x504)));
    expect((await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x504) }))).ok).toBe(true);
  });

  it('[NF-022] a ticket that is never reported turns uncertain after its deadline, and nothing is sent again', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    // The ticket's own deadline (9 s on the local clock), the bridge's answer time (2 s), then grace (5 s).
    await h.clock.advance(9_000 + 2_000 + 5_000 - 1);
    expect(h.coordinator.status(A)?.state).toBe('preparing');
    await h.clock.advance(1);
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
    expect(g.log.entries.some((e) => e.msg === 'custody report refused')).toBe(true);
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
    if (boundary === 'after-journal') {
      second.hub.statusScript.push({ kind: 'ok', state: claim(null) });
      second.hub.claimScript.push({ kind: 'http', status: 409, error: 'custody_not_owned' });
    }
    else second.hub.statusScript.push(okAnswer(A, 'dispatching'));
    await second.coordinator.restore();
    return { second, host, first };
  }

  it('[X8-07] journal written, dispatch never answered: the hub has no custody of it → held, the fan is free, the hub hears not_enqueued', async () => {
    const { second } = await crashAt('after-journal');
    await second.coordinator.idle();
    expect(second.coordinator.status(A)).toEqual({ attemptId: A, state: 'held', code: 'CG-RUNTIME-RELOADED' });
    // No ticket ever reached the dead background, so MAIN was never called: an idempotent not_enqueued closes a dispatch that lands late.
    expect(actions(second)).toEqual(['failed:not_enqueued']);
    second.hub.claimScript.push(ticketFor(uuid(0x501)));
    expect((await second.coordinator.begin(TAB, second.begin({ attemptId: uuid(0x501) }))).ok).toBe(true);
  });

  it('[X8-07] dispatch opened a custody but its answer was lost: wait, then uncertain; never re-dispatched or re-sent', async () => {
    const { second } = await crashAt('dispatch-answer-lost');
    expect(second.coordinator.status(A)?.state).toBe('preparing');
    await second.clock.advance(20_000);
    expect(second.coordinator.status(A)?.state).toBe('uncertain');
    // Nothing is dispatched or sent again by itself.
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

describe('[X8-07] [X8-08] [NF-022] reports: from the owning tab, once, durable', () => {
  const OTHER_TAB = uuid(0xa2);
  const settleAll = async (h: SendHarness): Promise<void> => {
    await h.clock.advance(1);
  };

  it('[X8-07] a report from another tab session changes nothing; a restored attempt follows the first tab that reports it', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
    await h.coordinator.begin(TAB, h.begin());
    // Another tab knows the attemptId from send.state, but cannot release the fan.
    expect(await h.coordinator.report(OTHER_TAB, { attemptId: A, state: 'held', code: 'CG-SEND-STALE' })).toBe(false);
    expect(h.coordinator.status(A)?.state).toBe('preparing');
    expect(h.coordinator.counts().open).toBe(1);
    expect(actions(h)).toEqual(['dispatch']);
    expect(h.log.entries.some((e) => e.msg === 'send report from another tab session ignored')).toBe(true);

    // After a restart the sessions are new: the first tab that reports the restored attempt owns it.
    await report(h, 'a', 'nativeEnqueued', {}, 'p-1');
    await h.coordinator.idle();
    const second = sendHarness({ clock: h.clock, store: h.store });
    second.hub.statusScript.push(okAnswer(A, 'dispatching'));
    await second.coordinator.restore();
    const TAB2 = uuid(0xa3);
    expect(await second.coordinator.report(TAB2, { attemptId: A, state: 'nativeAccepted', platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    expect(await second.coordinator.report(OTHER_TAB, { attemptId: A, state: 'rejected', httpStatus: 422 })).toBe(false);
    expect(second.coordinator.status(A)?.state).toBe('nativeAccepted');
  });

  it('[NF-022] one report cannot stand in for both halves of the pair: uncertain needs a receipt linked by an earlier report', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'uncertain', { code: 'CG-SEND-UNCERTAIN' });
    expect(await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs })).toBe(false);
    expect(h.coordinator.status(A)?.state).toBe('uncertain');
    // The receipt first (its own report), then the echo with the same id.
    expect(await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    expect(await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentPart2 })).toBe(false);
    h.hub.claimScript.push(okAnswer(A, 'sent'));
    expect(await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs })).toBe(true);
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'sent']);
  });

  it('[X8-08] exactly one custody report per attempt, however many reports and reconciles follow', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await report(h, 'a', 'rejected', { httpStatus: 422 });
    await h.coordinator.idle();
    // A stale custody read (the hub still says dispatching) does not make a second report.
    h.hub.statusScript.push(okAnswer(A, 'dispatching'));
    await h.coordinator.reconcileFan(sendLockKey({ hubOrigin: previewTarget.binding.hubOrigin, pageId: previewTarget.binding.pageId, platform: previewTarget.binding.platform, fanRef: previewTarget.fanRef }));
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'sent']);
    // Nor does a dispatch answer that still names A's custody: the hub already answered A's report.
    h.hub.claimScript.push({ kind: 'ok', state: claim({ attemptId: A, state: 'dispatching' }) });
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: 1 } }))).toMatchObject({ ok: false, view: { code: 'CG-SEND-UNCERTAIN' } });
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', 'sent', 'dispatch']);
  });

  it('[X8-08] a report the hub does not answer repeats with the same attemptId: `sent` for long, `failed` only within the ticket', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), ...Array.from({ length: 6 }, () => ({ kind: 'transport', failure: 'network' }) as const), { kind: 'http', status: 503, error: 'service_unavailable' }, okAnswer(A, 'sent'));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await h.clock.advance(5 * 60_000);
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', ...Array.from({ length: 8 }, () => 'sent')]);
    expect(new Set(h.hub.claims.slice(1).map((c) => (c.body as { attemptId: string }).attemptId))).toEqual(new Set([A]));

    const g = sendHarness();
    g.hub.claimScript.push(ticketFor(A), ...Array.from({ length: 10 }, () => ({ kind: 'transport', failure: 'timeout' }) as const));
    await g.coordinator.begin(TAB, g.begin());
    await report(g, 'a', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await g.clock.advance(5 * 60_000);
    await g.coordinator.idle();
    // 0, 1, 3, 7 and 15 s: the next pause would end after the ticket (9 s) + the bridge (2 s) + grace (5 s).
    expect(actions(g)).toEqual(['dispatch', ...Array.from({ length: 5 }, () => 'failed:not_enqueued')]);
    expect(g.log.entries.some((e) => e.msg === 'custody report not delivered')).toBe(true);
  });

  it('[X8-07] a `sent` report lost in the unload is sent again after the restore while the custody still waits', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = sendHarness({ clock, store });
    first.hub.claimScript.push(ticketFor(A), { kind: 'hang' });
    await first.coordinator.begin(TAB, first.begin());
    await report(first, 'a', 'nativeAccepted', { platformMessageId: WORLD.messages.sentByUs });
    await report(first, 'a', 'sentObserved', { platformMessageId: WORLD.messages.sentByUs });
    await settleAll(first);
    expect(actions(first)).toEqual(['dispatch', 'sent']);
    // Unload mid-request. The new instance reads the custody and owes the report again.
    const second = sendHarness({ clock, store });
    second.hub.statusScript.push(okAnswer(A, 'uncertain-held'));
    second.hub.claimScript.push(okAnswer(A, 'sent'));
    await second.coordinator.restore();
    await second.coordinator.idle();
    expect(second.hub.statusReads).toHaveLength(1);
    expect(second.hub.claims.map((c) => c.body)).toEqual([{ action: 'sent', attemptId: A, instanceId: WORLD.instanceId, platformMessageId: WORLD.messages.sentByUs, evidence: 'receipt+echo' }]);
    // A custody that already heard it: nothing more.
    const third = sendHarness({ clock, store });
    third.hub.statusScript.push(okAnswer(A, 'sent'));
    await third.coordinator.restore();
    await third.coordinator.idle();
    expect(third.hub.claims).toHaveLength(0);
  });

  it('[X8-07] a not_enqueued lost in the unload goes again only while the hub can take it', async () => {
    for (const [custody, later, expected] of [
      ['dispatching', 0, ['failed:not_enqueued']],
      ['uncertain-held', 0, []],
      ['dispatching', 60_000, []],
    ] as const) {
      const clock = new FakeClock(NOW_MS);
      const store = new MemoryStore();
      const first = sendHarness({ clock, store });
      first.hub.claimScript.push(ticketFor(A), { kind: 'hang' });
      await first.coordinator.begin(TAB, first.begin());
      await report(first, 'a', 'held', { code: 'CG-SEND-STALE' });
      await settleAll(first);
      await clock.advance(later);
      const second = sendHarness({ clock, store });
      second.hub.statusScript.push(okAnswer(A, custody));
      second.hub.claimScript.push(okAnswer(A, 'failed'));
      await second.coordinator.restore();
      await second.coordinator.idle();
      expect({ custody, later, claims: actions(second), reads: second.hub.statusReads.length }).toEqual({ custody, later, claims: [...expected], reads: later === 0 ? 1 : 0 });
    }
  });

  it('[X8-07] a journal restored before the first bootstrap waits for it: no reads, no reports, then both', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = sendHarness({ clock, store });
    first.hub.claimScript.push(ticketFor(A));
    await first.coordinator.begin(TAB, first.begin());
    await report(first, 'a', 'nativeEnqueued', {}, 'p-1');
    await first.coordinator.idle();
    const second = sendHarness({ clock, store });
    const bootstrap = second.env.bootstrap;
    second.env = { ...second.env, bootstrap: null };
    await second.coordinator.restore();
    expect(second.hub.statusReads).toHaveLength(0);
    await second.coordinator.report(TAB, { attemptId: A, state: 'nativeAccepted', platformMessageId: WORLD.messages.sentByUs });
    await second.coordinator.report(TAB, { attemptId: A, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs });
    await second.coordinator.idle();
    expect(second.coordinator.status(A)?.state).toBe('sentObserved');
    expect(second.hub.claims).toHaveLength(0);
    // The bootstrap arrives: the custody is read and the owed `sent` goes.
    second.env = { ...second.env, bootstrap };
    second.hub.statusScript.push(okAnswer(A, 'dispatching'));
    second.hub.claimScript.push(okAnswer(A, 'sent'));
    await second.coordinator.bootstrapChanged();
    await second.coordinator.idle();
    expect(actions(second)).toEqual(['sent']);
    expect(second.hub.statusReads).toHaveLength(1);
    await second.coordinator.bootstrapChanged();
    expect(second.hub.statusReads).toHaveLength(1);
  });

  it('[X8-09] a dispatch refused by our own stale custody sends that attempt\'s owed report again', async () => {
    const h = sendHarness();
    h.hub.claimScript.push(ticketFor(A), ...Array.from({ length: 5 }, () => ({ kind: 'transport', failure: 'network' }) as const));
    await h.coordinator.begin(TAB, h.begin());
    await report(h, 'a', 'notEnqueued', { code: 'CG-SEND-QUEUE' });
    await h.clock.advance(60_000);
    await h.coordinator.idle();
    expect(actions(h)).toEqual(['dispatch', ...Array.from({ length: 5 }, () => 'failed:not_enqueued')]);
    // The hub still holds A as dispatching: the next part's dispatch is refused because of it.
    h.hub.claimScript.push({ kind: 'ok', state: claim({ attemptId: A, state: 'dispatching' }) }, okAnswer(A, 'failed'));
    expect(await h.coordinator.begin(TAB, h.begin({ attemptId: uuid(0x501), part: { index: 1 } }))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-UNCERTAIN' } });
    await h.coordinator.idle();
    expect(actions(h).slice(-2)).toEqual(['dispatch', 'failed:not_enqueued']);
  });

  it('[NF-022] the silence after a ticket counts from the ticket\'s own deadline, not the bootstrap\'s figure', async () => {
    const h = sendHarness();
    const longTicket: ClaimState = { ...claim({ attemptId: A, state: 'dispatching', ticket: 'tkt-long' }), custody: { attemptId: A, state: 'dispatching', ticket: 'tkt-long', ticketExpiresAt: at(60) } };
    h.hub.claimScript.push({ kind: 'ok', state: longTicket });
    const begun = await h.coordinator.begin(TAB, h.begin());
    expect(begun).toMatchObject({ ok: true, ticket: { expiresAt: NOW_MS + 59_000 } });
    await h.clock.advance(59_000 + 2_000 + 5_000 - 1);
    expect(h.coordinator.status(A)?.state).toBe('preparing');
    await h.clock.advance(1);
    expect(h.coordinator.status(A)?.state).toBe('uncertain');
  });
});

describe('[X8-08] [X8-09] [NF-019] the coordinator against the shared hub claim scenarios (@cg/testing HTTP_SCENARIOS)', () => {
  const LEASE = uuid(0x300);
  const newFanCheckpoint = checkpointFor(WORLD.newFan);
  const fanCheckpoint = checkpointFor(WORLD.fan);

  function scenarioHarness(name: string): { readonly hub: ScenarioHub; readonly clock: FakeClock; readonly make: () => SendHarness } {
    const scenario = HTTP_SCENARIOS.find((s) => s.name === name);
    if (scenario === undefined) throw new Error(name);
    const clock = new FakeClock(NOW_MS);
    const hub = new ScenarioHub(clock, scenario.exchanges);
    return { hub, clock, make: () => sendHarness({ clock, hub }) };
  }

  /** A greeting operation (Hi in «Новые») of `generationRef` to the new fan, two parts. */
  function greetingOp(h: SendHarness, generationRef = GEN): void {
    h.ops.set(OP, doneView({ feature: 'hi', surface: 'newcomers', target: targetOf(WORLD.newFan), generationRef, result: { kind: 'variants', variants: [['hello there', 'how are you']] } }));
    h.opCheckpoint = newFanCheckpoint;
  }
  const greet = (h: SendHarness, attemptId: string, partIndex: number, generationRef = GEN): SendBegin =>
    h.begin({
      attemptId,
      target: targetOf(WORLD.newFan),
      purpose: 'greeting',
      group: { generationRef, variant: 0, partCount: 2 },
      part: { index: partIndex },
      textRevision: 1,
      checkpoint: newFanCheckpoint,
      documentEpoch: newFanCheckpoint.documentEpoch,
      leaseToken: LEASE,
    });

  /** Plays the script's next exchange from the test: a call another component (the «Новые» lease, another client) makes. */
  async function outside(hub: ScenarioHub): Promise<ClaimState | 'refused'> {
    const next = hub.peek();
    if (next === null) throw new Error('script over');
    const request = next.request as { pageLabel: string; fanRef: string; body?: ClaimBody };
    try {
      return next.route === 'clientFanClaim' ? await hub.claim(request as Parameters<ScenarioHub['claim']>[0]) : await hub.claimStatus(request.pageLabel, request.fanRef);
    } catch {
      return 'refused';
    }
  }

  it('[NF-019] claim-greeting-two-parts: two parts, each one dispatch and one `sent`; a repeated click never dispatches again', async () => {
    const { hub, make } = scenarioHarness('claim-greeting-two-parts');
    const h = make();
    greetingOp(h);
    await outside(hub); // the card reads the claim
    await outside(hub); // lease claim
    await outside(hub); // lease renew
    const a = uuid(0x401);
    const b = uuid(0x402);
    expect(await h.coordinator.begin(TAB, greet(h, a, 0))).toMatchObject({ ok: true, ticket: { attemptId: a, ticket: 'tkt-once-a' } });
    await h.coordinator.report(TAB, { attemptId: a, state: 'nativeAccepted', platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.report(TAB, { attemptId: a, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs });
    await h.coordinator.idle();
    expect(await h.coordinator.begin(TAB, greet(h, b, 1))).toMatchObject({ ok: true, ticket: { attemptId: b, ticket: 'tkt-once-b' } });
    await h.coordinator.report(TAB, { attemptId: b, state: 'nativeAccepted', platformMessageId: WORLD.messages.sentPart2 });
    await h.coordinator.report(TAB, { attemptId: b, state: 'sentObserved', platformMessageId: WORLD.messages.sentPart2 });
    await h.coordinator.idle();
    // The same attempt asking again gets its view from the background, never a second dispatch.
    expect(await h.coordinator.begin(TAB, greet(h, b, 1))).toEqual({ ok: false, view: { attemptId: b, state: 'sentObserved', platformMessageId: WORLD.messages.sentPart2 } });
    expect(hub.peek()?.request).toMatchObject({ body: { action: 'dispatch', attemptId: b } });
    expect(await outside(hub)).toMatchObject({ custody: { attemptId: b, state: 'sent', ticket: null } }); // the hub too only reads
    await outside(hub); // lease release
    expect(hub.offScript).toEqual([]);
    expect(hub.remaining).toBe(0);
    expect(h.sent.map((fact) => (fact as { platformMessageId: string }).platformMessageId)).toEqual([WORLD.messages.sentByUs, WORLD.messages.sentPart2]);
  });

  it('[NF-022] claim-uncertain-held: an unreported ticket is unknown, never repeated by itself; the person\'s new click of the part is dispatched (audit 2026-10-20, row 2)', async () => {
    const { hub, clock, make } = scenarioHarness('claim-uncertain-held');
    const h = make();
    greetingOp(h);
    await outside(hub); // lease claim
    const c = uuid(0x403);
    expect(await h.coordinator.begin(TAB, greet(h, c, 0))).toMatchObject({ ok: true, ticket: { attemptId: c, ticket: 'tkt-once-c' } });
    await clock.advance(60_000);
    expect(h.coordinator.status(c)?.state).toBe('uncertain');
    expect(await h.coordinator.begin(TAB, greet(h, uuid(0x404), 0))).toMatchObject({ ok: true, ticket: { attemptId: uuid(0x404), ticket: 'tkt-once-d' } });
    expect(hub.offScript).toEqual([]);
    expect(hub.remaining).toBe(0);
    expect(hub.claims.filter((op) => op.body.action === 'dispatch' && op.body.attemptId === c)).toHaveLength(1);
  });

  it('[SP-054] preview-reply-rejected-then-sent: a proven native refusal is reported with its status; the client holds that part', async () => {
    const { hub, make } = scenarioHarness('preview-reply-rejected-then-sent');
    const h = make();
    h.ops.set(OP, doneView({ target: targetOf(WORLD.fan) }));
    h.opCheckpoint = fanCheckpoint;
    const reply = (attemptId: string, previewRevision = 0): SendBegin =>
      h.begin({ attemptId, target: targetOf(WORLD.fan), textRevision: 1, checkpoint: fanCheckpoint, documentEpoch: fanCheckpoint.documentEpoch, previewRevision });
    const e = uuid(0x405);
    expect(await h.coordinator.begin(TAB, reply(e))).toMatchObject({ ok: true, ticket: { attemptId: e, ticket: 'tkt-once-e' } });
    await h.coordinator.report(TAB, { attemptId: e, state: 'nativeEnqueued' }, 'p-e');
    await h.coordinator.report(TAB, { attemptId: e, state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422 });
    await h.coordinator.idle();
    // v1 parts are not editable: the frozen rules end a refused part (SEND_ATTEMPT_RETRYABLE_ENDS); the hub would take a new dispatch.
    expect(await h.coordinator.begin(TAB, reply(uuid(0x406), 1))).toMatchObject({ ok: false, view: { state: 'held', code: 'CG-SEND-PART' } });
    expect(hub.remaining).toBe(2);
    expect(await outside(hub)).toMatchObject({ custody: { attemptId: uuid(0x406), state: 'dispatching' } });
    expect(await outside(hub)).toMatchObject({ custody: { attemptId: uuid(0x406), state: 'sent' } });
    expect(hub.offScript).toEqual([]);
    expect(hub.remaining).toBe(0);
  });

  it('[X8-09] claim-refusals: every dispatch refusal holds with the scenario\'s code and is never dispatched again', async () => {
    const { hub, make } = scenarioHarness('claim-refusals');
    const held: { code: string | undefined; expected: string | null }[] = [];
    while (hub.peek() !== null) {
      const next = hub.peek();
      const body = (next?.request as { body?: ClaimBody }).body;
      if (next?.route !== 'clientFanClaim' || body?.action !== 'dispatch') {
        await outside(hub);
        continue;
      }
      // A fresh background per refusal: the script reuses the attempt id.
      const h = make();
      greetingOp(h, body.group.generationRef);
      const result = await h.coordinator.begin(TAB, greet(h, body.attemptId, body.partIndex, body.group.generationRef));
      await h.coordinator.idle();
      held.push({ code: result.ok ? 'ticket' : result.view.code, expected: next.expect?.disposition === 'read-status' ? 'CG-SEND-PART' : (next.expect?.cg ?? null) });
    }
    expect(held.length).toBe(7);
    for (const row of held) expect(row.code).toBe(row.expected);
    expect(hub.offScript).toEqual([]);
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
        await h.coordinator.report(TAB, view, pendingId);
      },
    };
    const driver = new PreviewSendDriver({ port: host.previewSend, background, ids: sequentialIds(0x500), onView: (v) => views.push(v), clock: h.clock });
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
    // Nothing goes again by itself (a person's new click would be a new attempt, row 2).
    expect(h.hub.claims.filter((c) => c.body.action === 'dispatch')).toHaveLength(1);
    // MAIN may still see the pair: the driver keeps listening, within its bound.
    expect(driver.listening).toBe(1);
    await h.clock.advance(LATE_PAIR_LISTEN_MS);
    expect(driver.listening).toBe(0);
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

  it('[SP-054] MAIN answers held or notEnqueued: reported once, no further listening', async () => {
    for (const commit of [{ state: 'held', code: 'CG-TIMEOUT' }, { state: 'notEnqueued', code: 'CG-SEND-QUEUE' }] as const) {
      const { h, host, driver, click } = driverHarness();
      const port = host.previewSend;
      if (port === null) throw new Error('X8 port');
      port.commit = () => Promise.resolve(commit);
      h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'failed'));
      expect(await driver.send(click())).toEqual({ attemptId: A, ...commit });
      await h.coordinator.idle();
      expect(h.coordinator.status(A)?.state).toBe(commit.state);
      expect(driver.listening).toBe(0);
    }
  });

  it('[NF-022] [RB-007] MAIN answers uncertain: the driver keeps listening and the late linked pair ends it as sent', async () => {
    const { h, host, driver, click } = driverHarness([
      // MAIN saw the receipt of exactly this attempt, then the echo with the same id.
      { kind: 'send-state', at: 900, view: { attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', platformMessageId: WORLD.messages.sentByUs } },
      { kind: 'send-state', at: 2000, view: { attemptId: A, state: 'sentObserved', platformMessageId: WORLD.messages.sentByUs } },
    ]);
    const port = host.previewSend;
    if (port === null) throw new Error('X8 port');
    port.commit = () => Promise.resolve({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    h.hub.claimScript.push(ticketFor(A), okAnswer(A, 'sent'));
    expect(await driver.send(click())).toEqual({ attemptId: A, state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(driver.listening).toBe(1);
    host.run();
    await h.coordinator.idle();
    expect(h.coordinator.status(A)?.state).toBe('sentObserved');
    expect(actions(h)).toEqual(['dispatch', 'sent']);
    // A final state ends the listening.
    expect(driver.listening).toBe(0);
  });

  it('[SP-054] a background refusal comes back as the view; a lost report is left to the silence deadline', async () => {
    const { h, driver, click } = driverHarness();
    h.env = { ...h.env, bootstrap: BOOTSTRAP_PILOT_PAGES };
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
