// The stand server's side of the neighbour (Node): which config a page load
// gets — the page's own `?stand-neighbor=<spec>` first, else the default a
// test set over the control endpoint — and the boot script put into the served
// page, right after `<meta charset>`: a classic parser-blocking script, so it
// runs after the extension's `document_start` scripts and before any of the
// page's own (the stand-in for FBuddy's `document_start` content scripts).

import { NEIGHBOR_CONFIG_ATTRIBUTE, NEIGHBOR_PARAM, NEIGHBOR_PART_ATTRIBUTE, NEIGHBOR_SCRIPT_PATH, neighborActive, parseNeighborSpec, type NeighborConfig } from './protocol';
import type { BootFacts } from './index';

/** The config of one page load; null — no neighbour on it. A bad spec throws (the server answers 400). */
export function neighborFor(url: URL, standing: NeighborConfig | null): NeighborConfig | null {
  const spec = url.searchParams.get(NEIGHBOR_PARAM);
  const config = spec === null ? standing : parseNeighborSpec(spec);
  return config !== null && neighborActive(config) ? config : null;
}

const attribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The boot script's tag. */
export function bootTag(facts: BootFacts): string {
  return `<script src="${NEIGHBOR_SCRIPT_PATH}" ${NEIGHBOR_PART_ATTRIBUTE}="boot" ${NEIGHBOR_CONFIG_ATTRIBUTE}="${attribute(JSON.stringify(facts))}"></script>`;
}

/** The page with the boot script first in its `<head>` (after `<meta charset>` when there is one). */
export function withNeighbor(html: string, facts: BootFacts): string {
  const tag = bootTag(facts);
  const charset = /<meta charset="[^"]*"\s*\/?>/i.exec(html);
  if (charset !== null) return `${html.slice(0, charset.index + charset[0].length)}\n    ${tag}${html.slice(charset.index + charset[0].length)}`;
  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) return `${html.slice(0, head.index + head[0].length)}${tag}${html.slice(head.index + head[0].length)}`;
  return `${tag}${html}`;
}
