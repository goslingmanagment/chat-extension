// The two MAIN-world scripts (chatspace-main, chatspace-ws) start without
// WXT's entry wrapper (architecture.md §5.3 «Правила MAIN-мира», decision
// X22). WXT wraps an entry's `main()` in a try that logs through its own
// logger and RETHROWS: for a MAIN content script as an unhandled rejection of
// an async IIFE, for an unlisted script as an uncaught error at the top level
// — in the page's own world, where ChatSpace's error handling (Sentry in
// 0.195.0) would take it, with our frames. It also carries the strings
// «The content script "chatspace-main" crashed on startup!» and, in a dev
// build, console calls. Our entries' `main()` never throws (each guards its
// own install), so the wrapper adds nothing but ~170 B gzip to each bundle,
// whose budgets have no room for it (§11).
//
// The plugin answers WXT's virtual entry module of exactly these two entry
// points with `import definition from '<entry>'; definition.main();`. WXT
// plugins (`initPlugins`) are not called: this project has none. If a WXT
// upgrade renames its virtual modules, the plugin stops matching and the
// wrapper comes back — `pnpm gates` then fails on its marker in the built
// MAIN bundles (tools/gates `main-world-bundle`).
//
// A TEST build's bridge bundle also carries the positive control of the
// sentry-gate e2e, on the loopback stand only: a page event
// (MAIN_THROW_PROBE_EVENT) makes a listener of the MAIN script throw, not
// guarded — what an escape of ours would look like to the page and to its
// Sentry (the frame's URL, a full error or «Script error.»). A release build
// never has it (tools/gates `release-bundle`).

import type { Plugin } from 'vite';

/** WXT's virtual entry modules of a MAIN content script and of an unlisted script, as resolved ids. */
const WXT_ENTRY = /^\0virtual:wxt-(?:content-script-main-world|unlisted-script)-entrypoint\?(.+)$/;

/** The page event that makes the TEST build's MAIN script throw (the e2e's positive control); never in a release build. */
export const MAIN_THROW_PROBE_EVENT = 'cg-e2e-main-throw';
const LOOPBACK = String.raw`/^(?:127\.0\.0\.1|localhost)$/.test(location.hostname)`;

/**
 * `entries` — the absolute input paths of the MAIN-world entry points; `probe` — the one (a TEST build's bridge) that
 * also gets the positive control.
 */
export function mainWorldEntryPlugin(entries: readonly string[], options: { readonly probe?: string } = {}): Plugin {
  return {
    name: 'cg:main-world-entry',
    // Before WXT's own loader of the same id.
    enforce: 'pre',
    load(id) {
      const input = WXT_ENTRY.exec(id)?.[1];
      if (input === undefined || !entries.includes(input)) return null;
      const probe =
        input === options.probe
          ? `if (${LOOPBACK}) addEventListener(${JSON.stringify(MAIN_THROW_PROBE_EVENT)}, function mainWorldProbe() { throw new Error('e2e: an error of a MAIN-world script that nothing caught'); });\n`
          : '';
      return `import definition from ${JSON.stringify(input)};\ndefinition.main();\n${probe}`;
    },
  };
}
