// «Онлайн»'s badges of a Fansly fan (contracts fan-badges.ts): the two answers they are read from, as FBuddy reads
// them — Fansly's accounts for the blue card «Recent Spender», FBuddy's batch for the spending tier. Pure: the
// background asks, this reads.

import { FBUDDY_TIERS, type FbuddyTier } from '@cg/contracts/fan-badges';

/** Fansly's `account.flags` bit of a creator's account: a creator never carries the blue card (FBuddy's rule). */
export const FANSLY_FLAG_CREATOR = 2;
/** Fansly's `account.userFlags` bit of the blue card «Recent Spender». */
export const FANSLY_USER_FLAG_RECENT_SPENDER = 2;

const NATIVE_ID = /^[0-9]{1,20}$/;

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const bits = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/**
 * `GET /account?ids=`: whether each asked fan carries Fansly's blue card. A fan the answer does not name, or whose
 * `userFlags` it does not give, is left out (not known); a creator's account never has it. Null — not a list of accounts.
 */
export function readRecentSpenders(response: unknown, asked: readonly string[]): Map<string, boolean> | null {
  const list = Array.isArray(response) ? response : record(response)?.['accounts'];
  if (!Array.isArray(list)) return null;
  const wanted = new Set(asked);
  const found = new Map<string, boolean>();
  for (const entry of list) {
    const account = record(entry);
    const id = account?.['id'];
    if (account === null || typeof id !== 'string' || !wanted.has(id)) continue;
    const userFlags = bits(account['userFlags']);
    if (userFlags === null) continue;
    const creator = ((bits(account['flags']) ?? 0) & FANSLY_FLAG_CREATOR) !== 0;
    found.set(id, !creator && (userFlags & FANSLY_USER_FLAG_RECENT_SPENDER) === FANSLY_USER_FLAG_RECENT_SPENDER);
  }
  return found;
}

const isTier = (value: unknown): value is FbuddyTier => typeof value === 'string' && (FBUDDY_TIERS as readonly string[]).includes(value);

/**
 * FBuddy's `GET /api/v1/fan-spend/batch?fanIds=…&tierVersion=2`: `[{fanId, tier}]` (also inside `data`). A fan the answer
 * does not name has no tier there; an entry with an unknown tier or a malformed id is left out. Null — not that shape.
 */
export function readFbuddyTiers(body: unknown): Map<string, FbuddyTier> | null {
  const list = Array.isArray(body) ? body : record(body)?.['data'];
  if (!Array.isArray(list)) return null;
  const found = new Map<string, FbuddyTier>();
  for (const entry of list) {
    const item = record(entry);
    const fanId = item?.['fanId'];
    const tier = item?.['tier'];
    if (typeof fanId === 'string' && NATIVE_ID.test(fanId) && isTier(tier)) found.set(fanId, tier);
  }
  return found;
}
