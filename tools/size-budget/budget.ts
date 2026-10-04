// Size budgets of architecture.md §11 (starting targets, re-approved after
// the baseline): MAIN bridge ≤ 10 KiB gzip (decision X11: the boot and the
// runtime ship as one document_start bundle; §11 started at 5 KiB for the
// boot alone), isolated early bootstrap ≤ 30 KiB, first dock chunk with
// Preact ≤ 45 KiB, every other lazy chunk ≤ 30 KiB on top of what the dock
// already loaded.

import { gzipSync } from 'node:zlib';

export const KIB = 1024;

export interface LazyChunk {
  readonly file: string;
  readonly kind: 'entry' | 'chunk' | 'asset';
  readonly name: string | null;
  readonly imports: readonly string[];
}

export interface BudgetLine {
  readonly label: string;
  readonly files: readonly string[];
  readonly gzipBytes: number;
  readonly limitBytes: number;
  readonly ok: boolean;
}

export const BUDGETS = {
  /** Boot + runtime, one bundle (X11). Its work at document_start stays ≤ 1 ms (e2e). */
  mainBridge: 10 * KIB,
  wsTap: 5 * KIB,
  isolatedBootstrap: 30 * KIB,
  firstDockChunk: 45 * KIB,
  lazyChunk: 30 * KIB,
} as const;

export const MAIN_BRIDGE_FILE = 'content-scripts/chatspace-main.js';
export const WS_TAP_FILE = 'chatspace-ws.js';
export const ISOLATED_FILE = 'content-scripts/chatspace.js';
export const DOCK_ENTRY = 'lazy/dock.js';

/** gzip -9 size, the unit of every budget line. */
export function gzipSize(content: Uint8Array): number {
  return gzipSync(content, { level: 9 }).byteLength;
}

/** The entry plus every chunk it statically imports, transitively. */
export function staticClosure(entry: string, chunks: readonly LazyChunk[]): string[] {
  const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const imported of byFile.get(file)?.imports ?? []) visit(imported);
  };
  visit(entry);
  return [...seen].sort();
}

export function computeBudgets(read: (file: string) => Uint8Array, chunks: readonly LazyChunk[]): BudgetLine[] {
  const sizes = new Map<string, number>();
  const size = (file: string): number => {
    let value = sizes.get(file);
    if (value === undefined) {
      value = gzipSize(read(file));
      sizes.set(file, value);
    }
    return value;
  };
  const line = (label: string, files: readonly string[], limitBytes: number): BudgetLine => {
    const gzipBytes = files.reduce((sum, file) => sum + size(file), 0);
    return { label, files, gzipBytes, limitBytes, ok: gzipBytes <= limitBytes };
  };

  const lines = [
    line('MAIN bridge: boot + runtime (chatspace-main)', [MAIN_BRIDGE_FILE], BUDGETS.mainBridge),
    line('MAIN WS tap (chatspace-ws)', [WS_TAP_FILE], BUDGETS.wsTap),
    line('isolated early bootstrap (chatspace)', [ISOLATED_FILE], BUDGETS.isolatedBootstrap),
  ];
  if (!chunks.some((chunk) => chunk.file === DOCK_ENTRY)) {
    throw new Error(`lazy chunk list has no ${DOCK_ENTRY}`);
  }
  const dockClosure = staticClosure(DOCK_ENTRY, chunks);
  lines.push(line('first dock chunk with Preact (lazy/dock + shared)', dockClosure, BUDGETS.firstDockChunk));
  const loaded = new Set(dockClosure);
  for (const chunk of chunks) {
    if (chunk.kind !== 'entry' || chunk.file === DOCK_ENTRY) continue;
    const extra = staticClosure(chunk.file, chunks).filter((file) => !loaded.has(file));
    lines.push(line(`lazy chunk ${chunk.name ?? chunk.file} (beyond the dock)`, extra, BUDGETS.lazyChunk));
  }
  return lines;
}
