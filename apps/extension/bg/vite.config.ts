// The sites' background chunks: a Vite build of their own (docs/project-unite/
// architecture.md §3.3; spike.md п. 1). WXT builds the event page as one
// classic (IIFE) file; a site's background module is an ES module built here,
// one file per site — `bg/<site>.js` — and loaded by the background core with
//   import(runtime.getURL('bg/<site>.js'))
// which Firefox takes from a classic event page (WXT leaves the call as it is).
// A module background (`background.type: "module"`) was rejected: WXT builds
// it in one group with the extension pages, so the core would stop being one
// file of its own.
//
// Each site is its own build of one entry with no splitting: a site's chunk
// shares nothing with another's, so code only one site has never moves the
// bytes of the other (architecture.md §3.2), and what a chunk shares with the
// core it carries itself (the core never imports a chunk). The files are not
// web-accessible: only the event page loads them (build/manifest.ts exposes
// the lazy chunks alone).
//
// wxt.config.ts runs buildBackgroundChunks() inside the WXT build (after WXT
// cleans the output dir); `vite build -c bg/vite.config.ts` builds ChatSpace's
// alone into .output/bg-standalone for inspection.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, defineConfig, type InlineConfig, type Rolldown } from 'vite';

import { CORE_OWNED_MODULES, modulesMatching } from '../build/background-bundles.ts';
import { HOSTS, type HostBackground, type HostDescriptor } from '../src/hosts/index.ts';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface BackgroundChunkInfo {
  readonly host: HostDescriptor['kind'];
  /** Path inside the extension, e.g. bg/chatspace.js. */
  readonly file: string;
}

export function createBackgroundChunkConfig(background: HostBackground, options: { readonly extensionOutDir: string; readonly testBuild: boolean }): InlineConfig {
  const file = background.file;
  return {
    configFile: false,
    root: APP_ROOT,
    mode: 'production',
    logLevel: 'warn',
    publicDir: false,
    // The test build's loopback hosts and probes stay out of a release chunk, as they do out of the core.
    define: { __CG_TEST_HOSTS__: JSON.stringify(options.testBuild) },
    build: {
      outDir: join(options.extensionOutDir, dirname(file)),
      // Every site's build writes its own file into the one folder (WXT emptied the output dir before).
      emptyOutDir: false,
      target: 'firefox142',
      minify: true,
      sourcemap: false,
      reportCompressedSize: false,
      modulePreload: false,
      copyPublicDir: false,
      rolldownOptions: {
        input: { [file.slice(dirname(file).length + 1).replace(/\.js$/, '')]: resolve(APP_ROOT, background.source) },
        // The module's default export is what the core reads.
        preserveEntrySignatures: 'exports-only',
        output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' },
      },
    },
  };
}

const chunksOf = (result: Awaited<ReturnType<typeof build>>): Rolldown.OutputChunk[] =>
  ((Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]).flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');

/**
 * Builds each site's background chunk into `<extensionOutDir>/bg/`. A site's build must make exactly its one file —
 * a second file would be a chunk the core never loads — and hold no module the core owns (build/background-bundles.ts).
 */
export async function buildBackgroundChunks(extensionOutDir: string, testBuild: boolean, hosts: readonly HostDescriptor[] = HOSTS): Promise<BackgroundChunkInfo[]> {
  const built: BackgroundChunkInfo[] = [];
  for (const host of hosts) {
    if (host.background === undefined) continue;
    const chunks = chunksOf(await build(createBackgroundChunkConfig(host.background, { extensionOutDir, testBuild })));
    const files = chunks.map((chunk) => join(dirname(host.background?.file ?? ''), chunk.fileName));
    if (files.length !== 1 || files[0] !== host.background.file) throw new Error(`bg/vite.config.ts: ${host.kind} must build to ${host.background.file} alone, got ${files.join(', ')}`);
    const owned = chunks.flatMap((chunk) => modulesMatching(chunk.modules, CORE_OWNED_MODULES));
    if (owned.length > 0) throw new Error(`bg/vite.config.ts: ${host.background.file} holds what the core owns — it comes through the kit (architecture §3.3): ${owned.join(', ')}`);
    built.push({ host: host.kind, file: host.background.file });
  }
  return built;
}

export default defineConfig(() => {
  const chatspace = HOSTS.find((host) => host.kind === 'chatspace')?.background;
  if (chatspace === undefined) throw new Error('bg/vite.config.ts: ChatSpace has no background chunk in the host registry');
  return createBackgroundChunkConfig(chatspace, { extensionOutDir: resolve(APP_ROOT, '.output/bg-standalone'), testBuild: process.env['CG_TEST_HOSTS'] === '1' });
});
