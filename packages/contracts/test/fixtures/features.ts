// Fixtures of the feature manifest and of the dock's chips (1.15.0, R20 F4): what fits the types and what
// does not. The manifest is data without a schema — nothing crosses a boundary as `unknown` — so the invalid
// samples are refused by the compiler (`@ts-expect-error`), as the other view-model fixtures are.

import { type FanslyCapability } from '../../src/fansly';
import { type ChatSpaceFeatureFlag } from '../../src/features/chatspace';
import { type SiteFeatures } from '../../src/features/common';
import { type FanslyFeatureFlag, type FanslySurface } from '../../src/features/fansly';
import type { Requirement } from '../../src/features/types';
import type * as C from '../../src/index';

type ChatSpaceFile<T> = SiteFeatures<T, ChatSpaceFeatureFlag>;
type FanslyFile<T> = SiteFeatures<T, FanslyFeatureFlag, C.HostCapability | FanslyCapability, FanslySurface>;

const NOTHING = { flags: [], hostCapabilities: [] } as const;

/** A requirement: the page's switches, the site's capabilities, the client's own transport needs — AND. */
export const REQUIREMENT_SAMPLES: { readonly valid: readonly Requirement[]; readonly invalid: readonly unknown[] } = {
  valid: [
    NOTHING,
    { flags: ['insertion'], hostCapabilities: ['insert'] },
    { flags: ['previewSend', 'newcomers'], hostCapabilities: ['previewSend', 'receipt'] },
    { flags: ['freshText'], hostCapabilities: [], clientNeeds: ['context-v1'] },
    // 1.15.0 (P4b3): Fansly's own switches are in the shared vocabulary; only Fansly's file names them (ChatSpace's cannot, below).
    { flags: ['drafts'], hostCapabilities: [] },
  ],
  invalid: [
    // @ts-expect-error a switch the hub's vocabulary does not have
    { flags: ['autoSend'], hostCapabilities: [] } satisfies Requirement,
    // @ts-expect-error a capability no site's report carries
    { flags: [], hostCapabilities: ['teleport'] } satisfies Requirement,
    // @ts-expect-error a client need is a capability of the hub's bootstrap, not a switch
    { flags: [], hostCapabilities: [], clientNeeds: ['insertion'] } satisfies Requirement,
    // @ts-expect-error both lists are there, empty when nothing is needed
    { flags: [] } satisfies Requirement,
  ],
};

/** A site's file: a feature of both sites gives its part on that site, a feature only that site has — its whole entry. */
export const SITE_FILE_SAMPLES = {
  valid: {
    chatspace: {
      reply: { base: NOTHING, actions: { generate: NOTHING, insert: { flags: ['insertion'], hostCapabilities: ['insert'] } }, surfaces: ['dock'], source: 'hub' },
      'preview-send': { kind: 'host-action', base: { flags: ['previewSend'], hostCapabilities: ['previewSend', 'receipt'] }, actions: { send: NOTHING }, surfaces: ['preview'] },
    } satisfies ChatSpaceFile<{ reply: unknown; 'preview-send': unknown }>,
    fansly: {
      reply: { base: { flags: ['drafts'], hostCapabilities: [] }, actions: { generate: NOTHING }, surfaces: ['dock'] },
      voice: { kind: 'panel', chip: { group: 'draft', priority: 20, icon: null }, base: { flags: ['voice'], hostCapabilities: [] }, actions: { insert: { flags: [], hostCapabilities: ['fileAttach'] } }, surfaces: ['voice'] },
    } satisfies FanslyFile<{ reply: unknown; voice: unknown }>,
  },
  invalid: [
    // @ts-expect-error a feature only this site has says what it is: there is no common part to take `kind` from
    { 'preview-send': { base: NOTHING, actions: {}, surfaces: [] } } satisfies ChatSpaceFile<{ 'preview-send': unknown }>,
    // @ts-expect-error ChatSpace's file names no switch of Fansly
    { reply: { base: { flags: ['drafts'], hostCapabilities: [] }, actions: {}, surfaces: [] } } satisfies ChatSpaceFile<{ reply: unknown }>,
    // @ts-expect-error nor a capability of Fansly's report
    { reply: { base: { flags: [], hostCapabilities: ['fileAttach'] }, actions: {}, surfaces: [] } } satisfies ChatSpaceFile<{ reply: unknown }>,
    // @ts-expect-error nor a surface only Fansly has
    { reply: { base: NOTHING, actions: {}, surfaces: ['header-slot'] } } satisfies ChatSpaceFile<{ reply: unknown }>,
    // @ts-expect-error three things are done with a feature — generate, insert, send — and each is admitted by name
    { reply: { base: NOTHING, actions: { open: NOTHING }, surfaces: [] } } satisfies ChatSpaceFile<{ reply: unknown }>,
    // @ts-expect-error a chip stands in one of the bar's groups
    { voice: { kind: 'panel', chip: { group: 'left', priority: 1, icon: null }, base: NOTHING, actions: {}, surfaces: [] } } satisfies FanslyFile<{ voice: unknown }>,
    // @ts-expect-error and its icon is one the kit draws
    { voice: { kind: 'panel', chip: { group: 'draft', priority: 1, icon: 'microphone' }, base: NOTHING, actions: {}, surfaces: [] } } satisfies FanslyFile<{ voice: unknown }>,
    // @ts-expect-error a key is an action of the vendored scheme
    { notes: { kind: 'panel', hotkey: 'note', base: NOTHING, actions: {}, surfaces: [] } } satisfies FanslyFile<{ notes: unknown }>,
  ] as readonly unknown[],
};

