// The registration of a proven human send (architecture.md §6.6, §8.5,
// §6.7.13; hub H-7 `registerNativeSend`): a part of a preview or of a «Новые»
// card that the person sent from ChatSpace's own composer is reported to the
// hub — a report of what happened, never a send.

import { ClaimOpSchema, type ClaimState, type OpView } from '@cg/contracts';
import { NativeSendRegistrar, REPORT_RETRY_DELAYS_MS, nativeSendClaim } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, sequentialIds } from './support/clock';
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

function world(epoch: { now: number | null } = { now: 3 }) {
  const clock = new FakeClock(NOW_MS);
  const hub = new FakeHub(clock);
  const log = new LogRecorder();
  const registrar = new NativeSendRegistrar({ clock, ids: sequentialIds(0x700), hub, instanceId: () => INSTANCE, epoch: () => epoch.now, log });
  return { clock, hub, log, registrar, epoch };
}

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
    expect(w.log.entries.at(-1)).toMatchObject({ scope: 'bg.send', msg: 'native send registered', fields: { outcome: 'registered', tries: 1, purpose: 'greeting' } });
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

  it('a silent hub is not asked forever, and not after the person changed: the report stays undelivered', async () => {
    const w = world();
    for (let i = 0; i <= REPORT_RETRY_DELAYS_MS.length; i += 1) w.hub.claimScript.push({ kind: 'transport', failure: 'timeout' });
    const silent = w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await w.clock.advance(REPORT_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0) + 1000);
    expect(await silent).toBe('undelivered');
    expect(w.hub.claims).toHaveLength(REPORT_RETRY_DELAYS_MS.length + 1);

    const signedOut = world();
    signedOut.hub.claimScript.push({ kind: 'transport', failure: 'network' }, { kind: 'ok', state: state() });
    const pending = signedOut.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE);
    await signedOut.clock.advance(1);
    signedOut.epoch.now = null;
    await signedOut.clock.advance(5000);
    expect(await pending).toBe('undelivered');
    expect(signedOut.hub.claims).toHaveLength(1);
    // Nobody signed in: nothing is asked at all.
    const nobody = world({ now: null });
    expect(await nobody.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)).toBe('undelivered');
    expect(nobody.hub.claims).toEqual([]);
  });

  it('two reports of the same send (two tabs saw it) are one registration', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'ok', state: state() });
    const [a, b] = await Promise.all([w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE), w.registrar.register(view(), { variant: 0, index: 0 }, MESSAGE)]);
    expect([a, b]).toEqual(['registered', 'registered']);
    expect(w.hub.claims).toHaveLength(1);
  });
});
