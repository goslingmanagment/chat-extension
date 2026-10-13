// Import probes of @cg/contracts: what a bundle pays for one slice of the
// contracts, measured the way the budgets are (minified, gzip -9). They guard
// the light/heavy split of docs/protocols/README.md: the early isolated start
// loads only the light modules, a constant costs a constant, and the two big
// registries stay inside their own lazy chunks. A probe of the contracts every
// bundle shares lives here; a site's own slices — its bridge, its envelopes,
// its request registry — are its probes in the host registry
// (apps/extension/src/hosts, `budgets.contracts`), their lines named by the
// site (docs/project-unite/architecture.md §3.2).

import { build } from 'esbuild';

import { HOSTS, type HostDescriptor } from '../../apps/extension/src/hosts/index.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { KIB, gzipSize, type BudgetLine } from './budget.ts';

export interface ContractsProbe {
  readonly label: string;
  /** Module source of the probe entry; paths are relative to the repo root. */
  readonly entry: string;
  readonly limitBytes: number;
}

const SRC = './packages/contracts/src';

/** The probes of what every site's bundles share. */
export const COMMON_PROBES: readonly ContractsProbe[] = [{ label: 'contracts: limits only', entry: `export * from '${SRC}/limits.ts';`, limitBytes: 2 * KIB }];

/** The common probes, then each site's own, in the registry's order: a site's line is named by it. */
export function contractsProbes(hosts: readonly HostDescriptor[] = HOSTS): ContractsProbe[] {
  return [...COMMON_PROBES, ...hosts.flatMap((host) => host.budgets.contracts.map((probe) => ({ label: `${host.kind}: ${probe.label}`, entry: probe.entry, limitBytes: probe.gzipBytes })))];
}

export async function probeContracts(probes: readonly ContractsProbe[] = contractsProbes()): Promise<BudgetLine[]> {
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
    const bytes = gzipSize(output.contents);
    lines.push({ label: probe.label, files: [], bytes, unit: 'gzip', limitBytes: probe.limitBytes, ok: bytes <= probe.limitBytes });
  }
  return lines;
}
