import type { ClaimState, HubClaimOp, HubFailure } from '@cg/contracts/hub';
import { FANSLY_SEND_JOURNAL_KEY, FanslySendJournalEntrySchema, type FanslyGreetingRequest, type FanslySendJournalEntry, type FanslySendTuple } from '@cg/contracts/send-fansly';
import { describe, expect, it } from 'vitest';

import type { Clock } from '../../ports';
import { createMemoryKv, type MemoryKv } from '../../test-support/memory-kv';
import { FANSLY_NATIVE_SENDS_KEY, createFanslySend, fanslyReceiptOutcome, fanslySendFailureOutcome, type FanslyPreparedSend, type FanslySend, type FanslySendStart } from './send';

const CREATOR = '700000000000000017';
const FAN = '920000000000000003';
const GROUP = '810000000000000001';
const HUB = 'https://hub.example.test';
const PAGE = { pageId: 13, pageLabel: 'model-two-fansly', flagRevision: 4 };
const TAB = 'tab-session-1';
const HISTORY = '11111111-1111-4111-8111-111111111111';
const SERVER = Date.parse('2026-10-16T10:00:00.000Z');
const TEXT = 'Hi there, welcome!';
const iso = (ms: number): string => new Date(ms).toISOString();
const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** Every fake here answers in microtasks: this lets them all run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

function manualClock(): Clock & { advance(ms: number): void } {
  let now = 1_000_000;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer(ms, fn) {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > now || !timers.delete(id)) continue;
        timer.fn();
      }
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const hubError = (failure: HubFailure) => Object.assign(new Error('hub'), { name: 'HubCallError', failure, epoch: 1 });
const apiError = (kind: string, sent: boolean, httpStatus?: number) => Object.assign(new Error(kind), { name: 'FanslyApiError', kind, sent, code: sent ? 'CG-FAN-REQUEST' : 'CG-FAN-TAB', httpStatus });

function claimState(over: Partial<ClaimState> = {}): ClaimState {
  return {
    greeting: { state: 'none', at: null, messageRef: null, source: null },
    lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
    group: null,
    custody: null,
    serverNow: iso(SERVER),
    flagRevision: 4,
    ...over,
  };
}

/** The hub's custody as the send meets it: a lease for the claim, a ticket for the dispatch, every report taken. */
function fakeHub() {
  const calls: HubClaimOp[] = [];
  const order: string[] = [];
  let dispatch: (op: HubClaimOp) => Promise<ClaimState> = (op) =>
    Promise.resolve(claimState({ custody: { attemptId: (op.body as { attemptId: string }).attemptId, state: 'dispatching', ticket: 'tkt-1', ticketExpiresAt: iso(SERVER + 10_000) } }));
  let report: () => Promise<void> = () => Promise.resolve();
  let claim: (op: HubClaimOp) => Promise<ClaimState> = (op) =>
    Promise.resolve(claimState({ lease: { state: 'owned', leaseToken: (op.body as { leaseToken: string }).leaseToken, expiresAt: iso(SERVER + 120_000), heldBy: null } }));
  return {
    calls,
    order,
    actions: () => calls.map((call) => call.body.action),
    onDispatch(run: typeof dispatch) {
      dispatch = run;
    },
    onClaim(run: typeof claim) {
      claim = run;
    },
    onReport(run: typeof report) {
      report = run;
    },
    port: {
      async claim(op: HubClaimOp): Promise<ClaimState> {
        calls.push(op);
        order.push(`hub:${op.body.action}`);
        if (op.body.action === 'claim') return claim(op);
        if (op.body.action === 'dispatch') return dispatch(op);
        if (op.body.action === 'sent' || op.body.action === 'failed') await report();
        return claimState();
      },
      claimStatus: () => Promise.resolve(claimState()),
      resolve: () => ({ code: 'CG-SEND-UNCERTAIN' as const, disposition: 'show' as const, retryAt: null, httpStatus: 409 }),
      hubOrigin: () => HUB,
      pageLabel: () => PAGE.pageLabel,
      limits: () => null,
    },
  };
}

interface FakeRoute {
  holds: boolean;
  starts: number;
  cancels: number;
  readonly answer: ReturnType<typeof deferred<{ response: unknown; status: number }>>;
  readonly prepared: FanslyPreparedSend;
}

