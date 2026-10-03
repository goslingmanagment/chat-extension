// TEST builds only (architecture.md §11): marks the first and the last
// statement of a content-script bundle with performance.now(). The probe
// reports t1 − t0, i.e. the whole synchronous start — top-level code of the
// bundle plus its entry function — not just the entry's body. Parsing and
// compiling the file happen before t0 and stay outside the number.
//
// - The isolated bundle («ранний бутстрап» ≤ 3 ms): zod schemas, WXT's
//   runtime, ContentScriptContext, composeTab. Its marks live on the content
//   script's own global (Firefox gives each extension's content scripts a
//   sandbox global), so the page never sees them.
// - The MAIN bundle (boot + runtime, decision X11: work at document_start
//   ≤ 1 ms). Its marks are on the page's window — a test build only; the e2e
//   reads them there.
// The marks are set only on the loopback stand: a test build also runs on the
// real ChatSpace (`pnpm dev`, X9), and there it leaves nothing of the kind on
// the page's window.
// tools/gates fails if BUNDLE_MARKS_KEY ever reaches a release bundle.

import type { Plugin } from 'vite';

export const BUNDLE_MARKS_KEY = '__cgBundleMarks';
/** True only on the loopback stand (the document's host name). */
const LOOPBACK_TEST = String.raw`/^(?:127\.0\.0\.1|localhost)$/.test(location.hostname)`;

export function bundleTimingPlugin(): Plugin {
  return {
    name: 'cg:bundle-timing',
    // After WXT's own generateBundle (it strips the `var <name> =` IIFE prefix).
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
        chunk.code =
          `if(${LOOPBACK_TEST})globalThis.${BUNDLE_MARKS_KEY}={t0:performance.now()};\n` +
          `${chunk.code}\n` +
          `if(globalThis.${BUNDLE_MARKS_KEY})globalThis.${BUNDLE_MARKS_KEY}.t1=performance.now();\n`;
      }
    },
  };
}
