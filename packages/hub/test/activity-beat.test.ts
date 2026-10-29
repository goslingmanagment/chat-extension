import { STORAGE_KEYS, type ActivityBeatRequest, type HubAuthState } from '@cg/contracts';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW, NOW_MS, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { json } from './support/fake-hub';
import { makeHarness, signIn, until, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const WORLD_ON = signInWorld(scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off'), BOOTSTRAP_PILOT_ON, WORLD.user.username);
const BEAT: ActivityBeatRequest = { instanceId: 'activity-test-instance', pages: [{ pageLabel: WORLD.pages.one.pageLabel, idleMs: 1000 }] };

let h: Harness;
beforeEach(async () => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
  await signIn(h, WORLD_ON);
  h.hub.on('clientActivity', () => json(200, { recorded: 1, serverNow: NOW }));
});
afterEach(() => {
  h.facade.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('activity belongs to the sign-in that prepared the beat', () => {
  it('a beat and a closing beat use the current sign-in', async () => {
    await h.facade.activityBeat(BEAT);
    await h.facade.activityBeat({ instanceId: BEAT.instanceId, pages: [], closed: true });
    const requests = h.hub.requests.filter((request) => request.route === 'clientActivity');
    expect(requests.map((request) => request.body)).toEqual([BEAT, { instanceId: BEAT.instanceId, pages: [], closed: true }]);
    expect(requests.map((request) => request.headers['authorization'])).toEqual([
      `Bearer ${String(WORLD_ON.issued['token'])}`,
      `Bearer ${String(WORLD_ON.issued['token'])}`,
    ]);
  });

  it.each([false, true])('a sign-in committed at the first await cannot take the previous person\'s beat (closed: %s)', async (closed) => {
    let waiting = false;
    let release = (): void => { throw new Error('sign-in has not reached storage'); };
    const set = h.local.set.bind(h.local);
    vi.spyOn(h.local, 'set').mockImplementation((items) => {
      const written = set(items);
      if (items[STORAGE_KEYS.authToken] === undefined) return written;
      // The write has succeeded, but custody has not yet resumed to publish the new identity.
      return new Promise((resolve) => {
        waiting = true;
        release = () => resolve({ ok: true, value: undefined });
      });
    });
    const me = WORLD_ON.me as HubAuthState;
    const signingIn = signIn(h, {
      ...WORLD_ON,
      login: WORLD.otherUser.username,
      issued: { ...WORLD_ON.issued, token: 'synthetic-next-person-token' },
      me: { ...me, user: { ...me.user, id: WORLD.otherUser.userId, username: WORLD.otherUser.username } },
      bootstrap: { ...BOOTSTRAP_PILOT_ON, identity: { ...BOOTSTRAP_PILOT_ON.identity, ...WORLD.otherUser } },
    });
    await until(() => waiting);
    expect(h.facade.session()?.userId).toBe(WORLD.user.userId);
    // Queue the identity change immediately ahead of activityBeat's first await continuation.
    release();
    const result = h.facade.activityBeat(closed ? { instanceId: BEAT.instanceId, pages: [], closed: true } : BEAT)
      .then(() => null, (error: unknown) => error);
    await signingIn;
    expect(h.facade.session()?.userId).toBe(WORLD.otherUser.userId);
    const outcome = await result;
    expect(h.hub.requests.filter((request) => request.route === 'clientActivity').map((request) => request.headers['authorization']))
      .not.toContain('Bearer synthetic-next-person-token');
    expect(outcome).toMatchObject({ failure: { kind: 'transport', failure: 'aborted' } });
    expect(h.hub.requests.filter((request) => request.route === 'clientActivity')).toEqual([]);
  });
});
