// The hub's claim and custody automaton for one fan of one page (architecture.md
// §6.7.7, §8.5; hub H-7b, hub-pr-plan.md PR 26–27 and §4.6), as the fake hub
// models it. Three separate things:
// 1. greeting — «first greeting confirmed», forever;
// 2. lease — who works on the one greeting now (claimLeaseSec, renewed
//    explicitly, expiring lazily);
// 3. custody — one dispatched part of a preview send, with a one-time ticket
//    (dispatchTicketSec); a dispatching attempt whose ticket expired
//    unreported is `uncertain-held`: it never frees itself and never becomes
//    `failed` — only the late proof (`sent`) or an owner resolve ends it.
// `dispatch` runs the hub's checks in the hub's order (PR 27 «Порядок
// проверок»). Every custody move is checked against the frozen
// CUSTODY_TRANSITIONS.

import {
  isCustodyTransition,
  type ClaimBody,
  type ClaimGroup,
  type ClaimState,
  type ClaimSummary,
  type ClientFeatureFlag,
  type CustodyState,
  type HubErrorCode,
} from '@cg/contracts';

import { iso } from './clock';

export type FlagVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface ClaimContext {
  readonly now: number;
  readonly userId: number;
  readonly leaseSec: number;
  readonly ticketSec: number;
  readonly perMinute: number;
  readonly flagRevision: number;
  readonly flag: (flag: ClientFeatureFlag) => FlagVerdict;
}

export type ClaimResult =
  | { readonly ok: true; readonly state: ClaimState }
  | { readonly ok: false; readonly error: HubErrorCode; readonly reason?: string; readonly retryAfterSec?: number };

type StoredState = 'dispatching' | 'sent' | 'failed' | 'resolved-sent' | 'resolved-not-sent';

interface Lease {
  readonly leaseToken: string;
  readonly userId: number;
  readonly instanceId: string;
  state: 'active' | 'released' | 'expired';
  expiresAt: number;
}

interface Attempt {
  readonly seq: number;
  readonly attemptId: string;
  readonly userId: number;
  readonly instanceId: string;
  readonly purpose: 'greeting' | 'preview-reply';
  readonly origin: 'preview-send' | 'native-register';
  readonly group: ClaimGroup;
  readonly partIndex: number;
  readonly bodyHash: string;
  state: StoredState;
  readonly ticket: string | null;
  readonly ticketExpiresAt: number | null;
  readonly createdAt: number;
  platformMessageId: string | null;
  failure: { readonly reason: string; readonly httpStatus: number | null } | null;
}

interface Greeting {
  readonly at: number;
  readonly messageRef: string | null;
  readonly source: 'preview-send' | 'native-register' | 'resolve' | 'desktop-outbox';
  readonly ownerUserId: number | null;
  readonly group: ClaimGroup | null;
}

interface FanClaims {
  greeting: Greeting | null;
  lease: Lease | null;
  readonly attempts: Attempt[];
  desktopHeld: boolean;
}

