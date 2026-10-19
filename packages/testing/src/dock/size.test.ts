// What the first dock chunk holds and what stays in its lazy parts: this test
// builds the graph the lazy entry has — the dock and the toast host
// statically, Recap/Review, the debug footer, Coach, the cheatsheet and the
// expanded result behind dynamic imports — and checks which modules land
// where (no zod, no schemas, no overlay windows in the first chunk). X66: the
// owner dropped the size budgets (architecture.md §11); the sizes are printed
// for the record (minified, gzip -9), never judged.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build, type Rolldown } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

const UI = fileURLToPath(new URL('../../../ui/src/', import.meta.url));
const KIB = 1024;

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

describe('[EX-009] the dock and its overlays: what lands in which chunk', () => {
  it('the first dock chunk holds the dock, the toast host, the kit and Preact, and no schemas or overlay windows', () => {
    const first = closure('dock.js');
    const size = sizeOf(first);
    const modules = modulesOf(first);
    // Reported for the work package's record: `pnpm vitest run packages/testing/src/dock/size.test.ts`.
    console.info(`first dock chunk: ${kib(size)}`);
    expect(modules.some((id) => /[/\\]preact[@/\\]/.test(id))).toBe(true);
    expect(modules.some((id) => id.endsWith('/dock/Strip.tsx'))).toBe(true);
    expect(modules.some((id) => id.endsWith('/overlays/toasts/index.tsx'))).toBe(true);
    // No schemas, no CG registry, no Markdown, no analysis, no debug footer, no overlay window in it.
    expect(modules.filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
    expect(modules.filter((id) => /errors\/registry|dock\/analysis\/|dock\/debug\/|overlays\/(coach|cheatsheet|expanded)\//.test(id))).toEqual([]);
    // The kit's base sheet carries every component's CSS; the components only lazy chunks use stay out.
    expect(modules.filter((id) => /kit\/(markdown\/(parse|Markdown)|components\/(Choice|Field|Dialog))\.tsx?$/.test(id))).toEqual([]);
  });

  it('every lazy part — Recap and Review, the debug footer, Coach, the cheatsheet, the expanded result — is a chunk of its own, without zod', () => {
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
    expect(modulesOf([...lazy.keys()].flatMap((file) => [...closure(file)])).filter((id) => /[/\\]zod[@/\\]/.test(id))).toEqual([]);
  });
});
