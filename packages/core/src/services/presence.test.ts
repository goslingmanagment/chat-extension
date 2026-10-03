import { account, chat, IDS, T0 } from '@cg/contracts/fixtures';
import { chatKeyOf, type HostAccount } from '@cg/contracts/ids';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { createPresence, PRESENCE_REFRESH_MS } from './presence';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, manualClock, type MemoryKv } from './test-support/memory-kv';

const KEY = STORAGE_KEYS.presence;
const other: HostAccount = { ...account, hostAccountId: IDS.otherAcc, platformAccountId: null, username: null, displayName: null };
const otherChat = { ...chat, platformFanId: IDS.otherFan };

function setup(local: MemoryKv = createMemoryKv(), at = T0) {
  const clock = manualClock(at);
  const logs: ServiceLogEntry[] = [];
  const port = local.open();
  const presence = createPresence({ local: port, clock, log: (entry) => logs.push(entry) });
  return { local, port, clock, logs, presence };
}

describe('[SN-015] presence of the ChatSpace tabs (§9.8)', () => {
  it('knows which tab shows which chat, visible and focused; ignores an out-of-order report', async () => {
    const { presence } = setup();
    let changes = 0;
    const off = presence.onChange(() => (changes += 1));
    presence.onChange(() => {
      throw new Error('listener bug');
    });
    await presence.report('tab-a', { chat, routeEpoch: 3, visible: true, focused: true });
    await presence.report('tab-b', { chat, routeEpoch: 1, visible: true, focused: false });
    expect(presence.listeningTabs()).toBe(2);
    expect(presence.isChatInFocus(chatKeyOf(chat))).toBe(true);
    expect(presence.tabsShowing(chatKeyOf(chat))).toEqual(['tab-a', 'tab-b']);
    expect(await presence.report('tab-a', { chat: otherChat, routeEpoch: 2, visible: true, focused: true })).toEqual({ recorded: false });
    await presence.report('tab-a', { chat: otherChat, routeEpoch: 4, visible: true, focused: true });
    expect(presence.isChatInFocus(chatKeyOf(chat))).toBe(false);
    expect(presence.isChatInFocus(chatKeyOf(otherChat))).toBe(true);
    await presence.report('tab-a', { chat: null, routeEpoch: 5, visible: false, focused: false });
    expect(presence.tabs().find((tab) => tab.tabSessionId === 'tab-a')).toMatchObject({ chat: null, chatKey: null, visible: false });
    presence.tabGone('tab-b');
    presence.tabGone('tab-unknown');
    expect(presence.listeningTabs()).toBe(1);
    off();
    expect(changes).toBe(5);
  });

  it('a registered tab listens before its first report; its port closing ends it', async () => {
    const { presence } = setup();
    let changes = 0;
    presence.onChange(() => (changes += 1));
    presence.tabRegistered('tab-a');
    presence.tabRegistered('tab-a');
    presence.tabRegistered('tab-b');
    expect(presence.listeningTabs()).toBe(2);
    expect(presence.tabs()).toEqual([]);
    await presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true });
    expect(presence.listeningTabs()).toBe(2);
    presence.tabGone('tab-b');
    expect(presence.listeningTabs()).toBe(1);
    presence.tabGone('tab-a');
    expect(presence.listeningTabs()).toBe(0);
    expect(presence.tabs()).toEqual([]);
    expect(changes).toBe(5);
  });

  it('the chat is «in focus» only in a tab that is both visible and focused (no sound for it)', async () => {
    const { presence } = setup();
    await presence.report('tab-a', { chat, routeEpoch: 1, visible: false, focused: true });
    expect(presence.isChatInFocus(chatKeyOf(chat))).toBe(false);
    await presence.report('tab-a', { chat, routeEpoch: 2, visible: true, focused: false });
    expect(presence.isChatInFocus(chatKeyOf(chat))).toBe(false);
    await presence.report('tab-a', { chat, routeEpoch: 3, visible: true, focused: true });
    expect(presence.isChatInFocus(chatKeyOf(chat))).toBe(true);
  });
});

