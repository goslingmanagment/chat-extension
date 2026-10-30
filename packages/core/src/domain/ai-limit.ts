// `ai-limit-v1`: the person's own daily AI limit (the owner's; Moscow day, all
// pages) as the dock and the popup show it. Pure.

import { type AiLimitSnapshot } from '@cg/contracts';
import { type AiLimitVM } from '@cg/contracts/vm';

/** «low» from this share of the limit on: the dock turns amber and the background warns once a day. */
export const AI_LIMIT_LOW_SHARE = 0.8;

export type AiLimitLevel = AiLimitVM['level'];

/** Where the spend stands against the limit; null — the person has no limit. */
export function aiLimitLevel(limit: Pick<AiLimitSnapshot, 'dailyLimitMicroUsd' | 'todayMicroUsd'>): AiLimitLevel | null {
  if (limit.dailyLimitMicroUsd === null) return null;
  if (limit.todayMicroUsd >= limit.dailyLimitMicroUsd) return 'out';
  return limit.todayMicroUsd >= limit.dailyLimitMicroUsd * AI_LIMIT_LOW_SHARE ? 'low' : 'ok';
}

/** `$1.20`: AI money as the person reads it, to the cent. */
export function formatAiMoney(microUsd: number): string {
  return `$${(Math.max(microUsd, 0) / 1_000_000).toFixed(2)}`;
}

/** The dock's chip and the popup's line; null — no limit for this person, or not known yet. */
export function aiLimitVm(limit: AiLimitSnapshot | null): AiLimitVM | null {
  if (limit === null || limit.dailyLimitMicroUsd === null) return null;
  const level = aiLimitLevel(limit) ?? 'ok';
  const share = limit.dailyLimitMicroUsd === 0 ? 1 : Math.min(limit.todayMicroUsd / limit.dailyLimitMicroUsd, 1);
  return { spent: formatAiMoney(limit.todayMicroUsd), limit: formatAiMoney(limit.dailyLimitMicroUsd), share, level, resetsAt: limit.resetsAt };
}
