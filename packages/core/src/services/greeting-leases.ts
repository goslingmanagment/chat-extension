// The greeting leases of «Новые» as the background holds them
// (architecture.md §8.5, §6.7.7; hub H-7; NF-021, NF-023): the one place of an
// install that knows the lease tokens.
//
// A lease is taken for a fan of a page when a person presses Hi, is renewed
// while a tab works with the fan (the tab's controller asks every
// `claimRenewSec` — and only while the person does), and is released
// explicitly. The hub tells one install's lease from another's by the lease
// token and the install id, so every tab of this browser must come with the
// SAME token for the same fan: a second tab that asks for a fan this install
// already holds joins the lease instead of losing to itself. The tokens
// survive an unload of the event page (storage.session): a new instance that
// minted a fresh token would be refused by its own lease until it ran out.
//
// - `claim`: the token this install holds for the fan while its deadline has
//   not passed, else a new one. The hub's answer decides: `owned` is kept
//   with its deadline on our clock, anything else forgets the fan.
// - `renew`: only with a token we hold — without one nothing is asked and the
//   answer is CG-CLAIM-EXPIRED («бронь истекла — нажмите Hi ещё раз»).
// - `release`: the lease goes at the hub; without a token the hub's state is
//   read instead (a tab may release what it only thinks it holds).
// - Nothing renews by itself: a tab that was closed stops asking, and the hub
//   lets the lease run out («продлевается явно, снимается явно»). The token
//   stays until its deadline, so the same browser can pick the fan up again.
// - A sign-out, another sign-in or another hub forgets every token: they
//   belong to the previous person.
// - Nothing is repeated: a call that failed is the tab's to ask again.
//
// Other tabs hear `newcomers.changed` when a lease of this install was taken
// or let go. Ids and states only; never a text.

import { type CgCode } from '@cg/contracts/errors';
import { type ClaimState, type HubFacade } from '@cg/contracts/hub';

import { leaseOfClaim, leasePolicy } from '../domain/newcomers/claim';
import { SESSION_KEYS } from '../domain/storage';
import { NO_LOG, WriteQueue, type Clock, type IdSource, type KeyValueStore, type LogSink, type TabEventSink } from './ports';

/** storage.session: the lease tokens this install holds (ids and deadlines, nothing else). */
export const GREETING_LEASES_KEY = SESSION_KEYS.greetingLeases;
/** Leases kept at most: a person works on a handful of greetings at a time. */
export const GREETING_LEASES_MAX = 100;

export type LeaseAction = 'claim' | 'renew' | 'release';

export interface LeasePage {
  readonly pageId: number;
  readonly pageLabel: string;
}

export type LeaseAnswer = { readonly ok: true; readonly state: ClaimState } | { readonly ok: false; readonly code: CgCode };

export interface GreetingLeasesDeps {
  readonly clock: Pick<Clock, 'now'>;
  readonly ids: Pick<IdSource, 'uuid'>;
  readonly hub: Pick<HubFacade, 'claim' | 'claimStatus'>;
  /** This install's id for the hub's custody (`instanceId`). */
  readonly instanceId: () => string;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. A lease belongs to that person. */
  readonly owner: () => string | null;
  /** `limits.claim*` of the current bootstrap; null — none at hand (the hub's defaults then). */
  readonly limits: () => Parameters<typeof leasePolicy>[0];
  readonly events: TabEventSink;
  /** Registered tab sessions (who else hears `newcomers.changed`). */
  readonly tabs: () => readonly string[];
  /** storage.session; omitted — memory only. */
  readonly store?: KeyValueStore;
  readonly log?: LogSink;
}

interface Lease {
  readonly owner: string;
  readonly pageId: number;
  readonly pageLabel: string;
  readonly fanRef: string;
  readonly leaseToken: string;
  /** The deadline on our clock. */
  readonly until: number;
}

const keyOf = (pageId: number, fanRef: string): string => `${pageId}|${fanRef}`;

const isLease = (value: unknown): value is Lease => {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<Record<keyof Lease, unknown>>;
  return (
    typeof item.owner === 'string' &&
    typeof item.pageId === 'number' &&
    typeof item.pageLabel === 'string' &&
    typeof item.fanRef === 'string' &&
    typeof item.leaseToken === 'string' &&
    typeof item.until === 'number' &&
    Number.isFinite(item.until)
  );
};

/** The hub answered that the lease is no longer this install's (`claim_expired`, `claim_busy`). */
function leaseGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const failure = (error as { failure?: { kind?: unknown; error?: unknown } }).failure;
  return failure !== undefined && failure.kind === 'http' && (failure.error === 'claim_expired' || failure.error === 'claim_busy');
}

export class GreetingLeases {
  private readonly leases = new Map<string, Lease>();
  /** One action per fan at a time (NF-023): a second one waits for the first, in order. */
  private readonly rows = new Map<string, { readonly queue: WriteQueue; pending: number }>();
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;

