// Builds the MAIN prototype the way WXT builds a MAIN entry (Vite, IIFE, minified, target firefox142) twice:
// `fansly-main.js` without the spike hooks (the size that counts) and `fansly-main.spike.js` with them (for the
// browser runs). Prints raw and gzip -9 sizes. Usage: node spike/main-proto/build.mjs [outDir]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(here, '../../../../.cache/spike'));

export async function buildMainProto(dir = outDir) {
  const sizes = {};
  for (const [file, spike] of [
    ['fansly-main.js', false],
    ['fansly-main.spike.js', true],
  ]) {
    await build({
      configFile: false,
      logLevel: 'warn',
      define: { __SPIKE__: JSON.stringify(spike) },
      build: {
        target: 'firefox142',
        minify: true,
        emptyOutDir: false,
        outDir: dir,
        lib: { entry: resolve(here, 'index.ts'), formats: ['iife'], name: 'cgMain', fileName: () => file },
        rollupOptions: { output: { extend: true } },
      },
    });
    const raw = readFileSync(resolve(dir, file));
    sizes[file] = { raw: raw.byteLength, gzip9: gzipSync(raw, { level: 9 }).byteLength };
  }
  return sizes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await buildMainProto(), null, 2));
}
