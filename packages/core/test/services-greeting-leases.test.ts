// The background's greeting leases (architecture.md §8.5, §6.7.7; H-7): the
// lease tokens of one install over a scripted hub and a fake clock. The hub's
// own automaton (two installs, one wins) is played in the wiring test of the
// background (apps/extension/test/wiring-background.test.ts).

import { type ClaimState } from '@cg/contracts';
import { GREETING_LEASES_KEY, GREETING_LEASES_MAX, GreetingLeases } from '@cg/core/services/custody';
import { describe, expect, it } from 'vitest';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds, settle } from './support/clock';
import { FakeHub } from './support/fake-hub';

const NOW = Date.parse('2026-10-03T10:00:00.000Z');
const PAGE = { pageId: 11, pageLabel: 'model-one-of' };
const FAN = '2002';
const INSTANCE = '00000000-0000-4000-8000-0000000000aa';
const iso = (ms: number): string => new Date(ms).toISOString();

function claimState(lease: ClaimState['lease'], serverNow: number): ClaimState {
  return { greeting: { state: 'none', at: null, messageRef: null, source: null }, lease, group: null, custody: null, serverNow: iso(serverNow), flagRevision: 4 };
}
const owned = (leaseToken: string, serverNow: number, forMs = 120_000): ClaimState => claimState({ state: 'owned', leaseToken, expiresAt: iso(serverNow + forMs), heldBy: null }, serverNow);
const released = (serverNow: number): ClaimState => claimState({ state: 'released', leaseToken: null, expiresAt: null, heldBy: null }, serverNow);

interface World {
  readonly clock: FakeClock;
  readonly hub: FakeHub;
  readonly store: MemoryStore;
  readonly events: EventLog;
  readonly log: LogRecorder;
  readonly who: { owner: string | null; tabs: string[] };
  readonly leases: GreetingLeases;
}

function world(options: { store?: MemoryStore; clock?: FakeClock; ids?: number } = {}): World {
  const clock = options.clock ?? new FakeClock(NOW);
  const hub = new FakeHub(clock);
  const store = options.store ?? new MemoryStore();
  const events = new EventLog();
  const log = new LogRecorder();
  const who = { owner: 'https://hub.test|7' as string | null, tabs: ['tab-a', 'tab-b'] };
  const leases = new GreetingLeases({
    clock,
    ids: sequentialIds(options.ids ?? 0x100),
    hub,
    instanceId: () => INSTANCE,
    owner: () => who.owner,
    limits: () => null,
    events,
    tabs: () => who.tabs,
    store,
    log,
  });
  return { clock, hub, store, events, log, who, leases };
}

const tokenOf = (w: World, index: number): string | undefined => {
  const body = w.hub.claims[index]?.body;
  return body !== undefined && 'leaseToken' in body ? body.leaseToken : undefined;
};

