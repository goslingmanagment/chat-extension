// Vite build of the ChatSpace-like fixture app (architecture.md §12 п. 3).
// Output goes to <repo>/.cache/fixture-chatspace: ignored by git and outside
// the AMO sources archive. No Vue SFC plugin: components are render functions.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/stand/stand.test.ts). */
export const FIXTURE_SOURCE_DIR = fileURLToPath(new URL('./fixture-chatspace/', import.meta.url));
export const FIXTURE_BUILD_DIR = fileURLToPath(new URL('../../.cache/fixture-chatspace/', import.meta.url));

/**
 * ChatSpace's build splits its app into modules named `<role>-<hash>.js`, and
 * the adapter fingerprints the ones its send path lives in (architecture.md
 * §6.2 «профиль пути отправки и квитанции»; the roles are the adapter's:
 * `@cg/host-chatspace/host-contract` RECEIPT_MODULE_ROLES). The stand's build
 * gives its own code the same module names — the queue, the HTTP client and
 * the socket, the composer, the accounts and chat stores, the query
 * definitions with Mimic's — so the e2e reads real `modulepreload` links and
 * resource timing entries, not a list a test made up.
 *
 * The layout is ChatSpace 0.195.0's: no `messages` module (0.172.0 had one);
 * the composer, its bridge and the translator store are an `onlyfans` module,
 * and a second, small `onlyfans` module carries the platform's message model
 * the queue and the stores import. Two modules of one role give the role a
 * fingerprint of two hashes joined with `+`, as on the real page.
 */
const ROLE_MODULES: ReadonlyArray<{ readonly name: string; readonly test: RegExp }> = [
  { name: 'notificationEntry', test: /fixture-chatspace\/src\/stores\/pending-messages\.ts$/ },
  { name: 'onlyfans', test: /fixture-chatspace\/src\/(ui\/(composer|bridge|editor-handle|registry)|stores\/composer)\.ts$/ },
  { name: 'onlyfans', test: /fixture-chatspace\/src\/query\/model\.ts$/ },
  { name: 'accounts', test: /fixture-chatspace\/src\/stores\/(accounts|chats|stored)\.ts$/ },
  { name: 'inbox', test: /fixture-chatspace\/src\/query\/(queries|use-query)\.ts$/ },
  { name: 'composables', test: /fixture-chatspace\/src\/(net\/|query\/cache\.ts$|env\.ts$|journal\.ts$|protocol\.ts$)/ },
  // Libraries go below all of them (as in ChatSpace's own build), so no module waits on the entry module that imports it.
  // The editor's own libraries stay with the editor: it loads later, like ChatSpace's.
  { name: 'vue.runtime', test: /node_modules\/(?!\.pnpm\/)(?!@tiptap\/|prosemirror-|orderedmap\/|rope-sequence\/|w3c-keyname\/|linkifyjs\/)/ },
];

export default defineConfig({
  root: FIXTURE_SOURCE_DIR,
  base: '/',
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: FIXTURE_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox128',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
    // Each module holds only the files named above; what they import stays where the build puts it.
    rolldownOptions: { output: { codeSplitting: { includeDependenciesRecursively: false, groups: [...ROLE_MODULES] } } },
  },
});
