import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CHATSPACE } from '../../apps/extension/src/hosts/chatspace.ts';
import type { HostDescriptor } from '../../apps/extension/src/hosts/index.ts';
import { MAX_BACKGROUND_JS_BYTES } from '../archive-check/rules.ts';
import { BACKGROUND_CORE, BUDGETS, backgroundBudgets, computeBudgets, scriptBudgets, staticClosure, type LazyChunk } from './budget.ts';

const chunks: LazyChunk[] = [
  { file: 'lazy/dock.js', kind: 'entry', name: 'dock', imports: ['lazy/chunks/preact.js'] },
  { file: 'lazy/coach.js', kind: 'entry', name: 'coach', imports: ['lazy/chunks/preact.js', 'lazy/chunks/md.js'] },
  { file: 'lazy/chunks/preact.js', kind: 'chunk', name: null, imports: [] },
  { file: 'lazy/chunks/md.js', kind: 'chunk', name: null, imports: [] },
];

/** Incompressible bytes so gzip size ≈ raw size. */
const noise = (bytes: number): Uint8Array => randomBytes(bytes);

describe('size budgets', () => {
  it('follows static imports transitively', () => {
    expect(staticClosure('lazy/coach.js', chunks)).toEqual(['lazy/chunks/md.js', 'lazy/chunks/preact.js', 'lazy/coach.js']);
  });

  it('counts shared chunks once, in the dock line', () => {
    const files: Record<string, Uint8Array> = {
      'content-scripts/chatspace-main.js': noise(1000),
      'chatspace-ws.js': noise(500),
      'content-scripts/chatspace.js': noise(9000),
      'lazy/dock.js': noise(4000),
      'lazy/chunks/preact.js': noise(12000),
      'lazy/coach.js': noise(2000),
      'lazy/chunks/md.js': noise(40_000),
    };
    const lines = computeBudgets((file) => files[file] ?? new Uint8Array(), chunks);
    const coach = lines.find((line) => line.label.includes('coach'));
    expect(coach?.files).toEqual(['lazy/chunks/md.js', 'lazy/coach.js']);
    expect(coach?.ok).toBe(false);
    expect(coach?.limitBytes).toBe(BUDGETS.lazyChunk);
    expect(lines.filter((line) => !line.ok)).toHaveLength(1);
  });

  it('a layer is measured on top of the layers before it; an entry loaded on demand on top of them all, and never on top of another such entry', () => {
    const layered: LazyChunk[] = [
      { file: 'lazy/dock.js', kind: 'entry', name: 'dock', imports: ['lazy/chunks/ui.js'], layer: 0 },
      { file: 'lazy/tab-protocol.js', kind: 'entry', name: 'tab-protocol', imports: ['lazy/chunks/protocol.js'], layer: 1 },
      { file: 'lazy/tab-app.js', kind: 'entry', name: 'tab-app', imports: ['lazy/chunks/protocol.js', 'lazy/chunks/app.js'], layer: 2 },
      { file: 'lazy/ai.js', kind: 'entry', name: 'ai', imports: ['lazy/chunks/protocol.js', 'lazy/chunks/app.js', 'lazy/chunks/ai.js'], layer: 3 },
      { file: 'lazy/boards.js', kind: 'entry', name: 'boards', imports: ['lazy/chunks/ai.js', 'lazy/chunks/lists.js'] },
      { file: 'lazy/preview.js', kind: 'entry', name: 'preview', imports: ['lazy/chunks/protocol.js', 'lazy/chunks/lists.js'] },
      ...['ui', 'protocol', 'app', 'ai', 'lists'].map((name): LazyChunk => ({ file: `lazy/chunks/${name}.js`, kind: 'chunk', name: null, imports: [] })),
    ];
    const files: Record<string, Uint8Array> = {
      'lazy/chunks/ui.js': noise(20_000),
      'lazy/chunks/protocol.js': noise(25_000),
      'lazy/chunks/app.js': noise(8000),
      'lazy/chunks/ai.js': noise(26_000),
      'lazy/chunks/lists.js': noise(9000),
    };
    const lines = computeBudgets((file) => files[file] ?? noise(100), layered);
    const filesOf = (name: string): readonly string[] | undefined => lines.find((line) => line.label.includes(` ${name} `))?.files;
    expect(filesOf('tab-protocol')).toEqual(['lazy/chunks/protocol.js', 'lazy/tab-protocol.js']);
    // The schemas came with the protocol; the application pays only for its own.
    expect(filesOf('tab-app')).toEqual(['lazy/chunks/app.js', 'lazy/tab-app.js']);
    expect(filesOf('ai')).toEqual(['lazy/ai.js', 'lazy/chunks/ai.js']);
    // On demand: the layers are in memory, the other on-demand entry is not.
    expect(filesOf('boards')).toEqual(['lazy/boards.js', 'lazy/chunks/lists.js']);
    expect(filesOf('preview')).toEqual(['lazy/chunks/lists.js', 'lazy/preview.js']);
    expect(lines.every((line) => line.ok)).toBe(true);
    // A layer listed out of order is still measured in layer order.
    const shuffled = computeBudgets((file) => files[file] ?? noise(100), [...layered].reverse());
    expect(shuffled.find((line) => line.label.includes(' tab-app '))?.files).toEqual(['lazy/chunks/app.js', 'lazy/tab-app.js']);
  });

  it('[EX-007] the MAIN bridge line is the shipped document_start bundle — boot and runtime together — within 10 KiB (X11)', () => {
    const mainBridge = scriptBudgets([CHATSPACE]).find((budget) => budget.file === 'content-scripts/chatspace-main.js')?.limitBytes;
    expect(mainBridge).toBe(10 * 1024);
    const files = (main: number): Record<string, Uint8Array> => ({
      'content-scripts/chatspace-main.js': noise(main),
      'chatspace-ws.js': noise(500),
      'content-scripts/chatspace.js': noise(9000),
      'lazy/dock.js': noise(4000),
      'lazy/chunks/preact.js': noise(12000),
      'lazy/coach.js': noise(2000),
      'lazy/chunks/md.js': noise(2000),
    });
    const line = (main: number) => computeBudgets((file) => files(main)[file] ?? new Uint8Array(), chunks).find((item) => item.files.includes('content-scripts/chatspace-main.js'));
    expect(line(9000)?.ok).toBe(true);
    expect(line(9000)?.limitBytes).toBe(mainBridge);
    expect(line(11_000)?.ok).toBe(false);
  });
});

