// Sign-in custody (architecture.md §8.2, §14; parity AU-*, HB-001, HB-004)
// against the fake hub's sign-in scenario, in-memory fetch and storage.

import { STORAGE_KEYS, isHubCallError, isHubCheckError, type CgCode } from '@cg/contracts';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW, NOW_MS, WORLD, at, streamBody } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthCustody } from '../src/auth';
import { errorWireOf, type HubStatus } from '../src/index';
import { SILENT_LOG, SYSTEM_CLOCK } from '../src/ports';
import { MemoryStore, hubError, json } from './support/fake-hub';
import { flush, makeHarness, signIn, until, type Harness } from './support/harness';
import { okBody, scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
const WORLD_PILOT = signInWorld(SIGN_IN, BOOTSTRAP_PILOT_ON, WORLD.user.username);
const ISSUED = okBody(SIGN_IN, 'authIssueDeviceTokenWithPassword') as { token: string; keyPrefix: string; expiresAt: string; label: string };
const TOKEN = ISSUED.token;
const PASSWORD = 'synthetic-password';

/** The CG code a rejected facade call shows (null: nothing to show). */
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

describe('[AU-001] [AU-005] [AU-006] [AU-008] [HB-004] sign-in with login and password', () => {
  it('[AU-001] [ST-046] [ST-052] asks for a narrow active token with the device label, then me, bootstrap and catalog', async () => {
    const left = h.hub.serve(SIGN_IN.exchanges.filter((exchange) => exchange.response.status === 200 && exchange.route !== 'health'));
    const session = await h.facade.signIn(WORLD.user.username, PASSWORD);
    await flush();
    expect(session).toEqual({ hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter', epoch: 1 });
    expect(h.facade.session()).toEqual(session);
    expect(h.hub.requests.map((request) => request.route)).toEqual(['authIssueDeviceTokenWithPassword', 'me', 'clientBootstrap', 'aiPersonaCatalog']);
    expect(h.hub.unexpected).toEqual([]);
    expect(left.left().map((exchange) => exchange.route)).toEqual([]);
  });

  it('[AU-006] [AU-007] [AU-008] [ST-047] writes token, hub address, user and metadata in ONE storage call', async () => {
    await signIn(h, WORLD_PILOT);
    const first = h.local.writes[0] ?? {};
    expect(Object.keys(first).sort()).toEqual([STORAGE_KEYS.authMeta, STORAGE_KEYS.authToken]);
    expect(first[STORAGE_KEYS.authToken]).toEqual({
      v: 1,
      token: TOKEN,
      hubOrigin: WORLD.hubOrigin,
      user: { userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter' },
      epoch: 1,
      narrow: true,
    });
    expect(first[STORAGE_KEYS.authMeta]).toEqual({
      v: 1,
      epoch: 1,
      token: { keyPrefix: ISSUED.keyPrefix, issuedAt: NOW, expiresAt: ISSUED.expiresAt, label: ISSUED.label, version: '0.2.0' },
      lastEnd: null,
    });
    expect(h.facade.status().token).toMatchObject({ keyPrefix: ISSUED.keyPrefix, label: ISSUED.label });
  });

  it('[AU-007] never logs the token or the password', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized'));
    await codeOf(h.facade.bootstrap({ force: true }));
    await h.facade.signOut();
    expect(h.logs.lines.length).toBeGreaterThan(0);
    expect(h.logs.text()).not.toContain(TOKEN);
    expect(h.logs.text()).not.toContain(PASSWORD);
    expect(JSON.stringify(h.facade.status())).not.toContain(TOKEN);
  });

  it('[ST-041] an invalid or plain-http hub address is refused before any request (CG-HUB-URL)', async () => {
    h.env.origin = 'http://hub.example.test';
    expect(await codeOf(h.facade.signIn(WORLD.user.username, PASSWORD))).toBe('CG-HUB-URL');
    h.env.origin = 'not a url';
    expect(await codeOf(h.facade.signIn(WORLD.user.username, PASSWORD))).toBe('CG-HUB-URL');
    expect(h.hub.requests).toEqual([]);
  });
});

describe('[AU-002] a pending answer is never stored', () => {
  it('[AU-002] refuses with CG-LOGIN-PENDING and keeps nothing', async () => {
    h.hub.on('authIssueDeviceTokenWithPassword', () =>
      json(200, { mode: 'pending', token: 'cgx_pending_0001', reservationId: 3, label: 'x', keyPrefix: 'cgx_pend', reservationExpiresAt: at(600) }),
    );
    expect(await codeOf(h.facade.signIn(WORLD.user.username, PASSWORD))).toBe('CG-LOGIN-PENDING');
    expect(h.local.writes).toEqual([]);
    expect(h.facade.session()).toBeNull();
    expect(h.hub.of('me')).toEqual([]);
  });
});

describe('[AU-004] sign-in timeout 20 s', () => {
  it('[AU-004] a token issued but `me` silent: timeout, and the issued token is revoked, nothing kept', async () => {
    h.hub
      .on('authIssueDeviceTokenWithPassword', () => json(200, WORLD_PILOT.issued))
      .on('me', () => 'hang')
      .on('authRevokeCurrentDeviceToken', () => json(200, { revoked: true }));
    const result = h.facade.signIn(WORLD.user.username, PASSWORD).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(errorWireOf(await result)?.code).toBe('CG-LOGIN-TIMEOUT');
    await flush();
    expect(h.hub.of('authRevokeCurrentDeviceToken')[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(h.local.writes).toEqual([]);
  });
});

describe('[AU-001] the narrow token echo (hub-pr-plan PR 9 rule)', () => {
  const fullToken = { ...WORLD_PILOT.issued, client: null };

  it('[AU-029] no `client` echo in a release build: the full token is revoked, CG-HUB-OUTDATED, nothing stored', async () => {
    await expect(signIn(h, { ...WORLD_PILOT, issued: fullToken })).rejects.toMatchObject({ name: 'HubCheckError', check: 'narrowTokenMissing', code: 'CG-HUB-OUTDATED' });
    await flush();
    expect(h.hub.of('authRevokeCurrentDeviceToken')).toHaveLength(1);
    expect(h.local.writes).toEqual([]);
    expect(h.hub.of('me')).toEqual([]);
  });

  it('[AU-029] an echo but a bootstrap of a full token (identity.tokenClient null): revoked, CG-HUB-OUTDATED', async () => {
    const bootstrap = { ...BOOTSTRAP_PILOT_ON, identity: { ...BOOTSTRAP_PILOT_ON.identity, tokenClient: null } };
    await expect(signIn(h, { ...WORLD_PILOT, bootstrap })).rejects.toMatchObject({ check: 'narrowTokenMissing' });
    await flush();
    expect(h.hub.of('authRevokeCurrentDeviceToken')).toHaveLength(1);
    expect(h.facade.session()).toBeNull();
  });

  it('[AU-029] a release build with debug mode on is still a release build: no `client` echo — the full token is revoked, nothing is stored', async () => {
    h.env.debug = true;
    await expect(signIn(h, { ...WORLD_PILOT, issued: fullToken })).rejects.toMatchObject({ name: 'HubCheckError', check: 'narrowTokenMissing', code: 'CG-HUB-OUTDATED' });
    await flush();
    expect(h.hub.of('authRevokeCurrentDeviceToken')).toHaveLength(1);
    expect(h.local.writes).toEqual([]);
    expect(h.facade.session()).toBeNull();
  });
});

describe('[AU-006] the sign-in write is atomic', () => {
  it('[AU-006] a failed write keeps nothing, revokes the issued token and says CG-STORAGE-WRITE', async () => {
    h.local.fail.set = 'CG-STORAGE-WRITE';
    await expect(signIn(h, WORLD_PILOT)).rejects.toMatchObject({ check: 'authWriteFailed', code: 'CG-STORAGE-WRITE' });
    await flush();
    expect(h.facade.session()).toBeNull();
    expect(h.hub.of('authRevokeCurrentDeviceToken')).toHaveLength(1);
  });
});

describe('[AU-009] sign-in transitions run one at a time', () => {
  it('[AU-009] a sign-out issued during a sign-in waits for it, then wipes it', async () => {
    const gate = deferred<Response>();
    h.hub
      .on('authIssueDeviceTokenWithPassword', () => gate.promise)
      .on('me', () => json(200, WORLD_PILOT.me))
      .on('clientBootstrap', () => json(200, BOOTSTRAP_PILOT_ON))
      .on('aiPersonaCatalog', () => json(200, WORLD_PILOT.catalog))
      .on('authRevokeCurrentDeviceToken', () => json(200, { revoked: true }));
    const signingIn = h.facade.signIn(WORLD.user.username, PASSWORD);
    const signingOut = h.facade.signOut();
    await flush();
    expect(h.changes).toEqual([]);
    gate.resolve(json(200, WORLD_PILOT.issued));
    await signingIn;
    expect(await signingOut).toEqual({ serverRevoked: true });
    expect(h.changes.map((change) => [change.reason, change.epoch])).toEqual([
      ['sign-in', 1],
      ['sign-out', 2],
    ]);
    expect(h.facade.session()).toBeNull();
  });
});

describe('[AU-010] [AU-011] [AU-015] the 401 rule', () => {
  it('[AU-010] [AU-015] a 401 token_revoked of the current token wipes the sign-in, bumps the epoch, cancels its calls', async () => {
    await signIn(h, WORLD_PILOT);
    const signal = h.facade.epochSignal();
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized', 'token_revoked'));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-AUTH-REVOKED');
    await flush(20);
    expect(h.facade.session()).toBeNull();
    expect(signal.aborted).toBe(true);
    expect(h.changes.at(-1)).toMatchObject({ session: null, reason: 'revoked', epoch: 2, code: 'CG-AUTH-REVOKED' });
    expect(h.local.data.has(STORAGE_KEYS.authToken)).toBe(false);
    const status: HubStatus = h.facade.status();
    expect(status.state).toBe('auth-failed');
    expect(status.lastEnd).toMatchObject({ reason: 'revoked', code: 'CG-AUTH-REVOKED' });
  });

  it('[AU-010] token_expired reads CG-AUTH-EXPIRED and wipes too', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized', 'token_expired'));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-AUTH-EXPIRED');
    await flush(20);
    expect(h.facade.session()).toBeNull();
    expect(h.facade.status().lastEnd).toMatchObject({ reason: 'expired', code: 'CG-AUTH-EXPIRED' });
  });

  it('[AU-011] a 401 without a reason is CG-AUTH-REJECTED and keeps the sign-in; a 403 never wipes', async () => {
    await signIn(h, WORLD_PILOT);
    h.hub.on('clientBootstrap', () => hubError(401, 'unauthorized'));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-AUTH-REJECTED');
    h.hub.on('clientBootstrap', () => hubError(403, 'forbidden', 'token_revoked'));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-HUB-FORBIDDEN');
    h.hub.on('clientBootstrap', () => json(401, '<html>proxy</html>'));
    expect(await codeOf(h.facade.bootstrap({ force: true }))).toBe('CG-AUTH-REJECTED');
    await flush(20);
    expect(h.facade.session()?.epoch).toBe(1);
    expect(h.changes.map((change) => change.reason)).toEqual(['sign-in']);
  });
});

describe('[AU-014] an answer to an old token never touches a newer sign-in', () => {
  it('[AU-014] [ST-048] a late 401 token_revoked of the replaced sign-in is ignored', async () => {
    await signIn(h, WORLD_PILOT);
    const late = deferred<Response>();
    const tokenB = 'cgx_synthetic_token_0002';
    h.hub
      .on('clientBootstrap', (request) => (request.headers['authorization'] === `Bearer ${TOKEN}` ? late.promise : json(200, BOOTSTRAP_PILOT_ON)))
      .on('authIssueDeviceTokenWithPassword', () => json(200, { ...WORLD_PILOT.issued, token: tokenB, keyPrefix: 'cgx_syn2' }));
    const oldCall = h.facade.bootstrap({ force: true }).catch((error: unknown) => error);
    await flush();
    const sessionB = await h.facade.signIn(WORLD.user.username, PASSWORD);
    expect(sessionB.epoch).toBe(2);
    await flush();
    // «Войти заново»: the replaced token is revoked where it was issued.
    expect(h.hub.of('authRevokeCurrentDeviceToken').map((request) => request.headers['authorization'])).toEqual([`Bearer ${TOKEN}`]);
    late.resolve(hubError(401, 'unauthorized', 'token_revoked'));
    const error = await oldCall;
    expect(isHubCallError(error) && error.epoch).toBe(1);
    expect(errorWireOf(error)).toBeNull();
    await flush(20);
    expect(h.facade.session()).toEqual(sessionB);
    expect((h.local.data.get(STORAGE_KEYS.authToken) as { token: string }).token).toBe(tokenB);
    expect(h.changes.map((change) => change.reason)).toEqual(['sign-in', 'sign-in']);
  });
});

describe('[AU-014] the 401 rule re-checks which sign-in is current, twice', () => {
  const tokenB = 'cgx_synthetic_token_0002';

  it('[AU-014] [AU-012] a late 401 token_revoked on the OLD sign-in\'s stream leaves the new sign-in intact', async () => {
    h = makeHarness({ paths: HUB_ROUTE_PATHS });
    await signIn(h, WORLD_PILOT);
    const late = deferred<Response>();
    h.hub
      .on('aiFeatureStream', () => late.promise)
      .on('authIssueDeviceTokenWithPassword', () => json(200, { ...WORLD_PILOT.issued, token: tokenB, keyPrefix: 'cgx_syn2' }));
    const request = { feature: 'fast-reply' as const, body: streamBody({ replyTone: 'none' }), capabilities: [] };
    // The stream keeps its own signal here: only the hub's late answer ends it.
    const oldStream = h.facade.stream(request, () => undefined, new AbortController().signal).catch((error: unknown) => error);
    await until(() => h.hub.of('aiFeatureStream').length === 1);
    const sessionB = await h.facade.signIn(WORLD.user.username, PASSWORD);
    expect(sessionB.epoch).toBe(2);
    late.resolve(hubError(401, 'unauthorized', 'token_revoked'));
    await oldStream;
    await flush(20);
    expect(h.facade.session()).toEqual(sessionB);
    expect((h.local.data.get(STORAGE_KEYS.authToken) as { token: string }).token).toBe(tokenB);
    expect(h.changes.map((change) => change.reason)).toEqual(['sign-in', 'sign-in']);
    expect(h.facade.status().lastEnd).toBeNull();
  });

  it('[AU-014] the custody refuses a report that names another epoch or another token before anything is queued', async () => {
    const local = new MemoryStore();
    const custody = new AuthCustody({ local, clock: SYSTEM_CLOCK, log: SILENT_LOG, configuredOrigin: () => 'https://hub.test' });
    await custody.load();
    const tokenMeta = { keyPrefix: 'cgx_syn1', issuedAt: NOW, expiresAt: NOW, label: 'Firefox · macOS · ChatSpace', version: '0.1.0' };
    const user = { userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter' as const };
    await custody.transition(() => custody.commitSignIn({ token: TOKEN, hubOrigin: 'https://hub.test', user, narrow: true, tokenMeta }));
    const writes = local.writes.length;
    // Nothing queued: the erase is not even put behind the transitions that run.
    expect(custody.reportUnauthorized(0, TOKEN, 'token_revoked')).toBe(false);
    expect(custody.reportUnauthorized(1, tokenB, 'token_revoked')).toBe(false);
    expect(custody.reportUnauthorized(1, TOKEN, null)).toBe(false);
    expect(custody.reportUnauthorized(1, TOKEN, 'something_else')).toBe(false);
    await flush(20);
    expect(custody.session()?.epoch).toBe(1);
    expect(local.writes).toHaveLength(writes);
    expect(custody.reportUnauthorized(1, TOKEN, 'token_expired')).toBe(true);
    await flush(20);
    expect(custody.session()).toBeNull();
    expect(custody.lastEnd()).toMatchObject({ reason: 'expired', code: 'CG-AUTH-EXPIRED' });
  });
});

describe('[AU-014] a late bootstrap of an older sign-in', () => {
  it('[AU-014] a refresh that lands after sign-out and a new sign-in is not adopted; the new sign-in keeps its own', async () => {
    await signIn(h, WORLD_PILOT);
    const late = deferred<Response>();
    const tokenB = 'cgx_synthetic_token_0002';
    const newer = { ...BOOTSTRAP_PILOT_ON, configRevision: BOOTSTRAP_PILOT_ON.configRevision + 1 };
    const older = { ...BOOTSTRAP_PILOT_ON, configRevision: BOOTSTRAP_PILOT_ON.configRevision + 7 };
    h.hub
      .on('clientBootstrap', (request) => (request.headers['authorization'] === `Bearer ${TOKEN}` ? late.promise : json(200, newer)))
      .on('authIssueDeviceTokenWithPassword', () => json(200, { ...WORLD_PILOT.issued, token: tokenB, keyPrefix: 'cgx_syn2' }));
    const oldRefresh = h.facade.bootstrap({ force: true }).catch((error: unknown) => error);
    await flush();
    await h.facade.signOut();
    await h.facade.signIn(WORLD.user.username, PASSWORD);
    expect(h.facade.cachedBootstrap()?.bootstrap.configRevision).toBe(newer.configRevision);
    late.resolve(json(200, older));
    await oldRefresh;
    await flush(20);
    expect(h.facade.cachedBootstrap()?.bootstrap.configRevision).toBe(newer.configRevision);
    expect(h.facade.status().state).toBe('live');
  });
});

describe('[AU-013] sign-out: erase → revoke (5 s) → erase again', () => {
  it('[AU-013] [ST-051] the local sign-in is gone before the revoke is asked; the revoke carries the old token', async () => {
    await signIn(h, WORLD_PILOT);
    let storedDuringRevoke: boolean | null = null;
    h.hub.on('authRevokeCurrentDeviceToken', () => {
      storedDuringRevoke = h.local.data.has(STORAGE_KEYS.authToken);
      return json(200, { revoked: true });
    });
    expect(await h.facade.signOut()).toEqual({ serverRevoked: true });
    expect(storedDuringRevoke).toBe(false);
    expect(h.hub.of('authRevokeCurrentDeviceToken')[0]).toMatchObject({ method: 'DELETE', headers: { authorization: `Bearer ${TOKEN}` } });
    expect(h.local.removals.filter((keys) => keys.includes(STORAGE_KEYS.authToken))).toHaveLength(2);
    expect(h.facade.session()).toBeNull();
    expect(h.facade.status()).toMatchObject({ state: 'off', lastEnd: { reason: 'sign-out', code: null } });
  });
});

describe('[AU-016] [AU-021] [HB-001] the sign-in is bound to the hub address', () => {
  it('[AU-016] [ST-042] another hub address in the settings: mismatch, calls refused, sign-out revokes at the issuing hub', async () => {
    await signIn(h, WORLD_PILOT);
    h.env.origin = 'https://other-hub.example.test';
    expect(h.facade.session()).toBeNull();
    expect(h.facade.status()).toMatchObject({ auth: 'mismatch', state: 'auth-failed' });
    expect(await codeOf(h.facade.bootstrap())).toBe('CG-AUTH-REQUIRED');
    await h.facade.signOut();
    expect(h.hub.of('authRevokeCurrentDeviceToken')[0]?.origin).toBe(WORLD.hubOrigin);
    expect(h.facade.status().auth).toBe('none');
  });
});
