// Sign-in and tokens as the fake hub models them (architecture.md §8.2; hub
// H-3): the narrow `chat-extension` token and its echo (a hub without H-3
// drops `client`), the narrow allow-list, wrong password and the sign-in rate
// limit, pending reservations, revoke and expiry with their 401 reasons, the
// revoke of exactly the bearer. Tokens never reach the journal or the status.

import { DeviceTokenIssueResponseSchema } from '@cg/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { WORLD } from '../scenarios/hub';
import { SIGN_IN_FAILURES_PER_MINUTE } from './auth';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall } from './kit';

const signIn = (over: Record<string, unknown> = {}) => ({ username: WORLD.user.username, password: 'synthetic-password', label: 'Firefox · macOS · ChatSpace', mode: 'active', client: 'chat-extension', ...over });

let hub: FakeHub;
const call = (route: Parameters<typeof hubCall>[2], request: unknown, token?: string | null): Promise<Response> => hubCall(hub.fetch, hub.origin, route, request, { token: token ?? null });

async function error(response: Response): Promise<{ status: number; error: string; reason: string | undefined }> {
  const body = (await response.json()) as { error: string; reason?: string };
  return { status: response.status, error: body.error, reason: body.reason };
}

async function issue(over: Record<string, unknown> = {}): Promise<{ token: string; client?: string | null; mode: string }> {
  const response = await call('authIssueDeviceTokenWithPassword', signIn(over));
  expect(response.status).toBe(200);
  const body = (await response.json()) as { token: string; client?: string | null; mode: string };
  expect(DeviceTokenIssueResponseSchema.safeParse(body).success).toBe(true);
  return body;
}

beforeEach(() => {
  hub = createFakeHub();
});

describe('fake hub auth: sign-in (H-3)', () => {
  it('a hub with H-3 issues a narrow token and echoes `client`; bootstrap names it', async () => {
    const answer = await issue();
    expect(answer).toMatchObject({ mode: 'active', client: 'chat-extension' });
    const boot = (await (await call('clientBootstrap', null, answer.token)).json()) as { identity: { tokenClient: string | null } };
    expect(boot.identity.tokenClient).toBe('chat-extension');
  });

  it('a hub without H-3 drops `client`: a full token, no echo key at all', async () => {
    hub.control({ op: 'config', patch: { narrowTokens: false } });
    const answer = await issue();
    expect('client' in answer).toBe(false);
    const boot = (await (await call('clientBootstrap', null, answer.token)).json()) as { identity: { tokenClient: string | null } };
    expect(boot.identity.tokenClient).toBeNull();
  });

  it('a sign-in without `client` is a full token even with H-3 (the echo is null)', async () => {
    const answer = await issue({ client: undefined });
    expect(answer.client).toBeNull();
  });

  it('the narrow token reaches only its allow-list: a forbidden operation is 403, a full token gets 404 (journaled forbidden both times)', async () => {
    const narrow = hub.issueToken();
    const full = hub.issueToken({ client: null });
    const mark = hub.journal.mark();
    const ofapi = (token: string) => hub.fetch(`${hub.origin}/api/v1/ofapi/read/chats`, { headers: { authorization: `Bearer ${token}` } });
    expect(await error(await ofapi(narrow))).toEqual({ status: 403, error: 'forbidden', reason: undefined });
    expect(await error(await ofapi(full))).toEqual({ status: 404, error: 'not_found', reason: undefined });
    expect(hub.read(mark).entries.map((entry) => [entry.kind, entry.operation, entry.token?.client ?? null])).toEqual([
      ['forbidden', 'ofapi', 'chat-extension'],
      ['forbidden', 'ofapi', null],
    ]);
  });

  it('wrong password and unknown user are 401; the sign-in rate limit is 429 with Retry-After, and lifts after a minute', async () => {
    expect(await error(await call('authIssueDeviceTokenWithPassword', signIn({ username: 'nobody' })))).toEqual({ status: 401, error: 'unauthorized', reason: undefined });
    for (let i = 1; i < SIGN_IN_FAILURES_PER_MINUTE; i += 1) {
      expect((await call('authIssueDeviceTokenWithPassword', signIn({ password: 'wrong' }))).status).toBe(401);
    }
    hub.control({ op: 'clock', advanceMs: 1_000 });
    const limited = await call('authIssueDeviceTokenWithPassword', signIn({ password: 'wrong' }));
    expect(limited.status).toBe(401);
    const blocked = await call('authIssueDeviceTokenWithPassword', signIn());
    expect(await error(blocked.clone())).toEqual({ status: 429, error: 'rate_limit_exceeded', reason: undefined });
    expect(Number(blocked.headers.get('retry-after'))).toBe(59);
    hub.control({ op: 'clock', advanceMs: 60_000 });
    await issue();
  });

  it('a pending reservation is never usable (401 without a reason)', async () => {
    const pending = await issue({ mode: 'pending', client: undefined });
    expect(pending).toMatchObject({ mode: 'pending' });
    expect(await error(await call('me', null, pending.token))).toEqual({ status: 401, error: 'unauthorized', reason: undefined });
    expect(hub.status().tokens.map((token) => token.state)).toEqual(['pending']);
  });

  it('a request that fails the sign-in schema is 400 and its issues name no value', async () => {
    const response = await call('authIssueDeviceTokenWithPassword', signIn({ extra: 'leak-me' }));
    const body = (await response.json()) as { error: string; message: string };
    expect({ status: response.status, error: body.error }).toEqual({ status: 400, error: 'bad_request' });
    expect(body.message).not.toContain('leak-me');
    expect(body.message).not.toContain('synthetic-password');
  });
});

