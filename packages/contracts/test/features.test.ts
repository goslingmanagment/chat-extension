// The feature manifest (src/features, 1.15.0, R20 F4; docs/project-unite/architecture.md §1.4): the common part and
// one file per site use the known vocabularies, a site's file says nothing of the other site, the features the plan
// names are entered in full for both sites, and what is left of the client's flag table is its own transport need.

import { NON_CHATSPACE_FEATURE_FLAGS } from './fixtures/feature-flags';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { FANSLY_CAPABILITIES } from '../src/fansly';
import { CHATSPACE_FEATURE_FLAGS, CHATSPACE_FEATURES, type ChatSpaceFeatureFlag, type ChatSpaceFeatureKey } from '../src/features/chatspace';
import { FEATURES_COMMON, type CommonFeatureKey } from '../src/features/common';
import { FANSLY_FEATURES, FANSLY_SURFACES_AHEAD, type FanslyFeatureKey } from '../src/features/fansly';
import * as F from '../src/features/types';
import * as C from '../src/index';
import { DOCK_CHIP_SAMPLES, REQUIREMENT_SAMPLES, SITE_FILE_SAMPLES } from './fixtures/features';

type Entry = F.FeatureOnHost<string, string, string> & Partial<F.FeatureCommon>;
/** Fansly's own switches (hub HF-12, HF-4б, HF-2): in the shared vocabulary since P4b3, named by Fansly's file alone. */
const FANSLY_FLAGS = NON_CHATSPACE_FEATURE_FLAGS;
const SITES: readonly { readonly site: string; readonly file: Readonly<Record<string, Entry>>; readonly flags: readonly string[]; readonly capabilities: readonly string[]; readonly surfaces: readonly string[] }[] = [
  { site: 'chatspace', file: CHATSPACE_FEATURES, flags: CHATSPACE_FEATURE_FLAGS, capabilities: C.HOST_CAPABILITIES, surfaces: C.MOUNT_SURFACES },
  {
    site: 'fansly',
    file: FANSLY_FEATURES,
    flags: C.CLIENT_FEATURE_FLAG_NAMES,
    capabilities: [...C.HOST_CAPABILITIES, ...FANSLY_CAPABILITIES],
    surfaces: [...C.MOUNT_SURFACES, ...FANSLY_SURFACES_AHEAD],
  },
];
const requirementsOf = (entry: Entry): readonly F.Requirement<string, string>[] => [entry.base, ...Object.values(entry.actions)];
const common: Readonly<Record<string, F.FeatureCommon>> = FEATURES_COMMON;
/** A feature as a site's slice has it: the common part with the site's own. */
const whole = (id: string, entry: Entry): Partial<F.FeatureCommon> => ({ ...common[id], ...entry });