  constructor(private readonly deps: GreetingLeasesDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** After the event page woke up: the tokens of the person who is signed in now, while their deadlines stand. */
  async restore(): Promise<number> {
    if (this.deps.store === undefined) return 0;
    let raw: unknown;
    try {
      raw = await this.deps.store.get(GREETING_LEASES_KEY);
    } catch {
      this.log.write({ level: 'warn', scope: 'bg.newcomers', msg: 'lease tokens unreadable, starting empty', code: 'CG-STORAGE-READ' });
      return 0;
    }
    const stored = typeof raw === 'object' && raw !== null && (raw as { v?: unknown }).v === 1 ? (raw as { leases?: unknown }).leases : undefined;
    if (!Array.isArray(stored)) return 0;
    const owner = this.deps.owner();
    const now = this.deps.clock.now();
    for (const item of stored.slice(-GREETING_LEASES_MAX)) {
      if (!isLease(item) || item.owner !== owner || item.until <= now) continue;
      const key = keyOf(item.pageId, item.fanRef);
      // What this instance already took is newer than what the previous one stored.
      if (!this.leases.has(key)) this.leases.set(key, { owner: item.owner, pageId: item.pageId, pageLabel: item.pageLabel, fanRef: item.fanRef, leaseToken: item.leaseToken, until: item.until });
    }
    return this.leases.size;
  }

  /** `newcomers.claim` of a tab: the page is one of its binding (the caller checked). Hub failures reject as they are. */
  act(tabSessionId: string, page: LeasePage, fanRef: string, action: LeaseAction): Promise<LeaseAnswer> {
    const key = keyOf(page.pageId, fanRef);
    const row = this.rows.get(key) ?? { queue: new WriteQueue(), pending: 0 };
    this.rows.set(key, row);
    row.pending += 1;
    return row.queue
      .run(() => this.apply(tabSessionId, page, fanRef, action))
      .finally(() => {
        row.pending -= 1;
        if (row.pending === 0 && this.rows.get(key) === row) this.rows.delete(key);
      });
  }

  private async apply(tabSessionId: string, page: LeasePage, fanRef: string, action: LeaseAction): Promise<LeaseAnswer> {
    const owner = this.deps.owner();
    if (owner === null) return { ok: false, code: 'CG-AUTH-REQUIRED' };
    const key = keyOf(page.pageId, fanRef);
    const held = this.live(key, owner);

    if (action === 'renew' && held === null) return { ok: false, code: 'CG-CLAIM-EXPIRED' };
    if (action === 'release' && held === null) return { ok: true, state: await this.deps.hub.claimStatus(page.pageLabel, fanRef) };

    const leaseToken = held?.leaseToken ?? this.deps.ids.uuid();
    let state: ClaimState;
    try {
      state = await this.deps.hub.claim({ pageLabel: page.pageLabel, fanRef, body: { action, leaseToken, instanceId: this.deps.instanceId() } });
    } catch (error) {
      // The hub said the lease is not ours any more: the token is of no use. Anything else (no answer, a 5xx)
      // leaves it — the lease may well stand, and the next renewal comes with the same token.
      if (action !== 'claim' && leaseGone(error)) this.forget(key, page.pageId, tabSessionId);
      throw error;
    }
    // The person changed while the hub was answering: the answer is the previous one's.
    if (this.deps.owner() !== owner) return { ok: false, code: 'CG-CONTEXT-CHANGED' };

    const view = action === 'release' ? null : leaseOfClaim(state, this.deps.clock.now(), leasePolicy(this.deps.limits()));
    if (view !== null && view.s === 'mine') {
      // Re-inserted: the map's order is the order of the last answers (the oldest go first when it is full).
      this.leases.delete(key);
      this.leases.set(key, { owner, pageId: page.pageId, pageLabel: page.pageLabel, fanRef, leaseToken: view.leaseToken, until: view.until });
      while (this.leases.size > GREETING_LEASES_MAX) {
        const oldest = this.leases.keys().next();
        if (oldest.done === true) break;
        this.leases.delete(oldest.value);
      }
      this.save();
      if (held === null) this.announce(page.pageId, tabSessionId);
    } else {
      this.forget(key, page.pageId, tabSessionId);
    }
    this.log.write({ level: 'info', scope: 'bg.newcomers', msg: 'lease', fields: { action, pageId: page.pageId, lease: state.lease.state, greeting: state.greeting.state, held: this.leases.size }, ctx: { tabSessionId } });
    return { ok: true, state };
  }

  /** A sign-out, another sign-in or another hub: the tokens belong to the previous person (§9.4). */
  forgetAll(): void {
    if (this.leases.size === 0) return;
    this.leases.clear();
    this.save();
  }

  /** Leases of the person signed in now whose deadline has not passed (diagnostics). */
  get held(): number {
    const owner = this.deps.owner();
    const now = this.deps.clock.now();
    let count = 0;
    for (const lease of this.leases.values()) if (lease.owner === owner && lease.until > now) count += 1;
    return count;
  }

  /** Resolves when every write so far settled (tests, shutdown). */
  idle(): Promise<void> {
    return this.writes.idle();
  }

  private live(key: string, owner: string): Lease | null {
    const lease = this.leases.get(key);
    if (lease === undefined) return null;
    if (lease.owner === owner && lease.until > this.deps.clock.now()) return lease;
    this.leases.delete(key);
    this.save();
    return null;
  }

  private forget(key: string, pageId: number, tabSessionId: string): void {
    if (!this.leases.delete(key)) return;
    this.save();
    this.announce(pageId, tabSessionId);
  }

  /** Every other tab of this browser reads the list again: a row's lease changed. */
  private announce(pageId: number, except: string): void {
    for (const tab of this.deps.tabs()) if (tab !== except) this.deps.events.emit(tab, 'newcomers.changed', { pageId });
  }

  private save(): void {
    const store = this.deps.store;
    if (store === undefined) return;
    const leases = [...this.leases.values()];
    void this.writes
      .run(() => store.set(GREETING_LEASES_KEY, { v: 1, leases }))
      .catch(() => this.log.write({ level: 'warn', scope: 'bg.newcomers', msg: 'lease tokens not saved', code: 'CG-STORAGE-WRITE' }));
  }
}
