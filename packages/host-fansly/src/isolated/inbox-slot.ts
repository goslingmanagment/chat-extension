// The strip's place in Fansly's own list of chats (2026-11-12, temporary chat pins): ordered closed hosts
// `div[data-host="inbox-slot"]`, modelled on the header's (header-slot.ts), right after the filter chips
// (`.messages-nav-wrapper`) of the route's list (`app-messages-route div.messages-list-wrapper`), else right after its
// search row; neither — no place, nothing mounted. Never in the mini chat's lookalike list (`app-messaging-overlay`).
//
// The place is outside Fansly's scroller (`div.message-list`): a node there moves the scroller's top and shrinks its
// height, and changes neither its `scrollTop` nor its spacers nor its rows (the live experiment of 2026-11-12). Fansly's
// own spinner of a search lands after it.
//
// Kept by the port's anchor sync and by one `childList` observer of that wrapper, without subtree: the same node is
// moved only when its place is broken, and a wrapper that throws it out twice is given up (no fight with the page).
// Our roots are in the registry of shadow roots: the keyboard's probe sees a focus inside as ours.

import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

export const INBOX_SLOT_HOST = 'inbox-slot';
const NAV = 'messages-nav-wrapper';
const SEARCH = 'message-search';
const ROW = 'a[href^="/messages/"]';
const HOST_STYLE = 'display:block;flex:0 0 auto;margin:0 .5em;min-width:0;contain:layout style';

export interface InboxSlotMount {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
}

export interface InboxSlotStats {
  /** Our hosts put back after the page moved or took them out. */
  readonly replaced: number;
  /** Wrappers given up after they threw our host out twice. */
  readonly refused: number;
}

export function createInboxSlots(doc: Document, registry: ShadowRootRegistry) {
  let wrapper: Element | null = null;
  /** Wrappers that threw our host out twice: nothing of ours goes into them again. */
  const refused = new WeakSet<Element>();
  /** The wrapper came in the sync being said now: a surface mounted in it is there before the page paints it. */
  let fresh = false;
  let thrown = 0;
  let replaced = 0;
  let refusals = 0;
  let placing = false;
  let was = false;
  const listeners = new Set<() => void>();
  const slots = new Map<number, { host: HTMLElement; root: ShadowRoot; unregister: () => void }>();
  /** Hosts placed at least once: a later move of one is a re-placement. */
  const placedOnce = new WeakSet<HTMLElement>();

  const ordered = (): HTMLElement[] => [...slots.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot.host);
  const anchor = (): Element | null => {
    if (wrapper === null || !wrapper.isConnected || refused.has(wrapper)) return null;
    let search: Element | null = null;
    for (const child of wrapper.children) {
      if (child.classList.contains(NAV)) return child;
      if (search === null && child.classList.contains(SEARCH)) search = child;
    }
    return search;
  };

  /** Each host right after the one before it, the first right after the anchor; only a broken place is touched. */
  const place = (): void => {
    const at = anchor();
    placing = true;
    try {
      let before: Element | null = at;
      for (const host of ordered()) {
        if (before === null || wrapper === null) {
          host.remove();
          continue;
        }
        if (host.parentNode !== wrapper || host.previousElementSibling !== before) {
          if (placedOnce.has(host)) replaced += 1;
          placedOnce.add(host);
          before.after(host);
        }
        before = host;
      }
    } finally {
      placing = false;
      // What our own moves said to the observer is not the page's change.
      observer.takeRecords();
    }
  };

  const ours = (node: Node): boolean => node.nodeType === 1 && (node as Element).getAttribute('data-host') === INBOX_SLOT_HOST;
  /** The page's changes of the wrapper: our host thrown out is counted; true — something of the page's moved. */
  const consider = (records: readonly MutationRecord[]): boolean => {
    if (wrapper === null || records.length === 0) return false;
    let out = false;
    let page = false;
    for (const record of records) {
      for (const node of record.removedNodes) if (ours(node)) out = true;
      if (![...record.addedNodes, ...record.removedNodes].every(ours)) page = true;
    }
    if (out) {
      thrown += 1;
      if (thrown >= 2) {
        // The page will not have us here: no fight. The strip comes back with the next instance of the list.
        refused.add(wrapper);
        refusals += 1;
        observer.disconnect();
        for (const host of ordered()) host.remove();
        return true;
      }
    }
    return out || page;
  };
  const observer = new MutationObserver((records) => {
    if (placing || wrapper === null) return;
    if (!consider(records)) return;
    place();
    say();
  });

  const available = (): boolean => anchor() !== null;
  /** Says a change of the place to every listener; none of them may break the port's sync that called this. */
  const say = (): void => {
    const now = available();
    if (now === was) return;
    was = now;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A surface's failure is its own (it reports it); the page's sync goes on.
      }
    }
  };

  return {
    /** The route's list of chats now on the page; null — none (the port's sync says it). */
    sync(target: Element | null): void {
      const changed = target !== wrapper;
      if (changed) {
        observer.disconnect();
        wrapper = target;
        thrown = 0;
        if (wrapper !== null && !refused.has(wrapper)) observer.observe(wrapper, { childList: true });
      } else {
        // Records not delivered yet (our host thrown out) are counted before our own moves below are discarded.
        consider(observer.takeRecords());
      }
      place();
      fresh = changed && wrapper !== null;
      try {
        say();
      } finally {
        fresh = false;
      }
    },
    /** The route's list came in this very sync: a strip placed now is there before its first paint, at full height. */
    fresh: (): boolean => fresh,
    available,
    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Whether the list shows a row already: a strip placed before Fansly's first rows needs no motion. */
    hasRows: (): boolean => wrapper !== null && wrapper.querySelector(ROW) !== null,
    mount(order: number): InboxSlotMount {
      if (slots.has(order)) throw new Error('inbox slot already occupied');
      const host = doc.createElement('div');
      host.setAttribute('data-host', INBOX_SLOT_HOST);
      host.setAttribute('data-inbox-order', String(order));
      host.setAttribute('style', HOST_STYLE);
      const root = host.attachShadow({ mode: 'closed' });
      const unregister = registry.register(host, root);
      slots.set(order, { host, root, unregister });
      place();
      return {
        host,
        root,
        remove() {
          unregister();
          slots.delete(order);
          placing = true;
          host.remove();
          placing = false;
          observer.takeRecords();
        },
      };
    },
    stats: (): InboxSlotStats => ({ replaced, refused: refusals }),
    dispose(): void {
      observer.disconnect();
      wrapper = null;
      for (const slot of slots.values()) {
        slot.unregister();
        slot.host.remove();
      }
      slots.clear();
      listeners.clear();
    },
  };
}

export type InboxSlots = ReturnType<typeof createInboxSlots>;
