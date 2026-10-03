// The host accounts this browser has seen and the tabs that show them now
// (architecture.md §9.9 «Аккаунты, которые видел этот браузер», §5.6
// `presence`; AU-034, AU-035). A ChatSpace tab may hold several accounts at
// once; its `tab.presence` report names them when they change. The
// background registers an account the moment a tab first reports it, keeps
// `lastSeenAt` per account in storage.local (later updates are written at
// most once per 30-second window), keeps the newest `seenAccountsMax`, and
// answers `accounts.seen` with how many open tabs show each account now.
// Accounts are keyed by host + hostAccountId; names are display only and
// never bind anything (AU-023).

import { PresenceStoreSchema, type PresenceStore, type SeenHostAccount } from '@cg/contracts/host';
import { type HostAccount } from '@cg/contracts/ids';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { STORAGE_KEYS } from '@cg/contracts/settings';

import { NO_LOG, WriteQueue, type Clock, type KeyValueStore, type LogSink, type TimerHandle } from './ports';

/** Updates of `lastSeenAt` reach storage at most once per this window. */
export const PRESENCE_WRITE_WINDOW_MS = 30_000;

export interface SeenAccountRow {
  readonly account: HostAccount;
  readonly lastSeenAt: string;
  /** Open tabs whose ChatSpace has this account loaded now. */
  readonly openTabs: number;
}

export interface AccountPresenceDeps {
  readonly clock: Clock;
  /** storage.local (`presence`). */
  readonly store: KeyValueStore;
  readonly log?: LogSink;
  readonly writeWindowMs?: number;
}

const keyOf = (account: HostAccount): string => `${account.host}:${account.hostAccountId}`;

const newestFirst = (a: SeenHostAccount, b: SeenHostAccount): number => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : keyOf(a.account) < keyOf(b.account) ? -1 : 1);

export class AccountPresence {
  private readonly seen = new Map<string, SeenHostAccount>();
  private readonly tabs = new Map<string, ReadonlySet<string>>();
  private readonly writes = new WriteQueue();
  private readonly log: LogSink;
  private timer: TimerHandle | null = null;
  private dirty = false;

  constructor(private readonly deps: AccountPresenceDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** Reads the stored accounts (a damaged store starts empty and is logged). */
  async restore(): Promise<{ readonly kept: number; readonly damaged: boolean }> {
    const raw = await this.deps.store.get(STORAGE_KEYS.presence);
    if (raw === undefined || raw === null) return { kept: this.seen.size, damaged: false };
    const parsed = PresenceStoreSchema.safeParse(raw);
    if (!parsed.success) {
      this.log.write({ level: 'warn', scope: 'bg.presence', msg: 'presence store unreadable, starting empty', code: 'CG-STORAGE-READ' });
      return { kept: this.seen.size, damaged: true };
    }
    for (const item of parsed.data.accounts) if (!this.seen.has(keyOf(item.account))) this.seen.set(keyOf(item.account), item);
    return { kept: this.seen.size, damaged: false };
  }

  /** `tab.presence.accounts`: this tab shows exactly these accounts now. A new account is written at once. */
  report(tabSessionId: string, accounts: readonly HostAccount[]): void {
    const now = new Date(this.deps.clock.now()).toISOString();
    const keys = new Set<string>();
    let registered = false;
    for (const account of accounts) {
      const key = keyOf(account);
      keys.add(key);
      if (!this.seen.has(key)) registered = true;
      // The latest report wins: a creator id that loaded later replaces the null.
      this.seen.set(key, { account, lastSeenAt: now });
    }
    this.tabs.set(tabSessionId, keys);
    this.trim();
    this.dirty = true;
    if (registered) void this.flush();
    else this.scheduleWrite();
  }

  /** The tab closed or reloaded: it shows nothing any more (its accounts stay seen). */
  tabClosed(tabSessionId: string): void {
    this.tabs.delete(tabSessionId);
  }

  /** `accounts.seen`: newest first, with the open tabs that show each now. */
  list(): readonly SeenAccountRow[] {
    const open = new Map<string, number>();
    for (const keys of this.tabs.values()) for (const key of keys) open.set(key, (open.get(key) ?? 0) + 1);
    return [...this.seen.values()].sort(newestFirst).map((item) => ({ account: item.account, lastSeenAt: item.lastSeenAt, openTabs: open.get(keyOf(item.account)) ?? 0 }));
  }

  /** Writes what changed now (the window's timer, a new account, shutdown). */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.deps.clock.clearTimer(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.writes.idle();
    this.dirty = false;
    const value: PresenceStore = { v: 1, accounts: [...this.seen.values()].sort(newestFirst) };
    try {
      await this.writes.run(() => this.deps.store.set(STORAGE_KEYS.presence, value));
    } catch {
      this.dirty = true;
      this.log.write({ level: 'error', scope: 'bg.presence', msg: 'presence store write failed', code: 'CG-STORAGE-WRITE' });
    }
  }

  private scheduleWrite(): void {
    if (this.timer !== null) return;
    this.timer = this.deps.clock.setTimer(this.deps.writeWindowMs ?? PRESENCE_WRITE_WINDOW_MS, () => {
      this.timer = null;
      void this.flush();
    });
  }

  /** Keeps the newest `seenAccountsMax`; accounts an open tab shows are never dropped. */
  private trim(): void {
    if (this.seen.size <= STORAGE_LIMITS.seenAccountsMax) return;
    const shown = new Set<string>();
    for (const keys of this.tabs.values()) for (const key of keys) shown.add(key);
    const oldestFirst = [...this.seen.values()].sort(newestFirst).reverse();
    for (const item of oldestFirst) {
      if (this.seen.size <= STORAGE_LIMITS.seenAccountsMax) break;
      const key = keyOf(item.account);
      if (!shown.has(key)) this.seen.delete(key);
    }
  }
}
