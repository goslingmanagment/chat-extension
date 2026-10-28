// The feature manifest, Telegram Web A (docs/specs/2026-10-27-telegram-site.md §2, §6.6): Reply and Fix in the
// persona's own Telegram account, nothing else of the dock (Coach comes with its own PR). Telegram's page reads its own
// row of the owner's switches (`drafts`, `insertion`) and its AI needs the hub's Telegram lane (`telegram-ai-v1`): the
// chat goes in `clientContext`, the hub keeps no archive of it.
//
// A site module: imported by its subpath only (`@cg/contracts/features/telegram`), by Telegram's own composition
// roots; no ChatSpace or Fansly bundle carries it.

import type { HostCapability } from '../host';
import type { SiteFeatures } from './common';
import type { Requirement } from './types';

type Req = Requirement;

const NOTHING: Req = { flags: [], hostCapabilities: [] };
/** A draft is generated only where the owner switched `drafts` on for the page, against a hub with the Telegram lane. */
const DRAFTS: Req = { flags: ['drafts'], hostCapabilities: [], clientNeeds: ['telegram-ai-v1'] };
/** Putting a result into Telegram's field: the owner's `insertion` and the isolated world's write there. */
const INSERT: Req = { flags: ['insertion'], hostCapabilities: ['insert'] };

const FEATURES = {
  reply: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
  fix: { base: DRAFTS, actions: { generate: NOTHING, insert: INSERT }, surfaces: ['dock', 'result-expanded'], source: 'hub' },
} as const;

export const TELEGRAM_FEATURES: SiteFeatures<typeof FEATURES, Req['flags'][number], HostCapability> = FEATURES;

export type TelegramFeatureKey = keyof typeof TELEGRAM_FEATURES;
