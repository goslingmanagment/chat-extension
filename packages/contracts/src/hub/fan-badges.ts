// The fans' badges a Fansly tab's background read for the boards (hub `clientFanBadges`, capability `fan-badges-v1`):
// FBuddy's spending tier and Fansly's blue card «Recent Spender» (contracts fan-badges.ts), passed on so the hub keeps
// them for its analytics and agents. The hub sends nothing to anyone.
//
// The request mirrors the hub's strict body; the answer is open like every hub answer.

import * as z from 'zod/mini';

import { FbuddyTierSchema } from '../fan-badges';
import { NativeIdSchema } from '../primitives';
import { PageLabelSchema } from './wire';

/** The fans one report names at most (hub `CLIENT_FAN_BADGES_MAX`). */
export const FAN_BADGES_REPORT_MAX = 300;

/** One fan's badges; a field only when its source answered for the fan. */
export const FanBadgesReportFanSchema = z.strictObject({
  fanRef: NativeIdSchema,
  /** FBuddy answered: the fan's tier, or null — FBuddy has none for him. */
  fbuddyTier: z.optional(z.nullable(FbuddyTierSchema)),
  /** Fansly's blue card, as the fan's account says it. */
  recentSpender: z.optional(z.boolean()),
});
export type FanBadgesReportFan = z.infer<typeof FanBadgesReportFanSchema>;

export const FanBadgesReportSchema = z.strictObject({
  pageLabel: PageLabelSchema,
  fans: z.array(FanBadgesReportFanSchema).check(z.minLength(1), z.maxLength(FAN_BADGES_REPORT_MAX)),
});
export type FanBadgesReport = z.infer<typeof FanBadgesReportSchema>;

/** Fans kept anew (a badge the hub did not have, or had another value of), already as reported, and not of the page (yet). */
export const FanBadgesReportResultSchema = z.object({ changed: z.number(), unchanged: z.number(), skipped: z.number(), serverNow: z.string() });
export type FanBadgesReportResult = z.infer<typeof FanBadgesReportResultSchema>;
