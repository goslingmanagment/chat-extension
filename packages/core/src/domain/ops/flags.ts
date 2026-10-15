// The owner's switches as this client reads them (docs/protocols/hub.md
// «Флаги: решает страница»). The hub evaluates every switch per page and
// puts the answer into `pages[].features[flag] = { available, reason }`:
// the page's own row of `chatExtensionFeatures` wins over `"*"`. The
// bootstrap's top-level `flags` carry the `"*"` row ALONE — an owner who
// pilots one page switches that page on and leaves `"*"` empty, and then
// every top-level flag reads false while the page works.
//
// The page's feature is the hub's whole answer: the platform, the master
// switch, the flag, the binding and what the hub serves are already in it
// (the hub's own table, `CLIENT_FEATURE_REQUIREMENTS`). The client does not
// repeat that table (R20 F4); what a FEATURE needs beyond its switches — a
// capability of the site, a need of this client's own transport — is the
// feature manifest's, read by `admission` (domain/features/admission.ts).
//
// So one rule, one place:
// - whatever belongs to a page (an action of the dock, an insert, the fresh
//   text, Review, Coach, Recap, a board, a preview send, navigation inside
//   an account bound to the page) reads THAT page's feature — `pageFlagState`;
// - what is not bound to one page (whether the WS tap script is registered
//   at all, whether the sound arbiter listens, what a popup counts) reads
//   «usable on at least one granted page» — `flagOnSomePage` — and then
//   applies the page's own value to each event or account;
// - a host account that is bound to no hub page has no page row to ask: only
//   there the owner's `"*"` value decides — `starFlag`.
// The hub stays the final authority: it checks every call again and answers
// 409 `client_feature_disabled` with the same reasons.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { CLIENT_FEATURE_FLAG_NAMES, isFlagOn, type Bootstrap, type BootstrapPage, type ClientFeatureFlag } from '@cg/contracts/hub';

export interface FlagState {
  readonly usable: boolean;
  /**
   * Why not, in the hub's own words (an open token): `disabled` — the
   * owner's master switch is off; `flag_off`; `platform_unsupported`;
   * `binding_missing`; `hub_not_ready` — the hub does not serve what the
   * feature needs (or this client's transport cannot carry it); `lane_off`
   * (1.15.0) — the hub's own lane the feature runs on (the voice notes) does
   * not serve the page now, though everything else holds;
   * `not_granted` — the page is not in the bootstrap; `client_outdated`.
   * The hub layer adds `bootstrap_expired`, an admission `host_degraded` —
   * the site's page cannot do it now. null — usable.
   */
  readonly reason: string | null;
}

const USABLE: FlagState = { usable: true, reason: null };
const off = (reason: string): FlagState => ({ usable: false, reason });

const own = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);

/**
 * A switch on one page: the page's own feature decides, and nothing else — the hub put the platform and what it
 * serves into it. The top-level `flags` are not asked. `flag` is a name of the hub's vocabulary; a name the page
 * does not list (an older hub, a switch the hub has not shipped yet) is off.
 */
export function pageFlagState(page: BootstrapPage | null | undefined, flag: string): FlagState {
  if (page === null || page === undefined) return off('not_granted');
  const feature = own(page.features, flag);
  // A page that does not list the flag at all (an older hub): off, as the hub reads a flag set nowhere.
  if (feature === undefined) return off('flag_off');
  return feature.available === true ? USABLE : off(feature.reason ?? 'flag_off');
}

/** The same for a page named by its hub id; no bootstrap — `hub_not_ready`. */
export function flagStateOf(bootstrap: Bootstrap | null, pageId: number, flag: ClientFeatureFlag): FlagState {
  if (bootstrap === null) return off('hub_not_ready');
  return pageFlagState(
    bootstrap.pages.find((page) => page.pageId === pageId),
    flag,
  );
}

/** A switch is usable on a page (§4.12): the page's own feature is `available`. */
export function flagUsable(bootstrap: Bootstrap | null, pageId: number, flag: ClientFeatureFlag): boolean {
  return flagStateOf(bootstrap, pageId, flag).usable;
}

/** For what is not bound to one page: the switch is usable on at least one granted page. */
export function flagOnSomePage(bootstrap: Bootstrap | null, flag: ClientFeatureFlag): boolean {
  return bootstrap !== null && bootstrap.pages.some((page) => pageFlagState(page, flag).usable);
}

/** Every known switch as «usable on at least one granted page»: what a diagnostics report or a health report calls on and off. */
export function flagsOnSomePage(bootstrap: Bootstrap | null): Record<ClientFeatureFlag, boolean> {
  return Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, flagOnSomePage(bootstrap, flag)])) as Record<ClientFeatureFlag, boolean>;
}

/**
 * Prefer the most useful page reason: master off beats platform_unsupported on older hubs (before HF-15).
 * Otherwise later checks (flag → binding → what the hub serves → its lane) are closer to being usable.
 * `lane_off` (1.15.0, hub HF-4б) is the bootstrap's last word: it is said only of a feature everything else
 * admitted.
 */
