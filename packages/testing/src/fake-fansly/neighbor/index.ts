// The FBuddy-like neighbour of the Fansly stand (R20 P6d; S5 §6 — FBuddy
// 2026.927.830 semantics unless `legacy`; X34: FBuddy runs for every chatter,
// so every Fansly PR that touches the tap, the XHR observer, the dock,
// insertion, sending or the header checks itself next to it, in `off` and
// `after` at least — plan.md §0). Clean-room: written from S5's reading of
// FBuddy, no code or assets of it.
//
// What it reproduces, and where (S5 §2, §6.2):
// - A. the MAIN `Map.prototype` patch until Angular's view registry shows up (map-patch.ts);
// - B. the window bridge and WXT's start message (bridge.ts);
// - C. the XHR prototype hooks and the `fetch` replacement, every API body posted to the window (network-hook.ts);
// - D. the restricted-words guard that SWALLOWS a matching `POST /message` and writes the text back (guard.ts);
// - E. its DOM: the whole-document observer, the top bar, inbox rows, three composer widgets, message actions, the
//   fan panel, the `<body>` layer and toasts, `contain: size` and the two-row composer (dom.ts, ui.ts, styles.ts);
// - F. the 10-s unread poll with the title and favicon refresh, and its own requests by a token of its own, which
//   the fake Fansly can answer 429 (own.ts);
// - G. templates, emoji and translate on the composer, ⌘⇧L / Ctrl+Shift+L on the field, Alt+T (composer.ts);
// - H. the «FBuddy Notes» 12000 note it writes for a fan (own.ts);
// - the modes `off`, `after`, `before`, `reinject`, `legacy`, the flags `guard`, `panel`, `generic` (protocol.ts).
// How it gets on the page: the stand server puts `neighbor.js` first in the page's `<head>` when a test asks
// (`?stand-neighbor=<spec>` or the stand's default, stand-server.ts); that boot script plays FBuddy's isolated
// world and injects the page parts by `<script src>` of the same file (entry.ts, parts.ts).

import { installGeneric } from './generic';
import { Isolated, genericOnlyControl, type Injector } from './isolated';
import { installMapPatch } from './map-patch';
import { NEIGHBOR_CONFIG_ATTRIBUTE, NEIGHBOR_GLOBAL, NEIGHBOR_PART_ATTRIBUTE, type NeighborConfig, type NeighborControl } from './protocol';
import { original } from './util';

type View = Window & typeof globalThis;

/** What the boot script is told (JSON on its element): the config and where the fake Fansly's API is. */
export interface BootFacts {
  readonly config: NeighborConfig;
  /** null — the page has no fake Fansly (the local backend): no own requests, no API addresses. */
  readonly apiOrigin: string | null;
}

export interface BootOptions extends BootFacts {
  /** The address of neighbor.js (its page parts are the same file); needed by the default injector. */
  readonly scriptSrc?: string;
  readonly inject?: Injector;
  readonly afterFirstXhr?: (run: () => void) => void;
}

export interface BootedNeighbor {
  readonly isolated: Isolated | null;
  readonly control: NeighborControl;
}

const SCRIPT_TIMEOUT_MS = 15_000;

/** FBuddy's way in (S5 §2.2): `<script id src>` appended to `<html>`, awaited, removed after load unless it stays. */
export function scriptInjector(win: View, src: string): Injector {
  return (part, facts, { id, keep }) =>
    new Promise<void>((resolve, reject) => {
      const script = win.document.createElement('script');
      script.id = id;
      script.type = 'text/javascript';
      script.setAttribute(NEIGHBOR_PART_ATTRIBUTE, part);
      script.setAttribute(NEIGHBOR_CONFIG_ATTRIBUTE, JSON.stringify(facts));
      if (part === 'bridge') script.setAttribute('data-fbuddy-version', '2');
      const timer = setTimeout(() => reject(new Error(`neighbor part ${part} did not load in ${SCRIPT_TIMEOUT_MS} ms`)), SCRIPT_TIMEOUT_MS);
      script.addEventListener('load', () => {
        clearTimeout(timer);
        if (!keep) script.remove();
        resolve();
      });
      script.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`neighbor part ${part} failed to load`));
      });
      script.src = src;
      win.document.documentElement.append(script);
    });
}

/** Runs `run` once the page's first API XHR has come back (its resource timing entry is there). */
export function firstApiXhr(win: View, apiOrigin: string | null): (run: () => void) => void {
  return (run) => {
    if (apiOrigin === null) {
      run();
      return;
    }
    let done = false;
    const prefix = `${apiOrigin}/api/`;
    const isIt = (entry: PerformanceEntry): boolean => (entry as PerformanceResourceTiming).initiatorType === 'xmlhttprequest' && entry.name.startsWith(prefix);
    const fire = (): void => {
      if (done) return;
      done = true;
      run();
    };
    if (win.performance.getEntriesByType('resource').some(isIt)) {
      fire();
      return;
    }
    const observer = new win.PerformanceObserver((list) => {
      if (!list.getEntries().some(isIt)) return;
      observer.disconnect();
      fire();
    });
    observer.observe({ type: 'resource', buffered: true });
  };
}

/** The boot script's work: the generic third party (if asked), then FBuddy — its MAIN patch and its isolated world. */
export function bootNeighbor(win: View, options: BootOptions): BootedNeighbor {
  const { config, apiOrigin } = options;
  const generic = config.generic === null ? null : installGeneric(win, config.generic);
  if (config.mode === 'off') {
    const control = genericOnlyControl(config, generic);
    Reflect.set(win, NEIGHBOR_GLOBAL, control);
    return { isolated: null, control };
  }
  // Its content script's own fetch, taken before its page hook replaces the page's.
  const fetch = original<typeof globalThis.fetch>(win, 'fetch').bind(win);
  const mapPatch = installMapPatch(win);
  const src = options.scriptSrc;
  const inject =
    options.inject ??
    (src === undefined
      ? () => Promise.reject(new Error('the neighbour boot needs scriptSrc to inject its parts'))
      : scriptInjector(win, src));
  const isolated = new Isolated(win, { config, apiOrigin, inject, afterFirstXhr: options.afterFirstXhr ?? firstApiXhr(win, apiOrigin), fetch, mapPatch, generic });
  isolated.start();
  return { isolated, control: isolated.control() };
}

export * from './protocol';
