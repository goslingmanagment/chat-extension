// The registration of a proven human send (architecture.md §6.6, §8.5,
// §6.7.13; hub H-7 `registerNativeSend`): a part of a preview or of a «Новые»
// card that the person sent from ChatSpace's own composer is reported to the
// hub — a report of what happened, never a send.

import { ClaimOpSchema, type ClaimState, type OpView } from '@cg/contracts';
import { NATIVE_SENDS_KEY, NATIVE_SENDS_MAX, NATIVE_SEND_KEEP_MS, NativeSendRegistrar, REPORT_RETRY_DELAYS_MS, nativeSendClaim } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { FakeHub } from './support/fake-hub';
import { NOW_MS, WORLD, target, uuid } from './support/world';

const INSTANCE = WORLD.instanceId;
const GENERATION = uuid(0x600);
const MESSAGE = '4100';

function view(over: Partial<OpView> = {}): OpView {
  return {
    opId: uuid(0x10),
    feature: 'hi',
    surface: 'newcomers',
    target,
    state: 'done',
    phase: { name: 'settled', since: NOW_MS },
    startedAt: NOW_MS - 5000,
    endedAt: NOW_MS,
    toneUsed: null,
    generationRef: GENERATION,
    result: { kind: 'variants', variants: [['Hi and welcome!', 'Ask me anything.']] },
    ...over,
  };
}

const state = (): ClaimState => ({
  greeting: { state: 'confirmed', at: new Date(NOW_MS).toISOString(), messageRef: MESSAGE, source: 'native-register' },
  lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
  group: null,
  custody: null,
  serverNow: new Date(NOW_MS).toISOString(),
  flagRevision: 4,
});

const OWNER = `${WORLD.hubOrigin}|${WORLD.user.userId}`;

/** `owner.now`: who is signed in (null — nobody). `shared`: the storage and the hub of a previous instance of the event page. */
function world(owner: { now: string | null } = { now: OWNER }, shared?: { readonly store: MemoryStore; readonly hub: FakeHub; readonly clock: FakeClock }) {
  const clock = shared?.clock ?? new FakeClock(NOW_MS);
  const hub = shared?.hub ?? new FakeHub(clock);
  const store = shared?.store ?? new MemoryStore();
  const log = new LogRecorder();
  const registrar = new NativeSendRegistrar({ clock, ids: sequentialIds(shared === undefined ? 0x700 : 0x800), hub, instanceId: () => INSTANCE, owner: () => owner.now, store, log });
  return { clock, hub, log, registrar, owner, store };
}
const owedIn = (store: MemoryStore): unknown[] => ((store.data.get(NATIVE_SENDS_KEY) as { owed?: unknown[] } | undefined)?.owed ?? []);

describe('what is registered', () => {
  it('[NF-019] a greeting from a «Новые» card: the generation, the variant, the part and its count, the id from the receipt — and nothing of the text', () => {
    const claim = nativeSendClaim(view(), { variant: 0, index: 1 }, MESSAGE, { attemptId: uuid(0x700), instanceId: INSTANCE });
    expect(claim).toEqual({
      pageLabel: WORLD.pages.one.pageLabel,
      fanRef: target.fanRef,
      body: { action: 'registerNativeSend', attemptId: uuid(0x700), instanceId: INSTANCE, purpose: 'greeting', group: { generationRef: GENERATION, variant: 0, partCount: 2 }, partIndex: 1, platformMessageId: MESSAGE },
    });
    expect(ClaimOpSchema.safeParse(claim).success).toBe(true);
    expect(JSON.stringify(claim)).not.toContain('welcome');
  });

  it('[SP-054] a part of a Spenders preview is a `preview-reply`; a result without variants counts its parts', () => {
    const reply = view({ feature: 'reply', surface: 'preview', result: { kind: 'parts', parts: ['a', 'b', 'c'], splitRequested: true } });
    expect(nativeSendClaim(reply, { index: 2 }, MESSAGE, { attemptId: uuid(1), instanceId: INSTANCE })?.body).toMatchObject({ purpose: 'preview-reply', group: { variant: 0, partCount: 3 }, partIndex: 2 });
  });

  it('nothing for the dock’s own result, an unfinished or unparsed one, or a part that is not there', () => {
    const ids = { attemptId: uuid(1), instanceId: INSTANCE };
    expect(nativeSendClaim(view({ surface: 'dock' }), { index: 0 }, MESSAGE, ids)).toBeNull();
    expect(nativeSendClaim(view({ state: 'failed' }), { index: 0 }, MESSAGE, ids)).toBeNull();
    const { generationRef: _ref, ...noRef } = view();
    expect(nativeSendClaim(noRef, { index: 0 }, MESSAGE, ids)).toBeNull();
    const { result: _result, ...noResult } = view();
    expect(nativeSendClaim(noResult, { index: 0 }, MESSAGE, ids)).toBeNull();
    expect(nativeSendClaim(view(), { variant: 0, index: 2 }, MESSAGE, ids)).toBeNull();
    expect(nativeSendClaim(view(), { variant: 1, index: 0 }, MESSAGE, ids)).toBeNull();
    expect(nativeSendClaim(view({ result: { kind: 'parts', parts: ['a'], splitRequested: false } }), { variant: 1, index: 0 }, MESSAGE, ids)).toBeNull();
    expect(nativeSendClaim(view({ feature: 'recap', result: { kind: 'recap', markdown: 'x', coverage: null, shared: { generationRef: GENERATION } } }), { index: 0 }, MESSAGE, ids)).toBeNull();
  });
});

