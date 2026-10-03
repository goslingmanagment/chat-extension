// Vite build of the ui/kit gallery page (architecture.md §10.2 п. 8): the
// kit's components in every state, served by the stand at /kit-gallery/ for
// the visual e2e. Output goes to <repo>/.cache/kit-gallery (ignored by git,
// outside the AMO sources archive).

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/stand/stand.test.ts). */
export const KIT_GALLERY_SOURCE_DIR = fileURLToPath(new URL('./src/kit/gallery/', import.meta.url));
export const KIT_GALLERY_BUILD_DIR = fileURLToPath(new URL('../../.cache/kit-gallery/', import.meta.url));
/** Where the stand serves it. */
export const KIT_GALLERY_BASE = '/kit-gallery/';

export default defineConfig({
  root: KIT_GALLERY_SOURCE_DIR,
  base: KIT_GALLERY_BASE,
  logLevel: 'warn',
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: KIT_GALLERY_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox142',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
  },
});
