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
// composers container sees a node replaced. That watch stays while MAIN
// reports a composer the page does not show (a re-mount with a pause: to MAIN,
// which reads the composer on store events, the composer that comes back is
// the same one, so it says nothing); it goes when the dock leaves with the
// chat. A document-wide observer runs only during the first search.
// - The dock stands over other nodes than the ones it first stood over for the
//   composer MAIN names, and MAIN has said nothing new for RENEWED_SETTLE_MS:
//   ChatSpace rendered that composer again (with a pause or in one step) and
//   MAIN, which still holds the old nodes, did not hear of it — an insert with
//   that composer's identity would be refused. `onRenewed` says so once per
//   new nodes, and the port asks MAIN to look again (host-port.ts). A chat
//   switch looks the same for a moment — ChatSpace shows the other chat's
//   composer before MAIN's report of it arrives — and is never taken for one:
//   MAIN's own word comes within the settle time and ends the wait.
// - The fan is blocked (ChatSpace hides the composer): a narrow copy-only row
//   at the end of the composers container (CG-GATE-FAN-BLOCKED).
// - The frame root is missing (a new build): a fixed overlay over the
//   composer's box, which does not push the message list (§6.2 degradation).
//
// Overlays: `<div data-host="overlay">` hosts in <html>, outside #app, each
// with a closed shadow root, `position: fixed`, on its z-layer (900 panels,
// 950 modal windows, 960 toasts; ChatSpace's PrimeVue dialogs from 1000 stay
// above). While one of our windows is open its host carries
// `data-dismissible-open`, so ChatSpace's Esc does not close the chat tab.
//
// Every host's closed root is registered for the hotkey dispatcher (§9.1).
//
// The page sees our hosts, and its telemetry may print them (Sentry in
// ChatSpace 0.195.0 prints a clicked element's tag, id, classes, aria-label,
// title, name, type and alt, or its `data-sentry-*`). So a host is a plain
// `div` with none of those, never editable, and its attributes have neutral
// names that never name the extension (decision X22): `data-host`,
// `data-mode`, `data-layer`, `data-pending` (keyboard.ts), `data-scheme`
// (the UI kit) and ChatSpace's own `data-dismissible-open`. mount.dom.test.ts
// pins that list.

import type { ComposerState, MountPoints } from '@cg/contracts/host';

import { DISMISSIBLE_ATTRIBUTE, FIXED_WIDTH_VARIABLE, FRAME_SELECTOR, SLOT_SELECTOR } from './host-contract';
import { createShadowRootRegistry, type ShadowRootRegistry } from './shadow-registry';

/** The translator bridge slot ChatSpace renders above its composer. */
export const COMPOSER_SLOT_SELECTOR = SLOT_SELECTOR;

/** What a host is: `dock` or `overlay`. */
export const HOST_ATTRIBUTE = 'data-host';
/** The dock's mode when it is not in the composer frame: `copy-only` (the row) or `overlay` (fixed over the composer). */
export const MODE_ATTRIBUTE = 'data-mode';
/** An overlay host's layer: `panel`, `modal`, `toast`. */
export const LAYER_ATTRIBUTE = 'data-layer';

export type OverlayLayer = 'panel' | 'modal' | 'toast';
/** §6.3 «Слои». */
export const OVERLAY_Z: Readonly<Record<OverlayLayer, number>> = { panel: 900, modal: 950, toast: 960 };
/** The dock as a fixed overlay sits on the panel layer. */
const FIXED_DOCK_Z = OVERLAY_Z.panel;
/** How many ancestors of the frame root are watched for a re-created composer. */
const ANCESTOR_DEPTH = 6;
/** The widest composer box a slot's ancestors can give when the frame is gone. */
const MIN_COMPOSER_WIDTH = 240;
/**
 * How long MAIN gets to tell of another composer by itself before a dock over other nodes is taken for a re-render
 * MAIN did not hear of. On a chat switch MAIN reports within a frame and its two 20 ms event gaps (§5.3).
 */
export const RENEWED_SETTLE_MS = 100;

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
  host.setAttribute(HOST_ATTRIBUTE, kind);
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
  // Only our host shape — a `div` with nothing in its light DOM: a neutral name could be some other element's too.
  // `data-cg` — a host of a build from before X22.
  const stale = [...doc.querySelectorAll(`div[${HOST_ATTRIBUTE}], div[data-cg]`)].filter(
    (node) => node.childNodes.length === 0 && (node.hasAttribute('data-cg') || ['dock', 'overlay'].includes(node.getAttribute(HOST_ATTRIBUTE) ?? '')),
  );
  stale.forEach((node) => node.remove());
  return stale.length;
}

