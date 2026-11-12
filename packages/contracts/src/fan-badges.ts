// A Fansly fan's badges in «Онлайн» (2026-10-28, the owner: «в онлайне видеть баджики fbuddy которые: какой у них
// алмазик и голубая карта есть или нет»), the two FBuddy shows beside a fan's name:
// - the blue card — Fansly's own «Recent Spender» mark: the fan's account `userFlags` bit 2 (never on a creator's
//   account, `flags` bit 2), read from Fansly by the background (`GET /account?ids=`, FS-NET-1 `online`);
// - the gem — FBuddy's spending tier: the fan's spend summed over every creator who shares it with FBuddy, read from
//   FBuddy's own API in the chatter's own FBuddy sign-in. On by default (the owner): its address is granted at install;
//   an older install the update did not grant it to still asks FBuddy, and allows it on Fansly's settings card.

import * as z from 'zod/mini';

/** FBuddy's tiers (`tierVersion=2`): Basic $0, Bronze to $100, Silver to $1 000, Gold to $3 000, Platinum $3 000 and more. */
export const FBUDDY_TIERS = ['basic', 'bronze', 'silver', 'gold', 'platinum'] as const;
export type FbuddyTier = (typeof FBUDDY_TIERS)[number];
export const FbuddyTierSchema = z.enum(FBUDDY_TIERS);

/**
 * Whether FBuddy's tiers could be read: `on` — read (a fan without a tier has none there); `off` — FBuddy said «not
 * signed in» and FBuddy's address is not allowed (Firefox sends FBuddy's sign-in only with it); `signed-out` — FBuddy
 * said «not signed in» with the address allowed: this browser is not signed in to FBuddy; `failed` — no answer.
 */
export const FBUDDY_STATES = ['on', 'off', 'signed-out', 'failed'] as const;
export type FbuddyState = (typeof FBUDDY_STATES)[number];
export const FbuddyStateSchema = z.enum(FBUDDY_STATES);

/** FBuddy's API: its address (a host permission granted at install) and the base its tiers are read from. */
export const FBUDDY_ORIGIN = 'https://apiv2.fbuddy.net';
export const FBUDDY_MATCH = `${FBUDDY_ORIGIN}/*`;

/**
 * «Значки» of «Онлайн» (2026-11-02, the owner: ticks of whom to show): what a fan's row shows — a gem of a tier, the blue
 * card, Basic's crossed banknote, or nothing. A gem with the card in its corner stands under both its tier and `card`.
 */
export const FAN_BADGE_MARKS = ['platinum', 'gold', 'silver', 'bronze', 'card', 'basic', 'none'] as const;
export type FanBadgeMark = (typeof FAN_BADGE_MARKS)[number];

/** One fan's badges; null — not known (not read, or the source did not say). */
export interface FanBadges {
  /** Fansly's blue card «Recent Spender». */
  readonly recentSpender: boolean | null;
  /** FBuddy's tier. */
  readonly tier: FbuddyTier | null;
}

/**
 * One fan of the background's answer (`fansly.fans.badges`): the badges, and (2026-11-12) whether Fansly returned the
 * fan's account to the background's latest read of it in the page's session (`seen`) and when that read was (`seenAt`,
 * ms); both null — no such read is kept.
 */
export const FanBadgesSchema = z.strictObject({
  fanRef: z.string(),
  recentSpender: z.nullable(z.boolean()),
  tier: z.nullable(FbuddyTierSchema),
  seen: z.nullable(z.boolean()),
  seenAt: z.nullable(z.number().check(z.int(), z.gte(0))),
});
