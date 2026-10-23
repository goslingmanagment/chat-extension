// Recap, Review and Coach (architecture.md §10.2, §7 «Recap», §8.5; ui-design
// §4.11, §4.18, §4.19, §10). They follow the open chat: Recap in the dock
// sheet, the Recap tab of the fan panel, Coach as its window — and Review as a
// turn of Coach's dialog (1.51.0). Recap and Review are no message to the fan:
// Split is off with «это не сообщение фану».

import { type CgErrorView } from '../errors';
import { type RecapReader } from '../features';
import { type COACH_BLOCK_KINDS, type OpState, type REVIEW_SECTION_KINDS, type ResultMarkVM } from '../ops';
import { type IsoTimestamp, type Uuid } from '../primitives';
import { type RecapLength, type UiAction } from './actions';
import { type ReasonVM } from './catalog';
import { type Msg } from './i18n';
import { type ConfirmVM, type PartVM, type PhaseVM, type ResultDebugVM } from './result';
import { type ArtifactHandle } from './selectors';
import { type ActionButtonVM, type DataStamp, type VmView } from './view';

/**
 * Saving a full Recap as the fan's dossier (H-5): «✓ сохранено в хаб», or
 * CG-RECAP-SAVE with «Сохранить ещё раз» — only the idempotent reference
 * write repeats, never the AI.
 */
export type HubSaveVM =
  | { readonly s: 'not-applicable' }
  | { readonly s: 'saving' }
  | { readonly s: 'saved'; readonly at: IsoTimestamp | null }
  | { readonly s: 'failed'; readonly error: CgErrorView; readonly retry: UiAction };

/** A shared Recap of the page, fan and persona (H-13); local slots are copies with its id and revision. */
export interface RecapSlotVM {
  readonly length: RecapLength;
  readonly generatedAt: IsoTimestamp;
  readonly stamp: DataStamp;
  readonly saved: HubSaveVM;
  /** «Открыть последний». */
  readonly open: ActionButtonVM;
}

/** Before a Recap is shown: what is saved, and «Собрать коротко / полностью» (AI-060, AI-061, AI-065). */
export interface RecapPickerVM {
  /** `loading` — «Проверяю сохранённые рекапы…»; `empty` — nothing saved, only the build buttons. */
  readonly view: VmView;
  readonly targetName: string | null;
  readonly slots: { readonly short: RecapSlotVM | null; readonly full: RecapSlotVM | null };
  /** Enter builds the full one. */
  readonly build: { readonly short: ActionButtonVM; readonly full: ActionButtonVM };
  readonly splitReason: ReasonVM;
}

/** What a Recap stands on: the archive point and its coverage, and how many messages it read («вся переписка (90 сообщений)»). */
export interface RecapStampVM extends DataStamp {
  /** The messages the Recap was built over; null — not known (a copy without the hub's counts). */
  readonly served: number | null;
}

/**
 * A build of the shown length failed while an earlier Recap of it is kept: the text stays, the facts say «Не
 * обновилось · CG-… · Повторить».
 */
export interface RefreshFailedVM {
  readonly error: CgErrorView;
  readonly retry: UiAction;
}

export interface RecapViewVM {
  /** `loading` while generating (with `phase`), `empty` — CG-RECAP-NOT-FOUND, `partial` — coverage or a lagging archive. */
  readonly view: VmView;
  readonly length: RecapLength;
  /** «Коротко | Полностью»: which slot exists or can be built. */
  readonly lengths: { readonly short: boolean; readonly full: boolean };
  /** «для Hubert». */
  readonly targetName: string | null;
  readonly opId: Uuid | null;
  readonly state: OpState | null;
  readonly phase: PhaseVM | null;
  readonly streamText: string | null;
  /** Rendered through the safe Markdown AST, parsed once on the finished text (AI-137). */
  readonly markdown: string | null;
  /** The Recap split by headings («Кто он», «Траты», «Триггеры»… of the short one, «Досье»… of the full one); null — one text. */
  readonly blocks: readonly { readonly heading: string; readonly markdown: string }[] | null;
  readonly generatedAt: IsoTimestamp | null;
  readonly saved: HubSaveVM;
  /**
   * 1.52.0: who reads this Recap in this chat now, when not all of its readers do (a «с Recap» unticked here or in the
   * settings): the full one goes to Reply, Fix, Ping and Coach, the short one to Coach alone. Absent — all of them.
   */
  readonly readers?: readonly RecapReader[];
  readonly stamp: RecapStampVM;
  /** «После Recap ещё 2 сообщения»: the fan or the chatter wrote after it; null — not behind. */
  readonly archiveLag: { readonly messages: number | null } | null;
  /** «Обновить» failed: the saved text stays shown; null — no failed build over it. */
  readonly refreshFailed: RefreshFailedVM | null;
  readonly copyHandle: ArtifactHandle | null;
  /** «↻ Обновить ⌘⇧S»: from the fresh archive, bypassing the cache. */
  readonly refresh: ActionButtonVM;
  readonly splitReason: ReasonVM;
  readonly expanded: boolean;
  readonly debug: ResultDebugVM | null;
  /**
   * 1.15.0 (R20 P8c): the mark over a Recap this tab generated — the site's verdict on its window check (`ResultMarkVM`
   * with a reason of `ResultMarkKey`, spec §3.5, FS-TAIL-8); its «Ещё раз» is `refresh`. What the fan wrote after it is
   * the archive's lag (`archiveLag`), never a mark. Absent or null — none (ChatSpace's verdict never gives one).
   */
  readonly stale?: ResultMarkVM | null;
}

