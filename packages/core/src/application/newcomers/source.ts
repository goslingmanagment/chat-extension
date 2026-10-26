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

import { type LiveTextTail } from '@cg/contracts/host';
import { type HumanCause } from '@cg/contracts/ids';
import { type CoverageWindowEntry, type GreetingDraftGeneration, type StartOp } from '@cg/contracts/ops';

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
  /**
   * Opens the pass of this creator and period, or answers the open one as it is. X59: `windowHours` null — the period
   * the site remembers (the person's last choice, else the default); a number — the person's choice, remembered.
   */
  scan(hostAccountId: string, windowHours: number | null): Promise<SourceAnswer<PassState>>;
  /** Search, tabs, filters and counts cover the whole pass; only the matching rows are paged. */
  read(passId: string, offset: number, limit: number, query: PassQuery): Promise<SourceAnswer<PassPage>>;
  /** A fan's conversation as the pass reads it, newest first; `before` — the oldest message already shown. */
  history(passId: string, fanRef: string, before: string | null, limit: number): Promise<SourceAnswer<PassHistoryPage>>;
  /**
   * R20 P10b1, NF-038: «Пауза» (`false`) or «Проверить оставшихся» (`true`) — the pass as it stands after; null — it
   * is gone.
   */
  setRunning(passId: string, running: boolean): Promise<SourceAnswer<PassState | null>>;
  /**
   * R20 P10b1, NF-038: «Проверить следующим» / «Проверить чат» — true: the queue took this fan. `next` — a click on the
   * row (the old window): only a running queue takes the fan first; a standing one is never started by it.
   */
  checkNext(passId: string, fanRef: string, next?: boolean): Promise<SourceAnswer<boolean>>;
  /**
   * R20 P10b2, FS-NEW-2: «Исключить из очереди» (`true`) / «Вернуть в очередь» (`false`) of a fan nobody can write to —
   * true: kept; false — the fan is not such a fan (any more), or the exclusion could not be kept.
   */
  exclude(passId: string, fanRef: string, excluded: boolean): Promise<SourceAnswer<boolean>>;
  /** The window closed: the pass keeps what it found; nothing new starts for this window. Nobody waits for it. */
  close(passId: string): void;
  onChange(listener: (change: PassChange) => void): () => void;
  /** The port to the background came back after a loss: the changes meanwhile are lost, what is shown is read again. */
  onReconnect(listener: () => void): () => void;
  /** «Открыть … ↗» (NF-011): the address of the fan's chat on the site, opened by the person in a new tab; null — none. */
  chatHref(conversationRef: string): string | null;
  /**
   * 2026-10-25: «Hi» of a greeting reminder's toast pressed in a tab of another model — `cause` is that click's
   * `navigate` token: the site brings a tab of the fan's model forward and greets there. True — handed over.
   */
  handover?(pageId: number, fanRef: string, cause: HumanCause): Promise<boolean>;
  /** R20 P10c: the card's greeting (FS-NEW-3, FS-NEW-6, FS-NEW-7); absent — the site greets from no card. */
  readonly greeting?: PassGreetingSource;
}

// ── the greeting of a card (R20 P10c) ──

/** What a greeting's generation takes of the pass (FS-NEW-7, X69): proof and confirmed texts of its history. */
export interface PassGreetingProof {
  readonly conversationRef: string;
  readonly historyRevision: string;
  /** The checked history's ids, both directions, the newest 60, oldest first. */
  readonly window: readonly CoverageWindowEntry[];
  /** The fan's newest ids of the window, newest first. */
  readonly knownFanMessageIds: readonly string[];
  readonly startProof: NonNullable<StartOp['startProof']>;
  /** The avatar of the profile the pass read (FX-018); null — none fit to send. */
  readonly fanAvatarUrl: string | null;
  /** 2026-10-26: the names and «about» of the profile the pass read; absent — none. */
  readonly fanAccount?: StartOp['fanAccount'];
  readonly capturedAt?: string | undefined;
  readonly tail?: LiveTextTail['messages'] | undefined;
}

/** The card's draft as the site keeps it (NF-012): its text, its revision, the history revision it was written on (NF-018). */
export interface PassDraft {
  readonly text: string;
  readonly revision: number;
  readonly historyRevision: string | null;
  readonly generation?: GreetingDraftGeneration;
  readonly outcome?: PassSendOutcome;
}

/** How a text is admitted (FS-NEW-6): the person's own, an unchanged AI result, an edited one. */
export type PassAdmission = { readonly kind: 'own' } | { readonly kind: 'ai' | 'ai-edited'; readonly generationRef: string; readonly variant: number };

/** One click of «Отправить» (FS-NEW-3): the field's text and what the person saw. */
export interface PassGreetingSend {
  readonly attemptId: string;
  readonly passId: string;
  readonly hostAccountId: string;
  readonly fanRef: string;
  readonly conversationRef: string;
  readonly text: string;
  readonly draftRevision: number;
  readonly historyRevision: string;
  readonly admission: PassAdmission;
  readonly cause: HumanCause;
  /** With an unchanged AI text: its operation. */
  readonly opId?: string;
}

/** Where the attempt stands when the site stops waiting for it: gone out, refused (with why), or unknown. */
export type PassSendOutcome =
  | { readonly s: 'sent' }
  | { readonly s: 'refused'; readonly code: string }
  | { readonly s: 'uncertain'; readonly code: string }
  /** Still under way (the site answers before its end only on a timeout of its own). */
  | { readonly s: 'pending' };

/** The person sent the card's text with the site's own button after «Открыть и вставить». */
export interface PassNativeSend {
  readonly passId: string;
  readonly hostAccountId: string;
  readonly fanRef: string;
  readonly conversationRef: string;
  readonly platformMessageId: string;
  readonly text: string;
  readonly admission: PassAdmission;
}

export interface PassGreetingSource {
  proof(passId: string, fanRef: string): Promise<SourceAnswer<PassGreetingProof>>;
  /**
   * 2026-10-25: the fan's history read again while Hi generates (read-only) — its revision now; a personal message of the
   * creator's makes the row «Уже писали» (`CG-SEND-PART`). Absent — the site checks only at the send.
   */
  recheck?(passId: string, fanRef: string): Promise<SourceAnswer<string>>;
  /** Without `text` — reads the draft; with it — writes it (an empty one clears it). */
  draft(passId: string, fanRef: string, text?: string, generation?: { readonly opId: string; readonly historyRevision: string }): Promise<SourceAnswer<PassDraft>>;
  /**
   * 2026-10-22: where the greeting of each fan of the pass stands as the site keeps its attempts — the fans with one that
   * went, may have gone or is under way — so the list says it before a card is opened (never «Не писали» over an unknown
   * outcome). Absent — the site keeps none.
   */
  outcomes?(passId: string): Promise<SourceAnswer<readonly { readonly fanRef: string; readonly outcome: PassSendOutcome }[]>>;
  send(click: PassGreetingSend): Promise<SourceAnswer<PassSendOutcome>>;
  /** True — the site took the report (the hub hears it now or later). */
  sent(report: PassNativeSend): Promise<SourceAnswer<boolean>>;
}
