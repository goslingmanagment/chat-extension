import { FanslyAccountsViewSchema } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { createFanslyAccounts, type FanslySessionsPort, type FanslyTabsPort } from './accounts';

const CREATOR = '700000000000000001';
const LEGACY = '700000000000000101';
const OTHER = '700000000000000002';

interface Session {
  legacyId: string;
  canonicalId: string | null;
  observedAt: number;
}

/** The network session as the module reads it: a session per tab, and the bindings it was asked to make. */
function sessionsOf(byTab: Record<number, Session>): FanslySessionsPort & { readonly resolved: string[] } {
  const resolved: string[] = [];
  return {
    resolved,
    forTab: (tabId) => byTab[tabId] ?? null,
    resolveIdentity(tabId, legacyId, canonicalId) {
      resolved.push(`${tabId}:${legacyId}→${canonicalId}`);
      const session = byTab[tabId];
      // The network session binds only the tab's own session (network-session.ts).
      if (session !== undefined && session.legacyId === legacyId) session.canonicalId = canonicalId;
      return Promise.resolve();
    },
  };
}

function tabsOf(open: readonly number[] | null, registered: { tabId: number; accounts: string[] }[], refuse: readonly number[] = []): FanslyTabsPort & { readonly focused: number[] } {
  const focused: number[] = [];
  return {
    focused,
    open: () => Promise.resolve(open),
    registered: () => registered,
    focus(tabId) {
      if (refuse.includes(tabId)) return Promise.resolve(false);
      focused.push(tabId);
      return Promise.resolve(true);
    },
  };
}

describe('[host:fansly] «Аккаунты» on Fansly in the background (R20 P14b1)', () => {
  it('[ST-067] [AU-035] the live sessions next to the registrations: one row per session, how many open tabs ride it, ids and a time only', async () => {
    const sessions = sessionsOf({ 1: { legacyId: CREATOR, canonicalId: CREATOR, observedAt: 5_000.004 }, 2: { legacyId: CREATOR, canonicalId: CREATOR, observedAt: 4_000 }, 3: { legacyId: OTHER, canonicalId: null, observedAt: 9_000 } });
    const accounts = createFanslyAccounts({ sessions, tabs: tabsOf([1, 2, 3], [{ tabId: 1, accounts: [CREATOR] }]) });
    const view = await accounts.read();
    expect(view).toEqual({
      sessions: [
        { legacyId: OTHER, canonicalId: null, tabs: 1, observedAt: 9_000 },
        { legacyId: CREATOR, canonicalId: CREATOR, tabs: 2, observedAt: 5_000 },
      ],
      openTabs: 3,
      unattributedTabs: 0,
    });
    expect(FanslyAccountsViewSchema.safeParse(view).success).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/authorization|fansly-client|headers/);
  });

  it('[ST-079] a tab that named its creator binds its own session to it (legacy → canonical), once; a session of no named tab stays legacy', async () => {
    const sessions = sessionsOf({ 4: { legacyId: LEGACY, canonicalId: null, observedAt: 1_000 }, 5: { legacyId: OTHER, canonicalId: null, observedAt: 2_000 } });
    const tabs = tabsOf([4, 5], [{ tabId: 4, accounts: [CREATOR] }]);
    const accounts = createFanslyAccounts({ sessions, tabs });
    const first = await accounts.read();
    expect(sessions.resolved).toEqual([`4:${LEGACY}→${CREATOR}`]);
    expect(first.sessions).toContainEqual({ legacyId: LEGACY, canonicalId: CREATOR, tabs: 1, observedAt: 1_000 });
    expect(first.sessions).toContainEqual({ legacyId: OTHER, canonicalId: null, tabs: 1, observedAt: 2_000 });
    await accounts.read();
    // Bound already: nothing is written again.
    expect(sessions.resolved).toHaveLength(1);
  });

  it('[ST-077] «без атрибуции»: an open tab with neither a named creator nor a session; unknown when the browser does not say which tabs are open', async () => {
    const sessions = sessionsOf({ 7: { legacyId: OTHER, canonicalId: null, observedAt: 1 } });
    const tabs = tabsOf([6, 7, 8, 9], [{ tabId: 6, accounts: [CREATOR] }, { tabId: 8, accounts: [] }]);
    const view = await createFanslyAccounts({ sessions, tabs }).read();
    // 8 registered but has not said its creator yet, 9 runs no script of ours (opened before the grant) and sent nothing.
    expect(view).toMatchObject({ openTabs: 4, unattributedTabs: 2 });
    const unknown = await createFanslyAccounts({ sessions, tabs: tabsOf(null, [{ tabId: 6, accounts: [CREATOR] }]) }).read();
    expect(unknown).toMatchObject({ openTabs: null, unattributedTabs: null });
  });

  it('[ST-076] «к вкладке»: the newest registered tab of the creator, else a tab whose session is it (either id); nothing open — false', async () => {
    const sessions = sessionsOf({ 12: { legacyId: LEGACY, canonicalId: null, observedAt: 1 } });
    const registered = tabsOf([10, 11, 12], [{ tabId: 10, accounts: [CREATOR] }, { tabId: 11, accounts: [CREATOR] }]);
    expect(await createFanslyAccounts({ sessions, tabs: registered }).focus(CREATOR)).toBe(true);
    expect(registered.focused).toEqual([11]);
    // The newest is gone meanwhile: the next one.
    const gone = tabsOf([10, 11], [{ tabId: 10, accounts: [CREATOR] }, { tabId: 11, accounts: [CREATOR] }], [11]);
    expect(await createFanslyAccounts({ sessions, tabs: gone }).focus(CREATOR)).toBe(true);
    expect(gone.focused).toEqual([10]);
    // A tab opened before the grant: found by its session's legacy id.
    const bySession = tabsOf([12], []);
    expect(await createFanslyAccounts({ sessions, tabs: bySession }).focus(LEGACY)).toBe(true);
    expect(bySession.focused).toEqual([12]);
    const none = tabsOf([], []);
    expect(await createFanslyAccounts({ sessions, tabs: none }).focus(OTHER)).toBe(false);
    expect(none.focused).toEqual([]);
  });
});
