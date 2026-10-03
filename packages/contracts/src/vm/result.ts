// A generation result as the UI draws it (architecture.md §10.2 ResultVM,
// PartVM, PreviewSendView; ui-design.md §4.2–§4.9, §4.13, §8.2–§8.3). Actions
// on a result exist only after `done` and a full parse (§7); the stream text
// is a preview without buttons. Every draft says it has not been sent until a
// part is (ui-design §1 п. 9).

import { type CgCode, type CgErrorView } from '../errors';
import { type FeatureId, type Surface, type Tone } from '../features';
import { type PartRef } from '../ids';
import { type OpState } from '../ops';
import { type IsoTimestamp, type Uuid } from '../primitives';
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
 * The «Отправить» row of a part in a preview, nine states one to one with
 * ui-design §4.13 (X8, §6.7.7). `sent` needs the receipt AND the echo with
 * the same id; `accepted` (receipt only) and `uncertain` never look like it.
 */
export type PreviewSendView =
  | { readonly s: 'available' }
  /** The code explains the disabled button (never a toast); `reason` is its text (`send.reason.<code>`). */
  | { readonly s: 'unavailable'; readonly code: CgCode; readonly reason: Msg }
  | { readonly s: 'held-stale'; readonly at: IsoTimestamp | null }
  | { readonly s: 'queued' }
  | { readonly s: 'sending' }
  | { readonly s: 'accepted' }
  | { readonly s: 'sent'; readonly at: IsoTimestamp }
  /** `canRetry` only when the registry allows a new click (CG-SEND-QUEUE); otherwise «Открыть и вставить» and «Копировать». */
  | { readonly s: 'rejected'; readonly code: CgCode; readonly detail?: string; readonly canRetry: boolean }
  /** No retry, no «Открыть и вставить»: only «Открыть чат для проверки» for this attempt (§6.7.8). */
  | { readonly s: 'uncertain'; readonly since: IsoTimestamp; readonly attemptId: Uuid };

export const PREVIEW_SEND_STATES = [
  'available',
  'unavailable',
  'held-stale',
  'queued',
  'sending',
  'accepted',
  'sent',
  'rejected',
  'uncertain',
] as const satisfies readonly PreviewSendView['s'][];

/**
 * Parts that the queue has not reached (§6.7.9): «Отправка после части N»
 * behind the first unsent one, «Удержано, пока неясен исход части N» behind
 * an uncertain one. The controller computes it; the UI does not reorder.
 */
export type SendOrderVM = { readonly kind: 'after'; readonly part: number } | { readonly kind: 'held'; readonly part: number };

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
  readonly text: string;
  /** The next part to insert: «Вставить ↵» as a line button. */
  readonly next: boolean;
  readonly insert: 'idle' | 'pending' | 'done' | 'failed';
  readonly insertError: CgErrorView | null;
  /** Insert is off for this part while Copy works (CG-GATE-LANGUAGE, copy-only). */
  readonly insertBlocked: ReasonVM | null;
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
  /** «Ваш текст» before the replacement. */
  readonly original: string;
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

export interface ResultVM {
  readonly opId: Uuid;
  readonly feature: FeatureId;
  readonly surface: Surface;
  /** admitted/requesting/streaming → stage line; done → parts; failed → error card; canceled → closes; interrupted → CG-OP-INTERRUPTED with «Ещё раз». */
  readonly state: OpState;
  readonly startedAt: number;
  readonly phase: PhaseVM | null;
  /** Preliminary text while streaming; never actionable. */
  readonly streamText: string | null;
  /** Reply, Fix, Ping, a one-variant Hi. */
  readonly parts: readonly PartVM[] | null;
  /** Hi with three variants (columns on a wide composer, a column below 680 px). */
  readonly variants: readonly VariantVM[] | null;
  /** Header meta: «тон: Флирт», «3 части», «вставлено 1 из 3», «одним сообщением», «получилась одна часть», «по вашему черновику»… */
  readonly meta: readonly Msg[];
  /** «черновик · не отправлено» until a part starts sending. */
  readonly draftNotSent: boolean;
  /** Previews: «отправлено 1 из 3». */
  readonly sendProgress: { readonly sent: number; readonly total: number } | null;
  /** The one final error of the operation; the countdown runs from its fixed `retryAt`. */
  readonly error: CgErrorView | null;
  /** Recovery buttons of the registry entry: «Повторить», «Настройки», «Войти», «Перезагрузить вкладку», «Открыть чат». */
  readonly errorActions: readonly ActionButtonVM[];
  /** «Фан написал новое после генерации» (dock inserts still allowed; previews hold sends). */
  readonly stale: { readonly reason: 'fan-wrote' | 'archive-moved'; readonly at: IsoTimestamp | null } | null;
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
}

/** A refused start (fourth generation in the tab, the chat busy in another tab): no operation exists (ui-design §4.9). */
export interface RefusalVM {
  readonly feature: FeatureId;
  readonly error: CgErrorView;
  readonly running: readonly RunningOpVM[];
}
