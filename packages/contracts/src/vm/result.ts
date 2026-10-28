// A generation result as the UI draws it (architecture.md §10.2 ResultVM,
// PartVM, PreviewSendView; ui-design.md §4.2–§4.9, §4.13, §8.2–§8.3). Actions
// on a result exist only after `done` and a full parse (§7); the stream text
// is a preview without buttons. Every draft says it has not been sent until a
// part is (ui-design §1 п. 9).

import { type CgCode, type CgErrorView, type I18nKey } from '../errors';
import { type FeatureId, type Surface, type Tone } from '../features';
import { type PartRef } from '../ids';
import { type OpState, type ResultMarkVM } from '../ops';
import { type IsoTimestamp, type Uuid } from '../primitives';
import { type PreviewSendPreflight, type SendAttemptView } from '../send';
import { PREVIEW_SEND_CONDITION_CODES, isRetryableEnd } from '../send-rules';
import { type UiAction } from './actions';
import { type ReasonVM } from './catalog';
import { type Msg } from './i18n';
import { type ArtifactHandle } from './selectors';
import { type ActionButtonVM, type RunningOpVM } from './view';

/** Stage line of a running generation (ui-design §4.4): done stages with a tick, the current one with «…», no future ones. */
export const STAGE_IDS = ['context', 'thinking', 'writing', 'retry-wait', 'parsing', 'saving'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface PhaseVM {
  /** The `m:ss` timer counts from here. */
  readonly startedAt: number;
  readonly stages: readonly { readonly id: StageId; readonly label: Msg; readonly state: 'done' | 'current' }[];
  /** The one transparent retry after a structured 503 before any output: «Сервис недоступен, повтор через 5 с…» (§7). */
  readonly retryAt: number | null;
  /** «Отменить ⌘.»; null when the operation can no longer be canceled. */
  readonly cancel: UiAction | null;
}

/**
 * Why «Отправить» is off or refused, by code (ui-design §5.9): the text the
 * disabled button explains itself with, never a toast.
 */
export const SEND_REASON_KEYS = {
  'CG-SEND-OFF': 'send.reason.off',
  'CG-SEND-HOST': 'send.reason.host',
  'CG-SEND-RECEIPT': 'send.reason.receipt',
  'CG-SEND-ACTIVE-CHAT': 'send.reason.activeChat',
  'CG-SEND-PERMISSION': 'send.reason.permission',
  'CG-SEND-FAN': 'send.reason.fan',
  'CG-SEND-MIMIC': 'send.reason.mimic',
  'CG-SEND-TRANSLATOR': 'send.reason.translator',
  'CG-SEND-FRESHNESS': 'send.reason.freshness',
  'CG-SEND-BUSY': 'send.reason.busy',
  'CG-SEND-QUEUE': 'send.reason.queue',
  'CG-SEND-PART': 'send.reason.part',
  'CG-SEND-GUARD': 'send.reason.guard',
  'CG-CONTEXT-CHANGED': 'send.reason.contextChanged',
  'CG-CLAIM-BUSY': 'send.reason.claimBusy',
  /** The hub's `preview_send_rate_limited` (6 per minute): off until its deadline. */
  'CG-HUB-RATE-LIMIT': 'send.reason.rateLimit',
  /** The hub's `custody_held`: another send to this fan is inside its ticket (the desktop's included) — a few seconds, then a new click. */
  'CG-SEND-UNCERTAIN': 'send.reason.otherUncertain',
  /** 1.30.0 (X53): the picked media cannot go yet (the controller's reason says why). */
  'CG-SEND-MEDIA': 'send.reason.media',
} as const satisfies Partial<Record<CgCode, I18nKey>>;
export type SendReasonCode = keyof typeof SEND_REASON_KEYS;

/**
 * 1.10.0: the text of CG-SEND-HOST while ChatSpace has not created yet what the preview send reads — no chat
 * composer has been open in the page since it loaded (the host contract's anchor is `notYet`). The code stays
 * CG-SEND-HOST; the text says what lifts it: open any chat.
 */
export const SEND_REASON_HOST_NOT_YET = 'send.reason.hostNotYet' as const satisfies I18nKey;

export function isSendReasonCode(code: CgCode): code is SendReasonCode {
  return Object.prototype.hasOwnProperty.call(SEND_REASON_KEYS, code);
}

/**
 * The «Отправить» row of a part in a preview, nine states one to one with
 * ui-design §4.13 (X8, §6.7.7). `sent` needs the receipt AND the echo with
 * the same id; `accepted` (receipt only) and `uncertain` never look like it.
 */
export type PreviewSendView =
  | { readonly s: 'available' }
  /** The code explains the disabled button (never a toast); `reason` is its text (SEND_REASON_KEYS, or SEND_REASON_HOST_NOT_YET). */
  | { readonly s: 'unavailable'; readonly code: SendReasonCode; readonly reason: Msg }
  /** The fan wrote after Generate: a warning, «Отправить всё равно» sends (audit 2026-10-20, row 3). */
  | { readonly s: 'held-stale'; readonly at: IsoTimestamp | null }
  /** Whether the fan wrote since Generate cannot be checked: a warning, «Отправить всё равно» sends (row 4). */
  | { readonly s: 'unverified' }
  /**
   * Chat Memory week 1: another chatter wrote to the fan in the last 15 minutes («в разговоре»): a warning, «Отправить
   * всё равно» passes it; the warnings under it (stale, unverified) still ask for themselves after.
   */
  | { readonly s: 'held-talking'; readonly names: readonly string[]; readonly at: IsoTimestamp }
  | { readonly s: 'queued' }
  | { readonly s: 'sending' }
  | { readonly s: 'accepted' }
  | { readonly s: 'sent'; readonly at: IsoTimestamp }
  /** `canRetry` by isRetryableEnd (nothing reached ChatSpace: CG-SEND-QUEUE, a failed dispatch); otherwise «Открыть и вставить» and «Копировать». */
  | { readonly s: 'rejected'; readonly code: CgCode; readonly detail?: string; readonly canRetry: boolean }
  /** No retry, no «Открыть и вставить»: only «Открыть чат для проверки» for this attempt (§6.7.8). */
  | { readonly s: 'uncertain'; readonly since: IsoTimestamp; readonly attemptId: Uuid };

/** PreviewSendView without its texts and times: what previewSendStateOf decides; the controller adds `reason`, `at`, `since`, `detail`. */
export type PreviewSendState =
  | { readonly s: 'available' }
  | { readonly s: 'unavailable'; readonly code: SendReasonCode }
  | { readonly s: 'held-stale' }
  | { readonly s: 'unverified' }
  | { readonly s: 'queued' }
  | { readonly s: 'sending' }
  | { readonly s: 'accepted' }
  | { readonly s: 'sent' }
  | { readonly s: 'rejected'; readonly code: CgCode; readonly canRetry: boolean }
  | { readonly s: 'uncertain'; readonly attemptId: Uuid };

/**
 * Holds only the background can see end: the hub's rate-limit deadline. MAIN's preflight does not know it, so the row
 * stays off until the controller drops the attempt.
 */
const HOLDS_THE_BACKGROUND_CLEARS: readonly CgCode[] = ['CG-HUB-RATE-LIMIT'];

function fromPreflight(preflight: PreviewSendPreflight): PreviewSendState {
  if (preflight.ok) return preflight.warn === 'CG-SEND-STALE' ? { s: 'held-stale' } : preflight.warn === 'CG-SEND-FRESHNESS' ? { s: 'unverified' } : { s: 'available' };
  if (preflight.code === 'CG-SEND-STALE') return { s: 'held-stale' };
  return { s: 'unavailable', code: preflight.code };
}

/**
 * The one mapping of an attempt (or its absence) and the current preflight to
 * the «Отправить» row, total over SEND_ATTEMPT_STATES (§6.7.7, ui-design §4.13):
 * - no attempt, or `ready` → the preflight: available, unavailable by code, or the freshness warnings held-stale and
 *   unverified (each passed by «Отправить всё равно»);
 * - `preparing` (local lock and hub dispatch, before ChatSpace starts) → queued;
 * - `nativeEnqueued` (ChatSpace's send started, X8 never queues behind a busy account) → sending;
 * - `nativeAccepted` → accepted; `sentObserved` → sent; `uncertain` → uncertain;
 * - `rejected` (proven native refusal) → rejected without retry;
 * - `notEnqueued` (the queue's null, CG-SEND-QUEUE) → rejected with «Отправить ещё раз»;
 * - `held`: CG-SEND-STALE → held-stale; a code another click cannot lift
 *   (SEND_HOLD_CODES_WITHOUT_RETRY) or the hub's rate limit → unavailable with
 *   it (the controller drops the attempt once the deadline passes);
 *   any other §6.7.4 condition → the current preflight decides (the condition
 *   may have cleared); anything else — a transport failure of `dispatch`, an
 *   expired ticket (CG-TIMEOUT), the hub's refusal while another send to the
 *   fan is inside its ticket (CG-SEND-UNCERTAIN: «подождите пару секунд») —
 *   nothing reached ChatSpace → rejected with retry.
 */
export function previewSendStateOf(attempt: SendAttemptView | null, preflight: PreviewSendPreflight): PreviewSendState {
  if (attempt === null) return fromPreflight(preflight);
  const code = attempt.code;
  switch (attempt.state) {
    case 'ready':
      return fromPreflight(preflight);
    case 'preparing':
      return { s: 'queued' };
    case 'nativeEnqueued':
      return { s: 'sending' };
    case 'nativeAccepted':
      return { s: 'accepted' };
    case 'sentObserved':
      return { s: 'sent' };
    case 'uncertain':
      return { s: 'uncertain', attemptId: attempt.attemptId };
    case 'rejected':
      return { s: 'rejected', code: code ?? 'CG-SEND-REJECTED', canRetry: false };
    case 'notEnqueued':
      return { s: 'rejected', code: code ?? 'CG-SEND-QUEUE', canRetry: isRetryableEnd('notEnqueued', code) };
    case 'held':
      if (code === 'CG-SEND-STALE') return { s: 'held-stale' };
      if (code === 'CG-SEND-FRESHNESS') return { s: 'unverified' };
      if (code !== undefined && isSendReasonCode(code) && (HOLDS_THE_BACKGROUND_CLEARS.includes(code) || !isRetryableEnd('held', code))) {
        return { s: 'unavailable', code };
      }
      if (code !== undefined && (PREVIEW_SEND_CONDITION_CODES as readonly CgCode[]).includes(code)) return fromPreflight(preflight);
      return { s: 'rejected', code: code ?? 'CG-SEND-HOST', canRetry: isRetryableEnd('held', code) };
  }
}

export const PREVIEW_SEND_STATES = [
  'available',
  'unavailable',
  'held-stale',
  'unverified',
  'held-talking',
  'queued',
  'sending',
  'accepted',
  'sent',
  'rejected',
  'uncertain',
] as const satisfies readonly PreviewSendView['s'][];

/**
 * Parts behind one on its way (§6.7.9): «Отправка после части N». An unknown outcome holds nothing behind it
 * (2026-10-20 audit, row 2). The controller computes it; the UI does not reorder.
 */
export type SendOrderVM = { readonly kind: 'after'; readonly part: number };

/** «Открыть и вставить» of one part (§6.5): waiting shows a spinner word; cancel and timeout end in a toast. */
export type OpenInsertVM =
  | { readonly s: 'hidden' }
  | { readonly s: 'available' }
  | { readonly s: 'unavailable'; readonly reason: ReasonVM }
  | { readonly s: 'waiting'; readonly until: number };

export interface PartVM {
  /** 0-based PartRef.index; the screen shows index + 1. */
  readonly index: number;
  /** Hi variant, 0-based; null outside Hi. */
  readonly variant: number | null;
  /** «Часть 1» for screen readers (AI-011). */
  readonly label: Msg;
  /** A single message (Split off) has no number. */
  readonly numbered: boolean;
  /** The parsed AI part, or the person's edit of it (`edited`): what «Отправить» sends. */
  readonly text: string;
  /** Previews: the part may be edited before it is sent (2026-10-20 audit, row 1). */
  readonly editable?: boolean;
  /** Its editor is open (`text` is the person's). */
  readonly editing?: boolean;
  /** `text` is not the AI's: no «Открыть и вставить» or copy of the AI text beside it. */
  readonly edited?: boolean;
  /** The next part to insert: «Вставить ↵» as a line button. */
  readonly next: boolean;
  readonly insert: 'idle' | 'pending' | 'done' | 'failed';
  readonly insertError: CgErrorView | null;
  /** Insert is off for this part (CG-GATE-LANGUAGE, copy-only, a held board part). */
  readonly insertBlocked: ReasonVM | null;
  /** Copy is off too: a Coach draft in Cyrillic for a fan who does not write Cyrillic (CG-GATE-LANGUAGE, AI-087). */
  readonly copyBlocked: ReasonVM | null;
  readonly copy: 'idle' | 'done' | 'failed';
  readonly copyError: CgErrorView | null;
  readonly copyHandle: ArtifactHandle;
  /** Inserted (dock) or sent (preview): one line, «✓ вставлено» / «✓ Отправлено 09:21» (ui-design §3.2). */
  readonly collapsed: boolean;
  /** Previews and «Новые» only. */
  readonly send?: PreviewSendView;
  readonly sendOrder?: SendOrderVM | null;
  readonly openInsert?: OpenInsertVM;
}

export interface VariantVM {
  readonly index: number;
  /** «Вариант 1». */
  readonly label: Msg;
  readonly parts: readonly PartVM[];
}

/** Fix (ui-design §4.5, AI-020…AI-025). */
export interface FixVM {
  /** «Ваш текст»: the draft the Fix was made from. */
  readonly sourceDraft: string;
  /** False without a verified editor: «Заменить мой черновик» is off with a reason, Copy becomes primary. */
  readonly canReplace: boolean;
  readonly replaceReason: ReasonVM | null;
  readonly replaced: boolean;
  /** «Вернуть мой текст» until this moment (30 s after the replacement). */
  readonly restoreUntil: number | null;
  readonly restoreExpired: boolean;
}

/** Б2: the draft has the person's text, or it changed during the generation (ui-design §4.6). */
export interface ConfirmVM {
  readonly confirmationId: Uuid;
  readonly kind: 'human-draft' | 'draft-changed';
  readonly part: PartRef;
  /** No editor: the append goes through setText and the draft's formatting is lost (§6.4). */
  readonly formatLoss: boolean;
}

/** Debug footer of an expanded result (DB-011, DB-012, DB-016, DB-017, DB-020); never in a collapsed dock. */
export interface ResultDebugVM {
  /** «in 3 412 tok • out 286 tok • $0.0143 • 3.8 с • claude-sonnet» — technical, not translated. */
  readonly costLine: string | null;
  readonly stages: readonly { readonly name: string; readonly ms: number }[];
  readonly totalMs: number | null;
  readonly hubStages: readonly { readonly name: string; readonly ms: number }[];
  /** «Промпт» → debug-prompt.html with an opaque token; null when the echo is off. */
  readonly prompt: UiAction | null;
  readonly reasoning: string | null;
  readonly context: {
    readonly source: string;
    readonly coverage: string;
    readonly windowRequested: number;
    readonly windowServed: number;
    readonly liveAccepted: number;
    readonly liveRejected: number;
  } | null;
  /** The live 100 ms timer runs only while expanded and streaming (DB-012). */
  readonly liveTimer: boolean;
}

/**
 * 1.15.0 (R20 P8b2; spec §3.5, FS-TAIL-8; ui-design §4.7): the catalog keys of the words of a window check's mark
 * (`ResultVM.stale` with reason `unverified`, `window-miss`, `deleted-served`) — its title and the continuation, as the
 * shared result draws them. Only the catalog of a site whose verdict gives these reasons carries them (a Fansly tab's,
 * `core/src/domain/hosts/fansly/i18n`): the shared catalog does not, so no ChatSpace bundle carries their words.
 * `fan-wrote` and `archive-moved` keep the shared «Фан написал новое» (`result.stale.title`, `result.stale.body`).
 * Types only.
 */
export type ResultMarkKey = `result.stale.${'unverified' | 'windowMiss' | 'deletedServed' | 'historyPartial' | 'detailsChanged'}.${'title' | 'body'}`;

export interface ResultVM {
  readonly opId: Uuid;
  /** The person's own text sent from the draft field (2026-10-20 audit, row 1): its head says so, no «Ещё раз». */
  readonly own?: true;
  readonly feature: FeatureId;
  readonly surface: Surface;
  /** admitted/requesting/streaming → stage line; done → parts; failed → error card; canceled → closes; interrupted → CG-OP-INTERRUPTED with «Ещё раз». */
  readonly state: OpState;
  /** Epoch ms of the click: the «0:03» timer of the stage line. */
  readonly startedAt: number;
  readonly phase: PhaseVM | null;
  /** Preliminary text while streaming; never actionable. */
  readonly streamText: string | null;
  /** Reply, Fix, Ping, a one-variant Hi. */
  readonly parts: readonly PartVM[] | null;
  /** Hi with three variants (columns on a wide composer, a column below 680 px). */
  readonly variants: readonly VariantVM[] | null;
  /** Header meta: «тон: Flirt», «3 части», «вставлено 1 из 3», «3 варианта по 2 части», «по вашему черновику»… */
  readonly meta: readonly Msg[];
  /** Split was on at the start (Б7): one part reads «получилась одна часть» instead of «одним сообщением» (AI-011). */
  readonly splitRequested: boolean;
  /** «для Tomasz»: the fan's display name; null — unknown, no meta. */
  readonly targetName: string | null;
  /** «черновик · не отправлено» until a part starts sending. */
  readonly draftNotSent: boolean;
  /** Previews: «отправлено 1 из 3». */
  readonly sendProgress: { readonly sent: number; readonly total: number } | null;
  /** The one final error of the operation; the countdown runs from its fixed `retryAt`. */
  readonly error: CgErrorView | null;
  /** Recovery buttons of the registry entry: «Повторить», «Настройки», «Войти», «Перезагрузить вкладку», «Открыть чат». */
  readonly errorActions: readonly ActionButtonVM[];
  /**
   * The mark over the parts, ready to be drawn (`ResultMarkVM`, 1.15.0): the site's AI policy gives it (R20 F10).
   * «Фан написал новое после генерации» (dock inserts still allowed; previews hold sends), and the reasons of the window
   * check's verdict too (`StaleReason`, R20 spec §3.5, P8b2): their words are `ResultMarkKey`'s.
   */
  readonly stale: ResultMarkVM | null;
  readonly toneUsed: Tone | null;
  readonly canRegenerate: boolean;
  readonly regenerateReason: ReasonVM | null;
  readonly confirm: ConfirmVM | null;
  readonly fix: FixVM | null;
  /** The raw answer did not parse: one copy-only part, meta «ответ не разобран» (UI-032). */
  readonly unparsed: boolean;
  /** Reopened from the result cache (same parameters, AI-128): when it was made. */
  readonly cachedAt: number | null;
  readonly expanded: boolean;
  readonly debug: ResultDebugVM | null;
  /**
   * 2026-10-22 (as the old Fansly extension's head): what the generation cost — «$0.002500 · 2.3k usage», and in its
   * hint «in 1.2k · write 0 · read 900 · out 210». Technical, not translated. Absent or null — the hub sent no usage.
   */
  readonly usage?: { readonly line: string; readonly detail: string } | null;
  /**
   * 1.48.0: «с Recap» in the head — what the answer stood on, as a tick: on — the fan's Recap made `at` went in; off —
   * «с Recap» of its feature is unticked in this chat and none did. Pressing it flips that feature's tick in the chat
   * (`SetRecap`; 1.52.0: the other features keep theirs) and asks again. Absent or null — no tick: the answer read no Recap, it is not the dock's own, or
   * the hub cannot leave the Recap out; the head then says it in words, if at all.
   */
  readonly recap?: { readonly on: boolean; readonly at: IsoTimestamp | null } | null;
}

/** A refused start (fourth generation in the tab, the chat busy in another tab): no operation exists (ui-design §4.9). */
export interface RefusalVM {
  readonly feature: FeatureId;
  /** 2026-10-22: the fan of the chat the start was for — «Reply — @fan» in the card's head; absent or null — not known. */
  readonly targetName?: string | null;
  readonly error: CgErrorView;
  readonly running: readonly RunningOpVM[];
  /**
   * Epoch ms of the refused start (1.2.0): what tells one refusal from the
   * next. No operation exists, so «Скрыть» hides a refusal in the UI only; a
   * start refused again — by a key as well as by a click — comes with a new
   * `at` and is shown again. Without it a refusal is told apart by its chat,
   * feature and code alone.
   */
  readonly at?: number;
  /**
   * The card's recovery buttons (1.18.0, decision X45): «Повторить» of the same start where the registry says a new
   * human click may repeat it (the hub or the extension did not answer, a timeout: nothing was generated, sent or
   * written), else nothing. Never pressed by itself. Absent or empty — the card has only «Скопировать код».
   */
  readonly actions?: readonly ActionButtonVM[];
}
