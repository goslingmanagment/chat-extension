// Recap, Review and Coach (architecture.md §10.2, §7 «Recap», §8.5; ui-design
// §4.11, §4.18, §4.19, §10). They follow the open chat: Recap and Review in
// the dock sheet under the same height limit, the Recap tab of the fan panel,
// Coach as a side panel. None of them is a message to the fan: Split is off
// with «это не сообщение фану».

import { type CgErrorView } from '../errors';
import { type COACH_BLOCK_KINDS, type OpState, type REVIEW_SECTION_KINDS } from '../ops';
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
  /** Full Recap split by headings («Кто он», «Что любит», «Покупки», «Чего избегать», «Сейчас»); null for the short one. */
  readonly blocks: readonly { readonly heading: string; readonly markdown: string }[] | null;
  readonly generatedAt: IsoTimestamp | null;
  readonly saved: HubSaveVM;
  readonly stamp: DataStamp;
  /** «архив отстаёт от чата на 2 сообщения»; null — not behind. */
  readonly archiveLag: { readonly messages: number | null } | null;
  readonly copyHandle: ArtifactHandle | null;
  /** «↻ Обновить ⌘⇧S»: from the fresh archive, bypassing the cache. */
  readonly refresh: ActionButtonVM;
  readonly splitReason: ReasonVM;
  readonly expanded: boolean;
  readonly debug: ResultDebugVM | null;
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

export interface ReviewVM {
  readonly view: VmView;
  readonly opId: Uuid | null;
  readonly state: OpState | null;
  readonly phase: PhaseVM | null;
  readonly streamText: string | null;
  /** N/10; null when the model gave none. */
  readonly rating: number | null;
  /** «последние 40 сообщений с Hubert»: the window and the fan; null while unknown. */
  readonly window: { readonly messages: number } | null;
  readonly targetName: string | null;
  readonly meta: readonly Msg[];
  readonly lead: string | null;
  readonly sections: readonly ReviewSectionVM[];
  /** The source of truth for Copy (AI-053); `unparsed` shows it as is. */
  readonly raw: string | null;
  readonly unparsed: boolean;
  readonly copyHandle: ArtifactHandle | null;
  /** «Ещё раз ⌘⇧B» — «Оценить заново». */
  readonly regenerate: ActionButtonVM;
  /** Footer facts: «Сделан только что», «архив на 09:18». */
  readonly facts: readonly Msg[];
  readonly stamp: DataStamp;
  readonly splitReason: ReasonVM;
  readonly expanded: boolean;
  readonly debug: ResultDebugVM | null;
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
    readonly drafts: readonly { readonly index: number; readonly label: Msg; readonly parts: readonly PartVM[] }[];
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
  /** The Recap shown in the header (auto-recap `short` / `full`, §5.6). */
  readonly recap: { readonly length: RecapLength; readonly generatedAt: IsoTimestamp; readonly summary: string } | null;
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
  /** «Новый диалог» — confirmed through DialogPort; the old one stays in history. */
  readonly newDialog: ActionButtonVM;
  /**
   * The ready questions of the empty dialog under their three headings —
   * «Продать», «Вернуть», «Понять», three each (1.2.0, AI-081). A click puts
   * the question into the input for the person to edit and send: unlike a
   * chip of `chips`, it asks nothing by itself. Empty or absent — none (the
   * dialog already has turns).
   */
  readonly hints?: readonly CoachHintGroupVM[];
}

/** One heading of the empty Coach dialog with its ready questions (1.2.0, AI-081). */
export interface CoachHintGroupVM {
  readonly label: Msg;
  /** `question` is the text in the current language — what goes into the input. */
  readonly questions: readonly { readonly label: Msg; readonly question: string }[];
}
