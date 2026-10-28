// Slots of ours in ChatSpace's conversation header (2026-10-28, «Заметки»): closed roots in the header's actions row,
// right before its search button (host-contract.ts), in our own order, the API of Fansly's header-slot.ts. The port
// looks for the row when the route, the contract or the dock's place changes (`sync`). While a row is there, one
// MutationObserver — childList only, on the row and its few ancestors up to the conversation panel — puts our slots
// back when ChatSpace renders the header again (another chat's, a button that came or went) and tells when the row
// went. No polling, no observer of the document; a mutation that only moved our own nodes is ours and ignored.

import { HOST_ATTRIBUTE } from '@cg/host-kit/isolated/hosts';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { HEADER_AFTER_TEST_IDS, HEADER_SEARCH_TEST_ID } from './host-contract';

/** A header button's own wrappers (ChatSpace's tooltip `div`): the row is the first ancestor with more than one child. */
const WRAPPER_DEPTH = 3;
/** The row's ancestors watched for a header rendered anew: the header's bar, the header, the conversation panel. */
const ANCESTOR_DEPTH = 3;

/** `ok` — the row is there; `missing` — a chat's conversation is shown and its row is not; `unknown` — not judged. */
export type HeaderState = 'ok' | 'missing' | 'unknown';

export interface HeaderSlot {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  remove(): void;
}

/** Where our slots stand: in `row`, right before `item` — or right after it (`after`, the search button is not there). */
interface Place {
  readonly row: Element;
  readonly item: Element;
  readonly after: boolean;
}

const shown = (element: Element): boolean => {
  if (!element.isConnected || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** The one visible element of a test id; null — none, or several (ambiguous: our slots stand nowhere). */
const visibleOf = (doc: Document, testId: string): Element | null | false => {
  const found = [...doc.querySelectorAll(`[data-testid="${testId}"]`)].filter(shown);
  return found.length === 1 ? (found[0] ?? null) : found.length === 0 ? null : false;
};

/** The header's actions row, found by its search button (or the button our slots then follow); null — not on the page. */
export function findHeaderPlace(doc: Document): Place | null {
  const anchors: ReadonlyArray<readonly [string, boolean]> = [[HEADER_SEARCH_TEST_ID, false], ...HEADER_AFTER_TEST_IDS.map((id) => [id, true] as const)];
  for (const [testId, after] of anchors) {
    const button = visibleOf(doc, testId);
    if (button === false) return null;
    if (button === null) continue;
    let item: Element = button;
    for (let depth = 0; depth < WRAPPER_DEPTH && item.parentElement !== null && item.parentElement.childElementCount === 1; depth += 1) item = item.parentElement;
    return item.parentElement === null ? null : { row: item.parentElement, item, after };
  }
  return null;
}

export function createHeaderSlots(doc: Document, registry: ShadowRootRegistry) {
  let place: Place | null = null;
  let state: HeaderState = 'unknown';
  /** The port's last word: the open chat's conversation is shown, so a row not found is `missing`. */
  let expected = false;
  let scheduled = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const slots = new Map<number, { readonly host: HTMLElement; readonly unregister: () => void }>();
  const ours = (node: Node): boolean => [...slots.values()].some((slot) => slot.host === node);

  /** Our hosts in order where the row has room for them; only our own nodes move, and only when out of place. */
  const arrange = (): void => {
    const hosts = [...slots.entries()].sort(([a], [b]) => a - b).map(([, slot]) => slot.host);
    if (place === null || !place.row.isConnected || place.item.parentElement !== place.row) {
      for (const host of hosts) host.remove();
      return;
    }
    let next: Node | null = place.after ? place.item.nextSibling : place.item;
    if (place.after) while (next !== null && ours(next)) next = next.nextSibling;
    for (let index = hosts.length - 1; index >= 0; index -= 1) {
      const host = hosts[index] as HTMLElement;
      if (host.parentElement !== place.row || host.nextSibling !== next) place.row.insertBefore(host, next);
      next = host;
    }
  };

  const observer = new MutationObserver((records) => {
    const foreign = (nodes: NodeList): boolean => [...nodes].some((node) => !ours(node));
    if (records.some((record) => foreign(record.addedNodes) || foreign(record.removedNodes))) schedule();
  });
  /** The row and its ancestors up to the conversation panel: childList only. */
  const watch = (row: Element | null): void => {
    observer.disconnect();
    for (let node = row, depth = 0; node !== null && depth <= ANCESTOR_DEPTH && node !== doc.body; node = node.parentElement, depth += 1) {
      observer.observe(node, { childList: true });
    }
  };

  const sync = (): void => {
    if (disposed) return;
    const found = findHeaderPlace(doc);
    const moved = found?.row !== place?.row;
    place = found;
    if (moved) watch(found?.row ?? null);
    arrange();
    const next: HeaderState = found !== null ? 'ok' : expected ? 'missing' : 'unknown';
    if (!moved && next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sync();
    });
  }

  return {
    /**
     * Looks for the row now. `shown` — the open chat's conversation is on the page (the dock stands at its composer):
     * a row not found then is `missing`, else only not judged. While the row found last is still there with its button,
     * nothing is measured: what ChatSpace changes inside it, the observer hears.
     */
    sync: (shown: boolean): void => {
      expected = shown;
      if (place !== null && place.row.isConnected && place.item.parentElement === place.row) return arrange();
      sync();
    },
    onChange: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    available: (): boolean => place?.row.isConnected === true,
    state: (): HeaderState => state,
    /** A slot of ours at `order` among ours (lower first); one per order. It stands in the row while there is one. */
    mount: (order: number): HeaderSlot => {
      if (slots.has(order)) throw new Error('header slot already occupied');
      const host = doc.createElement('div');
      host.setAttribute(HOST_ATTRIBUTE, 'header-slot');
      host.setAttribute('data-header-order', String(order));
      host.style.cssText = 'display:inline-flex;flex:0 0 auto;align-items:center;min-width:0;contain:layout style';
      const root = host.attachShadow({ mode: 'closed' });
      const unregister = registry.register(host, root);
      slots.set(order, { host, unregister });
      arrange();
      return {
        host,
        root,
        remove() {
          if (slots.get(order)?.host !== host) return;
          unregister();
          slots.delete(order);
          host.remove();
        },
      };
    },
    dispose: (): void => {
      disposed = true;
      observer.disconnect();
      place = null;
      for (const slot of slots.values()) {
        slot.unregister();
        slot.host.remove();
      }
      slots.clear();
      listeners.clear();
    },
  };
}

export type HeaderSlots = ReturnType<typeof createHeaderSlots>;
