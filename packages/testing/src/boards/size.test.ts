// The lazy chunks of the boards (architecture.md §10.1, §11: every lazy chunk
// ≤ 30 KiB gzip on top of what the dock already loaded). The release build is
// measured by tools/size-budget once the composition root adds the entries;
// until then these guards measure each surface the strict way: everything it
// needs that the dock does not use itself — its own code and the kit parts
// only overlays use (Dialog, VirtualList, fields, Markdown…) — whatever chunk
// the bundler puts them in. They also keep zod (which the contracts' schema
// modules build at load) out of every surface.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const UI = fileURLToPath(new URL('../../../ui/src/', import.meta.url));
const KIB = 1024;
/** architecture.md §11: a lazy chunk beyond the dock, gzip. */
const LAZY_CHUNK = 30 * KIB;

/**
 * What the docked strip and the result sheet use from the kit — the list of
 * src/kit/size.test.ts (R13), which guards the kit's share of the first dock
 * chunk. A surface is charged for everything outside it.
 */
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

/** Lazy entry → what it exports for the composition root. */
const SURFACES = {
  spenders: `export { spendersSurface } from ${JSON.stringify(`${UI}spenders/index.ts`)};`,
  newcomers: `export { newcomersSurface } from ${JSON.stringify(`${UI}newcomers/index.ts`)};`,
  'fan-panel': `export { fanPanelSurface } from ${JSON.stringify(`${UI}fanpanel/index.ts`)};`,
  palette: `export { paletteSurface, quickJumpSurface } from ${JSON.stringify(`${UI}palette/index.ts`)};`,
} as const;

type Surface = keyof typeof SURFACES;

const DOCK = `import { ${DOCK_IMPORTS.join(', ')} } from ${JSON.stringify(`${UI}kit/index.ts`)};\nexport { ${DOCK_IMPORTS.join(', ')} };\n`;

/** Bundles one entry into one file and returns its modules with the code each one kept. */
async function modulesOf(source: string): Promise<Map<string, string>> {
  const dir = mkdtempSync(join(tmpdir(), 'cg-boards-size-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, source);
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
    const modules = new Map<string, string>();
    for (const item of outputs.flatMap((output) => output.output)) {
      if (item.type !== 'chunk') continue;
      for (const [id, module] of Object.entries(item.modules)) if (id !== entry && module.code !== null && module.code !== '') modules.set(id, module.code);
    }
    return modules;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gzip = (code: string): number => gzipSync(code, { level: 9 }).byteLength;

describe('[EX-009] the boards’ lazy chunks fit the budget (architecture.md §11)', () => {
  let dock = new Map<string, string>();
  const surfaces = new Map<Surface, Map<string, string>>();

  beforeAll(async () => {
    dock = await modulesOf(DOCK);
    for (const name of Object.keys(SURFACES) as Surface[]) surfaces.set(name, await modulesOf(SURFACES[name]));
  }, 120_000);

  /** What the surface needs beyond the dock: its modules the dock does not hold, as one file. */
  const beyondDock = (name: Surface): number => gzip([...(surfaces.get(name) ?? new Map<string, string>())].filter(([id]) => !dock.has(id)).map(([, code]) => code).join('\n'));

  it.each(Object.keys(SURFACES) as Surface[])(`%s is under ${LAZY_CHUNK / KIB} KiB gzip beyond the dock`, (name) => {
    const size = beyondDock(name);
    expect(size).toBeGreaterThan(KIB);
    expect(size).toBeLessThanOrEqual(LAZY_CHUNK);
  });

  it('the sizes are known: Spenders ≤ 26, «Новые» ≤ 22, the fan panel ≤ 10 and the palette ≤ 8 KiB', () => {
    const sizes = Object.fromEntries((Object.keys(SURFACES) as Surface[]).map((name) => [name, beyondDock(name)]));
    expect(sizes['spenders']).toBeLessThanOrEqual(26 * KIB);
    expect(sizes['newcomers']).toBeLessThanOrEqual(22 * KIB);
    expect(sizes['fan-panel']).toBeLessThanOrEqual(10 * KIB);
    expect(sizes['palette']).toBeLessThanOrEqual(8 * KIB);
  });

  it('no surface carries zod, and each one shares Preact with the dock instead of bringing its own', () => {
    for (const [name, modules] of surfaces) {
      const ids = [...modules.keys()];
      expect(ids.filter((id) => /[/\\]zod[@/\\]/.test(id)), name).toEqual([]);
      expect(ids.filter((id) => /[/\\]preact[@/\\]/.test(id) && !dock.has(id)), name).toEqual([]);
    }
  });

  it('a surface takes from the contracts only constants, never a schema module', () => {
    for (const [name, modules] of surfaces) {
      const contracts = [...modules.keys()].filter((id) => /packages[/\\]contracts[/\\]src/.test(id)).map((id) => id.replace(/.*packages[/\\]contracts[/\\]src[/\\]/, ''));
      expect(contracts.filter((id) => /schema|actions|tab\b|bridge/.test(id)), name).toEqual([]);
    }
  });
});