const REASON_RANK: Readonly<Record<string, number>> = { platform_unsupported: 1, disabled: 2, flag_off: 3, binding_missing: 4, hub_not_ready: 5, lane_off: 6 };

/**
 * The same with the reason nothing is usable: the reason of the page that got
 * furthest in the hub's checks — «хаб не готов» on the one OnlyFans page says
 * more than «не та платформа» on a Fansly one. No page at all — `not_granted`.
 */
export function somePageFlagState(bootstrap: Bootstrap, flag: ClientFeatureFlag): FlagState {
  let best: FlagState = off('not_granted');
  let rank = -1;
  for (const page of bootstrap.pages) {
    const state = pageFlagState(page, flag);
    if (state.usable) return USABLE;
    const reached = (state.reason === null ? undefined : own(REASON_RANK, state.reason)) ?? 0;
    if (reached > rank) {
      best = state;
      rank = reached;
    }
  }
  return best;
}

/**
 * The owner's `"*"` value — the bootstrap's top-level `flags`. It answers
 * only for what has no page row to ask: a host account bound to no hub page
 * (the message sound and the navigation inside it). Never a page's answer.
 */
export function starFlag(bootstrap: Bootstrap | null, flag: ClientFeatureFlag): boolean {
  return bootstrap !== null && isFlagOn(bootstrap.flags, flag);
}

/**
 * The one reason every feature a page lists is unavailable for, or null: a blanket answer of the hub about the
 * whole page (its features disagree, or one is available — no blanket reason).
 *
 * HF-15: master off makes every listed feature `disabled`, even outside its platform. Older hubs (HF-2)
 * answered `platform_unsupported` first; ignore those entries so their blanket master reason still works too.
 */
export function pageBlanketReason(page: BootstrapPage | null | undefined): string | null {
  if (page === null || page === undefined) return null;
  const features = Object.values(page.features).filter((feature) => feature.reason !== 'platform_unsupported');
  const first = features[0];
  if (first === undefined || first.available === true || first.reason === undefined) return null;
  return features.every((feature) => feature.available !== true && feature.reason === first.reason) ? first.reason : null;
}

/**
 * The owner's master switch is off: every feature the page lists is unavailable with the reason `disabled`.
 * The switch is ONE for the whole hub — every page answers so at once — and AI of a narrow token is refused by
 * the hub then (409 `client_feature_disabled`), whichever feature is asked.
 */
export function pageSwitchedOff(page: BootstrapPage | null | undefined): boolean {
  return pageBlanketReason(page) === 'disabled';
}

function versionParts(version: string): number[] | null {
  if (!/^\d+(?:\.\d+){0,3}$/.test(version.trim())) return null;
  return version
    .trim()
    .split('.')
    .map((part) => Number(part));
}

/** -1 / 0 / 1 for dotted numeric versions (Firefox allows up to four parts); null when either is not one. */
export function compareVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (left === null || right === null) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

/** Below `minVersion` AI is off and the client shows CG-HUB-OUTDATED (§8.3). An unreadable minVersion does not lock anyone out. */
export function belowMinVersion(bootstrap: Bootstrap, extensionVersion: string): boolean {
  return compareVersions(extensionVersion, bootstrap.minVersion) === -1;
}

/**
 * This build is too old for the hub: the bootstrap's `minVersion` is above it (when the build's version is
 * known), or the hub itself says so for every feature of the page (`client_outdated`). Nothing of ours runs
 * on the page until the extension is updated.
 */
export function clientOutdated(bootstrap: Bootstrap, page: BootstrapPage | null | undefined, extensionVersion: string | null | undefined): boolean {
  return pageBlanketReason(page) === 'client_outdated' || (typeof extensionVersion === 'string' && belowMinVersion(bootstrap, extensionVersion));
}

/** The code a refused page feature reads as: the same reading as the hub's own 409 (`HUB_ERROR_RULES`), plus what an admission adds — a need of this client's transport, a capability of the site. */
const REASON_CODES: Readonly<Record<string, CgCode>> = {
  binding_missing: 'CG-BINDING-MISSING',
  client_outdated: 'CG-HUB-OUTDATED',
  not_granted: 'CG-BINDING-NOT-GRANTED',
  hub_not_ready: 'CG-HUB-CAPABILITY',
  host_degraded: 'CG-HOST-CONTRACT',
};

export function flagRefusalCode(reason: string | null): CgCode {
  return (reason === null ? undefined : own(REASON_CODES, reason)) ?? 'CG-FEATURE-DISABLED';
}

/** A refused page feature as an error: its code, and the hub's reason for the technical line. */
export function flagRefusal(state: Pick<FlagState, 'reason'>): CgErrorWire {
  return state.reason === null ? { code: 'CG-FEATURE-DISABLED' } : { code: flagRefusalCode(state.reason), detail: state.reason };
}
