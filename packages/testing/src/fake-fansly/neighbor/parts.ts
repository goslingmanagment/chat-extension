// The neighbour's page parts — what FBuddy injects into the page by
// `<script src>` (S5 §2.2): the window bridge (stays in the DOM as
// `script#fbuddy-window-bridge-script`), the network hook (removed after its
// load) and, for an organization, the restricted-words guard. On the stand all
// of them are one script, `neighbor.js`, told which part to run by an
// attribute of its element (entry.ts); `before` runs them inline instead.

import { createBridge, pageBridgePost, startFlood } from './bridge';
import { installGuard, type GuardInstance } from './guard';
import { installNetworkHook, type HookInstance } from './network-hook';
import type { NeighborConfig, NeighborPart } from './protocol';

/** What a part needs to know: the boot hands it over as JSON on the part's script element. */
export interface PartFacts {
  readonly config: NeighborConfig;
  /** The fake Fansly's API origin; null — the page has none (the local backend). */
  readonly apiOrigin: string | null;
  /** The hook's install number. */
  readonly instance: number;
}

/** `window-bridge.js`: the page side of the bridge; the flood starts with it. */
export function runBridge(win: Window & typeof globalThis, facts: PartFacts): void {
  const bridge = createBridge(win, 'page');
  startFlood(bridge, facts.config.floodMs);
}

/** `fbuddy-network-hook.js` (the July build in `legacy`). */
export function runHook(win: Window & typeof globalThis, facts: PartFacts): HookInstance | null {
  return installNetworkHook(win, { apiOrigin: facts.apiOrigin, legacy: facts.config.mode === 'legacy', instance: facts.instance, post: pageBridgePost(win) });
}

/** `fbuddy-restricted-words-guard.js`. */
export function runGuard(win: Window & typeof globalThis, facts: PartFacts): GuardInstance | null {
  if (facts.apiOrigin === null) return null;
  return installGuard(win, { apiOrigin: facts.apiOrigin, post: pageBridgePost(win) });
}

export function runPart(win: Window & typeof globalThis, part: Exclude<NeighborPart, 'boot'>, facts: PartFacts): void {
  switch (part) {
    case 'bridge':
      runBridge(win, facts);
      return;
    case 'hook':
      runHook(win, facts);
      return;
    case 'guard':
      runGuard(win, facts);
      return;
    default:
      throw new Error(`no neighbor part ${String(part)}`);
  }
}
