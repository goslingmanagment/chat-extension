// «Заметки» of a Fansly tab (FS-NOTE-*): the model, the actions and the client of its two surfaces, the button in the
// header slot before «Регистрация» and the panel in our layer 900. Types only: the controller is core
// application/hosts/fansly/notes, the requests are `fansly.notes.*` (tab-messages-fansly.ts). A note's text lives here
// only between the panel and the background, never in a log or the hub (FS-NOTE-5).
//
// 2026-10-26, the owner: «непонятно… интерфейс не очень удобный… полностью с нуля переработал». The panel is one
// screen now: the questionnaire reads as a table and a field is edited in place (a click, Enter writes it to Fansly),
// the empty fields are «+ Метка» to fill; a free note is one line typed and Enter. 2026-10-27, the owner on the fill
// («это основная фича»; of six prototypes he chose «Подсказки прямо в строках», and «чаттер должен контролировать, что
// он делает»): a fan without a questionnaire gets «✨ Заполнить из чата» as the panel's first action, and what the
// Goose found stands in the questionnaire's own rows as suggestions; each one is written to Fansly only by the
// chatter's ✓ (or «Принять все»), × puts it aside.
import type { CgAnyErrorWire } from './errors-fansly';
import type { FanslyNotesView } from './settings-ext';
import type { PhaseVM } from './vm/result';

/** Where the side panel stands: in the free column right of the chat, or over the chat's right edge (px, viewport). */
export interface NotesPlace {
  readonly kind: 'docked' | 'over';
  readonly top: number;
  /** From the viewport's bottom edge. */
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
}

/** The name for oneself (12002): `saving` — a write in flight; `unconfirmed` — it may have landed (read again). */
export type NotesNameStatus = 'idle' | 'saving' | 'saved' | 'error' | 'unconfirmed' | 'too-long';

/** Why a write did not land. `failed.created` — a create that may have landed: no second one before a reread. */
export type NotesProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'deleted' }
  /** The note changed elsewhere since it was read (audit №13): `latest` is what Fansly holds now. A note's text editor
   * shows it and its next «Сохранить» writes over it; a field or the Goose's facts are written into it. */
  | { readonly kind: 'changed'; readonly latest: { readonly title: string; readonly text: string } }
  | { readonly kind: 'failed'; readonly error: CgAnyErrorWire; readonly created: boolean };

/** A fact of a questionnaire's field and the month the Goose stamped on it («Флорида (08.2026)»). */
export interface NotesFactVM {
  readonly text: string;
  readonly date: string | null;
}

/** When a free note was created, in the chatter's clock: `day` «16.10» («16.10.2025» outside the current year), `full`
 * «16.10.2026» and `time` «19:56» for the hover, `iso` for `<time datetime>`. A questionnaire is not dated: its facts
 * carry their months. */
export interface NotesDateVM {
  readonly day: string;
  readonly full: string;
  readonly time: string;
  readonly iso: string;
}

/**
 * A suggestion of the Goose in its field's row (FS-NOTE-6), written to Fansly only by the chatter's ✓:
 * - `refine` — it extends a fact as written («Чикаго» → «Чикаго, Линкольн-Парк»): `base` is that fact, `text` the rest;
 * - `replace` — it rewrites the field: `drops` go, `text` comes;
 * - `add` — new facts after what is written;
 * - `fill` — a field with nothing written (or a template's field the questionnaire lacks);
 * - `new` — a field the Goose named itself.
 */
