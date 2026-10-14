// Fansly's side of the host contract (R20, docs/project-unite/architecture.md §7.7, §7.12, FS-CTR-1): the port of the
// Fansly adapter as Fansly's own code sees it (`FanslyHostPort`: `freshness` gives `FanslySnapshot`, `fansly` is
// `FanslyPagePort`), what its contract report must name (`FANSLY_CONTRACT`) and the strict branch of its report's block
// (`FanslyContractBlockSchema`, `FanslyContractReportSchema`).
//
// The shared `HostPort` names no site's type — a shared module may not import a site's (§1.8) — so its two members of
// 1.15.0 are typed here. The shared report schema (`SiteContractReportSchema`) knows no site's anchors either: it
// requires the site's own block and machine names, and the readers hold completeness by the expected set. The strict
// branch below is for Fansly's producer and its contract check (P7c, P7h): a report without the block, or without one
// anchor or capability of Fansly, is no report of Fansly's.
//
// A site module (1.15.0), like fansly.ts: imported by its own subpath only, never from the root. It may take host.ts
// at run time; host.ts never takes it.

import * as z from 'zod/mini';

import { FANSLY_ANCHOR_IDS, FanslyAnchorIdSchema, FanslyCapabilitySchema, type FanslyPagePort, type FanslySnapshot } from './fansly';
import { ANCHOR_STATES, CapabilityStateSchema, HostCapabilitySchema, type FreshnessPort, type HostContractShape, type HostPort } from './host';
import { EpochMsSchema, boundedText, displayText } from './primitives';

/** The Fansly adapter's port (§7.7): the shared HostPort with the two members only fansly.com has, typed. */
export interface FanslyHostPort extends HostPort {
  readonly kind: 'fansly-web';
  readonly platform: 'fansly';
  /** MAIN's generation snapshot through the bridge (`fx.generationSnapshot`, §5.8). */
  readonly freshness: FreshnessPort<FanslySnapshot>;
  readonly fansly: FanslyPagePort;
}

/**
 * What a Fansly report must name (§7.12, FS-CTR-1): every anchor of FANSLY_ANCHOR_IDS — one the report does not name is
 * `missing` — and what is off for a reason other than a break: the vault's upload input is there only on the vault
 * page, and the vault is the owner's switch (`vault`, FS-VLT); the shared capabilities Fansly has off by design (§7.7) —
 * X8's preview send and its receipt (the greeting goes by HTTP, §8.6) and the cached chat list (P17).
 */
export const FANSLY_CONTRACT: HostContractShape = {
  anchors: FANSLY_ANCHOR_IDS,
  switchedAnchors: ['vaultUpload'],
  switchedCapabilities: ['previewSend', 'receipt', 'chatList'],
};

/** Fansly's block of its report (`extensions['fansly-web']`): the state of EVERY anchor and own capability, none missing. */
export const FanslyContractBlockSchema = z.strictObject({
  anchors: z.record(FanslyAnchorIdSchema, z.enum(ANCHOR_STATES)),
  capabilities: z.record(FanslyCapabilitySchema, CapabilityStateSchema),
});
export type FanslyContractBlock = z.infer<typeof FanslyContractBlockSchema>;

/**
 * Fansly's report as its producer makes it (§7.7): the shared capabilities, every one named, and the full block of its
 * own — the strict branch of the shared `SiteContractReportSchema`, which accepts every report this one does.
 */
export const FanslyContractReportSchema = z.strictObject({
  host: z.literal('fansly-web'),
  build: z.nullable(displayText(80)),
  adapterVersion: boundedText(32),
  checkedAt: EpochMsSchema,
  capabilities: z.record(HostCapabilitySchema, CapabilityStateSchema),
  extensions: z.strictObject({ 'fansly-web': FanslyContractBlockSchema }),
});
export type FanslyContractReport = z.infer<typeof FanslyContractReportSchema>;
