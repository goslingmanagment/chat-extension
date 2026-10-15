// Size budgets of architecture.md §11 (starting targets, re-approved after
// the baseline). Each site's scripts come with their own lines from the host
// registry (apps/extension/src/hosts: ChatSpace's MAIN bridge ≤ 10 KiB gzip,
// decision X11; its WS tap ≤ 6 KiB, X25; its isolated early bootstrap
// ≤ 30 KiB); the lazy chunks, in every site's own build: the first dock chunk
// with Preact ≤ 45 KiB, every other lazy chunk ≤ 30 KiB.
//
// What «a lazy chunk» weighs is what loading it adds to the tab, and a tab
// loads its own site's build alone (docs/project-unite/architecture.md §3.2),
// so each build is measured by itself, its lines named by its site. The
// entries every tab of the site loads form layers (the registry's
// `lazy.layers`; ChatSpace's: the dock, the protocol registry, the
// application, the AI and the navigation controllers): the first dock chunk
// is the dock's whole static closure, and each next layer is measured on top
// of the layers before it. Every other entry is loaded later, on demand, and
// is measured on top of all the layers — code it shares with them is already
// in memory. Entries loaded on demand share nothing for free: what two of them
// have in common is counted in both.
//
// The background is measured raw, as archive-check's tripwire is: the core
// (`background.js`, the vendored SDK's route contract and the services both
// sites need) under its signal threshold of 808 KiB, and each site's
// background chunk (`bg/<site>.js`, docs/project-unite/architecture.md §3.3)
// under its own ceiling from the host registry. The core's headroom to the
// threshold is the number every later PR that grows the core is checked
// against (the byte registry, architecture.md §3.2); it is printed with the
// line.

import { gzipSync } from 'node:zlib';

import { HOSTS, lazySitesOf, scriptsOf, type HostDescriptor, type LazySite } from '../../apps/extension/src/hosts/index.ts';
import { MAX_BACKGROUND_JS_BYTES } from '../archive-check/rules.ts';

export const KIB = 1024;

export interface LazyChunk {
  readonly file: string;
  readonly kind: 'entry' | 'chunk' | 'asset';
  readonly name: string | null;
  readonly imports: readonly string[];
  /** An entry every tab of its site loads: its place among the layers (0 — the dock). Absent — loaded on demand. */
  readonly layer?: number;
  /** Its site's lazy build (LazySite.site). */
  readonly site: string;
}

export interface BudgetLine {
  readonly label: string;
  readonly files: readonly string[];
  /** What the files weigh in the line's unit. */
  readonly bytes: number;
  /** `gzip` — gzip -9 (scripts, lazy chunks, contract probes); `raw` — the file as it ships (the background). */
  readonly unit: 'gzip' | 'raw';
  readonly limitBytes: number;
  readonly ok: boolean;
}

/** The lazy chunks' budgets; the sites' scripts have theirs in the host registry. */
export const BUDGETS = {
  firstDockChunk: 45 * KIB,
  lazyChunk: 30 * KIB,
} as const;

/** The background core: the event page itself. */
export const BACKGROUND_CORE = 'background.js';

/** The background lines, raw: the core under its signal threshold, then each site's chunk under its registry ceiling. */
export function backgroundBudgets(hosts: readonly HostDescriptor[] = HOSTS): Array<{ readonly label: string; readonly file: string; readonly limitBytes: number }> {
  return [
    { label: `background core (${BACKGROUND_CORE}), raw`, file: BACKGROUND_CORE, limitBytes: MAX_BACKGROUND_JS_BYTES },
    ...hosts.flatMap((host) => (host.background === undefined ? [] : [{ label: `background chunk of ${host.kind} (${host.background.file}), raw`, file: host.background.file, limitBytes: host.background.rawBytes }])),
  ];
}

/**
 * The budget lines of the sites' scripts, in the registry's order, each by its built file. Every script a site
 * declares has exactly one: a new script without its line fails here, not silently unmeasured.
 */
