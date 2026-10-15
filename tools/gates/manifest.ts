// The feature manifest is complete (docs/project-unite/architecture.md §1.8
// «Полнота манифеста»; R20 F9b). Pure functions over the manifest, the
// vocabularies it is cut from, the sites' lazy builds and the parity rows; the
// data come from tools/gates/manifest.test.ts, which runs in `pnpm test` (the
// manifest's modules are contracts with extensionless imports: Vitest reads
// them, plain Node does not).
//
// 1. Names. Every AI operation of the hub (`FeatureId`, and a site's own when
//    it has one), every owner switch of the hub, every surface our UI mounts,
//    every action of the reference (the ActionCatalog) and every lazy entry of
//    a site's build is mentioned by an entry: its key, a requirement or a
//    switch of it, its surfaces, the reference's map of rows to features. What
//    is the application's own — a page of the extension, the toasts, the
//    cheatsheet, the base chunks a tab loads — is listed here, by name, and
//    nothing else is let through: a new name is an entry or a line here.
// 2. Parity and e2e. Every entry of a site's slice has its parity rows
//    (`FEATURE_PARITY`), each planned on the site's host; and once the owner of
//    one of them on that host is done (ChatSpace's work packages; a Fansly PR
//    marked ✓ in plan.md), an e2e spec on that site's stand names one of them.
//    The row by row closing is P1b's (`pnpm parity`); this is the bond between
//    an entry and its rows.
//
// Relative imports carry `.ts`: tools run under plain Node 26.

import type { Violation } from './checks.ts';

/** What a requirement of an entry names (contracts features/types.ts `Requirement`, by structure). */
export interface ManifestRequirement {
  readonly flags: readonly string[];
  readonly hostCapabilities: readonly string[];
}

/** An entry of a site's slice, its common part folded in (contracts features/types.ts `FeatureEntry`, by structure). */
export interface ManifestEntry {
  readonly base: ManifestRequirement;
  readonly actions: Readonly<Partial<Record<string, ManifestRequirement>>>;
  readonly surfaces: readonly string[];
  readonly switches?: readonly string[];
}

/** A site as the manifest has it. */
export interface SiteManifest {
  /** Its host kind. */
  readonly site: string;
  /** Its host in the parity rows (`chatspace` | `fansly`). */
  readonly host: string;
  readonly features: Readonly<Record<string, ManifestEntry>>;
  /** The entries of its lazy build (the host registry); null — the registry has no build of the site yet. */
  readonly lazyEntries: readonly string[] | null;
}

/** What the manifest must mention, from the contracts and the reference. */
export interface ManifestVocabularies {
  /** The hub's AI operations: `FEATURE_IDS`, and the sites' own operations. */
  readonly operations: readonly string[];
  /** The owner's switches of the hub, and the ones a site names ahead of them. */
  readonly flags: readonly string[];
  /** The surfaces our UI mounts, and the ones a site names ahead of them. */
  readonly surfaces: readonly string[];
  /** The actions of the reference (`CATALOG_ACTION_IDS`). */
  readonly referenceRows: readonly string[];
  /** The reference's own map of a row to the feature it belongs to, where that is not the row's own id (core hotkeys/cheatsheet.ts). */
  readonly rowFeature: Readonly<Partial<Record<string, string>>>;
}

/**
 * An operation that is a mode of another entry: Recap's short length is Recap (contracts features.test); Fansly's voice
 * script is the generation of its `voice` entry (contracts 1.15.0 P4b3, `FANSLY_OP_DRIVERS` of ops-fansly — this
 * gate's test holds the two to each other).
 */
export const OPERATION_ENTRY: Readonly<Record<string, string>> = { 'recap-short': 'recap', 'voice-script': 'voice' };

/** Surfaces of the application itself, of no feature: the extension's pages, the toasts, the cheatsheet. */
export const APPLICATION_SURFACES: readonly string[] = ['cheatsheet', 'toasts', 'popup', 'options', 'debug-prompt', 'journal'];

/**
 * Rows of the reference that are its own: the keys of a result and of the options before a generation, the windows of
 * the application, Help (removed, Б3), the search of a window and «Открыть и вставить» of a preview, which every site's
 * preview has.
 */
export const REFERENCE_OWN_ROWS: readonly string[] = [
  'cancel',
  'help',
  'tone',
  'split',
  'cheatsheet',
  'settings',
  'close',
  'part-step',
  'variant-step',
  'insert-part',
  'copy-part',
  'open-and-insert',
  'search',
];