describe('the feature manifest: vocabularies', () => {
  it('lists the kinds, the actions and the scheme keys once each', () => {
    for (const list of [F.FEATURE_KINDS, F.ADMISSION_ACTIONS, F.HOTKEY_ACTION_IDS, C.DOCK_CHIP_GROUPS, C.DOCK_ICON_IDS]) expect(new Set<string>(list).size).toBe(list.length);
    expect(F.ADMISSION_ACTIONS).toEqual(['generate', 'insert', 'send']);
    // The bar's order: Reply and its options, the draft's tools, the openers, what is known about the fan — and the windows at the right end.
    expect(C.DOCK_CHIP_GROUPS).toEqual(['reply', 'draft', 'openers', 'analysis', 'windows']);
  });

  it('the common part names a kind, and a chip and a key only from their lists', () => {
    for (const [id, feature] of Object.entries(common)) {
      expect(F.FEATURE_KINDS, id).toContain(feature.kind);
      if (feature.chip !== undefined) {
        expect(C.DOCK_CHIP_GROUPS, id).toContain(feature.chip.group);
        expect(feature.chip.icon === null || C.DOCK_ICON_IDS.includes(feature.chip.icon), id).toBe(true);
        expect(Number.isInteger(feature.chip.priority) && feature.chip.priority > 0, id).toBe(true);
      }
      if (feature.hotkey !== undefined) expect(F.HOTKEY_ACTION_IDS, id).toContain(feature.hotkey);
    }
    // The seven frozen actions of the dock are common features with a chip; their order in the bar is the frozen one.
    const chips = Object.entries(common)
      .flatMap(([id, feature]) => (feature.chip === undefined ? [] : [{ id, ...feature.chip }]))
      .sort((a, b) => C.DOCK_CHIP_GROUPS.indexOf(a.group) - C.DOCK_CHIP_GROUPS.indexOf(b.group) || a.priority - b.priority);
    expect(chips.map((chip) => chip.id)).toEqual([...C.DOCK_ACTION_IDS, 'spenders', 'newcomers']);
    // Every AI feature of the vocabulary is a common feature (the two lengths of Recap are one).
    for (const feature of C.FEATURE_IDS) expect(common[feature === 'recap-short' ? 'recap' : feature]?.kind, feature).toBe('ai');
  });

  for (const { site, file, flags, capabilities, surfaces } of SITES) {
    it(`${site}: every switch, capability, surface and client need is a known name; nothing is entered twice`, () => {
      for (const [id, entry] of Object.entries(file)) {
        for (const requirement of requirementsOf(entry)) {
          for (const flag of requirement.flags) expect(flags, `${id}: ${flag}`).toContain(flag);
          for (const capability of requirement.hostCapabilities) expect(capabilities, `${id}: ${capability}`).toContain(capability);
          for (const need of requirement.clientNeeds ?? []) expect(C.CLIENT_HUB_CAPABILITY_NAMES, `${id}: ${need}`).toContain(need);
          expect(new Set(requirement.flags).size, id).toBe(requirement.flags.length);
        }
        for (const action of Object.keys(entry.actions)) expect(F.ADMISSION_ACTIONS, `${id}: ${action}`).toContain(action);
        // 1.15.0 (F9b): a switch that shapes the feature is a known name, once, and never also one of its requirements.
        for (const flag of entry.switches ?? []) expect(flags, `${id}: switch ${flag}`).toContain(flag);
        expect(new Set(entry.switches ?? []).size, id).toBe((entry.switches ?? []).length);
        for (const flag of entry.switches ?? []) expect(requirementsOf(entry).flatMap((requirement) => requirement.flags), `${id}: ${flag}`).not.toContain(flag);
        for (const surface of entry.surfaces) expect(surfaces, `${id}: ${surface}`).toContain(surface);
        // A feature of both sites takes its kind, chip and key from the common part; a feature only this site has brings its own.
        expect(id in common, id).toBe(entry.kind === undefined);
        if (id in common) expect([entry.chip, entry.hotkey], id).toEqual([undefined, undefined]);
        const feature = whole(id, entry);
        expect(F.FEATURE_KINDS, id).toContain(feature.kind);
        if (feature.chip !== undefined) expect(C.DOCK_CHIP_GROUPS, id).toContain(feature.chip.group);
        if (feature.hotkey !== undefined) expect(F.HOTKEY_ACTION_IDS, id).toContain(feature.hotkey);
      }
      // No two chips of one site share a place in the bar.
      const places = Object.entries(file).flatMap(([id, entry]) => {
        const chip = whole(id, entry).chip;
        return chip === undefined ? [] : [`${chip.group}:${chip.priority}`];
      });
      expect(new Set(places).size).toBe(places.length);
    });
  }

  it('Fansly’s own switches are in the shared vocabulary since P4b3, its surfaces still ahead of it (the panels’ PRs move them there)', () => {
    for (const flag of FANSLY_FLAGS) expect(C.CLIENT_FEATURE_FLAG_NAMES, flag).toContain(flag);
    for (const surface of FANSLY_SURFACES_AHEAD) expect(C.MOUNT_SURFACES as readonly string[]).not.toContain(surface);
    // Each of the six is asked by a Fansly entry: the drafts, the voice, the notes and their fill, the vault, «Регистрация».
    const asked = new Set(Object.values(FANSLY_FEATURES as Readonly<Record<string, Entry>>).flatMap((entry) => requirementsOf(entry).flatMap((requirement) => requirement.flags)));
    for (const flag of FANSLY_FLAGS) expect(asked.has(flag), flag).toBe(true);
  });
});

