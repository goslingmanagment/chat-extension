// A place of ours in the search row of the route's list of chats (2026-11-13, «Четыре группы»' refresh, groups spec
// §4.2): one closed host `div[data-host="search-slot"]` inside `div.message-search`, right before Fansly's sort control
// (`.transparent-dropdown`), else last in the row. Never in the mini chat's lookalike list.
//
// The row is a static part of Fansly's template (no `ngFor` or `ngIf` around it), so a node of ours beside its children
// is left alone. Kept by the port's sync and one `childList` observer of the row: the host is moved only when its place
// is broken; a row that throws it out twice is given up (no fight with the page).

import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

export const SEARCH_SLOT_HOST = 'search-slot';
const ROW = 'message-search';
const SORT = 'transparent-dropdown';
const HOST_STYLE = 'display:flex;flex:0 0 auto;align-items:center;min-width:0;contain:layout style';

export interface SearchSlotMount {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
}

export function createSearchSlot(doc: Document, registry: ShadowRootRegistry) {
  let row: Element | null = null;
  const refused = new WeakSet<Element>();
  let thrown = 0;
  let placing = false;
  let slot: { host: HTMLElement; root: ShadowRoot; unregister: () => void } | null = null;
  const listeners = new Set<() => void>();
  let was = false;

  const rowOf = (list: Element | null): Element | null => {
    if (list === null) return null;
    for (const child of list.children) if (child.classList.contains(ROW)) return child;
    return null;
  };
  const usable = (): boolean => row !== null && row.isConnected && !refused.has(row);

  const place = (): void => {
    if (slot === null) return;
    placing = true;
    try {
      if (!usable() || row === null) {
        slot.host.remove();
        return;
      }
      let sort: Element | null = null;
      for (const child of row.children) if (child.classList.contains(SORT)) sort = child;
      if (sort !== null) {
        if (slot.host.parentNode !== row || slot.host.nextElementSibling !== sort) sort.before(slot.host);
      } else if (slot.host.parentNode !== row) row.append(slot.host);
    } finally {
      placing = false;
      observer.takeRecords();
    }
  };
  const observer = new MutationObserver((records) => {
    if (placing || slot === null || row === null) return;
    const out = records.some((record) => [...record.removedNodes].includes(slot?.host as Node));
    if (out) {
      thrown += 1;
      if (thrown >= 2) {
        refused.add(row);
        observer.disconnect();
        slot.host.remove();
        say();
        return;
      }
    }
    place();
  });
  const say = (): void => {
    const now = usable();
    if (now === was) return;
    was = now;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A surface's failure is its own; the page's sync goes on.
      }
    }
  };

  return {
    /** The route's list of chats now (the port's sync); null — none. */
    sync(list: Element | null): void {
      const next = rowOf(list);
      if (next !== row) {
        observer.disconnect();
        row = next;
        thrown = 0;
        if (row !== null && !refused.has(row)) observer.observe(row, { childList: true });
      }
      place();
      say();
    },
    available: usable,
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount(): SearchSlotMount {
      if (slot !== null) throw new Error('search slot already occupied');
      const host = doc.createElement('div');
      host.setAttribute('data-host', SEARCH_SLOT_HOST);
      host.setAttribute('style', HOST_STYLE);
      const root = host.attachShadow({ mode: 'closed' });
      const unregister = registry.register(host, root);
      slot = { host, root, unregister };
      place();
      return {
        host,
        root,
        remove() {
          if (slot?.host !== host) return;
          unregister();
          slot = null;
          placing = true;
          host.remove();
          placing = false;
          observer.takeRecords();
        },
      };
    },
    dispose(): void {
      observer.disconnect();
      row = null;
      if (slot !== null) {
        slot.unregister();
        slot.host.remove();
        slot = null;
      }
      listeners.clear();
    },
  };
}

export type SearchSlot = ReturnType<typeof createSearchSlot>;