describe('fake hub auth: tokens and their 401 reasons', () => {
  it('no bearer, a garbage bearer and an unknown token are 401 without a reason (never wipes the sign-in)', async () => {
    expect(await error(await call('me', null))).toEqual({ status: 401, error: 'unauthorized', reason: undefined });
    expect(await error(await hub.fetch(`${hub.origin}/api/v1/auth/me`, { headers: { authorization: 'Basic abc' } }))).toMatchObject({ status: 401, reason: undefined });
    expect(await error(await call('me', null, 'cgx_unknown'))).toMatchObject({ status: 401, reason: undefined });
  });

  it('public routes need no bearer: health and sign-in', async () => {
    expect((await call('health', null)).status).toBe(200);
    expect((await call('authIssueDeviceTokenWithPassword', signIn())).status).toBe(200);
  });

  it('revoked tokens answer token_revoked — all, by user, or one by id', async () => {
    const a = hub.issueToken();
    const b = hub.issueToken();
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    const idA = hub.status().tokens[0]?.id ?? 0;
    expect(hub.control({ op: 'revokeTokens', tokenId: idA })).toEqual({ ok: true, revoked: 1 });
    expect(await error(await call('me', null, a))).toEqual({ status: 401, error: 'unauthorized', reason: 'token_revoked' });
    expect((await call('me', null, b)).status).toBe(200);
    expect(hub.control({ op: 'revokeTokens', userId: WORLD.user.userId })).toEqual({ ok: true, revoked: 2 });
    expect(await error(await call('me', null, b))).toMatchObject({ reason: 'token_revoked' });
    expect((await call('me', null, other)).status).toBe(200);
    hub.control({ op: 'revokeTokens' });
    expect(await error(await call('me', null, other))).toMatchObject({ reason: 'token_revoked' });
  });

  it('expired tokens answer token_expired — on command, or when the 90-day lifetime runs out', async () => {
    const a = hub.issueToken();
    const b = hub.issueToken({ username: WORLD.otherUser.username });
    expect(hub.control({ op: 'expireTokens', userId: WORLD.user.userId })).toEqual({ ok: true, expired: 1 });
    expect(await error(await call('me', null, a))).toEqual({ status: 401, error: 'unauthorized', reason: 'token_expired' });
    expect((await call('me', null, b)).status).toBe(200);
    hub.control({ op: 'clock', advanceMs: 90 * 86_400_000 });
    expect(await error(await call('me', null, b))).toMatchObject({ reason: 'token_expired' });
    expect(hub.status().tokens.map((token) => token.state)).toEqual(['expired', 'expired']);
  });

  it('DELETE current revokes exactly the bearer; the same user’s other token keeps working', async () => {
    const a = hub.issueToken();
    const b = hub.issueToken();
    const response = await call('authRevokeCurrentDeviceToken', null, a);
    expect(await response.json()).toEqual({ revoked: true });
    expect(await error(await call('me', null, a))).toMatchObject({ reason: 'token_revoked' });
    expect((await call('me', null, b)).status).toBe(200);
  });

  it('a token answered by a scripted sign-in becomes a real one for the rest of the script', async () => {
    hub.control({
      op: 'scriptHttp',
      exchanges: [{ route: 'authIssueDeviceTokenWithPassword', request: signIn(), response: { status: 200, body: { mode: 'active', token: 'cgx_scripted_0001', id: 99, label: 'x', keyPrefix: 'cgx_scri', expiresAt: '2027-01-01T00:00:00.000Z', client: 'chat-extension' } } }],
    });
    expect((await (await call('authIssueDeviceTokenWithPassword', signIn())).json()) as { token: string }).toMatchObject({ token: 'cgx_scripted_0001' });
    expect((await call('me', null, 'cgx_scripted_0001')).status).toBe(200);
    expect(hub.status().tokens).toContainEqual({ id: 1, userId: WORLD.user.userId, client: 'chat-extension', state: 'active' });
  });

  it('neither the journal nor the status carries a token or a password', async () => {
    const answer = await issue();
    await call('me', null, answer.token);
    const dump = JSON.stringify([hub.read().entries, hub.status()]);
    expect(dump).not.toContain(answer.token);
    expect(dump).not.toContain('synthetic-password');
    expect(hub.read().entries.at(-1)?.token).toEqual({ id: 1, client: 'chat-extension' });
  });
});
