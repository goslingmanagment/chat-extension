// Bootstrap (architecture.md §8.3, H-2): fetch, cache, refresh, binding,
// flags, status, health and the DEV-ONLY compat mode (parity AU-022…AU-025,
// HB-002, HB-003, HB-005…HB-008, HB-011).

import { readFileSync } from 'node:fs';

import { STORAGE_KEYS, isHubCallError, isHubCheckError, type Bootstrap, type CgCode, type HostAccount } from '@cg/contracts';
import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMPAT_LIMITS,
  VENDORED_CONTRACT_HASH,
  compareVersions,
  errorWireOf,
  flagState,
  resolveBinding,
  synthesizeCompatBootstrap,
} from '../src/index';
import { MemoryStore, hubError, json, testEnv } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const HEALTH = okBody(SIGN_IN, 'health') as Record<string, unknown>;
const { one, vip } = WORLD.pages;

async function codeOf(promise: Promise<unknown>): Promise<CgCode | null> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
  if (!isHubCallError(error) && !isHubCheckError(error)) throw error as Error;
  return errorWireOf(error)?.code ?? null;
}

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
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[HB-011] [AU-022] the bootstrap and its cache', () => {
  it('[HB-011] is read at sign-in and served from the cache for ttlSec; force, another revision and expiry read again', async () => {
    await signIn(h, WORLD_PILOT);
    const count = () => h.hub.of('clientBootstrap').length;
    expect(count()).toBe(1);
    expect((await h.facade.bootstrap()).configRevision).toBe(BOOTSTRAP_PILOT_ON.configRevision);
    expect(await h.facade.bootstrap({ ifRevision: BOOTSTRAP_PILOT_ON.configRevision })).toEqual(BOOTSTRAP_PILOT_ON);
    expect(count()).toBe(1);
    await h.facade.bootstrap({ ifRevision: 99 });
    expect(count()).toBe(2);
    await h.facade.bootstrap({ force: true });
    expect(count()).toBe(3);
    // ttlSec 300 from the last read: the expiry refresh runs by itself.
    await vi.advanceTimersByTimeAsync(299_000);
    expect(count()).toBe(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(count()).toBe(4);
  });

  it('[AU-022] [ST-053] the cache is marked with its owner: hub, user and sign-in epoch', async () => {
    await signIn(h, WORLD_PILOT);
    expect(h.local.data.get(STORAGE_KEYS.cacheBootstrap)).toMatchObject({ v: 1, source: 'hub', epoch: 1, hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId });
    // Another sign-in never sees it: the epoch differs.
    await h.facade.signOut();
    expect(h.local.data.has(STORAGE_KEYS.cacheBootstrap)).toBe(false);
    expect(h.facade.cachedBootstrap()).toBeNull();
  });

  it('[HB-011] two refreshes of one sign-in share one request', async () => {
    await signIn(h, WORLD_PILOT);
    const [a, b] = await Promise.all([h.facade.bootstrap({ force: true }), h.facade.bootstrap({ force: true })]);
    expect(a).toEqual(b);
    expect(h.hub.of('clientBootstrap')).toHaveLength(2);
  });

  it('[HB-011] focus refreshes at most once per 60 s', async () => {
    await signIn(h, WORLD_PILOT);
    h.facade.notifyFocus();
    await flush();
    h.facade.notifyFocus();
    await flush();
    expect(h.hub.of('clientBootstrap')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(59_000);
    h.facade.notifyFocus();
    await flush();
    expect(h.hub.of('clientBootstrap')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    h.facade.notifyFocus();
    await flush();
    expect(h.hub.of('clientBootstrap')).toHaveLength(3);
  });

  it('[HB-011] an expired bootstrap whose refresh fails keeps its results readable but blocks taking new work', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => hubError(503, 'service_unavailable'));
    await vi.advanceTimersByTimeAsync(300_000);
    const cached = h.facade.cachedBootstrap();
    expect(cached).toMatchObject({ source: 'hub', fresh: false });
    expect(h.facade.status().state).toBe('degraded');
    const dispatch = {
      pageLabel: one.pageLabel,
      fanRef: WORLD.fan,
      body: {
        action: 'dispatch' as const,
        attemptId: '00000000-0000-4000-8000-000000000a01',
        instanceId: WORLD.instanceId,
        purpose: 'preview-reply' as const,
        group: { generationRef: '00000000-0000-4000-8000-000000000200', variant: 0, partCount: 1 },
        partIndex: 0,
        textRevision: 0,
        flagRevision: 4,
      },
    };
    expect(await codeOf(h.facade.claim(dispatch))).toBe('CG-HUB-UNAVAILABLE');
    expect(h.hub.of('clientFanClaim')).toEqual([]);
    // A read still runs on the expired bootstrap.
    h.hub.on('clientFanClaimStatus', () => json(200, { greeting: { state: 'none', at: null, messageRef: null, source: null }, lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null }, group: null, custody: null, serverNow: '2026-10-03T10:05:00.000Z', flagRevision: 4 }));
    await expect(h.facade.claimStatus(one.pageLabel, WORLD.fan)).resolves.toMatchObject({ flagRevision: 4 });
  });

  it('[HB-006] an answer that fails its schema is a hub failure (CG-HUB-REQUEST), never data', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, ttlSec: 'soon' }));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-HUB-REQUEST');
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, identity: { ...BOOTSTRAP_PILOT_ON.identity, userId: WORLD.otherUser.userId } }));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-HUB-REQUEST');
    h.hub.on('clientBootstrap', () => new Response('not json', { status: 200 }));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-HUB-REQUEST');
    expect(h.facade.cachedBootstrap()?.bootstrap).toEqual(BOOTSTRAP_PILOT_ON);
  });

  it('[HB-011] an unknown bootstrap protocol is CG-HUB-OUTDATED; a minVersion above ours stops AI', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, protocol: 2 }));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-HUB-OUTDATED');
    expect(h.facade.status().state).toBe('stopped');
    h.hub.on('clientBootstrap', () => json(200, { ...BOOTSTRAP_PILOT_ON, minVersion: '0.3.0' }));
    await h.facade.bootstrap({ force: true });
    expect(h.facade.status().state).toBe('stopped');
  });

  it('[HB-011] open vocabularies: an unknown flag, capability, platform or role never breaks the parse', async () => {
    const bootstrap = {
      ...BOOTSTRAP_PILOT_ON,
      flags: { ...BOOTSTRAP_PILOT_ON.flags, someFutureFlag: true },
      capabilities: [...BOOTSTRAP_PILOT_ON.capabilities, 'future-v9'],
      identity: { ...BOOTSTRAP_PILOT_ON.identity, role: 'auditor' },
      pages: [...BOOTSTRAP_PILOT_ON.pages, { ...BOOTSTRAP_PILOT_ON.pages[0], pageId: 99, pageLabel: 'tiktok-page', platform: 'tiktok', platformAccountId: '9999' }],
    };
    await signIn(h, { ...WORLD_PILOT, bootstrap });
    expect(h.facade.cachedBootstrap()?.bootstrap.pages).toHaveLength(4);
    expect(h.facade.resolveBinding(account({ hostAccountId: '1009', platformAccountId: '9999' }))).toEqual({ state: 'refused', check: 'bindingMissing' });
  });
});

