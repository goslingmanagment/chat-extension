// The feature manifest, the common part (R20, docs/project-unite/architecture.md
// §1.4): what a feature of BOTH sites is — its kind, its chip in the dock's
// bar, the scheme action of its key. Nothing about a site: a site's switches,
// capabilities, surfaces and source are its own file's (`chatspace.ts`,
// `fansly.ts`), and so is a feature only that site has.
//
// The chips, as the bar stands (ui-design §3.1, UI-002): Reply and its options
// │ Fix │ Hi · Ping │ Voice │ Recap · Coach — and, at the right end, the two
// windows. Review has no chip since 1.51.0: it is a turn of Coach's dialog.

import type { HostCapability } from '../host';
import type { ClientFeatureFlag } from '../hub/wire';
import type { MountSurfaceKind } from '../vm/selectors';
import type { FeatureCommon, FeatureEntry, FeatureOnHost } from './types';

export const FEATURES_COMMON = {
  reply: { kind: 'ai', chip: { group: 'reply', priority: 10, icon: null }, hotkey: 'reply' },
  fix: { kind: 'ai', chip: { group: 'draft', priority: 10, icon: null }, hotkey: 'fix' },
  hi: { kind: 'ai', chip: { group: 'openers', priority: 10, icon: null }, hotkey: 'hi' },
  ping: { kind: 'ai', chip: { group: 'openers', priority: 20, icon: null }, hotkey: 'ping' },
  /**
   * 1.51.0: no chip of its own — Review is a turn of Coach's dialog: the «Review» chip by Coach's quick questions, its
   * key and the palette run it there (the owner, 2026-10-23: «интегрировать ревью внутрь коача как фичу»).
   */
  review: { kind: 'ai', hotkey: 'review' },
  recap: { kind: 'ai', chip: { group: 'analysis', priority: 20, icon: 'dossier' }, hotkey: 'recap' },
  coach: { kind: 'ai', chip: { group: 'analysis', priority: 30, icon: 'bulb' }, hotkey: 'coach' },
  /**
   * 1.47.0: Voice — the draft spoken in the model's voice (the hub's voice-notes lane): a free script, paid takes, the
   * MP3 into the chat's field. Its studio is the dock's sheet. 1.51.0: its chip stands after Ping, behind a seam.
   */
  voice: { kind: 'panel', chip: { group: 'voice', priority: 10, icon: 'mic' } },
  /** Fresh page text of the open chat for a draft (D-14): not a button, a part of Reply, Fix, Hi and Ping. */
  'fresh-text': { kind: 'service' },
  /**
   * 1.65.0: «Онлайн» — the page's fans who came online, why to write to each now, and a pass through them one click per
   * fan. Its chip stands first in the bar's right block, with the count of fans worth a message now.
   */
  online: { kind: 'board', chip: { group: 'windows', priority: 5, icon: 'online' } },
  /**
   * 2026-10-29: «Очереди» — the page's fan queues made on someone's word (through Gengar), handed out in portions of up to
   * ten. Its chip stands first in the bar's right block: the queues with work today, or who answered a message from one.
   */
  queues: { kind: 'board', chip: { group: 'windows', priority: 3, icon: 'queues' } },
  spenders: { kind: 'board', chip: { group: 'windows', priority: 10, icon: 'coin' }, hotkey: 'spenders' },
  newcomers: { kind: 'board', chip: { group: 'windows', priority: 20, icon: 'userNew' } },
  'fan-panel': { kind: 'panel' },
  /** The palette ⌘K (a row of the reference outside the scheme). 2026-10-26: on both sites; each says where its chats come from. */
  palette: { kind: 'panel' },
  sound: { kind: 'service' },
  /**
   * 1.15.0 (R20 P7i). A person's own send of a part of ours, taken for known (`op.reportSent`: telemetry `sent`, the
   * hub's registration of a greeting sent by hand): how the site sees it is the site's — its requirement says when.
   */
  'human-send': { kind: 'service' },
  /**
   * 1.21.0 (decision X48): who sent each message, told to the hub (`send-attribution-v1`). ChatSpace since 1.21.0;
   * Fansly since Chat Memory week 1. How the site sees a send is the site's requirement.
   */
  'send-attribution': { kind: 'service' },
} as const satisfies Readonly<Record<string, FeatureCommon>>;

export type CommonFeatureKey = keyof typeof FEATURES_COMMON;

/**
 * The shape of a site's file: for a feature of both sites — its part on that site; for a feature only that site
 * has — the whole entry, its common part included.
 */
export type SiteFeatures<T, F extends string = ClientFeatureFlag, C extends string = HostCapability, S extends string = MountSurfaceKind> = {
  readonly [K in keyof T]: K extends CommonFeatureKey ? FeatureOnHost<F, C, S> : FeatureEntry<F, C, S>;
};
