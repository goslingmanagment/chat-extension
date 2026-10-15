// The feature manifest, the common part (R20, docs/project-unite/architecture.md
// §1.4): what a feature of BOTH sites is — its kind, its chip in the dock's
// bar, the scheme action of its key. Nothing about a site: a site's switches,
// capabilities, surfaces and source are its own file's (`chatspace.ts`,
// `fansly.ts`), and so is a feature only that site has.
//
// The chips, as the bar stands (ui-design §3.1, UI-002): Reply and its options
// │ Fix │ Hi · Ping │ Review · Recap · Coach — and, at the right end, the two
// windows.

import type { HostCapability } from '../host';
import type { ClientFeatureFlag } from '../hub/wire';
import type { MountSurfaceKind } from '../vm/selectors';
import type { FeatureCommon, FeatureEntry, FeatureOnHost } from './types';

export const FEATURES_COMMON = {
  reply: { kind: 'ai', chip: { group: 'reply', priority: 10, icon: null }, hotkey: 'reply' },
  fix: { kind: 'ai', chip: { group: 'draft', priority: 10, icon: null }, hotkey: 'fix' },
  hi: { kind: 'ai', chip: { group: 'openers', priority: 10, icon: null }, hotkey: 'hi' },
  ping: { kind: 'ai', chip: { group: 'openers', priority: 20, icon: null }, hotkey: 'ping' },
  review: { kind: 'ai', chip: { group: 'analysis', priority: 10, icon: 'gauge' }, hotkey: 'review' },
  recap: { kind: 'ai', chip: { group: 'analysis', priority: 20, icon: 'dossier' }, hotkey: 'recap' },
  coach: { kind: 'ai', chip: { group: 'analysis', priority: 30, icon: 'bulb' }, hotkey: 'coach' },
  /** Fresh page text of the open chat for a draft (D-14): not a button, a part of Reply, Fix, Hi and Ping. */
  'fresh-text': { kind: 'service' },
  spenders: { kind: 'board', chip: { group: 'windows', priority: 10, icon: 'bill' }, hotkey: 'spenders' },
  newcomers: { kind: 'board', chip: { group: 'windows', priority: 20, icon: 'userPlus' } },
  'fan-panel': { kind: 'panel' },
  sound: { kind: 'service' },
  /**
   * 1.15.0 (R20 P7i). A person's own send of a part of ours, taken for known (`op.reportSent`: telemetry `sent`, the
   * hub's registration of a greeting sent by hand): how the site sees it is the site's — its requirement says when.
   */
  'human-send': { kind: 'service' },
} as const satisfies Readonly<Record<string, FeatureCommon>>;

export type CommonFeatureKey = keyof typeof FEATURES_COMMON;

/**
 * The shape of a site's file: for a feature of both sites — its part on that site; for a feature only that site
 * has — the whole entry, its common part included.
 */
export type SiteFeatures<T, F extends string = ClientFeatureFlag, C extends string = HostCapability, S extends string = MountSurfaceKind> = {
  readonly [K in keyof T]: K extends CommonFeatureKey ? FeatureOnHost<F, C, S> : FeatureEntry<F, C, S>;
};
