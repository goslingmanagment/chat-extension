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
});