describe('seen host accounts in storage.local `presence` (§9.9)', () => {
  it('stores the accounts a tab reported, newest first, with how many tabs show each now', async () => {
    const { presence, local, clock } = setup();
    expect(await presence.start()).toEqual({ readable: true, accounts: 0 });
    await presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] });
    clock.advance(1000);
    await presence.report('tab-b', { chat: null, routeEpoch: 1, visible: true, focused: false, accounts: [other, account] });
    const value = local.read<{ v: 1; accounts: { account: HostAccount; lastSeenAt: string }[] }>(KEY);
    expect(value?.v).toBe(1);
    // The first account was seen a second ago (not refreshed yet); the new one is the newest.
    expect(value?.accounts.map((item) => item.account.hostAccountId)).toEqual([IDS.otherAcc, IDS.acc]);
    expect(presence.seenAccounts().map((item) => [item.account.hostAccountId, item.openTabs])).toEqual([
      [IDS.otherAcc, 1],
      [IDS.acc, 2],
    ]);
    // A later report without accounts keeps the tab's last list.
    await presence.report('tab-b', { chat, routeEpoch: 2, visible: true, focused: true });
    expect(presence.seenAccounts().find((item) => item.account.hostAccountId === IDS.otherAcc)?.openTabs).toBe(1);
    presence.tabGone('tab-b');
    expect(presence.seenAccounts().map((item) => item.openTabs)).toEqual([0, 1]);
  });

  it('a known account is refreshed at most every 10 minutes, or when it changed; one set per change', async () => {
    const { presence, local, clock } = setup();
    await presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] });
    const writes = local.calls.set;
    clock.advance(60_000);
    await presence.report('tab-a', { chat, routeEpoch: 2, visible: true, focused: true, accounts: [account] });
    expect(local.calls.set).toBe(writes);
    await presence.report('tab-a', { chat, routeEpoch: 3, visible: true, focused: true, accounts: [{ ...account, displayName: 'Renamed' }] });
    expect(local.calls.set).toBe(writes + 1);
    clock.advance(PRESENCE_REFRESH_MS);
    await presence.report('tab-a', { chat, routeEpoch: 4, visible: true, focused: true, accounts: [{ ...account, displayName: 'Renamed' }] });
    expect(local.calls.set).toBe(writes + 2);
    expect(presence.seenAccounts()[0]?.lastSeenAt).toBe(new Date(T0 + 60_000 + PRESENCE_REFRESH_MS).toISOString());
  });

  it('keeps at most 500 accounts, dropping the longest unseen', async () => {
    const { presence } = setup();
    const many = Array.from({ length: STORAGE_LIMITS.seenAccountsMax + 5 }, (_, i) => ({ ...other, hostAccountId: `${10_000 + i}` }));
    await presence.report('tab-a', { chat: null, routeEpoch: 1, visible: true, focused: true, accounts: many });
    const seen = presence.seenAccounts();
    expect(seen).toHaveLength(STORAGE_LIMITS.seenAccountsMax);
    expect(seen[0]?.account.hostAccountId).toBe(`${10_000 + STORAGE_LIMITS.seenAccountsMax + 4}`);
  });

  it('comes back after a restart; an unreadable store is not overwritten until a read succeeds', async () => {
    const first = setup();
    await first.presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] });
    first.port.detach();
    const second = setup(first.local);
    expect(await second.presence.start()).toEqual({ readable: true, accounts: 1 });
    expect(second.presence.listeningTabs()).toBe(0);
    second.port.detach();

    const before = first.local.read(KEY);
    first.local.failNext('get');
    first.local.failNext('get');
    const third = setup(first.local);
    expect(await third.presence.start()).toEqual({ readable: false, accounts: 0 });
    await third.presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [other] });
    expect(first.local.read(KEY)).toEqual(before);
    await third.presence.report('tab-a', { chat, routeEpoch: 2, visible: true, focused: true, accounts: [other] });
    expect(third.presence.seenAccounts().map((item) => item.account.hostAccountId)).toEqual([IDS.otherAcc, IDS.acc]);
  });

  it('a value it cannot interpret starts over; a failed write keeps the old list; «Очистить» removes it', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { v: 9 });
    const { presence, logs } = setup(local);
    expect(await presence.start()).toEqual({ readable: true, accounts: 0 });
    expect(logs.some((entry) => entry.msg.includes('starting over'))).toBe(true);
    local.failNext('set');
    await presence.report('tab-a', { chat, routeEpoch: 1, visible: true, focused: true, accounts: [account] });
    expect(presence.seenAccounts()).toEqual([]);
    expect(logs.some((entry) => entry.msg === 'seen accounts not saved')).toBe(true);
    await presence.report('tab-a', { chat, routeEpoch: 2, visible: true, focused: true, accounts: [account] });
    expect(presence.seenAccounts()).toHaveLength(1);
    local.failNext('remove');
    expect(await presence.clearSeen()).toBe(false);
    expect(await presence.clearSeen()).toBe(true);
    expect(presence.seenAccounts()).toEqual([]);
    expect(local.read(KEY)).toBeUndefined();
  });
});
