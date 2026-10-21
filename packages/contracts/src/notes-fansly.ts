// 1.15.0, R20 P11b (the questionnaire's fields: P11b2; «✨ Заполнить из чата»: P11c; 1.16.0, P11b2 — the Fansly extension
// 2.11–2.13: the dates of notes, «✨ Дополнить из чата» on the questionnaire being read, «Слова фана», «Принять все», «В Другое»): «Заметки» of a Fansly tab (FS-NOTE-*) — the model, the actions and the client of its two
// surfaces: the button in the header slot after «Регистрация» and the panel in our layer 900. Types only: the
// controller is core application/hosts/fansly/notes, the requests are `fansly.notes.*` (tab-messages-fansly.ts).
// A note's text lives here only between the panel and the background, never in a log or the hub (FS-NOTE-5).
import type { CgAnyErrorWire } from './errors-fansly';
import type { FanslyNotesView } from './settings-ext';
import type { FanslyNote } from './tab-messages-fansly';

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

/** Why the open editor did not save. `failed.created` — a create that may have landed: no second one before a reread. */
export type NotesProblem =
  | { readonly kind: 'empty' }
  | { readonly kind: 'too-long' }
  | { readonly kind: 'deleted' }
  /** 2026-10-21 (audit №13): the note changed elsewhere since the editor opened — `latest` is what Fansly holds now; the
   * next «Сохранить» writes the draft over it. */
  | { readonly kind: 'changed'; readonly latest: { readonly title: string; readonly text: string } }
  | { readonly kind: 'failed'; readonly error: CgAnyErrorWire; readonly created: boolean };

/** A fact of a questionnaire's field and the month the Goose stamped on it («Флорида (08.2026)»), R20 P11b2. */
export interface NotesFactVM {
  readonly text: string;
  readonly date: string | null;
}

/** 1.16.0 (R20 P11b2; the Fansly extension 2.13.0, decision 171): when a free note was created, in the chatter's clock — `day`
 * «16.10» («16.10.2025» outside the current year), `full` «16.10.2026» and `time` «19:56» for the hover, `iso` for
 * `<time datetime>`. A questionnaire is not dated: its facts carry their months. */
export interface NotesDateVM {
  readonly day: string;
  readonly full: string;
  readonly time: string;
  readonly iso: string;
}

/** 1.16.0: a quote of the fan behind what the fill wrote: `label` — the field it speaks of, named where it stands apart
 * from that field (under «Другое», in the text view); null — under its own field. */
export interface NotesQuoteVM {
  readonly label: string | null;
  readonly quote: string;
}

/** A rewrite of a filled field the Goose offers, shown under its field (R20 P11c fills it; P11b2 keeps its place):
 * the facts it adds and drops — both empty when it only reorders or respaces, then `proposed` is shown whole. */
export interface NotesSuggestionVM {
  /** Its place in `NotesEditorVM.suggestions`: what «Принять» and «Не нужно» name. */
  readonly index: number;
  readonly label: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly proposed: string;
  /** The fan's words behind it: shown, never saved. */
  readonly quotes: readonly string[];
}

/** A questionnaire as the panel shows it (R20 P11b2; the Fansly extension 2.12.0, decision 166): its fields in note order —
 * the label, the facts (the value's «; » parts, then the lines written under it), `value` — the facts one per line
 * as the field's box holds them, the Goose's rewrites of that field — and the lines of no field. */
export type NotesFormPartVM =
  | {
      readonly kind: 'field';
      readonly label: string;
      readonly facts: readonly NotesFactVM[];
      readonly value: string;
      readonly suggestions: readonly NotesSuggestionVM[];
      /** 1.16.0 (R20 P11b2; decision 166): the fill wrote into this field (or a rewrite of it was taken) — the row is marked. */
      readonly ai?: boolean;
      /** 1.16.0: the fan's words behind what the fill wrote here, while «Слова фана» is open. */
      readonly quotes?: readonly NotesQuoteVM[];
      /** 1.16.0 (decision 164): a field the Goose named itself, still in the draft: «В Другое». */
      readonly proposed?: boolean;
    }
  | { readonly kind: 'text'; readonly text: string };

