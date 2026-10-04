// Second Vite build: lazy ESM content-script chunks (architecture.md §3, D-02).
//
// WXT bundles each content script into one classic (IIFE) file and cannot emit
// ES-module content scripts. The UI therefore lives in ES modules built here
// and loaded by the isolated content script with
//   import(browser.runtime.getURL('lazy/<entry>.js'))
// All entries share chunks (Preact is loaded once). Every emitted file is
// listed in web_accessible_resources by build/manifest.ts — nothing else is.
//
// How the code is cut into files. A tab loads the entries in a fixed order
// (composition/tab): the bridge's schemas with the first frame from MAIN, the
// protocol registry and the application with the first composer, then the
// dock with the AI and the navigation controllers, and everything else when
// it is first needed. The entries of LAZY_LAYERS are that always-loaded base, and
// each of them is ONE layer of code: a module lands in the chunk of the first
// layer that needs it, so a later entry imports what is already in memory
// instead of carrying its own copy, and nothing is cut into a dozen small
// files that compress worse than one (the dock alone lost 3.4 KiB that way).
// What the dock shares with the protocol or the application is the `kernel`
// chunk, so the dock never pulls the schemas in and they never pull Preact.
// The other entries are cut by the bundler itself. tools/size-budget measures
// each layer on top of the ones before it (§11).
//
// wxt.config.ts runs buildLazyChunks() inside the WXT build (after WXT cleans
// the output dir); `vite build -c lazy/vite.config.ts` builds standalone into
// .output/lazy-standalone for inspection (without the layers).

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, defineConfig, type InlineConfig, type Rolldown } from 'vite';

import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS, type LazyEntryName } from './entries/names.ts';

export { LAZY_ENTRIES, LAZY_LAYERS, type LazyEntryName };

const LAZY_ROOT = dirname(fileURLToPath(import.meta.url));

/** Folder inside the extension output that holds every lazy file. */
export const LAZY_DIR = 'lazy';

export interface LazyChunkInfo {
  /** Path inside the extension, e.g. lazy/dock.js. */
  readonly file: string;
  readonly kind: 'entry' | 'chunk' | 'asset';
  readonly name: string | null;
  /** Static imports (extension paths) — what loads together with this file. */
  readonly imports: readonly string[];
  /** An entry of LAZY_LAYERS: its place in that order. Absent — loaded on demand, after all of them. */
  readonly layer?: number;
}

export interface LazyBuildOptions {
  readonly extensionOutDir: string;
  /** A CG_TEST_HOSTS=1 build (the chunks are the same; kept for the build's symmetry). */
  readonly testBuild: boolean;
  /** Module id → the chunk of its layer (see layerPlan); absent — the bundler cuts everything by itself. */
  readonly layers?: ReadonlyMap<string, string>;
}

const inputOf = (names: readonly LazyEntryName[]): Record<string, string> => Object.fromEntries(names.map((name) => [name, resolve(LAZY_ROOT, LAZY_ENTRIES[name])]));

export function createLazyConfig(options: LazyBuildOptions, entries: readonly LazyEntryName[] = Object.keys(LAZY_ENTRIES) as LazyEntryName[]): InlineConfig {
  const layers = options.layers;
  const names = layers === undefined ? [] : [...new Set(layers.values())];
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
        input: inputOf(entries),
        // With the layers a shared module may sit in an entry's own file, which then exports it too: the tab reads
        // the exports it names and nothing else.
        preserveEntrySignatures: layers === undefined ? 'exports-only' : 'allow-extension',
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          ...(layers === undefined
            ? {}
            : {
                codeSplitting: {
                  // One chunk per layer; a module belongs to exactly one, so the order of the groups decides nothing.
                  // Only the modules of the plan: a group that took its modules' dependencies along would take what
                  // tree-shaking had dropped for that layer — the dock would get the schemas of every contracts
                  // module it reads a constant of. The plan is closed under what each layer really keeps.
                  groups: names.map((name) => ({ name, test: (id: string): boolean => layers.get(id) === name, includeDependenciesRecursively: false })),
                },
              }),
        },
      },
    },
  };
}

