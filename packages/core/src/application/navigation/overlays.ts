// Which of our overlays are open, bottom first (architecture.md §6.3, §9.1):
// the one synchronous truth the early dispatcher reads for its ownership
// decision (HK-027, HK-029) and the mount side mirrors as
// `data-dismissible-open` on the overlay hosts, so ChatSpace's own Esc does
// not close the chat tab under our window.
//
// R17's controllers set the palette, the quick jump and the cheatsheet
// themselves; whoever mounts the other overlays (the tab's composition root)
// sets those when it mounts and unmounts them.

import { type PreviewSource, type UiAction } from '@cg/contracts/vm';

import { type OverlayKind } from '../../domain/hotkeys';

export interface OverlayState {
  /** Open overlays, bottom first; the last one is on top. */
  list(): readonly OverlayKind[];
  top(): OverlayKind | null;
  isOpen(overlay: OverlayKind): boolean;
  /**
   * Opening moves the overlay to the top; closing an overlay that is not open
   * does nothing. `close` — what Esc dispatches for this overlay when the
   * focus is outside its root: a dialog's own «Отмена» (ui-design §6.3). A
   * window needs none: it closes by `Navigate`.
   */
  set(overlay: OverlayKind, open: boolean, close?: UiAction): void;
  /** The action registered with the open overlay; null — none, or the overlay is closed. */
  closeAction(overlay: OverlayKind): UiAction | null;
  /**
   * Where the open preview came from (its view selector needs it); null — no preview. A preview from the
   * palette is a window of its own; one from Spenders or «Новые» is a part of their window.
   */
  previewFrom(): PreviewSource | null;
  setPreview(from: PreviewSource | null): void;
  subscribe(listener: () => void): () => void;
}

export function createOverlayState(): OverlayState {
  let open: OverlayKind[] = [];
  let preview: PreviewSource | null = null;
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };
  const closers = new Map<OverlayKind, UiAction>();
  const set = (overlay: OverlayKind, on: boolean, close?: UiAction): void => {
    const has = open.includes(overlay);
    if (on) {
      if (close !== undefined) closers.set(overlay, close);
      if (open[open.length - 1] === overlay) return;
      open = [...open.filter((item) => item !== overlay), overlay];
    } else {
      closers.delete(overlay);
      if (!has) return;
      open = open.filter((item) => item !== overlay);
    }
    changed();
  };
  return {
    list: () => open,
    top: () => open[open.length - 1] ?? null,
    isOpen: (overlay) => open.includes(overlay),
    set,
    closeAction: (overlay) => (open.includes(overlay) ? (closers.get(overlay) ?? null) : null),
    previewFrom: () => preview,
    setPreview(from) {
      const moved = preview !== from;
      preview = from;
      const before = open;
      set('preview', from !== null);
      // Another source while a preview stays open: what is mounted for it changes (the palette's preview is a
      // window of its own, CS-030), so the listeners hear it even though the list of open overlays did not move.
      if (moved && open === before) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The host layer of an overlay (§6.3 «Слои»): side panels 900, windows 950. */
export function overlayLayerOf(overlay: OverlayKind): 'panel' | 'modal' {
  return overlay === 'fan-panel' || overlay === 'coach' ? 'panel' : 'modal';
}

/**
 * Mirrors the open overlays (and the dock's open sheet) as
 * `data-dismissible-open` on their hosts through the mount side's
 * `setDismissibleOpen(target, owner, open)` (R09 MountManager has it).
 */
export function mirrorDismissible(
  overlays: OverlayState,
  setDismissibleOpen: (target: 'dock' | 'panel' | 'modal', owner: string, open: boolean) => void,
): { dockSheet(open: boolean): void; dispose(): void } {
  let shown = new Set<OverlayKind>();
  const sync = (): void => {
    const now = new Set(overlays.list());
    for (const overlay of shown) if (!now.has(overlay)) setDismissibleOpen(overlayLayerOf(overlay), overlay, false);
    for (const overlay of now) if (!shown.has(overlay)) setDismissibleOpen(overlayLayerOf(overlay), overlay, true);
    shown = now;
  };
  const unsubscribe = overlays.subscribe(sync);
  sync();
  return {
    dockSheet: (open) => setDismissibleOpen('dock', 'sheet', open),
    dispose() {
      unsubscribe();
      for (const overlay of shown) setDismissibleOpen(overlayLayerOf(overlay), overlay, false);
      shown = new Set();
    },
  };
}
