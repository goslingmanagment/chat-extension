// Dock mounting (architecture.md §6.3, D-09): the dock lives IN FLOW, as the
// first child of the composer frame's root (`div.relative`), found from the
// translator bridge slot as `slot.closest('.composer-frame').parentElement`.
// Nothing goes inside the slot itself. Our UI lives in a CLOSED shadow root.
// R09 adds the active-composer rules, re-mounting and the blocked-fan case.

/** The translator bridge slot ChatSpace renders above its composer. */
export const COMPOSER_SLOT_SELECTOR = '[data-id="browser-composer-translator"]';

/** Returns the composer frame root to dock into, or null when no composer is mounted. */
export function findComposerMount(doc: Document): HTMLElement | null {
  const slot = doc.querySelector(COMPOSER_SLOT_SELECTOR);
  const frame = slot?.closest('.composer-frame');
  const root = frame?.parentElement;
  return root instanceof HTMLElement ? root : null;
}

export interface ClosedHost {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
}

/**
 * Inserts our host element into `parent` with a CLOSED shadow root: the dock
 * goes first (in flow above the composer frame), overlays go last.
 */
export function mountClosedHost(parent: HTMLElement, kind: 'dock' | 'overlay', position: 'first' | 'last' = 'first'): ClosedHost {
  const doc = parent.ownerDocument;
  const host = doc.createElement('div');
  host.setAttribute('data-cg', kind);
  host.style.setProperty('contain', 'layout style');
  const root = host.attachShadow({ mode: 'closed' });
  if (position === 'first') parent.insertBefore(host, parent.firstChild);
  else parent.append(host);
  return { host, root, remove: () => host.remove() };
}

/**
 * Removes hosts left by a previous instance of the extension. When the add-on
 * is updated, reinstalled or re-enabled, Firefox kills the old content script
 * (its listeners never fire again) but leaves its DOM, and injects the new
 * scripts into the already-open tab (spike M0, docs/spike-m0.md). Returns the
 * number of stale hosts removed.
 */
export function removeStaleHosts(doc: Document): number {
  const stale = doc.querySelectorAll('[data-cg]');
  stale.forEach((node) => node.remove());
  return stale.length;
}