export interface NotesSuggestionVM {
  /** What «suggestion-accept» and the rest name. */
  readonly index: number;
  readonly kind: 'refine' | 'replace' | 'add' | 'fill' | 'new';
  readonly base: string | null;
  /** The pill's words: the new facts joined with «; » (`refine` — only what it adds to `base`). */
  readonly text: string;
  /** The month the fan said it, at the right of the row. */
  readonly date: string | null;
  readonly drops: readonly NotesFactVM[];
  /** The field's whole value after ✓ (the conflict's question names it). */
  readonly value: string;
  /** The fan's words behind it: on hover, never saved. */
  readonly quotes: readonly string[];
  /** `arriving` — the Goose is still writing its answer: shown, not yet taken or put aside; `saving` — its write is in
   * flight; `conflict` — the field changed since the Goose read it (`now`): «Заменить» or «Оставить». */
  readonly state: 'arriving' | 'pending' | 'saving' | 'conflict';
  readonly now: string | null;
}

/** The questionnaire's parts in note order: a field with something written in it, or a line of no field. A field with
 * nothing written is not a part (it is one of `NotesFormVM.blank`) unless the Goose suggests something for it: then it
 * is a `ghost` row, in its place, or after the last field for a field the questionnaire lacks. */
export type NotesFormPartVM =
  | {
      readonly kind: 'field';
      readonly label: string;
      readonly facts: readonly NotesFactVM[];
      /** The chatter's ✓ wrote the Goose's suggestion here: marked until the panel closes. */
      readonly fresh?: boolean;
      /** The Goose's suggestion for this field, waiting for ✓ or ×. */
      readonly suggestion?: NotesSuggestionVM;
      /** Nothing written in this field yet: the row exists for its suggestion. */
      readonly ghost?: boolean;
      /** While the Goose answers: it is on this field now (`current`), or answered it with nothing new (`seen`). */
      readonly current?: boolean;
      readonly seen?: boolean;
    }
  | { readonly kind: 'text'; readonly text: string };

