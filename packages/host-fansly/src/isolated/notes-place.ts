// Where «Заметки» stand on Fansly's page (R20 P11b; FS-NOTE-2; the Fansly extension's src/content/fan-notes/placement.ts).
// Measured when asked — on the route, the header, a resize, the panel opening — never by an observer of our own
// (parity matrix FX-009).
//
// Fansly caps its content at `--maxContentWidth: 70em`, so a wide window keeps an empty column right of the chat.
// When that column is wide enough the panel stands in it and covers nothing («Всегда справа» needs it); otherwise it
// lies over the chat's right edge, below the chat's header and above the composer — and above our dock, which stands
// in flow right over it, when there is room for both — so the person keeps typing. It never covers the composer.
import type { NotesPlace } from '@cg/contracts/notes';

import { FANSLY_SELECTORS } from './anchors';

/** The free column must hold a usable panel and its margins. */
export const NOTES_DOCK_MIN_FREE_PX = 280;
const GAP_PX = 12;
const DOCKED_MAX_WIDTH_PX = 380;
const OVER_WIDTH_PX = 360;
/** Fansly's chat header: 3.5em at 16 px. */
const CHAT_HEADER_PX = 56;
/** Below this the panel over the chat would be a sliver above our dock: it then stops above the composer instead. */
const OVER_MIN_HEIGHT_PX = 240;

export interface NotesBox {
  readonly top: number;
  readonly right: number;
  readonly width: number;
}

export interface NotesViewport {
  readonly width: number;
  readonly height: number;
}

export const notesFit = (chat: NotesBox, viewport: NotesViewport): boolean => viewport.width - chat.right >= NOTES_DOCK_MIN_FREE_PX;

/**
 * Pure: the chat's box (null — none on screen), the tops of Fansly's composer and of our dock above it (null — not on
 * screen) and the viewport decide.
 */
export function placeNotes(chat: NotesBox | null, composerTop: number | null, viewport: NotesViewport, dockTop: number | null = null): NotesPlace {
  if (chat === null) {
    const width = Math.min(OVER_WIDTH_PX, viewport.width - 2 * GAP_PX);
    return { kind: 'over', top: 80, bottom: GAP_PX, left: Math.max(GAP_PX, viewport.width - GAP_PX - width), width };
  }
  const top = Math.max(GAP_PX, Math.round(chat.top));
  if (notesFit(chat, viewport)) {
    const free = viewport.width - chat.right;
    return { kind: 'docked', top, bottom: GAP_PX, left: Math.round(chat.right + GAP_PX), width: Math.round(Math.min(DOCKED_MAX_WIDTH_PX, free - 2 * GAP_PX)) };
  }
  const overTop = top + CHAT_HEADER_PX;
  const above = (edge: number | null): number => (edge === null ? GAP_PX : Math.max(GAP_PX, Math.round(viewport.height - edge + 8)));
  // Above the composer always; above the dock too while that leaves a usable panel.
  const overComposer = above(composerTop);
  const overDock = dockTop === null ? overComposer : Math.max(overComposer, above(dockTop));
  const bottom = viewport.height - overTop - overDock >= OVER_MIN_HEIGHT_PX ? overDock : overComposer;
  const width = Math.round(Math.max(240, Math.min(OVER_WIDTH_PX, chat.width - 20)));
  return { kind: 'over', top: overTop, bottom, left: Math.max(GAP_PX, Math.round(chat.right - 10 - width)), width };
}

/** A modal window of Fansly's is open: its Esc is its own, the panel stays. */
export const fanslyModalOpen = (doc: Document): boolean => doc.body?.classList.contains(FANSLY_SELECTORS.modalFlag) === true;

/** The page's own boxes, read at the moment of the question; `dock` — our dock's host, measured while it stands in flow. */
export function notesMeasure(doc: Document, dock: Element | null = null): { fits(): boolean; place(): NotesPlace } {
  const viewport = (): NotesViewport => ({ width: doc.documentElement.clientWidth, height: doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight });
  const route = (): Element | null => doc.querySelector(FANSLY_SELECTORS.conversationRoute);
  const box = (element: Element | null): NotesBox | null => {
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 ? { top: rect.top, right: rect.right, width: rect.width } : null;
  };
  return {
    fits() {
      const chat = box(route());
      return chat !== null && notesFit(chat, viewport());
    },
    place() {
      const at = route();
      const container = at?.querySelector(`:scope > ${FANSLY_SELECTORS.container}`) ?? null;
      // The composer is the container's child (anchors.ts); the dock stands right before it in flow (mount.ts).
      const composer = container?.querySelector(`:scope > ${FANSLY_SELECTORS.composer}`) ?? null;
      const topOf = (element: Element | null): number | null => {
        if (element === null) return null;
        const rect = element.getBoundingClientRect();
        return rect.height > 0 && rect.top > 0 ? rect.top : null;
      };
      return placeNotes(box(at), topOf(composer), viewport(), container !== null && dock?.parentElement === container ? topOf(dock) : null);
    },
  };
}
