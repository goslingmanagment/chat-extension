// Presence of the ChatSpace tabs (architecture.md §9.8 «присутствие
// вкладок», §9.9 «Аккаунты, которые видел этот браузер», §5.6 `presence`):
//
// - Tabs: every registered tab (`tabRegistered`, wired from the RPC's
//   onTabRegistered) counts as listening from its registration; what it
//   shows comes with its `tab.presence` reports. In memory only — a tab
//   session lives as long as its port, and after the event page unloads
//   every tab registers again and reports anew. Out-of-order reports (an
//   older route epoch) are ignored. A tab's ChatSpace may have several
//   accounts loaded; the one its route is on is the one the person works
//   under there (`routeTabs`, «Статус»), the loaded ones are `openTabs`.
// - Seen host accounts: the `presence` key of storage.local, newest first,
//   at most 500 (PresenceStoreSchema). One set per change, and a known
//   account's time is refreshed at most every 10 minutes, so reports do not
//   turn into a write storm. A failed read is never overwritten: the next
//   write first reads again, and joins what it reads to what this event page
//   saw meanwhile. Memory is this event page's truth — a tab is bound to its
//   pages by it (`seenAccounts`) — so a failed read or write never drops what
//   a tab reported: it only means the next event page may not remember it
//   until a tab reports it again.

import { PresenceStoreSchema, type PresenceStore, type SeenHostAccount } from '@cg/contracts/host';
import { chatKeyOf, type ChatKey, type ChatRef, type HostAccount } from '@cg/contracts/ids';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { STORAGE_KEYS, hostAccountKeyOf, type HostAccountKey } from '@cg/contracts/settings';

import { stableJson } from '../domain/storage';
import { NO_LOG, SYSTEM_CLOCK, createWriteChain, type Clock, type KeyValuePort, type ServiceLog } from './storage/ports';

/** A `tab.presence` request as the background got it (schema-checked by the RPC). */
export interface TabPresenceReport {
  readonly chat: ChatRef | null;
  readonly conversationRef?: string | undefined;
  readonly routeEpoch: number;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly accounts?: readonly HostAccount[] | undefined;
  /** The account the tab's route is on; absent — a tab from before contracts 1.8.0. */
  readonly routeAccount?: HostAccount | null | undefined;
  /** 1.20.0: the open chat's fan as the tab names it; null or absent — no name (display only, memory alone). */
  readonly fanLabel?: string | null | undefined;
  readonly fanUsername?: string | null | undefined;
  /** Chat Memory week 1: the person's last key, click or scroll in the tab; null or absent — none since it opened. */
  readonly lastInputAt?: number | null | undefined;
  /** 2026-11-01: the route's name as the site names it; absent — an older tab. */
  readonly routeName?: 'chat' | 'accounts-overview' | 'other' | undefined;
  /** 2026-11-01: ChatSpace's socket coverage of each account the tap reported; absent — an older tab, or none yet. */
  readonly coverage?: readonly { readonly hostAccountId: string; readonly covered: boolean; readonly since: number }[] | undefined;
  /** 2026-11-01: ChatSpace's socket as the tap last said it; null — not said yet; absent — an older tab. */
  readonly socket?: TabSocketState | null | undefined;
}

/** ChatSpace's socket as a tab reported it (contracts SocketStateEvent). */
export interface TabSocketState {
  readonly state: 'connecting' | 'open' | 'closed';
  readonly since: number;
  readonly authed: boolean;
  readonly subscribed: readonly string[];
  readonly observable: boolean;
}

export interface TabPresence {
  readonly tabSessionId: string;
  readonly chat: ChatRef | null;
  readonly conversationRef?: string | undefined;
  readonly chatKey: ChatKey | null;
  readonly routeEpoch: number;
  readonly visible: boolean;
  readonly focused: boolean;
  /** Host accounts this tab's ChatSpace has loaded (its last list). */
  readonly accounts: readonly HostAccountKey[];
  /**
   * The one account the tab's route is on, chat open or not: ChatSpace loads every account of the person,
   * so `accounts` may hold several. null — the route names none, or the tab did not say (before 1.8.0).
   */
  readonly routeAccount: HostAccountKey | null;
  /** 1.20.0 (decision X47): the open chat's fan as the tab named it; null — no name. Never stored. */
  readonly fanLabel: string | null;
  /** The open chat's fan's @handle as the tab knows it (without «@»); null — none. */
  readonly fanUsername: string | null;
  /** Chat Memory week 1: the person's last input in the tab (the tab's clock, this browser's); null — none since it opened. */
  readonly lastInputAt: number | null;
  /** 2026-11-01: the route's name as the tab last said it; null — the tab did not say. */
  readonly routeName: 'chat' | 'accounts-overview' | 'other' | null;
  /** 2026-11-01: ChatSpace's socket coverage per account as the tab last said it (the always-on tab's report). */
  readonly coverage: readonly { readonly hostAccountId: string; readonly covered: boolean; readonly since: number }[];
  /** 2026-11-01: ChatSpace's socket as the tab last said it; null — never said. */
  readonly socket: TabSocketState | null;
  readonly updatedAt: number;
}

