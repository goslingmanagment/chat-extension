// ui/kit and the first dock chunk budget (architecture.md §11: ≤ 45 KiB gzip
// with Preact). The real dock (R14) is measured by tools/size-budget on the
// release build; these guards keep the kit's share of that chunk (what the
// dock imports from it) at most 27 KiB, so at least 18 KiB stay for the dock
// itself, and keep zod (which the contracts' schema modules build at load)
// out of it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const KIT_INDEX = fileURLToPath(new URL('../../../ui/src/kit/index.ts', import.meta.url));
const KIB = 1024;
/**
 * The whole kit with Preact, hooks and signals, nothing tree-shaken (33.6 KiB
 * at R13's review; 35.2 KiB with the five chip icons of decision X31 — on
 * CI's Linux build a few hundred bytes more): a ceiling against growth. The
 * first dock chunk holds only what the dock imports, guarded by
 * DOCK_KIT_BUDGET below and by the 45 KiB of testing/src/dock/size.test.ts.
 */
const WHOLE_KIT_BUDGET = 36 * KIB;
/** architecture.md §11: the first dock chunk with Preact, gzip. */
const FIRST_DOCK_CHUNK = 45 * KIB;
/**
 * The kit's share of the first dock chunk: what the dock surface (R14)
 * imports from the kit, with Preact, signals and every kit sheet. The rest,
 * FIRST_DOCK_CHUNK − this, is the dock's own code: R14 and the integrator
 * plan against it.
 */
const DOCK_KIT_BUDGET = 27 * KIB; // 24.7 KiB at R13's review
/** What the docked strip and result sheet use from the kit (ui-design §4.1–§4.10). */
const DOCK_IMPORTS = [
  'createMountPort',
  'useView',
  'useDispatch',
  'useI18n',
  'useAnnounce',
  'useHints',
  'useNowFn',
  'useResultCap',
  'useTooltip',
  'StripButton',
  'Button',
  'ActionButton',
  'Divider',
  'Kbd',
  'Menu',
  'MenuAnchor',
  'menuTriggerKeys',
  'Checkbox',
  'PartRow',
  'StageLine',
  'ErrorCard',
  'StatusBanner',
  'KeysFooter',
  'ElapsedTimer',
  'Countdown',
  'Dot',
  'Spinner',
  'ReadyBadge',
  'Icon',
  'GooseMark',
  'rovingIndex',
  'focusQuietly',
] as const;

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

  it(`what the dock takes from the kit is under ${DOCK_KIT_BUDGET / KIB} KiB, leaving ${(FIRST_DOCK_CHUNK - DOCK_KIT_BUDGET) / KIB} KiB of the first chunk to the dock`, async () => {
    const dock = await bundle(`import { ${DOCK_IMPORTS.join(', ')} } from ${JSON.stringify(KIT_INDEX)};\nexport { ${DOCK_IMPORTS.join(', ')} };\n`);
    expect(dock.modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    expect(dock.gzip).toBeLessThanOrEqual(DOCK_KIT_BUDGET);
    expect(FIRST_DOCK_CHUNK - DOCK_KIT_BUDGET).toBeGreaterThanOrEqual(18 * KIB);
  }, 60_000);
});
