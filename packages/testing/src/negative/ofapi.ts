// What «a call to OFAPI» looks like in our sources (R02, NEG-OFAPI): the hub's
// /ofapi routes, the vendor's domain, and every OFAPI operation, schema and
// constant the vendored @kernel/sdk exposes — taken from the vendored dist at
// test time, like the sdk-custody gate takes its markers (a re-vendor brings
// its own). The SDK lives in the background (sdk-custody), but that gate does
// not forbid OFAPI operations there; this scan does, over every shipped
// source. An OFAPI read also marks the OnlyFans chat read.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './sources';

/** Where the vendored SDK's built code is. */
export const VENDORED_SDK_DIST = 'vendor/kernel-sdk/dist';

/**
 * The generic shape of an OFAPI reference in code: a hub `/ofapi` path; a
 * name with `ofapi`/`Ofapi` followed by more of the name (`ofapiActionDispatch`,
 * `adminOfapiCreditsDaily`, `cancelOfapiCommand`, `ofapi_chats`); an
 * `OFAPI_*` constant; the bare `ofapi` namespace used as code (`sdk.ofapi.read(`,
 * `ofapi?.x`, `ofapi[…]`, `ofapi(…)`); the vendor's domain. Prose such as
 * «no OFAPI» in a comment does not match.
 */
export const OFAPI_CODE_PATTERN = /\/ofapi\b|\b\w*[Oo]fapi[A-Z_]\w*|\bOFAPI_\w+|\bofapi\s*(?:\?\.|[.([])|onlyfansapi\.com/;

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return /\.(?:js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

let names: readonly string[] | null = null;

/** Every identifier of the vendored SDK's code that names OFAPI (operations, schemas, constants, wire tokens), sorted. */
export function vendoredSdkOfapiNames(): readonly string[] {
  if (names !== null) return names;
  const found = new Set<string>();
  for (const file of jsFiles(join(REPO_ROOT, VENDORED_SDK_DIST))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/[A-Za-z_$][\w$]*/g)) if (/ofapi/i.test(match[0])) found.add(match[0]);
  }
  names = [...found].sort();
  return names;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The pattern the scan uses: the generic shape plus every OFAPI name of the
 * vendored SDK as a whole token (bare `ofapi` / `OFAPI` only in the code
 * shapes above, so prose stays allowed).
 */
export function ofapiScanPattern(): RegExp {
  const derived = vendoredSdkOfapiNames().filter((name) => !/^ofapi$/i.test(name));
  return new RegExp(`${OFAPI_CODE_PATTERN.source}|(?<![\\w$])(?:${derived.map(escape).join('|')})(?![\\w$])`);
}