export interface SeenAccountView {
  readonly account: HostAccount;
  readonly lastSeenAt: string;
  /** Tabs whose last list has this account. */
  readonly openTabs: number;
  /** Tabs whose route is on this account now: the account the person works under there. */
  readonly routeTabs: number;
}

export interface PresenceService {
  /** Load the seen accounts; the readiness barrier runs it. */
  start(): Promise<{ readonly readable: boolean; readonly accounts: number }>;
  /** A tab registered (the RPC's onTabRegistered): it listens before its first report. */
  tabRegistered(tabSessionId: string): void;
  /** `tab.presence`: `recorded` false — an out-of-order report, ignored. */
  report(tabSessionId: string, report: TabPresenceReport): Promise<{ readonly recorded: boolean }>;
  /** The tab's port closed (the RPC's onTabGone). */
  tabGone(tabSessionId: string): void;
  /** Tabs that reported what they show. */
  tabs(): readonly TabPresence[];
  /** Registered ChatSpace tabs, reported or not: sound and diagnostics count them as listening (SN-015). */
  listeningTabs(): number;
  /** The chat is open in a visible tab that has the focus (no sound for it, §9.8). */
  isChatInFocus(chatKey: ChatKey): boolean;
  /** Tabs showing this chat now. */
  tabsShowing(chatKey: ChatKey): readonly string[];
  /** `accounts.seen`, newest first. */
  seenAccounts(): readonly SeenAccountView[];
  /** «Очистить локальные данные». */
  clearSeen(): Promise<boolean>;
  onChange(listener: () => void): () => void;
}

export interface PresenceDeps {
  readonly local: KeyValuePort;
  readonly clock?: Clock;
  readonly log?: ServiceLog;
  /** A known account's `lastSeenAt` is refreshed at most this often. */
  readonly refreshMs?: number;
}

export const PRESENCE_REFRESH_MS = 10 * 60 * 1000;

const KEY = STORAGE_KEYS.presence;
const SCOPE = 'bg.presence';