export interface ReviewItemVM {
  readonly body: string;
  /** «Как надо было:» — an example, never insertable from Review. */
  readonly example: string | null;
  readonly exampleWhere: string | null;
  readonly afterExample: string | null;
}

/**
 * Review blocks follow parity AI-053 and the hub's output format («Вердикт /
 * Деньги / Персона / Ошибки» with «Как надо было:», then the recommendations),
 * not the mockup's «Хорошо / Можно лучше / Следующий шаг» (ui-design §12 п. 6).
 */
export interface ReviewSectionVM {
  readonly kind: (typeof REVIEW_SECTION_KINDS)[number] | 'recommendations';
  readonly title: Msg;
  readonly body: string;
  readonly items: readonly ReviewItemVM[];
}

/**
 * 1.51.0: a finished Review as the answer of its turn in Coach's dialog — the old Review window's card, in the thread:
 * the score, the blocks of parity AI-053, «Копировать Review» and its age. Its progress, its error, its mark and «Ещё
 * раз» are the turn's own (`CoachTurnVM`).
 */
export interface CoachReviewVM {
  /** N/10; null when the model gave none. */
  readonly rating: number | null;
  /** The text before the first block, when no block repeats it; null — none. */
  readonly lead: string | null;
  readonly sections: readonly ReviewSectionVM[];
  /** The answer as text, the frame's tags taken out; `unparsed` shows it so (AI-052). */
  readonly raw: string;
  readonly unparsed: boolean;
  /** «Копировать Review»: the record's own text (AI-054); null — nothing to copy any more. */
  readonly copyHandle: ArtifactHandle | null;
  /** When it was made: «Сделан 5 мин назад», ticking in the UI. */
  readonly generatedAt: IsoTimestamp;
  /** The archive it read was incomplete: «архив неполный». */
  readonly partial: boolean;
}

export interface CoachTurnVM {
  readonly id: string;
  readonly opId: Uuid | null;
  readonly question: string;
  readonly askedAt: number;
  readonly state: OpState;
  readonly phase: PhaseVM | null;
  /** «Отправлено коучу…» until the first frame. */
  readonly sentToCoach: boolean;
  readonly streamText: string | null;
  readonly attachedDraft: boolean;
  /** Beyond `historyLimit`: no longer sent as history (the memory boundary line, AI-092). */
  readonly outsideMemory: boolean;
  readonly answer: {
    readonly prose: string;
    readonly blocks: readonly { readonly kind: (typeof COACH_BLOCK_KINDS)[number]; readonly title: Msg; readonly body: string }[] | null;
    /** Up to two drafts, each split into parts with their own insert/copy (AI-084, AI-085). */
    readonly drafts: readonly {
      readonly index: number;
      readonly label: Msg;
      readonly parts: readonly PartVM[];
      /** The line under a draft that can be neither inserted nor copied (AI-087, the old card's note); null — none. */
      readonly note: Msg | null;
    }[];
  } | null;
  readonly error: CgErrorView | null;
  readonly errorActions: readonly ActionButtonVM[];
  /**
   * Б2 for a draft part of this turn (1.2.0, AI-086): the composer already has
   * the person's text, or it changed. `part` names the part as its PartVM does
   * (`variant` — the draft, when a turn has two). The dock's own
   * `ResultVM.confirm` belongs to the dock's operation and cannot carry it.
   */
  readonly confirm?: ConfirmVM | null;
  /** The debug footer of the turn, in debug mode only (1.2.0, DB-019): time, tokens, cost, «Промпт», the stage profile. */
  readonly debug?: ResultDebugVM | null;
  /** 1.15.0 (R20 P8c): the mark over a finished answer — as `RecapViewVM.stale`; null — none. */
  readonly stale?: ResultMarkVM | null;
  /**
   * 1.15.0 (R20 P8c): «Ещё раз» of a marked answer — the turn's question asked again; null — no mark, or no chat to ask
   * in. 1.51.0: a finished Review has it always — a new Review as the next turn.
   */
  readonly again?: ActionButtonVM | null;
  /**
   * 1.46.0: the Recaps the hub put into this answer — when each was made, null — none; null or absent — the hub did not
   * say. 1.48.0: `off` — none, because «Учитывать Recap» was unticked.
   */
  readonly recapsUsed?: { readonly full: IsoTimestamp | null; readonly short: IsoTimestamp | null; readonly off?: boolean | undefined } | null;
  /**
   * 1.51.0: what the turn is — a question to Coach, or a Review of the chat (the «Review» chip, its key, the palette):
   * its question line is «Review», its answer `review`. Absent — `coach`.
   */
  readonly feature?: 'coach' | 'review';
  /** 1.51.0: the finished Review of a Review turn, never with `answer`; null or absent — none (a question, or a Review not done). */
  readonly review?: CoachReviewVM | null;
}

