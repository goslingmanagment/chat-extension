// A site's isolated script — ChatSpace's content script (chatspace.content.ts),
// Fansly's script the background registers (fansly.ts, an unlisted script of
// WXT's) — starts without WXT's entry wrapper and without its
// ContentScriptContext (architecture.md
// §11 «ранний бутстрап ≤ 3 мс»; the spike-m0 e2e measures it). The context
// cost the synchronous start of every ChatSpace page about a third of its
// time, and none of it was ours to keep:
// - its class reads `browser.runtime.id` while it is being defined (its event
//   names), and the `wxt/browser` module it imports reads it at load: the
//   first touch of the extension API in a page's content-script global costs
//   ~0.34 ms on every page load (spike-m0 e2e, Firefox 156) and ~3 ms on the
//   first start after an install (docs/spike-m0.md);
// - its constructor dispatches `<gecko id>:chatspace:wxt:content-script-started`
//   on the page's document and posts it to the page's window: an event of
//   ours that names the extension, which the page can read (decision X22);
// - its invalidation never worked for us: Firefox kills a removed or updated
//   extension's content scripts outright, so only the page itself could send
//   that event (spike M0) — the tab ignored it. The extension going away is
//   seen through the background port (tab/runtime.ts).
// Decision X23 (docs/decisions.md).
//
// The plugin answers WXT's virtual entry module of that one entry point (a
// content script's or an unlisted script's) with
// `import definition from '<entry>'; definition.main();` — the same as
// main-world-entry.ts does for the MAIN-world scripts. WXT plugins
// (`initPlugins`) are not called: this project has none. If a WXT upgrade
// renames its virtual modules, the plugin stops matching and the context comes
// back — `pnpm gates` then fails on its event name in the built isolated
// bundle (tools/gates `isolated-start`).

import type { Plugin } from 'vite';

/**
 * WXT's virtual entry module of an isolated-world content script or of an unlisted script, as a resolved id. An
 * unlisted script gets no context, but the same wrapper, which logs «crashed on startup» and rethrows.
 */
const WXT_ENTRY = /^\0virtual:wxt-(?:content-script-isolated-world|unlisted-script)-entrypoint\?(.+)$/;

/** `entry` — the absolute input path of the site's isolated script. */
export function isolatedEntryPlugin(entry: string): Plugin {
  return {
    name: 'cg:isolated-entry',
    // Before WXT's own loader of the same id.
    enforce: 'pre',
    load(id) {
      return WXT_ENTRY.exec(id)?.[1] === entry ? `import definition from ${JSON.stringify(entry)};\ndefinition.main();\n` : null;
    },
  };
}