export interface MountDiagnostic {
  readonly event: 'composer-ambiguous' | 'composer-not-found' | 'container-not-found' | 'frame-missing' | 'composer-renewed';
  /** How many active composers were seen (ambiguity). */
  readonly count?: number;
}

export interface MountManagerOptions {
  /** How long the document-wide observer of the first search lives (§6.3), ms. */
  readonly firstSearchMs?: number;
  /** RENEWED_SETTLE_MS, for a test that cannot wait. */
  readonly renewedSettleMs?: number;
  readonly onDiagnostic?: (diagnostic: MountDiagnostic) => void;
}

export interface MountManager {
  /** The one dock host; it moves between composers and keeps its shadow root and UI tree. */
  readonly dock: ClosedHost;
  /** The overlay host of a layer, created on first use. */
  overlay(layer: OverlayLayer): ClosedHost;
  points(): MountPoints;
  onChange(listener: (points: MountPoints) => void): () => void;
  /**
   * The open chat's composer as MAIN reports it (null — none). The dock's
   * place is re-evaluated only when the composer, its chat or its hidden
   * state changed — not for a draft revision (MAIN reports one per keystroke).
   */
  update(composer: ComposerState | null): void;
  /** Re-evaluates the dock's place now («Проверить»). */
  refresh(): void;
  /**
   * The dock has stood over other nodes than the ones it first stood over for
   * the composer MAIN names (the same `instanceId`), and MAIN said nothing new
   * for the settle time: ChatSpace rendered that composer again and MAIN,
   * which reads composers on store events, did not hear of it. Said once per
   * new nodes; never for a chat switch MAIN reports by itself.
   */
  onRenewed(listener: () => void): () => void;
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
  dockHost.setAttribute(HOST_ATTRIBUTE, 'dock');
  // Its inline style is set when it is placed the first time (`dress`), not here: this runs in the synchronous start
  // at document_start (§11), and the first touch of an element's `style` in a page's content-script global costs
  // ~0.3 ms there. Until then the host is in no document.
  let dressed = false;
  const dress = (): void => {
    if (dressed) return;
    dressed = true;
    dockHost.style.setProperty('contain', 'layout style');
    dockHost.style.setProperty('display', 'block');
  };
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
  /** The nodes the dock first stood over for the composer MAIN names now; kept while the dock waits for them (a pause). */
  let home: { readonly instanceId: string; readonly slot: Element } | null = null;
  /** The other nodes MAIN was asked about (once per nodes), and the ones whose settle time runs or has just passed. */
  let asked: Element | null = null;
  let settling: { readonly slot: Element; readonly timer: ReturnType<typeof setTimeout> } | null = null;
  let settled: Element | null = null;
  const renewedListeners = new Set<() => void>();

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
  const stopFirstSearch = (): void => {
    firstSearch?.disconnect();
    firstSearch = null;
    clearTimeout(firstSearchTimer);
  };
  const onWindowResize = (): void => {
    if (kind === 'fixed-overlay') positionFixed();
  };

