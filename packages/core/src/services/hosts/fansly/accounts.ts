// «Аккаунты» on Fansly as the background sees them (R20 P14b1; docs/project-unite/architecture.md §4, §8.2; FS-SET-1,
// FS-IDN-1; ST-067, ST-076, ST-077, ST-079, AU-035): the answers of `fansly.accounts.{read,focus}` for Fansly's
// background chunk (`bg/fansly`). The settings page lists the creators the tabs reported (presence, the shared
// `accounts.seen`) and adds what only the background knows:
//
// - The live sessions it captured (network-session.ts): the account the session's token names (legacy, AU-031) and,
//   once a tab of ours on it said its creator from `/account/me`, that creator (canonical, AU-032). A tab opened before
//   Fansly was switched on runs no script of ours until it is reloaded, yet its requests are seen: the session is how
//   the page knows the model works there.
// - The reconciliation (ST-079): a registered tab that named its creator and carries a session binds the two —
//   `resolveIdentity` of that very tab and its very session, never by a name. It runs on every read: a tab says its
//   creator after the session was captured, and the page reads again when it comes back on screen.
// - «Вкладки без атрибуции» (ST-077): Fansly tabs open in the browser that neither named their creator to us nor carry
//   a session — opened before the grant and never used, or a tab still loading. Counted, never guessed.
// - «к вкладке» (ST-076): the tab of the account — by its registration (its report names the creator), else by its
//   session (legacy or canonical id) — to the front, without the `tabs` right (`tabs.update` and `windows.update` need
//   none). Nothing is sent to the tab: Fansly's own router is not ours to drive (navigation on Fansly is P17).
//
// Ids, counts and a time cross to the page; never a header (LG-026).

import { FANSLY_PAGE_SESSIONS_MAX, type FanslyAccountSession, type FanslyAccountsView } from '@cg/contracts/tab-messages-fansly';

import type { SessionTemplate } from '../../network-session';

/** The network session as this reads it: the live session of a tab, and the binding of a tab's session to its creator. */
export interface FanslySessionsPort {
  forTab(tabId: number): Pick<SessionTemplate, 'legacyId' | 'canonicalId' | 'observedAt'> | null;
  resolveIdentity(tabId: number, legacyId: string, canonicalId: string): Promise<void>;
}

/** Fansly's tabs as the core knows them (the kit's `siteTabs`). */
export interface FanslyTabsPort {
  /** Open by the granted address; null — the browser did not answer. */
  open(): Promise<readonly number[] | null>;
  /** Registered tab documents and the creators their last report named. */
  registered(): readonly { readonly tabId: number; readonly accounts: readonly string[] }[];
  focus(tabId: number): Promise<boolean>;
}

export interface FanslyAccountsDeps {
  readonly sessions: FanslySessionsPort;
  readonly tabs: FanslyTabsPort;
}

export interface FanslyAccounts {
  /** `fansly.accounts.read`: reconciles first, then the sessions and the tabs no account is known for. */
  read(): Promise<FanslyAccountsView>;
  /** `fansly.accounts.focus`: true — a tab of the account is in front now. */
  focus(hostAccountId: string): Promise<boolean>;
}

export function createFanslyAccounts(deps: FanslyAccountsDeps): FanslyAccounts {
  /** The creator each registered tab named (the newest registration of a tab with one wins: a reload registers again). */
  const creators = (): Map<number, string> => {
    const out = new Map<number, string>();
    for (const registration of deps.tabs.registered()) {
      const creator = registration.accounts[0];
      if (creator !== undefined) out.set(registration.tabId, creator);
    }
    return out;
  };

  return {
    async read() {
      const open = await deps.tabs.open();
      const named = creators();
      const tabIds = [...new Set([...(open ?? []), ...deps.tabs.registered().map((registration) => registration.tabId)])];
      // ST-079: a tab that named its creator binds its own session to it.
      for (const tabId of tabIds) {
        const session = deps.sessions.forTab(tabId);
        const creator = named.get(tabId);
        if (session !== null && creator !== undefined && session.canonicalId !== creator) await deps.sessions.resolveIdentity(tabId, session.legacyId, creator);
      }
      const sessions = new Map<string, FanslyAccountSession>();
      let unattributed = 0;
      for (const tabId of tabIds) {
        const session = deps.sessions.forTab(tabId);
        if (session === null) {
          if (!named.has(tabId)) unattributed += 1;
          continue;
        }
        const known = sessions.get(session.legacyId);
        sessions.set(session.legacyId, {
          legacyId: session.legacyId,
          canonicalId: session.canonicalId,
          tabs: (known?.tabs ?? 0) + 1,
          observedAt: Math.max(known?.observedAt ?? 0, Math.floor(session.observedAt)),
        });
      }
      return {
        sessions: [...sessions.values()].sort((a, b) => b.observedAt - a.observedAt).slice(0, FANSLY_PAGE_SESSIONS_MAX),
        openTabs: open === null ? null : open.length,
        // Unknown when the browser did not say which tabs are open: the registered ones alone are not «all».
        unattributedTabs: open === null ? null : unattributed,
      };
    },
    async focus(hostAccountId) {
      const registered = deps.tabs
        .registered()
        .filter((registration) => registration.accounts.includes(hostAccountId))
        .map((registration) => registration.tabId);
      const open = (await deps.tabs.open()) ?? [];
      const bySession = open.filter((tabId) => {
        const session = deps.sessions.forTab(tabId);
        return session !== null && (session.legacyId === hostAccountId || session.canonicalId === hostAccountId);
      });
      // The newest registration first: the tab the person opened last for this model.
      for (const tabId of [...new Set([...registered.reverse(), ...bySession])]) if (await deps.tabs.focus(tabId)) return true;
      return false;
    },
  };
}
