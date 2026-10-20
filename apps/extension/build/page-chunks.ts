// How the bundle of the extension pages is cut into files (architecture.md
// §3, §9.9). The four pages — popup, options, debug-prompt, debug-journal —
// share one controller, one UI and one protocol, so the bundler puts all of
// it into a single chunk of over 500 KiB minified. The two heaviest parts
// that never change with the pages' own code get files of their own:
//
// - the texts: both catalogs, ru and en (a page switches its language on the
//   fly, I18-001, so it carries both);
// - the contracts and zod: the schemas every answer of the background is
//   checked with;
// - the brand: the two typefaces embedded as data and the drawings of the
//   logo and the goose (ui/pages/brand, generated from agency-site; X32).
//
// What is left — Preact, the kit, the pages and their controller — is the
// pages' own chunk. A page still loads all three; nothing is lazy here.
//
// Relative imports carry `.ts`: this file also runs under plain Node 26.

/** Entry points WXT builds together as the multi-page group. */
export const PAGE_ENTRY_NAMES: readonly string[] = ['popup', 'options', 'debug-prompt', 'debug-journal'];

export interface PageChunkGroup {
  readonly name: string;
  readonly test: (id: string) => boolean;
  /** Only the modules named: what a module depends on stays where the bundler put it. */
  readonly includeDependenciesRecursively: false;
}

const normalized = (id: string): string => id.replace(/\\/g, '/');

export const PAGE_CHUNK_GROUPS: readonly PageChunkGroup[] = [
  { name: 'page-texts', test: (id) => /\/packages\/core\/src\/domain\/i18n\/(?:ru|en)\.ts$/.test(normalized(id)), includeDependenciesRecursively: false },
  { name: 'page-contracts', test: (id) => /\/packages\/contracts\/src\/|\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?zod\//.test(normalized(id)), includeDependenciesRecursively: false },
  { name: 'page-brand', test: (id) => /\/packages\/ui\/src\/pages\/brand\//.test(normalized(id)), includeDependenciesRecursively: false },
];

/** The output options of one build: only the key this file sets. */
interface OutputLike {
  codeSplitting?: unknown;
  [key: string]: unknown;
}

/** A build config as the hook gets it: only the part this file touches. */
export interface PageBuildConfig {
  build?: { rolldownOptions?: { output?: unknown; [key: string]: unknown }; [key: string]: unknown } | undefined;
}

/**
 * Adds the chunk groups to the output options of the pages' build, in place;
 * every other option stays as WXT set it. Vite 8 reads `build.rolldownOptions`
 * (WXT's `rollupOptions` is merged into it before the hook runs).
 */
export function splitPageChunks(config: PageBuildConfig): void {
  const build = (config.build ??= {});
  const options = (build.rolldownOptions ??= {});
  if (Array.isArray(options.output)) throw new Error('page-chunks: the pages are built with one output, not a list');
  const output = (options.output ??= {}) as OutputLike;
  output.codeSplitting = { groups: [...PAGE_CHUNK_GROUPS] };
}