describe('the feature manifest: one file per site', () => {
  it('the manifest is its subpaths alone: the root — what the early isolated start imports — carries none of it', () => {
    for (const name of ['FEATURES_COMMON', 'CHATSPACE_FEATURES', 'FANSLY_FEATURES', 'FANSLY_SURFACES_AHEAD', ...Object.keys(F)]) expect(name in C, name).toBe(false);
    // The chips' vocabularies are the dock view model's and come with it.
    expect([C.DOCK_CHIP_GROUPS.length, C.DOCK_ICON_IDS.length]).toEqual([5, 5]);
  });

  it('a feature only one site has is in that site’s file and in no other', () => {
    const only = (file: object, other: object): string[] => Object.keys(file).filter((id) => !(id in common) && !(id in other));
    // 1.21.0 (X48): who sent each message — ChatSpace's for now; Fansly's is a later task.
    expect(only(CHATSPACE_FEATURES, FANSLY_FEATURES)).toEqual(['send-attribution', 'preview-send', 'navigation', 'palette']);
    expect(only(FANSLY_FEATURES, CHATSPACE_FEATURES)).toEqual(['voice', 'notes', 'notes-fill', 'registration', 'vault', 'via-tab']);
    // Every common feature has its part on both sites today.
    for (const id of Object.keys(common)) expect([id in CHATSPACE_FEATURES, id in FANSLY_FEATURES], id).toEqual([true, true]);
    expectTypeOf<Extract<ChatSpaceFeatureKey, FanslyFeatureKey>>().toEqualTypeOf<CommonFeatureKey>();
  });

  it('ChatSpace’s file names nothing of Fansly: no switch, capability or surface the shared vocabularies do not have', () => {
    const text = JSON.stringify(CHATSPACE_FEATURES);
    for (const name of [...FANSLY_FLAGS, ...FANSLY_SURFACES_AHEAD, 'fileAttach', 'headerSlot', 'relay', 'host-pass']) expect(text, name).not.toContain(`"${name}"`);
  });
});