/** A routed `POST /message`: its route's `holds()` and its answer under the test's hand. */
function fakeRoute(transport: FanslySendTuple['transport'] = 'direct', requestId = uuid(0x900)): FakeRoute {
  const answer = deferred<{ response: unknown; status: number }>();
  const route: FakeRoute = {
    holds: true,
    starts: 0,
    cancels: 0,
    answer,
    prepared: {
      requestId,
      transport,
      holds: () => route.holds,
      start: () => {
        route.starts += 1;
        return answer.promise;
      },
      cancel: () => {
        route.cancels += 1;
      },
    },
  };
  return route;
}

interface World {
  readonly send: FanslySend;
  readonly hub: ReturnType<typeof fakeHub>;
  readonly kv: MemoryKv;
  readonly clock: ReturnType<typeof manualClock>;
  readonly routes: FakeRoute[];
  live: Omit<FanslySendTuple, 'transport'> | null;
  /** Runs inside the intent's write, before it lands. */
  duringIntent: (() => Promise<void> | void) | null;
  journal(): FanslySendJournalEntry[];
}

function world(options: { kv?: MemoryKv; hub?: ReturnType<typeof fakeHub>; transport?: FanslySendTuple['transport'] } = {}): World {
  const kv = options.kv ?? createMemoryKv();
  const hub = options.hub ?? fakeHub();
  const clock = manualClock();
  const routes: FakeRoute[] = [];
  const inner = kv.open();
  const w: World = {
    hub,
    kv,
    clock,
    routes,
    live: { hostAccountId: CREATOR, groupId: GROUP, fanRef: FAN, tabSessionId: TAB, historyRevision: HISTORY, draftRevision: 2 },
    duringIntent: null,
    journal() {
      const entries = (kv.read<{ entries: unknown[] }>(FANSLY_SEND_JOURNAL_KEY)?.entries ?? []) as FanslySendJournalEntry[];
      // Every record is the contract's: ids and states, never a text.
      for (const entry of entries) expect(FanslySendJournalEntrySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(true);
      expect(JSON.stringify(entries)).not.toContain(TEXT);
      return entries;
    },
    send: undefined as unknown as FanslySend,
  };
  (w as { send: FanslySend }).send = createFanslySend({
    local: {
      ...inner,
      async set(items) {
        const entries = (items[FANSLY_SEND_JOURNAL_KEY] as { entries: FanslySendJournalEntry[] } | undefined)?.entries ?? [];
        const states = entries.map((entry) => entry.state).join(',');
        hub.order.push(`journal:${states}`);
        if (entries.some((entry) => entry.state === 'intentWritten') && w.duringIntent !== null) {
          const during = w.duringIntent;
          w.duringIntent = null;
          await during();
        }
        return inner.set(items);
      },
    },
    hub: hub.port,
    prepare: () => {
      const route = fakeRoute(options.transport, uuid(0x900 + routes.length));
      routes.push(route);
      hub.order.push('prepare');
      return Promise.resolve(route.prepared);
    },
    live: () => w.live,
    sha256: () => Promise.resolve('a'.repeat(64)),
    instanceId: () => uuid(0x1d),
    clock,
    ids: { uuid: (() => {
      let n = 0x100;
      return () => uuid(n++);
    })() },
  });
  return w;
}

function click(attemptId = uuid(1), over: Partial<FanslyGreetingRequest> = {}): FanslySendStart {
  return {
    request: {
      attemptId,
      passId: uuid(0x50),
      hostAccountId: CREATOR,
      fanRef: FAN,
      groupId: GROUP,
      text: TEXT,
      draftRevision: 2,
      historyRevision: HISTORY,
      admission: { kind: 'own' },
      cause: { kind: 'click', actionToken: 'a'.repeat(32) },
      ...over,
    },
    tabSessionId: TAB,
    page: PAGE,
  };
}

const receipt = (id = '830000000000000001') => ({ response: { id, groupId: GROUP, senderId: CREATOR, content: TEXT }, status: 200 });

describe('[host:fansly] the greeting send with the hub custody (R20 P9d, architecture §8.6)', () => {
  it('[FS-NEW-3] a card reads pending, uncertain and sent by page and fan after a restart; only the matching hub resolution lifts uncertainty', async () => {
    for (const resolution of ['resolved-sent', 'resolved-not-sent'] as const) {
      const w = world();
      const first = w.send.send(click());
      await settle();
      expect(await w.send.status(PAGE, FAN)).toMatchObject({ attemptId: uuid(1), state: 'requestStarted' });
      w.routes[0]?.answer.reject(apiError('network', true));
      await first;
      await settle();
      w.send.dispose();
      const restored = world({ kv: w.kv, hub: w.hub });
      expect(await restored.send.status(PAGE, FAN)).toMatchObject({ attemptId: uuid(1), state: 'uncertain' });
      expect(await restored.send.status({ ...PAGE, pageId: PAGE.pageId + 1 }, FAN)).toBeNull();
      expect(await restored.send.status(PAGE, '920000000000000099')).toBeNull();
      restored.hub.port.claimStatus = () => Promise.resolve(claimState({ custody: { attemptId: uuid(1), state: resolution, ticket: null, ticketExpiresAt: null } }));
      expect(await restored.send.status(PAGE, FAN)).toMatchObject({ state: resolution === 'resolved-sent' ? 'sent' : 'refused', proof: resolution });
      await settle();
      restored.send.dispose();
      const again = world({ kv: w.kv, hub: w.hub });
      expect(await again.send.status(PAGE, FAN)).toMatchObject({ state: resolution === 'resolved-sent' ? 'sent' : 'refused' });
      expect(again.routes).toHaveLength(0);
      again.send.dispose();
    }
  });

  it('[NF-020] [NF-021] [NF-035] one click: lease, route, journal before the custody, the intent before the request, ONE POST; the receipt and its echo → sent, reported once', async () => {
    const w = world();
    const view = w.send.send(click());
    await settle();
    expect(w.routes).toHaveLength(1);
    expect(w.routes[0]?.starts).toBe(1);
    await w.send.observeRequest({ clientRequestId: uuid(0x900), phase: 'headers' });
    await w.send.observeRequest({ clientRequestId: uuid(0x900), phase: 'completed', statusCode: 200 });
    // The journal's first record before dispatch; the intent's write after the ticket and before the request.
    expect(w.hub.order).toEqual(['hub:claim', 'prepare', 'journal:routed', 'hub:dispatch', 'journal:intentWritten']);
    expect(w.hub.calls[1]?.body).toMatchObject({ action: 'dispatch', purpose: 'greeting', partIndex: 0, textRevision: 2, flagRevision: 4, group: { kind: 'manual', textFingerprint: 'a'.repeat(64) } });
    w.routes[0]?.answer.resolve(receipt());
    await settle();
    expect(w.journal().map((entry) => entry.state)).toEqual(['receipted']);
    w.send.echo([{ id: '830000000000000001', conversationRef: GROUP, fromFan: false }]);
    await expect(view).resolves.toMatchObject({ state: 'sent', proof: 'echo', platformMessageId: '830000000000000001' });
    await settle();
    expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release', 'sent']);
    expect(w.hub.calls.at(-1)?.body).toEqual({ action: 'sent', attemptId: uuid(1), instanceId: uuid(0x1d), platformMessageId: '830000000000000001', evidence: 'receipt+echo' });
    expect(w.journal()).toMatchObject([{ state: 'sent', reportPending: false }]);
    expect(w.journal()[0]?.browserResend).toBeUndefined();
    expect(w.routes[0]?.starts).toBe(1);
  });

  it('[NF-020] the echo before the receipt proves it the moment the receipt comes', async () => {
    const w = world();
    const view = w.send.send(click());
    await settle();
    w.send.echo([{ id: '830000000000000009', conversationRef: GROUP, fromFan: false }]);
    await settle();
    w.routes[0]?.answer.resolve(receipt('830000000000000009'));
    await expect(view).resolves.toMatchObject({ state: 'sent', proof: 'echo' });
  });

  it('[NF-022] [RB-007] `200 {success:false}` is uncertain: never repeated, the fan held — the next click asks nothing', async () => {
    const w = world();
    const view = w.send.send(click());
    await settle();
    w.routes[0]?.answer.reject(apiError('refused', true, 200));
    await expect(view).resolves.toMatchObject({ state: 'uncertain', cause: 'rejected-200', code: 'CG-SEND-UNCERTAIN' });
    await settle();
    expect(w.journal()).toMatchObject([{ state: 'uncertain', cause: 'rejected-200' }]);
    // No report: the custody turns uncertain-held at the hub when its ticket runs out.
    expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
    const again = await w.send.send(click(uuid(2)));
    expect(again).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-SEND-UNCERTAIN' });
    expect(w.routes).toHaveLength(1);
    expect(w.routes[0]?.starts).toBe(1);
    expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
  });

  it('[NF-022] the lost answer of the POST is uncertain (network; through the tab — relay) and never repeated', async () => {
    for (const transport of ['direct', 'tab:abc'] as const) {
      const w = world({ transport });
      const view = w.send.send(click());
      await settle();
      // The server may have sent and echoed it. Without the receipt its id is not proof of this attempt.
      const echo = { id: '830000000000000001', conversationRef: GROUP, fromFan: false };
      w.send.echo([echo]);
      w.routes[0]?.answer.reject(apiError('network', true));
      const cause = transport === 'direct' ? 'network' : 'relay';
      await expect(view).resolves.toMatchObject({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause });
      w.send.echo([echo]);
      w.clock.advance(60_000);
      await settle();
      expect(w.journal()).toMatchObject([{ state: 'uncertain', cause }]);
      expect(await w.send.send(click(uuid(2)))).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
      expect(w.routes).toHaveLength(1);
      expect(w.routes[0]?.starts).toBe(1);
      expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
    }
  });

  it('[NF-022] X41: a late browser answer of the same request marks the journal, keeps uncertain and its lock, also after a restart', async () => {
    for (const transport of ['direct', 'tab:abc'] as const) {
      const w = world({ transport });
      const view = w.send.send(click());
      await settle();
      w.routes[0]?.answer.reject(apiError('network', true));
      await expect(view).resolves.toMatchObject({ state: 'uncertain' });
      expect(w.journal()[0]?.requestId).toBe(uuid(0x900));
      await w.send.observeRequest({ clientRequestId: uuid(0x901), phase: 'completed', statusCode: 200 });
      expect(w.journal()[0]?.browserResend).toBeUndefined();
      // The late answer can come after the event page slept; correlation is in the durable record.
      w.send.dispose();
      const restored = world({ kv: w.kv, hub: w.hub });
      await restored.send.observeRequest({ clientRequestId: uuid(0x900), phase: 'completed', statusCode: 200 });
      expect(restored.journal()).toMatchObject([{ state: 'uncertain', requestId: uuid(0x900), browserResend: true }]);
      restored.clock.advance(60_000);
      expect(await restored.send.send(click(uuid(2)))).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
      expect(w.routes[0]?.starts).toBe(1);
      expect(restored.routes).toHaveLength(0);
      expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
      restored.send.dispose();
      const again = world({ kv: w.kv, hub: w.hub });
      await again.send.ready;
      expect(again.journal()).toMatchObject([{ state: 'uncertain', browserResend: true }]);
      again.send.dispose();
    }
  });

  it('[NF-022] X41: passive loss and repeated headers before the fetch settles still mark one request, with no new send', async () => {
    const w = world();
    const view = w.send.send(click());
    await settle();
    for (const phase of ['headers', 'error', 'headers', 'completed'] as const) {
      await w.send.observeRequest({ clientRequestId: uuid(0x900), phase, ...(phase === 'completed' ? { statusCode: 200 } : {}) });
    }
    w.routes[0]?.answer.reject(apiError('network', true));
    await expect(view).resolves.toMatchObject({ state: 'uncertain' });
    expect(w.journal()).toMatchObject([{ state: 'uncertain', requestId: uuid(0x900), browserResend: true }]);
    expect(w.routes[0]?.starts).toBe(1);
    expect(w.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
  });

  it('[NF-022] X41: the browser resend answers the one fetch — only its own receipt+echo proves sent, not the first message or an unrelated echo', async () => {
    const w = world();
    const view = w.send.send(click());
    await settle();
    for (const phase of ['headers', 'error', 'headers', 'completed'] as const) {
      await w.send.observeRequest({ clientRequestId: uuid(0x900), phase, ...(phase === 'completed' ? { statusCode: 200 } : {}) });
    }
    const id = '830000000000000002';
    w.send.echo([{ id: '830000000000000001', conversationRef: GROUP, fromFan: false }]);
    w.routes[0]?.answer.resolve(receipt(id));
    await settle();
    w.send.echo([
      { id, conversationRef: '810000000000000099', fromFan: false },
      { id, conversationRef: GROUP, fromFan: true },
    ]);
    await settle();
    expect(w.journal()).toMatchObject([{ state: 'receipted', requestId: uuid(0x900), platformMessageId: id, browserResend: true }]);
    expect(w.hub.actions()).not.toContain('sent');
    w.send.echo([{ id, conversationRef: GROUP, fromFan: false }]);
    await expect(view).resolves.toMatchObject({ state: 'sent', proof: 'echo', platformMessageId: id });
    await settle();
    expect(w.journal()).toMatchObject([{ state: 'sent', proof: 'echo', platformMessageId: id, requestId: uuid(0x900), browserResend: true }]);
    expect(w.hub.calls.at(-1)?.body).toMatchObject({ action: 'sent', platformMessageId: id, evidence: 'receipt+echo' });
    expect(w.routes).toHaveLength(1);
    expect(w.routes[0]?.starts).toBe(1);
  });

  it('[NF-021] the intent\'s write paused: the history, the draft, the tab or the ticket changing meanwhile refuses with NO request; the custody hears «not enqueued»', async () => {
    const cases: Array<[string, (w: World) => void, string]> = [
      ['history', (w) => (w.live = w.live === null ? null : { ...w.live, historyRevision: uuid(0x99) }), 'CG-FNEW-HISTORY'],
      ['draft', (w) => (w.live = w.live === null ? null : { ...w.live, draftRevision: 3 }), 'CG-DRAFT-CHANGED'],
      ['account', (w) => (w.live = w.live === null ? null : { ...w.live, hostAccountId: '700000000000000099' }), 'CG-FNEW-ACCOUNT'],
      ['document', (w) => (w.live = w.live === null ? null : { ...w.live, tabSessionId: 'tab-session-2' }), 'CG-FAN-TAB'],
      ['tab gone', (w) => (w.live = null), 'CG-FAN-TAB'],
      ['relay frame', (w) => { const route = w.routes[0]; if (route !== undefined) route.holds = false; }, 'CG-FAN-TAB'],
      ['ticket', (w) => w.clock.advance(9_500), 'CG-TIMEOUT'],
    ];
    for (const [name, change, code] of cases) {
      const w = world();
      w.duringIntent = () => change(w);
      const view = await w.send.send(click());
      expect([name, view]).toEqual([name, { attemptId: uuid(1), fanRef: FAN, state: 'refused', proof: 'not-enqueued', code }]);
      expect([name, w.routes[0]?.starts, w.routes[0]?.cancels]).toEqual([name, 0, 1]);
      await settle();
      expect(w.hub.calls.find((call) => call.body.action === 'failed')?.body).toEqual({ action: 'failed', attemptId: uuid(1), instanceId: uuid(0x1d), reason: 'not_enqueued' });
      expect(w.journal()).toMatchObject([{ state: 'refused', proof: 'not-enqueued', reportPending: false }]);
    }
  });

  it('[NF-021] a dispatch answer delayed beyond its ticket: refused without starting the POST, even with a skewed local clock', async () => {
    const w = world();
    const dispatch = deferred<ClaimState>();
    w.hub.onDispatch(() => dispatch.promise);
    const view = w.send.send(click());
    await settle();
    expect(w.hub.actions()).toEqual(['claim', 'dispatch']);
    expect(w.routes[0]?.starts).toBe(0);
    w.clock.advance(12_000);
    dispatch.resolve(claimState({ custody: { attemptId: uuid(1), state: 'dispatching', ticket: 'tkt-delayed', ticketExpiresAt: iso(SERVER + 10_000) } }));
    await settle();
    // Complete a wrongly started request too, so the regression fails with «sent» instead of hanging.
    w.routes[0]?.answer.resolve(receipt());
    w.send.echo([{ id: '830000000000000001', conversationRef: GROUP, fromFan: false }]);
    await expect(view).resolves.toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-TIMEOUT' });
    expect(w.routes[0]).toMatchObject({ starts: 0, cancels: 1 });
    await settle();
    expect(w.hub.calls.find((call) => call.body.action === 'failed')?.body).toMatchObject({ action: 'failed', attemptId: uuid(1), reason: 'not_enqueued' });
  });

  it('[NF-021] a change while the route was taken is refused before the custody: no dispatch at all', async () => {
    const w = world();
    w.live = { hostAccountId: CREATOR, groupId: GROUP, fanRef: FAN, tabSessionId: TAB, historyRevision: uuid(0x98), draftRevision: 2 };
    expect(await w.send.send(click())).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-FNEW-HISTORY' });
    expect(w.hub.actions()).toEqual(['claim', 'release']);
    expect(w.routes[0]?.cancels).toBe(1);
  });

  it('[NF-021] the custody\'s answer lost: refused, nothing sent, «not enqueued» reported (repeated until taken); a hub refusal opens nothing and owes nothing', async () => {
    const w = world();
    w.hub.onDispatch(() => Promise.reject(hubError({ kind: 'transport', failure: 'network' })));
    let reports = 0;
    w.hub.onReport(() => (++reports < 2 ? Promise.reject(hubError({ kind: 'transport', failure: 'network' })) : Promise.resolve()));
    expect(await w.send.send(click())).toMatchObject({ state: 'refused', proof: 'not-enqueued' });
    expect(w.routes[0]?.starts).toBe(0);
    await settle();
    w.clock.advance(1_000);
    await settle();
    expect(w.hub.calls.filter((call) => call.body.action === 'failed').map((call) => (call.body as { attemptId: string }).attemptId)).toEqual([uuid(1), uuid(1)]);
    expect(w.journal()).toMatchObject([{ state: 'refused', reportPending: false }]);

    const refusedByHub = world();
    refusedByHub.hub.onDispatch(() => Promise.reject(hubError({ kind: 'http', status: 409, error: 'custody_held', reason: null, retryAfterMs: null })));
    expect(await refusedByHub.send.send(click())).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-SEND-UNCERTAIN' });
    await settle();
    expect(refusedByHub.hub.actions()).toEqual(['claim', 'dispatch', 'release']);
  });

  it('[NF-021] two clicks on one fan at once: one attempt, one POST; the other is busy. A colleague\'s lease: nothing routed', async () => {
    const w = world();
    const first = w.send.send(click(uuid(1)));
    const second = w.send.send(click(uuid(2)));
    expect(await second).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-SEND-BUSY' });
    await settle();
    w.routes[0]?.answer.resolve(receipt());
    w.send.echo([{ id: '830000000000000001', conversationRef: GROUP, fromFan: false }]);
    await expect(first).resolves.toMatchObject({ state: 'sent' });
    expect(w.routes).toHaveLength(1);
    expect(w.hub.actions().filter((action) => action === 'dispatch')).toHaveLength(1);

    const busy = world();
    busy.hub.onClaim(() => Promise.resolve(claimState({ lease: { state: 'held', leaseToken: null, expiresAt: null, heldBy: 'you-elsewhere' } })));
    expect(await busy.send.send(click())).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' });
    expect(busy.routes).toHaveLength(0);
  });

  it('[NF-035] a restart: before the intent → refused and «not enqueued» told; after it → uncertain, no request; a receipt waits for its late echo → sent', async () => {
    const kv = createMemoryKv();
    const base = { hubOrigin: HUB, pageId: PAGE.pageId, hostAccountId: CREATOR, groupId: GROUP, admission: { kind: 'own' }, group: { kind: 'manual', textFingerprint: 'a'.repeat(64) }, draftRevision: 2, historyRevision: HISTORY, transport: 'direct', createdAt: 1, updatedAt: 1 } as const;
    kv.data.set(FANSLY_SEND_JOURNAL_KEY, {
      v: 1,
      entries: [
        { ...base, attemptId: uuid(1), fanRef: '920000000000000001', state: 'routed', ticketExpiresAt: null },
        { ...base, attemptId: uuid(2), fanRef: '920000000000000002', state: 'intentWritten', ticketExpiresAt: 5 },
        { ...base, attemptId: uuid(3), fanRef: '920000000000000003', state: 'receipted', ticketExpiresAt: 5, platformMessageId: '830000000000000003' },
      ],
    });
    const w = world({ kv });
    await w.send.ready;
    await settle();
    expect(w.send.view(uuid(1))).toMatchObject({ state: 'refused', proof: 'not-enqueued', code: 'CG-OP-INTERRUPTED' });
    expect(w.send.view(uuid(2))).toMatchObject({ state: 'uncertain', cause: 'restart' });
    expect(w.send.view(uuid(3))).toMatchObject({ state: 'receipted' });
    expect(w.hub.calls.map((call) => [call.body.action, (call.body as { attemptId?: string }).attemptId])).toEqual([['failed', uuid(1)]]);
    expect(w.routes).toHaveLength(0);
    // The uncertain fan is held: a new click asks nothing of Fansly.
    expect(await w.send.send(click(uuid(4), { fanRef: '920000000000000002' }))).toMatchObject({ state: 'refused', code: 'CG-SEND-UNCERTAIN' });
    w.send.echo([{ id: '830000000000000003', conversationRef: GROUP, fromFan: false }]);
    await settle();
    expect(w.send.view(uuid(3))).toMatchObject({ state: 'sent', proof: 'echo', platformMessageId: '830000000000000003' });
    expect(w.hub.calls.at(-1)?.body).toMatchObject({ action: 'sent', attemptId: uuid(3), platformMessageId: '830000000000000003' });
    expect(w.routes).toHaveLength(0);
  });

  it('[NF-035] the journal\'s first write failing: no custody asked, no request', async () => {
    const w = world();
    w.kv.failNext('set');
    expect(await w.send.send(click())).toMatchObject({ state: 'refused', proof: 'before-dispatch', code: 'CG-STORAGE-WRITE' });
    expect(w.hub.actions()).toEqual(['claim', 'release']);
    expect(w.routes[0]?.starts).toBe(0);
  });

  it('[NF-022] the hub\'s resolve lifts an uncertain attempt: «sent» holds the fan as greeted, «not sent» lets a new click through', async () => {
    const w = world();
    const first = w.send.send(click());
    await settle();
    w.routes[0]?.answer.reject(apiError('http', true, 502));
    expect(await first).toMatchObject({ state: 'uncertain', cause: 'server' });
    w.hub.port.claimStatus = () => Promise.resolve(claimState({ custody: { attemptId: uuid(1), state: 'resolved-not-sent', ticket: null, ticketExpiresAt: null } }));
    const second = w.send.send(click(uuid(2)));
    await settle();
    expect(w.send.view(uuid(1))).toMatchObject({ state: 'refused', proof: 'resolved-not-sent' });
    expect(w.routes).toHaveLength(2);
    w.routes[1]?.answer.resolve(receipt('830000000000000002'));
    w.send.echo([{ id: '830000000000000002', conversationRef: GROUP, fromFan: false }]);
    await expect(second).resolves.toMatchObject({ state: 'sent' });
  });

  it('[RB-007] how an HTTP outcome reads (contracts send-fansly.ts): only a proof refuses, the rest after the request is uncertain', () => {
    expect(fanslySendFailureOutcome(apiError('tab', false), 'tab:x')).toEqual({ state: 'refused', proof: 'not-enqueued', code: 'CG-FAN-TAB' });
    expect(fanslySendFailureOutcome(apiError('http', true, 400), 'direct')).toEqual({ state: 'refused', proof: 'native-rejected', code: 'CG-SEND-REJECTED', httpStatus: 400 });
    expect(fanslySendFailureOutcome(apiError('expired', true, 403), 'direct')).toMatchObject({ state: 'refused', proof: 'native-rejected', httpStatus: 403 });
    expect(fanslySendFailureOutcome(apiError('rate-limited', true, 429), 'direct')).toMatchObject({ state: 'refused', httpStatus: 429 });
    expect(fanslySendFailureOutcome(apiError('expired', true, 401), 'direct')).toMatchObject({ state: 'uncertain', cause: 'unauthorized' });
    expect(fanslySendFailureOutcome(apiError('http', true, 503), 'direct')).toMatchObject({ state: 'uncertain', cause: 'server' });
    expect(fanslySendFailureOutcome(apiError('refused', true, 200), 'direct')).toMatchObject({ state: 'uncertain', cause: 'rejected-200' });
    expect(fanslySendFailureOutcome(apiError('malformed', true, 200), 'direct')).toMatchObject({ state: 'uncertain', cause: 'bad-receipt' });
    expect(fanslySendFailureOutcome(apiError('timeout', true), 'direct')).toMatchObject({ state: 'uncertain', cause: 'network' });
    expect(fanslySendFailureOutcome(new TypeError('boom'), 'direct')).toMatchObject({ state: 'uncertain', cause: 'network' });
    expect(fanslyReceiptOutcome({ id: '1', groupId: GROUP, senderId: CREATOR }, { groupId: GROUP, hostAccountId: CREATOR })).toEqual({ state: 'receipted', platformMessageId: '1' });
    expect(fanslyReceiptOutcome({ id: '1', groupId: '810000000000000002', senderId: CREATOR }, { groupId: GROUP, hostAccountId: CREATOR })).toMatchObject({ state: 'uncertain', cause: 'bad-receipt' });
    expect(fanslyReceiptOutcome(undefined, { groupId: GROUP, hostAccountId: CREATOR })).toMatchObject({ state: 'uncertain', cause: 'bad-receipt' });
  });
});

describe('[host:fansly] the person’s own send of a «Новые» card (R20 P10c, FS-NEW-3)', () => {
  const native = (over: Partial<Parameters<FanslySend['native']>[0]> = {}): Parameters<FanslySend['native']>[0] => ({
    page: PAGE,
    fanRef: FAN,
    groupId: GROUP,
    platformMessageId: '830000000000000077',
    admission: { kind: 'own' },
    text: TEXT,
    ...over,
  });
  const owed = (kv: MemoryKv): unknown[] => kv.read<unknown[]>(FANSLY_NATIVE_SENDS_KEY) ?? [];

  it('[NF-019] after «Открыть и вставить» the card’s text sent by Fansly’s own button is registered (`registerNativeSend`, greeting): journaled first, ids and the manual fingerprint only, never a text', async () => {
    const w = world();
    const outcome = await w.send.native(native());
    expect(outcome).toBe('registered');
    const body = w.hub.calls.at(-1)?.body;
    expect(body).toEqual({ action: 'registerNativeSend', attemptId: uuid(0x100), instanceId: uuid(0x1d), purpose: 'greeting', group: { kind: 'manual', textFingerprint: 'a'.repeat(64) }, partIndex: 0, platformMessageId: '830000000000000077' });
    // Owed before the call, gone once the hub took it; never a POST of ours.
    expect(w.routes).toHaveLength(0);
    expect(owed(w.kv)).toEqual([]);
    // An unchanged AI text is registered as its generation.
    await w.send.native(native({ platformMessageId: '830000000000000078', admission: { kind: 'ai', generationRef: uuid(0x60), variant: 0 } }));
    expect(w.hub.calls.at(-1)?.body).toMatchObject({ action: 'registerNativeSend', group: { generationRef: uuid(0x60), variant: 0, partCount: 1 } });
  });

  it('[NF-019] the registration stays owed while the hub does not answer — repeated with the same attempt, after a restart too; a refusal of the hub ends the debt', async () => {
    const kv = createMemoryKv();
    const hub = fakeHub();
    let failing = true;
    const original = hub.port.claim.bind(hub.port);
    hub.port.claim = (op) => (op.body.action === 'registerNativeSend' && failing ? Promise.reject(hubError({ kind: 'transport', failure: 'network' })) : original(op));
    const w = world({ kv, hub });
    expect(await w.send.native(native())).toBe('undelivered');
    const [entry] = owed(kv) as { attemptId: string; group: unknown }[];
    expect(entry).toMatchObject({ attemptId: uuid(0x100), fanRef: FAN, platformMessageId: '830000000000000077', group: { kind: 'manual', textFingerprint: 'a'.repeat(64) } });
    expect(JSON.stringify(owed(kv))).not.toContain(TEXT);
    // The same message heard again (another tab) is the same registration.
    expect(await w.send.native(native())).toBe('undelivered');
    expect(owed(kv)).toHaveLength(1);
    // A restart: the next event page delivers it with the same attempt id.
    failing = false;
    const again = world({ kv, hub });
    await again.send.ready;
    await settle();
    const registrations = hub.calls.filter((call) => call.body.action === 'registerNativeSend');
    expect(registrations.at(-1)?.body).toMatchObject({ attemptId: uuid(0x100) });
    expect(owed(kv)).toEqual([]);
    // A refusal of the hub (not to be repeated) ends the debt at once.
    hub.port.claim = (op) => (op.body.action === 'registerNativeSend' ? Promise.reject(hubError({ kind: 'http', status: 409, code: 'conflict' } as unknown as HubFailure)) : original(op));
    expect(await again.send.native(native({ platformMessageId: '830000000000000079' }))).toBe('refused');
    expect(owed(kv)).toEqual([]);
  });
});