/** A questionnaire's field open for typing, in place: its facts one per line; Enter writes it to Fansly. */
export interface NotesFieldVM {
  readonly label: string;
  readonly value: string;
  /** The field had nothing written when it was opened (a «+ Метка»): its box stands under the table. */
  readonly blank: boolean;
  readonly saving: boolean;
  /** A questionnaire's create failed after it may have landed: Enter waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
}

/**
 * A running fill as the chatter follows it (2026-10-27, the owner: «прогресс какой-то», «1 этап улучшить тоже»):
 * `gather` — the hub collects the chat; `read` — the model reads it (`read` messages, from the hub's `context_v1`);
 * `check` — its answer comes field by field: `checked` of `total` answered, `found` with something new, `current` the
 * field it is on.
 */
export interface NotesFillProgressVM {
  readonly stage: 'gather' | 'read' | 'check';
  readonly read: number | null;
  /** How long a fill of a chat this long usually takes, in seconds (prod, 2026-10-27); null — not known yet. */
  readonly eta: number | null;
  readonly checked: number;
  readonly total: number;
  readonly found: number;
  readonly current: string | null;
}

/**
 * «✨ Заполнить из чата» / «✨ Дополнить из чата» of the questionnaire (FS-NOTE-6): `running` — the hub reads the chat
 * («Остановить» drops it); `review` — its suggestions stand in the rows (`NotesFormPartVM.suggestion`), each written
 * only by ✓; `done` — none waits any more (what was written, what was put aside); `empty` — nothing new in the chat;
 * `failed` — why.
 */
export interface NotesFillVM {
  readonly status: 'idle' | 'running' | 'review' | 'done' | 'empty' | 'failed';
  /** Why it cannot start now: a field or the questionnaire's text is open, or a write of this fan is in flight. */
  readonly reason: 'editing' | 'writing' | null;
  /** A running fill's stage and its m:ss timer, the kit's StageLine. */
  readonly phase: PhaseVM | null;
  /** A running fill: where it is (its suggestions arrive in the rows as `arriving`). */
  readonly progress: NotesFillProgressVM | null;
  readonly error: CgAnyErrorWire | null;
  /** The suggestions waiting, written by ✓, put aside by ×. */
  readonly pending: number;
  readonly written: number;
  readonly dismissed: number;
  /** The fields with nothing written that the Goose found nothing for either. */
  readonly unfound: readonly string[];
  /** The fan had no questionnaire: the first ✓ created it. */
  readonly created: boolean;
  /** A write of suggestions in flight. */
  readonly saving: boolean;
  /** A questionnaire's create failed after it may have landed: ✓ waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
  /** The last ✓ for a few seconds: «Записано: Локация · Отменить» puts the questionnaire back as it was. */
  readonly undo: { readonly labels: readonly string[]; readonly undoing: boolean } | null;
  /** «Отменить» could not: the questionnaire changed since the ✓ (it would wipe that). */
  readonly undoFailed: boolean;
}

/** The fan's questionnaire: one note of 2–30 `Label: value` lines (one per fan), or none yet. */
export interface NotesFormVM {
  /** null — the fan has none: the first field written or the first ✓ creates «Анкета» with the template's fields. */
  readonly noteId: string | null;
  readonly title: string;
  readonly parts: readonly NotesFormPartVM[];
  /** The fields with nothing written, offered as «+ Метка»: the questionnaire's own, then the template's it lacks. */
  readonly blank: readonly string[];
  /** Longer than the panel holds (audit №13): read only, edited and deleted in Fansly's own window. */
  readonly locked: boolean;
  /** The field open for typing. */
  readonly field: NotesFieldVM | null;
  /** null — the page's «Дополнить из чата» is off. */
  readonly fill: NotesFillVM | null;
  /** The suggestions a ✓ could not place (30 fields and no «Другое»): named once. */
  readonly unplaced: readonly string[];
}

/** A note open as text: a free note, or the questionnaire («Править текстом»); `noteId` null — the note was deleted
 * elsewhere and «Сохранить» creates it anew. */
export interface NotesEditorVM {
  readonly noteId: string | null;
  readonly title: string;
  readonly text: string;
  readonly saving: boolean;
  /** A create failed after it may have landed: «Сохранить» waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
}

/** A note other than the questionnaire, as the list shows it. */
export interface NotesItemVM {
  readonly noteId: string;
  readonly title: string;
  readonly text: string;
  /** When it was created; null — Fansly gave no time. */
  readonly date: NotesDateVM | null;
  /** FBuddy's «FBuddy Notes»: read only. */
  readonly foreign: boolean;
  /** Longer than the panel holds: its beginning, read only. */
  readonly cut: boolean;
}

/** The box at the top of the notes: a line typed and Enter makes a note of it. */
export interface NotesQuickVM {
  readonly text: string;
  readonly saving: boolean;
  /** Its create failed after it may have landed: Enter waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
}

export interface NotesPanelVM {
  readonly shown: boolean;
  readonly view: FanslyNotesView;
  /** «Всегда справа» without room beside the chat: opened by the button, over the chat. */
  readonly narrow: boolean;
  /** null — the centred window. */
  readonly place: NotesPlace | null;
  readonly fan: { readonly name: string | null; readonly handle: string | null } | null;
  readonly body: 'loading' | 'ready' | 'error';
  readonly error: CgAnyErrorWire | null;
  /** `changed` (audit №13): the name changed elsewhere — `latest` is Fansly's now (null — none); the next Enter writes
   * the typed one over it. */
  readonly name: { readonly value: string; readonly status: NotesNameStatus; readonly error: CgAnyErrorWire | null; readonly changed?: { readonly latest: string | null } };
  /** null until the notes are read. */
  readonly form: NotesFormVM | null;
  /** The other notes, newest first; FBuddy's among them. */
  readonly items: readonly NotesItemVM[];
  readonly quick: NotesQuickVM;
  /** The note open as text (one at a time): in place of its item, of the questionnaire's table, or first in the list. */
  readonly editor: NotesEditorVM | null;
  /** The note whose «Удалить» asks to confirm (the questionnaire's too). */
  readonly confirmDelete: string | null;
  readonly deleting: string | null;
  readonly deleteError: CgAnyErrorWire | null;
  /** A write of this fan is in flight: «Обновить» waits for it. */
  readonly writing: boolean;
}

export interface NotesTriggerVM {
  /** A one-to-one chat where the owner switched «Заметки» on. */
  readonly shown: boolean;
  /** The open chat's notes, once read; null — not read yet. */
  readonly count: number | null;
  readonly open: boolean;
}

export type NotesAction =
  | { readonly type: 'toggle' }
  | { readonly type: 'close' }
  | { readonly type: 'refresh' }
  | { readonly type: 'view'; readonly view: FanslyNotesView }
  /** A questionnaire's field (or a «+ Метка») opened for typing, typed, written (Enter) or put away (Esc). */
  | { readonly type: 'field-open'; readonly label: string }
  | { readonly type: 'field-input'; readonly value: string }
  | { readonly type: 'field-save' }
  | { readonly type: 'field-cancel' }
  /** «✨ Заполнить из чата» / «✨ Дополнить из чата» and «Остановить». */
  | { readonly type: 'fill' }
  | { readonly type: 'fill-stop' }
  /** A suggestion's ✓ (written to Fansly at once), its ×, «Заменить» over a field changed since the Goose read it. */
  | { readonly type: 'suggestion-accept'; readonly index: number }
  | { readonly type: 'suggestion-dismiss'; readonly index: number }
  | { readonly type: 'suggestion-replace'; readonly index: number }
  /** «Принять все» (one write), «Скрыть» (every suggestion put aside, nothing written). */
  | { readonly type: 'suggestions-accept-all' }
  | { readonly type: 'suggestions-dismiss-all' }
  /** «Отменить» of the last ✓: the questionnaire as it was before it, its suggestions waiting again. */
  | { readonly type: 'suggestion-undo' }
  /** «Понятно», «Закрыть», the done line's ×: nothing is written. */
  | { readonly type: 'fill-close' }
  /** The box at the top of the notes. */
  | { readonly type: 'quick-input'; readonly text: string }
  | { readonly type: 'quick-save' }
  /** A note (the questionnaire too) opened as text, typed, written, put away. */
  | { readonly type: 'edit'; readonly noteId: string }
  | { readonly type: 'input'; readonly title: string; readonly text: string }
  | { readonly type: 'save' }
  | { readonly type: 'cancel' }
  | { readonly type: 'ask-delete'; readonly noteId: string }
  | { readonly type: 'delete' }
  | { readonly type: 'keep' }
  | { readonly type: 'name-input'; readonly value: string }
  | { readonly type: 'name-commit' }
  | { readonly type: 'name-revert' };

export interface NotesClient {
  panel(): NotesPanelVM;
  trigger(): NotesTriggerVM;
  subscribe(listener: () => void): () => void;
  dispatch(action: NotesAction): void;
}

/** The panel's and the button's words (a host-local catalog, like «Регистрация»'s). */
export interface NotesCopy {
  readonly button: string;
  readonly title: string;
  readonly refresh: string;
  readonly refreshHint: string;
  readonly close: string;
  readonly more: string;
  readonly fan: string;
  readonly namePlaceholder: string;
  readonly nameHint: string;
  readonly name: Readonly<Record<NotesNameStatus, string>>;
  /** The name for oneself changed elsewhere: `{name}` — the one Fansly holds now; `nameRemoved` — none any more. */
  readonly nameChanged: string;
  readonly nameRemoved: string;
  readonly loading: string;
  readonly retry: string;
  readonly viewLabel: string;
  readonly views: Readonly<Record<FanslyNotesView, string>>;
  /** `{key}` — ⌘⇧K: the view menu's last line. */
  readonly hotkey: string;
  readonly narrow: string;
  readonly saving: string;
  readonly save: string;
  readonly cancel: string;
  readonly saveHint: string;
  readonly problem: Readonly<Record<'empty' | 'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>;

