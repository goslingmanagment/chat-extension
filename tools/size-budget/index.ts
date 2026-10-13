// `pnpm size`: §11 bundle budgets on the release build (gzip -9; the background raw). Exit 1 on any excess.
// Usage: node tools/size-budget/index.ts [--dir <extension output dir>]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { fail, OUTPUT_ROOT, RELEASE_DIR } from '../lib/paths.ts';
import { computeBudgets, KIB, type LazyChunk } from './budget.ts';
import { probeContracts } from './contracts-probes.ts';

const { values } = parseArgs({ options: { dir: { type: 'string', default: RELEASE_DIR } } });
const dir = values.dir;

let chunks: LazyChunk[];
try {
  chunks = JSON.parse(readFileSync(`${dir}.lazy-chunks.json`, 'utf8')) as LazyChunk[];
} catch {
  fail(`size-budget: ${dir}.lazy-chunks.json not found — run the build first (pnpm build).`);
}

const lines = [...computeBudgets((file) => readFileSync(join(dir, file)), chunks), ...(await probeContracts())];
const kib = (bytes: number): string => `${(bytes / KIB).toFixed(2)} KiB`;
for (const line of lines) {
  // A raw line says its headroom in bytes: the core's is the byte registry's number (architecture.md §3.2).
  const headroom = line.unit === 'raw' ? `  (${line.limitBytes - line.bytes} B to spare)` : '';
  console.log(`${line.ok ? 'ok  ' : 'OVER'}  ${line.label.padEnd(66)} ${kib(line.bytes).padStart(11)} / ${kib(line.limitBytes)}${headroom}`);
}
writeFileSync(`${OUTPUT_ROOT}size-report.json`, `${JSON.stringify(lines, null, 2)}\n`);
const over = lines.filter((line) => !line.ok);
if (over.length > 0) fail(`size-budget: ${over.length} budget(s) exceeded (architecture.md §11).`);
console.log('size-budget: all budgets met (gzip -9; the background raw).');
