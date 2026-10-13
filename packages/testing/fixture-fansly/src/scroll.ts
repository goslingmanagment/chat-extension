// `xdScrollWatcher` (main:24538-24550): on every scroll it reports the
// position, then «near the bottom» — within `offset` px, 350 unless the
// template gives `bottomOffset` — or, at exactly 0, «at the top».

export interface ScrollHandlers {
  readonly offset?: number;
  scroll?(top: number): void;
  top?(): void;
  bottom?(): void;
}

export const SCROLL_WATCHER_OFFSET = 350;

/** Watches an element's scroll; returns the unsubscribe. */
export function watchScroll(element: HTMLElement, handlers: ScrollHandlers): () => void {
  const offset = handlers.offset ?? SCROLL_WATCHER_OFFSET;
  const listener = (): void => {
    const top = element.scrollTop;
    const max = element.scrollHeight - element.clientHeight;
    handlers.scroll?.(top);
    if (top > max - offset) handlers.bottom?.();
    else if (top === 0) handlers.top?.();
  };
  element.addEventListener('scroll', listener);
  return () => element.removeEventListener('scroll', listener);
}
