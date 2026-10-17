// Chat navigation over the list the person sees (architecture.md §6.9;
// HK-037, NEW-07): J/K, ⌘U and Alt+1–9 walk ChatSpace's own cached `chatList`
// order — the active list entry, exactly as loaded. Nothing is loaded for
// navigation: a chat beyond the loaded rows is simply not reachable from the
// keyboard, and the list never grows by our doing.

import { type NavigationItem } from '@cg/contracts/host';

/** Alt+1–9. */
export const QUICK_JUMP_SLOTS = 9;

const indexOfFan = (items: readonly NavigationItem[], fanId: string | null): number =>
  fanId === null ? -1 : items.findIndex((item) => item.chat.platformFanId === fanId);

const isUnread = (item: NavigationItem): boolean => item.unreadCount !== null && item.unreadCount > 0;

/**
 * J (next) / K (previous). From a chat that is not in the loaded list — or
 * from no chat at all — both go to the first row; at an end of the list the
 * step does nothing (no wrap: the list continues below what is loaded).
 */
export function stepChat(items: readonly NavigationItem[], currentFanId: string | null, direction: 'next' | 'previous'): NavigationItem | null {
  if (items.length === 0) return null;
  const at = indexOfFan(items, currentFanId);
  if (at === -1) return items[0] ?? null;
  return items[direction === 'next' ? at + 1 : at - 1] ?? null;
}

/**
 * ⌘U: the next chat with unread messages after the open one, wrapping to the
 * top of the list; the open chat itself never counts. An unknown counter
 * (null) is not «unread».
 */
export function nextUnreadChat(items: readonly NavigationItem[], currentFanId: string | null): NavigationItem | null {
  if (items.length === 0) return null;
  const at = indexOfFan(items, currentFanId);
  for (let step = 1; step <= items.length; step += 1) {
    const item = items[(at + step + items.length) % items.length];
    if (item !== undefined && isUnread(item) && item.chat.platformFanId !== currentFanId) return item;
  }
  return null;
}

/** ⌘N: the N-th row of the visible list, 1-based. */
export function chatAtSlot(items: readonly NavigationItem[], slot: number): NavigationItem | null {
  if (!Number.isInteger(slot) || slot < 1 || slot > QUICK_JUMP_SLOTS) return null;
  return items[slot - 1] ?? null;
}

/** The rows the quick-jump popup numbers: the first nine of the visible list. */
export function quickJumpRows(items: readonly NavigationItem[]): readonly { readonly slot: number; readonly item: NavigationItem }[] {
  return items.slice(0, QUICK_JUMP_SLOTS).map((item, index) => ({ slot: index + 1, item }));
}

/** Fans ChatSpace itself already shows online (CS-030): no polling of ours, only what the list says. */
export function onlineChats(items: readonly NavigationItem[]): readonly NavigationItem[] {
  return items.filter((item) => item.isOnline === true);
}
