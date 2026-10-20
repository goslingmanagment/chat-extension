// Bootstrap (architecture.md §8.3, H-2): a stored bootstrap of an older sign-in is never adopted, and a host account
// binds to exactly one hub page — never by name, never across a changed sign-in, page or binding revision (parity
// AU-022…AU-025).

import { STORAGE_KEYS, type Bootstrap, type HostAccount } from '@cg/contracts';
import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveBinding } from '../src/index';
import { json } from './support/fake-hub';
import { makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const { one, vip } = WORLD.pages;

const account = (over: Partial<HostAccount> = {}): HostAccount => ({
  host: 'chatspace',
  hostAccountId: one.hostAccountId,
  platform: 'onlyfans',
  platformAccountId: one.platformAccountId,
  username: null,
  displayName: null,
  ...over,
});

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[HB-011] [AU-022] the bootstrap and its cache', () => {
  it('[AU-022] a stored bootstrap of an older sign-in epoch is ignored at start', async () => {
    await signIn(h, WORLD_PILOT);
    const stored = h.local.data.get(STORAGE_KEYS.cacheBootstrap) as Record<string, unknown>;
    h.local.data.set(STORAGE_KEYS.cacheBootstrap, { ...stored, epoch: 0 });
    const restarted = makeHarness({ paths: HUB_ROUTE_PATHS, local: h.local, hub: h.hub });
    h.hub.on('clientBootstrap', () => 'hang');
    await restarted.facade.ready;
    expect(restarted.facade.session()?.epoch).toBe(1);
    expect(restarted.facade.cachedBootstrap()).toBeNull();
    expect(restarted.facade.status().state).toBe('connecting');
    restarted.facade.dispose();
  });
});

describe('[AU-023] [AU-024] [AU-025] binding a host account to a hub page', () => {
  it('[AU-023] the owner\'s explicit bindingsByHost entry wins; the binding carries the page\'s platformAccountId', async () => {
    await signIn(h, WORLD_PILOT);
    const resolved = h.facade.resolveBinding(account({ hostAccountId: vip.hostAccountId, platformAccountId: vip.platformAccountId }));
    expect(resolved).toEqual({
      state: 'bound',
      binding: {
        hubOrigin: WORLD.hubOrigin,
        principalId: WORLD.user.userId,
        loginEpoch: 1,
        host: 'chatspace',
        hostAccountId: vip.hostAccountId,
        platform: 'onlyfans',
        platformAccountId: vip.platformAccountId,
        pageId: vip.pageId,
        pageLabel: vip.pageLabel,
        bindingRevision: vip.bindingRevision,
      },
    });
    // The explicit entry binds even before the host knows the account's creator id.
    expect(h.facade.resolveBinding(account({ platformAccountId: null }))).toMatchObject({ state: 'bound', binding: { pageId: one.pageId, platformAccountId: one.platformAccountId } });
    // …but an account the host knows as another creator is ambiguous, never silently bound.
    expect(h.facade.resolveBinding(account({ platformAccountId: vip.platformAccountId }))).toEqual({ state: 'refused', check: 'bindingAmbiguous' });
  });

  it('[AU-023] without an explicit entry: exactly one page with the same platformAccountId, never by name', async () => {
    await signIn(h, { ...WORLD_PILOT, bootstrap: BOOTSTRAP_ALL_OFF });
    expect(h.facade.resolveBinding(account({ hostAccountId: '1005' }))).toMatchObject({ state: 'bound', binding: { pageId: one.pageId } });
    // A display name equal to a page's label or title binds nothing.
    expect(h.facade.resolveBinding(account({ hostAccountId: '1006', platformAccountId: '3999', username: one.pageLabel, displayName: one.title }))).toEqual({
      state: 'refused',
      check: 'bindingMissing',
    });
    expect(h.facade.resolveBinding(account({ hostAccountId: '1007', platformAccountId: null }))).toEqual({ state: 'loading' });
  });

  it('[AU-023] two pages with one platformAccountId are ambiguous; an explicit entry to a missing page is missing', () => {
    const session = { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter' as const, epoch: 1 };
    const twin: Bootstrap = { ...BOOTSTRAP_ALL_OFF, pages: [...BOOTSTRAP_ALL_OFF.pages, { ...BOOTSTRAP_ALL_OFF.pages[0]!, pageId: 21, pageLabel: 'model-one-copy' }] };
    expect(resolveBinding(twin, session, account({ hostAccountId: '1008' }))).toEqual({ state: 'refused', check: 'bindingAmbiguous' });
    const dangling: Bootstrap = { ...BOOTSTRAP_ALL_OFF, bindingsByHost: { 'onlymonster:1001': 404 } };
    expect(resolveBinding(dangling, session, account())).toEqual({ state: 'refused', check: 'bindingMissing' });
    const crossPlatform: Bootstrap = { ...BOOTSTRAP_ALL_OFF, bindingsByHost: { 'onlymonster:1001': WORLD.pages.fansly.pageId } };
    expect(resolveBinding(crossPlatform, session, account())).toEqual({ state: 'refused', check: 'bindingAmbiguous' });
    // …even when that page of the other platform carries the very creator id the host knows.
    const crossSameAccount: Bootstrap = {
      ...crossPlatform,
      pages: crossPlatform.pages.map((page) => (page.pageId === WORLD.pages.fansly.pageId ? { ...page, platformAccountId: one.platformAccountId } : page)),
    };
    expect(resolveBinding(crossSameAccount, session, account())).toEqual({ state: 'refused', check: 'bindingAmbiguous' });
    const noAccount: Bootstrap = { ...BOOTSTRAP_ALL_OFF, bindingsByHost: { 'onlymonster:1001': one.pageId }, pages: BOOTSTRAP_ALL_OFF.pages.map((page) => ({ ...page, platformAccountId: null })) };
    expect(resolveBinding(noAccount, session, account())).toEqual({ state: 'refused', check: 'bindingMissing' });
  });

  it('[AU-024] a binding holds only while the sign-in, the page and its binding revision are the same', async () => {
    await signIn(h, WORLD_PILOT);
    const resolved = h.facade.resolveBinding(account());
    if (resolved.state !== 'bound') throw new Error('not bound');
    expect(h.facade.bindingHolds(resolved.binding)).toBe(true);
    const moved = { ...BOOTSTRAP_PILOT_ON, pages: BOOTSTRAP_PILOT_ON.pages.map((page) => (page.pageId === one.pageId ? { ...page, bindingRevision: page.bindingRevision + 1 } : page)) };
    h.hub.on('clientBootstrap', () => json(200, moved));
    await h.facade.bootstrap({ force: true });
    expect(h.facade.bindingHolds(resolved.binding)).toBe(false);
    await h.facade.signOut();
    expect(h.facade.bindingHolds(resolved.binding)).toBe(false);
  });
});
