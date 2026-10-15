// The feature manifest is complete (docs/project-unite/architecture.md §1.8 «Полнота манифеста»; R20 F9b): every
// name of the vocabularies is mentioned by an entry or is the application's own, and every entry of a site's slice has
// its parity rows, planned on the site's host, with an e2e on that site's stand once its owner there is done. The
// rules on fixtures first, then this repository — the manifest's modules are read here, by Vitest.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HOSTS } from '../../apps/extension/src/hosts/index.ts';
import { FEATURE_IDS } from '../../packages/contracts/src/features.ts';
import { CHATSPACE_FEATURES } from '../../packages/contracts/src/features/chatspace.ts';
import { FANSLY_FEATURES, FANSLY_SURFACES_AHEAD } from '../../packages/contracts/src/features/fansly.ts';
import { HOST_KINDS, type HostKind } from '../../packages/contracts/src/hosts.ts';
import { CLIENT_FEATURE_FLAG_NAMES } from '../../packages/contracts/src/hub/wire.ts';
import { FANSLY_OP_DRIVERS, FANSLY_OPS } from '../../packages/contracts/src/ops-fansly.ts';
import { CATALOG_ACTION_IDS } from '../../packages/contracts/src/vm/catalog.ts';
import { MOUNT_SURFACES } from '../../packages/contracts/src/vm/selectors.ts';
import { ROW_FEATURE } from '../../packages/core/src/domain/hotkeys/cheatsheet.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import { MANIFEST_PATH, prOfOwner, type ManifestRow } from '../parity/derive.ts';
import { closes, placeOfTest, type Host } from '../parity/hosts.ts';
import { parsePlanPrs } from '../parity/matrix.ts';
import { readPlanPrs } from '../parity/plan.ts';
import { readTestFiles } from '../parity/test-files.ts';
import {
  APPLICATION_CHUNKS,
  SITE_APPLICATION_CHUNKS,
  APPLICATION_SURFACES,
  checkManifestNames,
  checkManifestParity,
  FEATURE_PARITY,
  OPERATION_ENTRY,
  REFERENCE_OWN_ROWS,
  type ManifestEntry,
  type ManifestVocabularies,
  type ParityFacts,
  type SiteManifest,
} from './manifest.ts';

const NOTHING = { flags: [], hostCapabilities: [] };
const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({ base: NOTHING, actions: {}, surfaces: [], ...over });

