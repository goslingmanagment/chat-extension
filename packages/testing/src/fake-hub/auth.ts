// Sign-in and tokens as the fake hub models them (architecture.md §8.2; hub
// H-3, Decision 349): device tokens issued with a password, the narrow
// `chat-extension` profile and its echo (a hub without H-3 drops `client`
// and issues a full token without the echo), pending reservations that are
// never usable, revocation and expiry with their 401 reasons, and the sign-in
// rate limit. Tokens are synthetic and never reach the journal.

import { type DeviceTokenIssueRequest, type DeviceTokenIssueResponse } from '@cg/contracts';

import { WORLD } from '../scenarios/hub';
import { iso } from './clock';

export interface FakeUser {
  readonly userId: number;
  readonly username: string;
  readonly password: string;
  readonly role: 'owner' | 'team_lead' | 'chatter';
}

/** Synthetic accounts: the chatter of the scenarios and a second chatter (two clients, one fan). */
export const FAKE_USERS: readonly FakeUser[] = [
  { userId: WORLD.user.userId, username: WORLD.user.username, password: 'synthetic-password', role: 'chatter' },
  { userId: WORLD.otherUser.userId, username: WORLD.otherUser.username, password: 'synthetic-password-2', role: 'chatter' },
];

export interface TokenRecord {
  readonly id: number;
  readonly secret: string;
  readonly userId: number;
  /** `chat-extension` for a narrow token, null for a full one. */
  readonly client: string | null;
  readonly mode: 'active' | 'pending';
  readonly issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}

export type AuthVerdict =
  | { readonly ok: true; readonly token: TokenRecord; readonly user: FakeUser }
  /** reason null: 401 without a reason (missing, unknown or pending token) — never wipes the sign-in. */
  | { readonly ok: false; readonly reason: 'token_revoked' | 'token_expired' | null };

export type SignInResult =
  | { readonly ok: true; readonly response: DeviceTokenIssueResponse }
  | { readonly ok: false; readonly error: 'unauthorized' | 'rate_limit_exceeded'; readonly retryAfterSec?: number };

const TOKEN_LIFETIME_MS = 90 * 86_400_000;
const PENDING_LIFETIME_MS = 10 * 60_000;
export const SIGN_IN_FAILURES_PER_MINUTE = 5;

export class AuthModel {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly failures = new Map<string, number[]>();
  private seq = 0;

  constructor(private readonly users: readonly FakeUser[] = FAKE_USERS) {}

  userById(userId: number): FakeUser | undefined {
    return this.users.find((user) => user.userId === userId);
  }

  private mint(userId: number, client: string | null, mode: 'active' | 'pending', now: number, secret?: string): TokenRecord {
    this.seq += 1;
    const record: TokenRecord = {
      id: this.seq,
      secret: secret ?? `cgx${this.seq}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
      userId,
      client,
      mode,
      issuedAt: now,
      expiresAt: now + (mode === 'pending' ? PENDING_LIFETIME_MS : TOKEN_LIFETIME_MS),
      revoked: false,
    };
    this.tokens.set(record.secret, record);
    return record;
  }

  signIn(body: DeviceTokenIssueRequest, now: number, narrowTokens: boolean): SignInResult {
    const recent = (this.failures.get(body.username) ?? []).filter((at) => at > now - 60_000);
    this.failures.set(body.username, recent);
    if (recent.length >= SIGN_IN_FAILURES_PER_MINUTE) {
      const oldest = recent[0] ?? now;
      return { ok: false, error: 'rate_limit_exceeded', retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)) };
    }
    const user = this.users.find((candidate) => candidate.username === body.username);
    if (user === undefined || user.password !== body.password) {
      recent.push(now);
      return { ok: false, error: 'unauthorized' };
    }
    if (body.mode === 'pending') {
      const record = this.mint(user.userId, null, 'pending', now);
      return {
        ok: true,
        response: { mode: 'pending', token: record.secret, reservationId: record.id, label: body.label, keyPrefix: record.secret.slice(0, 8), reservationExpiresAt: iso(record.expiresAt) },
      };
    }
    // A hub without H-3 drops `client` silently: a full token, and no echo key at all.
    const client = narrowTokens && body.client !== undefined ? body.client : null;
    const record = this.mint(user.userId, client, 'active', now);
    const response: DeviceTokenIssueResponse = {
      mode: 'active',
      token: record.secret,
      id: record.id,
      label: body.label,
      keyPrefix: record.secret.slice(0, 8),
      expiresAt: iso(record.expiresAt),
      ...(narrowTokens ? { client } : {}),
    };
    return { ok: true, response };
  }

  /** A token a scripted sign-in answered with becomes a real one (so the script's later calls authenticate). */
  adopt(secret: string, username: string, client: string | null, now: number, expiresAt: number | null): void {
    if (this.tokens.has(secret)) return;
    const user = this.users.find((candidate) => candidate.username === username) ?? this.users[0];
    if (user === undefined) return;
    const record = this.mint(user.userId, client, 'active', now, secret);
    if (expiresAt !== null) record.expiresAt = expiresAt;
  }

  authenticate(authorization: string | null, now: number): AuthVerdict {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization ?? '');
    const record = match === null ? undefined : this.tokens.get(match[1] ?? '');
    if (record === undefined || record.mode === 'pending') return { ok: false, reason: null };
    if (record.revoked) return { ok: false, reason: 'token_revoked' };
    if (record.expiresAt <= now) return { ok: false, reason: 'token_expired' };
    const user = this.userById(record.userId);
    return user === undefined ? { ok: false, reason: null } : { ok: true, token: record, user };
  }

  private select(filter: { readonly userId?: number; readonly tokenId?: number }): TokenRecord[] {
    return [...this.tokens.values()].filter((record) => (filter.userId === undefined || record.userId === filter.userId) && (filter.tokenId === undefined || record.id === filter.tokenId));
  }

  revoke(filter: { readonly userId?: number; readonly tokenId?: number }): number {
    const selected = this.select(filter);
    for (const record of selected) record.revoked = true;
    return selected.length;
  }

  expire(filter: { readonly userId?: number; readonly tokenId?: number }, now: number): number {
    const selected = this.select(filter);
    for (const record of selected) record.expiresAt = Math.min(record.expiresAt, now);
    return selected.length;
  }

  list(now: number): Array<{ id: number; userId: number; client: string | null; state: 'active' | 'pending' | 'revoked' | 'expired' }> {
    return [...this.tokens.values()].map((record) => ({
      id: record.id,
      userId: record.userId,
      client: record.client,
      state: record.mode === 'pending' ? 'pending' : record.revoked ? 'revoked' : record.expiresAt <= now ? 'expired' : 'active',
    }));
  }
}