/**
 * Chunks of a site's lazy build that are the application's own, of no one feature: the bridge's and the tab
 * protocol's schemas, the application, the texts, the AI controllers and the boards' base, the dock's own views,
 * health, the dialogs and the cheatsheet. Every other chunk is named after a feature or a surface of the site's slice.
 */
export const APPLICATION_CHUNKS: readonly string[] = [
  'bridge-validation',
  'tab-protocol',
  'tab-app',
  'i18n-ru',
  'i18n-en',
  'ai',
  'ai-analysis',
  'ai-coach',
  'tab-health',
  'boards',
  'boards-preview',
  'dock-analysis',
  'dock-debug',
  'dialogs',
  'cheatsheet',
];

/**
 * The parity rows of each entry (docs/parity, docs/project-unite/parity-matrix.md): the rows that state the feature
 * itself — the first is its own row — and, where that row is not checked in the browser on a site, the one that is.
 * A new entry does not pass until its rows are here.
 */
export const FEATURE_PARITY: Readonly<Record<string, readonly string[]>> = {
  reply: ['AI-001'],
  fix: ['AI-020'],
  hi: ['AI-030', 'HK-004'],
  ping: ['AI-035', 'HK-005'],
  review: ['AI-050'],
  recap: ['AI-060', 'AI-062'],
  coach: ['AI-080', 'AI-083'],
  // Fresh page text is a part of Reply, Fix, Hi and Ping (D-14): Reply's row, and the fan of the tab's context.
  'fresh-text': ['AI-001', 'RB-019'],
  spenders: ['SP-001', 'SP-035'],
  newcomers: ['NF-001', 'NF-020', 'NF-021'],
  'fan-panel': ['CS-031'],
  sound: ['SN-001', 'SN-012'],
  'preview-send': ['SP-054', 'X8-02'],
  navigation: ['HK-037'],
  palette: ['HK-036', 'CS-014'],
  voice: ['AI-110', 'AI-114'],
  notes: ['FX-004', 'FX-005'],
  'notes-fill': ['FX-014'],
  registration: ['FX-002'],
  vault: ['VA-001'],
  'via-tab': ['FX-001'],
};

const GATE = 'feature-manifest';
const WHERE = 'packages/contracts/src/features';

function violation(message: string): Violation {
  return { gate: GATE, path: WHERE, line: 1, message: `${message} (docs/project-unite/architecture.md §1.8 «Полнота манифеста»).` };
}

const requirementsOf = (entry: ManifestEntry): readonly ManifestRequirement[] => [entry.base, ...Object.values(entry.actions).filter((requirement) => requirement !== undefined)];

/** 1. Every name of the vocabularies is mentioned by an entry of some site, or is the application's own. */
export function checkManifestNames(sites: readonly SiteManifest[], vocabularies: ManifestVocabularies): Violation[] {
  const violations: Violation[] = [];
  const keys = new Set(sites.flatMap((site) => Object.keys(site.features)));
  const entries = sites.flatMap((site) => Object.values(site.features));

  for (const operation of vocabularies.operations) {
    const entry = OPERATION_ENTRY[operation] ?? operation;
    if (!keys.has(entry)) violations.push(violation(`the hub's operation «${operation}» is no entry of any site's slice`));
  }

  const named = new Set(entries.flatMap((entry) => [...requirementsOf(entry).flatMap((requirement) => requirement.flags), ...(entry.switches ?? [])]));
  for (const flag of vocabularies.flags) {
    if (!named.has(flag)) violations.push(violation(`the owner's switch «${flag}» is neither a requirement nor a switch of an entry: name it where the feature it shapes is`));
  }

  const surfaces = new Set(entries.flatMap((entry) => entry.surfaces));
  for (const surface of vocabularies.surfaces) {
    if (!surfaces.has(surface) && !APPLICATION_SURFACES.includes(surface)) violations.push(violation(`the surface «${surface}» is shown by no entry and is not the application's own`));
  }
  for (const surface of APPLICATION_SURFACES) {
    if (!vocabularies.surfaces.includes(surface)) violations.push(violation(`«${surface}», listed as the application's own surface, is no surface any more: drop it from tools/gates/manifest.ts`));
  }

  for (const row of vocabularies.referenceRows) {
    const feature = vocabularies.rowFeature[row] ?? (keys.has(row) ? row : null);
    if (feature === null) {
      if (!REFERENCE_OWN_ROWS.includes(row)) violations.push(violation(`the reference's row «${row}» belongs to no entry and is not the reference's own`));
    } else if (!keys.has(feature)) {
      violations.push(violation(`the reference's row «${row}» belongs to «${feature}», which no site's slice has`));
    }
  }
  for (const row of REFERENCE_OWN_ROWS) {
    if (!vocabularies.referenceRows.includes(row)) violations.push(violation(`«${row}», listed as the reference's own row, is no row of it any more: drop it from tools/gates/manifest.ts`));
  }

  for (const site of sites) {
    if (site.lazyEntries === null) continue;
    const own = new Set([...Object.keys(site.features), ...Object.values(site.features).flatMap((entry) => entry.surfaces)]);
    for (const chunk of site.lazyEntries) {
      if (!own.has(chunk) && !APPLICATION_CHUNKS.includes(chunk)) violations.push(violation(`${site.site}'s lazy entry «${chunk}» carries no feature or surface of its slice and is not the application's own`));
    }
  }
  return violations;
}

