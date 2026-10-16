// What the background bundles may hold (docs/project-unite/architecture.md
// §3.3, §1.8), checked on what the bundler kept — after tree-shaking — so a
// barrel or a re-export cannot carry a module in unseen.
// - The core (`background.js`) holds nothing only one site needs: no site's
//   chunk, no fan custody of ChatSpace (core/services/custody), no Fansly
//   code. dependency-cruiser holds the import graph to the same list
//   (`background-core-graph`); this holds the file.
// - A site's chunk (`bg/<site>.js`) holds no second owner of what the core
//   owns — the hub layer and its SDK, the browser API, the settings, the
//   operations, the action tokens, the results, telemetry, the logs, the
//   journal of human sends, the core's composition. It gets them as ports of
//   the kit.

import type { Plugin } from 'vite';

/** Modules only a site's background needs: never in the core's file. */
export const SITE_ONLY_MODULES: readonly RegExp[] = [
  /\/apps\/extension\/bg\//,
  /\/packages\/core\/src\/services\/(?:custody|send-coordinator|send-journal|send-fuse|greeting-leases)\.ts$/,
  /\/hosts\/fansly(?:\/|\.ts$)/,
  /\/packages\/fansly-api\//,
  /\/packages\/contracts\/src\/(?:.+\/)?[^/]*fansly[^/]*\.ts$/,
];

/** Modules the core owns: never in a site's chunk. */
export const CORE_OWNED_MODULES: readonly RegExp[] = [
  /\/packages\/hub\//,
  /\/vendor\/kernel-sdk\//,
  /\/packages\/platform\//,
  /\/packages\/core\/src\/services\/(?:settings-owner|scheduler|tokens|results-store|native-send|presence|consent|profile-saver|ws-tap)\.ts$/,
  /\/packages\/core\/src\/services\/(?:logs|telemetry|diagnostics|sound)\//,
  /\/apps\/extension\/src\/(?:entrypoints|composition)\/(?!background\/host-module\.ts$)/,
];

/** The modules of a bundle that match one of `patterns` and kept code (a module tree-shaking emptied is not there). */
export function modulesMatching(modules: Readonly<Record<string, { readonly renderedLength: number }>>, patterns: readonly RegExp[]): string[] {
  return Object.entries(modules)
    .filter(([id, module]) => module.renderedLength > 0 && patterns.some((pattern) => pattern.test(id.replaceAll('\\', '/'))))
    .map(([id]) => id)
    .sort();
}

/** The WXT build of the event page fails when background.js would hold a module only a site needs. */
export function backgroundCorePlugin(): Plugin {
  return {
    name: 'cg-background-core',
    transform: {
      filter: { id: /\/vendor\/kernel-sdk\/dist\/shared\/ofapi-read-catalog\.js$/ },
      // The SDK barrel re-exports this catalog, whose top-level calls only
      // populate its own exported array. No extension code uses that array:
      // let the bundler drop the module without changing the vendored SDK.
      handler(code) {
        return { code, moduleSideEffects: false };
      },
    },
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        const found = modulesMatching(item.modules, SITE_ONLY_MODULES);
        if (found.length > 0) this.error(`${item.fileName} is the background core and must not hold what only one site needs (architecture §3.3): ${found.join(', ')}`);
      }
    },
  };
}
