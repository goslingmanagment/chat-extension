// WXT config (architecture.md §3, D-01, D-02): Firefox only, MV3 explicitly,
// event-page background. `CG_TEST_HOSTS=1` makes a TEST build that also
// matches the loopback stand and the fake hub; it goes to its own output dir
// and never into a release artifact (build/manifest.ts checks both flavors).

import { resolve } from 'node:path';

import { defineConfig } from 'wxt';

import { baseManifest, finalizeManifest, type BuildFlavor, type ManifestLike } from './build/manifest.ts';
import { buildLazyChunks, type LazyChunkInfo } from './lazy/vite.config.ts';

const flavor: BuildFlavor = process.env['CG_TEST_HOSTS'] === '1' ? 'test' : 'release';
const suffix = flavor === 'test' ? '-test' : '';
const repoRoot = resolve(import.meta.dirname, '../..');

let lazyChunks: LazyChunkInfo[] = [];

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
  }),
  hooks: {
    // After WXT cleaned the output dir, before entry points are built.
    'entrypoints:grouped': async (wxt) => {
      lazyChunks = await buildLazyChunks(wxt.config.outDir, flavor === 'test');
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      finalizeManifest(manifest as ManifestLike, { flavor, lazyFiles: lazyChunks.map((chunk) => chunk.file) });
    },
  },
  zip: {
    artifactTemplate: `chatgoose-chatspace-{{version}}-firefox${suffix}.zip`,
    sourcesTemplate: `chatgoose-chatspace-{{version}}-sources${suffix}.zip`,
    // AMO needs the whole workspace to rebuild; the test build is never signed.
    zipSources: flavor === 'release',
    sourcesRoot: repoRoot,
    excludeSources: ['docs/**', 'AGENTS.md', '**/.output/**', '**/.wxt/**', '**/.tsbuild/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },
});
