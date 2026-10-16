// «Нельзя написать» on Fansly as a pure rule (R20 P10b2; spec FS-NEW-2; parity FX-003; docs/project-unite/
// architecture.md §8.7): may the creator write to the fan at all — decided from the fan's DM rules the group object
// carries, before anything is generated, held or sent, never from a failed `POST /message`.
//
// Fansly's own answer, `verifyNew` (main.2e6b96097a4bb73b.js, read 2026-10-12), as the old extension ported it
// (the old extension's src/shared/fansly-dm-permissions.ts:46-89). A group names the fan's rule sets (`dmPermissionFlags`) and
// what the creator already has toward the fan (`accountDmPermissionFlags`: tips sent, a price paid). Any one rule set
// met is enough; Fansly hides its composer while none is. No tip is ever attached, so a price is unmet unless
// paid already; a price Fansly's own reader could not read is unmet too, never a free chat. The subscription-tier and
// list names Fansly reads there only label its own screen; they never change the bits, so they are not read here.
// Nothing here asks Fansly, keeps a text or names a site.

import { type NewcomerDmClosed } from '@cg/contracts/vm';

/** One way into the fan's DMs the creator does not meet. */
export interface DmRequirement {
  /**
   * Fansly's bits still unmet: 1 a price per message, 2 follow the fan, 4 subscribe to the fan, 8 tips, 16 followed by
   * the fan, 32 media purchases, 64 subscribed by the fan, 128 on the fan's list.
   */
  readonly flags: number;
  /** Mills per message (bit 1); null — a price Fansly's own reader could not read; 0 — no price in this way. */
  readonly price: number | null;
}

/** The bit of a price per message: a way that asks only this is a paid DM. */
export const DM_PRICE_BIT = 1;

type Plain = Record<string, unknown>;

const plain = (value: unknown): Plain | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Plain) : null);

/** The metadata are JSON strings, each value a JSON string of its own. */
function parse(value: unknown): Plain | null {
  if (typeof value !== 'string') return null;
  try {
    return plain(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

/** A finite number, or 0 (the rule's own reading of a missing amount). */
const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Fansly's verifyTipMetdata / verifyMediaPurchasesMetdata: what is still missing. */
function missing(rule: unknown, have: unknown, field: 'totalSent' | 'totalPurchased'): number {
  const needed = amount(parse(rule)?.['minAmount']);
  return needed ? needed - amount(parse(have)?.[field]) : 0;
}

/**
 * Fansly's verifyPriceMetdata. A null price passes there (`0 >= null`); an unreadable rule throws there and a missing
 * price stays unmet. Here both are an unmet price of unknown size, never a free chat.
 */
function unpaidPrice(rule: unknown, paid: unknown): number | null {
  const price = parse(rule)?.['price'];
  if (price === null) return 0;
  if (typeof price !== 'number' || !Number.isFinite(price)) return null;
  return amount(parse(paid)?.['price']) >= price ? 0 : price;
}

/**
 * The ways into the fan's DMs the creator does not meet: `[]` — the DMs are open (no rule set, or one met); null — the
 * answer carried no rules (`dmPermissionFlags` absent): it says nothing either way.
 */
export function unmetDmRequirements(rules: unknown, account: unknown): DmRequirement[] | null {
  if (!Array.isArray(rules)) return null;
  const have = parse(plain(account)?.['metadata']) ?? {};
  const unmet: DmRequirement[] = [];
  for (const value of rules as unknown[]) {
    const rule = plain(value) ?? {};
    const flags = amount(rule['flags']);
    const meta = parse(rule['metadata']) ?? {};
    let open = flags & ~amount(rule['verificationFlags']);
    const tips = flags & 8 ? missing(meta['8'], have['8'], 'totalSent') : 0;
    const media = flags & 32 ? missing(meta['32'], have['32'], 'totalPurchased') : 0;
    const price = flags & DM_PRICE_BIT ? unpaidPrice(meta['1'], have['1']) : 0;
    open = tips > 0 ? open | 8 : open & ~8;
    open = media > 0 ? open | 32 : open & ~32;
    open = price === null || price > 0 ? open | DM_PRICE_BIT : open & ~DM_PRICE_BIT;
    if (!open) return [];
    unmet.push({ flags: open, price: open & DM_PRICE_BIT ? price : 0 });
  }
  return unmet;
}

/**
 * Why the fan cannot be written to, in the window's words: `paid` — a way asks only a price per message (the common
 * case, as the old window named it first); `permissions` — every way asks something else of the creator. Null — the
 * DMs are open, or the answer said nothing about them.
 */
export function dmClosedOf(unmet: readonly DmRequirement[] | null): NewcomerDmClosed | null {
  if (unmet === null || unmet.length === 0) return null;
  return unmet.some((requirement) => requirement.flags === DM_PRICE_BIT) ? 'paid' : 'permissions';
}

/** The fan's DMs as a group object (`GET /group/<id>/`, `POST /group`, the inbox's aggregation) carries them. */
export function groupDmClosed(group: unknown): { readonly read: boolean; readonly closed: NewcomerDmClosed | null; readonly priceMills: number | null } {
  const value = plain(group);
  const unmet = unmetDmRequirements(value?.['dmPermissionFlags'], value?.['accountDmPermissionFlags']);
  const prices = (unmet ?? []).flatMap(({ flags, price }) => (flags === DM_PRICE_BIT && price !== null && price > 0 ? [price] : []));
  return { read: unmet !== null, closed: dmClosedOf(unmet), priceMills: prices.length === 0 ? null : Math.round(Math.min(...prices)) };
}
