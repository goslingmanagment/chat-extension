// «Заметки» of a Fansly tab (R20 P11b; FS-NOTE-1…5; FX-004…FX-013; the Fansly extension's src/content/fan-notes/
// notes-controller.ts): what the button in the header and the panel show, and what they ask the background.
// No DOM and no network: the port measures the page and asks `fansly.notes.*`.
//
// - Views (FS-NOTE-2): «Справа по кнопке» (default) and «Окно по центру» open by the button or ⌘⇧K; «Всегда справа»
//   stands beside every one-to-one chat while there is room right of it, and opens over the chat by the button when
//   there is none. The view is one for every tab: chosen here, stored by the background, followed when it changes.
// - Reads (FS-NOTE-3): «Всегда справа» reads each opened chat after 0.7 s on it, the other two when the panel opens;
//   an answer is kept until the tab reloads or its account changes, «Обновить» reads again; a failed read waits for
//   the person (no loop against a refusing Fansly).
// - Writes (FS-NOTE-4) only by the person's action, once; a failed create blocks «Создать» until a fresh read (it may
//   have landed); a text over the limits is refused, never cut.
// - Drafts are kept per fan (FS-NOTE-2): another chat in the middle of an edit loses nothing.
// - FBuddy's «FBuddy Notes» (`foreign`) is shown, never edited or deleted.
// - A questionnaire (R20 P11b2, the Fansly extension 2.12.0) reads as a table of fields and is edited field by field
//   over the same text (form.ts): a field typed rewrites its own line, every other line keeps its bytes; «Текстом»
//   edits it as one text. The Goose's rewrites wait under their field until «Принять» or «Не нужно» (R20 P11c).
// - A note's text never leaves through here but to the background (FS-NOTE-5): nothing is logged.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { NotesAction, NotesClient, NotesEditorVM, NotesFormPartVM, NotesNameStatus, NotesPanelVM, NotesPlace, NotesProblem, NotesSuggestionVM, NotesTriggerVM } from '@cg/contracts/notes-fansly';
import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import { FANSLY_TAB_LIMITS, type FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { applyFieldSuggestion, diffNoteFacts, noteLabelKey, parseNoteForm, setNoteFieldFacts, splitFactDate, type NoteFieldSuggestion, type NoteFormPart } from './form';
import { NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE } from './template';

/** «Всегда справа» follows the open chat only once the person stays on it this long (FS-NOTE-3). */
export const NOTES_FOLLOW_DELAY_MS = 700;
/** Chats whose notes a tab keeps; a shift opens fewer. */
const KEPT_CHATS = 300;

type Failure = { readonly ok: false; readonly error: CgAnyErrorWire };
type CustomName = { readonly noteId: string; readonly name: string };

function suggestionVM(suggestion: NoteFieldSuggestion, index: number): NotesSuggestionVM {
  const { added, removed } = diffNoteFacts(suggestion.current, suggestion.proposed);
  return { index, label: suggestion.label, added, removed, proposed: suggestion.proposed, quotes: suggestion.quotes };
}

/** The questionnaire's parts for the panel; each field carries the Goose's rewrites of it. */
function formVM(parts: readonly NoteFormPart[], suggestions: readonly NotesSuggestionVM[]): NotesFormPartVM[] {
  return parts.map((part) =>
    part.kind === 'text'
      ? { kind: 'text', text: part.text }
      : {
          kind: 'field',
          label: part.label,
          facts: part.facts.map(splitFactDate),
          value: part.facts.join('\n'),
          suggestions: suggestions.filter((suggestion) => noteLabelKey(suggestion.label) === noteLabelKey(part.label)),
        },
  );
}

function editorVM(draft: Draft): NotesEditorVM {
  const suggestions = draft.suggestions.map(suggestionVM);
  const parts = parseNoteForm(draft.text);
  return {
    noteId: draft.noteId,
    title: draft.title,
    text: draft.text,
    saving: draft.saving,
    blocked: draft.blocked,
    problem: draft.problem,
    form: parts === null ? null : formVM(parts, suggestions),
    asText: draft.asText,
    suggestions,
  };
}

/** The open one-to-one chat where the owner switched «Заметки» on. `fanId` null — MAIN has not named its fan. */
export interface NotesTarget {
  readonly accountId: string;
  readonly groupId: string;
  readonly fanId: string | null;
  readonly fan: { readonly name: string | null; readonly handle: string | null } | null;
}

/** Whose notes a write is about. */
export interface NotesWho {
  readonly accountId: string;
  readonly fanId: string;
}

export interface NotesPort {
  /** The tab's account and login: another one drops everything read and typed under the previous. */
  session(): string | null;
  target(): NotesTarget | null;
  read(target: NotesTarget, force: boolean): Promise<{ readonly ok: true; readonly fanRef: string; readonly notes: readonly FanslyNote[]; readonly customName: CustomName | null } | Failure>;
  create(who: NotesWho, title: string, text: string): Promise<{ readonly ok: true; readonly note: FanslyNote } | Failure>;
  edit(who: NotesWho, noteId: string, title: string, text: string, current: Pick<FanslyNote, 'title' | 'text'>): Promise<{ readonly ok: true; readonly note: FanslyNote } | Failure>;
  remove(who: NotesWho, note: FanslyNote): Promise<{ readonly ok: true } | Failure>;
  name(who: NotesWho, name: string, current: CustomName | null): Promise<{ readonly ok: true; readonly customName: CustomName | null } | Failure>;
  /** The person chose a view: the background stores it for every tab. */
  setView(view: FanslyNotesView): void;
  /** «Всегда справа» has room right of the chat. */
  fits(): boolean;
  /** Where the side panel stands now; null — no chat to stand beside. */
  place(): NotesPlace | null;
  setTimer(ms: number, run: () => void): unknown;
  clearTimer(handle: unknown): void;
}

interface Data {
  readonly fanRef: string;
  readonly notes: readonly FanslyNote[];
  readonly customName: CustomName | null;
}

type Entry = { readonly kind: 'loading'; readonly token: number } | { readonly kind: 'ready'; readonly data: Data } | { readonly kind: 'error'; readonly error: CgAnyErrorWire };

interface Draft {
  noteId: string | null;
  readonly current: Pick<FanslyNote, 'title' | 'text'>;
  title: string;
  text: string;
  saving: boolean;
  blocked: boolean;
  problem: NotesProblem | null;
  asText: boolean;
  /** The Goose's rewrites of filled fields (R20 P11c puts them here). */
  suggestions: NoteFieldSuggestion[];
}

interface NameState {
  readonly status: NotesNameStatus;
  readonly error: CgAnyErrorWire | null;
}

const toFailure = (error: unknown): Failure => ({ ok: false, error: { code: 'CG-FAN-REQUEST', ...(error instanceof Error ? { detail: error.name } : {}) } });

export type NotesController = NotesClient & {
  /** The route, the account, the header changed: follow the open chat. */
  sync(): void;
  /** The stored view (the background's answer or its event). */
  applyView(view: FanslyNotesView): void;
  /** The page moved under the panel (a resize): re-place it, show or hide «Всегда справа». */
  layout(): void;
  /** The button or ⌘⇧K; false outside a one-to-one chat of the switch. */
  toggle(): boolean;
  dispose(): void;
};

export function createNotesController(port: NotesPort): NotesController {
  const listeners = new Set<() => void>();
  const entries = new Map<string, Entry>();
  const drafts = new Map<string, Draft>();
  const nameDrafts = new Map<string, { value: string; readonly current: CustomName | null }>();
  const nameStates = new Map<string, NameState>();
  let view: FanslyNotesView = 'drawer';
  /** The person wants the panel (for «Всегда справа»: unless closed). */
  let wanted = false;
  /** «Всегда справа» without room: opened over the chat by the button. */
  let narrowOpen = false;
  let groupId: string | null = null;
  let session: string | null = null;
  let epoch = 0;
  let loads = 0;
  let follow: unknown = null;
  let confirm: { readonly fanId: string; readonly noteId: string } | null = null;
  let deleting: { readonly fanId: string; readonly noteId: string } | null = null;
  let deleteError: { readonly fanId: string; readonly noteId: string; readonly error: CgAnyErrorWire } | null = null;
  let disposed = false;
  let panelVM: NotesPanelVM | null = null;
  let triggerVM: NotesTriggerVM | null = null;
  let shape = '';
  /** A note's questionnaire, parsed once per note read (the panel builds on every keystroke). */
  const forms = new WeakMap<FanslyNote, readonly NotesFormPartVM[] | null>();
  const formOf = (note: FanslyNote): readonly NotesFormPartVM[] | null => {
    if (!forms.has(note)) {
      const parts = note.foreign ? null : parseNoteForm(note.text);
      forms.set(note, parts === null ? null : formVM(parts, []));
    }
    return forms.get(note) ?? null;
  };

  const target = (): NotesTarget | null => {
    const next = port.session();
    if (next !== session) {
      session = next;
      epoch += 1;
      entries.clear();
      drafts.clear();
      nameDrafts.clear();
      nameStates.clear();
      confirm = null;
      deleting = null;
      deleteError = null;
    }
    return port.target();
  };
  const current = (): Data | null => {
    const entry = groupId === null ? undefined : entries.get(groupId);
    return entry?.kind === 'ready' ? entry.data : null;
  };
  const visible = (): boolean => groupId !== null && wanted && (view !== 'docked' || narrowOpen || port.fits());
  const writing = (fanId: string): boolean => drafts.get(fanId)?.saving === true || deleting?.fanId === fanId || nameStates.get(fanId)?.status === 'saving';

  function build(): void {
    const t = port.target();
    const shown = visible();
    const entry = groupId === null ? undefined : entries.get(groupId);
    const data = entry?.kind === 'ready' ? entry.data : null;
    const fanId = data?.fanRef ?? null;
    const draft = fanId === null ? undefined : drafts.get(fanId);
    const name = fanId === null ? undefined : nameStates.get(fanId);
    const narrow = view === 'docked' && !port.fits();
    panelVM = {
      shown,
      view,
      narrow,
      place: shown && view !== 'center' ? port.place() : null,
      fan: t?.fan ?? null,
      body: entry === undefined || entry.kind === 'loading' ? 'loading' : entry.kind,
      error: entry?.kind === 'error' ? entry.error : null,
      notes: data?.notes ?? [],
      name: { value: (fanId === null ? undefined : nameDrafts.get(fanId)?.value) ?? data?.customName?.name ?? '', status: name?.status ?? 'idle', error: name?.error ?? null },
      editor: draft === undefined ? null : editorVM(draft),
      confirmDelete: confirm !== null && confirm.fanId === fanId ? confirm.noteId : null,
      deleting: deleting !== null && deleting.fanId === fanId ? deleting.noteId : null,
      deleteError: deleteError !== null && deleteError.fanId === fanId ? deleteError.error : null,
      writing: fanId !== null && writing(fanId),
      template: data !== null && !data.notes.some((note) => formOf(note) !== null),
      forms: Object.fromEntries((data?.notes ?? []).flatMap((note) => {
        const form = formOf(note);
        return form === null ? [] : [[note.noteId, form] as const];
      })),
    };
    triggerVM = { shown: t !== null, count: data === null ? null : data.notes.length, open: shown };
    shape = JSON.stringify([shown, panelVM.place, narrow, triggerVM.shown]);
  }

  function emit(): void {
    if (disposed) return;
    build();
    for (const listener of [...listeners]) listener();
  }

  function clearFollow(): void {
    if (follow !== null) port.clearTimer(follow);
    follow = null;
  }

  async function load(group: string, t: NotesTarget, force: boolean): Promise<void> {
    const under = epoch;
    const token = (loads += 1);
    entries.delete(group);
    entries.set(group, { kind: 'loading', token });
    emit();
    const answer = await port.read(t, force).catch(toFailure);
    if (disposed || under !== epoch) return;
    const now = entries.get(group);
    if (now?.kind !== 'loading' || now.token !== token) return;
    if (answer.ok) {
      entries.set(group, { kind: 'ready', data: { fanRef: answer.fanRef, notes: answer.notes, customName: answer.customName } });
      afterReread(answer.fanRef, answer.notes);
    } else entries.set(group, { kind: 'error', error: answer.error });
    while (entries.size > KEPT_CHATS) entries.delete(entries.keys().next().value as string);
    emit();
  }

  /**
   * A fresh read answers what an unconfirmed write could not: the person now sees whether it landed, so a create may
   * go out again. A draft of a note deleted elsewhere becomes a new note instead of an editor of nothing.
   */
  function afterReread(fanId: string, notes: readonly FanslyNote[]): void {
    const draft = drafts.get(fanId);
    if (draft !== undefined && !draft.saving) {
      draft.blocked = false;
      if (draft.noteId !== null && !notes.some((note) => note.noteId === draft.noteId)) {
        draft.noteId = null;
        draft.problem = { kind: 'deleted' };
      } else if (draft.problem?.kind === 'failed' && draft.problem.error.detail !== 'changed') draft.problem = null;
    }
    if (nameStates.get(fanId)?.status === 'unconfirmed') nameStates.delete(fanId);
  }

  function ensureLoaded(mode: 'now' | 'follow'): void {
    const group = groupId;
    const t = target();
    if (group === null || t === null) return;
    const entry = entries.get(group);
    if (entry?.kind === 'loading' || entry?.kind === 'ready') return;
    // A failure waits for the person: no request loop against a refusing Fansly.
    if (entry?.kind === 'error' && mode === 'follow') return;
    if (mode === 'now') {
      clearFollow();
      void load(group, t, false);
      return;
    }
    if (follow !== null) return;
    follow = port.setTimer(NOTES_FOLLOW_DELAY_MS, () => {
      follow = null;
      const still = target();
      if (!disposed && groupId === group && still !== null && still.groupId === group && visible() && !entries.has(group)) void load(group, still, false);
    });
  }

  function update(mode: 'now' | 'follow'): void {
    if (visible()) ensureLoaded(mode);
    else clearFollow();
    emit();
  }

  function sync(): void {
    const t = target();
    const next = t?.groupId ?? null;
    if (next !== groupId) {
      clearFollow();
      confirm = null;
      deleteError = null;
      // A centred window belongs to the chat it was opened on.
      if (view === 'center' && wanted) wanted = false;
      groupId = next;
    }
    update('follow');
  }

  function toggle(): boolean {
    sync();
    if (groupId === null) return false;
    const was = visible();
    if (view === 'docked' && !port.fits()) {
      wanted = true;
      narrowOpen = !was;
    } else wanted = !was;
    update('now');
    return true;
  }

  function close(): void {
    if (view === 'docked') {
      narrowOpen = false;
      if (port.fits()) wanted = false;
    } else wanted = false;
    update('follow');
  }

  function chooseView(next: FanslyNotesView): void {
    if (next === view) return;
    view = next;
    wanted = true;
    narrowOpen = next === 'docked' && !port.fits();
    port.setView(next);
    update('now');
  }

  function refresh(): void {
    const group = groupId;
    const t = target();
    if (group === null || t === null || entries.get(group)?.kind === 'loading') return;
    const data = current();
    // A reread racing a write would hide its result and drop the draft with it.
    if (data !== null && writing(data.fanRef)) return;
    clearFollow();
    void load(group, t, true);
  }

  /** A confirmed write, in every kept chat of that fan. */
  function patch(fanId: string, change: (data: Data) => Data): void {
    for (const [group, entry] of entries) if (entry.kind === 'ready' && entry.data.fanRef === fanId) entries.set(group, { kind: 'ready', data: change(entry.data) });
  }

  const who = (data: Data): NotesWho | null => {
    const t = port.target();
    return t === null ? null : { accountId: t.accountId, fanId: data.fanRef };
  };

  function startDraft(noteId: string | null, title: string, text: string): void {
    const data = current();
    if (data === null || drafts.has(data.fanRef)) return;
    confirm = null;
    drafts.set(data.fanRef, { noteId, current: { title, text }, title, text, saving: false, blocked: false, problem: null, asText: false, suggestions: [] });
    emit();
  }

  async function save(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    if (data === null || to === null) return;
    const draft = drafts.get(data.fanRef);
    if (draft === undefined || draft.saving || draft.blocked) return;
    const title = draft.title.trim();
    const text = draft.text.trimEnd();
    if (title === '' && text.trim() === '') {
      draft.problem = { kind: 'empty' };
      return emit();
    }
    // Refused, never cut: a cut would drop the tail of the note in Fansly.
    if (title.length > FANSLY_TAB_LIMITS.noteTitleMaxChars || text.length > FANSLY_TAB_LIMITS.noteTextMaxChars) {
      draft.problem = { kind: 'too-long' };
      return emit();
    }
    draft.saving = true;
    draft.problem = null;
    emit();
    const under = epoch;
    const answer = await (draft.noteId === null ? port.create(to, title, text) : port.edit(to, draft.noteId, title, text, draft.current)).catch(toFailure);
    if (disposed || under !== epoch || drafts.get(data.fanRef) !== draft) return;
    draft.saving = false;
    if (answer.ok) {
      const saved = answer.note;
      patch(data.fanRef, (d) => ({ ...d, notes: d.notes.some((note) => note.noteId === saved.noteId) ? d.notes.map((note) => (note.noteId === saved.noteId ? saved : note)) : [...d.notes, saved] }));
      drafts.delete(data.fanRef);
    } else {
      // A create may have landed: another one now could make a duplicate.
      if (draft.noteId === null) draft.blocked = true;
      draft.problem = { kind: 'failed', error: answer.error, created: draft.noteId === null };
    }
    emit();
  }

  async function remove(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    const asked = confirm;
    if (data === null || to === null || asked === null || deleting !== null || asked.fanId !== data.fanRef) return;
    const note = data.notes.find((entry) => entry.noteId === asked.noteId);
    if (note === undefined || note.foreign) return;
    deleting = asked;
    deleteError = null;
    emit();
    const under = epoch;
    const answer = await port.remove(to, note).catch(toFailure);
    if (disposed || under !== epoch) return;
    deleting = null;
    if (answer.ok) {
      patch(asked.fanId, (d) => ({ ...d, notes: d.notes.filter((entry) => entry.noteId !== note.noteId) }));
      if (confirm === asked) confirm = null;
    } else deleteError = { ...asked, error: answer.error };
    emit();
  }

  async function commitName(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    if (data === null || to === null) return;
    const fanId = data.fanRef;
    const typed = nameDrafts.get(fanId);
    if (typed === undefined || nameStates.get(fanId)?.status === 'saving' || nameStates.get(fanId)?.status === 'unconfirmed') return;
    const name = typed.value.trim();
    // Only a changed text is written (Enter, or the field left).
    if (name === (data.customName?.name ?? '')) {
      nameDrafts.delete(fanId);
      nameStates.delete(fanId);
      return emit();
    }
    if (name.length > FANSLY_TAB_LIMITS.customNameMaxChars) {
      nameStates.set(fanId, { status: 'too-long', error: null });
      return emit();
    }
    nameStates.set(fanId, { status: 'saving', error: null });
    emit();
    const under = epoch;
    const answer = await port.name(to, name, typed.current).catch(toFailure);
    if (disposed || under !== epoch) return;
    if (answer.ok) {
      const saved = answer.customName;
      patch(fanId, (d) => ({ ...d, customName: saved }));
      nameDrafts.delete(fanId);
      nameStates.set(fanId, { status: 'saved', error: null });
    } else nameStates.set(fanId, { status: answer.error.code === 'CG-NOTE-UNCERTAIN' ? 'unconfirmed' : 'error', error: answer.error });
    emit();
  }

  function dispatch(action: NotesAction): void {
    if (disposed) return;
    const data = current();
    const draft = data === null ? undefined : drafts.get(data.fanRef);
    switch (action.type) {
      case 'toggle':
        toggle();
        return;
      case 'close':
        return close();
      case 'refresh':
        return refresh();
      case 'view':
        return chooseView(action.view);
      case 'create':
        return startDraft(null, action.template ? NOTE_TEMPLATE_TITLE : '', action.template ? NOTE_TEMPLATE_TEXT : '');
      case 'edit': {
        const note = data?.notes.find((entry) => entry.noteId === action.noteId);
        if (note === undefined || note.foreign) return;
        return startDraft(note.noteId, note.title, note.text);
      }
      case 'input':
        if (draft === undefined || draft.saving) return;
        draft.title = action.title;
        draft.text = action.text;
        if (draft.problem?.kind === 'empty' || draft.problem?.kind === 'too-long') draft.problem = null;
        return emit();
      case 'field':
        if (draft === undefined || draft.saving) return;
        draft.text = setNoteFieldFacts(draft.text, action.label, action.value.split('\n'));
        if (draft.problem?.kind === 'empty' || draft.problem?.kind === 'too-long') draft.problem = null;
        return emit();
      case 'as-text':
        if (draft === undefined || draft.saving) return;
        draft.asText = action.on;
        return emit();
      case 'suggestion': {
        const suggestion = draft?.suggestions[action.index];
        if (draft === undefined || draft.saving || suggestion === undefined) return;
        if (action.accept) draft.text = applyFieldSuggestion(draft.text, suggestion);
        draft.suggestions.splice(action.index, 1);
        return emit();
      }
      case 'save':
        void save();
        return;
      case 'cancel':
        if (data === null || draft === undefined || draft.saving) return;
        drafts.delete(data.fanRef);
        return emit();
      case 'ask-delete':
        if (data === null || deleting !== null) return;
        confirm = { fanId: data.fanRef, noteId: action.noteId };
        deleteError = null;
        return emit();
      case 'keep':
        if (deleting !== null) return;
        confirm = null;
        deleteError = null;
        return emit();
      case 'delete':
        void remove();
        return;
      case 'name-input': {
        if (data === null) return;
        const state = nameStates.get(data.fanRef)?.status;
        if (state === 'saving' || state === 'unconfirmed') return;
        const typed = nameDrafts.get(data.fanRef);
        nameDrafts.set(data.fanRef, { value: action.value, current: typed === undefined ? data.customName : typed.current });
        nameStates.delete(data.fanRef);
        return emit();
      }
      case 'name-commit':
        void commitName();
        return;
      case 'name-revert':
        if (data === null || nameStates.get(data.fanRef)?.status === 'saving') return;
        nameDrafts.delete(data.fanRef);
        nameStates.delete(data.fanRef);
        return emit();
    }
  }

  build();
  return {
    panel: () => panelVM as NotesPanelVM,
    trigger: () => triggerVM as NotesTriggerVM,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    sync,
    toggle,
    applyView(next) {
      if (next === view) return;
      view = next;
      wanted = next === 'docked';
      narrowOpen = false;
      update('follow');
    },
    layout() {
      const before = shape;
      build();
      if (shape !== before) update('follow');
    },
    dispose() {
      disposed = true;
      clearFollow();
      listeners.clear();
      entries.clear();
      drafts.clear();
    },
  };
}
