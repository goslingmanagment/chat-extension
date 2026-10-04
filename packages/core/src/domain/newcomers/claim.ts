// The greeting lease of «Новые» (architecture.md §8.5, hub H-7; NF-021,
// NF-023, NF-026): one chatter works on one fan's greeting at a time. The
// lease is taken on Generate, lasts `claimLeaseSec` (120 s), is renewed every
// `claimRenewSec` (40 s) only while the person works with the fan, and is
// released explicitly. A colleague's lease has no countdown here: it renews
// for as long as they work and has no overall cap. Deadlines come from the
// hub's own clock (`serverNow`), never from comparing its instants with ours.

import { type CgCode } from '@cg/contracts/errors';
import { type BootstrapLimits, type ClaimState } from '@cg/contracts/hub';
import { localDeadline } from '@cg/contracts/send-rules';

export interface LeasePolicy {
  readonly leaseMs: number;
  readonly renewMs: number;
  /** How long after the person's last action with the fan the lease is still renewed. */
  readonly activityMs: number;
}

/** After a renewal that did not go through, the next one is tried this soon (and no later than the deadline). */
export const RENEW_RETRY_MS = 10_000;

/** The hub's defaults (H-7) while no bootstrap is at hand. */
export const DEFAULT_LEASE_POLICY: LeasePolicy = { leaseMs: 120_000, renewMs: 40_000, activityMs: 120_000 };

export function leasePolicy(limits: Pick<BootstrapLimits, 'claimLeaseSec' | 'claimRenewSec' | 'claimActivityWindowSec'> | null | undefined): LeasePolicy {
  if (limits === null || limits === undefined) return DEFAULT_LEASE_POLICY;
  const leaseMs = limits.claimLeaseSec * 1000;
  // A renewal period that is not shorter than the lease would let it lapse between renewals.
  const renewMs = Math.min(limits.claimRenewSec * 1000, Math.max(1000, Math.floor(leaseMs / 2)));
  return { leaseMs, renewMs, activityMs: limits.claimActivityWindowSec * 1000 };
}

export type LeaseView =
  | { readonly s: 'none' }
  /** `until` — the deadline on the local clock. */
  | { readonly s: 'mine'; readonly leaseToken: string; readonly until: number }
  /** A colleague holds it: no countdown. */
  | { readonly s: 'other' }
  /** This person holds it in another tab or on another device. */
  | { readonly s: 'elsewhere' }
  | { readonly s: 'expired' };

/** The lease as a claim answer states it, with its deadline moved onto the local clock. */
export function leaseOfClaim(state: ClaimState, receivedAt: number, policy: LeasePolicy = DEFAULT_LEASE_POLICY): LeaseView {
  const lease = state.lease;
  switch (lease.state) {
    case 'owned': {
      if (lease.leaseToken === null) return { s: 'none' };
      const deadline = lease.expiresAt === null ? null : localDeadline(lease.expiresAt, state.serverNow, receivedAt);
      // An answer without a readable deadline is trusted for one renewal period only.
      return { s: 'mine', leaseToken: lease.leaseToken, until: deadline ?? receivedAt + policy.renewMs };
    }
    case 'held':
      return lease.heldBy === 'you-elsewhere' ? { s: 'elsewhere' } : { s: 'other' };
    case 'expired':
      return { s: 'expired' };
    case 'released':
    case 'none':
      return { s: 'none' };
  }
}

/** A lease of ours whose local deadline passed is expired, whatever was last heard. */
export function leaseNow(lease: LeaseView, now: number): LeaseView {
  return lease.s === 'mine' && now >= lease.until ? { s: 'expired' } : lease;
}

export interface LeaseActivity {
  /** The last sign of the person working with this fan (opened the card, typed, generated, pressed a button) or of their work moving on (an operation ended, a part changed state). */
  readonly lastActivityAt: number;
  /** Something of this fan is in flight (a generation, a send, a pending «Открыть и вставить»), or the fan's chat is the one open in ChatSpace. */
  readonly busy: boolean;
}

/**
 * «In flight» keeps a lease only this long after the last sign of life. A
 * generation runs for a minute, a send resolves in half of one, an insert
 * waits twenty seconds: none comes near it. What does is a flag left behind
 * (an operation whose end never reached the tab) or a chat left open with
 * nobody at it — and neither may renew a lease for as long as the tab lives.
 */
export const BUSY_MAX_MS = 5 * 60_000;

/** Whether the lease is renewed now: only while the person works with the fan (never just because a timer fired). */
export function shouldRenew(lease: LeaseView, activity: LeaseActivity, now: number, policy: LeasePolicy): boolean {
  if (lease.s !== 'mine' || now >= lease.until) return false;
  const quiet = now - activity.lastActivityAt;
  return quiet <= policy.activityMs || (activity.busy && quiet <= BUSY_MAX_MS);
}

/** What a refused claim call means for the card, by its code. */
export type ClaimRefusal = 'other' | 'elsewhere' | 'expired' | 'held-uncertain' | 'row-changed' | 'error';

const REFUSALS: Partial<Record<CgCode, ClaimRefusal>> = {
  'CG-CLAIM-BUSY': 'other',
  'CG-CLAIM-EXPIRED': 'expired',
  'CG-SEND-UNCERTAIN': 'held-uncertain',
  'CG-CLAIM-ROW-CHANGED': 'row-changed',
  'CG-CLAIM-ROW-BUSY': 'row-changed',
};

export function claimRefusal(code: CgCode): ClaimRefusal {
  return REFUSALS[code] ?? 'error';
}

/**
 * NF-023: one action per fan at a time (claim, renew, release, the start of a
 * generation). A second one while the first has not answered is refused
 * (CG-CLAIM-ROW-BUSY), never queued.
 */
export class RowLocks {
  private readonly held = new Set<string>();

  acquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }

  release(key: string): void {
    this.held.delete(key);
  }

  has(key: string): boolean {
    return this.held.has(key);
  }

  clear(): void {
    this.held.clear();
  }
}
