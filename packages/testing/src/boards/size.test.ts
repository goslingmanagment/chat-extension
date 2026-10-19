// The lazy chunks of the boards (architecture.md §10.1): each surface is
// measured the strict way — everything it needs that the dock does not use
// itself, its own code and the kit parts only overlays use (Dialog,
// VirtualList, fields, Markdown…), whatever chunk the bundler puts them in —
// and printed. X66: the owner dropped the size budgets (§11): no size is
// judged. The guards keep zod (which the contracts' schema modules build at
// load) and the contracts' schema modules out of every surface. A part a surface loads only on
// a click of its own (`import()`, the preview's media panel, X53) is not the
// surface's: it is measured as an entry of its own.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const UI = fileURLToPath(new URL('../../../ui/src/', import.meta.url));
/**
 * What the docked strip and the result sheet use from the kit: the
 * DOCK_IMPORTS of ../kit/size.test.ts (R13), which guards the kit's share of
 * the first dock chunk. It is read from that file's source, so there is one
 * list and no copy to keep in step (a test file is not imported: that would
 * run its tests here). A surface is charged for everything outside it.
 */
function kitDockImports(): string[] {
  const source = readFileSync(fileURLToPath(new URL('../kit/size.test.ts', import.meta.url)), 'utf8');
  const list = /const DOCK_IMPORTS = \[([^\]]*)\] as const;/.exec(source)?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '');
}

const DOCK_IMPORTS = kitDockImports();

/** Lazy entry → what it exports for the composition root. */
const SURFACES = {
  spenders: `export { spendersSurface } from ${JSON.stringify(`${UI}spenders/index.ts`)};`,
  newcomers: `export { newcomersSurface } from ${JSON.stringify(`${UI}newcomers/index.ts`)};`,
  'fan-panel': `export { fanPanelSurface } from ${JSON.stringify(`${UI}fanpanel/index.ts`)};`,
  palette: `export { paletteSurface, quickJumpSurface } from ${JSON.stringify(`${UI}palette/index.ts`)};`,
  preview: `export { previewWindowSurface } from ${JSON.stringify(`${UI}preview/index.ts`)};`,
  // X53: the media panel of the three previews, loaded with the first «Медиа» click.
  'preview-send': `export { mediaPanelPart } from ${JSON.stringify(`${UI}spenders/preview/media-panel.tsx`)};`,
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
    const chunks = outputs.flatMap((output) => output.output).filter((item): item is Rolldown.OutputChunk => item.type === 'chunk');
    // What loads with the entry: its chunk and every chunk it imports statically; a chunk only an `import()` reaches
    // loads later, on its own.
    const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
    const loaded = new Set<string>();
    const walk = (fileName: string): void => {
      if (loaded.has(fileName)) return;
      loaded.add(fileName);
      for (const next of byName.get(fileName)?.imports ?? []) walk(next);
    };
    for (const chunk of chunks) if (chunk.isEntry) walk(chunk.fileName);
    const modules = new Map<string, string>();
    for (const item of chunks) {
      if (!loaded.has(item.fileName)) continue;
      for (const [id, module] of Object.entries(item.modules)) if (id !== entry && module.code !== null && module.code !== '') modules.set(id, module.code);
    }
    return modules;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gzip = (code: string): number => gzipSync(code, { level: 9 }).byteLength;

describe('[EX-009] the boards’ lazy chunks: measured, without zod or schemas', () => {
  let dock = new Map<string, string>();
  const surfaces = new Map<Surface, Map<string, string>>();

  beforeAll(async () => {
    dock = await modulesOf(DOCK);
    for (const name of Object.keys(SURFACES) as Surface[]) surfaces.set(name, await modulesOf(SURFACES[name]));
  }, 120_000);

  /** What the surface needs beyond the dock: its modules the dock does not hold, as one file. */
  const beyondDock = (name: Surface): number => gzip([...(surfaces.get(name) ?? new Map<string, string>())].filter(([id]) => !dock.has(id)).map(([, code]) => code).join('\n'));

  it('every surface is built and is more than a stub; its size beyond the dock is printed, not judged (X66)', () => {
    for (const name of Object.keys(SURFACES) as Surface[]) {
      const size = beyondDock(name);
      console.info(`${name}: ${size} B gzip beyond the dock`);
      expect(size, name).toBeGreaterThan(1024);
    }
  });

  it('«the dock» here is the dock of the kit’s own size guard: its list of imports, read and not copied', () => {
    // An empty or cut list would charge the surfaces for the whole kit — or for nothing.
    expect(DOCK_IMPORTS.length).toBeGreaterThan(20);
    expect(DOCK_IMPORTS).toEqual(expect.arrayContaining(['createMountPort', 'useView', 'useDispatch', 'Button', 'PartRow', 'ErrorCard']));
    for (const name of DOCK_IMPORTS) expect(name).toMatch(/^[A-Za-z][A-Za-z0-9]*$/);
    expect(new Set(DOCK_IMPORTS).size).toBe(DOCK_IMPORTS.length);
    // The dock really is bundled from it.
    expect([...dock.keys()].some((id) => /kit[/\\]components[/\\]PartRow/.test(id))).toBe(true);
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
