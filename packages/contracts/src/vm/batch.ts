// 1.32.0: a batch of generations over the rows of a list — Spenders or «Новые» (decision of the owner, 2026-10-17).
// The person ticks fans in the list, one click «Сгенерировать для N» starts a generation for each — at most
// `parallel` at a time, the rest wait their turn — and every row says how its own went, with the text that came out.
// Nothing is sent by the batch: each result is on its fan's card, sent there by the person's own click, part by part,
// as always (X8: never «send all», no hotkey, never the next part by itself).
//
// What a fan gets: «Новые» — Hi; Spenders — Reply to a fan who wrote last, Ping to one who did not.

import { type Msg } from './i18n';

export const BATCH_LISTS = ['spenders', 'newcomers'] as const;
export type BatchList = (typeof BATCH_LISTS)[number];

export const BATCH_LIMITS = {
  /** Fans one batch may hold: the tab keeps at most 24 results (`resultsPerTab`), and room is left for the dock. */
  picks: 20,
  /** Generations of a batch at once: the background admits three per tab. */
  parallel: 3,
  /**
   * The one click of «Сгенерировать для N» may ask this many generate tokens (one per start, a start the background
   * refused for the tab's limit is asked again) and for this long; then it is spent, and the fans left wait for a
   * new click.
   */
  grantTokens: 40,
  grantTtlMs: 15 * 60_000,
} as const;

/** How a fan of the batch stands: waiting its turn, generating, its result is ready, its result went out, or why not. */
export const BATCH_ROW_STATES = ['queued', 'generating', 'ready', 'sent', 'failed'] as const;
export type BatchRowState = (typeof BATCH_ROW_STATES)[number];

export interface BatchRowVM {
  /** The fan may be ticked: a batch could generate for them now (on «Новые» — nobody greeted or holds them). */
  readonly pickable: boolean;
  /** Ticked for the next batch. */
  readonly picked: boolean;
  /** null — not in a batch. */
  readonly state: BatchRowState | null;
  /** `ready` and `sent`: the first part of the result, as its card shows it; null — none. */
  readonly text: string | null;
  /**
   * `failed`: the code (a shared CG code or the site's own) and, for a shared one, its title as the registry names it
   * (the list's window draws it without the registry); null otherwise.
   */
  readonly failure: { readonly code: string; readonly title: Msg | null } | null;
}

export interface BatchVM {
  /** Fans ticked for the next click. */
  readonly picked: number;
  readonly max: number;
  readonly queued: number;
  readonly generating: number;
  readonly ready: number;
  readonly sent: number;
  readonly failed: number;
  /** Why «Сгенерировать» is off while fans are ticked; null — it is on. */
  readonly reason: Msg | null;
}
