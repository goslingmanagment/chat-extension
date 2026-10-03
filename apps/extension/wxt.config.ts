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
import { baseManifest, finalizeManifest, type BuildFlavor, type ManifestLike } from './build/manifest.ts';
import { buildLazyChunks, type LazyChunkInfo } from './lazy/vite.config.ts';

const flavor: BuildFlavor = process.env['CG_TEST_HOSTS'] === '1' ? 'test' : 'release';
const suffix = flavor === 'test' ? '-test' : '';
const artifacts = artifactNames('{{version}}', flavor);
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
    // AMO needs the whole workspace to rebuild; the test build is never signed.
    zipSources: flavor === 'release',
    sourcesRoot: repoRoot,
    excludeSources: ['docs/**', 'AGENTS.md', '**/.output/**', '**/.wxt/**', '**/.tsbuild/**', '**/coverage/**', '**/*.tsbuildinfo'],
  },
});