/** A small world: two sites, a vocabulary each rule reads, rows on both hosts. */
const SITES: readonly SiteManifest[] = [
  {
    site: 'one',
    host: 'chatspace',
    features: {
      reply: entry({ base: { flags: ['drafts'], hostCapabilities: [] }, surfaces: ['dock'], switches: ['splitAll'] }),
      recap: entry({ surfaces: ['dock', 'fan-panel'] }),
      board: entry({ surfaces: ['board'] }),
    },
    lazyEntries: ['dock', 'board', 'tab-app'],
  },
  { site: 'two', host: 'fansly', features: { reply: entry({ base: { flags: ['drafts'], hostCapabilities: [] }, surfaces: ['dock'] }), notes: entry({ surfaces: ['notes'] }) }, lazyEntries: null },
];
const VOCABULARIES: ManifestVocabularies = {
  operations: ['reply', 'recap', 'recap-short'],
  flags: ['drafts', 'splitAll'],
  surfaces: ['dock', 'fan-panel', 'board', 'notes', ...APPLICATION_SURFACES],
  referenceRows: ['reply', 'recap', 'chat-next', ...REFERENCE_OWN_ROWS],
  rowFeature: { 'chat-next': 'board' },
};
const TABLE = { reply: ['R-1'], recap: ['R-2'], board: ['R-3'], notes: ['N-1'] };
const plan = (owner: string, kind: string) => ({ owner, check: { kind } });
const ROWS: ParityFacts['rows'] = [
  { id: 'R-1', chatspace: plan('R11', 'unit'), fansly: plan('R20/P8b3', 'e2e') },
  { id: 'R-2', chatspace: plan('R12', 'unit'), fansly: plan('R20/P8c', 'shared') },
  { id: 'R-3', chatspace: plan('R13', 'e2e'), fansly: { check: { kind: 'n/a' } } },
  { id: 'N-1', chatspace: { check: { kind: 'n/a' } }, fansly: plan('R20/P11b', 'e2e') },
];
const FACTS: ParityFacts = { rows: ROWS, browserRows: { chatspace: new Set(['R-1', 'R-2', 'R-3']), fansly: new Set() }, ownerDone: (owner) => prOfOwner(owner) === null };
const messages = (violations: readonly { readonly message: string }[]): string[] => violations.map((violation) => violation.message.replace(/ \(docs\/project-unite.*$/, ''));

describe('gate: the manifest names everything (architecture §1.8, F9b)', () => {
  it('a complete world passes', () => {
    expect(checkManifestNames(SITES, VOCABULARIES)).toEqual([]);
  });

  it('an operation, a switch, a surface, a row of the reference or a chunk no entry names is red', () => {
    const vocabularies = {
      ...VOCABULARIES,
      operations: [...VOCABULARIES.operations, 'voice-script'],
      flags: [...VOCABULARIES.flags, 'stats'],
      surfaces: [...VOCABULARIES.surfaces, 'vault'],
      referenceRows: [...VOCABULARIES.referenceRows, 'chat-previous', 'next-unread'],
      rowFeature: { ...VOCABULARIES.rowFeature, 'next-unread': 'navigation' },
    };
    const sites = [{ ...SITES[0]!, lazyEntries: [...(SITES[0]!.lazyEntries ?? []), 'notes'] }, SITES[1]!];
    expect(messages(checkManifestNames(sites, vocabularies))).toEqual([
      "the hub's operation «voice-script» is no entry of any site's slice",
      "the owner's switch «stats» is neither a requirement nor a switch of an entry: name it where the feature it shapes is",
      "the surface «vault» is shown by no entry and is not the application's own",
      "the reference's row «chat-previous» belongs to no entry and is not the reference's own",
      "the reference's row «next-unread» belongs to «navigation», which no site's slice has",
      "one's lazy entry «notes» carries no feature or surface of its slice and is not the application's own",
    ]);
  });

  it('a switch counts as named, so does a requirement; Recap’s short length is Recap', () => {
    const noSwitch = [{ ...SITES[0]!, features: { ...SITES[0]!.features, reply: entry({ surfaces: ['dock'] }) } }, { ...SITES[1]!, features: { notes: entry({ surfaces: ['notes'] }) } }];
    expect(messages(checkManifestNames(noSwitch, VOCABULARIES)).filter((message) => message.includes('switch'))).toEqual([
      "the owner's switch «drafts» is neither a requirement nor a switch of an entry: name it where the feature it shapes is",
      "the owner's switch «splitAll» is neither a requirement nor a switch of an entry: name it where the feature it shapes is",
    ]);
    const noRecap = [{ ...SITES[0]!, features: { reply: SITES[0]!.features['reply']!, board: SITES[0]!.features['board']! } }, SITES[1]!];
    expect(messages(checkManifestNames(noRecap, VOCABULARIES)).filter((message) => message.includes('operation'))).toEqual([
      "the hub's operation «recap» is no entry of any site's slice",
      "the hub's operation «recap-short» is no entry of any site's slice",
    ]);
  });

  it('the application’s own lists stay true: a name that left the vocabulary leaves them too', () => {
    const vocabularies = { ...VOCABULARIES, surfaces: VOCABULARIES.surfaces.filter((surface) => surface !== 'journal'), referenceRows: VOCABULARIES.referenceRows.filter((row) => row !== 'help') };
    expect(messages(checkManifestNames(SITES, vocabularies))).toEqual([
      "«journal», listed as the application's own surface, is no surface any more: drop it from tools/gates/manifest.ts",
      "«help», listed as the reference's own row, is no row of it any more: drop it from tools/gates/manifest.ts",
    ]);
  });
});

describe('gate: every entry has its parity rows and its e2e (architecture §1.8, F9b; with P1b)', () => {
  it('a world with its rows planned and its e2e where the owner is done passes', () => {
    expect(checkManifestParity(SITES, FACTS, TABLE)).toEqual([]);
  });

  it('an entry without rows, a row the manifest lacks and rows a site does not plan are red', () => {
    const { board: _board, ...withoutBoard } = TABLE;
    expect(messages(checkManifestParity(SITES, FACTS, { ...withoutBoard, recap: ['R-9'], notes: ['R-3'], gone: ['R-1'] }))).toEqual([
      "«gone» has parity rows in tools/gates/manifest.ts but is no entry of any site's slice: drop it",
      'one: «recap» names the parity row R-9, which docs/parity/parity-manifest.json does not have',
      'one: no parity row of «recap» (R-9) is planned on chatspace with a check a test closes',
      'one: «board» names no parity row: add its rows to FEATURE_PARITY in tools/gates/manifest.ts',
      'two: no parity row of «notes» (R-3) is planned on fansly with a check a test closes',
    ]);
  });

  it('the e2e on a site’s stand is due once an owner there is done: including a Fansly PR with a done file', () => {
    const noE2e: ParityFacts = { ...FACTS, browserRows: { chatspace: new Set(['R-2', 'R-3']), fansly: new Set() } };
    expect(messages(checkManifestParity(SITES, noE2e, TABLE))).toEqual(['one: «reply» has no e2e on its stand — no spec on chatspace names R-1, and its owner there is done']);
    // Fansly's rows: nothing is due while their PRs are open; P8b3 marked done asks for its e2e on Fansly's stand.
    const done = parsePlanPrs('# Plan\n## 2. PR по этапам\n| P8b3 | reply |\n', ['P8b3']).done;
    const p8b3: ParityFacts = { ...FACTS, ownerDone: (owner) => prOfOwner(owner) === null || done.has(prOfOwner(owner) ?? '') };
    expect(messages(checkManifestParity(SITES, p8b3, TABLE))).toEqual(['two: «reply» has no e2e on its stand — no spec on fansly names R-1, and its owner there is done']);
  });
});

describe('this repo: the manifest is complete', () => {
  /** Each site's slice, by its host kind: a new kind does not typecheck until its slice is here. */
  const SLICES: { readonly [K in HostKind]: { readonly features: Readonly<Record<string, ManifestEntry>>; readonly host: Host } } = {
    chatspace: { features: CHATSPACE_FEATURES, host: 'chatspace' },
    'fansly-web': { features: FANSLY_FEATURES, host: 'fansly' },
  };
  const sites: SiteManifest[] = HOST_KINDS.map((kind) => {
    const registered = HOSTS.find((host) => host.kind === kind);
    return { site: kind, host: SLICES[kind].host, features: SLICES[kind].features, lazyEntries: registered === undefined ? null : Object.keys(registered.lazy.entries) };
  });

  it('every operation, switch, surface, row of the reference and lazy entry is an entry’s or the application’s own', () => {
    const vocabularies: ManifestVocabularies = {
      // The shared features and the operations of Fansly's slice (contracts 1.15.0, P4b3); Fansly's switches are in the vocabulary since then.
      operations: [...FEATURE_IDS, ...FANSLY_OPS],
      flags: CLIENT_FEATURE_FLAG_NAMES,
      surfaces: [...MOUNT_SURFACES, ...FANSLY_SURFACES_AHEAD],
      referenceRows: CATALOG_ACTION_IDS,
      rowFeature: ROW_FEATURE,
    };
    expect(messages(checkManifestNames(sites, vocabularies))).toEqual([]);
    // A site's operation is admitted by the entry its driver names, and the gate reads it as that entry.
    for (const op of FANSLY_OPS) expect(OPERATION_ENTRY[op] ?? op, op).toBe(FANSLY_OP_DRIVERS[op].feature);
    // Every site the registry builds is checked chunk by chunk (Fansly's build came with P7a0).
    expect(sites.map((site) => [site.site, site.lazyEntries === null ? null : site.lazyEntries.length > 0])).toEqual([
      ['chatspace', true],
      ['fansly-web', true],
    ]);
    for (const chunk of APPLICATION_CHUNKS) expect(sites[0]?.lazyEntries, chunk).toContain(chunk);
    // A site's own application chunk is its build's alone (R20 P8b1: Fansly's AI policy): on another site's build it is
    // a chunk of nothing, and a listed one its build lost is said.
    const [chatspace, fansly] = sites;
    if (chatspace === undefined || fansly === undefined || chatspace.lazyEntries === null || fansly.lazyEntries === null) throw new Error('both builds');
    expect(SITE_APPLICATION_CHUNKS['fansly-web']).toEqual(['ai-fansly']);
    expect(messages(checkManifestNames([{ ...chatspace, lazyEntries: [...chatspace.lazyEntries, 'ai-fansly'] }, fansly], vocabularies))).toEqual([
      "chatspace's lazy entry «ai-fansly» carries no feature or surface of its slice and is not the application's own",
    ]);
    expect(messages(checkManifestNames([chatspace, { ...fansly, lazyEntries: fansly.lazyEntries.filter((chunk) => chunk !== 'ai-fansly') }], vocabularies))).toEqual([
      "«ai-fansly», listed as fansly-web's own application chunk, is no lazy entry of its build: drop it from tools/gates/manifest.ts",
    ]);
  });

  it('every entry of every site has its parity rows, planned on its host, and its e2e on its stand where its owner is done', () => {
    const rows = (JSON.parse(readFileSync(`${REPO_ROOT}${MANIFEST_PATH}`, 'utf8')) as { rows: ManifestRow[] }).rows;
    const browserRows: Record<Host, Set<string>> = { chatspace: new Set(), fansly: new Set() };
    for (const file of readTestFiles(REPO_ROOT)) {
      const { place } = placeOfTest(file.path, file.hosts);
      for (const host of ['chatspace', 'fansly'] as const) if (closes(place, host, 'e2e')) for (const tag of file.tags) browserRows[host].add(tag);
    }
    const done = readPlanPrs(REPO_ROOT).done;
    const ownerDone = (owner: string): boolean => {
      const pr = prOfOwner(owner);
      return pr === null || done.has(pr);
    };
    expect(messages(checkManifestParity(sites, { rows: rows as unknown as ParityFacts['rows'], browserRows, ownerDone }))).toEqual([]);
    // Every entry of both sites is in the table, and nothing else is.
    expect(Object.keys(FEATURE_PARITY).sort()).toEqual([...new Set(sites.flatMap((site) => Object.keys(site.features)))].sort());
  });
});
