// WXT config (architecture.md §3, D-01, D-02): Firefox only, MV3 explicitly,
// event-page background. `CG_TEST_HOSTS=1` makes a TEST build that also
// matches the loopback stand and the fake hub; it goes to its own output dir
// and never into a release artifact (build/manifest.ts checks both flavors).
//
// `pnpm build` runs `wxt zip apps/extension` FROM THE REPO ROOT: WXT prints the
// sources-archive listing by stat()ing repo-root-relative paths against the
// current directory, so from apps/extension it warned «Could not get stats» for
// every file (~210 lines; the archive itself was fine).

import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { defineConfig } from 'wxt';

import { artifactNames, isFlavorArtifact } from './build/artifacts.ts';
import { backgroundCorePlugin } from './build/background-bundles.ts';
import { bundleTimingPlugin } from './build/bundle-timing.ts';
import { isolatedEntryPlugin } from './build/isolated-entry.ts';
import { mainWorldEntryPlugin } from './build/main-world-entry.ts';
import { baseManifest, finalizeManifest, type BuildFlavor, type ManifestLike } from './build/manifest.ts';
import { PAGE_ENTRY_NAMES, splitPageChunks, type PageBuildConfig } from './build/page-chunks.ts';
import { SOURCE_DOTFILES, STAND_SOURCE_GLOBS } from './build/sources-archive.ts';
import { buildBackgroundChunks } from './bg/vite.config.ts';
import { buildLazyChunks, type LazyChunkInfo } from './lazy/vite.config.ts';
import { HOSTS, scriptsOf } from './src/hosts/index.ts';

const flavor: BuildFlavor = process.env['CG_TEST_HOSTS'] === '1' ? 'test' : 'release';
const suffix = flavor === 'test' ? '-test' : '';
const artifacts = artifactNames('{{version}}', flavor);
const repoRoot = resolve(import.meta.dirname, '../..');

let lazyChunks: LazyChunkInfo[] = [];
// The sites' entry points, from the host registry (src/hosts).
/** The entry points that run in the page's own world (ChatSpace: chatspace-main, the bridge; chatspace-ws, the WS tap). */
const MAIN_WORLD_ENTRY_NAMES = HOSTS.flatMap((host) => scriptsOf(host).filter((script) => script.world === 'MAIN').map((script) => script.entry));
/** Each site's MAIN script at document_start: a TEST build's one also carries the sentry-gate e2e's positive control. */
const BRIDGE_ENTRY_NAMES = HOSTS.map((host) => host.scripts.main.entry);
/** Each site's isolated early bootstrap. */
const ISOLATED_ENTRY_NAMES = HOSTS.map((host) => host.scripts.isolated.entry);