  /** The nodes `ancestors` observes. */
  let watched: Element[] = [];
  const unwatch = (): void => {
    ancestors.disconnect();
    watched = [];
  };
  /** childList observers (no subtree) on `from` and its ancestors up to ANCESTOR_DEPTH or #app. */
  const watchFrom = (from: Element | null): void => {
    unwatch();
    let node = from;
    for (let depth = 0; node && depth < ANCESTOR_DEPTH && node !== doc.body && node.id !== 'app'; depth += 1, node = node.parentElement) {
      ancestors.observe(node, { childList: true });
      watched.push(node);
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
    if (next === 'copy-only-row') dockHost.setAttribute(MODE_ATTRIBUTE, 'copy-only');
    else if (next === 'fixed-overlay') dockHost.setAttribute(MODE_ATTRIBUTE, 'overlay');
    else dockHost.removeAttribute(MODE_ATTRIBUTE);
  };

  function place(): void {
    dress();
    let next: DockKind = 'none';
    let parent: Element | null = null;
    let box: Element | null = null;
    let over: Element | null = null;
    if (composer?.hidden) {
      parent = composersContainer();
      if (parent) next = 'copy-only-row';
      else diag({ event: 'container-not-found' });
    } else if (composer) {
      const active = activeSlots(doc);
      if (active.length > 1) diag({ event: 'composer-ambiguous', count: active.length });
      const slot = active.length === 1 ? active[0] : undefined;
      over = slot ?? null;
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
      // MAIN reports an open composer the page does not show (none, or two for a moment): ChatSpace is rendering it
      // again, and MAIN will not say when it is back — to MAIN it is the same composer. The dock keeps watching where
      // it stood (the composers container when nothing of that place is left) and comes back with the new nodes.
      // Without a composer the dock left with the chat: nothing to wait for.
      if (!composer) unwatch();
      else if (!watched.some((node) => node.isConnected)) watchFrom(composersContainer());
    }
    if (next !== 'fixed-overlay') fixedBox = null;
    if (next !== 'none') stopFirstSearch();
    setKind(next, next === 'in-flow' || next === 'fixed-overlay' ? (composer?.instanceId ?? null) : null);
    observeSizes();
    notify();
    renewal(next === 'in-flow' || next === 'fixed-overlay' ? over : null);
  }

  const stopSettling = (): void => {
    if (settling) clearTimeout(settling.timer);
    settling = null;
  };

  /**
   * `slot` — the nodes the dock stands over now (null — it stands nowhere, or in the copy-only row). Other nodes than
   * the ones it first stood over for the composer MAIN still names: either a chat switch whose report from MAIN is on
   * its way (ChatSpace shows the other chat's composer first), or a re-render MAIN did not hear of. MAIN gets its
   * settle time: its word of another composer (or of none) makes these nodes that composer's own and ends the wait;
   * its silence means a re-render, said once for these nodes. A pause in between keeps `home`: the dock waited.
   */
  function renewal(slot: Element | null): void {
    if (!composer || composer.hidden) {
      home = null;
      asked = null;
    } else if (slot && home?.instanceId !== composer.instanceId) {
      home = { instanceId: composer.instanceId, slot };
      asked = null;
    }
    if (!slot || !home || slot === home.slot || slot === asked) return stopSettling();
    if (settled === slot) {
      asked = slot;
      diag({ event: 'composer-renewed' });
      for (const listener of [...renewedListeners]) listener();
    } else if (settling?.slot !== slot) {
      stopSettling();
      const timer = setTimeout(() => {
        settling = null;
        if (disposed) return;
        // Where the dock should stand now — a switch there and back may have left it over a field ChatSpace hides
        // again — and, still over these nodes with MAIN silent, the re-render is said.
        settled = slot;
        place();
        settled = null;
      }, options.renewedSettleMs ?? RENEWED_SETTLE_MS);
      settling = { slot, timer };
    }
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
      found.host.setAttribute(LAYER_ATTRIBUTE, layer);
      style.setProperty('position', 'fixed');
      style.setProperty('inset', '0');
      style.setProperty('pointer-events', 'none');
      style.setProperty('z-index', String(OVERLAY_Z[layer]));
      overlays.set(layer, found);
      if (dismissible.get(layer)?.size) found.host.setAttribute(DISMISSIBLE_ATTRIBUTE, '');
    }
    return found;
  };

  // Everything above is defined: only now may an observer call back into it.
  firstSearch.observe(doc, { childList: true, subtree: true });
  const firstSearchTimer = setTimeout(stopFirstSearch, options.firstSearchMs ?? 30_000);
  win.addEventListener('resize', onWindowResize);

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
      const same =
        next === composer ||
        (next !== null &&
          composer !== null &&
          next.instanceId === composer.instanceId &&
          next.hidden === composer.hidden &&
          next.chat.hostAccountId === composer.chat.hostAccountId &&
          next.chat.platformFanId === composer.chat.platformFanId);
      composer = next;
      if (!same) schedule();
    },
    refresh: schedule,
    onRenewed(listener) {
      renewedListeners.add(listener);
      return () => {
        renewedListeners.delete(listener);
      };
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
      unwatch();
      resize.disconnect();
      win.removeEventListener('resize', onWindowResize);
      dockHost.remove();
      for (const host of overlays.values()) host.remove();
      overlays.clear();
      listeners.clear();
      renewedListeners.clear();
      stopSettling();
    },
  };
}
