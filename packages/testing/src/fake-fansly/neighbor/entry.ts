// `neighbor.js` — the one classic script of the stand's neighbour (built by
// fansly-neighbor.vite.config.ts into .cache/fansly-neighbor). Its element
// says which part to run: `boot` (put first in `<head>` by the stand server —
// FBuddy's MAIN patch and isolated world) or a page part the boot injected
// (`bridge`, `hook`, `guard`). Each run is a fresh evaluation, as FBuddy's
// injections are: the parts share nothing but the window.

import { bootNeighbor, type BootFacts } from './index';
import { runPart, type PartFacts } from './parts';
import { NEIGHBOR_CONFIG_ATTRIBUTE, NEIGHBOR_PART_ATTRIBUTE, neighborConfig, type NeighborPart } from './protocol';

const script = document.currentScript;
if (script instanceof HTMLScriptElement) {
  const part = script.getAttribute(NEIGHBOR_PART_ATTRIBUTE) as NeighborPart | null;
  const facts = JSON.parse(script.getAttribute(NEIGHBOR_CONFIG_ATTRIBUTE) ?? '{}') as Partial<BootFacts> & Partial<PartFacts>;
  if (part === 'boot') bootNeighbor(window, { config: neighborConfig(facts.config), apiOrigin: facts.apiOrigin ?? null, scriptSrc: script.src });
  else if (part !== null) runPart(window, part, { config: neighborConfig(facts.config), apiOrigin: facts.apiOrigin ?? null, instance: facts.instance ?? 0 });
}
