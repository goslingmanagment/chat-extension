// Focus utilities (architecture.md §10.1 «Фокус и доступность», ui-design
// §6.3): what can take focus inside a root, a Tab trap for modal windows, the
// active element inside our closed root, and «one tab stop» groups moved with
// arrow keys. All of it stays inside our own shadow roots: nothing here looks
// into ChatSpace's DOM; returning focus to ChatSpace's composer is the
// host side's job (FocusReturn).

const FOCUSABLE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[tabindex]',
  '[contenteditable="true"]',
].join(', ');

function isHidden(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [inert]') !== null) return true;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return style !== undefined && (style.display === 'none' || style.visibility === 'hidden');
}

/** Elements Tab can reach inside `container`, in DOM order. `aria-disabled` ones stay (they keep focus, ui-design §4). */
export function tabbables(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    if ((element as HTMLButtonElement).disabled === true) return false;
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return !isHidden(element);
  });
}

/** The focused element inside our root (a closed shadow root, or a page document). */
export function activeIn(root: ShadowRoot | Document): HTMLElement | null {
  const active = root.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/** Whether focus sits inside `container` (in this root). */
export function containsFocus(root: ShadowRoot | Document, container: Element): boolean {
  const active = activeIn(root);
  return active !== null && container.contains(active);
}

/**
 * Keeps Tab inside `container` (ui-design §6.3: windows hold focus, Tab goes
 * round). Call from the container's keydown; returns true if it moved focus.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement, root: ShadowRoot | Document): boolean {
  if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
  const items = tabbables(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = activeIn(root);
  const inside = active !== null && container.contains(active);
  if (event.shiftKey && (!inside || active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/** Focuses an element without scrolling the page, if it is still in the document. */
export function focusQuietly(element: HTMLElement | null | undefined): boolean {
  if (element === null || element === undefined || !element.isConnected) return false;
  element.focus({ preventScroll: true });
  return true;
}

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

/**
 * Arrow-key movement inside a «one tab stop» group (the dock strip, parts,
 * menus, tabs): returns the index to focus, or null when the key is not ours.
 * Wraps around; Home and End go to the ends.
 */
export function rovingIndex(key: string, current: number, count: number, orientation: RovingOrientation, wrap = true): number | null {
  if (count <= 0) return null;
  const next = orientation !== 'vertical' ? ['ArrowRight'] : [];
  const previous = orientation !== 'vertical' ? ['ArrowLeft'] : [];
  if (orientation !== 'horizontal') {
    next.push('ArrowDown');
    previous.push('ArrowUp');
  }
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (next.includes(key)) return current + 1 < count ? current + 1 : wrap ? 0 : current;
  if (previous.includes(key)) return current - 1 >= 0 ? current - 1 : wrap ? count - 1 : current;
  return null;
}

/**
 * True for the auto-repeat of a held key. One press is one action (ui-design
 * §6.3, architecture.md §6.4): Enter that inserted a part hands focus to
 * ChatSpace's composer, where Enter sends, so nothing of ours acts on a
 * repeat — not twice on the same thing, not on what took focus meanwhile.
 * The first press on a button is the browser's own click; its repeats are
 * swallowed by `swallowHeldEnter`.
 */
export function isHeldKey(event: KeyboardEvent): boolean {
  return event.repeat;
}

/** For a <button>: the browser clicks it on every repeat of a held Enter; only the first press counts. */
export function swallowHeldEnter(event: KeyboardEvent): void {
  if (event.key === 'Enter' && event.repeat) event.preventDefault();
}

/** True for a key event that is part of an IME composition (never act on it). */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
