// Vite build of the boards gallery page (architecture.md §10.2 п. 8; R15):
// Spenders, «Новые», the fan panel and the palette in the states of the
// binding mockup, served by the stand at /boards-gallery/ for the visual and
// performance e2e. Output goes to <repo>/.cache/boards-gallery (ignored by
// git, outside the AMO sources archive).

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/boards/gallery.test.ts). */
export const BOARDS_GALLERY_SOURCE_DIR = fileURLToPath(new URL('./src/boards/gallery/', import.meta.url));
export const BOARDS_GALLERY_BUILD_DIR = fileURLToPath(new URL('../../.cache/boards-gallery/', import.meta.url));
/** Where the stand serves it. */
export const BOARDS_GALLERY_BASE = '/boards-gallery/';

export default defineConfig({
  root: BOARDS_GALLERY_SOURCE_DIR,
  base: BOARDS_GALLERY_BASE,
  logLevel: 'warn',
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: BOARDS_GALLERY_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox142',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
  },
});
