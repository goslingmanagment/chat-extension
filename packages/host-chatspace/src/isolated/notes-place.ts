// Where «Заметки» stand on ChatSpace's page (2026-10-28), the counterpart of host-fansly's notes-place.ts. Measured
// when asked — on the route, the header, a resize, the panel opening — never by an observer of our own.
//
// ChatSpace keeps no free column right of the chat: its side panel (the fan's card, its own «Заметки») and its icon
// rail stand there, and a fixed-width workspace centres all of it. So the panel never docks (`fits()` is false): it
// lies over the right edge of the conversation, below the conversation header and above the composer — and above our
// dock, which stands in flow right over the composer, while that leaves a usable panel — so the person keeps typing.
// It never covers the composer. The anchors:
// - the conversation header's actions row, by the test ids of its buttons (header-slot.ts `findHeaderPlace`;
//   ChatSpace 0.233.0 `ConversationHeader`, the stand's `header.conversation-header`);
// - the conversation panel (0.233.0 `ConversationPanel`'s `section`, the stand's `section.conversation-panel`): the
//   first ancestor of the header taller than any header — its box is the chat's column;
// - the composer: the one visible composer slot (`[data-id="browser-composer-translator"]`, mount.ts `activeSlots`)
//   and its `.composer-frame`; our dock is the frame root's first child, right above the frame.
// Neither the header nor a composer on the page (no chat open): no place.

import { findHeaderPlace } from './header-slot';
import { FRAME_SELECTOR } from './host-contract';
import { activeSlots } from './mount';

/** contracts `NotesPlace` (notes-fansly.ts), repeated until the shared notes name it. */
export interface NotesPlace {
  readonly kind: 'docked' | 'over';
  readonly top: number;
  /** From the viewport's bottom edge. */
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

export interface NotesColumn {
  readonly top: number;
  readonly right: number;
  readonly width: number;
}

export interface NotesViewport {
  readonly width: number;
  readonly height: number;
}

const GAP_PX = 12;
/** The panel over the chat: wider than Fansly's (360), ChatSpace's chat column is wide and the rows read better. */
const OVER_WIDTH_PX = 420;
/** Below this the panel over the chat would be a sliver above our dock: it then stops above the composer instead. */
const OVER_MIN_HEIGHT_PX = 240;
/** The header's height when only the composer was found: ChatSpace's header bar (`h-16`) and its border. */
const HEADER_PX = 65;
/** An ancestor of the header this tall is the conversation panel, no part of the header (ChatSpace's header is 65 px). */
const PANEL_MIN_PX = 200;

/**
 * Pure: the chat's column, the bottom of its header (null — not found: about a header below the column's top), the
 * tops of ChatSpace's composer and of our dock above it (null — not on screen) and the viewport decide.
 */
export function placeNotesOver(column: NotesColumn, headerBottom: number | null, composerTop: number | null, viewport: NotesViewport, dockTop: number | null = null): NotesPlace {
  const top = Math.max(GAP_PX, Math.round(headerBottom ?? column.top + HEADER_PX));
  const above = (edge: number | null): number => (edge === null ? GAP_PX : Math.max(GAP_PX, Math.round(viewport.height - edge + 8)));
  // Above the composer always; above the dock too while that leaves a usable panel.
  const overComposer = above(composerTop);
  const overDock = dockTop === null ? overComposer : Math.max(overComposer, above(dockTop));
  const bottom = viewport.height - top - overDock >= OVER_MIN_HEIGHT_PX ? overDock : overComposer;
  const width = Math.round(Math.max(240, Math.min(OVER_WIDTH_PX, column.width - 20)));
  return { kind: 'over', top, bottom, left: Math.max(GAP_PX, Math.round(column.right - 10 - width)), width };
}

/** The page's own boxes, read at the moment of the question; `dock` — our dock's host, measured while it stands in flow. */
export function notesMeasure(doc: Document, dock: Element | null = null): { fits(): boolean; place(): NotesPlace | null } {
  const viewport = (): NotesViewport => ({ width: doc.documentElement.clientWidth, height: doc.defaultView?.innerHeight ?? doc.documentElement.clientHeight });
  const topOf = (element: Element | null): number | null => {
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return rect.height > 0 && rect.top > 0 ? rect.top : null;
  };
  /** From `start` up to the first ancestor as tall as a panel: that ancestor (the column) and its child on the way (the header). */
  const panelOf = (start: Element): { readonly column: Element; readonly child: Element } | null => {
    let child = start;
    for (let node = start.parentElement; node !== null && node !== doc.body && node !== doc.documentElement; child = node, node = node.parentElement) {
      if (node.getBoundingClientRect().height >= PANEL_MIN_PX) return { column: node, child };
    }
    return null;
  };
  return {
    // No free column right of the chat on ChatSpace: the panel always lies over it.
    fits: () => false,
    place() {
      const slots = activeSlots(doc);
      const frame = slots.length === 1 ? (slots[0]?.closest(FRAME_SELECTOR) ?? null) : null;
      const row = findHeaderPlace(doc)?.row ?? null;
      const panel = row !== null ? panelOf(row) : frame?.parentElement ? panelOf(frame.parentElement) : null;
      if (panel === null) return null;
      const box = panel.column.getBoundingClientRect();
      if (box.width <= 0) return null;
      const headerBottom = row !== null ? panel.child.getBoundingClientRect().bottom : null;
      // The dock stands in flow right above the frame, as the frame root's first child (mount.ts).
      const dockTop = frame !== null && dock !== null && dock.parentElement === frame.parentElement ? topOf(dock) : null;
      return placeNotesOver({ top: box.top, right: box.right, width: box.width }, headerBottom, topOf(frame), viewport(), dockTop);
    },
  };
}