  /** The questionnaire. */
  readonly form: string;
  /** A fan without one, the fill on: «Анкеты пока нет», what the Goose does, «Заполнить вручную». */
  readonly startTitle: string;
  readonly startText: string;
  readonly manual: string;
  readonly formNoneManual: string;
  readonly fieldHint: string;
  readonly fieldKeys: string;
  readonly fieldEmpty: string;
  readonly fieldProblem: Readonly<Record<'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>;
  readonly factDate: string;
  readonly fresh: string;
  readonly asText: string;
  readonly removeForm: string;
  readonly removeFormAsk: string;
  readonly locked: string;
  readonly lockedHint: string;
  readonly unplaced: string;

  /** «✨ Заполнить из чата» / «✨ Дополнить из чата» and the Goose's suggestions. */
  readonly fill: string;
  readonly fillNew: string;
  readonly fillHint: string;
  readonly fillEditing: string;
  readonly fillWriting: string;
  readonly fillStop: string;
  /** A running fill's line: the hub collects the chat; the model reads `{n}` `{messages}` («…» after it when no usual
   * time follows); it checks the questionnaire
   * (`{label}`, `{k}` of `{n}`, found `{f}`). `messages` — the plural forms of «сообщение» (one, few, many). */
  readonly stageGather: string;
  readonly stageRead: string;
  readonly stageReadPlain: string;
  readonly stageCheck: string;
  readonly stageOf: string;
  readonly stageFound: string;
  /** `{s}` — the usual seconds for a chat this long. */
  readonly stageEta: string;
  readonly messages: readonly [string, string, string];
  /** The bar over the rows: `{n}` suggestions wait, `{w}` written. */
  readonly suggestBar: string;
  readonly suggestWritten: string;
  readonly acceptAll: string;
  readonly hideAll: string;
  /** A pill: its ✓ and × and the hint under the fan's words. */
  readonly accept: string;
  readonly dismiss: string;
  readonly suggestKeys: string;
  /** The pill of a rewrite that only takes facts away. */
  readonly dropOnly: string;
  readonly quotes: string;
  readonly noQuote: string;
  /** `{old}` — what a rewrite takes away. */
  readonly replaces: string;
  readonly newField: string;
  /** A field changed since the Goose read it: `{now}` — its value now, `{value}` — the Goose's. */
  readonly conflict: string;
  readonly replace: string;
  readonly keepIt: string;
  /** The last ✓: `{labels}` — the fields written. */
  readonly undoLine: string;
  /** More than two fields at once: `{n}` of them. */
  readonly undoMany: string;
  readonly undo: string;
  readonly undoing: string;
  readonly undoFailed: string;
  /** None waits any more: `{w}` written, `{d}` put aside. */
  readonly doneMore: string;
  readonly doneNew: string;
  readonly doneDismissed: string;
  /** `{labels}` — the fields the Goose found nothing for. */
  readonly unfound: string;
  readonly fillNothing: string;
  readonly fillOk: string;
  readonly fillFailed: string;
  readonly fillAgain: string;
  readonly fillClose: string;
  readonly fillProblem: Readonly<Record<'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>;

  /** The other notes. */
  readonly notes: string;
  readonly quickPlaceholder: string;
  readonly quickKeys: string;
  readonly quickProblem: Readonly<Record<'too-long' | 'failed-create', string>>;
  readonly edit: string;
  readonly remove: string;
  readonly removeAsk: string;
  readonly removing: string;
  readonly keep: string;
  readonly titlePlaceholder: string;
  readonly textPlaceholder: string;
  readonly editKeys: string;
  /** The head of the version Fansly holds now, under «changed». */
  readonly latest: string;
  readonly cut: string;
  readonly cutHint: string;
  readonly foreign: string;
  readonly foreignHint: string;
  /** «Создана» + « 16.10.2026 » + «в» + « 19:56». */
  readonly created: string;
  readonly createdAt: string;
}
