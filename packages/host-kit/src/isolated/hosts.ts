// Our hosts in a site's page and the layers of the overlay ones (architecture.md
// §6.3, D-09), the same on every site (R20 P5: moved here from
// host-chatspace's mount.ts). Where a host stands — the dock by the site's
// message field, the overlays in <html> — is the site's own mount manager.
//
// A host is a `div` with a CLOSED shadow root. Overlay hosts are
// `position: fixed` on their z-layer (900 panels, 950 modal windows, 960
// toasts; a site's own dialogs stay above — ChatSpace's PrimeVue ones start
// at 1000). Every host's closed root is registered for the hotkey dispatcher
// (§9.1, shadow-registry.ts).
//
// The page sees our hosts, and its telemetry may print them (Sentry in
// ChatSpace 0.195.0 prints a clicked element's tag, id, classes, aria-label,
// title, name, type and alt, or its `data-sentry-*`). So a host is a plain
// `div` with none of those, never editable, and its attributes have neutral
// names that never name the extension (decision X22): `data-host`,
// `data-mode`, `data-layer`, `data-pending` (keyboard.ts), and `data-scheme`
// and `data-dock-variant` (the UI kit, the site's profile).

import type { ShadowRootRegistry } from './shadow-registry';

/** What a host is: `dock`, `overlay`, or an inline `header-slot`. */
export const HOST_ATTRIBUTE = 'data-host';
/** The dock's mode when it is not in the composer frame: `copy-only` (the row) or `overlay` (fixed over the composer). */
export const MODE_ATTRIBUTE = 'data-mode';
/** An overlay host's layer: `panel`, `modal`, `toast`. */
export const LAYER_ATTRIBUTE = 'data-layer';

export type OverlayLayer = 'panel' | 'modal' | 'toast';
/** §6.3 «Слои». */
export const OVERLAY_Z: Readonly<Record<OverlayLayer, number>> = { panel: 900, modal: 950, toast: 960 };

export interface ClosedHost {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
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
    (node) => node.childNodes.length === 0 && (node.hasAttribute('data-cg') || ['dock', 'overlay', 'header-slot'].includes(node.getAttribute(HOST_ATTRIBUTE) ?? '')),
  );
  stale.forEach((node) => node.remove());
  return stale.length;
}
