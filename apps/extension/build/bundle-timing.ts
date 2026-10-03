// TEST builds only (spike M0, architecture.md §11 «ранний бутстрап»): marks the
// first and the last statement of the isolated content-script bundle with
// performance.now(). The spike probe reports t1 − t0, i.e. the whole
// synchronous start — top-level code of the bundle (zod schemas, WXT's runtime,
// ContentScriptContext) plus composeTab — not just composeTab's body. Parsing
// and compiling the file happen before t0 and stay outside the number.
//
// The marks live on the content script's own global (Firefox gives each
// extension's content scripts a sandbox global), so the page never sees them.
// tools/gates fails if BUNDLE_MARKS_KEY ever reaches a release bundle.

import type { Plugin } from 'vite';

export const BUNDLE_MARKS_KEY = '__cgBundleMarks';

export function bundleTimingPlugin(): Plugin {
  return {
    name: 'cg:bundle-timing',
    // After WXT's own generateBundle (it strips the `var <name> =` IIFE prefix).
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        chunk.code =
          `globalThis.${BUNDLE_MARKS_KEY}={t0:performance.now()};\n` +
          `${chunk.code}\n` +
          `globalThis.${BUNDLE_MARKS_KEY}.t1=performance.now();\n`;
      }
    },
  };
}