export function createPresence(deps: PresenceDeps): PresenceService {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const log = deps.log ?? NO_LOG;
  const refreshMs = deps.refreshMs ?? PRESENCE_REFRESH_MS;
  const chain = createWriteChain();
  const tabs = new Map<string, TabPresence>();
  /** Every registered tab session (a report registers too, in case the hook was not wired). */
  const registered = new Set<string>();
  const listeners = new Set<() => void>();
  /** Newest first. */
  let seen: SeenHostAccount[] = [];
  let loaded = false;
  let started: Promise<{ readonly readable: boolean; readonly accounts: number }> | null = null;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // a listener's bug is not the presence's
      }
    }
  };

  async function load(): Promise<boolean> {
    const read = await deps.local.get([KEY]);
    if (!read.ok) {
      log({ level: 'warn', scope: SCOPE, msg: 'seen accounts read failed', code: 'CG-STORAGE-READ' });
      return false;
    }
    const raw = read.value[KEY];
    loaded = true;
    if (raw === undefined) return true;
    const parsed = PresenceStoreSchema.safeParse(raw);
    if (!parsed.success) {
      // A cache of what this browser saw: an unreadable one starts over.
      log({ level: 'warn', scope: SCOPE, msg: 'seen accounts not interpretable: starting over' });
      return true;
    }
    // What this event page saw while the key could not be read (nothing, at start) is newer than what is stored.
    const known = new Set(seen.map((item) => hostAccountKeyOf(item.account.host, item.account.hostAccountId)));
    seen = [...seen, ...parsed.data.accounts.filter((item) => !known.has(hostAccountKeyOf(item.account.host, item.account.hostAccountId)))].slice(0, STORAGE_LIMITS.seenAccountsMax);
    return true;
  }

  /** Merges a tab's accounts; answers the new list when anything worth a write changed. */
  function merged(accounts: readonly HostAccount[], now: number): SeenHostAccount[] | null {
    const iso = new Date(now).toISOString();
    let changed = false;
    let next = [...seen];
    for (const reported of accounts) {
      const key = hostAccountKeyOf(reported.host, reported.hostAccountId);
      const index = next.findIndex((item) => hostAccountKeyOf(item.account.host, item.account.hostAccountId) === key);
      const previous = index >= 0 ? next[index] : undefined;
      // A report that does not know the account's names (a tab before its page named them) keeps the names seen:
      // unknown is not «none», and «Аккаунты» never goes back from the creator's name to the bare number.
      const account = previous === undefined || previous.account.platformAccountId !== reported.platformAccountId ? reported : { ...reported, username: reported.username ?? previous.account.username, displayName: reported.displayName ?? previous.account.displayName };
      const stale = previous === undefined || now - Date.parse(previous.lastSeenAt) >= refreshMs || stableJson(previous.account) !== stableJson(account);
      if (!stale) continue;
      changed = true;
      if (index >= 0) next.splice(index, 1);
      next.unshift({ account, lastSeenAt: iso });
    }
    if (!changed) return null;
    next = next.slice(0, STORAGE_LIMITS.seenAccountsMax);
    return next;
  }

  const service: PresenceService = {
    start() {
      started ??= chain(async () => {
        const readable = await load();
        return { readable, accounts: seen.length };
      });
      return started;
    },
    tabRegistered(tabSessionId) {
      if (registered.has(tabSessionId)) return;
      registered.add(tabSessionId);
      notify();
    },
    async report(tabSessionId, report) {
      registered.add(tabSessionId);
      const previous = tabs.get(tabSessionId);
      if (previous && report.routeEpoch < previous.routeEpoch) return { recorded: false };
      const now = clock.now();
      const accountKeys = report.accounts ? report.accounts.map((account) => hostAccountKeyOf(account.host, account.hostAccountId)) : (previous?.accounts ?? []);
      tabs.set(tabSessionId, {
        tabSessionId,
        chat: report.chat,
        chatKey: report.chat ? chatKeyOf(report.chat) : null,
        ...(report.conversationRef === undefined ? {} : { conversationRef: report.conversationRef }),
        routeEpoch: report.routeEpoch,
        visible: report.visible,
        focused: report.focused,
        accounts: accountKeys,
        // Every report carries the route as it is now (the tab sends it with each); an older tab's report
        // says nothing of it, and nothing is assumed.
        routeAccount: report.routeAccount ? hostAccountKeyOf(report.routeAccount.host, report.routeAccount.hostAccountId) : null,
        fanLabel: report.chat !== null && typeof report.fanLabel === 'string' && report.fanLabel.trim() !== '' ? report.fanLabel.trim() : null,
        fanUsername: report.chat !== null && typeof report.fanUsername === 'string' && report.fanUsername.trim().replace(/^@/, '') !== '' ? report.fanUsername.trim().replace(/^@/, '') : null,
        // A report without it (an older tab) keeps what the tab said before: input never goes back in time.
        lastInputAt: Math.max(report.lastInputAt ?? -1, previous?.lastInputAt ?? -1) < 0 ? null : Math.max(report.lastInputAt ?? -1, previous?.lastInputAt ?? -1),
        routeName: report.routeName ?? previous?.routeName ?? null,
        coverage: report.coverage ?? previous?.coverage ?? [],
        socket: report.socket ?? previous?.socket ?? null,
        updatedAt: now,
      });
      notify();
      if (!report.accounts || report.accounts.length === 0) return { recorded: true };
      const accounts = report.accounts;
      await (started ??= service.start());
      await chain(async () => {
        const readable = loaded || (await load());
        const next = merged(accounts, clock.now());
        if (next === null) return;
        // Taken whatever storage says: the tab's requests are answered by it (`seenAccounts`), and it does not
        // report the same accounts again. A failed read is not written over; a failed write is only logged.
        seen = next;
        if (!readable) return;
        const value: PresenceStore = { v: 1, accounts: next };
        const saved = await deps.local.set({ [KEY]: value });
        if (!saved.ok) log({ level: 'warn', scope: SCOPE, msg: 'seen accounts not saved: kept in memory', code: saved.code });
      });
      return { recorded: true };
    },
    tabGone(tabSessionId) {
      const known = registered.delete(tabSessionId);
      if (tabs.delete(tabSessionId) || known) notify();
    },
    tabs: () => [...tabs.values()],
    listeningTabs: () => registered.size,
    isChatInFocus(chatKey) {
      for (const tab of tabs.values()) if (tab.chatKey === chatKey && tab.visible && tab.focused) return true;
      return false;
    },
    tabsShowing(chatKey) {
      return [...tabs.values()].filter((tab) => tab.chatKey === chatKey).map((tab) => tab.tabSessionId);
    },
    seenAccounts() {
      return seen.map((item) => {
        const key = hostAccountKeyOf(item.account.host, item.account.hostAccountId);
        let openTabs = 0;
        let routeTabs = 0;
        for (const tab of tabs.values()) {
          if (tab.accounts.includes(key)) openTabs += 1;
          if (tab.routeAccount === key) routeTabs += 1;
        }
        return { account: { ...item.account }, lastSeenAt: item.lastSeenAt, openTabs, routeTabs };
      });
    },
    clearSeen() {
      return chain(async () => {
        const removed = await deps.local.remove([KEY]);
        if (!removed.ok) return false;
        seen = [];
        loaded = true;
        notify();
        return true;
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return service;
}