describe('the feature manifest: the entries F4 writes in full, for both sites (architecture §1.4, §11.1)', () => {
  const NOTHING = { flags: [], hostCapabilities: [] };
  const INSERT = { flags: ['insertion'], hostCapabilities: ['insert'] };
  const X8 = { flags: ['previewSend'], hostCapabilities: ['previewSend', 'receipt'] };

  it('reply: no switch of its own on ChatSpace, `drafts` on Fansly; an insert asks `insertion` on both', () => {
    expect(FEATURES_COMMON.reply).toEqual({ kind: 'ai', chip: { group: 'reply', priority: 10, icon: null }, hotkey: 'reply' });
    expect(CHATSPACE_FEATURES.reply).toEqual({ base: NOTHING, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'preview'], source: 'hub', switches: ['splitAll'] });
    expect(FANSLY_FEATURES.reply).toEqual({ base: { flags: ['drafts'], hostCapabilities: [] }, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' });
    // The four drafts are admitted alike on a site — but Hi on Fansly, which the hub decides by the start proof (R20 P8c).
    for (const id of ['fix', 'hi', 'ping'] as const) {
      expect([CHATSPACE_FEATURES[id].base, CHATSPACE_FEATURES[id].actions], id).toEqual([CHATSPACE_FEATURES.reply.base, CHATSPACE_FEATURES.reply.actions]);
      const fansly = id === 'hi' ? { ...FANSLY_FEATURES.reply.actions, generate: { ...NOTHING, clientNeeds: ['hi-start-proof-v1'] } } : FANSLY_FEATURES.reply.actions;
      expect([FANSLY_FEATURES[id].base, FANSLY_FEATURES[id].actions], id).toEqual([FANSLY_FEATURES.reply.base, fansly]);
    }
  });

  it('newcomers: the hub’s list and a greeting through X8 on ChatSpace; a pass of the background and `newcomers` alone on Fansly', () => {
    expect(FEATURES_COMMON.newcomers).toEqual({ kind: 'board', chip: { group: 'windows', priority: 20, icon: 'userPlus' } });
    expect(CHATSPACE_FEATURES.newcomers).toEqual({ base: { flags: ['newcomers'], hostCapabilities: [] }, actions: { send: X8 }, surfaces: ['newcomers', 'preview'], source: 'hub', switches: ['preview'] });
    expect(FANSLY_FEATURES.newcomers).toEqual({ base: { flags: ['newcomers'], hostCapabilities: [] }, actions: { send: NOTHING }, surfaces: ['newcomers'], source: 'host-pass' });
  });

  it('preview-send: X8 is ChatSpace’s — its switch, its queue and a receipt profile; Fansly has none', () => {
    expect(CHATSPACE_FEATURES['preview-send']).toEqual({
      kind: 'host-action',
      base: X8,
      actions: { send: NOTHING },
      surfaces: ['preview', 'newcomers'],
      source: 'page',
      switches: ['wsTap', 'previewSendMarkAiGenerated'],
    });
    expect('preview-send' in FANSLY_FEATURES).toBe(false);
    expect(JSON.stringify(FANSLY_FEATURES)).not.toContain('previewSend');
  });

  it('voice: Fansly’s — the page’s `voice`, a script and its voicing from the hub, the file into the field; ChatSpace has none', () => {
    expect(FANSLY_FEATURES.voice).toEqual({
      kind: 'panel',
      chip: { group: 'draft', priority: 20, icon: null },
      base: { flags: ['voice'], hostCapabilities: [] },
      actions: { generate: NOTHING, insert: { flags: [], hostCapabilities: ['fileAttach'] } },
      surfaces: ['voice'],
      source: 'hub',
    });
    expect('voice' in CHATSPACE_FEATURES).toBe(false);
  });

  it('notes-fill: Fansly’s — the page’s `notesFill`, a generation of the hub in the notes panel; ChatSpace has none', () => {
    expect(FANSLY_FEATURES['notes-fill']).toEqual({ kind: 'ai', base: { flags: ['notesFill'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['notes'], source: 'hub' });
    expect(FANSLY_FEATURES.notes.base.flags).toEqual(['notes']);
    expect('notes-fill' in CHATSPACE_FEATURES || 'notes' in CHATSPACE_FEATURES).toBe(false);
  });

  it('human-send (R20 P7i): how a site sees a part sent by hand — ChatSpace’s socket, under the page’s `wsTap`; Fansly’s MAIN, under no switch of the owner', () => {
    expect(FEATURES_COMMON['human-send']).toEqual({ kind: 'service' });
    expect(CHATSPACE_FEATURES['human-send']).toEqual({ base: { flags: ['wsTap'], hostCapabilities: ['sendObserve'] }, actions: {}, surfaces: [], source: 'page' });
    expect(FANSLY_FEATURES['human-send']).toEqual({ base: { flags: [], hostCapabilities: ['sendObserve'] }, actions: {}, surfaces: [], source: 'page' });
  });

  it('the rest of the table: the analysis features, the windows and the services ask their own switch on both sites', () => {
    const flagsOf = (file: Readonly<Record<string, Entry>>): Record<string, readonly string[]> => Object.fromEntries(Object.entries(file).map(([id, entry]) => [id, entry.base.flags]));
    const shared = { review: ['review'], recap: ['recap'], coach: ['coach'], spenders: ['spenders'], 'fan-panel': ['fanPanel'], sound: ['sound'], newcomers: ['newcomers'], 'fresh-text': ['freshText'] };
    expect(flagsOf(CHATSPACE_FEATURES)).toMatchObject({ ...shared, reply: [], navigation: ['navigation'], palette: [] });
    expect(flagsOf(FANSLY_FEATURES)).toMatchObject({ ...shared, reply: ['drafts'], registration: ['registration'], vault: ['vault'], 'via-tab': [] });
  });
});

describe('what is left of the client’s flag table: its own transport need', () => {
  it('fresh text needs `context-v1`, and the manifest names it as the client need of `fresh-text` on both sites — and, on Fansly, `hi-start-proof-v1` for generating Hi (R20 P8c), on ChatSpace `send-attribution-v1` for who sent each message (X48) — of nothing else', () => {
    expect(C.CLIENT_FLAG_REQUIREMENTS).toEqual({ freshText: ['context-v1'] });
    expect(FANSLY_FEATURES.hi.actions.generate).toEqual({ flags: [], hostCapabilities: [], clientNeeds: ['hi-start-proof-v1'] });
    for (const { site, file } of SITES) {
      const needy = Object.entries(file).filter(([, entry]) => requirementsOf(entry).some((requirement) => requirement.clientNeeds !== undefined));
      expect(needy.map(([id]) => id), site).toEqual(file === FANSLY_FEATURES ? ['hi', 'fresh-text'] : ['fresh-text', 'send-attribution']);
      expect(file['fresh-text']?.base, site).toEqual({ flags: ['freshText'], hostCapabilities: [], clientNeeds: C.CLIENT_FLAG_REQUIREMENTS.freshText });
    }
    expect(CHATSPACE_FEATURES['send-attribution'].base).toEqual({ flags: ['wsTap'], hostCapabilities: ['sendObserve'], clientNeeds: ['send-attribution-v1'] });
  });
});

describe('the fixtures of the manifest and of the chips', () => {
  it('a requirement, a site’s file and a chip: what fits and what the compiler refuses', () => {
    expect(REQUIREMENT_SAMPLES.valid.length).toBeGreaterThan(0);
    expect(REQUIREMENT_SAMPLES.invalid).toHaveLength(4);
    expect(Object.keys(SITE_FILE_SAMPLES.valid)).toEqual(['chatspace', 'fansly']);
    expect(SITE_FILE_SAMPLES.invalid).toHaveLength(8);
    expect(DOCK_CHIP_SAMPLES.invalid).toHaveLength(5);
  });

  it('[UI-002] a chip is a dock action with its place, its icon, its words and what a click asks for; `DockVM.chips` is optional', () => {
    expectTypeOf<C.DockVM['chips']>().toEqualTypeOf<readonly C.ChipVM[] | undefined>();
    expectTypeOf<C.ChipVM>().toMatchTypeOf<C.DockActionVM>();
    expectTypeOf<C.ChipVM['group']>().toEqualTypeOf<C.DockChipGroup>();
    expectTypeOf<C.ChipVM['icon']>().toEqualTypeOf<C.DockIconId | null>();
    expect(DOCK_CHIP_SAMPLES.chips).toEqual([undefined, []]);
    for (const chip of DOCK_CHIP_SAMPLES.valid) {
      expect(C.DOCK_CHIP_GROUPS).toContain(chip.group);
      expect(chip.icon === null || C.DOCK_ICON_IDS.includes(chip.icon)).toBe(true);
      for (const text of [chip.label, chip.hint]) expect(C.UI_TEXT_KEYS as readonly string[]).toContain(text.key);
      if (chip.action !== null) expect(C.UiActionSchema.safeParse(chip.action).success, chip.id).toBe(true);
    }
  });
});

it('ChatSpace admits only explicitly listed flags, including at the type boundary', () => {
  expectTypeOf<'futureFanslyFlag'>().not.toExtend<ChatSpaceFeatureFlag>();
  expectTypeOf<'voice'>().not.toExtend<ChatSpaceFeatureFlag>();
  expectTypeOf<'insertion'>().toExtend<ChatSpaceFeatureFlag>();
  expect(new Set(CHATSPACE_FEATURE_FLAGS).size).toBe(CHATSPACE_FEATURE_FLAGS.length);
});
