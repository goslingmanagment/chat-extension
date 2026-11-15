// The launcher's slot in ChatSpace's account rail (2026-11-15; ui-design §3.13): one closed root of ours in the rail's
// own flow, right before the app's version at its bottom (host-contract.ts `RAIL_WIDTH_VARIABLE`). The rail is a flex
// column whose middle — the account tiles and the round «+», a scroller — takes what height is left, so our slot takes
// its height from that middle and covers nothing: the tiles scroll as they do when there are many, the «+» stays at the
// scroller's bottom.
//
// No test id or class of ChatSpace's own marks the rail, so it is found by its shape, all of it at once: an element of
// `#app` (a `nav` in 0.233.0) whose last child is a leaf showing a version (`0.233.0`), which stands at the page's left
// edge as wide as ChatSpace's own `--account-sidebar-width` and at least half the window tall. Exactly one such column,
// or none: our slot stands nowhere rather than in a wrong place.
//
// Kept like the header's slots (header-slot.ts): while the slot stands, one MutationObserver — childList only, on the
// rail and its few ancestors — puts it back when ChatSpace renders the rail or its layout again; the port's route changes
// look again (`sync`); until the rail is first found, a document-wide observer looks for it for at most
// RAIL_FIRST_SEARCH_MS, a check at most every RAIL_SEARCH_GAP_MS. While the slot stands where it should, nothing is
// measured; a mutation that only moved our own node is ours and ignored.

import { HOST_ATTRIBUTE } from '@cg/host-kit/isolated/hosts';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { APP_SELECTOR, RAIL_WIDTH_VARIABLE } from './host-contract';

/** `data-host` of the slot: a neutral name (decision X22), one of the kinds `removeStaleHosts` takes off a dead instance's page. */
export const RAIL_HOST = 'rail';
/** The app's version as the rail's last child shows it: three numbers, a pre-release or build suffix allowed. */
const VERSION_TEXT = /^v?\d{1,4}\.\d{1,4}\.\d{1,6}(?:[-+.][0-9A-Za-z.-]{1,32})?$/;
/** The rail's box starts within this many px of the page's left edge. */
const EDGE_PX = 2;
/** Its width is the variable's, give or take a rounding. */
const WIDTH_SLACK_PX = 1;
/** The rail's ancestors watched for it rendered anew: its layout and the app's root. */
const ANCESTOR_DEPTH = 3;
/** The first search, as the dock's (mount.ts `firstSearchMs`): the rail comes with ChatSpace's layout, or not at all. */
export const RAIL_FIRST_SEARCH_MS = 30_000;
/** The first search looks at most this often: ChatSpace renders a lot while it starts. */
export const RAIL_SEARCH_GAP_MS = 200;
/** The columns looked at: any tag ChatSpace may give the rail, or the class its width comes from. Each is judged by the shape. */
const CANDIDATES = `nav, aside, [class*="${RAIL_WIDTH_VARIABLE}"]`;

export interface RailPlace {
  readonly rail: Element;
  /** The rail's last child, the app's version: our slot stands right before it. */
  readonly version: Element;
}

const shown = (element: Element): boolean => typeof element.checkVisibility !== 'function' || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });

/** The rail's width as ChatSpace declares it on its root, px; null — not declared (no rail we know). */
function declaredWidth(doc: Document): number | null {
  const html = doc.documentElement as HTMLElement | null;
  const win = doc.defaultView;
  if (html === null || win === null) return null;
  const value = win.getComputedStyle(html).getPropertyValue(RAIL_WIDTH_VARIABLE).trim();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  if (value.endsWith('rem')) return number * (Number.parseFloat(win.getComputedStyle(html).fontSize) || 16);
  return value.endsWith('px') || /^[\d.]+$/.test(value) ? number : null;
}

/** A leaf showing a version: no element inside, its text a version and nothing else. */
const isVersion = (element: Element | null): element is Element => element !== null && element.childElementCount === 0 && VERSION_TEXT.test(element.textContent?.trim() ?? '');

