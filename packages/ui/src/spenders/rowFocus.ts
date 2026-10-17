// Keyboard focus over the rows of a virtual list (ui-design §6.3, §6.4): the
// list has one tab stop — the keyboard's current row — and arrows move it.
// A row far from the viewport is not in the DOM, so «focus this row» means:
// scroll to it, then focus it once the list has rendered it.
//
// A row is named by its key (the fan), never by its place: the list changes
// under the person (a hub refresh, a fan who wrote and moved up), and a key
// pressed on a row must act on the fan that row shows (opening a chat marks
// it read on OnlyFans).

import { useCallback, useEffect, useLayoutEffect, useRef } from 'preact/hooks';

import { focusQuietly, type VirtualListHandle } from '../kit';

/** The attribute a focusable row carries (`data-cg-key={key}`): its stable key in the list. */
const ROW_KEY_ATTR = 'data-cg-key';

/** The key of the row a key event came from; null outside the rows (the header's sort buttons). */
export function rowKeyOf(target: EventTarget | null): string | null {
  if (target === null || !('closest' in target) || typeof target.closest !== 'function') return null;
  return (target as Element).closest(`[${ROW_KEY_ATTR}]`)?.getAttribute(ROW_KEY_ATTR) ?? null;
}

export interface RowFocus {
  /** The element around the list: rows are looked up inside it by their key. */
  readonly wrapRef: { current: HTMLDivElement | null };
  readonly listRef: { current: VirtualListHandle | null };
  /** Scrolls the row at `index` into view and focuses the row with `key` as soon as it is rendered. */
  readonly focusRow: (index: number, key: string) => void;
  /** Call when the list's rendered range changed: a row waited for may be there now. */
  readonly settle: () => void;
}

/**
 * `activeKey` is the keyboard's row of the list as it is now. A focus still
 * waited for belongs to that row: once the row is another one (its fan left
 * the list, the person went elsewhere) the wait is over, so a row that comes
 * back later never pulls focus to itself.
 */
export function useRowFocus(activeKey: string | null): RowFocus {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<VirtualListHandle | null>(null);
  const pending = useRef<string | null>(null);
  const settle = useCallback((): void => {
    const key = pending.current;
    if (key === null) return;
    const rows = wrapRef.current?.querySelectorAll<HTMLElement>(`[${ROW_KEY_ATTR}]`) ?? [];
    for (const element of rows) {
      if (element.getAttribute(ROW_KEY_ATTR) !== key) continue;
      if (focusQuietly(element)) pending.current = null;
      return;
    }
  }, []);
  // After every render of the owner: the row may have just appeared.
  useLayoutEffect(() => {
    if (pending.current !== null && pending.current !== activeKey) pending.current = null;
    settle();
  });
  const focusRow = useCallback(
    (index: number, key: string): void => {
      if (index < 0) return;
      pending.current = key;
      listRef.current?.scrollToIndex(index);
      settle();
    },
    [settle],
  );
  return { wrapRef, listRef, focusRow, settle };
}

/** The open card follows the keyboard's row this long after the last J / K (decision X49): a held key reads no card per row. */
export const CARD_FOLLOW_MS = 150;

export interface CardFollow {
  /** Opens the card of `key` once the keys stop: a later step replaces it. */
  readonly follow: (key: string) => void;
  /** Drops a card still waited for (Enter, Space, a click: the card opens now). */
  readonly stop: () => void;
}

/** The card that follows J / K in «Новые» (X49). `open` is read when the wait ends, never earlier. */
export function useCardFollow(open: (key: string) => void): CardFollow {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(open);
  latest.current = open;
  const stop = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const follow = useCallback(
    (key: string): void => {
      stop();
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current(key);
      }, CARD_FOLLOW_MS);
    },
    [stop],
  );
  useEffect(() => stop, [stop]);
  return { follow, stop };
}
