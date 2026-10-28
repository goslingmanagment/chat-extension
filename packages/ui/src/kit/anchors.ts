// Where a window of the overlay host opens out of and folds back into (2026-10-28, the Recap window that grows out of
// its button): an element of another of our roots — the dock's Recap button, its folded «Шпаргалка», the bar. Our roots
// are separate shadow roots of one page in one realm, so a root says where its element is and the window reads the
// rect at the moment it moves. A name nobody holds, or an element off screen, has no rect: the window then just fades.
//
// And how a window that animates its own leaving is asked to leave: the overlay host's Esc and scrim go through the
// window, which plays its exit and then dispatches what it was asked to.

import { createContext } from 'preact';
import { useContext, useEffect, useRef } from 'preact/hooks';

export type AnchorName = 'recap' | 'recap-crib' | 'dock-bar';

const anchors = new Map<AnchorName, () => Element | null>();
/** Where an element was as it went: the dock may take its cheat sheet away a moment before the window reads it. */
const last = new Map<AnchorName, { readonly rect: DOMRect; readonly at: number }>();
const LAST_FOR_MS = 600;

const rectOf = (element: Element | null): DOMRect | null => {
  if (element === null || !element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
};

/** Registers where `name` is while the caller lives; the getter is read only when a window asks. */
export function useAnchor(name: AnchorName, get: () => Element | null): void {
  const getter = useRef(get);
  getter.current = get;
  useEffect(() => {
    const read = (): Element | null => getter.current();
    anchors.set(name, read);
    last.delete(name);
    return () => {
      if (anchors.get(name) !== read) return;
      anchors.delete(name);
      const rect = rectOf(read());
      if (rect !== null) last.set(name, { rect, at: Date.now() });
    };
  }, [name]);
}

/** The rect of a registered element on screen now (or as it just went); null — nobody holds the name, or it has no box. */
export function anchorRect(name: AnchorName): DOMRect | null {
  const live = rectOf(anchors.get(name)?.() ?? null);
  if (live !== null) return live;
  const gone = last.get(name);
  return gone !== undefined && Date.now() - gone.at < LAST_FOR_MS ? gone.rect : null;
}

/** How a window leaves: closed, or folded back into the dock. */
export type WindowExit = 'hidden' | 'sheet';

/** The overlay host's handle on the window it shows: the window puts its animated leaving here while it is mounted. */
export interface WindowExitSlot {
  current: ((how: WindowExit) => void) | null;
}

export const WindowExitContext = createContext<WindowExitSlot | null>(null);

/** The window's side: `leave` answers the host's Esc and scrim while the window is mounted. */
export function useWindowExit(leave: (how: WindowExit) => void): void {
  const slot = useContext(WindowExitContext);
  const latest = useRef(leave);
  latest.current = leave;
  useEffect(() => {
    if (slot === null) return undefined;
    const answer = (how: WindowExit): void => latest.current(how);
    slot.current = answer;
    return () => {
      if (slot.current === answer) slot.current = null;
    };
  }, [slot]);
}
