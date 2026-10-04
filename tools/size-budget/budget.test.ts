import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { BUDGETS, computeBudgets, staticClosure, type LazyChunk } from './budget.ts';

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
    expect(BUDGETS.mainBridge).toBe(10 * 1024);
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
    expect(line(9000)?.limitBytes).toBe(BUDGETS.mainBridge);
    expect(line(11_000)?.ok).toBe(false);
  });
});