/** Stable JSON (sorted keys): the request hash of an attempt («the same body»). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const refuse = (error: HubErrorCode, extra: { reason?: string; retryAfterSec?: number } = {}): ClaimResult => ({ ok: false, error, ...extra });

interface Caller {
  readonly userId: number;
  readonly instanceId: string | null;
  readonly leaseToken: string | null;
}

export class ClaimsModel {
  private readonly fans = new Map<string, FanClaims>();
  /** Preview-send dispatch times per user (the 6-per-minute rate). */
  private readonly dispatches = new Map<number, number[]>();
  private seq = 0;
  private ticketSeq = 0;

  private fan(pageLabel: string, fanRef: string): FanClaims {
    const key = `${pageLabel}\u0000${fanRef}`;
    let fan = this.fans.get(key);
    if (fan === undefined) {
      fan = { greeting: null, lease: null, attempts: [], desktopHeld: false };
      this.fans.set(key, fan);
    }
    return fan;
  }

  private static custodyOf(attempt: Attempt, now: number): CustodyState {
    return attempt.state === 'dispatching' && attempt.ticketExpiresAt !== null && attempt.ticketExpiresAt <= now ? 'uncertain-held' : attempt.state;
  }

  private static expireLease(fan: FanClaims, now: number): void {
    if (fan.lease !== null && fan.lease.state === 'active' && fan.lease.expiresAt <= now) fan.lease.state = 'expired';
  }

  private static liveLease(fan: FanClaims): Lease | null {
    return fan.lease !== null && fan.lease.state === 'active' ? fan.lease : null;
  }

  private static owns(lease: Lease, caller: Caller): boolean {
    return lease.userId === caller.userId && (caller.instanceId === null || lease.instanceId === caller.instanceId) && (caller.leaseToken === null || lease.leaseToken === caller.leaseToken);
  }

  private view(fan: FanClaims, caller: Caller, focus: Attempt | null, ctx: ClaimContext, withTicket: boolean): ClaimState {
    ClaimsModel.expireLease(fan, ctx.now);
    const lease = fan.lease;
    let leaseView: ClaimState['lease'];
    if (lease === null) leaseView = { state: 'none', leaseToken: null, expiresAt: null, heldBy: null };
    else if (lease.state === 'released') leaseView = { state: 'released', leaseToken: null, expiresAt: null, heldBy: null };
    else if (lease.state === 'expired') leaseView = { state: 'expired', leaseToken: null, expiresAt: iso(lease.expiresAt), heldBy: null };
    else if (ClaimsModel.owns(lease, caller)) leaseView = { state: 'owned', leaseToken: lease.leaseToken, expiresAt: iso(lease.expiresAt), heldBy: null };
    else leaseView = { state: 'held', leaseToken: null, expiresAt: iso(lease.expiresAt), heldBy: lease.userId === caller.userId ? 'you-elsewhere' : 'someone-else' };

    const latest = fan.attempts.at(-1) ?? null;
    const groupOf = focus?.group ?? latest?.group ?? fan.greeting?.group ?? null;
    const group =
      groupOf === null
        ? null
        : (() => {
            const same = fan.attempts.filter((a) => a.group.generationRef === groupOf.generationRef && a.group.variant === groupOf.variant);
            const parts = (states: readonly CustodyState[]): number[] =>
              [...new Set(same.filter((a) => states.includes(ClaimsModel.custodyOf(a, ctx.now))).map((a) => a.partIndex))].sort((x, y) => x - y);
            return { generationRef: groupOf.generationRef, variant: groupOf.variant, partCount: groupOf.partCount, sentParts: parts(['sent', 'resolved-sent']), heldParts: parts(['uncertain-held']) };
          })();
    const custody =
      focus === null
        ? null
        : {
            attemptId: focus.attemptId,
            state: ClaimsModel.custodyOf(focus, ctx.now),
            ticket: withTicket ? focus.ticket : null,
            ticketExpiresAt: withTicket && focus.ticketExpiresAt !== null ? iso(focus.ticketExpiresAt) : null,
          };
    const greeting = fan.greeting;
    return {
      greeting: greeting === null ? { state: 'none', at: null, messageRef: null, source: null } : { state: 'confirmed', at: iso(greeting.at), messageRef: greeting.messageRef, source: greeting.source },
      lease: leaseView,
      group,
      custody,
      serverNow: iso(ctx.now),
      flagRevision: ctx.flagRevision,
    };
  }

  private openAttempt(fan: FanClaims): Attempt | null {
    return [...fan.attempts].reverse().find((a) => a.state === 'dispatching') ?? null;
  }

  private move(attempt: Attempt, to: StoredState, now: number): void {
    const from = ClaimsModel.custodyOf(attempt, now);
    if (!isCustodyTransition(from, to)) throw new Error(`fake hub: custody ${from} → ${to} is not a frozen transition`);
    attempt.state = to;
  }

  private confirmGreeting(fan: FanClaims, attempt: Attempt, source: Greeting['source'], now: number, messageRef: string | null): void {
    if (attempt.purpose !== 'greeting' || fan.greeting !== null) return;
    fan.greeting = { at: now, messageRef, source, ownerUserId: attempt.userId, group: attempt.group };
  }

  /** GET …/claim: the same state, never a ticket. */
  status(pageLabel: string, fanRef: string, ctx: ClaimContext): ClaimState {
    const fan = this.fan(pageLabel, fanRef);
    return this.view(fan, { userId: ctx.userId, instanceId: null, leaseToken: null }, fan.attempts.at(-1) ?? null, ctx, false);
  }

  /** The «Новые» row's claim summary for this caller. */
  summary(pageLabel: string, fanRef: string, ctx: ClaimContext): ClaimSummary {
    const state = this.status(pageLabel, fanRef, ctx);
    return { greeting: state.greeting.state, lease: state.lease.state, heldBy: state.lease.heldBy, custody: state.custody?.state ?? null };
  }

  /** POST …/claim. */
  apply(pageLabel: string, fanRef: string, body: ClaimBody, ctx: ClaimContext): ClaimResult {
    const fan = this.fan(pageLabel, fanRef);
    ClaimsModel.expireLease(fan, ctx.now);
    switch (body.action) {
      case 'claim':
      case 'renew':
      case 'release':
        return this.leaseAction(fan, body, ctx);
      case 'dispatch':
        return this.dispatch(fan, body, ctx);
      case 'sent':
        return this.sent(fan, body, ctx);
      case 'failed':
        return this.failed(fan, body, ctx);
      case 'registerNativeSend':
        return this.registerNativeSend(pageLabel, fan, body, ctx);
    }
  }

  private leaseAction(fan: FanClaims, body: Extract<ClaimBody, { action: 'claim' | 'renew' | 'release' }>, ctx: ClaimContext): ClaimResult {
    const caller: Caller = { userId: ctx.userId, instanceId: body.instanceId, leaseToken: body.leaseToken };
    const answer = (): ClaimResult => ({ ok: true, state: this.view(fan, caller, this.openAttempt(fan), ctx, false) });
    const live = ClaimsModel.liveLease(fan);
    if (body.action === 'release') {
      if (live !== null && ClaimsModel.owns(live, caller)) live.state = 'released';
      return answer();
    }
    const flag = ctx.flag('newcomers');
    if (!flag.ok) return refuse('client_feature_disabled', { reason: flag.reason });
    const extend = (lease: Lease): void => {
      lease.expiresAt = ctx.now + ctx.leaseSec * 1000;
    };
    if (body.action === 'renew') {
      if (live === null) return refuse('claim_expired');
      if (!ClaimsModel.owns(live, caller)) {
        // This install's own lease under another token: the caller's lease is gone. Anyone else's: busy.
        return refuse(live.userId === ctx.userId && live.instanceId === body.instanceId ? 'claim_expired' : 'claim_busy');
      }
      extend(live);
      return answer();
    }
    if (fan.greeting !== null && fan.greeting.ownerUserId !== ctx.userId) return refuse('greeting_done');
    if (live !== null) {
      if (!ClaimsModel.owns(live, caller)) return refuse('claim_busy');
      extend(live);
      return answer();
    }
    fan.lease = { leaseToken: body.leaseToken, userId: ctx.userId, instanceId: body.instanceId, state: 'active', expiresAt: ctx.now + ctx.leaseSec * 1000 };
    return answer();
  }

  private dispatch(fan: FanClaims, body: Extract<ClaimBody, { action: 'dispatch' }>, ctx: ClaimContext): ClaimResult {
    const caller: Caller = { userId: ctx.userId, instanceId: body.instanceId, leaseToken: body.leaseToken ?? null };
    const hash = stableJson(body);
    // 1. A repeat of the same attempt only reads; another body under the same id is a conflict.
    const existing = this.findAttempt(body.attemptId);
    if (existing !== null) {
      if (existing.attempt.bodyHash !== hash || existing.attempt.userId !== ctx.userId) return refuse('attempt_conflict');
      return { ok: true, state: this.view(existing.fan, caller, existing.attempt, ctx, false) };
    }
    // 2. The owner's switches, read atomically with the dispatch.
    for (const flagName of body.purpose === 'greeting' ? (['previewSend', 'newcomers'] as const) : (['previewSend'] as const)) {
      const flag = ctx.flag(flagName);
      if (!flag.ok) return refuse('client_feature_disabled', { reason: flag.reason });
    }
    // 3. Rate per user.
    const recent = (this.dispatches.get(ctx.userId) ?? []).filter((at) => at > ctx.now - 60_000);
    this.dispatches.set(ctx.userId, recent);
    if (recent.length >= ctx.perMinute) {
      const oldest = recent[0] ?? ctx.now;
      return refuse('preview_send_rate_limited', { retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - ctx.now) / 1000)) });
    }
    // 4–5. No open custody of anyone on this fan (the desktop's held new-follower command included, for a greeting).
    if (this.openAttempt(fan) !== null) return refuse('custody_held');
    if (body.purpose === 'greeting' && fan.desktopHeld) return refuse('custody_held');
    // 6. The greeting: confirmed → only its owner's group; not yet → a live lease of this caller.
    if (body.purpose === 'greeting') {
      const greeting = fan.greeting;
      if (greeting !== null) {
        if (greeting.ownerUserId !== ctx.userId) return refuse('greeting_done');
        const g = greeting.group;
        if (g !== null && (g.generationRef !== body.group.generationRef || g.variant !== body.group.variant || g.partCount !== body.group.partCount)) {
          return refuse('generation_mismatch');
        }
      } else {
        const live = ClaimsModel.liveLease(fan);
        if (live === null) return refuse('claim_expired');
        if (body.leaseToken === undefined || !ClaimsModel.owns(live, caller)) {
          return refuse(live.userId === ctx.userId && live.instanceId === body.instanceId ? 'claim_expired' : 'claim_busy');
        }
      }
    }
    // 7. The part is not sent yet.
    if (this.partSent(fan, body.group, body.partIndex)) return refuse('part_already_sent');
    // 8. Custody `dispatching` and the one-time ticket.
    this.ticketSeq += 1;
    const attempt: Attempt = {
      seq: ++this.seq,
      attemptId: body.attemptId,
      userId: ctx.userId,
      instanceId: body.instanceId,
      purpose: body.purpose,
      origin: 'preview-send',
      group: body.group,
      partIndex: body.partIndex,
      bodyHash: hash,
      state: 'dispatching',
      ticket: `tkt-${this.ticketSeq}-${crypto.randomUUID().slice(0, 8)}`,
      ticketExpiresAt: ctx.now + ctx.ticketSec * 1000,
      createdAt: ctx.now,
      platformMessageId: null,
      failure: null,
    };
    if (!isCustodyTransition(null, 'dispatching')) throw new Error('fake hub: dispatching is not an initial custody state');
    fan.attempts.push(attempt);
    recent.push(ctx.now);
    return { ok: true, state: this.view(fan, caller, attempt, ctx, true) };
  }

  private sent(fan: FanClaims, body: Extract<ClaimBody, { action: 'sent' }>, ctx: ClaimContext): ClaimResult {
    const found = this.findAttempt(body.attemptId);
    if (found === null || found.fan !== fan || found.attempt.userId !== ctx.userId || found.attempt.instanceId !== body.instanceId) return refuse('custody_not_owned');
    const { attempt } = found;
    const caller: Caller = { userId: ctx.userId, instanceId: body.instanceId, leaseToken: null };
    if (attempt.state === 'sent') {
      return attempt.platformMessageId === body.platformMessageId ? { ok: true, state: this.view(fan, caller, attempt, ctx, false) } : refuse('attempt_conflict');
    }
    if (attempt.state !== 'dispatching') return refuse('attempt_conflict');
    if (this.messageTaken(body.platformMessageId, attempt)) return refuse('attempt_conflict');
    this.move(attempt, 'sent', ctx.now);
    attempt.platformMessageId = body.platformMessageId;
    this.confirmGreeting(fan, attempt, 'preview-send', ctx.now, body.platformMessageId);
    return { ok: true, state: this.view(fan, caller, attempt, ctx, false) };
  }

  private failed(fan: FanClaims, body: Extract<ClaimBody, { action: 'failed' }>, ctx: ClaimContext): ClaimResult {
    const found = this.findAttempt(body.attemptId);
    if (found === null || found.fan !== fan || found.attempt.userId !== ctx.userId || found.attempt.instanceId !== body.instanceId) return refuse('custody_not_owned');
    const { attempt } = found;
    const caller: Caller = { userId: ctx.userId, instanceId: body.instanceId, leaseToken: null };
    const now = ClaimsModel.custodyOf(attempt, ctx.now);
    if (now === 'failed' && attempt.failure?.reason === body.reason) return { ok: true, state: this.view(fan, caller, attempt, ctx, false) };
    // An expired ticket made the send uncertain: no `failed` without the proof that it never left in time.
    if (now === 'uncertain-held') return refuse('custody_held');
    if (now !== 'dispatching') return refuse('attempt_conflict');
    this.move(attempt, 'failed', ctx.now);
    attempt.failure = { reason: body.reason, httpStatus: body.httpStatus ?? null };
    return { ok: true, state: this.view(fan, caller, attempt, ctx, false) };
  }

  private registerNativeSend(pageLabel: string, fan: FanClaims, body: Extract<ClaimBody, { action: 'registerNativeSend' }>, ctx: ClaimContext): ClaimResult {
    const caller: Caller = { userId: ctx.userId, instanceId: body.instanceId, leaseToken: null };
    const hash = stableJson(body);
    const existing = this.findAttempt(body.attemptId);
    if (existing !== null) {
      if (existing.attempt.bodyHash !== hash || existing.attempt.userId !== ctx.userId) return refuse('attempt_conflict');
      return { ok: true, state: this.view(existing.fan, caller, existing.attempt, ctx, false) };
    }
    // Idempotent by (page, platform message id).
    const sameMessage = this.attemptsOfPage(pageLabel).find((a) => a.platformMessageId === body.platformMessageId);
    if (sameMessage !== undefined) return { ok: true, state: this.view(fan, caller, sameMessage, ctx, false) };
    if (this.partSent(fan, body.group, body.partIndex)) return refuse('part_already_sent');
    if (!isCustodyTransition(null, 'sent')) throw new Error('fake hub: sent is not an initial custody state');
    const attempt: Attempt = {
      seq: ++this.seq,
      attemptId: body.attemptId,
      userId: ctx.userId,
      instanceId: body.instanceId,
      purpose: body.purpose,
      origin: 'native-register',
      group: body.group,
      partIndex: body.partIndex,
      bodyHash: hash,
      state: 'sent',
      ticket: null,
      ticketExpiresAt: null,
      createdAt: ctx.now,
      platformMessageId: body.platformMessageId,
      failure: null,
    };
    fan.attempts.push(attempt);
    this.confirmGreeting(fan, attempt, 'native-register', ctx.now, body.platformMessageId);
    return { ok: true, state: this.view(fan, caller, attempt, ctx, false) };
  }

  /** The hub cabinet's resolve (owner or team lead; H-7e). */
  resolve(pageLabel: string, fanRef: string, attemptId: string, outcome: 'sent' | 'not_sent', now: number, platformMessageId: string | null): void {
    const fan = this.fan(pageLabel, fanRef);
    const attempt = fan.attempts.find((a) => a.attemptId === attemptId);
    if (attempt === undefined) throw new Error(`fake hub: no attempt ${attemptId} on ${pageLabel}/${fanRef}`);
    const state = ClaimsModel.custodyOf(attempt, now);
    if (state !== 'dispatching' && state !== 'uncertain-held') throw new Error(`fake hub: attempt ${attemptId} is ${state}, nothing to resolve`);
    this.move(attempt, outcome === 'sent' ? 'resolved-sent' : 'resolved-not-sent', now);
    if (outcome === 'sent') {
      attempt.platformMessageId = platformMessageId;
      this.confirmGreeting(fan, attempt, 'resolve', now, platformMessageId);
    }
  }

  setDesktopHold(pageLabel: string, fanRef: string, held: boolean): void {
    this.fan(pageLabel, fanRef).desktopHeld = held;
  }

  /** A greeting confirmed outside this client (the desktop's outbox). */
  confirmFromDesktop(pageLabel: string, fanRef: string, now: number): void {
    const fan = this.fan(pageLabel, fanRef);
    fan.greeting ??= { at: now, messageRef: null, source: 'desktop-outbox', ownerUserId: null, group: null };
  }

  snapshot(now: number): Array<{ pageLabel: string; fanRef: string; greeting: 'none' | 'confirmed'; lease: string; attempts: Array<{ attemptId: string; state: string; partIndex: number }> }> {
    return [...this.fans.entries()].map(([key, fan]) => {
      const [pageLabel = '', fanRef = ''] = key.split('\u0000');
      ClaimsModel.expireLease(fan, now);
      return {
        pageLabel,
        fanRef,
        greeting: fan.greeting === null ? 'none' : 'confirmed',
        lease: fan.lease?.state ?? 'none',
        attempts: fan.attempts.map((a) => ({ attemptId: a.attemptId, state: ClaimsModel.custodyOf(a, now), partIndex: a.partIndex })),
      };
    });
  }

  private findAttempt(attemptId: string): { fan: FanClaims; attempt: Attempt } | null {
    for (const fan of this.fans.values()) {
      const attempt = fan.attempts.find((a) => a.attemptId === attemptId);
      if (attempt !== undefined) return { fan, attempt };
    }
    return null;
  }

  private attemptsOfPage(pageLabel: string): Attempt[] {
    return [...this.fans.entries()].filter(([key]) => key.startsWith(`${pageLabel}\u0000`)).flatMap(([, fan]) => fan.attempts);
  }

  private messageTaken(platformMessageId: string, except: Attempt): boolean {
    for (const fan of this.fans.values()) if (fan.attempts.some((a) => a !== except && a.platformMessageId === platformMessageId)) return true;
    return false;
  }

  private partSent(fan: FanClaims, group: ClaimGroup, partIndex: number): boolean {
    return fan.attempts.some(
      (a) => a.group.generationRef === group.generationRef && a.group.variant === group.variant && a.partIndex === partIndex && (a.state === 'sent' || a.state === 'resolved-sent'),
    );
  }
}
