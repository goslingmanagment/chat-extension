// Presence (architecture.md §9.8, §9.9): the accounts this browser saw are the
// event page's own memory — a tab is bound to its pages by them (`seenAccounts`)
// — and storage only carries them to the next event page. A storage call that
// fails never takes an account a tab reported away from this one.

import { account } from '@cg/contracts/fixtures';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { createPresence, type TabPresenceReport } from './presence';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv } from './test-support/memory-kv';

const KEY = STORAGE_KEYS.presence;
const OTHER = { ...account, hostAccountId: '90001', platformAccountId: '90002', username: 'model_two', displayName: 'Model Two' };
const report = (over: Partial<TabPresenceReport> = {}): TabPresenceReport => ({ chat: null, routeEpoch: 1, visible: true, focused: true, accounts: [account], routeAccount: account, ...over });
const stored = (value: unknown): readonly string[] => ((value as { accounts?: { account: { hostAccountId: string } }[] } | undefined)?.accounts ?? []).map((item) => item.account.hostAccountId);

describe('[§9.9] the accounts this browser saw: memory is the event page’s, storage the next one’s', () => {
  it('a failed write keeps the reported account: the tab stays bound by it, and a later report without accounts changes nothing', async () => {
    const local = createMemoryKv();
    const logs: ServiceLogEntry[] = [];
    const presence = createPresence({ local: local.open(), log: (entry) => logs.push(entry) });
    await presence.start();
    local.failNext('set', 'fail');
    expect(await presence.report('tab-1', report())).toEqual({ recorded: true });
    expect(presence.seenAccounts()).toMatchObject([{ account, openTabs: 1, routeTabs: 1 }]);
    // A keepalive (no accounts) is not a reason to write; the account stays known.
    await presence.report('tab-1', report({ accounts: undefined }));
    expect(presence.seenAccounts().map((seen) => seen.account.hostAccountId)).toEqual([account.hostAccountId]);
    expect(local.read(KEY)).toBeUndefined();
    expect(logs).toContainEqual(expect.objectContaining({ level: 'warn', code: 'CG-STORAGE-WRITE' }));
    // The next write carries it too: what memory holds is what is stored.
    await presence.report('tab-2', report({ accounts: [OTHER], routeAccount: OTHER }));
    expect(stored(local.read(KEY))).toEqual([OTHER.hostAccountId, account.hostAccountId]);
  });

  it('a failed read keeps the reported account too, and never writes over the unread store; the next read joins the two', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { v: 1, accounts: [{ account: OTHER, lastSeenAt: '2026-01-01T00:00:00.000Z' }] });
    const presence = createPresence({ local: local.open() });
    local.failNext('get');
    expect(await presence.start()).toEqual({ readable: false, accounts: 0 });
    local.failNext('get');
    await presence.report('tab-1', report());
    expect(presence.seenAccounts().map((seen) => seen.account.hostAccountId)).toEqual([account.hostAccountId]);
    expect(local.calls.set).toBe(0);
    // Readable again: what this event page saw goes first, what was stored stays.
    await presence.report('tab-2', report({ accounts: [OTHER], routeAccount: OTHER }));
    expect(presence.seenAccounts().map((seen) => seen.account.hostAccountId)).toEqual([OTHER.hostAccountId, account.hostAccountId]);
    expect(stored(local.read(KEY))).toEqual([OTHER.hostAccountId, account.hostAccountId]);
  });
});
