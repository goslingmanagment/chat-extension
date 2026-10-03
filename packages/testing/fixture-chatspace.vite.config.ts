// Vite build of the ChatSpace-like fixture app (architecture.md §12 п. 3).
// Output goes to <repo>/.cache/fixture-chatspace: ignored by git and outside
// the AMO sources archive. No Vue SFC plugin: components are render functions.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/stand/stand.test.ts). */
export const FIXTURE_SOURCE_DIR = fileURLToPath(new URL('./fixture-chatspace/', import.meta.url));
export const FIXTURE_BUILD_DIR = fileURLToPath(new URL('../../.cache/fixture-chatspace/', import.meta.url));

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
  },
});