/** A parity row as the gate reads it (tools/parity/derive.ts `ManifestRow`, by structure). */
export interface ParityRow {
  readonly id: string;
  readonly [host: string]: unknown;
}

/** A host's plan of a row: its owner and its check. */
interface HostPlan {
  readonly owner?: string;
  readonly check: { readonly kind: string };
}

/** Checks a test of ours can close (tools/parity/hosts.ts `levelOfCheck`); `n/a`, `negative`, `hub` and `after-pilot` are none. */
const TESTABLE: readonly string[] = ['e2e', 'stand-visual', 'unit', 'shared', 'manual-smoke'];

export interface ParityFacts {
  readonly rows: readonly ParityRow[];
  /** The rows an e2e spec on each host's stand names (tools/parity/hosts.ts `placeOfTest`, browser level). */
  readonly browserRows: Readonly<Record<string, ReadonlySet<string>>>;
  /** Whether the owner of a row on a host is done: a work package of R00–R19; an R20 PR marked ✓ in plan.md. */
  readonly ownerDone: (owner: string) => boolean;
}

/** 2. Every entry of a site's slice has its parity rows, planned on the site's host, and its e2e on that site's stand. */
export function checkManifestParity(sites: readonly SiteManifest[], parity: ParityFacts, table: Readonly<Record<string, readonly string[]>> = FEATURE_PARITY): Violation[] {
  const violations: Violation[] = [];
  const byId = new Map(parity.rows.map((row) => [row.id, row]));
  const keys = new Set(sites.flatMap((site) => Object.keys(site.features)));
  for (const key of Object.keys(table)) if (!keys.has(key)) violations.push(violation(`«${key}» has parity rows in tools/gates/manifest.ts but is no entry of any site's slice: drop it`));
  for (const site of sites) {
    for (const key of Object.keys(site.features)) {
      const ids = table[key];
      if (ids === undefined || ids.length === 0) {
        violations.push(violation(`${site.site}: «${key}» names no parity row: add its rows to FEATURE_PARITY in tools/gates/manifest.ts`));
        continue;
      }
      const plans: { readonly id: string; readonly plan: HostPlan }[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row === undefined) {
          violations.push(violation(`${site.site}: «${key}» names the parity row ${id}, which docs/parity/parity-manifest.json does not have`));
          continue;
        }
        const plan = row[site.host] as HostPlan | null | undefined;
        if (plan !== null && plan !== undefined && TESTABLE.includes(plan.check.kind)) plans.push({ id, plan });
      }
      if (plans.length === 0) {
        violations.push(violation(`${site.site}: no parity row of «${key}» (${ids.join(', ')}) is planned on ${site.host} with a check a test closes`));
        continue;
      }
      const due = plans.some(({ plan }) => plan.owner !== undefined && parity.ownerDone(plan.owner));
      const browser = parity.browserRows[site.host] ?? new Set<string>();
      if (due && !ids.some((id) => browser.has(id))) {
        violations.push(violation(`${site.site}: «${key}» has no e2e on its stand — no spec on ${site.host} names ${ids.join(' or ')}, and its owner there is done`));
      }
    }
  }
  return violations;
}
