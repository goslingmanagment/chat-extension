// Import probes of @cg/contracts: what a bundle pays for one slice of the
// contracts, measured the way the budgets are (minified, gzip -9). They guard
// the light/heavy split of docs/protocols/README.md: the early isolated start
// loads only the light modules, a constant costs a constant, and the two big
// registries stay inside their own lazy chunks.

import { build } from 'esbuild';

import { REPO_ROOT } from '../lib/paths.ts';
import { KIB, gzipSize, type BudgetLine } from './budget.ts';

export interface ContractsProbe {
  readonly label: string;
  /** Module source of the probe entry; paths are relative to the repo root. */
  readonly entry: string;
  readonly limitBytes: number;
}

const SRC = './packages/contracts/src';

export const CONTRACTS_PROBES: readonly ContractsProbe[] = [
  {
    label: 'contracts: early isolated (bridge guard, envelopes, tab.register)',
    entry: [
      `export { checkBridgeFrame, BridgeEventEnvelopeSchema, BridgeResponseSchema } from '${SRC}/bridge.ts';`,
      `export { TabEnvelopeSchema, TabRegisterRequestSchema, TabRegisterResponseSchema } from '${SRC}/tab-protocol.ts';`,
    ].join('\n'),
    limitBytes: 12 * KIB,
  },
  { label: 'contracts: limits only', entry: `export * from '${SRC}/limits.ts';`, limitBytes: 2 * KIB },
  { label: 'contracts: UiAction schema', entry: `export { UiActionSchema } from '${SRC}/vm/actions.ts';`, limitBytes: 16 * KIB },
  { label: 'contracts: tab request registry (parseTabPayload)', entry: `export { parseTabPayload } from '${SRC}/tab-messages.ts';`, limitBytes: 28 * KIB },
];

export async function probeContracts(probes: readonly ContractsProbe[] = CONTRACTS_PROBES): Promise<BudgetLine[]> {
  const lines: BudgetLine[] = [];
  for (const probe of probes) {
    const result = await build({
      stdin: { contents: probe.entry, resolveDir: REPO_ROOT, sourcefile: 'probe.ts', loader: 'ts' },
      bundle: true,
      minify: true,
      format: 'esm',
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