const CHIP_STATE = { enabled: true, busy: false, active: false, reason: null, hotkey: null, badge: null } as const;

/** A chip of the dock's bar as data. */
export const DOCK_CHIP_SAMPLES: { readonly valid: readonly C.ChipVM[]; readonly chips: readonly C.DockVM['chips'][]; readonly invalid: readonly unknown[] } = {
  valid: [
    { ...CHIP_STATE, id: 'reply', group: 'reply', icon: null, label: { key: 'dock.action.reply' }, hint: { key: 'dock.hint.reply' }, action: { type: 'Generate', targetHandle: 'dock:chatspace:1001:2001', feature: 'reply', options: {} } },
    // No chat to act on: the chip is drawn, a click asks for nothing.
    { ...CHIP_STATE, enabled: false, id: 'fix', group: 'draft', icon: null, label: { key: 'dock.action.fix' }, hint: { key: 'dock.hint.fix' }, action: null },
    { ...CHIP_STATE, badge: 'recap-ready', id: 'recap', group: 'analysis', icon: 'dossier', label: { key: 'dock.action.recap' }, hint: { key: 'dock.hint.recap' }, action: { type: 'ShowAnalysis', view: 'recap', mode: 'sheet' } },
    { ...CHIP_STATE, id: 'spenders', group: 'windows', icon: 'bill', label: { key: 'spenders.title' }, hint: { key: 'dock.hint.spenders' }, action: { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } } },
  ],
  // Optional: a model of a producer before 1.15.0 has no chips, and the bar draws none.
  chips: [undefined, []],
  invalid: [
    // @ts-expect-error a chip stands in one of the bar's groups
    { ...CHIP_STATE, id: 'reply', group: 'main', icon: null, label: { key: 'dock.action.reply' }, hint: { key: 'dock.hint.reply' }, action: null } satisfies C.ChipVM,
    // @ts-expect-error its icon is an id the kit draws, or none
    { ...CHIP_STATE, id: 'review', group: 'analysis', icon: 'star', label: { key: 'dock.action.review' }, hint: { key: 'dock.hint.review' }, action: null } satisfies C.ChipVM,
    // @ts-expect-error its words are catalog messages, not ready texts
    { ...CHIP_STATE, id: 'reply', group: 'reply', icon: null, label: 'Reply', hint: { key: 'dock.hint.reply' }, action: null } satisfies C.ChipVM,
    // @ts-expect-error what a click asks for is a UiAction (or nothing), never a callback
    { ...CHIP_STATE, id: 'reply', group: 'reply', icon: null, label: { key: 'dock.action.reply' }, hint: { key: 'dock.hint.reply' }, action: () => undefined } satisfies C.ChipVM,
    // @ts-expect-error the state of a chip is the state of a dock action: all of it
    { id: 'reply', group: 'reply', icon: null, label: { key: 'dock.action.reply' }, hint: { key: 'dock.hint.reply' }, action: null } satisfies C.ChipVM,
  ],
};
