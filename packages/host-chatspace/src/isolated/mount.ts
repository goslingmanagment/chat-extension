// Where our UI lives in ChatSpace (architecture.md §6.3, D-09).
//
// Dock: IN FLOW, the first child of the composer frame root (`div.relative`),
// found as `slot.closest('.composer-frame').parentElement`; nothing ever goes
// inside the slot itself. Exactly one active composer — connected, visible
// along the whole chain, a non-zero box — or none: ChatSpace keeps a v-show
// composer per visited chat tab, so the first slot in DOM order is often a
// hidden one. The same dock host moves between composers (its shadow root and
// UI tree move with it). When Vue re-creates the frame root our host goes
// with it; we come back on the next composer or route change, or when a
// childList observer (no subtree) on the frame root's ancestors up to the
// composers container sees a node replaced. A document-wide observer runs
// only during the first search.
// - The fan is blocked (ChatSpace hides the composer): a narrow copy-only row
//   at the end of the composers container (CG-GATE-FAN-BLOCKED).
// - The frame root is missing (a new build): a fixed overlay over the
//   composer's box, which does not push the message list (§6.2 degradation).
//
// Overlays: `<div data-cg="overlay">` hosts in <html>, outside #app, each
// with a closed shadow root, `position: fixed`, on its z-layer (900 panels,
// 950 modal windows, 960 toasts; ChatSpace's PrimeVue dialogs from 1000 stay
// above). While one of our windows is open its host carries
// `data-dismissible-open`, so ChatSpace's Esc does not close the chat tab.
//
// Every host's closed root is registered for the hotkey dispatcher (§9.1).

import type { ComposerState, MountPoints } from '@cg/contracts/host';

import { DISMISSIBLE_ATTRIBUTE, FIXED_WIDTH_VARIABLE, FRAME_SELECTOR, SLOT_SELECTOR } from './host-contract';
import { createShadowRootRegistry, type ShadowRootRegistry } from './shadow-registry';

/** The translator bridge slot ChatSpace renders above its composer. */
export const COMPOSER_SLOT_SELECTOR = SLOT_SELECTOR;

export type OverlayLayer = 'panel' | 'modal' | 'toast';
/** §6.3 «Слои». */
export const OVERLAY_Z: Readonly<Record<OverlayLayer, number>> = { panel: 900, modal: 950, toast: 960 };
/** The dock as a fixed overlay sits on the panel layer. */
const FIXED_DOCK_Z = OVERLAY_Z.panel;
/** How many ancestors of the frame root are watched for a re-created composer. */
const ANCESTOR_DEPTH = 6;
/** The widest composer box a slot's ancestors can give when the frame is gone. */
const MIN_COMPOSER_WIDTH = 240;

export interface ClosedHost {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
}