const chunksOf = (result: Awaited<ReturnType<typeof build>>): Rolldown.OutputChunk[] =>
  ((Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]).flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');

/** Name of the chunk two parallel layers share (the dock and the application base): neither pulls the other in. */
export const KERNEL_CHUNK = 'kernel';

/**
 * Which layer each module of the always-loaded base belongs to. A first build
 * of only those entries tells what each of them really keeps after
 * tree-shaking; a module the dock shares with the protocol or the
 * application goes to the kernel, every other module to the first layer
 * that has it.
 */
export async function layerPlan(options: Pick<LazyBuildOptions, 'testBuild'>): Promise<Map<string, string>> {
  const config = createLazyConfig({ extensionOutDir: resolve(LAZY_ROOT, '../.output/lazy-plan'), testBuild: options.testBuild }, LAZY_LAYERS);
  const chunks = chunksOf(await build({ ...config, logLevel: 'error', build: { ...config.build, write: false } }));
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const modulesOf = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const modules = new Set<string>();
    const visit = (file: string): void => {
      const chunk = byFile.get(file);
      if (chunk === undefined || seen.has(file)) return;
      seen.add(file);
      for (const [id, module] of Object.entries(chunk.modules)) if (module.renderedLength > 0) modules.add(id);
      for (const imported of chunk.imports) visit(imported);
    };
    visit(`${entry}.js`);
    return modules;
  };
  const kept = new Map(LAZY_LAYERS.map((layer) => [layer, modulesOf(layer)]));
  const dock = kept.get('dock') ?? new Set<string>();
  const plan = new Map<string, string>();
  for (const layer of LAZY_LAYERS) {
    for (const id of kept.get(layer) ?? []) {
      if (plan.has(id)) {
        // Shared by the dock and a later layer of the base: neither chunk may import the other.
        if (dock.has(id) && BEFORE_THE_DOCK.includes(layer)) plan.set(id, KERNEL_CHUNK);
        continue;
      }
      plan.set(id, layer);
    }
  }
  return plan;
}

function describeOutput(chunks: readonly Rolldown.OutputChunk[]): LazyChunkInfo[] {
  return chunks.map((item) => {
    const layer = item.isEntry ? (LAZY_LAYERS as readonly string[]).indexOf(item.name) : -1;
    return {
      file: `${LAZY_DIR}/${item.fileName}`,
      kind: item.isEntry ? 'entry' : 'chunk',
      name: item.isEntry ? item.name : null,
      imports: item.imports.map((imported) => `${LAZY_DIR}/${imported}`),
      ...(layer < 0 ? {} : { layer }),
    };
  });
}

/**
 * Builds the lazy chunks into `<extensionOutDir>/lazy/` and writes the chunk
 * graph next to the extension dir (`<extensionOutDir>.lazy-chunks.json`,
 * outside the XPI) for tools/size-budget. Returns the chunk list.
 */
export async function buildLazyChunks(extensionOutDir: string, testBuild: boolean): Promise<LazyChunkInfo[]> {
  const layers = await layerPlan({ testBuild });
  const result = await build(createLazyConfig({ extensionOutDir, testBuild, layers }));
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets: LazyChunkInfo[] = outputs.flatMap((output) => output.output).flatMap((item) => (item.type === 'asset' ? [{ file: `${LAZY_DIR}/${item.fileName}`, kind: 'asset' as const, name: null, imports: [] }] : []));
  const chunks = [...describeOutput(chunksOf(result)), ...assets];
  await writeFile(`${extensionOutDir}.lazy-chunks.json`, `${JSON.stringify(chunks, null, 2)}\n`);
  return chunks;
}

export default defineConfig(() =>
  createLazyConfig({ extensionOutDir: resolve(LAZY_ROOT, '../.output/lazy-standalone'), testBuild: process.env['CG_TEST_HOSTS'] === '1' }),
);
