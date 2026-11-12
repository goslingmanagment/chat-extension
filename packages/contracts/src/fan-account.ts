// A fan the page stopped seeing (2026-11-12, hub `fan-account-state-v1`): on both sites the hub says what the page knows
// of the fan's account (contracts hub/wire.ts `FanAccountStateSchema`), and on Fansly the background's own read of
// `GET /account?ids=` in the page's session says at once whether Fansly still returns him. The two are merged into one
// mark (core domain/fans/account-state.ts) that Spenders, «Рассылка» and Fansly's chat header show. A mark, never a
// block: the extension only says it.

import * as z from 'zod/mini';

import { IsoTimestampSchema } from './primitives';

/**
 * Why the page does not see the fan: `deleted` — the account is gone; `blocked` — the account exists but the page does
 * not see him (Fansly: he blocked the page; OnlyFans: he is in the page's block list); `unchecked` — the page does not
 * see him and the cause is not known yet.
 */
export const FAN_GONE_STATES = ['deleted', 'blocked', 'unchecked'] as const;
export type FanGoneState = (typeof FAN_GONE_STATES)[number];

/**
 * The mark: the state, when the page stopped seeing him (null — unknown), when that was last checked, and `local` —
 * only this browser's read says it (Fansly did not return him and the hub has not confirmed it yet).
 */
export const FanGoneSchema = z.strictObject({
  state: z.enum(FAN_GONE_STATES),
  since: z.nullable(IsoTimestampSchema),
  checkedAt: IsoTimestampSchema,
  local: z.boolean(),
});
export type FanGone = z.infer<typeof FanGoneSchema>;

/** The background's own read of a fan's account: whether Fansly returned it, and when (ms). */
export interface FanAccountRead {
  readonly seen: boolean;
  readonly at: number;
}