const visible = (element: Element | null): element is Element => {
  if (!element?.isConnected || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** The composer's visible box: the frame root, or the slot's parent when the frame is gone. */
const boxOf = (slot: Element): Element | null => slot.closest(FRAME_SELECTOR)?.parentElement ?? slot.parentElement;

/** Slots whose composer box is visible: the active composer is the only one, or there is none. */
export function activeSlots(doc: Document): Element[] {
  return [...doc.querySelectorAll(SLOT_SELECTOR)].filter((slot) => visible(boxOf(slot)));
}

/** The frame root of the one active composer, or null (none, ambiguous, or no frame). */
export function findComposerMount(doc: Document): HTMLElement | null {
  const active = activeSlots(doc);
  const root = active.length === 1 ? active[0]?.closest(FRAME_SELECTOR)?.parentElement : null;
  return root instanceof HTMLElement ? root : null;
}

export interface WaitForComposerOptions {
  /** How long the first search keeps its document-wide observer (§6.3). */
  readonly timeoutMs: number;
  /** Aborting stops the search; the promise then resolves with null. */
  readonly signal: AbortSignal;
}

/** Resolves with the active composer's frame root as soon as ChatSpace renders it, or null after `timeoutMs` or on abort. */
export function waitForComposerMount(doc: Document, options: WaitForComposerOptions): Promise<HTMLElement | null> {
  const found = findComposerMount(doc);
  if (found || options.signal.aborted) return Promise.resolve(found);
  return new Promise((resolve) => {
    const finish = (result: HTMLElement | null): void => {
      observer.disconnect();
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish(null);
    const observer = new MutationObserver(() => {
      const parent = findComposerMount(doc);
      if (parent) finish(parent);
    });
    observer.observe(doc, { childList: true, subtree: true });
    const timer = setTimeout(() => finish(null), options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Inserts a host element with a CLOSED shadow root into `parent`: the dock
 * goes first (in flow above the composer frame), overlays last. The root is
 * registered for the hotkey dispatcher when a registry is given.
 */
export function mountClosedHost(parent: Element, kind: 'dock' | 'overlay', position: 'first' | 'last' = 'first', registry?: ShadowRootRegistry): ClosedHost {
  const host = parent.ownerDocument.createElement('div');
  host.setAttribute('data-cg', kind);
  host.style.setProperty('contain', 'layout style');
  const root = host.attachShadow({ mode: 'closed' });
  const unregister = registry?.register(host, root);
  if (position === 'first') parent.insertBefore(host, parent.firstChild);
  else parent.append(host);
  return {
    host,
    root,
    remove: () => {
      unregister?.();
      host.remove();
    },
  };
}

/**
 * Removes hosts left by a previous instance of the extension. When the add-on
 * is updated, reinstalled or re-enabled, Firefox kills the old content script
 * (its listeners never fire again) but leaves its DOM, and injects the new
 * scripts into the already-open tab (spike M0). Returns how many it removed.
 */
export function removeStaleHosts(doc: Document): number {
  const stale = doc.querySelectorAll('[data-cg]');
  stale.forEach((node) => node.remove());
  return stale.length;
}

export interface MountDiagnostic {
  readonly event: 'composer-ambiguous' | 'composer-not-found' | 'container-not-found' | 'frame-missing';
  /** How many active composers were seen (ambiguity). */
  readonly count?: number;
}

export interface MountManagerOptions {
  /** How long the document-wide observer of the first search lives (§6.3), ms. */
  readonly firstSearchMs?: number;
  readonly onDiagnostic?: (diagnostic: MountDiagnostic) => void;
}

export interface MountManager {
  /** The one dock host; it moves between composers and keeps its shadow root and UI tree. */
  readonly dock: ClosedHost;
  /** The overlay host of a layer, created on first use. */
  overlay(layer: OverlayLayer): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /** Re-evaluates the dock's place for the open chat's composer as MAIN reports it (null — none). */
  update(composer: ComposerState | null): void;
  /** `data-dismissible-open` on a host while any owner keeps one of our windows open there (§6.3, §9.1). */
  setDismissibleOpen(target: 'dock' | OverlayLayer, owner: string, open: boolean): void;
  /** Our hosts and their closed roots, for the hotkey dispatcher (§9.1). */
  readonly registry: ShadowRootRegistry;
  /** §6.2 anchor `composerFrame` as last placed: missing when the dock had to fall back to an overlay. */
  frameAnchor(): 'ok' | 'missing';
  dispose(): void;
}

type DockKind = MountPoints['dock']['kind'];

export function createMountManager(doc: Document, options: MountManagerOptions = {}): MountManager {
  const win = doc.defaultView as Window;
  const registry = createShadowRootRegistry();
  const dockHost = doc.createElement('div');
  dockHost.setAttribute('data-cg', 'dock');
  dockHost.style.setProperty('contain', 'layout style');
  dockHost.style.setProperty('display', 'block');
  const dockRoot = dockHost.attachShadow({ mode: 'closed' });
  registry.register(dockHost, dockRoot);
  const dock: ClosedHost = { host: dockHost, root: dockRoot, remove: () => dockHost.remove() };

  const overlays = new Map<OverlayLayer, ClosedHost>();
  const dismissible = new Map<'dock' | OverlayLayer, Set<string>>();
  const listeners = new Set<(points: MountPoints) => void>();
  let composer: ComposerState | null = null;
  let kind: DockKind = 'none';
  let instanceId: string | null = null;
  let fixedBox: Element | null = null;
  let frame: 'ok' | 'missing' = 'ok';
  let scheduled = false;
  let disposed = false;
  let lastPoints = '';
  let containerElement: Element | null = null;

  const diag = (diagnostic: MountDiagnostic): void => options.onDiagnostic?.(diagnostic);

  // ── observers ──

  const schedule = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!disposed) place();
    });
  };
  /** Mutations that only moved our own host are ours, not ChatSpace's. */
  const onMutations = (records: MutationRecord[]): void => {
    const ours = (nodes: NodeList): boolean => [...nodes].every((node) => node === dockHost);
    if (records.some((record) => !ours(record.addedNodes) || !ours(record.removedNodes))) schedule();
  };
  const ancestors = new MutationObserver(onMutations);
  const resize = new ResizeObserver(() => {
    if (kind === 'fixed-overlay') positionFixed();
    notify();
  });
  let firstSearch: MutationObserver | null = new MutationObserver(schedule);
  firstSearch.observe(doc, { childList: true, subtree: true });
  const firstSearchTimer = setTimeout(() => stopFirstSearch(), options.firstSearchMs ?? 30_000);
  const stopFirstSearch = (): void => {
    firstSearch?.disconnect();
    firstSearch = null;
    clearTimeout(firstSearchTimer);
  };
  const onWindowResize = (): void => {
    if (kind === 'fixed-overlay') positionFixed();
  };
  win.addEventListener('resize', onWindowResize);

  /** childList observers (no subtree) on `from` and its ancestors up to ANCESTOR_DEPTH or #app. */
  const watchFrom = (from: Element | null): void => {
    ancestors.disconnect();
    let node = from;
    for (let depth = 0; node && depth < ANCESTOR_DEPTH && node !== doc.body && node.id !== 'app'; depth += 1, node = node.parentElement) {
      ancestors.observe(node, { childList: true });
    }
  };

  // ── placement ──

  /** The element whose children are the per-tab composers: their common ancestor, or the parent of the v-show-hidden one. */
  const composersContainer = (): Element | null => {
    const slots = [...doc.querySelectorAll(SLOT_SELECTOR)];
    if (slots.length > 1) {
      let common: Element | null = slots[0] ?? null;
      while (common && !slots.every((slot) => common?.contains(slot))) common = common.parentElement;
      return common;
    }
    for (let node = slots[0]?.parentElement ?? null; node; node = node.parentElement) {
      if (node instanceof HTMLElement && node.style.display === 'none') return node.parentElement;
    }
    return null;
  };

  /** Without a frame: the slot's nearest ancestor as wide as a composer. */
  const composerBox = (slot: Element): Element | null => {
    let node = slot.parentElement;
    for (let depth = 0; node && depth < ANCESTOR_DEPTH; depth += 1, node = node.parentElement) {
      if (node.getBoundingClientRect().width >= MIN_COMPOSER_WIDTH) return node;
    }
    return slot.parentElement;
  };

  const resetDockStyle = (): void => {
    for (const property of ['position', 'left', 'width', 'bottom', 'z-index']) dockHost.style.removeProperty(property);
  };

  function positionFixed(): void {
    if (!fixedBox) return;
    const rect = fixedBox.getBoundingClientRect();
    dockHost.style.setProperty('position', 'fixed');
    dockHost.style.setProperty('left', `${rect.left}px`);
    dockHost.style.setProperty('width', `${rect.width}px`);
    dockHost.style.setProperty('bottom', `${Math.max(0, win.innerHeight - rect.top)}px`);
    dockHost.style.setProperty('z-index', String(FIXED_DOCK_Z));
  }

  const setKind = (next: DockKind, nextInstance: string | null): void => {
    kind = next;
    instanceId = nextInstance;
    if (next === 'copy-only-row') dockHost.setAttribute('data-cg-mode', 'copy-only');
    else if (next === 'fixed-overlay') dockHost.setAttribute('data-cg-mode', 'overlay');
    else dockHost.removeAttribute('data-cg-mode');
  };

  function place(): void {
    let next: DockKind = 'none';
    let parent: Element | null = null;
    let box: Element | null = null;
    if (composer?.hidden) {
      parent = composersContainer();
      if (parent) next = 'copy-only-row';
      else diag({ event: 'container-not-found' });
    } else if (composer) {
      const active = activeSlots(doc);
      if (active.length > 1) diag({ event: 'composer-ambiguous', count: active.length });
      const slot = active.length === 1 ? active[0] : undefined;
      const root = slot?.closest(FRAME_SELECTOR)?.parentElement ?? null;
      if (slot && root) {
        next = 'in-flow';
        parent = root;
      } else if (slot) {
        next = 'fixed-overlay';
        box = composerBox(slot);
        frame = 'missing';
        diag({ event: 'frame-missing' });
      } else if (active.length === 0) diag({ event: 'composer-not-found' });
    }
    if (next === 'in-flow') frame = 'ok';

    if (next === 'in-flow' && parent) {
      if (parent.firstChild !== dockHost) parent.insertBefore(dockHost, parent.firstChild);
      resetDockStyle();
      watchFrom(parent.parentElement);
    } else if (next === 'copy-only-row' && parent) {
      if (parent.lastChild !== dockHost) parent.append(dockHost);
      resetDockStyle();
      watchFrom(parent);
    } else if (next === 'fixed-overlay' && box) {
      if (dockHost.parentElement !== doc.documentElement) doc.documentElement.append(dockHost);
      fixedBox = box;
      positionFixed();
      watchFrom(box);
    } else {
      dockHost.remove();
      resetDockStyle();
      ancestors.disconnect();
    }
    if (next !== 'fixed-overlay') fixedBox = null;
    if (next !== 'none') stopFirstSearch();
    setKind(next, next === 'in-flow' || next === 'fixed-overlay' ? (composer?.instanceId ?? null) : null);
    observeSizes();
    notify();
  }

  /** One ResizeObserver: the dock's box (for the overlay) and the fixed-width container (§6.3). */
  const observeSizes = (): void => {
    resize.disconnect();
    if (fixedBox) resize.observe(fixedBox);
    containerElement = fixedWidthContainer();
    if (containerElement) resize.observe(containerElement);
  };

  /** ChatSpace's fixed-width workspace: the nearest ancestor of the composer (or of #app's content) with a max-width. */
  const fixedWidthContainer = (): Element | null => {
    const width = (doc.documentElement as HTMLElement | null)?.style.getPropertyValue(FIXED_WIDTH_VARIABLE).trim() ?? '';
    if (width === '' || width === 'none') return null;
    for (let node = dockHost.isConnected && kind !== 'fixed-overlay' ? dockHost.parentElement : (fixedBox ?? null); node && node !== doc.body; node = node.parentElement) {
      if (win.getComputedStyle(node).maxWidth !== 'none') return node;
    }
    return null;
  };

  const rectOf = (element: Element | null) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: Math.max(0, rect.width), height: Math.max(0, rect.height) };
  };

  const points = (): MountPoints => {
    const parent = kind === 'fixed-overlay' ? fixedBox : kind === 'none' ? null : dockHost.parentElement;
    const width = parent ? Math.max(0, parent.getBoundingClientRect().width) : null;
    return {
      dock: { kind, composerInstanceId: instanceId, width },
      overlay: { ready: (doc.documentElement as HTMLElement | null) !== null, container: rectOf(containerElement) },
    };
  };

  function notify(): void {
    const current = points();
    const text = JSON.stringify(current);
    if (text === lastPoints) return;
    lastPoints = text;
    for (const listener of [...listeners]) listener(current);
  }

  const overlay = (layer: OverlayLayer): ClosedHost => {
    let found = overlays.get(layer);
    if (!found) {
      if ((doc.documentElement as HTMLElement | null) === null) throw new Error('overlay before <html> exists');
      found = mountClosedHost(doc.documentElement, 'overlay', 'last', registry);
      const style = found.host.style;
      found.host.setAttribute('data-cg-layer', layer);
      style.setProperty('position', 'fixed');
      style.setProperty('inset', '0');
      style.setProperty('pointer-events', 'none');
      style.setProperty('z-index', String(OVERLAY_Z[layer]));
      overlays.set(layer, found);
      if (dismissible.get(layer)?.size) found.host.setAttribute(DISMISSIBLE_ATTRIBUTE, '');
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
    update(next) {
      composer = next;
      schedule();
    },
    setDismissibleOpen(target, owner, open) {
      const owners = dismissible.get(target) ?? new Set<string>();
      dismissible.set(target, owners);
      if (open) owners.add(owner);
      else owners.delete(owner);
      const host = target === 'dock' ? dockHost : overlays.get(target)?.host;
      if (!host) return;
      if (owners.size > 0) host.setAttribute(DISMISSIBLE_ATTRIBUTE, '');
      else host.removeAttribute(DISMISSIBLE_ATTRIBUTE);
    },
    registry,
    frameAnchor: () => frame,
    dispose() {
      disposed = true;
      stopFirstSearch();
      ancestors.disconnect();
      resize.disconnect();
      win.removeEventListener('resize', onWindowResize);
      dockHost.remove();
      for (const host of overlays.values()) host.remove();
      overlays.clear();
      listeners.clear();
    },
  };
}
