// The dock and the overlays against the bundle budgets (architecture.md §11):
// the first dock chunk with Preact ≤ 45 KiB gzip, every lazy chunk ≤ 30 KiB
// on top of it. tools/size-budget measures the release build; until the tab
// composition mounts the real dock, this test builds the same graph the lazy
// entry will have — the dock and the toast host statically, Recap/Review,
// the debug footer, Coach, the cheatsheet and the expanded result behind
// dynamic imports — and measures it the same way (minified, gzip -9).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const UI = fileURLToPath(new URL('../../../ui/src/', import.meta.url));
const KIB = 1024;
/** architecture.md §11. */
const FIRST_DOCK_CHUNK = 45 * KIB;
const LAZY_CHUNK = 30 * KIB;

/** What the lazy entry of the extension exports once it mounts the real dock. */
const ENTRY = `
export { dockSurface, mountDockSurface } from ${JSON.stringify(`${UI}dock/index.ts`)};
export { createToastHost, lazyOverlays, mountToasts, toastsSurface } from ${JSON.stringify(`${UI}overlays/index.ts`)};
export { createMountPort } from ${JSON.stringify(`${UI}kit/index.ts`)};
`;

interface Chunk {
  readonly file: string;
  readonly gzip: number;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  readonly modules: readonly string[];
  readonly isEntry: boolean;
}

let chunks: Chunk[] = [];
const byFile = (file: string): Chunk => {
  const chunk = chunks.find((item) => item.file === file);
  if (chunk === undefined) throw new Error(`no chunk ${file}`);
  return chunk;
};
/** A chunk and everything it imports statically. */
function closure(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const imported of byFile(file).imports) closure(imported, seen);
  return seen;
}
const sizeOf = (files: Iterable<string>): number => [...files].reduce((sum, file) => sum + byFile(file).gzip, 0);
const modulesOf = (files: Iterable<string>): string[] => [...files].flatMap((file) => byFile(file).modules);
const kib = (bytes: number): string => `${(bytes / KIB).toFixed(2)} KiB`;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cg-dock-size-'));
  try {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, ENTRY);
    const result = await build({
      configFile: false,
      root: dir,
      mode: 'production',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      publicDir: false,
      oxc: { jsx: { runtime: 'automatic', importSource: 'preact', development: false } },
      build: {
        write: false,
        target: 'firefox142',
        minify: true,
        sourcemap: false,
        modulePreload: false,
        rolldownOptions: { input: { dock: entry }, preserveEntrySignatures: 'exports-only', output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' } },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
    chunks = outputs
      .flatMap((output) => output.output)
      .filter((item): item is Rolldown.OutputChunk => item.type === 'chunk')
      .map((chunk) => ({
        file: chunk.fileName,
        gzip: gzipSync(chunk.code, { level: 9 }).byteLength,
        imports: chunk.imports,
        dynamicImports: chunk.dynamicImports,
        modules: Object.keys(chunk.modules),
        isEntry: chunk.isEntry,
      }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

describe('[EX-009] the dock and its overlays fit the bundle budgets (architecture.md §11)', () => {
  it(`the first dock chunk — the dock, the toast host, the kit and Preact — is under ${FIRST_DOCK_CHUNK / KIB} KiB gzip`, () => {
    const first = closure('dock.js');
    const size = sizeOf(first);
    const modules = modulesOf(first);
    // Reported for the work package's record: `pnpm vitest run packages/testing/src/dock/size.test.ts`.
    console.info(`first dock chunk: ${kib(size)} of ${kib(FIRST_DOCK_CHUNK)}`);
    expect(size).toBeLessThanOrEqual(FIRST_DOCK_CHUNK);
    expect(modules.some((id) => /[/\\]preact[@/\\]/.test(id))).toBe(true);
    expect(modules.some((id) => id.endsWith('/dock/Strip.tsx'))).toBe(true);
    expect(modules.some((id) => id.endsWith('/overlays/toasts/index.tsx'))).toBe(true);
    // No schemas, no CG registry, no Markdown, no analysis, no debug footer, no overlay window in it.
    expect(modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    expect(modules.filter((id) => /errors\/registry|dock\/analysis\/|dock\/debug\/|overlays\/(coach|cheatsheet|expanded)\//.test(id))).toEqual([]);
    // The kit's base sheet carries every component's CSS; the components only lazy chunks use stay out.
    expect(modules.filter((id) => /kit\/(markdown\/(parse|Markdown)|components\/(Choice|Field|Dialog))\.tsx?$/.test(id))).toEqual([]);
  });

  it(`every lazy part — Recap and Review, the debug footer, Coach, the cheatsheet, the expanded result — adds under ${LAZY_CHUNK / KIB} KiB each`, () => {
    const first = closure('dock.js');
    const lazy = new Map<string, number>();
    const visit = (file: string): void => {
      for (const dynamic of byFile(file).dynamicImports) {
        if (lazy.has(dynamic)) continue;
        const extra = [...closure(dynamic)].filter((item) => !first.has(item));
        lazy.set(dynamic, sizeOf(extra));
        for (const item of extra) visit(item);
      }
    };
    for (const file of first) visit(file);
    // A chunk is named by the part it holds (file names carry a hash).
    const PARTS = { analysis: '/dock/analysis/index.tsx', debug: '/dock/debug/index.tsx', coach: '/overlays/coach/index.tsx', cheatsheet: '/overlays/cheatsheet/index.tsx', expanded: '/overlays/expanded/index.tsx' } as const;
    const nameOf = (file: string): string => Object.entries(PARTS).find(([, marker]) => byFile(file).modules.some((id) => id.endsWith(marker)))?.[0] ?? file;
    const named = [...lazy.entries()].map(([file, size]) => [nameOf(file), size] as const);
    console.info(`lazy chunks beyond the dock: ${named.map(([name, size]) => `${name} ${kib(size)}`).join(', ')}`);
    expect(named.map(([name]) => name).sort()).toEqual(['analysis', 'cheatsheet', 'coach', 'debug', 'expanded']);
    for (const [name, size] of named) expect(size, name).toBeLessThanOrEqual(LAZY_CHUNK);
    expect(modulesOf([...lazy.keys()].flatMap((file) => [...closure(file)])).filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
  });
});
