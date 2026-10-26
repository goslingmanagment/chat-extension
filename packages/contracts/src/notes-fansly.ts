// «Заметки» of a Fansly tab (FS-NOTE-*): the model, the actions and the client of its two surfaces, the button in the
// header slot after «Регистрация» and the panel in our layer 900. Types only: the controller is core
// application/hosts/fansly/notes, the requests are `fansly.notes.*` (tab-messages-fansly.ts). A note's text lives here
// only between the panel and the background, never in a log or the hub (FS-NOTE-5).
//
// 2026-10-26, the owner: «непонятно… интерфейс не очень удобный… полностью с нуля переработал». The panel is one
// screen now: the questionnaire reads as a table and a field is edited in place (a click, Enter writes it to Fansly),
// the empty fields are «+ Метка» to fill; a free note is one line typed and Enter. 2026-10-27, the owner on the fill
// («это основная фича», a list to tick «неочевидный»): a fan without a questionnaire gets «✨ Заполнить из чата» as the
// panel's first action, and what the Goose found is shown in the questionnaire's own table, its draft, saved by one
// «Сохранить анкету».
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

/** The questionnaire's parts in note order: a field with something written in it, or a line of no field. A field with
 * nothing written is not a part: it is one of `NotesFormVM.blank`. */
export type NotesFormPartVM =
  | {
      readonly kind: 'field';
      readonly label: string;
      readonly facts: readonly NotesFactVM[];
      /** The Goose's last «Сохранить анкету» wrote here: marked until the panel closes. */
      readonly fresh?: boolean;
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

/** A fact of the Goose's draft: `kept` — written and staying; `added` — the Goose's, written by «Сохранить анкету»;
 * `gone` — not there after it (the Goose's rewrite drops it, or a fact of the Goose's put aside by ✕). */
export interface NotesDraftFactVM extends NotesFactVM {
  readonly mark: 'kept' | 'added' | 'gone';
}

/** A row of the Goose's draft of the questionnaire, in note order: a field with what the Goose found in it (`finding`
 * — its index, what «finding» names; `checked` false — put aside by ✕, nothing of it is written), a field it left as
 * it is (`finding` null), or a line of no field. `added` — a field the questionnaire lacks: «Сохранить» adds its line. */
export type NotesDraftRowVM =
  | {
      readonly kind: 'field';
      readonly label: string;
      readonly facts: readonly NotesDraftFactVM[];
      readonly finding: number | null;
      readonly checked: boolean;
      readonly added: boolean;
      /** The fan's words behind it: on hover, never saved. */
      readonly quotes: readonly string[];
    }
  | { readonly kind: 'text'; readonly text: string };

/**
 * «✨ Заполнить из чата» / «✨ Дополнить из чата» of the questionnaire (FS-NOTE-6): `running` — the hub reads the chat
 * («Остановить» drops it); `review` — the Goose's draft in the questionnaire's table waits for «Сохранить анкету»
 * (nothing is written to Fansly before it); `empty` — nothing new in the chat; `failed` — why.
 */
export interface NotesFillVM {
  readonly status: 'idle' | 'running' | 'review' | 'empty' | 'failed';
  /** Why it cannot start now: a field or the questionnaire's text is open, or a write of this fan is in flight. */
  readonly reason: 'editing' | 'writing' | null;
  /** A running fill's stage and its m:ss timer, the kit's StageLine. */
  readonly phase: PhaseVM | null;
  readonly error: CgAnyErrorWire | null;
  /** The draft: the questionnaire as «Сохранить анкету» leaves it. */
  readonly rows: readonly NotesDraftRowVM[];
  /** The fields with nothing written that the Goose found nothing for either. */
  readonly unfound: readonly string[];
  /** «Сохранить анкету» in flight. */
  readonly saving: boolean;
  /** A questionnaire's create failed after it may have landed: «Сохранить анкету» waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
}

/** The fan's questionnaire: one note of 2–30 `Label: value` lines (one per fan), or none yet. */
export interface NotesFormVM {
  /** null — the fan has none: the first field written or «Сохранить анкету» creates «Анкета» with the template's fields. */
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
  /** The facts the last «Сохранить анкету» did not write (the field changed meanwhile, or 30 fields and no «Другое»): named once. */
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
  /** A row of the draft put aside (✕) or back («Вернуть»). */
  | { readonly type: 'finding'; readonly index: number; readonly checked: boolean }
  /** «Сохранить анкету»: the draft's rows not put aside, written to Fansly in one write. */
  | { readonly type: 'fill-apply' }
  /** «Отменить», «Понятно», «Закрыть» of the fill's result: nothing is written. */
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

  /** «✨ Заполнить из чата» / «✨ Дополнить из чата» and the Goose's draft. */
  readonly fill: string;
  readonly fillNew: string;
  readonly fillHint: string;
  readonly fillEditing: string;
  readonly fillWriting: string;
  readonly fillStop: string;
  /** The draft's line over the table: of a new questionnaire, of one filled before. */
  readonly draftNew: string;
  readonly draftMore: string;
  /** A row's ✕ and its way back. */
  readonly drop: string;
  readonly restore: string;
  /** `{labels}` — the fields the Goose found nothing for. */
  readonly unfound: string;
  readonly fillApply: string;
  readonly fillNothing: string;
  readonly fillOk: string;
  readonly fillFailed: string;
  readonly fillAgain: string;
  readonly fillClose: string;
  readonly fillProblem: Readonly<Record<'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>;
  /** The hover over the Goose's fact: «Слова фана: «…»». */
  readonly quotes: string;

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
