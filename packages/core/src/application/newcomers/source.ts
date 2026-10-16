// Where a «Новые» list comes from when no hub list says who is new (R20 P10a; docs/project-unite/architecture.md §8.7,
// §8.17; FS-NEW-1, NF-001…NF-011, NF-025…NF-027, FX-017): the source port of the pass controller (./pass.ts). The
// background runs its own pass over the site — the new followers, their profiles, then one queue that checks each
// one's chat — and the window reads it through this port: it opens the pass, reads its rows a page at a time, hears
// the rows that change (never a poll, NF-004), reads a fan's conversation as the pass saw it (NF-010), and lets the
// pass go when it closes. A site implements the port over its own messages; the controller and the shared
// `NewcomersVM` name no site. The hub's list (ChatSpace) is the other source: its controller is ./controller.ts.
//
// Everything here is the site's answer in neutral words: a verdict is a `NewcomerCheck`, a failure a code (the site's
// own registry may name it) and never a text, a conversation the site's id of it, never the fan's.

import { type PassChange, type PassHistoryPage, type PassPage, type PassQuery, type PassState, type SourceAnswer } from '../../domain/newcomers/pass';

export type { PassChange, PassCounts, PassHistoryPage, PassPage, PassQuery, PassRow, PassRunState, PassState, SourceAnswer } from '../../domain/newcomers/pass';

export interface NewcomersPassSource {
  /** The window's period (NF-003): its choices, hours; the first one. */
  readonly windows: { readonly options: readonly number[]; readonly initial: number; readonly min: number; readonly max: number };
  /** Rows of one read: the list's pages (NF-006). */
  readonly pageSize: number;
  /** The most rows one read may ask for (a resync reads in steps of it). */
  readonly readMax: number;
  /** Messages of one read of a conversation, and the most the card shows (NF-010). */
  readonly historyPage: number;
  readonly historyCap: number;
  /** Opens the pass of this creator and period, or answers the open one as it is. */
  scan(hostAccountId: string, windowHours: number): Promise<SourceAnswer<PassState>>;
  /** Search, tabs, filters and counts cover the whole pass; only the matching rows are paged. */
  read(passId: string, offset: number, limit: number, query: PassQuery): Promise<SourceAnswer<PassPage>>;
  /** A fan's conversation as the pass reads it, newest first; `before` — the oldest message already shown. */
  history(passId: string, fanRef: string, before: string | null, limit: number): Promise<SourceAnswer<PassHistoryPage>>;
  /**
   * R20 P10b1, NF-038: «Пауза» (`false`) or «Проверить оставшихся» (`true`) — the pass as it stands after; null — it
   * is gone.
   */
  setRunning(passId: string, running: boolean): Promise<SourceAnswer<PassState | null>>;
  /** R20 P10b1, NF-038: «Проверить следующим» / «Проверить чат» — true: the queue took this fan. */
  checkNext(passId: string, fanRef: string): Promise<SourceAnswer<boolean>>;
  /** The window closed: the pass keeps what it found; nothing new starts for this window. Nobody waits for it. */
  close(passId: string): void;
  onChange(listener: (change: PassChange) => void): () => void;
  /** The port to the background came back after a loss: the changes meanwhile are lost, what is shown is read again. */
  onReconnect(listener: () => void): () => void;
  /** «Открыть … ↗» (NF-011): the address of the fan's chat on the site, opened by the person in a new tab; null — none. */
  chatHref(conversationRef: string): string | null;
}
