// The e2e suite in parts (docs/release.md «CI»): on the owner's PC the CI job runs it as N parts side by side, each
// in a container of its own. CG_E2E_SHARD=<k>/<n> makes e2e/wdio.conf.ts run part k of n; without it the whole
// suite runs, as before.
//
// How the parts are cut: the spec files of e2e/specs in name order, each weighing the seconds it took on the PC
// (e2e/shard-weights.json; a file with no weight there weighs the median of the known ones). Heaviest first, each
// file goes to the part that weighs least so far — the lowest number on a tie. The same files and weights always
// give the same parts, every job of a run cuts them from the same checkout, and every file lands in exactly one
// part. Inside a part the files run in name order, as in the whole suite.
//
// Also a command, run by Node from the repository root:
//   node packages/testing/src/e2e-shards.ts plan <n>   the parts for n, with their weights
//   gh run view <run id> --log | node packages/testing/src/e2e-shards.ts weights
//                                                       new weights from the `cg-e2e-time:` lines of CI logs
//                                                       (the median of each file's passed runs); a file the logs
//                                                       do not name keeps its weight, a file that is gone loses it

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The folder of the spec files and the weights file, as wdio.conf.ts knows them. */
export const SPECS_DIR = fileURLToPath(new URL('../e2e/specs/', import.meta.url));
export const WEIGHTS_FILE = fileURLToPath(new URL('../e2e/shard-weights.json', import.meta.url));

/** The prefix of the line wdio.conf.ts prints for each spec file a worker finished: `cg-e2e-time: <file> <seconds> <passed|failed>`. */
export const TIME_LINE = 'cg-e2e-time:';

const MAX_PARTS = 32;

export interface Shard {
  readonly part: number;
  readonly of: number;
}

/** `<k>/<n>` with 1 ≤ k ≤ n ≤ 32; anything else throws — a job must not run a part it cannot name. */
export function parseShard(text: string): Shard {
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(text.trim());
  const part = Number(match?.[1]);
  const of = Number(match?.[2]);
  if (match === null || part > of || of > MAX_PARTS) throw new Error(`CG_E2E_SHARD: «${text}» is not <part>/<parts> with 1 ≤ part ≤ parts ≤ ${MAX_PARTS}`);
  return { part, of };
}

/** The spec files under `dir`, relative to it, in name order. */
export function listSpecs(dir: string = SPECS_DIR): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => name.split('\\').join('/'))
    .filter((name) => name.endsWith('.e2e.ts'))
    .sort();
}

export function readWeights(file: string = WEIGHTS_FILE): Record<string, number> {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`${file}: not an object of seconds by spec file`);
  const weights: Record<string, number> = {};
  for (const [name, seconds] of Object.entries(parsed)) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`${file}: ${name} weighs ${JSON.stringify(seconds)}, not a positive number of seconds`);
    weights[name] = seconds;
  }
  return weights;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export interface Plan {
  /** Part 1 first; the files of each in name order. */
  readonly parts: readonly (readonly string[])[];
  /** The weight of each part, seconds. */
  readonly seconds: readonly number[];
  /** What a file with no weight was given. */
  readonly unknownWeight: number;
}

/** Cuts `specs` into `of` parts (see the top of the file). More parts than files throws: a part would run nothing. */
export function planShards(specs: readonly string[], weights: Readonly<Record<string, number>>, of: number): Plan {
  if (!Number.isInteger(of) || of < 1 || of > MAX_PARTS) throw new Error(`the number of parts must be 1..${MAX_PARTS}, not ${of}`);
  if (of > specs.length) throw new Error(`${of} parts for ${specs.length} spec files: a part would run nothing`);
  const known = specs.flatMap((name) => (weights[name] === undefined ? [] : [weights[name]]));
  const unknownWeight = known.length === 0 ? 1 : Math.round(median(known));
  const weightOf = (name: string): number => weights[name] ?? unknownWeight;
  const order = [...specs].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : a > b ? 1 : 0));
  const parts: string[][] = Array.from({ length: of }, () => []);
  const seconds: number[] = Array.from({ length: of }, () => 0);
  for (const name of order) {
    let lightest = 0;
    for (let index = 1; index < of; index += 1) if ((seconds[index] ?? 0) < (seconds[lightest] ?? 0)) lightest = index;
    parts[lightest]?.push(name);
    seconds[lightest] = (seconds[lightest] ?? 0) + weightOf(name);
  }
  return { parts: parts.map((part) => part.sort()), seconds, unknownWeight };
}

/** The spec files of one part, relative to the specs folder. */
export function shardSpecs(shard: Shard, specs: readonly string[] = listSpecs(), weights: Readonly<Record<string, number>> = readWeights()): readonly string[] {
  return planShards(specs, weights, shard.of).parts[shard.part - 1] ?? [];
}

/** Seconds of each spec file's passed runs, by the `cg-e2e-time:` lines found in `text` (CI logs, any prefix). */
export function timesFromLog(text: string): Map<string, number[]> {
  const times = new Map<string, number[]>();
  const pattern = new RegExp(`${TIME_LINE} (\\S+\\.e2e\\.ts) ([0-9]+(?:\\.[0-9]+)?) passed\\b`, 'g');
  for (const match of text.matchAll(pattern)) {
    const [, name = '', seconds = ''] = match;
    times.set(name, [...(times.get(name) ?? []), Number(seconds)]);
  }
  return times;
}

/** New weights: the median of what the logs say, else the old weight; only files that exist; whole seconds, at least 1. */
export function refreshWeights(specs: readonly string[], old: Readonly<Record<string, number>>, times: ReadonlyMap<string, readonly number[]>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const name of specs) {
    const seen = times.get(name);
    const seconds = seen !== undefined && seen.length > 0 ? median(seen) : old[name];
    if (seconds !== undefined) next[name] = Math.max(1, Math.round(seconds));
  }
  return next;
}

function describe(plan: Plan): string {
  return plan.parts.map((part, index) => `part ${index + 1}/${plan.parts.length}: ~${plan.seconds[index] ?? 0} s, ${part.length} files: ${part.join(' ')}`).join('\n');
}

function command(args: readonly string[]): void {
  const [what, count] = args;
  if (what === 'plan' && count !== undefined) {
    process.stdout.write(`${describe(planShards(listSpecs(), readWeights(), Number(count)))}\n`);
    return;
  }
  if (what === 'weights' && count === undefined) {
    const times = timesFromLog(readFileSync(0, 'utf8'));
    if (times.size === 0) throw new Error(`no «${TIME_LINE} <file> <seconds> passed» line on stdin — pipe in \`gh run view <run id> --log\``);
    const specs = listSpecs();
    const next = refreshWeights(specs, readWeights(), times);
    writeFileSync(WEIGHTS_FILE, `${JSON.stringify(next, null, 2)}\n`);
    const missing = specs.filter((name) => next[name] === undefined);
    process.stdout.write(`${WEIGHTS_FILE}: ${times.size} file(s) from the logs, ${Object.keys(next).length} weighed${missing.length === 0 ? '' : `, no weight yet: ${missing.join(' ')}`}\n`);
    return;
  }
  throw new Error('usage: node packages/testing/src/e2e-shards.ts plan <parts> | weights < CI logs');
}

if (import.meta.main) {
  try {
    command(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`e2e-shards: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
