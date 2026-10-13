// Vite build of the Fansly-like stand page (R20 P6a, docs/project-unite/
// architecture.md §13). Output goes to <repo>/.cache/fixture-fansly: ignored by
// git and outside the AMO sources archive. Plain TypeScript and CSS, no
// framework: the page imitates Angular's mechanics by hand.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/stand/stand.test.ts). */
export const FANSLY_FIXTURE_SOURCE_DIR = fileURLToPath(new URL('./fixture-fansly/', import.meta.url));
export const FANSLY_FIXTURE_BUILD_DIR = fileURLToPath(new URL('../../.cache/fixture-fansly/', import.meta.url));

export default defineConfig({
  root: FANSLY_FIXTURE_SOURCE_DIR,
  base: '/',
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: FANSLY_FIXTURE_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox128',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
  },
});
