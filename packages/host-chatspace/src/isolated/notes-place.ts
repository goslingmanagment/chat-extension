// Where «Заметки» stand on ChatSpace's page (2026-10-28), the counterpart of host-fansly's notes-place.ts. Measured
// when asked — on the route, the header, a resize, the panel opening — and when the chat's column changes its size
// under a placed panel (ChatSpace's side panel opened or closed): one ResizeObserver on that column, no other observer.
//
// Right of the chat ChatSpace keeps a column of its own: its side panel (the fan's insights, its own «Заметки») and the
// icon rail that opens it (0.233: 364 + 64 px), and a 1440 px window leaves the chat about 530 px beside it. So, as on
// Fansly the panel stands in the free column right of the chat (the owner, 2026-10-28: «как на фансли»), here it stands
// over ChatSpace's column, edge to edge (`docked`, `flush`): the conversation stays whole, and ChatSpace's column is
// back when the panel closes. Without that column (the side panel closed, a window below ChatSpace's 1020 px) it lies
// over the right edge of the conversation, below its header and above the composer — and above our dock, which stands
// in flow right over the composer, while that leaves a usable panel — so the person keeps typing. It never covers the
// composer. The anchors:
// - the conversation header's actions row, by the test ids of its buttons (header-slot.ts `findHeaderPlace`;
//   ChatSpace 0.233.0 `ConversationHeader`, the stand's `header.conversation-header`);
// - the conversation panel (0.233.0 `ConversationPanel`'s `section`, the stand's `section.conversation-panel`): the
//   first ancestor of the header taller than any header — its box is the chat's column;
// - ChatSpace's own column: what follows the conversation panel on screen right of it (0.233.0's side panel `aside`
//   and its rail `nav`; the stand's `aside.chat-details-panel` and `nav.chat-side-rail`), at least 280 px together;
// - the composer: the one visible composer slot (`[data-id="browser-composer-translator"]`, mount.ts `activeSlots`)
//   and its `.composer-frame`; our dock is the frame root's first child, right above the frame.
// Neither the header nor a composer on the page (no chat open): no place.

import type { NotesPlace } from '@cg/contracts/notes';

import { findHeaderPlace } from './header-slot';
import { FRAME_SELECTOR } from './host-contract';
import { activeSlots } from './mount';

export interface NotesColumn {
  readonly top: number;
  readonly right: number;
  readonly width: number;
}

/** ChatSpace's own column right of the chat, in the viewport. */
export interface NotesSide {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
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
/** ChatSpace's own column holds the panel from this width (Fansly's free column: the same). */
export const NOTES_SIDE_MIN_PX = 280;
/** Wrappers of the conversation panel looked through for ChatSpace's column beside them. */
const WRAPPER_DEPTH = 2;

/** Pure: the panel over ChatSpace's own column right of the chat, edge to edge. */
export function placeNotesSide(side: NotesSide, viewport: NotesViewport): NotesPlace {
  return {
    kind: 'docked',
    flush: true,
    top: Math.max(0, Math.round(side.top)),
    bottom: Math.max(0, Math.round(viewport.height - side.bottom)),
    left: Math.round(side.left),
    width: Math.round(side.right - side.left),
  };
}

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
export function notesMeasure(
  doc: Document,
  dock: Element | null = null,
): { fits(): boolean; place(): NotesPlace | null; onChange(change: () => void): () => void } {
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
  /** The open chat's header row, composer frame and column, as the page holds them now. */
  const locate = () => {
    const slots = activeSlots(doc);
    const frame = slots.length === 1 ? (slots[0]?.closest(FRAME_SELECTOR) ?? null) : null;
    const row = findHeaderPlace(doc)?.row ?? null;
    const panel = row !== null ? panelOf(row) : frame?.parentElement ? panelOf(frame.parentElement) : null;
    return panel === null ? null : { ...panel, row, frame };
  };
  /** ChatSpace's own column: what follows the chat's column (or a wrapper of it alone) on screen right of it. */
  const sideOf = (column: Element): NotesSide | null => {
    const edge = column.getBoundingClientRect().right;
    let level: Element | null = column;
    for (let depth = 0; level !== null && depth <= WRAPPER_DEPTH; depth += 1) {
      let side: NotesSide | null = null;
      for (let node = level.nextElementSibling; node !== null; node = node.nextElementSibling) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.left < edge - 2) continue;
        side = side === null ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } : { top: Math.min(side.top, rect.top), bottom: Math.max(side.bottom, rect.bottom), left: Math.min(side.left, rect.left), right: Math.max(side.right, rect.right) };
      }
      if (side !== null) return side.right - side.left >= NOTES_SIDE_MIN_PX ? side : null;
      // Up only through a wrapper of the column alone: one that reaches no further right.
      const parent: Element | null = level.parentElement;
      if (parent === null || parent === doc.body || Math.abs(parent.getBoundingClientRect().right - edge) > 2) return null;
      level = parent;
    }
    return null;
  };

  // The chat's column under a placed panel: a change of its size moves the panel (ChatSpace's side panel opened or
  // closed, its chat list resized).
  let change: (() => void) | null = null;
  let watched: Element | null = null;
  let observer: ResizeObserver | null = null;
  const watch = (column: Element): void => {
    if (change === null || column === watched || typeof ResizeObserver !== 'function') return;
    observer ??= new ResizeObserver(() => change?.());
    if (watched !== null) observer.unobserve(watched);
    watched = column;
    observer.observe(column);
  };

  return {
    fits() {
      const at = locate();
      return at !== null && sideOf(at.column) !== null;
    },
    place() {
      const at = locate();
      if (at === null) return null;
      const box = at.column.getBoundingClientRect();
      if (box.width <= 0) return null;
      watch(at.column);
      const side = sideOf(at.column);
      if (side !== null) return placeNotesSide(side, viewport());
      const headerBottom = at.row !== null ? at.child.getBoundingClientRect().bottom : null;
      // The dock stands in flow right above the frame, as the frame root's first child (mount.ts).
      const dockTop = at.frame !== null && dock !== null && dock.parentElement === at.frame.parentElement ? topOf(dock) : null;
      return placeNotesOver({ top: box.top, right: box.right, width: box.width }, headerBottom, topOf(at.frame), viewport(), dockTop);
    },
    onChange(next) {
      change = next;
      return () => {
        change = null;
        observer?.disconnect();
        observer = null;
        watched = null;
      };
    },
  };
}