describe('[AU-023] [AU-024] [AU-025] binding a host account to a hub page', () => {
  it('[AU-025] signed out → signed-out; signed in without a bootstrap → loading', async () => {
    expect(h.facade.resolveBinding(account())).toEqual({ state: 'signed-out' });
    h.hub
      .on('authIssueDeviceTokenWithPassword', () => json(200, WORLD_PILOT.issued))
      .on('me', () => json(200, WORLD_PILOT.me))
      .on('aiPersonaCatalog', () => json(200, WORLD_PILOT.catalog))
      .on('clientBootstrap', () => hubError(503, 'service_unavailable'));
    await h.facade.signIn(WORLD.user.username, 'synthetic-password');
    expect(h.facade.resolveBinding(account())).toEqual({ state: 'loading' });
  });

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

describe('[HB-011] flags, page features and capabilities (§4.12)', () => {
  it('[HB-011] a flag is usable only when on, available on the page and backed by every capability', async () => {
    expect(flagState(BOOTSTRAP_PILOT_ON, 'stats', one.pageLabel)).toEqual({ usable: true, reason: null });
    expect(flagState(BOOTSTRAP_PILOT_ON, 'previewSend', one.pageLabel)).toEqual({ usable: false, reason: 'flag_off' });
    expect(flagState(BOOTSTRAP_PILOT_ON, 'stats', 'not-my-page')).toEqual({ usable: false, reason: 'not_granted' });
    expect(flagState(BOOTSTRAP_PILOT_ON, 'stats', WORLD.pages.fansly.pageLabel)).toEqual({ usable: false, reason: 'platform_unsupported' });
    expect(flagState(BOOTSTRAP_ALL_OFF, 'coach', one.pageLabel)).toEqual({ usable: false, reason: 'flag_off' });
    const noCapability: Bootstrap = { ...BOOTSTRAP_PILOT_ON, capabilities: [] };
    expect(flagState(noCapability, 'stats', one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(flagState(noCapability, 'insertion', null)).toEqual({ usable: true, reason: null });
    const silentPage: Bootstrap = { ...BOOTSTRAP_PILOT_ON, pages: BOOTSTRAP_PILOT_ON.pages.map((page) => ({ ...page, features: {} })) };
    expect(flagState(silentPage, 'sound', one.pageLabel)).toEqual({ usable: false, reason: 'disabled' });
    expect(h.facade.flagState('sound', null)).toEqual({ usable: false, reason: 'hub_not_ready' });
    await signIn(h, WORLD_PILOT);
    expect(h.facade.flagState('sound', one.pageLabel)).toEqual({ usable: true, reason: null });
  });

  it('[HB-011] versions compare numerically; an unreadable one compares as unknown', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.3.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBeNull();
  });
});

describe('[HB-003] [HB-005] [HB-007] status and the SDK contract', () => {
  it('[HB-005] the vendored contract hash is the pinned one of the vendoring manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../vendor/kernel-sdk/kernel-sdk.vendor.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(manifest)).toContain(VENDORED_CONTRACT_HASH);
    expect(h.facade.status().sdk).toEqual({ vendoredHash: VENDORED_CONTRACT_HASH, hubHash: null, compatible: null });
  });

  it('[HB-007] [ST-055] a hub that does not list our SDK is shown, never blocking; a listed one is compatible', async () => {
    h.hub.on('health', () => json(200, HEALTH));
    await h.facade.health();
    expect(h.facade.status().sdk).toEqual({ vendoredHash: VENDORED_CONTRACT_HASH, hubHash: HEALTH['contractHash'], compatible: false });
    await signIn(h, WORLD_PILOT);
    expect(h.facade.status().state).toBe('live');
    h.hub.on('health', () => json(200, { ...HEALTH, compatibleClientSdks: [VENDORED_CONTRACT_HASH] }));
    await h.facade.health();
    expect(h.facade.status().sdk.compatible).toBe(true);
    const { compatibleClientSdks: _gone, ...older } = HEALTH;
    h.hub.on('health', () => json(200, older));
    await h.facade.health();
    expect(h.facade.status().sdk.compatible).toBeNull();
  });

  it('[HB-003] a degraded hub (health 503 with its own shape) is an answer, not an error; a dead one is unreachable', async () => {
    h.hub.on('health', () => json(503, { ...HEALTH, status: 'degraded', checks: { api: { status: 'ok' }, database: { status: 'error', latencyMs: null, error: 'down' } } }));
    await expect(h.facade.health()).resolves.toMatchObject({ status: 'degraded' });
    expect(h.facade.status().reachable).toBe(true);
    h.hub.on('health', () => 'network-error');
    expect(await codeOf(h.facade.health())).toBe('CG-NETWORK');
    expect(h.facade.status()).toMatchObject({ reachable: false });
    expect(h.facade.status().lastCheckedAt).not.toBeNull();
  });

  it('[HB-003] [ST-044] [ST-054] [ST-056] off → connecting → live → degraded → auth-failed', async () => {
    expect(h.facade.status().state).toBe('off');
    await signIn(h, WORLD_PILOT);
    expect(h.facade.status().state).toBe('live');
    // A background restart with the bootstrap still on its way: connecting.
    const restarted = makeHarness({ paths: HUB_ROUTE_PATHS, local: new MemoryStore({ [STORAGE_KEYS.authToken]: h.local.data.get(STORAGE_KEYS.authToken), [STORAGE_KEYS.authMeta]: h.local.data.get(STORAGE_KEYS.authMeta) }) });
    restarted.hub.on('clientBootstrap', () => 'hang').on('aiPersonaCatalog', () => 'hang');
    await restarted.facade.ready;
    expect(restarted.facade.status().state).toBe('connecting');
    restarted.facade.dispose();
    h.hub.on('clientBootstrap', () => hubError(500, 'internal_error'));
    await codeOf(h.facade.bootstrap({ force: true }));
    expect(h.facade.status()).toMatchObject({ state: 'degraded', lastError: { code: 'CG-HUB-UNAVAILABLE' } });
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized', 'token_revoked'));
    await codeOf(h.facade.bootstrap({ force: true }));
    await flush(20);
    expect(h.facade.status().state).toBe('auth-failed');
  });

  it('[HB-002] [ST-045] [ST-058] «Проверить связь» reads health, bootstrap and catalog; a 401 with a reason heals through the usual rule', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('health', () => json(200, HEALTH));
    const report = await h.facade.checkConnection();
    expect(report).toEqual({ checkedAt: new Date(NOW_MS).toISOString(), health: { ok: true }, bootstrap: { ok: true }, catalog: { ok: true } });
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized', 'token_revoked')).on('aiPersonaCatalog', () => hubError(401, 'unauthorized', 'token_revoked'));
    const failed = await h.facade.checkConnection();
    expect(failed.bootstrap).toEqual({ ok: false, error: { code: 'CG-AUTH-REVOKED', detail: 'HTTP 401 • unauthorized/token_revoked', httpStatus: 401 } });
    await flush(20);
    expect(h.facade.session()).toBeNull();
    expect(h.changes.filter((change) => change.reason === 'revoked')).toHaveLength(1);
  });

  it('[HB-008] deadlines are our clock plus the hub\'s delay; a skewed hub clock never shifts ours', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => json(429, { error: 'rate_limit_exceeded', message: 'x', statusCode: 429 }, { 'retry-after': '30', date: 'Mon, 01 Jan 2024 00:00:00 GMT' }));
    const error = await h.facade.bootstrap({ force: true }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)).toMatchObject({ code: 'CG-HUB-RATE-LIMIT', retryAt: NOW_MS + 30_000 });
    h.hub.on('clientBootstrap', () => json(429, { error: 'rate_limit_exceeded', message: 'x', statusCode: 429 }, { 'retry-after': new Date(NOW_MS + 45_000).toUTCString() }));
    expect(errorWireOf(await h.facade.bootstrap({ force: true }).catch((reason: unknown) => reason))).toMatchObject({ retryAt: NOW_MS + 45_000 });
  });
});

