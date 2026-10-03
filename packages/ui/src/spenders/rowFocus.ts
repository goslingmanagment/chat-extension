// Keyboard focus over the rows of a virtual list (ui-design §6.3, §6.4): the
// list has one tab stop — the keyboard's current row — and arrows move it.
// A row far from the viewport is not in the DOM, so «focus row N» means:
// scroll to it, then focus it once the list has rendered it.

import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';

import { focusQuietly, type VirtualListHandle } from '../kit';

export interface RowFocus {
  /** The element around the list: rows are looked up inside it by `data-cg-item`. */
  readonly wrapRef: { current: HTMLDivElement | null };
  readonly listRef: { current: VirtualListHandle | null };
  /** Scrolls row `index` into view and focuses it as soon as it is rendered. */
  readonly focusRow: (index: number) => void;
  /** Call when the list's rendered range changed: a row waited for may be there now. */
  readonly settle: () => void;
}

export function useRowFocus(): RowFocus {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<VirtualListHandle | null>(null);
  const pending = useRef<number | null>(null);
  const settle = useCallback((): void => {
    const index = pending.current;
    if (index === null) return;
    const element = wrapRef.current?.querySelector<HTMLElement>(`[data-cg-item="${index}"]`);
    if (element !== null && element !== undefined && focusQuietly(element)) pending.current = null;
  }, []);
  // After every render of the owner: the row may have just appeared.
  useLayoutEffect(settle);
  const focusRow = useCallback(
    (index: number): void => {
      if (index < 0) return;
      pending.current = index;
      listRef.current?.scrollToIndex(index);
      settle();
    },
    [settle],
  );
  return { wrapRef, listRef, focusRow, settle };
}
