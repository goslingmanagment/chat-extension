// The message list keeps its bottom when our dock grows (UI-016, decision X26).
//
// The dock stands in flow above the composer: a result that opens takes its
// height from ChatSpace's message list. ChatSpace keeps the list at its bottom
// by itself only when it has seen a scroll of this chat end within 1 px of the
// bottom (MessagesList, `trackScroll` / `isAtBottom`); otherwise it holds the
// message at the TOP of the list in place — and the last messages, the ones a
// chatter answers, go under our result. So the dock looks after the bottom
// itself:
// - the list is «near its bottom» while its last scroll ended within
//   NEAR_BOTTOM_PX of it — ChatSpace's own measure of «at the latest
//   messages» (it hides «scroll to latest» and follows a new message there);
// - when the dock grows while the list is near its bottom, the list is put at
//   its bottom — in the same step, before the frame is painted. Farther up
//   nothing is touched: a person reading the history keeps the message under
//   their eyes, as ChatSpace arranges it.
// Nothing is inserted into ChatSpace's list and nothing of it is read but its
// scroll geometry; the one write is `scrollTop` of its scroll box, which no
// request of ChatSpace's follows that a scroll by hand would not.
//
// The list is found from the dock, not by a class of a ChatSpace build: the
// nearest scroll box that ends right above the dock, among the siblings that
// precede the dock's ancestors. The size observer is made anew each time the
// dock is placed, after ChatSpace has rendered the chat: observers are told in
// the order they were made, so ChatSpace's own answer to the resize (it may
// put the list back at its top anchor) comes first and ours has the last word
// in the frame. A frame later the bottom is checked once more, for an order
// we did not foresee.

/** ChatSpace's «at the latest messages» (MessagesList: `bottomDistance <= 100`). */
export const NEAR_BOTTOM_PX = 100;
/** How far up the dock's ancestors the list is looked for, and how deep inside a sibling. */
const ANCESTOR_DEPTH = 6;
const SIBLING_DEPTH = 5;
/** Elements looked at in one sibling before giving up: the scroll box is near its top, the messages are not. */
const SIBLING_BUDGET = 60;
/** A scroll box lower than this is not a message list (a strip of tabs, a row of chips). */
const MIN_LIST_HEIGHT_PX = 60;
/** After the dock grew, scrolls of the list are ChatSpace's and ours for this long: they do not say the person left the bottom. */
export const SETTLE_MS = 300;

export interface BottomKeeper {
  /** The dock was placed anew (`inFlow` — above a composer, where it pushes the list) or left. */
  placed(inFlow: boolean): void;
  dispose(): void;
}

export interface BottomKeeperOptions {
  /** A size observer of the dock host (tests give their own). */
  readonly observe?: (target: Element, changed: () => void) => () => void;
  readonly now?: () => number;
}

const distance = (list: HTMLElement): number => list.scrollHeight - list.scrollTop - list.clientHeight;

/** The first scroll box inside `root` (itself included), breadth first, within the depth and the budget. */
function scrollBoxIn(win: Window, root: Element): HTMLElement | null {
  let level: Element[] = [root];
  let seen = 0;
  for (let depth = 0; depth <= SIBLING_DEPTH && level.length > 0; depth += 1) {
    const next: Element[] = [];
    for (const element of level) {
      seen += 1;
      if (seen > SIBLING_BUDGET) return null;
      if (element instanceof HTMLElement && element.clientHeight >= MIN_LIST_HEIGHT_PX) {
        const overflow = win.getComputedStyle(element).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return element;
      }
      next.push(...element.children);
    }
    level = next;
  }
  return null;
}

/** ChatSpace's message list as the dock sees it: the nearest scroll box that ends right above the dock, over the composer's width. */
export function findListAbove(win: Window, dock: HTMLElement): HTMLElement | null {
  const box = dock.getBoundingClientRect();
  let node: Element | null = dock.parentElement;
  for (let depth = 0; node !== null && depth < ANCESTOR_DEPTH && node !== win.document.body; depth += 1, node = node.parentElement) {
    for (let sibling = node.previousElementSibling; sibling !== null; sibling = sibling.previousElementSibling) {
      const found = scrollBoxIn(win, sibling);
      if (found === null) continue;
      const rect = found.getBoundingClientRect();
      if (rect.bottom <= box.top + 2 && rect.right > box.left && rect.left < box.right) return found;
    }
  }
  return null;
}

export function createBottomKeeper(win: Window, dock: HTMLElement, options: BottomKeeperOptions = {}): BottomKeeper {
  const now = options.now ?? (() => win.performance.now());
  const observe =
    options.observe ??
    ((target: Element, changed: () => void): (() => void) => {
      const observer = new ResizeObserver(changed);
      observer.observe(target);
      return () => observer.disconnect();
    });
  let unobserve: (() => void) | null = null;
  let list: HTMLElement | null = null;
  /** The list's last scroll ended near its bottom. */
  let near = false;
  let height = 0;
  let settleUntil = 0;
  let disposed = false;

  const onScroll = (): void => {
    try {
      if (list === null || now() < settleUntil) return;
      near = distance(list) <= NEAR_BOTTOM_PX;
    } catch {
      // The list went away with its chat.
    }
  };
  const forget = (): void => {
    list?.removeEventListener('scroll', onScroll);
    list = null;
    near = false;
  };
  /** The list above the dock as it is now; `grown` — by how much the dock has just grown (the list has not been looked at yet). */
  const look = (grown: number): HTMLElement | null => {
    if (list !== null && list.isConnected && list.getBoundingClientRect().bottom <= dock.getBoundingClientRect().top + 2) return list;
    forget();
    const found = findListAbove(win, dock);
    if (found === null) return null;
    list = found;
    found.addEventListener('scroll', onScroll, { passive: true });
    // Never looked at before: where it stood before the dock took `grown` px from it.
    near = distance(found) - grown <= NEAR_BOTTOM_PX;
    return found;
  };
  const toBottom = (): void => {
    if (list !== null && near && distance(list) > 1) list.scrollTop = list.scrollHeight;
  };
  const onResize = (): void => {
    if (disposed) return;
    try {
      const next = dock.getBoundingClientRect().height;
      const grown = next - height;
      height = next;
      if (grown <= 0.5) return;
      if (look(grown) === null || !near) return;
      settleUntil = now() + SETTLE_MS;
      toBottom();
      // Once more a frame later: whatever answered the resize after us has spoken by then.
      win.requestAnimationFrame(() => {
        if (disposed) return;
        try {
          toBottom();
        } catch {
          // The list went away with its chat.
        }
      });
    } catch {
      // A list that cannot be measured is left alone.
    }
  };

  return {
    placed(inFlow) {
      unobserve?.();
      unobserve = null;
      forget();
      if (disposed || !inFlow) return;
      height = dock.getBoundingClientRect().height;
      // Where the list stands is learned before the first result opens, so that a scroll by hand counts from now on.
      look(0);
      unobserve = observe(dock, onResize);
    },
    dispose() {
      disposed = true;
      unobserve?.();
      unobserve = null;
      forget();
    },
  };
}
