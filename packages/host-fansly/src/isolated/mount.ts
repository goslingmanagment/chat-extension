// Where our UI lives on a Fansly page (docs/project-unite/architecture.md
// §7.3; FS-PLC-1…7, FS-DOCK-2, FS-DOCK-3, FS-CTR-2). R20 P7d.
//
// The dock host — a plain `div` with a closed root (X22), made at
// document_start, where the early key dispatcher marks a waiting key on it —
// stands nowhere until the open chat's anchors (anchors.ts, read only through
// the conversation route) place it:
// - IN FLOW, right before `app-group-message-input`, a child of
//   `app-group-message-container`: `flex: 0 0 auto`, it grows upwards at the
//   expense of the feed and never touches the field's width (FS-PLC-1). It
//   is `position: relative; z-index: 3`: Fansly's typing line
//   (`div.partner-is-typing`, no height, `z-index: 2`) stands between the
//   feed and us, and whatever of the dock reaches above its top edge stays
//   above that line.
// - A chat switch makes the container anew (S2 Q6): the SAME host, its closed
//   root and its UI tree with it, moves into the new one — inserted once and
//   moved, never made again, so FBuddy's observer of the body hears one node
//   per switch (FS-PLC-2). A field made anew in the same container (the DM
//   rules, a new branch) moves nothing.
// - The DM rules are unmet (`div.no-dm-allowed`, or MAIN's `dmAllowed:
//   false`): the dock stays in its place in copy-only mode (FS-DOCK-3) —
//   `copy-only-row`, `data-mode="copy-only"`.
// - The container's anchor is gone (a new build) while a field stands under
//   the route: a FIXED overlay over that field's box, which does not push the
//   feed (FS-PLC-3); a container without a field: the dock at its end, and
//   the port's composer is null — copy only (FS-CTR-2).
// - No conversation, the gallery, a group chat (MAIN says so), the mini-chat:
//   no dock (FS-DOCK-2). Only a host that is in the document is ever placed
//   into: a detached container is nobody's.
// While the dock is in flow the feed keeps its bottom as the dock grows —
// host-kit's keep-bottom with Fansly's own measure, 350 px (FS-PLC-5); it
// writes nothing but `scrollTop` to the bottom, never `scrollTop = 0`, which
// would load older history.
//
// Overlays: `<div data-host="overlay">` hosts in <html>, outside Fansly's
// app, each with a closed root, `position: fixed`, on its layer — Fansly's
// own table, FANSLY_OVERLAY_Z: 1900 panels, 1950 windows, 1960 toasts — over
// the feed, Fansly's dropdowns, its mini-chat, its modals (998), menus and
// cards (999–1000), as the old extension's were (decision X46: our notes and
// Coach «Окно по центру» stayed under an open modal of Fansly's); under its
// notifications (9999, top left) and FBuddy's layer in <body> (1 000 000);
// our toasts stand top right, his bottom right (FS-PLC-6). ChatSpace keeps
// host-kit's 900/950/960 under its PrimeVue dialogs. The dock — in flow or
// fixed over a stray field — and the launcher stay under Fansly's modals, as
// the page they stand in: a modal of Fansly's covers them as it covers its own
// field. Styles live in the closed roots, adopted — nothing global (FS-PLC-7).
//
// The launcher (launcher-view.ts, X46): one more `overlay` host in <html>,
// `data-layer="launcher"`, fixed in the bottom left corner, made when the
// tab is admitted — never at document_start.
//
// Nothing here touches an element's `style` in the synchronous start: its
// first touch in a page's content-script global costs ~0.3 ms (§3.1); the
// dock host is dressed when it is first placed.