describe('the report to the hub', () => {
  it('[NF-019] one call when the hub answers; the dock’s results and unknown operations ask nothing', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    expect(await w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)).toBe('registered');
    expect(w.hub.claims).toHaveLength(1);
    expect(await w.registrar.register(view({ surface: 'dock' }), { index: 0 }, MESSAGE)).toBe('not-ours');
    expect(await w.registrar.register(null, { index: 0 }, MESSAGE)).toBe('not-ours');
    expect(w.hub.claims).toHaveLength(1);
    expect(w.log.entries.at(-1)).toMatchObject({ scope: 'bg.send', msg: 'native send registered', fields: { outcome: 'registered', tries: 1, purpose: 'greeting', owed: 0 } });
  });

  it('a hub that gives no answer is asked again with the SAME attempt id, on the custody report’s schedule; an answer ends it', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'transport', failure: 'network' }, { kind: 'http', status: 503, error: 'service_unavailable' }, { kind: 'ok', state: state() });
    const outcome = w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await w.clock.advance(1);
    expect(w.hub.claims).toHaveLength(1);
    await w.clock.advance(REPORT_RETRY_DELAYS_MS[0]);
    expect(w.hub.claims).toHaveLength(2);
    await w.clock.advance(REPORT_RETRY_DELAYS_MS[1]);
    expect(await outcome).toBe('registered');
    const attempts = w.hub.claims.map((op) => (op.body.action === 'registerNativeSend' ? op.body.attemptId : null));
    expect(new Set(attempts).size).toBe(1);
    expect(w.registrar.inFlight).toBe(0);
  });

  it('the hub’s refusal is final: the part is already counted, or the hub has no such route — nothing is repeated', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'http', status: 409, error: 'part_already_sent' });
    expect(await w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)).toBe('refused');
    await w.clock.advance(120_000);
    expect(w.hub.claims).toHaveLength(1);
    // A refusal of the hub layer itself (a hub without the route): not a HubCallError.
    w.hub.claim = () => Promise.reject(Object.assign(new Error('capability'), { name: 'HubCheckError', code: 'CG-HUB-CAPABILITY' }));
    expect(await w.registrar.register(view({ opId: uuid(0x11) }), { variant: 0, index: 0 }, MESSAGE)).toBe('refused');
  });

  it('a silent hub is not asked forever in one go, and not under another sign-in: the report stays owed', async () => {
    const w = world();
    for (let i = 0; i <= REPORT_RETRY_DELAYS_MS.length; i += 1) w.hub.claimScript.push({ kind: 'transport', failure: 'timeout' });
    const silent = w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await w.clock.advance(REPORT_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) + 1000);
    expect(await silent).toBe('undelivered');
    expect(w.hub.claims).toHaveLength(REPORT_RETRY_DELAYS_MS.length + 1);
    // Nothing more by itself — and nothing forgotten.
    await w.clock.advance(10 * 60_000);
    expect(w.hub.claims).toHaveLength(REPORT_RETRY_DELAYS_MS.length + 1);
    expect(w.registrar.pending).toBe(1);

    const signedOut = world();
    signedOut.hub.claimScript.push({ kind: 'transport', failure: 'network' }, { kind: 'ok', state: state() });
    const pending = signedOut.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await signedOut.clock.advance(1);
    signedOut.owner.now = null;
    await signedOut.clock.advance(5000);
    expect(await pending).toBe('undelivered');
    expect(signedOut.hub.claims).toHaveLength(1);
    expect(signedOut.registrar.pending).toBe(1);
    // Another person signed in: the registration is not theirs to make.
    signedOut.owner.now = `${WORLD.hubOrigin}|999`;
    expect(signedOut.registrar.resume()).toBe(0);
    expect(signedOut.hub.claims).toHaveLength(1);
    // Nobody signed in: nothing is asked at all, and nothing is owed by nobody.
    const nobody = world({ now: null });
    expect(await nobody.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)).toBe('undelivered');
    expect(nobody.hub.claims).toEqual([]);
    expect(nobody.registrar.pending).toBe(0);
  });

  it('[NF-019] what the hub did not answer is owed: journaled before the first call, delivered again with the SAME attempt id once the hub is heard, and gone when it answers', async () => {
    const w = world();
    for (let i = 0; i <= REPORT_RETRY_DELAYS_MS.length; i += 1) w.hub.claimScript.push({ kind: 'transport', failure: 'network' });
    const first = w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await w.clock.advance(1);
    // The journal holds it while the hub is silent — ids only, never a text.
    expect(owedIn(w.store)).toHaveLength(1);
    expect(JSON.stringify(owedIn(w.store))).not.toContain('welcome');
    await w.clock.advance(REPORT_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) + 1000);
    expect(await first).toBe('undelivered');
    expect(owedIn(w.store)).toHaveLength(1);

    // The hub is back (a bootstrap arrived): the same registration goes again.
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    expect(w.registrar.resume()).toBe(1);
    await w.clock.advance(1);
    await w.registrar.idle();
    const attempts = w.hub.claims.map((op) => (op.body.action === 'registerNativeSend' ? op.body.attemptId : null));
    expect(new Set(attempts).size).toBe(1);
    expect(w.registrar.pending).toBe(0);
    expect(owedIn(w.store)).toEqual([]);
    // Nothing left to resume.
    expect(w.registrar.resume()).toBe(0);
  });

  it('[NF-019] an event page that was unloaded before the hub answered: its successor delivers the owed registration — the same attempt id — under the sender’s sign-in only', async () => {
    const before = world();
    before.hub.claimScript.push({ kind: 'transport', failure: 'network' });
    void before.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await before.clock.advance(1);
    await before.registrar.idle();
    const attemptId = before.hub.claims[0]?.body.action === 'registerNativeSend' ? before.hub.claims[0].body.attemptId : null;
    expect(attemptId).not.toBeNull();
    // The event page is gone (its timers with it); the next one starts with nobody signed in yet.
    const owner: { now: string | null } = { now: null };
    const after = world(owner, { store: before.store, hub: before.hub, clock: before.clock });
    expect(await after.registrar.restore()).toBe(1);
    await after.clock.advance(1);
    expect(before.hub.claims).toHaveLength(1);
    // The sender signs in again (the bootstrap arrives): now it is delivered.
    owner.now = OWNER;
    before.hub.claimScript.push({ kind: 'ok', state: state() });
    expect(after.registrar.resume()).toBe(1);
    await after.clock.advance(1);
    await after.registrar.idle();
    expect(before.hub.claims).toHaveLength(2);
    expect(before.hub.claims[1]?.body).toMatchObject({ action: 'registerNativeSend', attemptId, platformMessageId: MESSAGE });
    expect(owedIn(before.store)).toEqual([]);
  });

  it('the tab repeats a report the lost port never acknowledged: the same registration, not a second one', async () => {
    const w = world();
    for (let i = 0; i <= REPORT_RETRY_DELAYS_MS.length; i += 1) w.hub.claimScript.push({ kind: 'transport', failure: 'network' });
    const first = w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await w.clock.advance(REPORT_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) + 1000);
    expect(await first).toBe('undelivered');
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    expect(await w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)).toBe('registered');
    expect(new Set(w.hub.claims.map((op) => (op.body.action === 'registerNativeSend' ? op.body.attemptId : null))).size).toBe(1);
    expect(w.registrar.pending).toBe(0);
  });

  it('the journal is bounded: what is unreadable or older than a week is dropped at the start, and never more than the cap is kept', async () => {
    const w = world();
    const record = (n: number, at: number) => ({
      key: `${uuid(n)}|0|0|${4000 + n}`,
      owner: OWNER,
      opId: uuid(n),
      at,
      op: nativeSendClaim(view({ opId: uuid(n) }), { variant: 0, index: 0 }, String(4000 + n), { attemptId: uuid(0x900 + n), instanceId: INSTANCE }),
    });
    await w.store.set(NATIVE_SENDS_KEY, { v: 1, owed: [record(1, NOW_MS - NATIVE_SEND_KEEP_MS - 1), { key: 'broken' }, record(2, NOW_MS - 1000)] });
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    expect(await w.registrar.restore()).toBe(1);
    await w.clock.advance(1);
    await w.registrar.idle();
    expect(w.hub.claims).toHaveLength(1);
    expect(w.hub.claims[0]?.body).toMatchObject({ platformMessageId: '4002' });
    expect(owedIn(w.store)).toEqual([]);

    const many = world();
    for (let n = 0; n < NATIVE_SENDS_MAX + 5; n += 1) many.hub.claimScript.push({ kind: 'transport', failure: 'network' });
    for (let n = 0; n < NATIVE_SENDS_MAX + 5; n += 1) void many.registrar.register(view({ opId: uuid(0x1000 + n) }), { variant: 0, index: 0 }, String(6000 + n));
    await many.clock.advance(1);
    expect(many.registrar.pending).toBe(NATIVE_SENDS_MAX);
  });

  it('two reports of the same send (two tabs saw it) are one registration', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    const [a, b] = await Promise.all([w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE), w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)]);
    expect([a, b]).toEqual(['registered', 'registered']);
    expect(w.hub.claims).toHaveLength(1);
  });
});
