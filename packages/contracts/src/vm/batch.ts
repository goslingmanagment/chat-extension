// 1.32.0: a batch of generations over the rows of a list — Spenders or «Новые» (decision of the owner, 2026-10-17).
// The person ticks fans in the list, one click «Сгенерировать для N» starts a generation for each — at most
// `parallel` at a time, the rest wait their turn — and every row says how its own went, with the text that came out.
// Each result is on its fan's card, sent there by the person's own click, part by part (X8: no hotkey, never the next
// part by itself). One exception, the owner's (2026-10-27): «Отправить всем» of «Новые» sends the batch's ready
// greetings by one click, one at a time with a second between them (`BatchSendVM`).
//
// What a fan gets: «Новые» — Hi; Spenders — Reply to a fan who wrote last, Ping to one who did not.

import { type Msg } from './i18n';

/** 1.63.0: `outreach` — the versions of «Рассылка» (Fix of the common text for each fan). */
export const BATCH_LISTS = ['spenders', 'newcomers', 'outreach'] as const;
export type BatchList = (typeof BATCH_LISTS)[number];

export const BATCH_LIMITS = {
  /** Fans one batch may hold — a whole period of «Новые» (the owner, X59: «при 60 новых за раз»); `resultsPerTab` keeps them all. */
  picks: 60,
  /** Generations of a batch at once: the background admits three per tab, one stays free for the dock. */
  parallel: 2,
  /**
   * The one click of «Сгенерировать для N» may ask this many generate tokens (one per start, a start the background
   * refused for the tab's limit is asked again) and for this long; then it is spent, and the fans left wait for a
   * new click.
   */
  grantTokens: 120,
  grantTtlMs: 15 * 60_000,
  /** «Отправить всем»: the second between two sends of the run (the owner, 2026-10-27). */
  sendGapMs: 1_000,
  /**
   * The one click of «Отправить всем» may ask this many send tokens (a greeting of several parts asks one per part) and
   * for this long: 60 greetings under the hub's 30 a minute take a few minutes.
   */
  sendTokens: 180,
  sendTtlMs: 20 * 60_000,
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
  /** «Отправить всем» (the owner, 2026-10-27); absent — the list has none. */
  readonly send?: BatchSendVM;
}

/** «Отправить всем» of a batch: what one click would send, and how its run goes. */
export interface BatchSendVM {
  /** Ready greetings the click would send (their rows' «Отправить» could go now or after the pause). */
  readonly ready: number;
  /** The hub's limit of sends a minute the run keeps to. */
  readonly perMinute: number;
  /** The last run; null — none since the batch began. */
  readonly run: BatchSendRunVM | null;
}

export interface BatchSendRunVM {
  /** Still sending; false — done or stopped. */
  readonly running: boolean;
  /** Greetings the click took. */
  readonly total: number;
  /** The run has been through this many of them. */
  readonly done: number;
  /** Gone out, as their rows say. */
  readonly sent: number;
  /** Did not go (the row says why) or went with an unknown outcome: never sent again by the run. */
  readonly failed: number;
  /** Waiting for the hub's limit of sends a minute: the next goes when the minute frees. */
  readonly held: boolean;
}
