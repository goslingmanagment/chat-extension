// ui/kit and the first dock chunk budget (architecture.md §11: ≤ 45 KiB gzip
// with Preact). The real dock (R14) is measured by tools/size-budget on the
// release build; this guard keeps the kit itself small enough to leave the
// dock room, and keeps zod (which the contracts' schema modules build at
// load) out of it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const KIT_INDEX = fileURLToPath(new URL('../../../ui/src/kit/index.ts', import.meta.url));
const KIB = 1024;
/** The whole kit with Preact, hooks and signals, nothing tree-shaken; the dock keeps the rest of the 45 KiB. */
const WHOLE_KIT_BUDGET = 34 * KIB;

async function bundle(entrySource: string): Promise<{ readonly gzip: number; readonly modules: readonly string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'cg-kit-size-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, entrySource);
    const result = await build({
      configFile: false,
      root: dir,
      mode: 'production',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      publicDir: false,
      // Vitest runs with NODE_ENV=test: without `development: false` JSX would carry its debug source info.
      oxc: { jsx: { runtime: 'automatic', importSource: 'preact', development: false } },
      build: {
        write: false,
        target: 'firefox142',
        minify: true,
        sourcemap: false,
        modulePreload: false,
        rolldownOptions: { input: { entry }, preserveEntrySignatures: 'exports-only', output: { format: 'es' } },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
    const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
    return {
      gzip: chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code, { level: 9 }).byteLength, 0),
      modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('[EX-009] ui/kit fits the first dock chunk (architecture.md §11)', () => {
  it(`the whole kit with Preact is under ${WHOLE_KIT_BUDGET / KIB} KiB gzip and carries no zod`, async () => {
    const whole = await bundle(`import * as kit from ${JSON.stringify(KIT_INDEX)};\nexport { kit };\n`);
    expect(whole.modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    expect(whole.modules.some((id) => /[/\\]preact[@/\\]/.test(id))).toBe(true);
    expect(whole.gzip).toBeLessThanOrEqual(WHOLE_KIT_BUDGET);
  }, 60_000);
});
