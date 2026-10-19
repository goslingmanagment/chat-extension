// ui/kit in the first dock chunk: zod (which the contracts' schema modules
// build at load) stays out of the kit and of what the dock takes from it.
// X66: the owner dropped the size budgets (architecture.md §11); the sizes
// are printed for the record, never judged.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const KIT_INDEX = fileURLToPath(new URL('../../../ui/src/kit/index.ts', import.meta.url));
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

describe('[EX-009] ui/kit in the first dock chunk carries no zod', () => {
  it('the whole kit with Preact carries no zod', async () => {
    const whole = await bundle(`import * as kit from ${JSON.stringify(KIT_INDEX)};\nexport { kit };\n`);
    expect(whole.modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    expect(whole.modules.some((id) => /[/\\]preact[@/\\]/.test(id))).toBe(true);
    console.info(`the whole kit with Preact: ${whole.gzip} B gzip`);
  }, 60_000);

  it('what the dock takes from the kit carries no zod', async () => {
    const dock = await bundle(`import { ${DOCK_IMPORTS.join(', ')} } from ${JSON.stringify(KIT_INDEX)};\nexport { ${DOCK_IMPORTS.join(', ')} };\n`);
    expect(dock.modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    console.info(`what the dock takes from the kit: ${dock.gzip} B gzip`);
  }, 60_000);
});