describe('the greeting leases of the background', () => {
  it('[NF-021] a claim mints the lease token and names this install; the renewal and the release come with the same token', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) }, { kind: 'ok', state: owned(token, NOW + 40_000) }, { kind: 'ok', state: released(NOW + 50_000) });

    const claimed = await w.leases.act('tab-a', PAGE, FAN, 'claim');
    expect(claimed).toMatchObject({ ok: true, state: { lease: { state: 'owned', leaseToken: token } } });
    expect(w.hub.claims[0]).toEqual({ pageLabel: PAGE.pageLabel, fanRef: FAN, body: { action: 'claim', leaseToken: token, instanceId: INSTANCE } });
    expect(w.leases.held).toBe(1);

    await w.clock.advance(40_000);
    expect(await w.leases.act('tab-a', PAGE, FAN, 'renew')).toMatchObject({ ok: true });
    expect(w.hub.claims[1]?.body).toEqual({ action: 'renew', leaseToken: token, instanceId: INSTANCE });

    await w.clock.advance(10_000);
    expect(await w.leases.act('tab-a', PAGE, FAN, 'release')).toMatchObject({ ok: true, state: { lease: { state: 'released' } } });
    expect(w.hub.claims[2]?.body).toEqual({ action: 'release', leaseToken: token, instanceId: INSTANCE });
    expect(w.leases.held).toBe(0);
  });

  it('[NF-021] a second tab of this browser joins the lease: the same token goes to the hub, not a new one that would lose to our own lease', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) }, { kind: 'ok', state: owned(token, NOW + 5_000) });
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    await w.clock.advance(5_000);
    expect(await w.leases.act('tab-b', PAGE, FAN, 'claim')).toMatchObject({ ok: true, state: { lease: { state: 'owned', leaseToken: token } } });
    expect([tokenOf(w, 0), tokenOf(w, 1)]).toEqual([token, token]);
    // The other tab heard about the lease once — when it was taken, not when it was joined.
    expect(w.events.of('newcomers.changed')).toEqual([{ to: 'tab-b', payload: { pageId: PAGE.pageId } }]);
  });

  it('[NF-021] a renewal without a lease of this install asks the hub nothing: the lease ran out («нажмите Hi ещё раз»)', async () => {
    const w = world();
    expect(await w.leases.act('tab-a', PAGE, FAN, 'renew')).toEqual({ ok: false, code: 'CG-CLAIM-EXPIRED' });
    expect(w.hub.claims).toEqual([]);

    // The same after the deadline of a lease we did hold: our clock says it is over.
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) });
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    await w.clock.advance(121_000);
    expect(await w.leases.act('tab-a', PAGE, FAN, 'renew')).toEqual({ ok: false, code: 'CG-CLAIM-EXPIRED' });
    expect(w.hub.claims).toHaveLength(1);
    expect(w.leases.held).toBe(0);
  });

  it('a lease whose deadline passed is not reused: the next claim comes with a new token', async () => {
    const w = world();
    const ids = sequentialIds(0x100);
    const first = ids.uuid();
    const second = ids.uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(first, NOW) }, { kind: 'ok', state: owned(second, NOW + 130_000) });
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    await w.clock.advance(130_000);
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    expect([tokenOf(w, 0), tokenOf(w, 1)]).toEqual([first, second]);
  });

  it('[NF-021] a colleague holds the fan: the claim is refused by the hub as it is, and nothing is kept', async () => {
    const w = world();
    w.hub.claimScript.push({ kind: 'http', status: 409, error: 'claim_busy' });
    await expect(w.leases.act('tab-a', PAGE, FAN, 'claim')).rejects.toMatchObject({ name: 'HubCallError', failure: { error: 'claim_busy' } });
    expect(w.leases.held).toBe(0);
    expect(w.events.of('newcomers.changed')).toEqual([]);
  });

  it('a renewal the hub refuses for good (the lease is gone) forgets the token; one that got no answer keeps it for the next try', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) }, { kind: 'transport', failure: 'network' }, { kind: 'http', status: 409, error: 'claim_expired' });
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    w.events.clear();

    await expect(w.leases.act('tab-a', PAGE, FAN, 'renew')).rejects.toMatchObject({ failure: { kind: 'transport' } });
    expect(w.leases.held).toBe(1);

    await expect(w.leases.act('tab-a', PAGE, FAN, 'renew')).rejects.toMatchObject({ failure: { error: 'claim_expired' } });
    expect(w.leases.held).toBe(0);
    // The other tab reads the list again: the row is free.
    expect(w.events.of('newcomers.changed')).toEqual([{ to: 'tab-b', payload: { pageId: PAGE.pageId } }]);
    // Nothing was repeated by the service itself.
    expect(w.hub.claims.map((op) => op.body.action)).toEqual(['claim', 'renew', 'renew']);
  });

  it('[NF-023] one action per fan at a time: a second one waits for the first and sees what it left', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) }, { kind: 'ok', state: owned(token, NOW) });
    // Asked in the same step: without the row's order both would mint a token of their own.
    const [first, second] = await Promise.all([w.leases.act('tab-a', PAGE, FAN, 'claim'), w.leases.act('tab-b', PAGE, FAN, 'claim')]);
    expect(first.ok && second.ok).toBe(true);
    expect([tokenOf(w, 0), tokenOf(w, 1)]).toEqual([token, token]);
  });

  it('[BG-004] the tokens survive an unload of the event page: the next instance renews with the token of the previous one', async () => {
    const store = new MemoryStore();
    const before = world({ store });
    const token = sequentialIds(0x100).uuid();
    before.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) });
    await before.leases.act('tab-a', PAGE, FAN, 'claim');
    await before.leases.idle();
    expect(store.data.get(GREETING_LEASES_KEY)).toMatchObject({ v: 1, leases: [{ pageId: PAGE.pageId, fanRef: FAN, leaseToken: token }] });

    const after = world({ store, clock: new FakeClock(NOW + 30_000), ids: 0x900 });
    expect(await after.leases.restore()).toBe(1);
    after.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW + 30_000) });
    expect(await after.leases.act('tab-c', PAGE, FAN, 'renew')).toMatchObject({ ok: true });
    expect(tokenOf(after, 0)).toBe(token);
  });

  it('a sign-out forgets every token; nobody signed in — nothing is asked', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) });
    await w.leases.act('tab-a', PAGE, FAN, 'claim');
    w.leases.forgetAll();
    await w.leases.idle();
    expect(w.leases.held).toBe(0);
    expect(w.store.data.get(GREETING_LEASES_KEY)).toEqual({ v: 1, leases: [] });

    w.who.owner = null;
    expect(await w.leases.act('tab-a', PAGE, FAN, 'claim')).toEqual({ ok: false, code: 'CG-AUTH-REQUIRED' });
    expect(w.hub.claims).toHaveLength(1);
  });

  it('an answer that came for the previous person is not kept and not handed over', async () => {
    const w = world();
    const token = sequentialIds(0x100).uuid();
    w.hub.claimScript.push({ kind: 'ok', state: owned(token, NOW) });
    // Another person signs in while the hub is answering.
    const claim = w.hub.claim.bind(w.hub);
    w.hub.claim = (op) => {
      const answer = claim(op);
      w.who.owner = 'https://hub.test|8';
      return answer;
    };
    expect(await w.leases.act('tab-a', PAGE, FAN, 'claim')).toEqual({ ok: false, code: 'CG-CONTEXT-CHANGED' });
    expect(w.leases.held).toBe(0);
  });

  it('keeps a bounded number of leases, the oldest go first; the log carries ids and states, never a token', async () => {
    const w = world();
    const ids = sequentialIds(0x100);
    for (let fan = 0; fan < GREETING_LEASES_MAX + 2; fan += 1) {
      w.hub.claimScript.push({ kind: 'ok', state: owned(ids.uuid(), NOW) });
      await w.leases.act('tab-a', PAGE, String(5000 + fan), 'claim');
    }
    await settle();
    expect(w.leases.held).toBe(GREETING_LEASES_MAX);
    const logged = JSON.stringify(w.log.entries);
    expect(logged).not.toContain(tokenOf(w, 0));
    expect(w.log.entries[0]).toMatchObject({ scope: 'bg.newcomers', msg: 'lease', fields: { action: 'claim', lease: 'owned' } });
  });
});
