// The feature manifest, fansly.com (R20, docs/project-unite/architecture.md
// §1.4, §11.1): what each feature needs on Fansly and the features only Fansly
// has — voice notes, the fan's notes and «Заполнить из чата», «Регистрация»,
// the vault, «Fansly через вкладку». Nothing of ChatSpace's X8, navigation or
// palette: they do not exist here.
//
// A site module: imported by its subpath only (`@cg/contracts/features/fansly`),
// by Fansly's own composition roots; no ChatSpace bundle and no core of the
// background carries it (.dependency-cruiser.cjs; apps/extension/test/
// feature-slices.test.ts builds ChatSpace with a new entry here and compares
// the bytes).
//
// Where Fansly differs from ChatSpace (§11.1): a draft needs the page's own
// switch `drafts`; «Новые» come from a pass of the background, not from the
// hub's `audience-new`, and a greeting leaves under `newcomers` alone — there
// is no `previewSend` here.
//
// Fansly's own switches (`drafts`, `voice`, `notesFill`, `notes`, `vault`,
// `registration`; HF-12, HF-4б, HF-2) are in the shared vocabulary since P4b3
// (`CLIENT_FEATURE_FLAG_NAMES`); only Fansly's file names them. A page that
// does not list one reads `flag_off`, as a switch set nowhere does.

import type { FanslyCapability } from '../fansly';
import type { HostCapability } from '../host';
import { CLIENT_FLAG_REQUIREMENTS } from '../hub/routes';
import type { ClientFeatureFlag } from '../hub/wire';
import type { MountSurfaceKind } from '../vm/selectors';
import type { SiteFeatures } from './common';
import type { Requirement } from './types';

/** The switches a Fansly entry may name: the shared vocabulary (since P4b3 it has Fansly's own six). */
export type FanslyFeatureFlag = ClientFeatureFlag;

/** Surfaces only Fansly has, named ahead of `MOUNT_SURFACES` (the PRs of each panel add them): the slot in the chat's header and the three panels. */
export const FANSLY_SURFACES_AHEAD = ['header-slot', 'voice', 'notes', 'vault'] as const;
export type FanslySurface = MountSurfaceKind | (typeof FANSLY_SURFACES_AHEAD)[number];

type Req = Requirement<FanslyFeatureFlag, HostCapability | FanslyCapability>;

const NOTHING: Req = { flags: [], hostCapabilities: [] };
/** A draft is generated only where the owner switched `drafts` on for the page (HF-12). */
const DRAFTS: Req = { flags: ['drafts'], hostCapabilities: [] };
/** Putting a result into Fansly's field: the owner's `insertion` and the isolated world's write there. */
const INSERT: Req = { flags: ['insertion'], hostCapabilities: ['insert'] };

const FEATURES = {
  reply: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  fix: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  hi: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded', 'newcomers'], source: 'hub' },
  ping: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  'fresh-text': { base: { flags: ['freshText'], hostCapabilities: [], clientNeeds: CLIENT_FLAG_REQUIREMENTS.freshText }, actions: {}, surfaces: ['dock'], source: 'page' },
  review: { base: { flags: ['review'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  recap: { base: { flags: ['recap'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['dock', 'result-expanded', 'fan-panel'], source: 'hub' },
  coach: { base: { flags: ['coach'], hostCapabilities: [] }, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['coach'], source: 'hub' },
  spenders: { base: { flags: ['spenders'], hostCapabilities: [] }, actions: {}, surfaces: ['spenders', 'preview'], source: 'hub' },
  // Б17: the list is a pass of the background over Fansly's API; a greeting needs `newcomers` alone (HF-3).
  newcomers: { base: { flags: ['newcomers'], hostCapabilities: [] }, actions: { send: NOTHING }, surfaces: ['newcomers'], source: 'host-pass' },
  'fan-panel': { base: { flags: ['fanPanel'], hostCapabilities: [] }, actions: {}, surfaces: ['fan-panel'], source: 'hub' },
  sound: { base: { flags: ['sound'], hostCapabilities: [] }, actions: {}, surfaces: [] },

  // ── only Fansly ──
  // 🎙: a script from the draft and its paid voicing (the hub, HF-4); the MP3 goes into the field of this chat (§7.10).
  voice: {
    kind: 'panel',
    chip: { group: 'draft', priority: 20, icon: null },
    base: { flags: ['voice'], hostCapabilities: [] },
    actions: { generate: NOTHING, insert: { flags: [], hostCapabilities: ['fileAttach'] } },
    surfaces: ['voice'],
    source: 'hub',
  },
  notes: { kind: 'panel', hotkey: 'notes', base: { flags: ['notes'], hostCapabilities: ['headerSlot'] }, actions: {}, surfaces: ['header-slot', 'notes'], source: 'host-pass' },
  // «✨ Заполнить из чата»: the hub's `fan-notes-fill`, in the notes panel.
  'notes-fill': { kind: 'ai', base: { flags: ['notesFill'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['notes'], source: 'hub' },
  registration: { kind: 'panel', base: { flags: ['registration'], hostCapabilities: ['headerSlot'] }, actions: {}, surfaces: ['header-slot'], source: 'page' },
  vault: { kind: 'panel', base: { flags: ['vault'], hostCapabilities: ['vault'] }, actions: {}, surfaces: ['vault'], source: 'host-pass' },
  // «Fansly через вкладку»: a setting of the person, no switch of the owner.
  'via-tab': { kind: 'service', base: { flags: [], hostCapabilities: ['relay'] }, actions: {}, surfaces: [], source: 'page' },
} as const;

export const FANSLY_FEATURES: SiteFeatures<typeof FEATURES, FanslyFeatureFlag, HostCapability | FanslyCapability, FanslySurface> = FEATURES;

export type FanslyFeatureKey = keyof typeof FANSLY_FEATURES;
