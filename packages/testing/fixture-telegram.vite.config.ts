// Vite build of the Telegram Web A-like stand page (docs/specs/2026-10-27-telegram-site.md §6.10). Output goes to
// <repo>/.cache/fixture-telegram: ignored by git and outside the AMO sources archive. Plain TypeScript and CSS with
// TipTap 3 (the editor Web A mounts on its message field), no framework. Served under `/a/`, as Web A is.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/** Same folders as src/stand/paths.ts. */
export const TELEGRAM_FIXTURE_SOURCE_DIR = fileURLToPath(new URL('./fixture-telegram/', import.meta.url));
export const TELEGRAM_FIXTURE_BUILD_DIR = fileURLToPath(new URL('../../.cache/fixture-telegram/', import.meta.url));

export default defineConfig({
  root: TELEGRAM_FIXTURE_SOURCE_DIR,
  base: '/a/',
  logLevel: 'warn',
  publicDir: false,
  build: {
    outDir: TELEGRAM_FIXTURE_BUILD_DIR,
    emptyOutDir: true,
    target: 'firefox128',
    sourcemap: false,
    reportCompressedSize: false,
    modulePreload: { polyfill: false },
  },
});