export function scriptBudgets(hosts: readonly HostDescriptor[] = HOSTS): Array<{ readonly label: string; readonly file: string; readonly limitBytes: number }> {
  return hosts.flatMap((host) => {
    for (const script of scriptsOf(host)) {
      const count = host.budgets.scripts.filter((budget) => budget.entry === script.entry).length;
      if (count !== 1) throw new Error(`size-budget: ${host.kind} script ${script.entry} has ${count} budget lines in the host registry, not one`);
    }
    return host.budgets.scripts.map((budget) => {
      const script = scriptsOf(host).find((spec) => spec.entry === budget.entry);
      if (script === undefined) throw new Error(`size-budget: ${host.kind} budgets ${budget.entry}, a script it does not declare`);
      return { label: budget.label, file: script.file, limitBytes: budget.gzipBytes };
    });
  });
}

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

export function computeBudgets(read: (file: string) => Uint8Array, chunks: readonly LazyChunk[], hosts: readonly HostDescriptor[] = HOSTS, sites: readonly LazySite[] = lazySitesOf(false, hosts)): BudgetLine[] {
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
    const bytes = files.reduce((sum, file) => sum + size(file), 0);
    return { label, files, bytes, unit: 'gzip', limitBytes, ok: bytes <= limitBytes };
  };

  const lines = scriptBudgets(hosts).map((budget) => line(budget.label, [budget.file], budget.limitBytes));
  const stray = chunks.filter((chunk) => !sites.some((site) => site.site === chunk.site));
  if (stray.length > 0) throw new Error(`size-budget: lazy files of no measured build: ${stray.map((chunk) => `${chunk.file} (${chunk.site})`).join(', ')}`);
  for (const site of sites) lines.push(...lazyBudgets(site, chunks.filter((chunk) => chunk.site === site.site), line));
  for (const budget of backgroundBudgets(hosts)) {
    const bytes = read(budget.file).byteLength;
    lines.push({ label: budget.label, files: [budget.file], bytes, unit: 'raw', limitBytes: budget.limitBytes, ok: bytes <= budget.limitBytes });
  }
  return lines;
}

/** One site's lazy build, measured by itself: a tab loads its own site's files only. */
function lazyBudgets(site: LazySite, chunks: readonly LazyChunk[], line: (label: string, files: readonly string[], limitBytes: number) => BudgetLine): BudgetLine[] {
  const lines: BudgetLine[] = [];
  const name = (chunk: LazyChunk): string => chunk.name ?? chunk.file;
  const loaded = new Set<string>();
  const [dockLayer] = site.build.layers;
  const dock = dockLayer === undefined ? undefined : `${site.build.root}/${dockLayer}.js`;
  if (dock !== undefined) {
    if (!chunks.some((chunk) => chunk.file === dock)) throw new Error(`lazy chunk list has no ${dock}`);
    const dockClosure = staticClosure(dock, chunks);
    lines.push(line(`${site.site}: first dock chunk with Preact (${site.build.root}/${dockLayer} + shared)`, dockClosure, BUDGETS.firstDockChunk));
    for (const file of dockClosure) loaded.add(file);
  }
  // The layers after the dock, each on top of the ones before it.
  const entries = chunks.filter((chunk) => chunk.kind === 'entry' && chunk.file !== dock);
  const layers = entries.filter((chunk) => chunk.layer !== undefined).sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
  for (const chunk of layers) {
    const closure = staticClosure(chunk.file, chunks);
    lines.push(line(`${site.site}: lazy layer ${name(chunk)} (beyond the layers before it)`, closure.filter((file) => !loaded.has(file)), BUDGETS.lazyChunk));
    for (const file of closure) loaded.add(file);
  }
  // Everything else comes on demand, after all the layers.
  for (const chunk of entries.filter((item) => item.layer === undefined)) {
    const extra = staticClosure(chunk.file, chunks).filter((file) => !loaded.has(file));
    lines.push(line(`${site.site}: lazy chunk ${name(chunk)} (beyond the layers)`, extra, BUDGETS.lazyChunk));
  }
  return lines;
}
