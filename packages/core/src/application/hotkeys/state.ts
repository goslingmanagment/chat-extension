// What the early dispatcher reads about the tab (architecture.md §9.1): the
// route, our open overlays, the dock's sheet. It exists from document_start,
// before the bridge to MAIN and long before the lazy part; each piece is
// plugged in when it arrives. Until MAIN reports the route, the address tells
// whether a chat is open — a key pressed in the first second of a chat is
// still ours (HK-024).

import { type OverlayKind, type RouteKind } from '../../domain/hotkeys';
import { type OverlayState } from '../navigation/overlays';
import { type DispatcherState } from './dispatcher';

export interface TabKeyState extends DispatcherState {
  /** The dock's sheet opened or closed (the hotkey runner reports it). */
  setDockSheet(open: boolean): void;
}

export interface TabKeyStateOptions {
  readonly overlays: OverlayState;
  /**
   * The route right now, read synchronously: from HostPort once it is up,
   * from the address before that. `epoch` must come from ONE source for the
   * life of the document (the path is a good one): a kept key runs only if it
   * did not change.
   */
  readonly route: () => { readonly kind: RouteKind; readonly epoch: number | string };
}

export function createTabKeyState(options: TabKeyStateOptions): TabKeyState {
  let sheet = false;
  return {
    route: options.route,
    overlays: (): readonly OverlayKind[] => options.overlays.list(),
    dockSheet: () => sheet,
    setDockSheet(open) {
      sheet = open;
    },
  };
}
