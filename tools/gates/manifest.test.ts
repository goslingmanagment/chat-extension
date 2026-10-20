// The feature manifest is complete (docs/project-unite/architecture.md §1.8 «Полнота манифеста»; R20 F9b): every
// name of the vocabularies is mentioned by an entry or is the application's own. The rules on fixtures first, then
// this repository — the manifest's modules are read here, by Vitest.

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
import {
  APPLICATION_CHUNKS,
  SITE_APPLICATION_CHUNKS,
  APPLICATION_SURFACES,
  checkManifestNames,
  OPERATION_ENTRY,
  REFERENCE_OWN_ROWS,
  type ManifestEntry,
  type ManifestVocabularies,
  type SiteManifest,
} from './manifest.ts';

const NOTHING = { flags: [], hostCapabilities: [] };
const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({ base: NOTHING, actions: {}, surfaces: [], ...over });

/** A small world: two sites and a vocabulary each rule reads. */
const SITES: readonly SiteManifest[] = [
  {
    site: 'one',
    features: {
      reply: entry({ base: { flags: ['drafts'], hostCapabilities: [] }, surfaces: ['dock'], switches: ['splitAll'] }),
      recap: entry({ surfaces: ['dock', 'fan-panel'] }),
      board: entry({ surfaces: ['board'] }),
    },
    lazyEntries: ['dock', 'board', 'tab-app'],
  },
  { site: 'two', features: { reply: entry({ base: { flags: ['drafts'], hostCapabilities: [] }, surfaces: ['dock'] }), notes: entry({ surfaces: ['notes'] }) }, lazyEntries: null },
];
const VOCABULARIES: ManifestVocabularies = {
  operations: ['reply', 'recap', 'recap-short'],
  flags: ['drafts', 'splitAll'],
  surfaces: ['dock', 'fan-panel', 'board', 'notes', ...APPLICATION_SURFACES],
  referenceRows: ['reply', 'recap', 'chat-next', ...REFERENCE_OWN_ROWS],
  rowFeature: { 'chat-next': 'board' },
};
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

describe('this repo: the manifest is complete', () => {
  /** Each site's slice, by its host kind: a new kind does not typecheck until its slice is here. */
  const SLICES: { readonly [K in HostKind]: Readonly<Record<string, ManifestEntry>> } = {
    chatspace: CHATSPACE_FEATURES,
    'fansly-web': FANSLY_FEATURES,
  };
  const sites: SiteManifest[] = HOST_KINDS.map((kind) => {
    const registered = HOSTS.find((host) => host.kind === kind);
    return { site: kind, features: SLICES[kind], lazyEntries: registered === undefined ? null : Object.keys(registered.lazy.entries) };
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
    expect(SITE_APPLICATION_CHUNKS['fansly-web']).toEqual(['ai-fansly', 'launcher']);
    expect(messages(checkManifestNames([{ ...chatspace, lazyEntries: [...chatspace.lazyEntries, 'ai-fansly'] }, fansly], vocabularies))).toEqual([
      "chatspace's lazy entry «ai-fansly» carries no feature or surface of its slice and is not the application's own",
    ]);
    expect(messages(checkManifestNames([chatspace, { ...fansly, lazyEntries: fansly.lazyEntries.filter((chunk) => chunk !== 'ai-fansly') }], vocabularies))).toEqual([
      "«ai-fansly», listed as fansly-web's own application chunk, is no lazy entry of its build: drop it from tools/gates/manifest.ts",
    ]);
  });
});
