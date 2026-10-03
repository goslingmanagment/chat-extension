// Bundle probes of the MAIN bridge with its runtime (@cg/host-chatspace/main),
// measured the way the budgets are (minified, gzip -9). §11 gives the MAIN
// bridge 5 KiB, which the shipped document_start entry (the boot alone) keeps;
// the runtime that reads and writes ChatSpace is not wired into the extension
// yet. How it ships — one bundle at document_start with a larger MAIN budget,
// or a second MAIN script with its own line — is the owner's decision
// (packages/host-chatspace/README.md). Until then these provisional limits
// keep it from growing unchecked.

import { build } from 'esbuild';

import { REPO_ROOT } from '../lib/paths.ts';
import { KIB, gzipSize, type BudgetLine } from './budget.ts';

export interface MainProbe {
  readonly label: string;
  /** Module source of the probe entry; paths are relative to the repo root. */
  readonly entry: string;
  readonly limitBytes: number;
}

const SRC = './packages/host-chatspace/src/main';

export const MAIN_PROBES: readonly MainProbe[] = [
  {
    label: 'MAIN boot + runtime, one bundle (provisional, owner decides)',
    entry: [`import { installMainBridge } from '${SRC}/bridge.ts';`, `import { createMainRuntime } from '${SRC}/runtime.ts';`, 'installMainBridge(window, { runtime: createMainRuntime });'].join('\n'),
    limitBytes: 10 * KIB,
  },
  {
    label: 'MAIN runtime as a second script (provisional, owner decides)',
    entry: [`import { attachMainRuntime } from '${SRC}/bridge.ts';`, `import { createMainRuntime } from '${SRC}/runtime.ts';`, 'attachMainRuntime(createMainRuntime);'].join('\n'),
    limitBytes: 9 * KIB,
  },
];

export async function probeMain(probes: readonly MainProbe[] = MAIN_PROBES): Promise<BudgetLine[]> {
  const lines: BudgetLine[] = [];
  for (const probe of probes) {
    const result = await build({
      stdin: { contents: probe.entry, resolveDir: REPO_ROOT, sourcefile: 'main-probe.ts', loader: 'ts' },
      bundle: true,
      minify: true,
      format: 'iife',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    });
    const output = result.outputFiles[0];
    if (output === undefined) throw new Error(`size-budget: probe «${probe.label}» produced no output`);
    const gzipBytes = gzipSize(output.contents);
    lines.push({ label: probe.label, files: [], gzipBytes, limitBytes: probe.limitBytes, ok: gzipBytes <= probe.limitBytes });
  }
  return lines;
}
