// Second Vite build: lazy ESM content-script chunks (architecture.md §3, D-02).
//
// WXT bundles each content script into one classic (IIFE) file and cannot emit
// ES-module content scripts. The UI therefore lives in ES modules built here
// and loaded by the isolated content script with
//   import(browser.runtime.getURL('lazy/<entry>.js'))
// All entries share chunks (Preact is loaded once). Every emitted file is
// listed in web_accessible_resources by build/manifest.ts — nothing else is.
//
// wxt.config.ts runs buildLazyChunks() inside the WXT build (after WXT cleans
// the output dir); `vite build -c lazy/vite.config.ts` builds standalone into
// .output/lazy-standalone for inspection.

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, defineConfig, type InlineConfig, type Rolldown } from 'vite';

const LAZY_ROOT = dirname(fileURLToPath(import.meta.url));

/** Entry name → source. Output: lazy/<name>.js. */
export const LAZY_ENTRIES = {
  dock: 'entries/dock.ts',
  'tab-app': 'entries/tab-app.ts',
  'tab-protocol': 'entries/tab-protocol.ts',
  'i18n-ru': 'entries/i18n-ru.ts',
  'i18n-en': 'entries/i18n-en.ts',
} as const;

/** Folder inside the extension output that holds every lazy file. */
export const LAZY_DIR = 'lazy';

export interface LazyChunkInfo {
  /** Path inside the extension, e.g. lazy/dock.js. */
  readonly file: string;
  readonly kind: 'entry' | 'chunk' | 'asset';
  readonly name: string | null;
  /** Static imports (extension paths) — what loads together with this file. */
  readonly imports: readonly string[];
}

export interface LazyBuildOptions {
  readonly extensionOutDir: string;
  /** A CG_TEST_HOSTS=1 build (the chunks are the same; kept for the build's symmetry). */
  readonly testBuild: boolean;
}

export function createLazyConfig(options: LazyBuildOptions): InlineConfig {
  const entries: Record<string, string> = { ...LAZY_ENTRIES };
  return {
    configFile: false,
    root: LAZY_ROOT,
    mode: 'production',
    logLevel: 'warn',
    publicDir: false,
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    build: {
      outDir: join(options.extensionOutDir, LAZY_DIR),
      emptyOutDir: true,
      target: 'firefox142',
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      // No preload helper: these modules run in a content script, not a page.
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, resolve(LAZY_ROOT, file)])),
        preserveEntrySignatures: 'exports-only',
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
}

function describeOutput(output: Rolldown.RolldownOutput): LazyChunkInfo[] {
  return output.output.map((item) => {
    const file = `${LAZY_DIR}/${item.fileName}`;
    if (item.type === 'asset') return { file, kind: 'asset', name: null, imports: [] };
    return {
      file,
      kind: item.isEntry ? 'entry' : 'chunk',
      name: item.isEntry ? item.name : null,
      imports: item.imports.map((imported) => `${LAZY_DIR}/${imported}`),
    };
  });
}

/**
 * Builds the lazy chunks into `<extensionOutDir>/lazy/` and writes the chunk
 * graph next to the extension dir (`<extensionOutDir>.lazy-chunks.json`,
 * outside the XPI) for tools/size-budget. Returns the chunk list.
 */
export async function buildLazyChunks(extensionOutDir: string, testBuild: boolean): Promise<LazyChunkInfo[]> {
  const result = await build(createLazyConfig({ extensionOutDir, testBuild }));
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const chunks = outputs.flatMap(describeOutput);
  await writeFile(`${extensionOutDir}.lazy-chunks.json`, `${JSON.stringify(chunks, null, 2)}\n`);
  return chunks;
}

export default defineConfig(() =>
  createLazyConfig({ extensionOutDir: resolve(LAZY_ROOT, '../.output/lazy-standalone'), testBuild: process.env['CG_TEST_HOSTS'] === '1' }),
);
