// A board's result in the dock of its own chat (architecture.md §6.5: «после
// вставки док показывает остальные части той же операции», п. 4 — the Б2
// question in the chat a board opened). «Открыть и вставить» closes the board
// and opens the fan's chat; from that moment the place where the person works
// with the rest of the result is that chat's dock. The preview's controller
// (the boards' chunk) and the AI workspace (the dock's chunk) meet through
// these three shapes, wired by the tab's composition root: types only, so
// neither chunk carries the other.
//
// Nothing here inserts or sends. Every part goes into the composer by its own
// click in the dock, under the dock's insert rules (§6.4), and out by
// ChatSpace's own Send.

import { type ChatRef, type PartRef } from '@cg/contracts/ids';
import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type ReasonVM } from '@cg/contracts/vm';

/** What the board's controller hands the dock once «Открыть и вставить» has opened the chat. */
export interface BoardHandover {
  readonly opId: string;
  /** The operation's own chat: the dock takes the result only while exactly this chat is open. */
  readonly chat: ChatRef;
  /**
   * The persona definition the result was made under, as the controller that
   * made it knows it; null — it does not (the result came back after a tab
   * reload): such a result is never inserted from the dock (§7 «Ограда»), so
   * the dock does not take it.
   */
  readonly personaDefinitionId: string | null;
  /** The Split snapshot of the generation. */
  readonly split: boolean;
  readonly part: PartRef;
  /**
   * `inserted` — the part is in the composer. `needs-confirm` — the composer
   * holds the person's own text and nothing was written: the dock asks
   * «Заменить / Добавить в конец» about this part (§6.5 п. 4).
   */
  readonly outcome: 'inserted' | 'needs-confirm';
}

/** What the board that made a result says of one of its parts. */
export interface BoardPartFacts {
  /** The part is delivered — by the preview send or by the person's own Send, proven by receipt and echo; null — it is not. */
  readonly sentAt: IsoTimestamp | null;
  /**
   * Why the part is not put into the chat now, by the board's own rules: a
   * part of the fan on its way or with an unknown outcome holds the fan
   * (§6.7.8, §6.7.9), a greeting of «Новые» needs its lease until the first
   * part is confirmed (§6.5). null — nothing holds it.
   */
  readonly hold: ReasonVM | null;
}

/** The boards' side of the results the dock shows; bound late — the boards load with the first board the person opens. */
export interface BoardResults {
  /** null — the board does not hold the result (any more). */
  part(opId: string, part: PartRef): BoardPartFacts | null;
  /** A card shows the result now: its «Скрыть», «Развернуть» and «Копировать» are that card's, not the dock's. */
  showing(opId: string): boolean;
  subscribe(listener: () => void): () => void;
}
