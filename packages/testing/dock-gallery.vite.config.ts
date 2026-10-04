// Vite build of the dock and overlays gallery page (architecture.md §10.2
// п. 8, R14): every state of the dock, Recap, Review, Coach, the cheatsheet,
// the expanded result and the toasts, served by the stand at /dock-gallery/
// for the visual e2e. Output goes to <repo>/.cache/dock-gallery (ignored by
// git, outside the AMO sources archive).

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts (pinned by src/dock/gallery-build.test.ts). */
export const DOCK_GALLERY_SOURCE_DIR = fileURLToPath(new URL('./src/dock/gallery/', import.meta.url));
export const DOCK_GALLERY_BUILD_DIR = fileURLToPath(new URL('../../.cache/dock-gallery/', import.meta.url));
/** Where the stand serves it. */
export const DOCK_GALLERY_BASE = '/dock-gallery/';

export default defineConfig({
  root: DOCK_GALLERY_SOURCE_DIR,
  base: DOCK_GALLERY_BASE,
  logLevel: 'warn',
  publicDir: false,
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    outDir: DOCK_GALLERY_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox142',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
  },
});
