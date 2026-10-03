// Chat navigation and the palette's search as pure rules (architecture.md
// §6.9). Synthetic ids only.

import { type NavigationItem } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { QUICK_JUMP_SLOTS, chatAtSlot, matchRow, nextUnreadChat, normalizeQuery, onlineChats, quickJumpRows, searchRows, stepChat } from './index';

const ACC = '1001';
const row = (fan: string, position: number, unreadCount: number | null = 0, isOnline: boolean | null = null, name = `Fan ${fan}`): NavigationItem => ({
  chat: { host: 'chatspace', hostAccountId: ACC, platformFanId: fan },
  position,
  displayName: name,
  username: `fan_${fan}`,
  unreadCount,
  isOnline,
});
/** The list as ChatSpace shows it: its own order, not sorted by anything of ours. */
const LIST = [row('2005', 0), row('2002', 1, 2, true), row('2009', 2, null), row('2003', 3, 1), row('2007', 4, 0, true)];
const fan = (item: NavigationItem | null): string | null => item?.chat.platformFanId ?? null;

describe('walking the cached chat list', () => {
  it('[HK-037] J and K step through the list in ChatSpace\'s own order and stop at its ends', () => {
    expect(fan(stepChat(LIST, '2002', 'next'))).toBe('2009');
    expect(fan(stepChat(LIST, '2002', 'previous'))).toBe('2005');
    // No wrap: the list goes on below what is loaded, and we never load more.
    expect(stepChat(LIST, '2007', 'next')).toBeNull();
    expect(stepChat(LIST, '2005', 'previous')).toBeNull();
    // From no chat, or from a chat that is not in the loaded rows, both keys go to the first row.
    expect(fan(stepChat(LIST, null, 'next'))).toBe('2005');
    expect(fan(stepChat(LIST, '9999', 'previous'))).toBe('2005');
    expect(stepChat([], '2002', 'next')).toBeNull();
  });

  it('[HK-037] ⌘U goes to the next chat with unread messages, wraps to the top, and never counts the open chat or an unknown counter', () => {
    expect(fan(nextUnreadChat(LIST, '2005'))).toBe('2002');
    expect(fan(nextUnreadChat(LIST, '2002'))).toBe('2003');
    expect(fan(nextUnreadChat(LIST, '2003'))).toBe('2002');
    expect(fan(nextUnreadChat(LIST, null))).toBe('2002');
    // The only unread chat is the open one: nowhere to go.
    expect(nextUnreadChat([row('2002', 0, 3), row('2003', 1, 0), row('2004', 2, null)], '2002')).toBeNull();
    expect(nextUnreadChat([], null)).toBeNull();
  });

  it('[HK-037] [NEW-07] ⌘1–9 is the N-th row of the visible list; the popup numbers the first nine', () => {
    expect(fan(chatAtSlot(LIST, 1))).toBe('2005');
    expect(fan(chatAtSlot(LIST, 5))).toBe('2007');
    expect(chatAtSlot(LIST, 6)).toBeNull();
    for (const slot of [0, 10, 1.5, -1]) expect(chatAtSlot(LIST, slot)).toBeNull();
    const long = Array.from({ length: 14 }, (_, index) => row(String(3000 + index), index));
    const rows = quickJumpRows(long);
    expect(rows).toHaveLength(QUICK_JUMP_SLOTS);
    expect(rows.map((item) => item.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows[8]?.item.chat.platformFanId).toBe('3008');
  });

  it('[CS-030] «Онлайн» is only what ChatSpace itself already shows online: unknown is not online', () => {
    expect(onlineChats(LIST).map(fan)).toEqual(['2002', '2007']);
    expect(onlineChats([row('2002', 0, 0, null), row('2003', 1, 0, false)])).toEqual([]);
  });
});

describe('the palette\'s search', () => {
  const rows = [
    { value: 1, label: 'Theodore Whitfield', extra: ['@theo_w'] },
    { value: 2, label: 'Hubert', extra: ['@hubert_pl'] },
    { value: 3, label: 'Marco Rinaldi', extra: ['@marco_r'] },
    { value: 4, label: 'Виктор Ёлкин', extra: ['@victor'] },
    { value: 5, label: 'Hubert Theo' },
  ];

  it('[HK-036] [CS-006] a word of the query is found at a word start first, in the name before the handle, and every word must be found', () => {
    expect(searchRows(rows, 'theo', 10).map((hit) => hit.value)).toEqual([1, 5]);
    expect(searchRows(rows, 'theo', 10)[0]?.match).toEqual([[0, 4]]);
    expect(searchRows(rows, 'whit theo', 10)).toEqual([{ value: 1, score: 9, match: [[0, 4], [9, 13]] }]);
    // The @handle is searched too and never underlined.
    expect(searchRows(rows, '@marco_r', 10)).toEqual([{ value: 3, score: 2, match: [] }]);
    expect(searchRows(rows, 'bert', 10).map((hit) => hit.value)).toEqual([2, 5]);
    expect(searchRows(rows, 'bert', 10)[0]?.match).toEqual([[2, 6]]);
    expect(searchRows(rows, 'hubert zzz', 10)).toEqual([]);
    // Cyrillic, any case.
    expect(searchRows(rows, 'ВИКТОР ёл', 10)).toEqual([{ value: 4, score: 9, match: [[0, 6], [7, 9]] }]);
  });

  it('[HK-036] an empty query keeps every row in its own order; the limit cuts the tail', () => {
    expect(searchRows(rows, '   ', 3).map((hit) => hit.value)).toEqual([1, 2, 3]);
    expect(searchRows(rows, '', 0)).toEqual([]);
    expect(normalizeQuery('  @Theo   W ')).toBe('theo w');
    expect(matchRow({ value: 0, label: 'Reply' }, '')).toEqual({ value: 0, score: 0, match: [] });
    // Overlapping words underline once.
    expect(matchRow({ value: 0, label: 'hubert' }, 'hub hube')?.match).toEqual([[0, 4]]);
  });
});