import type { MountPoints } from '@cg/contracts/host';
import { HOST_ATTRIBUTE, LAYER_ATTRIBUTE, MODE_ATTRIBUTE, mountClosedHost, type ClosedHost, type OverlayLayer } from '@cg/host-kit/isolated/hosts';
import { createBottomKeeper } from '@cg/host-kit/isolated/keep-bottom';
import { createShadowRootRegistry, type ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import type { ConversationAnchors } from './anchors';

/** Fansly's «near the latest messages»: within 350 px of the bottom its list follows a new message (xdScrollWatcher, main:24549). */
export const FANSLY_NEAR_BOTTOM_PX = 350;
/** Over Fansly's typing line (`z-index: 2`) in the container's stacking. */
export const DOCK_Z = 3;
/**
 * Our overlay layers on a Fansly page (FS-PLC-6, X46): over Fansly's modals (998), menus and cards (999–1000), under
 * its notifications (9999) and FBuddy's layer (1 000 000). The order of host-kit's table (OVERLAY_Z), a thousand higher.
 */
export const FANSLY_OVERLAY_Z: Readonly<Record<OverlayLayer, number>> = { panel: 1900, modal: 1950, toast: 1960 };
/** The dock as a fixed overlay, and the launcher: over the feed and the mini-chat, under Fansly's modals — the page's own place. */
export const PAGE_Z = 900;
/** `data-layer` of the launcher's host. */
export const LAUNCHER_LAYER = 'launcher';
/** The launcher's corner (ui-design §3.13): the old extension's bottom left, at the vault entry's 16 px. */
const LAUNCHER_INSET_PX = 16;

type DockKind = MountPoints['dock']['kind'];

/** What the dock's place is decided by: the open chat's anchors and what the port knows of the chat. */
export interface DockPlace {
  /** The open conversation's nodes under the route; null — no conversation on the page. */
  readonly conversation: ConversationAnchors | null;
  /** MAIN says the open group has more than one fan: no dock (FS-DOCK-2). */
  readonly group: boolean;
  /** The DM rules are unmet — the page's branch or MAIN's `dmAllowed: false`: copy only (FS-DOCK-3). */
  readonly copyOnly: boolean;
  /** The port's token of the main field under the route; null — none. */
  readonly composerInstanceId: string | null;
}

export interface MountStats {
  /** Times the dock host was put into a place (a first placement or a move to another container). */
  readonly moves: number;
  /** Times it left the page (no dock where the person is). */
  readonly removals: number;
}

export interface FanslyMountOptions {
  /** The feed's «near its bottom» (FANSLY_NEAR_BOTTOM_PX by default). */
  readonly nearBottomPx?: number;
}

export interface FanslyMounts {
  /** The one dock host; it moves between containers and keeps its root and UI tree. */
  readonly dock: ClosedHost;
  /** The overlay host of a layer, created in <html> on first use. */
  overlay(layer: OverlayLayer): ClosedHost;
  /** The launcher's host (X46), created in <html> on first use: fixed in the bottom left corner, under Fansly's modals. */
  launcher(): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /** Puts the dock where the open chat says (the port calls it whenever the anchors or the chat moved); idempotent. */
  place(place: DockPlace): void;
  /** ChatSpace's `data-dismissible-open` (§6.3): Fansly's own Esc closes none of our windows — nothing to mark. */
  setDismissibleOpen(target: 'dock' | OverlayLayer, owner: string, open: boolean): void;
  /** Our hosts and their closed roots, for the hotkey dispatcher (§9.1). */
  readonly registry: ShadowRootRegistry;
  stats(): MountStats;
  dispose(): void;
}

/** Where the dock goes for a place: its kind, and the node it stands in or over. */
interface Spot {
  readonly kind: DockKind;
  /** in-flow / copy-only-row: the container; fixed-overlay: the field's box. */
  readonly at: Element | null;
  /** in-flow / copy-only-row: the composer it stands before (null — the container's end). */
  readonly before: Element | null;
}

const NOWHERE: Spot = { kind: 'none', at: null, before: null };

/** The dock's spot for a place (§7.3): in flow before the composer, copy-only there, a fixed overlay, or nowhere. */
export function spotOf(place: DockPlace): Spot {
  const conversation = place.conversation;
  if (conversation === null || conversation.gallery || place.group || !conversation.route.isConnected) return NOWHERE;
  const { container, composer, strayBox } = conversation;
  // A field the chain does not reach (a new build): the dock follows it from above, over its box (FS-PLC-3).
  const stray: Spot | null = strayBox !== null && strayBox.isConnected ? { kind: 'fixed-overlay', at: strayBox, before: null } : null;
  if (container !== null && container.isConnected) {
    if (composer !== null && composer.parentElement === container) return { kind: place.copyOnly ? 'copy-only-row' : 'in-flow', at: container, before: composer };
    // A container without the composer's anchor and without a field: the dock at its end — copy only.
    return stray ?? { kind: place.copyOnly ? 'copy-only-row' : 'in-flow', at: container, before: null };
  }
  return stray ?? NOWHERE;
}

export function createFanslyMounts(doc: Document, options: FanslyMountOptions = {}): FanslyMounts {
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
  let kind: DockKind = 'none';
  let instanceId: string | null = null;
  let fixedBox: Element | null = null;
  let lastPoints = '';
  let moves = 0;
  let removals = 0;
  let disposed = false;
  /** The window, its keep-bottom and the fixed overlay's observers: made with the first placement, not at document_start. */
  let live: { readonly win: Window; readonly bottom: ReturnType<typeof createBottomKeeper>; readonly resize: ResizeObserver } | null = null;

  /** In flow: a block over the whole width of the container's column, over the typing line. */
  const dressInFlow = (): void => {
    const style = dockHost.style;
    for (const property of ['left', 'width', 'bottom']) style.removeProperty(property);
    style.setProperty('display', 'block');
    style.setProperty('position', 'relative');
    style.setProperty('z-index', String(DOCK_Z));
    style.setProperty('flex', '0 0 auto');
    style.setProperty('align-self', 'stretch');
    style.setProperty('min-width', '0');
    style.setProperty('contain', 'layout style');
  };
  const positionFixed = (): void => {
    // A box that left the page is no place: the dock stays where it stood until the anchors name the new one.
    if (fixedBox === null || live === null || !fixedBox.isConnected) return;
    const rect = fixedBox.getBoundingClientRect();
    const style = dockHost.style;
    style.setProperty('display', 'block');
    style.setProperty('position', 'fixed');
    style.setProperty('left', `${rect.left}px`);
    style.setProperty('width', `${rect.width}px`);
    style.setProperty('bottom', `${Math.max(0, live.win.innerHeight - rect.top)}px`);
    style.setProperty('z-index', String(PAGE_Z));
    style.setProperty('contain', 'layout style');
  };
  const onWindowResize = (): void => {
    if (kind === 'fixed-overlay') positionFixed();
  };
  const ensureLive = (): NonNullable<typeof live> => {
    if (live !== null) return live;
    const win = doc.defaultView as Window;
    live = {
      win,
      bottom: createBottomKeeper(win, dockHost, { nearBottomPx: options.nearBottomPx ?? FANSLY_NEAR_BOTTOM_PX }),
      resize: new ResizeObserver(() => {
        if (kind === 'fixed-overlay') positionFixed();
        notify();
      }),
    };
    win.addEventListener('resize', onWindowResize);
    return live;
  };

  const points = (): MountPoints => {
    const parent = kind === 'fixed-overlay' ? fixedBox : kind === 'none' ? null : dockHost.parentElement;
    const width = parent === null ? null : Math.max(0, parent.getBoundingClientRect().width);
    return {
      dock: { kind, composerInstanceId: instanceId, width },
      overlay: { ready: (doc.documentElement as HTMLElement | null) !== null, container: null },
    };
  };
  function notify(): void {
    const current = points();
    const text = JSON.stringify(current);
    if (text === lastPoints) return;
    lastPoints = text;
    for (const listener of [...listeners]) listener(current);
  }

  const setMode = (next: DockKind): void => {
    if (next === 'copy-only-row') dockHost.setAttribute(MODE_ATTRIBUTE, 'copy-only');
    else if (next === 'fixed-overlay') dockHost.setAttribute(MODE_ATTRIBUTE, 'overlay');
    else dockHost.removeAttribute(MODE_ATTRIBUTE);
  };

  const place = (input: DockPlace): void => {
    if (disposed) return;
    const spot = spotOf(input);
    /** The dock came into a place it did not stand in (or left one): the feed under it is looked for anew. */
    let relocated = spot.kind !== kind;
    if (spot.kind === 'none') {
      if (dockHost.parentNode !== null) {
        dockHost.remove();
        removals += 1;
      }
      if (fixedBox !== null) live?.resize.disconnect();
      fixedBox = null;
    } else {
      const { resize } = ensureLive();
      if (spot.kind === 'fixed-overlay') {
        if (dockHost.parentElement !== doc.documentElement) {
          doc.documentElement.append(dockHost);
          moves += 1;
          relocated = true;
        }
        if (fixedBox !== spot.at) {
          resize.disconnect();
          fixedBox = spot.at;
          if (fixedBox !== null) resize.observe(fixedBox);
        }
        positionFixed();
      } else {
        const container = spot.at as Element;
        const stands = dockHost.parentElement === container && (spot.before === null ? dockHost.nextSibling === null : dockHost.nextSibling === spot.before);
        if (!stands) {
          // Moved, never made anew: the same host, root and UI tree in the new container (FS-PLC-2).
          container.insertBefore(dockHost, spot.before);
          moves += 1;
          relocated = true;
        }
        if (relocated) dressInFlow();
        if (fixedBox !== null) {
          resize.disconnect();
          fixedBox = null;
        }
      }
    }
    kind = spot.kind;
    instanceId = spot.kind === 'in-flow' || spot.kind === 'fixed-overlay' ? input.composerInstanceId : null;
    setMode(spot.kind);
    if (relocated) live?.bottom.placed(spot.kind === 'in-flow' || spot.kind === 'copy-only-row');
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
      style.setProperty('z-index', String(FANSLY_OVERLAY_Z[layer]));
      overlays.set(layer, found);
    }
    return found;
  };
  let launcherHost: ClosedHost | null = null;
  const launcher = (): ClosedHost => {
    if (launcherHost !== null) return launcherHost;
    if ((doc.documentElement as HTMLElement | null) === null) throw new Error('launcher before <html> exists');
    launcherHost = mountClosedHost(doc.documentElement, 'overlay', 'last', registry);
    launcherHost.host.setAttribute(LAYER_ATTRIBUTE, LAUNCHER_LAYER);
    const style = launcherHost.host.style;
    style.setProperty('position', 'fixed');
    style.setProperty('left', `${LAUNCHER_INSET_PX}px`);
    style.setProperty('bottom', `${LAUNCHER_INSET_PX}px`);
    style.setProperty('z-index', String(PAGE_Z));
    return launcherHost;
  };

  return {
    dock,
    overlay,
    launcher,
    points,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    place,
    // Fansly's Esc closes none of our windows (unlike ChatSpace's chat tab): nothing to mark on a host.
    setDismissibleOpen: () => undefined,
    registry,
    stats: () => ({ moves, removals }),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (live !== null) {
        live.bottom.dispose();
        live.resize.disconnect();
        live.win.removeEventListener('resize', onWindowResize);
      }
      dock.remove();
      for (const host of overlays.values()) host.remove();
      overlays.clear();
      launcherHost?.remove();
      launcherHost = null;
      listeners.clear();
    },
  };
}
