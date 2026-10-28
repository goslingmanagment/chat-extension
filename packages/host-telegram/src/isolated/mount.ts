// Where our UI lives on a Telegram page (docs/specs/2026-10-27-telegram-site.md §4.2, §6.5).
//
// The dock host — a plain `div` with a closed root (X22), made at document_start — stands nowhere until the open chat
// gives it a place: the first row of the active slide's `.Composer`. Web A's chat composer is a pill that wraps its
// full-width children into rows above the input row (its reply and link previews, Composer.scss `flex-wrap: wrap`):
// the dock is one more such row (`order: -1`), so it never covers the last messages and never touches the field's
// width. In the DOM it is the composer's LAST child: Teact inserts a child before `childNodes[index]`, so a node of
// ours anywhere else would shift the place of the page's own children; after all of them it shifts nothing, and a
// child the page appends after it puts it back to the end. A chat switch makes another slide with its own composer:
// the SAME host, its root and UI tree move into it, never made again. No chat, no composer: no dock.
//
// Overlays: `<div data-host="overlay">` hosts in <html>, each with a closed root, `position: fixed`, on host-kit's
// layers (900 panels, 950 windows, 960 toasts): under Telegram's own modals and menus (its `--z-modal` and the like
// stand higher), as the page they stand over. Styles live in the closed roots, adopted — nothing global.

import type { MountPoints } from '@cg/contracts/host';
import { HOST_ATTRIBUTE, LAYER_ATTRIBUTE, OVERLAY_Z, mountClosedHost, type ClosedHost, type OverlayLayer } from '@cg/host-kit/isolated/hosts';
import { createShadowRootRegistry, type ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

export interface DockPlace {
  /** The active slide's composer; null — none (no chat, an animation, a chat the dock is not for). */
  readonly composer: Element | null;
  /** The port's token of the main field; null — none. */
  readonly composerInstanceId: string | null;
}

export interface TelegramMounts {
  readonly dock: ClosedHost;
  overlay(layer: OverlayLayer): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /** Puts the dock where the open chat says; idempotent. */
  place(place: DockPlace): void;
  /** Telegram's own Esc closes none of our windows: nothing to mark. */
  setDismissibleOpen(target: 'dock' | OverlayLayer, owner: string, open: boolean): void;
  readonly registry: ShadowRootRegistry;
  stats(): { readonly moves: number; readonly removals: number };
  dispose(): void;
}

export function createTelegramMounts(doc: Document): TelegramMounts {
  const registry = createShadowRootRegistry();
  const dockHost = doc.createElement('div');
  dockHost.setAttribute(HOST_ATTRIBUTE, 'dock');
  const dockRoot = dockHost.attachShadow({ mode: 'closed' });
  const unregister = registry.register(dockHost, dockRoot);
  const dock: ClosedHost = {
    host: dockHost,
    root: dockRoot,
    remove: () => {
      unregister();
      dockHost.remove();
    },
  };
  const overlays = new Map<OverlayLayer, ClosedHost>();
  const listeners = new Set<(points: MountPoints) => void>();
  let kind: MountPoints['dock']['kind'] = 'none';
  let instanceId: string | null = null;
  let lastPoints = '';
  let moves = 0;
  let removals = 0;
  let dressed = false;
  let disposed = false;
  let resize: ResizeObserver | null = null;

  /** A full row of the composer's pill, above its input row. */
  const dress = (): void => {
    if (dressed) return;
    dressed = true;
    const style = dockHost.style;
    style.setProperty('display', 'block');
    style.setProperty('position', 'relative');
    style.setProperty('flex', '0 0 100%');
    style.setProperty('order', '-1');
    style.setProperty('width', '100%');
    style.setProperty('min-width', '0');
    style.setProperty('box-sizing', 'border-box');
    style.setProperty('contain', 'layout style');
  };

  const points = (): MountPoints => {
    const parent = kind === 'none' ? null : dockHost.parentElement;
    const width = parent === null ? null : Math.max(0, dockHost.getBoundingClientRect().width || parent.getBoundingClientRect().width);
    return { dock: { kind, composerInstanceId: instanceId, width }, overlay: { ready: (doc.documentElement as HTMLElement | null) !== null, container: null } };
  };
  const notify = (): void => {
    const current = points();
    const text = JSON.stringify(current);
    if (text === lastPoints) return;
    lastPoints = text;
    for (const listener of [...listeners]) listener(current);
  };

  const place = (input: DockPlace): void => {
    if (disposed) return;
    const composer = input.composer !== null && input.composer.isConnected ? input.composer : null;
    if (composer === null) {
      if (dockHost.parentNode !== null) {
        dockHost.remove();
        removals += 1;
      }
      kind = 'none';
      instanceId = null;
      notify();
      return;
    }
    if (dockHost.parentElement !== composer || composer.lastChild !== dockHost) {
      // Moved, never made anew: the same host, root and UI tree in the new composer, after the page's own children.
      composer.append(dockHost);
      moves += 1;
      dress();
    }
    if (resize === null && typeof ResizeObserver === 'function') {
      resize = new ResizeObserver(() => notify());
      resize.observe(dockHost);
    }
    kind = 'in-flow';
    instanceId = input.composerInstanceId;
    notify();
  };

  const overlay = (layer: OverlayLayer): ClosedHost => {
    let found = overlays.get(layer);
    if (found === undefined) {
      if ((doc.documentElement as HTMLElement | null) === null) throw new Error('overlay before <html> exists');
      found = mountClosedHost(doc.documentElement, 'overlay', 'last', registry);
      found.host.setAttribute(LAYER_ATTRIBUTE, layer);
      const style = found.host.style;
      style.setProperty('position', 'fixed');
      style.setProperty('inset', '0');
      style.setProperty('pointer-events', 'none');
      style.setProperty('z-index', String(OVERLAY_Z[layer]));
      overlays.set(layer, found);
    }
    return found;
  };

  return {
    dock,
    overlay,
    points,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    place,
    setDismissibleOpen: () => undefined,
    registry,
    stats: () => ({ moves, removals }),
    dispose() {
      if (disposed) return;
      disposed = true;
      resize?.disconnect();
      dock.remove();
      for (const host of overlays.values()) host.remove();
      overlays.clear();
      listeners.clear();
    },
  };
}