export interface CoachVM {
  /** `empty` — «Новый диалог» with chips; `partial` — the archive lags the chat. */
  readonly view: VmView;
  /** «по чату с Hubert». */
  readonly targetName: string | null;
  /** «Переписка на 09:20», «↻ Обновить переписку»; the lag line turns the button into a line button. */
  readonly freshness: {
    readonly asOf: IsoTimestamp | null;
    readonly lag: { readonly messages: number | null } | null;
    readonly refresh: ActionButtonVM;
  };
  /**
   * 1.46.0: the Recaps Coach stands on, as the hub attaches them to every question — the full one, and the short one
   * when it is newer (AI-095). Empty — none: the topbar says «Recap · нет», Coach answers from the chat alone.
   */
  readonly recaps: readonly CoachRecapVM[];
  /** 1.46.0: the setting's auto Recap the first question of this dialog builds first (no fresh one is known); null — it asks at once. */
  readonly autoRecapNext: 'short' | 'full' | null;
  /** 1.46.0: how many of the chat's latest messages Coach reads (its window); null — not known yet. */
  readonly window: number | null;
  /**
   * 1.48.0: «Учитывать Recap» of this chat — Coach's own «с Recap» (`SetRecap` of `coach`, 1.52.0): false — the next
   * question goes without the Recaps. Absent or null — no tick: the hub cannot leave them out.
   */
  readonly recapOn?: boolean | null;
  /** A Recap of this chat is being built (from the topbar's «Собрать Recap», the strip or a turn's auto-recap step): «Recap собирается…». */
  readonly recapRunning?: boolean;
  readonly turns: readonly CoachTurnVM[];
  /** `generation.coach.historyLimit`. */
  readonly historyLimit: number;
  /** Ready questions under the empty state and under an answer. */
  readonly chips: readonly { readonly label: Msg; readonly question: string; readonly preset: 'situation' | null }[];
  readonly ask: {
    readonly enabled: boolean;
    /** «дождитесь ответа коуча» (CG-OP-COACH-BUSY). */
    readonly reason: ReasonVM | null;
    /** «Приложить мой ответ»: the composer draft goes along (never the fan's fresh text). */
    readonly attachDraft: { readonly available: boolean; readonly reason: ReasonVM | null };
  };
  /** «Новый диалог» — the window asks «Точно начать заново?» in its place first; the old dialog is not kept. */
  readonly newDialog: ActionButtonVM;
  /**
   * 1.51.0: the «Review» chip by the ready questions — a Review of the chatter's work in this chat, run as the next turn
   * (the page's `review`, its gates and its quota: off with the reason the bar's Review button gave). Over a dialog that
   * holds a Review already it rates anew, past the cache. null or absent — the page has no Review.
   */
  readonly review?: ActionButtonVM | null;
  /**
   * 1.51.0: Coach's questions are off on this page while its Review is on: the window offers the «Review» chip alone,
   * `ask.reason` says why. Absent — false.
   */
  readonly reviewOnly?: boolean;
  /**
   * The ready questions of the empty dialog under their three headings —
   * «Продать», «Вернуть», «Понять», three each (1.2.0, AI-081). A click puts
   * the question into the input for the person to edit and send: unlike a
   * chip of `chips`, it asks nothing by itself. Empty or absent — none (the
   * dialog already has turns).
   */
  readonly hints?: readonly CoachHintGroupVM[];
}

/** A Recap in Coach's topbar (1.46.0): «полный · 3 д назад», unfolding into its text. */
export interface CoachRecapVM {
  readonly length: RecapLength;
  readonly generatedAt: IsoTimestamp;
  readonly summary: string;
}

/** One heading of the empty Coach dialog with its ready questions (1.2.0, AI-081). */
export interface CoachHintGroupVM {
  readonly label: Msg;
  /** `question` is the text in the current language — what goes into the input. */
  readonly questions: readonly { readonly label: Msg; readonly question: string }[];
}
