// The feature manifest is complete (docs/project-unite/architecture.md §1.8
// «Полнота манифеста»; R20 F9b). Pure functions over the manifest, the
// vocabularies it is cut from and the sites' lazy builds; the data come from
// tools/gates/manifest.test.ts, which runs in `pnpm test` (the manifest's
// modules are contracts with extensionless imports: Vitest reads them, plain
// Node does not).
//
// Every AI operation of the hub (`FeatureId`, and a site's own when it has
// one), every owner switch of the hub, every surface our UI mounts, every
// action of the reference (the ActionCatalog) and every lazy entry of a site's
// build is mentioned by an entry: its key, a requirement or a switch of it, its
// surfaces, the reference's map of rows to features. What is the application's
// own — a page of the extension, the toasts, the cheatsheet, the base chunks a
// tab loads — is listed here, by name, and nothing else is let through: a new
// name is an entry or a line here.
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
 * protocol's schemas, the application, the texts, the AI and navigation controllers (the keys' sink and the
 * reference: a layer every tab loads — on ChatSpace it is also its feature's, R20 P7d), the boards' base, the dock's
 * own views, health, the dialogs and the cheatsheet. Every other chunk is named after a feature or a surface of the
 * site's slice.
 */
export const APPLICATION_CHUNKS: readonly string[] = [
  'bridge-validation',
  'tab-protocol',
  'tab-app',
  'i18n-ru',
  'i18n-en',
  'ai',
  'navigation',
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
 * Chunks a site's own build has for its application, of no one feature (by the site's host kind): Fansly's AI policy
 * (`ai-fansly`, R20 P8b1 — the proof of every start, loaded with the dock) and its floating launcher (`launcher`, X46). A name listed here that its site's build
 * no longer has is a violation too: the list only says what is.
 */
export const SITE_APPLICATION_CHUNKS: Readonly<Record<string, readonly string[]>> = {
  // X46: the floating launcher's buttons — the way into Spenders and «Новые», which carry their own entries.
  'fansly-web': ['ai-fansly', 'launcher'],
};

const GATE = 'feature-manifest';
const WHERE = 'packages/contracts/src/features';

function violation(message: string): Violation {
  return { gate: GATE, path: WHERE, line: 1, message: `${message} (docs/project-unite/architecture.md §1.8 «Полнота манифеста»).` };
}

const requirementsOf = (entry: ManifestEntry): readonly ManifestRequirement[] => [entry.base, ...Object.values(entry.actions).filter((requirement) => requirement !== undefined)];

/** Every name of the vocabularies is mentioned by an entry of some site, or is the application's own. */
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
    const siteOwn = SITE_APPLICATION_CHUNKS[site.site] ?? [];
    for (const chunk of site.lazyEntries) {
      if (!own.has(chunk) && !APPLICATION_CHUNKS.includes(chunk) && !siteOwn.includes(chunk)) violations.push(violation(`${site.site}'s lazy entry «${chunk}» carries no feature or surface of its slice and is not the application's own`));
    }
    for (const chunk of siteOwn) {
      if (!site.lazyEntries.includes(chunk)) violations.push(violation(`«${chunk}», listed as ${site.site}'s own application chunk, is no lazy entry of its build: drop it from tools/gates/manifest.ts`));
    }
  }
  return violations;
}
