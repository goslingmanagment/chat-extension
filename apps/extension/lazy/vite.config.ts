// Second Vite build: lazy ESM content-script chunks (architecture.md §3, D-02).
//
// WXT bundles each content script into one classic (IIFE) file and cannot emit
// ES-module content scripts. The UI therefore lives in ES modules built here
// and loaded by the isolated content script with
//   import(browser.runtime.getURL('lazy/<site>/<entry>.js'))
//
// Each site has its own build (docs/project-unite/architecture.md §3.2; the
// host registry's `lazy`, apps/extension/src/hosts): its entries, its plan of
// layers, its folder `lazy/<site>/`, its own web_accessible_resources entry
// for its own pages (build/manifest.ts). The sites share source, never a
// build: an entry of one site would shift how the shared modules are cut and
// move bytes of the other's chunks, so another site's entries never enter a
// site's build. The price is the shared source once per site in the XPI; a
// tab loads its own site's files only. Within a build all entries share chunks
// (Preact is loaded once).
//
// How a site's build is cut into files (ChatSpace's plan). A tab loads the
// entries in a fixed order (composition/tab): the bridge's schemas with the
// first frame from MAIN, the protocol registry and the application with the
// first composer, then the dock with the AI and the navigation controllers,
// and everything else when it is first needed. The site's layers are that
// always-loaded base, and each of them is ONE layer of code: a module lands in
// the chunk of the first layer that needs it, so a later entry imports what is
// already in memory instead of carrying its own copy, and nothing is cut into
// a dozen small files that compress worse than one (the dock alone lost
// 3.4 KiB that way). What the dock shares with the protocol or the application
// is the `kernel` chunk, so the dock never pulls the schemas in and they never
// pull Preact. The other entries are cut by the bundler itself. A build
// without layers is cut by the bundler alone.
//
// wxt.config.ts runs buildLazyChunks() inside the WXT build (after WXT cleans
// the output dir); `vite build -c lazy/vite.config.ts` builds ChatSpace's
// standalone into .output/lazy-standalone for inspection (without the layers).

import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build as vite, defineConfig, type InlineConfig, type PluginOption, type Rolldown } from 'vite';

import { HOSTS, lazySitesOf, type HostLazyBuild, type LazySite } from '../src/hosts/index.ts';
import { LAZY_ENTRIES, LAZY_LAYERS, type LazyEntryName } from './entries/names.ts';

export { LAZY_ENTRIES, LAZY_LAYERS, type LazyEntryName };

const LAZY_ROOT = dirname(fileURLToPath(import.meta.url));

/** Folder inside the extension output that holds every site's lazy build (`lazy/<site>/`). */
export const LAZY_DIR = 'lazy';

export interface LazyChunkInfo {
  /** Path inside the extension, e.g. lazy/chatspace/dock.js. */
  readonly file: string;
  readonly kind: 'entry' | 'chunk' | 'asset';
  readonly name: string | null;
  /** Static imports (extension paths) — what loads together with this file. */
  readonly imports: readonly string[];
  /** An entry of its site's layers: its place in that order. Absent — loaded on demand, after all of them. */
  readonly layer?: number;
  /** The lazy build it belongs to (LazySite.site). */
  readonly site: string;
}

export interface LazyBuildOptions {
  readonly extensionOutDir: string;
  /** Compile out stand-only ports in the release, as the background build does. */
  readonly testBuild?: boolean;
  /** Module id → the chunk of its layer (see layerPlan); absent — the bundler cuts everything by itself. */
  readonly layers?: ReadonlyMap<string, string>;
  /** Plugins of a test of the build (test/feature-slices.test.ts rewrites one source for one build); the extension passes none. */
  readonly plugins?: readonly PluginOption[];
}

const inputOf = (build: HostLazyBuild, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    names.map((name) => {
      const source = build.entries[name];
      if (source === undefined) throw new Error(`lazy build ${build.root}: no entry ${name}`);
      return [name, resolve(LAZY_ROOT, source)];
    }),
  );