export default defineConfig({
  srcDir: 'src',
  // CG_WXT_OUT_DIR: the manifest test builds into a temp dir.
  outDir: process.env['CG_WXT_OUT_DIR'] ?? '.output',
  outDirTemplate: `{{browser}}-mv{{manifestVersion}}${suffix}`,
  browser: 'firefox',
  targetBrowsers: ['firefox'],
  manifestVersion: 3,
  imports: false,
  manifest: baseManifest(flavor),
  vite: () => ({
    define: { __CG_TEST_HOSTS__: JSON.stringify(flavor === 'test') },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    build: { target: 'firefox142', sourcemap: false },
    // WXT imports each entry point in Node (its `inline` environment) to read
    // its options. Node cannot resolve the extensionless ESM imports of the
    // vendored packages, so the first import of `@cg/hub` (the SDK) or of
    // `@cg/core/domain` (the hotkey scheme) from an entry point failed
    // `wxt build`; inline both there instead of loading them natively.
    environments: { inline: { resolve: { noExternal: ['@kernel/sdk', '@chatgoose/hotkeys'] } } },
  }),
  hooks: {
    // After WXT cleaned the output dir, before entry points are built.
    'entrypoints:grouped': async (wxt) => {
      lazyChunks = await buildLazyChunks(wxt.config.outDir, flavor === 'test');
      // The sites' background chunks (bg/<site>.js): only the event page loads them, so they are no web resource.
      await buildBackgroundChunks(wxt.config.outDir, flavor === 'test');
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      finalizeManifest(manifest as ManifestLike, { flavor, lazyFiles: lazyChunks.map((chunk) => chunk.file) });
    },
    // Timing marks around both content scripts (test builds only): the e2e
    // reads the whole synchronous start of the isolated bundle (§11: ≤ 3 ms)
    // and of the MAIN bundle at document_start (X11: ≤ 1 ms).
    'vite:build:extendConfig': (entrypoints, config) => {
      // The extension pages: their one shared bundle is cut into three files (build/page-chunks.ts).
      if (entrypoints.some((entry) => PAGE_ENTRY_NAMES.includes(entry.name))) splitPageChunks(config as PageBuildConfig);
      // The background core holds nothing only one site needs (build/background-bundles.ts; architecture §3.3).
      if (entrypoints.some((entry) => entry.name === 'background')) config.plugins = [...(config.plugins ?? []), backgroundCorePlugin()];
      // The MAIN-world scripts start without WXT's entry wrapper, which rethrows into the page (build/main-world-entry.ts).
      // A TEST build's bridge also carries the sentry-gate e2e's positive control (loopback only).
      const mainWorld = entrypoints.filter((entry) => MAIN_WORLD_ENTRY_NAMES.includes(entry.name));
      const pathOf = (entry: { readonly inputPath: string }): string => entry.inputPath.replaceAll('\\', '/');
      const bridge = mainWorld.find((entry) => BRIDGE_ENTRY_NAMES.includes(entry.name));
      if (mainWorld.length > 0) config.plugins = [...(config.plugins ?? []), mainWorldEntryPlugin(mainWorld.map(pathOf), flavor === 'test' && bridge !== undefined ? { probe: pathOf(bridge) } : {})];
      // A site's isolated script starts without WXT's wrapper and its ContentScriptContext, which touches the
      // extension API in the synchronous start and posts an event naming us to the page (build/isolated-entry.ts).
      const isolated = entrypoints.find((entry) => ISOLATED_ENTRY_NAMES.includes(entry.name));
      if (isolated !== undefined) config.plugins = [...(config.plugins ?? []), isolatedEntryPlugin(pathOf(isolated))];
      if (flavor !== 'test' || !entrypoints.some((entry) => ISOLATED_ENTRY_NAMES.includes(entry.name) || BRIDGE_ENTRY_NAMES.includes(entry.name))) return;
      config.plugins = [...(config.plugins ?? []), bundleTimingPlugin()];
    },
    // WXT never deletes older versions' archives. Drop this flavor's before
    // zipping, so .output/ holds exactly the archives of this build.
    'zip:start': async (wxt) => {
      const dir = wxt.config.outBaseDir;
      for (const name of await readdir(dir)) {
        if (isFlavorArtifact(name, flavor)) await rm(join(dir, name));
      }
    },
  },
  zip: {
    artifactTemplate: artifacts.xpi,
    sourcesTemplate: artifacts.sources,
    // AMO needs the workspace to rebuild the XPI; the test build is never signed.
    // The ChatSpace-like stand (R02) and its e2e harness are not needed for that
    // and stay out; three tool dotfiles WXT would skip go in
    // (build/sources-archive.ts; tools/archive-check checks both).
    zipSources: flavor === 'release',
    sourcesRoot: repoRoot,
    includeSources: ['**/*', ...SOURCE_DOTFILES],
    excludeSources: ['docs/**', 'AGENTS.md', '**/.output/**', '**/.wxt/**', '**/.tsbuild/**', '**/coverage/**', '**/*.tsbuildinfo', ...STAND_SOURCE_GLOBS],
  },
});
