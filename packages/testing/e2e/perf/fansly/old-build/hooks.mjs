// Preloaded (`node --import`) into the process that runs the old Fansly
// extension's own build script (its esbuild.config.mjs, unchanged): that
// script's `import 'esbuild'` gets esbuild-shim.mjs, which is the same esbuild
// of the old checkout with the stand rules added (build.ts, R20 P3d). Nothing
// else is redirected.

import { registerHooks } from 'node:module';
import { URL } from 'node:url';

const SHIM = new URL('./esbuild-shim.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'esbuild' && context.parentURL?.endsWith('/esbuild.config.mjs')) return { url: SHIM, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