describe('[HB-011] the DEV-ONLY compat mode for a hub without client/bootstrap (prod today)', () => {
  const PAGES = [
    { id: one.pageId, label: one.pageLabel, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One', username: 'm1', displayName: 'Model One', followerCount: { value: null, available: false }, subscriberCount: { value: 120, available: true }, lastLightSyncAt: null, lastFollowerSyncAt: null },
    { id: WORLD.pages.fansly.pageId, label: WORLD.pages.fansly.pageLabel, platform: 'fansly', modelSlug: 'model-two', modelName: 'Model Two', username: null, displayName: null, followerCount: { value: null, available: false }, subscriberCount: { value: 120, available: true }, lastLightSyncAt: null, lastFollowerSyncAt: null },
  ];
  const serveOldHub = (harness: Harness, issued: Record<string, unknown> = { ...WORLD_PILOT.issued, client: null }) => {
    harness.hub
      .on('authIssueDeviceTokenWithPassword', () => json(200, issued))
      .on('me', () => json(200, WORLD_PILOT.me))
      .on('clientBootstrap', () => hubError(404, 'not_found'))
      .on('aiPersonaCatalog', () => json(200, WORLD_PILOT.catalog))
      .on('authRevokeCurrentDeviceToken', () => json(200, { revoked: true }))
      .use((request) => (request.path === '/api/v1/pages' ? json(200, PAGES) : undefined));
  };

  it('[HB-011] a release build refuses: CG-HUB-OUTDATED, the token revoked', async () => {
    serveOldHub(h, WORLD_PILOT.issued);
    expect(await codeOf(h.facade.signIn(WORLD.user.username, 'synthetic-password'))).toBe('CG-HUB-OUTDATED');
    await flush();
    expect(h.facade.session()).toBeNull();
    expect(h.hub.of('authRevokeCurrentDeviceToken')).toHaveLength(1);
    expect(h.hub.requests.some((request) => request.path === '/api/v1/pages')).toBe(false);
  });

  it('[HB-011] debug on: a bootstrap synthesized from me + pages; every feature that needs a new route is hub_not_ready', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, env: testEnv({ debug: true }), compatPageAccounts: { [one.pageLabel]: one.platformAccountId } });
    serveOldHub(h);
    await h.facade.signIn(WORLD.user.username, 'synthetic-password');
    const cached = h.facade.cachedBootstrap();
    expect(cached?.source).toBe('compat');
    const bootstrap = cached?.bootstrap;
    expect(bootstrap?.capabilities).toEqual([]);
    expect(bootstrap?.identity).toMatchObject({ userId: WORLD.user.userId, tokenClient: null });
    expect(bootstrap?.limits).toEqual(COMPAT_LIMITS);
    expect(bootstrap?.pages[0]?.features['stats']).toEqual({ available: false, reason: 'hub_not_ready' });
    expect(bootstrap?.pages[0]?.features['insertion']).toEqual({ available: true });
    expect(bootstrap?.pages[0]?.features['previewSend']).toEqual({ available: false, reason: 'hub_not_ready' });
    expect(bootstrap?.pages[1]?.features['insertion']).toEqual({ available: false, reason: 'platform_unsupported' });
    // What the UI reads: «хаб не готов», never «выключено владельцем».
    expect(h.facade.flagState('stats', one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('stats', null)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('recap', one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('previewSend', one.pageLabel)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('previewSend', null)).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(h.facade.flagState('previewSendMarkAiGenerated', null)).toEqual({ usable: false, reason: 'flag_off' });
    expect(h.facade.flagState('insertion', one.pageLabel)).toEqual({ usable: true, reason: null });
    expect(h.facade.flagState('review', one.pageLabel)).toEqual({ usable: true, reason: null });
    expect(h.facade.status()).toMatchObject({ compat: true, bootstrap: { source: 'compat' }, state: 'degraded' });
    expect(h.facade.resolveBinding(account())).toMatchObject({ state: 'bound', binding: { pageId: one.pageId } });
    // New routes are never asked of such a hub: refused locally.
    expect(await codeOf(h.facade.feed({ pageLabel: one.pageLabel, fanRef: WORLD.fan, limit: 50 }))).toBe('CG-HUB-CAPABILITY');
    expect(h.hub.of('clientConversationFeed')).toEqual([]);
  });

  it('[HB-011] a test build allows it too; turning debug off in a release build drops the compat bootstrap', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS, env: testEnv({ testBuild: true }) });
    serveOldHub(h);
    await h.facade.signIn(WORLD.user.username, 'synthetic-password');
    expect(h.facade.cachedBootstrap()?.source).toBe('compat');
    const page = h.facade.cachedBootstrap()?.bootstrap.pages[0];
    expect(page?.platformAccountId).toBeNull();
    // Without an injected creator id nothing binds (never by name).
    expect(h.facade.resolveBinding(account())).toEqual({ state: 'refused', check: 'bindingMissing' });
    h.env.testBuild = false;
    h.env.debug = false;
    expect(h.facade.cachedBootstrap()).toBeNull();
  });

  it('[HB-011] the synthesized bootstrap is a valid bootstrap of protocol 1', () => {
    const bootstrap = synthesizeCompatBootstrap({
      me: WORLD_PILOT.me as never,
      pages: [{ id: 1, label: 'p', platform: 'onlyfans', modelName: 'M', displayName: null }],
      issuedAt: new Date(NOW_MS).toISOString(),
      pageAccounts: { p: '3003' },
    });
    expect(bootstrap).toMatchObject({ protocol: 1, configRevision: 0, minVersion: '0.0.0', pages: [{ title: 'M', platformAccountId: '3003', bindingRevision: 0 }] });
    // The owner's switches stay on; what the hub cannot do is unavailable on the page (hub_not_ready).
    expect(bootstrap.flags['coach']).toBe(true);
    expect(bootstrap.flags['recap']).toBe(true);
    expect(bootstrap.flags['previewSend']).toBe(true);
    expect(bootstrap.flags['previewSendMarkAiGenerated']).toBe(false);
    expect(bootstrap.pages[0]?.features['recap']).toEqual({ available: false, reason: 'hub_not_ready' });
    expect(bootstrap.pages[0]?.features['previewSend']).toEqual({ available: false, reason: 'hub_not_ready' });
    expect(flagState(bootstrap, 'previewSend', null)).toEqual({ usable: false, reason: 'hub_not_ready' });
  });
});