/** One site's build: its entries (all of them by default), into `<extensionOutDir>/<root>/`. */
export function createLazyConfig(build: HostLazyBuild, options: LazyBuildOptions, entries: readonly string[] = Object.keys(build.entries)): InlineConfig {
  const layers = options.layers;
  const names = layers === undefined ? [] : [...new Set(layers.values())];
  return {
    configFile: false,
    root: LAZY_ROOT,
    mode: 'production',
    define: { __CG_TEST_HOSTS__: JSON.stringify(options.testBuild ?? false) },
    logLevel: 'warn',
    publicDir: false,
    ...(options.plugins === undefined ? {} : { plugins: [...options.plugins] }),
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    build: {
      outDir: join(options.extensionOutDir, build.root),
      emptyOutDir: true,
      target: 'firefox142',
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      // No preload helper: these modules run in a content script, not a page.
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: inputOf(build, entries),
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

const chunksOf = (result: Awaited<ReturnType<typeof vite>>): Rolldown.OutputChunk[] =>
  ((Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]).flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');

/** Name of the chunk two parallel layers share (the dock and the application base): neither pulls the other in. */
export const KERNEL_CHUNK = 'kernel';

/**
 * Which layer each module of a site's always-loaded base belongs to. A first
 * build of only those entries tells what each of them really keeps after
 * tree-shaking; a module the dock (the first layer) shares with a layer that
 * loads before it or without it goes to the kernel, every other module to the
 * first layer that has it. undefined — the site has no layers.
 */
export async function layerPlan(build: HostLazyBuild, plugins?: readonly PluginOption[], testBuild = false): Promise<Map<string, string> | undefined> {
  const [dockLayer] = build.layers;
  if (dockLayer === undefined) return undefined;
  const config = createLazyConfig(build, { extensionOutDir: resolve(LAZY_ROOT, '../.output/lazy-plan'), testBuild, ...(plugins === undefined ? {} : { plugins }) }, build.layers);
  const chunks = chunksOf(await vite({ ...config, logLevel: 'error', build: { ...config.build, write: false } }));
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
  const kept = new Map(build.layers.map((layer) => [layer, modulesOf(layer)]));
  const dock = kept.get(dockLayer) ?? new Set<string>();
  const plan = new Map<string, string>();
  for (const layer of build.layers) {
    for (const id of kept.get(layer) ?? []) {
      if (plan.has(id)) {
        // Shared by the dock and a later layer of the base: neither chunk may import the other.
        if (dock.has(id) && build.beforeTheDock.includes(layer)) plan.set(id, KERNEL_CHUNK);
        continue;
      }
      plan.set(id, layer);
    }
  }
  return plan;
}

function describeOutput(chunks: readonly Rolldown.OutputChunk[], site: LazySite): LazyChunkInfo[] {
  const root = site.build.root;
  return chunks.map((item) => {
    const layer = item.isEntry ? site.build.layers.indexOf(item.name) : -1;
    return {
      file: `${root}/${item.fileName}`,
      kind: item.isEntry ? 'entry' : 'chunk',
      name: item.isEntry ? item.name : null,
      imports: item.imports.map((imported) => `${root}/${imported}`),
      ...(layer < 0 ? {} : { layer }),
      site: site.site,
    };
  });
}

/** One site's build into `<extensionOutDir>/<root>/`, cut by its plan. Returns its files. `plugins` — a test's own (LazyBuildOptions). */
export async function buildLazySite(extensionOutDir: string, site: LazySite, plugins?: readonly PluginOption[], testBuild = false): Promise<LazyChunkInfo[]> {
  const layers = await layerPlan(site.build, plugins, testBuild);
  const result = await vite(createLazyConfig(site.build, { extensionOutDir, testBuild, ...(layers === undefined ? {} : { layers }), ...(plugins === undefined ? {} : { plugins }) }));
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
  const assets: LazyChunkInfo[] = outputs
    .flatMap((output) => output.output)
    .flatMap((item) => (item.type === 'asset' ? [{ file: `${site.build.root}/${item.fileName}`, kind: 'asset' as const, name: null, imports: [], site: site.site }] : []));
  return [...describeOutput(chunksOf(result), site), ...assets];
}

/**
 * Builds every site's lazy chunks, one site after the other, each into
 * `<extensionOutDir>/<root>/`, and writes the chunk graph next to the
 * extension dir (`<extensionOutDir>.lazy-chunks.json`, outside the XPI) for
 * whoever inspects the build. Returns the chunk list.
 */
export async function buildLazyChunks(extensionOutDir: string, sites: readonly LazySite[], testBuild = false): Promise<LazyChunkInfo[]> {
  const roots = sites.map((site) => site.build.root);
  for (const root of roots) {
    if (!root.startsWith(`${LAZY_DIR}/`) || roots.some((other) => other !== root && (other.startsWith(`${root}/`) || root.startsWith(`${other}/`)))) {
      throw new Error(`lazy build root ${root}: each site's build is its own folder under ${LAZY_DIR}/`);
    }
  }
  if (new Set(roots).size !== roots.length) throw new Error(`lazy builds share a folder: ${roots.join(', ')}`);
  const chunks: LazyChunkInfo[] = [];
  for (const site of sites) chunks.push(...(await buildLazySite(extensionOutDir, site, undefined, testBuild)));
  await writeFile(`${extensionOutDir}.lazy-chunks.json`, `${JSON.stringify(chunks, null, 2)}\n`);
  return chunks;
}

const [first] = lazySitesOf(false, HOSTS);
if (first === undefined) throw new Error('lazy/vite.config.ts: the host registry has no site');

export default defineConfig(() => createLazyConfig(first.build, { extensionOutDir: resolve(LAZY_ROOT, '../.output/lazy-standalone') }));
