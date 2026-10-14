// Vite build of the Fansly stand's FBuddy-like neighbour (R20 P6d,
// src/fake-fansly/neighbor): ONE classic script, `neighbor.js`, that the stand
// server puts first in the Fansly stand page's `<head>` and that injects its
// own page parts by `<script src>` of the same file, as FBuddy does
// (src/fake-fansly/neighbor/entry.ts). Output goes to
// <repo>/.cache/fansly-neighbor: ignored by git and outside the AMO sources
// archive.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folder as src/stand/paths.ts (pinned by src/stand/fansly-stand.test.ts). */
export const FANSLY_NEIGHBOR_ENTRY = fileURLToPath(new URL('./src/fake-fansly/neighbor/entry.ts', import.meta.url));
export const FANSLY_NEIGHBOR_BUILD_DIR = fileURLToPath(new URL('../../.cache/fansly-neighbor/', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: FANSLY_NEIGHBOR_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox128',
    sourcemap: false,
    minify: false,
    reportCompressedSize: false,
    lib: { entry: FANSLY_NEIGHBOR_ENTRY, formats: ['iife'], name: 'fanslyStandNeighbor', fileName: () => 'neighbor.js' },
  },
});
