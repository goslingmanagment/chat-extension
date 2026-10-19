import { FanslyAccountsViewSchema } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { createNetworkSession, legacyAccount, type RequestFact } from '../../network-session';
import { createMemoryKv } from '../../test-support/memory-kv';
import { createFanslyAccounts, type FanslySessionsPort, type FanslyTabsPort } from './accounts';

declare function btoa(value: string): string;

const CREATOR = '700000000000000001';
const LEGACY = '700000000000000101';
const OTHER = '700000000000000002';

interface Session {
  legacyId: string;
  canonicalId: string | null;
  observedAt: number;
}

/** The network session's read-only projection: the identities already known for each tab. */
function sessionsOf(byTab: Record<number, Session>): FanslySessionsPort {
  return {
    forTab: (tabId) => byTab[tabId] ?? null,
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
  it('[ST-079] an account switch before the next presence report must not persist B as A’s alias', async () => {
    const store = createMemoryKv();
    const sessions = createNetworkSession({
      storage: store.open(), key: 'session', now: () => 1_000,
      ownOrigin: 'moz-extension://ours/', pageRequest: () => true, apiRequest: () => true,
      requiredHeaders: ['authorization'], materialHeaders: ['authorization'], checkHeader: 'check',
      accountOf: legacyAccount, familyOf: () => 'account',
    });
    await sessions.setEnabled(true);
    const capture = async (legacy: string, tabId = 4): Promise<void> => {
      const fact: RequestFact = { phase: 'headers', requestId: `${tabId}-${legacy}`, url: 'https://example.test/account/me', tabId, frameId: 0, requestHeaders: [{ name: 'authorization', value: btoa(`${legacy}:synthetic`) }] };
      await sessions.accept(fact);
      await sessions.accept({ ...fact, phase: 'completed', statusCode: 200 });
    };
    await capture(LEGACY);
    await sessions.resolveIdentity(LEGACY, CREATOR, sessions.forAccount(LEGACY) ?? { headers: {} }); // Previously proven identity of A.
    await capture(LEGACY, 5); // A remains open in another tab.
    const tabs = tabsOf([4, 5], [{ tabId: 4, accounts: [CREATOR] }, { tabId: 5, accounts: [CREATOR] }]);
    await capture(OTHER); // B completes while tab 4 still reports A.
    const accounts = createFanslyAccounts({ sessions, tabs });
    const before = store.read('session');
    expect((await accounts.read()).sessions).toContainEqual({ legacyId: OTHER, canonicalId: null, tabs: 1, observedAt: 1_000 });
    expect(sessions.forAccount(OTHER)?.canonicalId).toBeNull();
    expect(store.read('session')).toEqual(before);
  });

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

  it('[ST-079] presence alone cannot correlate different ids; only an already proven session alias folds into its creator', async () => {
    const sessions = sessionsOf({ 4: { legacyId: LEGACY, canonicalId: null, observedAt: 1_000 }, 5: { legacyId: OTHER, canonicalId: null, observedAt: 2_000 } });
    const tabs = tabsOf([4, 5], [{ tabId: 4, accounts: [CREATOR] }]);
    const accounts = createFanslyAccounts({ sessions, tabs });
    const first = await accounts.read();
    expect(first.sessions).toContainEqual({ legacyId: LEGACY, canonicalId: null, tabs: 1, observedAt: 1_000 });
    expect(first.sessions).toContainEqual({ legacyId: OTHER, canonicalId: null, tabs: 1, observedAt: 2_000 });
    const proven = sessionsOf({ 4: { legacyId: LEGACY, canonicalId: CREATOR, observedAt: 1_000 } });
    expect((await createFanslyAccounts({ sessions: proven, tabs }).read()).sessions).toContainEqual({ legacyId: LEGACY, canonicalId: CREATOR, tabs: 1, observedAt: 1_000 });
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
