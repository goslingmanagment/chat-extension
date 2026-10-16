// 1.15.0, R20 P11b: «Заметки» of a Fansly tab (FS-NOTE-*) — the model, the actions and the client of its two
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
  | { readonly kind: 'failed'; readonly error: CgAnyErrorWire; readonly created: boolean };

export interface NotesEditorVM {
  /** null — a new note. */
  readonly noteId: string | null;
  readonly title: string;
  readonly text: string;
  readonly saving: boolean;
  /** A create failed after it may have landed: «Создать» waits for «Обновить». */
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
  /** Regular notes (12000) in Fansly's order; `foreign` — FBuddy's, read only. */
  readonly notes: readonly FanslyNote[];
  readonly name: { readonly value: string; readonly status: NotesNameStatus; readonly error: CgAnyErrorWire | null };
  readonly editor: NotesEditorVM | null;
  readonly confirmDelete: string | null;
  readonly deleting: string | null;
  readonly deleteError: CgAnyErrorWire | null;
  /** A write of this fan is in flight: «Обновить» waits for it. */
  readonly writing: boolean;
  /** «+ По шаблону»: the fan has no questionnaire yet (one per fan). */
  readonly template: boolean;
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
  readonly problem: Readonly<Record<'empty' | 'too-long' | 'deleted' | 'failed-create' | 'failed-edit', string>>;
  readonly foreign: string;
  readonly foreignHint: string;
  readonly viewLabel: string;
  readonly views: Readonly<Record<FanslyNotesView, string>>;
  readonly narrow: string;
  readonly hotkey: string;
}