/** «✨ Дополнить из чата» of a questionnaire being edited (R20 P11c; FS-NOTE-6): `running` — the hub reads the chat
 * («Остановить» drops it); `done` — `wrote`: the fields the Goose wrote into (empty ones, «Другое» a fact joined, the
 * template's new lines), while its rewrites of filled ones wait under them (`NotesEditorVM.suggestions`); `failed` — why. */
export interface NotesFillVM {
  readonly status: 'idle' | 'running' | 'done' | 'failed';
  readonly wrote: readonly string[];
  readonly error: CgAnyErrorWire | null;
  /** 1.28.0 (X43; the Fansly extension 2.11.0, decision 164): the fields the hub named that found no place — no line
   * of their own under 30 and no «Другое» to join: «Не хватило места в анкете: …». Absent — none. */
  readonly unplaced?: readonly string[];
}

export interface NotesEditorVM {
  /** null — a new note. */
  readonly noteId: string | null;
  readonly title: string;
  readonly text: string;
  readonly saving: boolean;
  /** A create failed after it may have landed: «Создать» waits for «Обновить». */
  readonly blocked: boolean;
  readonly problem: NotesProblem | null;
  /** The draft is a questionnaire: its fields (R20 P11b2); null — a note of free text. */
  readonly form: readonly NotesFormPartVM[] | null;
  /** «Текстом»: the questionnaire edited as one text, as in Fansly's own window. */
  readonly asText: boolean;
  /** The Goose's rewrites of filled fields, in order (empty until R20 P11c's fill). */
  readonly suggestions: readonly NotesSuggestionVM[];
  /** R20 P11c: null — no fill here (the page's «Заполнить из чата» is off, or the draft is no questionnaire). */
  readonly fill: NotesFillVM | null;
  /** 1.16.0 (R20 P11b2; decision 166): the quotes behind what the fill wrote straight into the draft — `sourceCount` of them;
   * «Слова фана» shows them under their fields (`sourcesOpen`). Suggestions show theirs always. */
  readonly sourceCount?: number;
  readonly sourcesOpen?: boolean;
  /** 1.16.0: shown quotes with no field to stand under (the text view, a field gone), named by their field. */
  readonly looseQuotes?: readonly NotesQuoteVM[];
  /** 1.16.0 (decision 164): the fields the Goose named itself still in the draft — in the text view, their «В Другое» rows. */
  readonly proposed?: readonly string[];
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
  /** Regular notes (12000) in Fansly's order; `foreign` — FBuddy's, read only. */
  readonly notes: readonly FanslyNote[];
  /** `changed` (2026-10-21, audit №13): the name changed elsewhere — `latest` is Fansly's now (null — none); the next
   * Enter writes the typed one over it. */
  readonly name: { readonly value: string; readonly status: NotesNameStatus; readonly error: CgAnyErrorWire | null; readonly changed?: { readonly latest: string | null } };
  readonly editor: NotesEditorVM | null;
  readonly confirmDelete: string | null;
  readonly deleting: string | null;
  readonly deleteError: CgAnyErrorWire | null;
  /** A write of this fan is in flight: «Обновить» waits for it. */
  readonly writing: boolean;
  /** «+ Анкета»: the fan has no questionnaire yet (one per fan). */
  readonly template: boolean;
  /** The questionnaires among `notes`, by `noteId`: read as a table of fields (R20 P11b2). */
  readonly forms: Readonly<Record<string, readonly NotesFormPartVM[]>>;
  /** 1.16.0 (R20 P11b2; decision 171): when each free note was created, by `noteId`; a note Fansly gave no time is absent. */
  readonly dates?: Readonly<Record<string, NotesDateVM>>;
  /** 1.16.0 (R20 P11b2; the Fansly extension 2.12.0): «✨ Дополнить из чата» stands on a questionnaire being read — the
   * page's switch is on and no note of this fan is being edited or written. */
  readonly fill?: boolean;
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
  | { readonly type: 'create'; readonly template: boolean }
  | { readonly type: 'edit'; readonly noteId: string }
  | { readonly type: 'input'; readonly title: string; readonly text: string }
  /** A questionnaire's field typed in its box: the facts one per line (R20 P11b2). */
  | { readonly type: 'field'; readonly label: string; readonly value: string }
  /** «Текстом» / «Полями». */
  | { readonly type: 'as-text'; readonly on: boolean }
  /** «Принять» (`accept`) or «Не нужно» on the Goose's rewrite `index`. */
  | { readonly type: 'suggestion'; readonly index: number; readonly accept: boolean }
  /** «✨ Дополнить из чата» and «Остановить» (R20 P11c). */
  | { readonly type: 'fill' }
  | { readonly type: 'fill-stop' }
  /** 1.16.0 (R20 P11b2): «✨ Дополнить из чата» on a questionnaire being read — open it and fill. */
  | { readonly type: 'fill-note'; readonly noteId: string }
  /** 1.16.0: «Слова фана» / «Скрыть слова фана». */
  | { readonly type: 'sources'; readonly open: boolean }
  /** 1.16.0: «Принять все» — every rewrite the Goose offers. */
  | { readonly type: 'suggestion-all' }
  /** 1.16.0 (decision 164): «В Другое» — a field the Goose named itself joins «Другое» as `Label: value`. */
  | { readonly type: 'to-other'; readonly label: string }
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
  readonly fan: string;
  readonly namePlaceholder: string;
  readonly name: Readonly<Record<NotesNameStatus, string>>;
  readonly loading: string;
  readonly retry: string;
  readonly empty: string;
  readonly add: string;
  readonly template: string;
  readonly edit: string;
  readonly remove: string;
  readonly removeAsk: string;
  readonly removing: string;
  readonly keep: string;
  readonly untitled: string;
  readonly titlePlaceholder: string;
  readonly textPlaceholder: string;
  readonly create: string;
  readonly save: string;
  readonly saving: string;
  readonly saveHint: string;
  readonly cancel: string;
  readonly problem: Readonly<Record<'empty' | 'too-long' | 'deleted' | 'changed' | 'failed-create' | 'failed-edit', string>>;
  /** 2026-10-21 (audit №13): the head of the version Fansly holds now, under «changed». */
  readonly latest: string;
  /** The name for oneself changed elsewhere: `{name}` — the one Fansly holds now; `nameRemoved` — none any more. */
  readonly nameChanged: string;
  readonly nameRemoved: string;
  /** A note longer than the panel's limits: its mark and why it is read-only. */
  readonly cut: string;
  readonly cutHint: string;
  readonly foreign: string;
  readonly foreignHint: string;
  readonly viewLabel: string;
  readonly views: Readonly<Record<FanslyNotesView, string>>;
  readonly narrow: string;
  readonly hotkey: string;
  /** R20 P11b2: an untitled questionnaire's title, «Текстом» / «Полями», the table's words, the Goose's rewrite. */
  readonly questionnaire: string;
  readonly asText: string;
  readonly asTextHint: string;
  readonly asFields: string;
  readonly asFieldsHint: string;
  readonly blank: string;
  readonly freeLine: string;
  readonly factDate: string;
  readonly suggestReplace: string;
  readonly suggestAdd: string;
  /** «Гусь предлагает заменить» + « в «Работа»» where the rewrite is not under its field. */
  readonly suggestIn: string;
  readonly accept: string;
  readonly dismiss: string;
  /** R20 P11c: «✨ Заполнить из чата», its run and its outcome — «Гусь вписал: …», «Правки под полями: N». */
  readonly fill: string;
  readonly fillHint: string;
  readonly filling: string;
  readonly fillStop: string;
  readonly fillWrote: string;
  readonly fillOffers: string;
  readonly fillNothing: string;
  readonly fillFailed: string;
  /** 1.28.0 (X43): «Не хватило места в анкете:» + « Питомцы, Машина.» — the fields the hub named that found no place. */
  readonly fillUnplaced: string;
  /** 1.16.0 (R20 P11b2): «Слова фана» and its hint, «Принять все», «В Другое», a field the Goose named, a note's date. */
  readonly sources: string;
  readonly sourcesHide: string;
  readonly sourcesHint: string;
  readonly acceptAll: string;
  readonly toOther: string;
  readonly toOtherHint: string;
  /** «Это поле завёл Гусь» under the field; «Гусь завёл поле» + « «…»» in the text view. */
  readonly proposedHere: string;
  readonly proposedNamed: string;
  /** «Создана» + « 16.10.2026 » + «в» + « 19:56». */
  readonly created: string;
  readonly createdAt: string;
}
