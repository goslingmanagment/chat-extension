// Vite build of the extension-pages gallery (architecture.md §10.2 п. 8;
// R16): the popup, the options page and the debug pages mounted with the
// shipped entry functions over the scripted background, served by the stand
// at /pages-gallery/ for the visual e2e. Output goes to
// <repo>/.cache/pages-gallery (ignored by git, outside the AMO sources archive).

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/pages/gallery.test.ts). */
export const PAGES_GALLERY_SOURCE_DIR = fileURLToPath(new URL('./src/pages/gallery/', import.meta.url));
export const PAGES_GALLERY_BUILD_DIR = fileURLToPath(new URL('../../.cache/pages-gallery/', import.meta.url));
/** Where the stand serves it. */
export const PAGES_GALLERY_BASE = '/pages-gallery/';

export default defineConfig({
  root: PAGES_GALLERY_SOURCE_DIR,
  base: PAGES_GALLERY_BASE,
  logLevel: 'warn',
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: PAGES_GALLERY_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox142',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
    // One page with the whole world of the stand in it (contracts, both catalogs, the scripted background).
    chunkSizeWarningLimit: 1024,
  },
});