describe('size budgets of the sites’ scripts (host registry)', () => {
  const files: Record<string, Uint8Array> = { 'lazy/dock.js': noise(100) };
  const dockOnly: LazyChunk[] = [{ file: 'lazy/dock.js', kind: 'entry', name: 'dock', imports: [] }];

  it('ChatSpace’s three lines come first, in the size report’s order, with their files and ceilings', () => {
    const lines = computeBudgets((file) => files[file] ?? noise(100), dockOnly);
    expect(lines.slice(0, 3).map((line) => [line.label, line.files, line.limitBytes])).toEqual([
      ['MAIN bridge: boot + runtime (chatspace-main)', ['content-scripts/chatspace-main.js'], 10 * 1024],
      ['MAIN WS tap (chatspace-ws)', ['chatspace-ws.js'], 6 * 1024],
      ['isolated early bootstrap (chatspace)', ['content-scripts/chatspace.js'], 30 * 1024],
    ]);
  });

  it('a second site brings its own lines after ChatSpace’s and changes none of them', () => {
    const second: HostDescriptor = {
      ...CHATSPACE,
      kind: 'fansly-web',
      scripts: {
        main: { entry: 'site-main', file: 'content-scripts/site-main.js', world: 'MAIN', registration: 'dynamic' },
        isolated: { entry: 'site', file: 'content-scripts/site.js', world: 'ISOLATED', registration: 'dynamic' },
      },
      budgets: {
        scripts: [
          { entry: 'site-main', label: 'MAIN (site-main)', gzipBytes: 16 * 1024 },
          { entry: 'site', label: 'isolated (site)', gzipBytes: 30 * 1024 },
        ],
      },
    };
    expect(scriptBudgets([CHATSPACE, second])).toEqual([...scriptBudgets([CHATSPACE]), { label: 'MAIN (site-main)', file: 'content-scripts/site-main.js', limitBytes: 16 * 1024 }, { label: 'isolated (site)', file: 'content-scripts/site.js', limitBytes: 30 * 1024 }]);
  });

  it('a script without its line, or a line without its script, fails instead of going unmeasured', () => {
    const unbudgeted: HostDescriptor = { ...CHATSPACE, budgets: { scripts: CHATSPACE.budgets.scripts.filter((budget) => budget.entry !== 'chatspace-ws') } };
    expect(() => scriptBudgets([unbudgeted])).toThrow(/chatspace-ws has 0 budget lines/);
    const stray: HostDescriptor = { ...CHATSPACE, budgets: { scripts: [...CHATSPACE.budgets.scripts, { entry: 'gone', label: 'gone', gzipBytes: 1 }] } };
    expect(() => scriptBudgets([stray])).toThrow(/budgets gone, a script it does not declare/);
  });

  it('[R20 F1] the background is measured raw: the core under the 800 KiB signal threshold, each site’s chunk under its registry ceiling; a second site adds its own line', () => {
    const chunk = CHATSPACE.background;
    if (chunk === undefined) throw new Error('ChatSpace has a background chunk');
    expect(backgroundBudgets([CHATSPACE])).toEqual([
      { label: 'background core (background.js), raw', file: BACKGROUND_CORE, limitBytes: MAX_BACKGROUND_JS_BYTES },
      { label: 'background chunk of chatspace (bg/chatspace.js), raw', file: chunk.file, limitBytes: chunk.rawBytes },
    ]);
    const files: Record<string, Uint8Array> = { 'lazy/dock.js': noise(10), [BACKGROUND_CORE]: new Uint8Array(MAX_BACKGROUND_JS_BYTES + 1), [chunk.file]: new Uint8Array(1000) };
    const lines = computeBudgets((file) => files[file] ?? new Uint8Array(), [{ file: 'lazy/dock.js', kind: 'entry', name: 'dock', imports: [] }]);
    // Raw, not gzip: a megabyte of zeros would be a few hundred bytes compressed.
    expect(lines.find((line) => line.files[0] === BACKGROUND_CORE)).toMatchObject({ unit: 'raw', bytes: MAX_BACKGROUND_JS_BYTES + 1, ok: false });
    expect(lines.find((line) => line.files[0] === chunk.file)).toMatchObject({ unit: 'raw', bytes: 1000, limitBytes: chunk.rawBytes, ok: true });
    const second: HostDescriptor = { ...CHATSPACE, kind: 'fansly-web', background: { source: 'bg/fansly.ts', file: 'bg/fansly.js', rawBytes: 200 * 1024 } };
    expect(backgroundBudgets([CHATSPACE, second])).toEqual([...backgroundBudgets([CHATSPACE]), { label: 'background chunk of fansly-web (bg/fansly.js), raw', file: 'bg/fansly.js', limitBytes: 200 * 1024 }]);
  });
});
