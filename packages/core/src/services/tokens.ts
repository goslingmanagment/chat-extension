// One-time action tokens (architecture.md §14 «Запись — только по
// доверенному действию», §5.1 HumanCause; BG-001, AI-120). A tab asks
// `token.issue` on a trusted (`isTrusted`) event inside our closed shadow
// root of a visible, working surface; the background issues a token bound
// to that tab session, its kind (generate, insert, navigate, send) and
// surface, valid for a few seconds. `op.start` and `send.begin` spend
// `generate` and `send` tokens themselves, HostPort spends `insert` and
// `navigate` through `token.redeem` before the bridge call. A token is
// accepted once, for its own kind, surface and tab, before its deadline —
// so no timer, toast, `done` or MAIN can start a generation, an insert, a
// navigation or a send on its own.

import { type Surface } from '@cg/contracts/features';
import { ACTION_TOKEN_PATTERN } from '@cg/contracts/primitives';
import { type ACTION_TOKEN_KINDS } from '@cg/contracts/tab-messages';

import { type Clock, type IdSource } from './ports';

export type ActionTokenKind = (typeof ACTION_TOKEN_KINDS)[number];

/** A click goes from the trusted event to its request within one round trip; a few seconds is plenty. */
export const ACTION_TOKEN_TTL_MS = 10_000;
/** Outstanding tokens per tab; the oldest is dropped beyond this (a stuck UI cannot pile them up). */
export const ACTION_TOKENS_PER_TAB = 32;

export interface IssuedToken {
  readonly actionToken: string;
  readonly expiresAt: number;
}

interface TokenRecord {
  readonly tabSessionId: string;
  readonly kind: ActionTokenKind;
  readonly surface: Surface;
  readonly expiresAt: number;
}

export interface RedeemRequest {
  readonly tabSessionId: string;
  readonly kind: ActionTokenKind;
  readonly surface: Surface;
  readonly actionToken: string;
}

export type RedeemRefusal = 'unknown' | 'expired' | 'other-tab' | 'other-kind' | 'other-surface';

export class ActionTokens {
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(
    private readonly clock: Clock,
    private readonly ids: Pick<IdSource, 'token'>,
    private readonly ttlMs: number = ACTION_TOKEN_TTL_MS,
  ) {}

  /** Issues a token for one trusted event of `surface` in this tab. */
  issue(tabSessionId: string, kind: ActionTokenKind, surface: Surface): IssuedToken {
    const now = this.clock.now();
    this.sweep(now);
    const mine = [...this.tokens.entries()].filter(([, record]) => record.tabSessionId === tabSessionId);
    for (const [token] of mine.slice(0, Math.max(0, mine.length - ACTION_TOKENS_PER_TAB + 1))) this.tokens.delete(token);
    let actionToken = this.ids.token();
    while (!ACTION_TOKEN_PATTERN.test(actionToken) || this.tokens.has(actionToken)) actionToken = this.ids.token();
    const expiresAt = now + this.ttlMs;
    this.tokens.set(actionToken, { tabSessionId, kind, surface, expiresAt });
    return { actionToken, expiresAt };
  }

  /** Spends a token: true exactly once, for its tab, kind and surface, before its deadline. A refused token is spent too. */
  redeem(request: RedeemRequest): boolean {
    return this.check(request) === null;
  }

  /** Like redeem(), with the reason of a refusal (for the log; never shown as is). */
  check(request: RedeemRequest): RedeemRefusal | null {
    const record = this.tokens.get(request.actionToken);
    if (record === undefined) return 'unknown';
    if (record.tabSessionId !== request.tabSessionId) return 'other-tab';
    this.tokens.delete(request.actionToken);
    if (this.clock.now() >= record.expiresAt) return 'expired';
    if (record.kind !== request.kind) return 'other-kind';
    if (record.surface !== request.surface) return 'other-surface';
    return null;
  }

  /** The tab went away: its tokens die with it. */
  dropTab(tabSessionId: string): void {
    for (const [token, record] of this.tokens) if (record.tabSessionId === tabSessionId) this.tokens.delete(token);
  }

  outstanding(tabSessionId: string): number {
    this.sweep(this.clock.now());
    let count = 0;
    for (const record of this.tokens.values()) if (record.tabSessionId === tabSessionId) count += 1;
    return count;
  }

  private sweep(now: number): void {
    for (const [token, record] of this.tokens) if (now >= record.expiresAt) this.tokens.delete(token);
  }
}
