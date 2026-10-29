// Admission of a feature and of each thing done with it (R20,
// docs/project-unite/architecture.md §1.4). The feature manifest
// (`@cg/contracts/features/*`) says what a feature needs on a site; this
// module answers, for one site's slice of it:
//
// - `absent` — the site does not have the feature (or the feature has no such
//   action there): nothing is drawn, nothing starts, its key stays reserved;
// - `off`, with the reason — something of the feature's `base` or of the
//   action's own requirement does not hold: a switch of the page
//   (`pages[].features[flag]`, in the hub's own words), a need of this
//   client's transport (`hub_not_ready`), a capability of the site's page
//   (`host_degraded`);
// - `on`.
//
// Everything inside a requirement is AND, and an action adds to `base`: a
// generation, an insert and a send are admitted each on its own — a page
// without `insertion` still generates, and its parts can be copied.
//
// The hub's decision about a page is not repeated here: the platform and what
// the hub serves are already in the page's own feature (flags.ts). Pure; no
// site is named — the slice is handed in by a composition root, which imports
// its own site's file of the manifest and nothing of another site.
//
// The chips of the dock's bar as data (`dockChips`, §1.5) live here too, on
// purpose: a module goes to the first lazy layer that needs it, and the slice
// is built in `tab-app` — so the chips' code loads with it there, not in the
// `ai` layer, whose headroom the AI policy ports need (F10, §3.2).

import type { FeatureId } from '@cg/contracts/features';
import { type I18nKey } from '@cg/contracts/errors';
import type { AdmissionAction, FeatureCommon, FeatureEntry, FeatureOnHost, FeatureSlice, HotkeyActionId } from '@cg/contracts/features/types';
import { hasCapability, type Bootstrap, type BootstrapPage, type ClientHubCapability } from '@cg/contracts/hub';
import { CATALOG_ACTION_IDS, DOCK_CHIP_GROUPS, type CatalogActionId, type ChipVM, type DockActionId, type DockActionVM, type HotkeyLabel, type OverlaySurface, type TargetHandle, type UiAction } from '@cg/contracts/vm';

import { pageFlagState, type FlagState } from '../ops/flags';

export type FeatureAdmission = { readonly state: 'absent' } | { readonly state: 'off'; readonly reason: string } | { readonly state: 'on' };

/** What an admission reads; who asks decides how each is read. */
export interface AdmissionFacts {
  /** An owner's switch as the asker reads it: of the page in question, or — the hub layer's gate — of a fresh bootstrap. */
  flag(flag: string): FlagState;
  /** Whether the hub's bootstrap declares a capability this client's own calls need. */
  serves(capability: ClientHubCapability): boolean;
  /** Whether the site's contract report has a capability on. Absent — nobody here can ask the site (the background): its capabilities are the tab's to check. */
  host?(capability: string): boolean;
}

const ABSENT: FeatureAdmission = { state: 'absent' };
const ON: FeatureAdmission = { state: 'on' };
const HUB_NOT_READY: FlagState = { usable: false, reason: 'hub_not_ready' };

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);

/**
 * A site's slice of the manifest: every feature its file lists, each with the common part of the feature (a
 * feature only that site has carries its own). `common` and `site` are the two files a composition root imports.
 */
export function featureSlice(common: Readonly<Record<string, FeatureCommon>>, site: Readonly<Record<string, FeatureOnHost<string, string, string> | FeatureEntry<string, string, string>>>): FeatureSlice {
  return Object.fromEntries(Object.entries(site).map(([id, entry]) => [id, { ...own(common, id), ...entry }])) as FeatureSlice;
}

/** The manifest's key of an AI feature: the two lengths of Recap are one feature. */
export function featureKeyOf(feature: string): string {
  return feature === 'recap-short' ? 'recap' : feature;
}

/**
 * Whether feature `id` — or, with `action`, that action of it — is admitted. `action: null` asks about the feature
 * itself (`base` alone): whether it is there to be shown at all. `slice: null` — the asker has no slice for the site.
 */
export function admission(slice: FeatureSlice | null, id: string, action: AdmissionAction | null, facts: AdmissionFacts): FeatureAdmission {
  const entry = slice === null ? undefined : own(slice, id);
  if (entry === undefined) return ABSENT;
  const extra = action === null ? null : entry.actions[action];
  if (extra === undefined) return ABSENT;
  for (const requirement of extra === null ? [entry.base] : [entry.base, extra]) {
    for (const flag of requirement.flags) {
      const state = facts.flag(flag);
      if (!state.usable) return { state: 'off', reason: state.reason ?? 'flag_off' };
    }
    for (const need of requirement.clientNeeds ?? []) if (!facts.serves(need)) return { state: 'off', reason: 'hub_not_ready' };
    if (facts.host !== undefined) for (const capability of requirement.hostCapabilities) if (!facts.host(capability)) return { state: 'off', reason: 'host_degraded' };
  }
  return ON;
}

/** Whether the site has the feature at all — the `absent` of an admission, asked without a page. */
export function featurePresent(slice: FeatureSlice, id: string): boolean {
  return own(slice, id) !== undefined;
}

/** The capabilities of a site's contract report, as far as an admission reads them. */
export type HostCapabilityStates = Readonly<Record<string, { readonly state: string } | undefined>>;

/**
 * The facts of one page: its own switches, what the bootstrap declares, and — in a tab — the site's report. No
 * bootstrap — every switch reads `hub_not_ready`; a page that is not granted — `not_granted`.
 */
export function onPage(bootstrap: Bootstrap | null, page: BootstrapPage | null | undefined, host?: HostCapabilityStates | null): AdmissionFacts {
  return {
    flag: (flag) => (bootstrap === null ? HUB_NOT_READY : pageFlagState(page, flag)),
    serves: (capability) => bootstrap !== null && hasCapability(bootstrap.capabilities, capability),
    ...(host === undefined || host === null ? {} : { host: (capability: string) => own(host, capability)?.state === 'on' }),
  };
}

