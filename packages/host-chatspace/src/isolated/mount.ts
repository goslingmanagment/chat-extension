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

export interface WaitForComposerOptions {
  /** How long the first search keeps its document-wide observer (§6.3). */
  readonly timeoutMs: number;
  /** Aborting stops the search; the promise then resolves with null. */
  readonly signal: AbortSignal;
}

/**
 * Resolves with the composer frame root as soon as ChatSpace renders it, or
 * with null after `timeoutMs` or on abort. The document-wide observer lives
 * only for this first search; R09 replaces it with the scoped re-mount rules.
 */
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