/** ChatSpace's account rail and its version label, found by the rail's shape; null — none, or more than one. */
export function findRailPlace(doc: Document): RailPlace | null {
  const app = doc.querySelector(APP_SELECTOR);
  const win = doc.defaultView;
  if (app === null || win === null) return null;
  // The cheap part first: a column whose last child is a version. Only those are measured (a layout read).
  const columns = [...app.querySelectorAll(CANDIDATES)].filter((column) => isVersion(column.lastElementChild));
  if (columns.length === 0) return null;
  const width = declaredWidth(doc);
  if (width === null) return null;
  const found = columns.filter((column) => {
    if (!shown(column)) return false;
    const rect = column.getBoundingClientRect();
    return rect.left <= EDGE_PX && Math.abs(rect.width - width) <= WIDTH_SLACK_PX && rect.height >= win.innerHeight / 2;
  });
  const [rail] = found;
  return found.length === 1 && rail !== undefined && rail.lastElementChild !== null ? { rail, version: rail.lastElementChild } : null;
}

export interface RailSlotOptions {
  /** RAIL_FIRST_SEARCH_MS, for a test that cannot wait. */
  readonly firstSearchMs?: number;
  /** The first search ended without the rail (said once). */
  readonly onMissing?: () => void;
}

export interface RailSlot {
  /** The slot's host — a plain `div`, `data-host="rail"` — and its closed root, registered for the keys and the action gate. */
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  /** Looks for the rail now (a route change). While the slot stands where it should, nothing is measured. */
  sync(): void;
  /** The slot stands in the rail, right before its version. */
  placed(): boolean;
  dispose(): void;
}

export function createRailSlot(doc: Document, registry: ShadowRootRegistry, options: RailSlotOptions = {}): RailSlot {
  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, RAIL_HOST);
  // An item of the rail's column: its own height, centred in the rail, a little air above the version.
  host.style.cssText = 'display:block;flex:0 0 auto;align-self:center;margin:6px 0 8px;contain:layout style';
  const root = host.attachShadow({ mode: 'closed' });
  const unregister = registry.register(host, root);
  let place: RailPlace | null = null;
  let scheduled = false;
  let disposed = false;

  /** The slot stands right before the version, the version still the rail's last child, the rail in the page. */
  const stands = (): boolean =>
    place !== null && place.rail.isConnected && place.rail.lastElementChild === place.version && host.parentElement === place.rail && host.nextElementSibling === place.version;

  /** Our host where the place says, or out of the page; only our own node moves, and only when out of place. */
  const arrange = (): void => {
    if (place === null || !place.rail.isConnected || place.version.parentElement !== place.rail) {
      host.remove();
      return;
    }
    if (host.parentElement !== place.rail || host.nextElementSibling !== place.version) place.rail.insertBefore(host, place.version);
  };

  const observer = new MutationObserver((records) => {
    const foreign = (nodes: NodeList): boolean => [...nodes].some((node) => node !== host);
    if (records.some((record) => foreign(record.addedNodes) || foreign(record.removedNodes))) schedule();
  });
  /** The rail and its ancestors up to the app's root: childList only. */
  const watch = (rail: Element | null): void => {
    observer.disconnect();
    for (let node = rail, depth = 0; node !== null && depth <= ANCESTOR_DEPTH && node !== doc.body; node = node.parentElement, depth += 1) {
      observer.observe(node, { childList: true });
    }
  };

  let firstSearch: MutationObserver | null = null;
  let firstTimer: ReturnType<typeof setTimeout> | undefined;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  const stopFirstSearch = (): void => {
    firstSearch?.disconnect();
    firstSearch = null;
    clearTimeout(firstTimer);
    clearTimeout(gapTimer);
    gapTimer = undefined;
  };

  function sync(): void {
    if (disposed || stands()) return;
    const found = findRailPlace(doc);
    if (found?.rail !== place?.rail) watch(found?.rail ?? null);
    place = found;
    arrange();
    if (found !== null) stopFirstSearch();
  }
  function schedule(): void {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sync();
    });
  }

  sync();
  if (place === null && !disposed) {
    // The rail comes with ChatSpace's layout: until then the document is watched, for a while, a check per gap.
    firstSearch = new MutationObserver(() => {
      if (gapTimer !== undefined) return;
      gapTimer = setTimeout(() => {
        gapTimer = undefined;
        sync();
      }, RAIL_SEARCH_GAP_MS);
    });
    firstSearch.observe(doc, { childList: true, subtree: true });
    firstTimer = setTimeout(() => {
      stopFirstSearch();
      if (!disposed && place === null) options.onMissing?.();
    }, options.firstSearchMs ?? RAIL_FIRST_SEARCH_MS);
  }

  return {
    host,
    root,
    sync,
    placed: stands,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopFirstSearch();
      observer.disconnect();
      place = null;
      unregister();
      host.remove();
    },
  };
}