/**
 * An admission in the shape of a switch, for the words and the codes a refused switch already has (flags.ts
 * `flagRefusal`, the tooltip of a button): a feature the site does not have reads as one its platform lacks.
 */
export function admissionState(admitted: FeatureAdmission): FlagState {
  return admitted.state === 'on' ? { usable: true, reason: null } : { usable: false, reason: admitted.state === 'off' ? admitted.reason : 'platform_unsupported' };
}

/**
 * The admission on one page, in the shape of a switch: what the tab's controllers and the background's scheduler ask
 * before a thing is offered or started. `host` — the capabilities of the site's report, where there is a site to ask.
 */
export function admittedOn(slice: FeatureSlice | null, id: string, action: AdmissionAction | null, bootstrap: Bootstrap | null, page: BootstrapPage | null | undefined, host?: HostCapabilityStates | null): FlagState {
  return admissionState(admission(slice, id, action, onPage(bootstrap, page, host)));
}

/**
 * D-14: whether fresh page text of the open chat may travel with a draft of this page — the manifest's
 * `fresh-text`: the owner's `freshText` of the page and the `context-v1` the client's request needs.
 */
export function freshTextAdmitted(slice: FeatureSlice | null, bootstrap: Bootstrap | null, pageId: number): boolean {
  const page = bootstrap?.pages.find((candidate) => candidate.pageId === pageId);
  return admission(slice, 'fresh-text', null, onPage(bootstrap, page)).state === 'on';
}

// ── the chips of the dock's bar ────────────────────────────────────────────
//
// The features of a site's slice that have a chip, in the order the bar shows them, each with its words, its icon
// and what a click asks for. The dock's controller builds `DockVM.chips` with it (and the stand's scenarios do, so
// a picture of the gallery is what the controller would give). One of the seven actions carries its state of
// `DockVM.actions`. A window — Spenders, «Новые» — opens whatever the chat's state is: it says itself why it is
// empty. A chip of any other kind is drawn by the PR of its feature: its words and its action come with it.

/**
 * `actions` — the seven actions as the controller decided them; `handle` — the open chat a generation is for (null —
 * none to act on); `keyOf` — the printed key of a scheme action. The order: by group (`DOCK_CHIP_GROUPS`), then by
 * the manifest's priority.
 */
export function dockChips(
  slice: FeatureSlice,
  actions: Readonly<Record<DockActionId, DockActionVM>>,
  handle: TargetHandle | null,
  keyOf: (action: HotkeyActionId | CatalogActionId) => HotkeyLabel | null,
  /**
   * 1.47.0: the panels of the dock (Voice) as their controller decided them — the state and what a click asks for; a
   * panel the page cannot have now is not here, and has no chip.
   */
  panels: Readonly<Record<string, DockActionVM & { readonly action: UiAction | null }>> = {},
  /** 1.65.0: a window's chip that opens by its own action, with a number beside it («Онлайн N»). */
  boards: Readonly<Record<string, { readonly action?: UiAction; readonly count?: number | null; readonly answered?: boolean; readonly hidden?: boolean }>> = {},
): ChipVM[] {
  return Object.entries(slice)
    .flatMap(([id, entry]) => (entry.chip === undefined ? [] : [{ id, entry, chip: entry.chip }]))
    .sort((a, b) => DOCK_CHIP_GROUPS.indexOf(a.chip.group) - DOCK_CHIP_GROUPS.indexOf(b.chip.group) || a.chip.priority - b.chip.priority)
    .flatMap(({ id, entry, chip: { group, icon } }): ChipVM[] => {
      const hint = { key: `dock.hint.${id}` as I18nKey };
      const own = (actions as Readonly<Record<string, DockActionVM | undefined>>)[id];
      if (own !== undefined) {
        const action: UiAction | null =
          id === 'coach'
            ? { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: !own.active } }
            : // Recap never generates from the bar: its window shows what is saved or the choice of the two (2026-10-28:
              // the window opens at once, from the folded «Шпаргалка» too).
              id === 'recap'
              ? { type: 'ShowAnalysis', view: 'recap', mode: 'expanded' }
              : handle === null
                ? null
                : { type: 'Generate', targetHandle: handle, feature: id as FeatureId, options: {} };
        return [{ ...own, id, group, icon, label: { key: `dock.action.${id}` as I18nKey }, hint, action }];
      }
      const panel = entry.kind === 'panel' ? panels[id] : undefined;
      if (panel !== undefined) return [{ ...panel, id, group, icon, label: { key: `dock.action.${id}` as I18nKey }, hint }];
      if (entry.kind !== 'board') return [];
      const board = boards[id];
      // A window with nothing for the person on this page (no queue of theirs): no chip.
      if (board?.hidden === true) return [];
      const open: UiAction = board?.action ?? { type: 'Navigate', to: { kind: 'surface', surface: id as OverlaySurface, open: true } };
      // A board's key: the scheme's row it names (Spenders), else the catalog's own row of the board — «Новые» has one
      // outside the scheme (decision X55).
      const key = entry.hotkey ?? ((CATALOG_ACTION_IDS as readonly string[]).includes(id) ? (id as CatalogActionId) : null);
      return [{ id, group, icon, label: { key: `${id}.title` as I18nKey }, hint, action: open, enabled: true, busy: false, active: false, reason: null, hotkey: key === null ? null : keyOf(key), badge: null, ...(board?.count === undefined ? {} : { count: board.count }), ...(board?.answered === true ? { answered: true } : {}) }];
    });
}
