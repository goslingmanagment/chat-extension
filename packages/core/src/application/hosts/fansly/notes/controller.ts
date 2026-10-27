// «Заметки» of a Fansly tab (FS-NOTE-1…6; FX-004…FX-024): what the button in the header and the panel show, and what
// they ask the background. No DOM and no network: the port measures the page and asks `fansly.notes.*`.
//
// 2026-10-26, the owner («непонятно… полностью с нуля переработал»): the panel is one screen, nothing switches it into
// a mode.
// - The questionnaire (one note of `Label: value` lines, form.ts) reads as a table. A field is opened in place by a
//   click, typed one fact per line, and Enter writes it to Fansly at once: its own line changes, every other line keeps
//   its bytes, and it is written into the note as Fansly holds it now (a field typed in another tab stays). The fields
//   with nothing written are «+ Метка»: the questionnaire's own empty ones and the template's it lacks. A fan without a
//   questionnaire gets one with the first field written (the template, «Анкета»).
// - «✨ Заполнить из чата» / «✨ Дополнить из чата» (FS-NOTE-6, fill.ts): the site operation `notes-fill` through the
//   shared admission, with the questionnaire's labels and the values of their lines (X43). 2026-10-27 (the owner: «это
//   основная фича», then «Подсказки прямо в строках» of six prototypes, «чаттер должен контролировать, что он
//   делает»): a fan without a questionnaire gets it as the panel's first action, and each finding stands in its
//   field's row as a suggestion. Nothing is written before the chatter's ✓: one ✓ is one write (a ✓ pressed while one
//   is in flight joins the next), «Принять все» one write of all, × or «Скрыть» put them aside. A field's line takes
//   the hub's value only while it still holds what the hub saw; one changed since asks «Заменить?». The last ✓ can be
//   taken back for a few seconds («Отменить»). «Остановить» drops a running fill and its late answer.
// - A free note is the box at the top of the notes: a line typed and Enter makes it a note, signed (2026-10-27, the
//   owner: «имя автора в заметке»): its title is the hub login of the chatter who wrote it, so the name stands in Fansly
//   itself — our panel, Fansly's own window and every colleague's tab show it, and the hub keeps nothing new. Any note,
//   the questionnaire included («Править текстом»), opens as text and keeps its title; a delete asks first.
// - Views (FS-NOTE-2): «Справа по кнопке» (default) and «Окно по центру» open by the button or ⌘⇧K; «Всегда справа»
//   stands beside every one-to-one chat while there is room right of it. One view for every tab, stored by the
//   background.
// - Reads (FS-NOTE-3): «Всегда справа» reads each opened chat after 0.7 s on it, the other two when the panel opens;
//   an answer is kept until the tab reloads or its account changes, «Обновить» reads again; a failed read waits for
//   the person.
// - Writes (FS-NOTE-4) only by the person's action, once; a failed create blocks the next one until a fresh read (it
//   may have landed); a text over the limits is refused, never cut. What is typed is kept per fan: another chat in the
//   middle of an edit loses nothing.
// - FBuddy's «FBuddy Notes» (`foreign`) and a note longer than the panel holds (`cut`) are shown, never written.
// - A note's text never leaves through here but to the background (FS-NOTE-5), and from there only a fill's values, in
//   the hub's request body: nothing is logged.

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import { NOTE_ATTRIBUTION_LIMITS, type NoteAttributionOrigin } from '@cg/contracts/hub';
import type { NotesAction, NotesClient, NotesDateVM, NotesFillProgressVM, NotesFillVM, NotesFormPartVM, NotesSuggestionVM, NotesFormVM, NotesItemVM, NotesNameStatus, NotesPanelVM, NotesPlace, NotesProblem, NotesTriggerVM } from '@cg/contracts/notes-fansly';
import type { Phase, SiteOpView } from '@cg/contracts/ops';
import type { PhaseVM } from '@cg/contracts/vm';
import type { FanslyNotesView } from '@cg/contracts/settings-ext';
import { FANSLY_TAB_LIMITS, type FanslyNote } from '@cg/contracts/tab-messages-fansly';

import { noteFillSeen, parseNoteFillAnswer } from '../../../../domain/hosts/fansly/notes-fill-answer';
import { applyNoteFindings, noteFillRequest, noteFindings, noteSuggestion, type NoteFinding } from './fill';
import { NOTE_FIELDS_MAX, noteFieldValue, noteLabelKey, parseNoteForm, splitFactDate, splitNoteFacts, writeNoteField, type NoteFormPart } from './form';
import { NOTE_TEMPLATE_LABELS, NOTE_TEMPLATE_TEXT, NOTE_TEMPLATE_TITLE } from './template';

/**
 * How long a fill usually takes by the messages the hub served (prod, 2026-10-27, 73 fills of Opus 5.5 at high effort
 * with the trim pass: p50 19 s at ~90 messages, 35 s at ~380, 59 s at ~1 300, 87 s at ~3 000): the panel's «обычно ~N
 * с» and the pace of its bar while nothing of the answer has come yet. Linear between the points, flat outside them.
 */
const FILL_SECONDS: readonly (readonly [number, number])[] = [
  [90, 19],
  [380, 35],
  [1300, 59],
  [3000, 87],
];

export function fillEtaSeconds(messages: number): number {
  const first = FILL_SECONDS[0] as readonly [number, number];
  const last = FILL_SECONDS[FILL_SECONDS.length - 1] as readonly [number, number];
  if (messages <= first[0]) return first[1];
  if (messages >= last[0]) return last[1];
  for (let at = 1; at < FILL_SECONDS.length; at += 1) {
    const [x1, y1] = FILL_SECONDS[at] as readonly [number, number];
    const [x0, y0] = FILL_SECONDS[at - 1] as readonly [number, number];
    if (messages <= x1) return Math.round(y0 + ((messages - x0) * (y1 - y0)) / (x1 - x0));
  }
  return last[1];
}

/** «Всегда справа» follows the open chat only once the person stays on it this long (FS-NOTE-3). */
export const NOTES_FOLLOW_DELAY_MS = 700;
/** How long the last ✓ can be taken back («Записано: … · Отменить»). */
export const NOTES_UNDO_MS = 6000;
/** Chats whose notes a tab keeps; a shift opens fewer. */
const KEPT_CHATS = 300;

type Failure = { readonly ok: false; readonly error: CgAnyErrorWire };
type CustomName = { readonly noteId: string; readonly name: string };

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** «16.10» («16.10.2025» outside the current year) and the hover's day and time, in the chatter's clock (decision 171). */
export function noteDateVM(ms: number, now: number): NotesDateVM {
  const date = new Date(ms);
  const day = `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}`;
  const full = `${day}.${String(date.getFullYear())}`;
  return { day: date.getFullYear() === new Date(now).getFullYear() ? day : full, full, time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`, iso: date.toISOString() };
}

/**
 * A running fill's stage line (the Fansly extension: «Читаю переписку…», then «Заполняю анкету…»): the operation's phase
 * as the background last said it, the timer from the click. Its own words for the answer: a questionnaire is filled in.
 */
export function fillPhaseVM(startedAt: number, phase: Phase | null): PhaseVM {
  const name = phase?.name ?? 'admitted';
  const retryAt = name === 'retry-wait' ? (phase?.retryAt ?? null) : null;
  const context = { id: 'context', label: { key: 'result.stage.context' } } as const;
  const form = { id: 'writing', label: { key: 'result.stage.fillForm' } } as const;
  const parsing = { id: 'parsing', label: { key: 'result.stage.parsing' } } as const;
  const stages =
    name === 'parsing' || name === 'saving-profile' || name === 'settled'
      ? [{ ...context, state: 'done' as const }, { ...form, state: 'done' as const }, { ...parsing, state: 'current' as const }]
      : name === 'awaiting-first-chunk' || name === 'streaming'
        ? [{ ...context, state: 'done' as const }, { ...form, state: 'current' as const }]
        : [{ ...context, state: 'current' as const }];
  return { startedAt, stages, retryAt, cancel: null };
}

/** A suggestion as its row shows it: what kind, the pill's words, what goes, the fan's words; `arriving` — the answer
 * is still streaming. */
function suggestionVM(finding: NoteFinding, index: number, mark: Mark | 'arriving'): NotesSuggestionVM {
  const shape = noteSuggestion(finding);
  return {
    index,
    kind: shape.kind,
    base: shape.base,
    text: shape.text,
    date: shape.date,
    drops: shape.drops.map(splitFactDate),
    value: splitNoteFacts(finding.proposed)
      .map((fact) => splitFactDate(fact).text)
      .join('; '),
    quotes: finding.quotes,
    state: mark === 'arriving' ? 'arriving' : mark.state === 'conflict' ? 'conflict' : mark.state === 'saving' ? 'saving' : 'pending',
    now: mark !== 'arriving' && mark.state === 'conflict' ? mark.now : null,
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

/**
 * Where in the panel a write came from and the questionnaire labels it changed (never their values): the hub's record of
 * who wrote the note. Never a reason to refuse the write.
 */
export interface NoteWriteHow {
  readonly origin: NoteAttributionOrigin;
  readonly fields?: readonly string[];
}

/** A write's origin with its labels as the hub takes them: each cut to its limit, the same one once, at most so many. */
export function noteWriteHow(origin: NoteAttributionOrigin, labels: readonly string[] = []): NoteWriteHow {
  const fields = [...new Set(labels.map((label) => label.trim().slice(0, NOTE_ATTRIBUTION_LIMITS.fieldLabelMaxChars).trim()).filter((label) => label !== ''))].slice(0, NOTE_ATTRIBUTION_LIMITS.maxFields);
  return fields.length > 0 ? { origin, fields } : { origin };
}

export interface NotesPort {
  /** The tab's account and login: another one drops everything read and typed under the previous. */
  session(): string | null;
  target(): NotesTarget | null;
  read(target: NotesTarget, force: boolean): Promise<{ readonly ok: true; readonly fanRef: string; readonly notes: readonly FanslyNote[]; readonly customName: CustomName | null } | Failure>;
  create(who: NotesWho, title: string, text: string, how?: NoteWriteHow): Promise<{ readonly ok: true; readonly note: FanslyNote } | Failure>;
  /** A `changed` refusal carries `latest`, the version Fansly holds now (audit №13). */
  edit(who: NotesWho, noteId: string, title: string, text: string, current: Pick<FanslyNote, 'title' | 'text'>, how?: NoteWriteHow): Promise<{ readonly ok: true; readonly note: FanslyNote } | (Failure & { readonly latest?: FanslyNote | undefined })>;
  remove(who: NotesWho, note: FanslyNote, how?: NoteWriteHow): Promise<{ readonly ok: true } | Failure>;
  /** A `changed` refusal carries `latest`, the name Fansly holds now (null — none). */
  name(who: NotesWho, name: string, current: CustomName | null): Promise<{ readonly ok: true; readonly customName: CustomName | null } | (Failure & { readonly latest?: CustomName | null | undefined })>;
  /** The page's «Дополнить из чата» is on (the manifest's `notes-fill`: the page's `notesFill`). */
  fillAllowed(): boolean;
  /** Start `notes-fill` in the open chat with the questionnaire's labels and, index-aligned, their values (the owner's
   * ruling of 2026-10-17, X43: they go to the hub's request body and nowhere else, FS-NOTE-5); `view`
   * — the operation as read right after its admission: one that ended before (a reopened one) sends no `fansly.ops.done`. */
  fill(target: NotesTarget, fanId: string, fields: readonly string[], values: readonly string[]): Promise<{ readonly ok: true; readonly opId: string; readonly view: SiteOpView | null } | Failure>;
  /** «Остановить», «Отмена», a stopped start: the operation is cancelled, its answer never lands. */
  stopFill(opId: string): void;
  /** The person chose a view: the background stores it for every tab. */
  setView(view: FanslyNotesView): void;
  /** «Всегда справа» has room right of the chat. */
  fits(): boolean;
  /** Where the side panel stands now; null — no chat to stand beside. */
  place(): NotesPlace | null;
  setTimer(ms: number, run: () => void): unknown;
  clearTimer(handle: unknown): void;
  /** The chatter's clock (a note's date, decision 171); absent — `Date.now()`. */
  now?(): number;
  /** Who is signed in to the hub (the login): a free note's title. null or absent — the note goes untitled. */
  author?(): string | null;
}

interface Data {
  readonly fanRef: string;
  readonly notes: readonly FanslyNote[];
  readonly customName: CustomName | null;
}

type Entry = { readonly kind: 'loading'; readonly token: number } | { readonly kind: 'ready'; readonly data: Data } | { readonly kind: 'error'; readonly error: CgAnyErrorWire };

/** A note open as text. */
interface Draft {
  noteId: string | null;
  /** The version the next «Сохранить» writes over: the one opened, or Fansly's newer one once it was shown (audit №13). */
  current: Pick<FanslyNote, 'title' | 'text'>;
  title: string;
  text: string;
  saving: boolean;
  blocked: boolean;
  problem: NotesProblem | null;
}

/** A questionnaire's field open for typing: `opened` — its value when opened (unchanged — nothing is written). */
interface FieldEdit {
  readonly label: string;
  value: string;
  readonly opened: string;
  readonly blank: boolean;
  saving: boolean;
  blocked: boolean;
  problem: NotesProblem | null;
}

interface Quick {
  text: string;
  /** The title the last create sent: its author. */
  title?: string;
  saving: boolean;
  blocked: boolean;
  problem: NotesProblem | null;
}

/** A suggestion: waiting for ✓ or ×, its write in flight, written, put aside, or its field changed since the Goose
 * read it (`now` — the field's value now: «Заменить?»). */
type Mark = { readonly state: 'pending' } | { readonly state: 'saving' } | { readonly state: 'written' } | { readonly state: 'dismissed' } | { readonly state: 'conflict'; readonly now: string };

/** The last ✓ for a few seconds: the questionnaire before it (null — the ✓ created it) and after it. */
interface Undo {
  readonly before: string | null;
  readonly after: string;
  readonly noteId: string;
  readonly indices: readonly number[];
  readonly labels: readonly string[];
  readonly timer: unknown;
  undoing: boolean;
}

/** «✨ Заполнить из чата» of a fan's questionnaire: `base` — the text it was asked with (the template for none),
 * `blank` — the fan had no questionnaire. */
type Fill =
  | Running
  | Review
  | { readonly status: 'empty' }
  | { readonly status: 'failed'; readonly error: CgAnyErrorWire };

/**
 * A fill on its way: `asked` — the labels sent; `stream` — its answer so far (`op.update`), `parsed` — how much of it
 * was read into `live` (what is new in the fields answered) and `seen` (the fields answered, in order); `read` — the
 * messages the hub served to the model, once its `context_v1` came.
 */
interface Running {
  readonly status: 'running';
  opId: string | null;
  readonly startedAt: number;
  phase: Phase | null;
  readonly base: string;
  readonly blank: boolean;
  readonly asked: readonly string[];
  stream: string;
  seq: number;
  parsed: number;
  read: number | null;
  live: NoteFinding[];
  seen: string[];
}

/** The Goose's suggestions in the rows, each written by its ✓. */
interface Review {
  readonly status: 'review';
  readonly findings: readonly NoteFinding[];
  readonly marks: Mark[];
  readonly created: boolean;
  /** ✓ pressed while a write was in flight: written next, together. */
  queue: number[];
  /** «Заменить»: written over the field's value now. */
  readonly force: Map<number, string>;
  writing: boolean;
  blocked: boolean;
  problem: NotesProblem | null;
  undo: Undo | null;
  undoFailed: boolean;
}

/** A suggestion still on its row: waiting, in flight, or asking «Заменить?». */
const isOpen = (mark: Mark | undefined): boolean => mark?.state === 'pending' || mark?.state === 'saving' || mark?.state === 'conflict';
/** A fill whose suggestions still wait for the chatter. */
const waits = (fill: Fill | undefined): boolean => fill?.status === 'review' && fill.marks.some(isOpen);

interface NameState {
  readonly status: NotesNameStatus;
  readonly error: CgAnyErrorWire | null;
  /** The name changed elsewhere: Fansly's now (null — none). */
  readonly changed?: { readonly latest: string | null };
}

const NO_QUICK: Quick = { text: '', saving: false, blocked: false, problem: null };

const toFailure = (error: unknown): Failure => ({ ok: false, error: { code: 'CG-FAN-REQUEST', ...(error instanceof Error ? { detail: error.name } : {}) } });

/** The background's refusal of a write because the note (or the name) changed since it was read. */
const isChanged = (error: CgAnyErrorWire): boolean => error.code === 'CG-NOTE-WRITE' && error.detail === 'changed';

/** A newer version of a note in place of the one read: it keeps the creation time read when Fansly's answer gave none. */
const withTime = (fresh: FanslyNote, read: FanslyNote | undefined): FanslyNote => (fresh.createdAtMs !== undefined && fresh.createdAtMs !== null) || read?.createdAtMs === undefined || read.createdAtMs === null ? fresh : { ...fresh, createdAtMs: read.createdAtMs };

/** What a `changed` refusal carries: the version Fansly holds now; undefined — none was given. */
const latestOf = <T>(failure: Failure): T | undefined => (failure as Failure & { readonly latest?: T }).latest;

const sameName = (a: CustomName | null, b: CustomName | null): boolean => a?.noteId === b?.noteId && a?.name === b?.name;

/** A field's box as written: its facts one per line, blanks dropped. */
const factsOf = (value: string): string =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

const isField = (part: NoteFormPart): part is Extract<NoteFormPart, { kind: 'field' }> => part.kind === 'field';

export type NotesController = NotesClient & {
  /** The route, the account, the header changed: follow the open chat. */
  sync(): void;
  /** The stored view (the background's answer or its event). */
  applyView(view: FanslyNotesView): void;
  /** The page moved under the panel (a resize): re-place it, show or hide «Всегда справа». */
  layout(): void;
  /** The button or ⌘⇧K; false outside a one-to-one chat of the switch. */
  toggle(): boolean;
  /** A site operation ended (`fansly.ops.done`): a fill of this tab's lands in its fan's panel. */
  fillDone(view: SiteOpView): void;
  /** An operation moved (`op.update`): a running fill of this tab's says its stage, how much of the chat the model reads
   * and, as its answer streams, the fields answered so far and what is new in them. */
  fillUpdate(update: { readonly opId: string; readonly phase: Phase; readonly seq?: number | undefined; readonly append?: string | undefined; readonly served?: number | undefined }): void;
  dispose(): void;
};

export function createNotesController(port: NotesPort): NotesController {
  const listeners = new Set<() => void>();
  const entries = new Map<string, Entry>();
  const drafts = new Map<string, Draft>();
  const fields = new Map<string, FieldEdit>();
  const quicks = new Map<string, Quick>();
  const fills = new Map<string, Fill>();
  /** The running fills, by operation: whose questionnaire each one fills. */
  const fillOps = new Map<string, string>();
  /** The fields the last «Записать» wrote (label keys), by fan: marked until the panel closes. */
  const fresh = new Map<string, ReadonlySet<string>>();
  /** What the last «Записать» could not write, by fan: named until the panel closes. */
  const unplaced = new Map<string, readonly string[]>();
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
  /** The open chat's fan and the panel's place as last seen, for a panel kept while its chat is gone for a moment. */
  let held: { readonly groupId: string; readonly fan: NotesTarget['fan']; readonly place: NotesPlace | null } | null = null;
  let triggerVM: NotesTriggerVM | null = null;
  let shape = '';
  const now = (): number => port.now?.() ?? Date.now();
  /** A note's questionnaire, parsed once per note read (the panel builds on every keystroke). */
  const parsed = new WeakMap<FanslyNote, readonly NoteFormPart[] | null>();
  const partsOf = (note: FanslyNote): readonly NoteFormPart[] | null => {
    if (!parsed.has(note)) parsed.set(note, note.foreign ? null : parseNoteForm(note.text));
    return parsed.get(note) ?? null;
  };
  /** The fan's questionnaire: the first note that reads as one. */
  const formNote = (data: Data): FanslyNote | null => data.notes.find((note) => partsOf(note) !== null) ?? null;

  const target = (): NotesTarget | null => {
    const next = port.session();
    if (next !== session) {
      session = next;
      epoch += 1;
      entries.clear();
      drafts.clear();
      fields.clear();
      quicks.clear();
      for (const opId of fillOps.keys()) port.stopFill(opId);
      fillOps.clear();
      fills.clear();
      fresh.clear();
      unplaced.clear();
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
  const writing = (fanId: string): boolean => {
    const fill = fills.get(fanId);
    return (
      drafts.get(fanId)?.saving === true ||
      fields.get(fanId)?.saving === true ||
      quicks.get(fanId)?.saving === true ||
      (fill?.status === 'review' && (fill.writing || fill.undo?.undoing === true)) ||
      deleting?.fanId === fanId ||
      nameStates.get(fanId)?.status === 'saving'
    );
  };
  /** Something typed or found for this fan is not written yet: a moment without the chat never hides the panel. */
  const unsaved = (fanId: string): boolean => {
    const fill = fills.get(fanId);
    return drafts.has(fanId) || fields.has(fanId) || (quicks.get(fanId)?.text.trim() ?? '') !== '' || fill?.status === 'running' || waits(fill);
  };
  /** A fan's data in whichever kept chat holds it: a ✓ written after the chatter moved on still lands. */
  const dataOf = (fanId: string): Data | null => {
    for (const entry of entries.values()) if (entry.kind === 'ready' && entry.data.fanRef === fanId) return entry.data;
    return null;
  };
  /** Why «✨ Дополнить из чата» cannot start now. */
  const fillReason = (fanId: string, form: FanslyNote | null): 'editing' | 'writing' | null => {
    if (writing(fanId)) return 'writing';
    const draft = drafts.get(fanId);
    if (fields.has(fanId) || (draft !== undefined && form !== null && draft.noteId === form.noteId)) return 'editing';
    return null;
  };

  /** Where a running fill is: before the hub's first frame it collects the chat; then the model reads it (how many
   * messages, once `context_v1` said); with the first field answered it checks the questionnaire, field by field. */
  function progressVM(run: Running): NotesFillProgressVM {
    const after = run.phase !== null && run.phase.name !== 'admitted' && run.phase.name !== 'connecting' && run.phase.name !== 'awaiting-meta';
    const stage = run.seen.length > 0 ? 'check' : run.read !== null || after ? 'read' : 'gather';
    return {
      stage,
      read: run.read,
      eta: run.read === null ? null : fillEtaSeconds(run.read),
      checked: run.seen.length,
      total: run.asked.length,
      found: run.live.length,
      current: stage === 'check' ? (run.asked.find((label) => !run.seen.includes(label)) ?? null) : null,
    };
  }

  function formVM(fanId: string, data: Data): NotesFormVM {
    const note = formNote(data);
    const parts = note === null ? [] : (partsOf(note) ?? []);
    const marks = fresh.get(fanId);
    const own = parts.filter(isField);
    const present = new Set(own.map((field) => noteLabelKey(field.label)));
    // A template's field the questionnaire lacks is offered while it has room: past 30 fields it would read as a note.
    const room = Math.max(0, NOTE_FIELDS_MAX - own.length);
    const missing = NOTE_TEMPLATE_LABELS.filter((label) => !present.has(noteLabelKey(label))).slice(0, note === null ? undefined : room);
    const blank = [...own.filter((field) => field.facts.length === 0).map((field) => field.label), ...missing];
    const edit = fields.get(fanId);
    const fill = fills.get(fanId);
    const review = fill?.status === 'review' ? fill : null;
    const running = fill?.status === 'running' ? fill : null;
    const locked = note?.cut === true;
    // The suggestions still on their rows, by field; while the answer streams, what it found so far.
    const suggested = new Map<string, { readonly label: string; readonly vm: NotesSuggestionVM }>();
    review?.findings.forEach((finding, index) => {
      const mark = review.marks[index];
      if (mark !== undefined && isOpen(mark)) suggested.set(noteLabelKey(finding.label), { label: finding.label, vm: suggestionVM(finding, index, mark) });
    });
    running?.live.forEach((finding, index) => suggested.set(noteLabelKey(finding.label), { label: finding.label, vm: suggestionVM(finding, index, 'arriving') }));
    const suggestedKeys = new Set(suggested.keys());
    const progress = running === null ? null : progressVM(running);
    const seenKeys = new Set(running?.seen.map(noteLabelKey) ?? []);
    const currentKey = progress?.current === null || progress?.current === undefined ? null : noteLabelKey(progress.current);
    const shown: NotesFormPartVM[] = [];
    let lastField = -1;
    for (const part of parts) {
      if (part.kind === 'text') {
        shown.push({ kind: 'text', text: part.text });
        continue;
      }
      const key = noteLabelKey(part.label);
      const suggestion = suggested.get(key)?.vm;
      suggested.delete(key);
      if (part.facts.length === 0 && suggestion === undefined) continue;
      shown.push({
        kind: 'field',
        label: part.label,
        facts: part.facts.map(splitFactDate),
        ...(marks?.has(key) === true ? { fresh: true } : {}),
        ...(suggestion === undefined ? {} : { suggestion }),
        ...(part.facts.length === 0 ? { ghost: true } : {}),
        ...(key === currentKey ? { current: true } : {}),
        ...(suggestion === undefined && seenKeys.has(key) ? { seen: true } : {}),
      });
      lastField = shown.length - 1;
    }
    // The fields the questionnaire lacks: after its last field, where ✓ puts their lines.
    const tail: NotesFormPartVM[] = [...suggested.values()].map(({ label, vm }) => ({ kind: 'field', label, facts: [], suggestion: vm, ghost: true }));
    shown.splice(lastField + 1, 0, ...tail);
    const count = (state: Mark['state']): number => review?.marks.filter((mark) => mark.state === state).length ?? 0;
    const fillVM: NotesFillVM | null =
      locked || (!port.fillAllowed() && fill === undefined)
        ? null
        : {
            status: fill === undefined ? 'idle' : fill.status === 'review' ? (waits(fill) ? 'review' : 'done') : fill.status,
            reason: fillReason(fanId, note),
            phase: fill?.status === 'running' ? fillPhaseVM(fill.startedAt, fill.phase) : null,
            progress,
            error: fill?.status === 'failed' ? fill.error : null,
            pending: count('pending') + count('conflict'),
            written: count('written'),
            dismissed: count('dismissed'),
            unfound: review === null ? [] : blank.filter((label) => !review.findings.some((finding) => noteLabelKey(finding.label) === noteLabelKey(label))),
            created: review?.created ?? false,
            saving: review?.writing ?? false,
            blocked: review?.blocked ?? false,
            problem: review?.problem ?? null,
            undo: review?.undo === null || review?.undo === undefined ? null : { labels: review.undo.labels, undoing: review.undo.undoing },
            undoFailed: review?.undoFailed ?? false,
          };
    return {
      noteId: note?.noteId ?? null,
      title: note?.title ?? NOTE_TEMPLATE_TITLE,
      parts: shown,
      // A field waiting on its suggestion (or one arriving) is a row now, not a «+ Метка».
      blank: blank.filter((label) => !suggestedKeys.has(noteLabelKey(label))),
      locked,
      field: edit === undefined ? null : { label: edit.label, value: edit.value, blank: edit.blank, saving: edit.saving, blocked: edit.blocked, problem: edit.problem },
      fill: fillVM,
      unplaced: unplaced.get(fanId) ?? [],
    };
  }

  function itemsVM(data: Data, form: FanslyNote | null): NotesItemVM[] {
    const at = (note: FanslyNote): number => note.createdAtMs ?? -1;
    // Newest first; a note Fansly gave no time keeps its place after the dated ones.
    return data.notes
      .filter((note) => note !== form)
      .map((note, index) => ({ note, index }))
      .sort((a, b) => at(b.note) - at(a.note) || a.index - b.index)
      .map(({ note }) => ({
        noteId: note.noteId,
        title: note.title,
        text: note.text,
        date: note.createdAtMs === undefined || note.createdAtMs === null ? null : noteDateVM(note.createdAtMs, now()),
        foreign: note.foreign,
        cut: note.cut === true,
      }));
  }

  function build(): void {
    const t = port.target();
    const shown = visible();
    const seen = shown && view !== 'center' ? port.place() : null;
    // A panel kept over a moment without its chat (an unsaved edit, `sync`) keeps who it is about and where it stood.
    if (t !== null && t.groupId === groupId) held = { groupId: t.groupId, fan: t.fan, place: seen ?? (held?.groupId === t.groupId ? held.place : null) };
    const kept = t === null && held !== null && held.groupId === groupId ? held : null;
    const entry = groupId === null ? undefined : entries.get(groupId);
    const data = entry?.kind === 'ready' ? entry.data : null;
    const fanId = data?.fanRef ?? null;
    const draft = fanId === null ? undefined : drafts.get(fanId);
    const name = fanId === null ? undefined : nameStates.get(fanId);
    const narrow = view === 'docked' && !port.fits();
    const form = data === null ? null : formNote(data);
    panelVM = {
      shown,
      view,
      narrow,
      place: shown && view !== 'center' ? (seen ?? kept?.place ?? null) : null,
      fan: t?.fan ?? kept?.fan ?? null,
      body: entry === undefined || entry.kind === 'loading' ? 'loading' : entry.kind,
      error: entry?.kind === 'error' ? entry.error : null,
      name: { value: (fanId === null ? undefined : nameDrafts.get(fanId)?.value) ?? data?.customName?.name ?? '', status: name?.status ?? 'idle', error: name?.error ?? null, ...(name?.changed === undefined ? {} : { changed: name.changed }) },
      form: data === null || fanId === null ? null : formVM(fanId, data),
      items: data === null ? [] : itemsVM(data, form),
      quick: (fanId === null ? undefined : quicks.get(fanId)) ?? NO_QUICK,
      editor: draft === undefined ? null : { noteId: draft.noteId, title: draft.title, text: draft.text, saving: draft.saving, blocked: draft.blocked, problem: draft.problem },
      confirmDelete: confirm !== null && confirm.fanId === fanId ? confirm.noteId : null,
      deleting: deleting !== null && deleting.fanId === fanId ? deleting.noteId : null,
      deleteError: deleteError !== null && deleteError.fanId === fanId ? deleteError.error : null,
      writing: fanId !== null && writing(fanId),
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
      afterReread(answer.fanRef, answer.notes, answer.customName);
    } else entries.set(group, { kind: 'error', error: answer.error });
    while (entries.size > KEPT_CHATS) entries.delete(entries.keys().next().value as string);
    emit();
  }

  /**
   * A fresh read answers what an unconfirmed write could not: the person now sees whether it landed, so a create may
   * go out again (a quick note that landed leaves its box). A draft of a note deleted elsewhere becomes a new note
   * instead of an editor of nothing. A note changed elsewhere since its editor opened is shown as Fansly holds it now,
   * and the next «Сохранить» writes the draft over it (audit №13); one that already holds the draft closes as saved.
   */
  function afterReread(fanId: string, notes: readonly FanslyNote[], customName: CustomName | null): void {
    const draft = drafts.get(fanId);
    if (draft !== undefined && !draft.saving) {
      draft.blocked = false;
      const latest = draft.noteId === null ? undefined : notes.find((note) => note.noteId === draft.noteId);
      if (draft.noteId !== null && latest === undefined) {
        draft.noteId = null;
        draft.problem = { kind: 'deleted' };
      } else if (latest !== undefined && (latest.title !== draft.current.title || latest.text !== draft.current.text)) {
        if (latest.title === draft.title.trim() && latest.text === draft.text.trimEnd()) drafts.delete(fanId);
        else showLatest(draft, latest);
      } else if (draft.problem?.kind === 'failed') draft.problem = null;
    }
    const field = fields.get(fanId);
    if (field !== undefined && !field.saving) {
      field.blocked = false;
      if (field.problem?.kind === 'failed' || field.problem?.kind === 'changed' || field.problem?.kind === 'deleted') field.problem = null;
    }
    const quick = quicks.get(fanId);
    if (quick !== undefined && !quick.saving) {
      // A note that landed although its answer was lost: the box is done with it.
      if (quick.blocked && notes.some((note) => note.title === (quick.title ?? '') && note.text === quick.text.trim())) quicks.delete(fanId);
      else {
        quick.blocked = false;
        if (quick.problem?.kind === 'failed') quick.problem = null;
      }
    }
    const fill = fills.get(fanId);
    if (fill?.status === 'review' && !fill.writing) {
      fill.blocked = false;
      if (fill.problem?.kind === 'failed' || fill.problem?.kind === 'changed' || fill.problem?.kind === 'deleted') fill.problem = null;
    }
    if (nameStates.get(fanId)?.status === 'unconfirmed') nameStates.delete(fanId);
    const typed = nameDrafts.get(fanId);
    if (typed !== undefined && nameStates.get(fanId)?.status !== 'saving' && !sameName(typed.current, customName)) nameChanged(fanId, typed.value, customName);
  }

  /** Fansly holds a newer version than the draft was opened on: shown, and the one the next «Сохранить» writes over. */
  function showLatest(draft: Draft, latest: FanslyNote): void {
    draft.current = { title: latest.title, text: latest.text };
    draft.problem = { kind: 'changed', latest: { title: latest.title, text: latest.text } };
  }

  /** The name changed elsewhere: the typed one stays, the next Enter writes it over Fansly's (Esc keeps Fansly's). */
  function nameChanged(fanId: string, value: string, latest: CustomName | null): void {
    nameDrafts.set(fanId, { value, current: latest });
    nameStates.set(fanId, { status: 'error', error: null, changed: { latest: latest?.name ?? null } });
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
    // A panel with something not written stays while no other chat takes its place (the header re-drawn, the context
    // read again): what was typed is never hidden by a moment of the page. Another chat follows as always; it waits.
    const data = current();
    if (next === null && groupId !== null && data !== null && unsaved(data.fanRef)) {
      update('follow');
      return;
    }
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
    if (!visible()) forget();
    update('now');
    return true;
  }

  /** The panel put away: the ✦ marks and the done line are over, and so is the last ✓'s «Отменить». Suggestions still
   * waiting stay for the next time the panel opens. */
  function forget(): void {
    fresh.clear();
    unplaced.clear();
    for (const [fanId, fill] of fills) {
      if (fill.status !== 'review') continue;
      if (fill.undo !== null && !fill.undo.undoing) {
        port.clearTimer(fill.undo.timer);
        fill.undo = null;
      }
      fill.undoFailed = false;
      if (!waits(fill) && !fill.writing && fill.undo === null) fills.delete(fanId);
    }
  }

  function close(): void {
    if (view === 'docked') {
      narrowOpen = false;
      if (port.fits()) wanted = false;
    } else wanted = false;
    forget();
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

  /** A note written: in place of the one read (keeping its time: Fansly answers an edit without it, decision 170), or
   * added — «now» until a reread brings Fansly's time (decision 171). */
  function saved(fanId: string, note: FanslyNote): void {
    patch(fanId, (d) => {
      const read = d.notes.find((entry) => entry.noteId === note.noteId);
      if (read !== undefined) return { ...d, notes: d.notes.map((entry) => (entry.noteId === note.noteId ? withTime(note, read) : entry)) };
      return { ...d, notes: [...d.notes, note.createdAtMs !== undefined && note.createdAtMs !== null ? note : { ...note, createdAtMs: now() }] };
    });
  }

  /** Fansly's version of a note now, in the list (a `changed` refusal brought it). */
  function replaced(fanId: string, latest: FanslyNote): void {
    patch(fanId, (d) => ({ ...d, notes: d.notes.map((note) => (note.noteId === latest.noteId ? withTime(latest, note) : note)) }));
  }

  function dropped(fanId: string, noteId: string): void {
    patch(fanId, (d) => ({ ...d, notes: d.notes.filter((note) => note.noteId !== noteId) }));
  }

  const who = (data: Data): NotesWho | null => {
    const t = port.target();
    return t === null ? null : { accountId: t.accountId, fanId: data.fanRef };
  };

  function startDraft(noteId: string, title: string, text: string): void {
    const data = current();
    if (data === null || drafts.has(data.fanRef)) return;
    confirm = null;
    drafts.set(data.fanRef, { noteId, current: { title, text }, title, text, saving: false, blocked: false, problem: null });
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
    const answer = await (draft.noteId === null ? port.create(to, title, text, noteWriteHow('editor')) : port.edit(to, draft.noteId, title, text, draft.current, noteWriteHow('editor'))).catch(toFailure);
    if (disposed || under !== epoch || drafts.get(data.fanRef) !== draft) return;
    draft.saving = false;
    if (answer.ok) {
      saved(data.fanRef, answer.note);
      drafts.delete(data.fanRef);
    } else if (draft.noteId !== null && isChanged(answer.error) && latestOf<FanslyNote>(answer) !== undefined) {
      // Changed elsewhere (audit №13): Fansly's version now, in the list and under the draft; «Сохранить» again writes over it.
      const latest = latestOf<FanslyNote>(answer) as FanslyNote;
      showLatest(draft, latest);
      replaced(data.fanRef, latest);
    } else if (draft.noteId !== null && isChanged(answer.error)) {
      // Changed with no version to show: the note is gone in Fansly — the draft becomes a new note, as after a reread.
      const gone = draft.noteId;
      draft.noteId = null;
      draft.problem = { kind: 'deleted' };
      dropped(data.fanRef, gone);
    } else {
      // A create may have landed: another one now could make a duplicate.
      if (draft.noteId === null) draft.blocked = true;
      draft.problem = { kind: 'failed', error: answer.error, created: draft.noteId === null };
    }
    emit();
  }

  /**
   * Write a questionnaire's new text: an edit of the one Fansly held when read, or — the fan has none — a create of
   * «Анкета». `onto` — the note as read. On a `changed` refusal the list takes Fansly's version, and the caller's next
   * press writes into it.
   */
  async function writeForm(data: Data, to: NotesWho, onto: FanslyNote | null, text: string, how: NoteWriteHow): Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: NotesProblem; readonly blocked: boolean }> {
    const answer = await (onto === null ? port.create(to, NOTE_TEMPLATE_TITLE, text, how) : port.edit(to, onto.noteId, onto.title, text, { title: onto.title, text: onto.text }, how)).catch(toFailure);
    if (answer.ok) {
      saved(data.fanRef, answer.note);
      return { ok: true };
    }
    if (onto !== null && isChanged(answer.error)) {
      const latest = latestOf<FanslyNote>(answer);
      if (latest !== undefined) {
        replaced(data.fanRef, latest);
        return { ok: false, problem: { kind: 'changed', latest: { title: latest.title, text: latest.text } }, blocked: false };
      }
      dropped(data.fanRef, onto.noteId);
      return { ok: false, problem: { kind: 'deleted' }, blocked: false };
    }
    // A create may have landed: another one now could make a second questionnaire.
    return { ok: false, problem: { kind: 'failed', error: answer.error, created: onto === null }, blocked: onto === null };
  }

  function openField(label: string): void {
    const data = current();
    if (data === null) return;
    const fanId = data.fanRef;
    const note = formNote(data);
    const fill = fills.get(fanId);
    const draft = drafts.get(fanId);
    // A field with the Goose's suggestion on it waits for ✓ or × first.
    const suggested = fill?.status === 'review' && fill.findings.some((finding, index) => isOpen(fill.marks[index]) && noteLabelKey(finding.label) === noteLabelKey(label));
    if (note?.cut === true || fill?.status === 'running' || suggested || (draft !== undefined && note !== null && draft.noteId === note.noteId)) return;
    const open = fields.get(fanId);
    if (open !== undefined && (open.saving || noteLabelKey(open.label) === noteLabelKey(label) || factsOf(open.value) !== factsOf(open.opened))) return;
    const field = (note === null ? [] : (partsOf(note) ?? [])).filter(isField).find((part) => noteLabelKey(part.label) === noteLabelKey(label));
    // A template's field the questionnaire lacks, past its room, is no field to open.
    if (field === undefined && !NOTE_TEMPLATE_LABELS.some((entry) => noteLabelKey(entry) === noteLabelKey(label))) return;
    const value = field?.facts.join('\n') ?? '';
    confirm = null;
    fields.set(fanId, { label: field?.label ?? label, value, opened: value, blank: value === '', saving: false, blocked: false, problem: null });
    emit();
  }

  async function saveField(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    if (data === null || to === null) return;
    const fanId = data.fanRef;
    const edit = fields.get(fanId);
    if (edit === undefined || edit.saving || edit.blocked) return;
    const note = formNote(data);
    if (note?.cut === true) return;
    // Unchanged: nothing to write (a field's lines under it would otherwise be joined into its line for nothing).
    if (factsOf(edit.value) === factsOf(edit.opened) && edit.problem === null) {
      fields.delete(fanId);
      return emit();
    }
    const base = note?.text ?? NOTE_TEMPLATE_TEXT;
    const own = note === null ? [] : (partsOf(note) ?? []).filter(isField);
    const has = own.some((part) => noteLabelKey(part.label) === noteLabelKey(edit.label));
    if (!has && note !== null && own.length >= NOTE_FIELDS_MAX) return;
    const text = writeNoteField(base, edit.label, edit.value.split('\n'));
    if (text === base) {
      fields.delete(fanId);
      return emit();
    }
    if (text.length > FANSLY_TAB_LIMITS.noteTextMaxChars) {
      edit.problem = { kind: 'too-long' };
      return emit();
    }
    edit.saving = true;
    edit.problem = null;
    emit();
    const under = epoch;
    const answer = await writeForm(data, to, note, text, noteWriteHow('field', [edit.label]));
    if (disposed || under !== epoch || fields.get(fanId) !== edit) return;
    edit.saving = false;
    if (answer.ok) fields.delete(fanId);
    else {
      edit.problem = answer.problem;
      edit.blocked = answer.blocked;
    }
    emit();
  }

  async function saveQuick(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    if (data === null || to === null) return;
    const fanId = data.fanRef;
    const quick = quicks.get(fanId);
    if (quick === undefined || quick.saving || quick.blocked) return;
    const text = quick.text.trim();
    if (text === '') return;
    if (text.length > FANSLY_TAB_LIMITS.noteTextMaxChars) {
      quick.problem = { kind: 'too-long' };
      return emit();
    }
    const title = (port.author?.() ?? '').trim().slice(0, FANSLY_TAB_LIMITS.noteTitleMaxChars);
    quick.saving = true;
    quick.title = title;
    quick.problem = null;
    emit();
    const under = epoch;
    const answer = await port.create(to, title, text, noteWriteHow('quick')).catch(toFailure);
    if (disposed || under !== epoch || quicks.get(fanId) !== quick) return;
    quick.saving = false;
    if (answer.ok) {
      saved(fanId, answer.note);
      quicks.delete(fanId);
    } else {
      // It may have landed: another Enter now could make a duplicate.
      quick.blocked = true;
      quick.problem = { kind: 'failed', error: answer.error, created: true };
    }
    emit();
  }

  async function remove(): Promise<void> {
    const data = current();
    const to = data === null ? null : who(data);
    const asked = confirm;
    if (data === null || to === null || asked === null || deleting !== null || asked.fanId !== data.fanRef) return;
    const note = data.notes.find((entry) => entry.noteId === asked.noteId);
    // A cut note's delete would send Fansly a text that is not the note's: deleted in Fansly's window only.
    if (note === undefined || note.foreign || note.cut === true) return;
    deleting = asked;
    deleteError = null;
    emit();
    const under = epoch;
    const answer = await port.remove(to, note, noteWriteHow('list')).catch(toFailure);
    if (disposed || under !== epoch) return;
    deleting = null;
    if (answer.ok) {
      dropped(asked.fanId, note.noteId);
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
      const done = answer.customName;
      patch(fanId, (d) => ({ ...d, customName: done }));
      nameDrafts.delete(fanId);
      nameStates.set(fanId, { status: 'saved', error: null });
    } else if (isChanged(answer.error) && latestOf<CustomName | null>(answer) !== undefined) {
      const latest = latestOf<CustomName | null>(answer) as CustomName | null;
      patch(fanId, (d) => ({ ...d, customName: latest }));
      nameChanged(fanId, typed.value, latest);
    } else nameStates.set(fanId, { status: answer.error.code === 'CG-NOTE-UNCERTAIN' ? 'unconfirmed' : 'error', error: answer.error });
    emit();
  }

  async function startFill(): Promise<void> {
    const data = current();
    const t = port.target();
    if (data === null || t === null || !port.fillAllowed()) return;
    const fanId = data.fanRef;
    const note = formNote(data);
    const was = fills.get(fanId);
    if (note?.cut === true || was?.status === 'running' || waits(was) || (was?.status === 'review' && was.writing) || fillReason(fanId, note) !== null) return;
    const base = note?.text ?? NOTE_TEMPLATE_TEXT;
    const asked = noteFillRequest(base);
    if (asked === null) return;
    if (was?.status === 'review' && was.undo !== null) port.clearTimer(was.undo.timer);
    const run: Running = { status: 'running', opId: null, startedAt: now(), phase: null, base, blank: note === null, asked: asked.fields, stream: '', seq: 0, parsed: 0, read: null, live: [], seen: [] };
    fills.set(fanId, run);
    fresh.delete(fanId);
    unplaced.delete(fanId);
    confirm = null;
    emit();
    const under = epoch;
    const answer = await port.fill(t, fanId, asked.fields, asked.values).catch(toFailure);
    if (disposed || under !== epoch || fills.get(fanId) !== run) {
      // Stopped or gone while the start was on its way: its operation is not wanted.
      if (answer.ok) port.stopFill(answer.opId);
      return;
    }
    if (!answer.ok) {
      fills.set(fanId, { status: 'failed', error: answer.error });
      return emit();
    }
    run.opId = answer.opId;
    fillOps.set(answer.opId, fanId);
    if (answer.view !== null) run.phase = answer.view.phase;
    const state = answer.view?.state;
    if (answer.view !== null && state !== 'admitted' && state !== 'requesting' && state !== 'streaming') return fillDone(answer.view);
    emit();
  }

  function stopFill(fanId: string): void {
    const fill = fills.get(fanId);
    if (fill?.status === 'running' && fill.opId !== null) {
      fillOps.delete(fill.opId);
      port.stopFill(fill.opId);
    }
    if (fill?.status === 'review') {
      if (fill.writing || fill.undo?.undoing === true) return;
      if (fill.undo !== null) port.clearTimer(fill.undo.timer);
    }
    fills.delete(fanId);
  }

  function fillDone(done: SiteOpView): void {
    if (disposed || done.feature !== 'notes-fill') return;
    // Another tab's, or one this tab no longer waits for.
    const fanId = fillOps.get(done.opId);
    if (fanId === undefined) return;
    fillOps.delete(done.opId);
    const run = fills.get(fanId);
    if (run?.status !== 'running' || run.opId !== done.opId) return;
    if (done.state === 'done' && done.result?.kind === 'note-fields') {
      const found = noteFindings(run.base, done.result.fields, done.result.proposed ?? []);
      fills.set(
        fanId,
        found.length === 0
          ? { status: 'empty' }
          : { status: 'review', findings: found, marks: found.map(() => ({ state: 'pending' })), created: run.blank, queue: [], force: new Map(), writing: false, blocked: false, problem: null, undo: null, undoFailed: false },
      );
    } else if (done.state === 'canceled') fills.delete(fanId);
    else fills.set(fanId, { status: 'failed', error: done.error ?? { code: 'CG-OUTPUT-UNUSABLE' } });
    emit();
  }

  function fillUpdate(update: { readonly opId: string; readonly phase: Phase; readonly seq?: number | undefined; readonly append?: string | undefined; readonly served?: number | undefined }): void {
    const fanId = fillOps.get(update.opId);
    const fill = fanId === undefined ? undefined : fills.get(fanId);
    if (disposed || fill?.status !== 'running' || fill.opId !== update.opId) return;
    let moved = false;
    if (fill.phase?.name !== update.phase.name || fill.phase.retryAt !== update.phase.retryAt) {
      fill.phase = update.phase;
      moved = true;
    }
    if (update.served !== undefined && update.served !== fill.read) {
      fill.read = update.served;
      moved = true;
    }
    const seq = update.seq ?? fill.seq + 1;
    if (update.append !== undefined && update.append !== '' && seq > fill.seq) {
      fill.seq = seq;
      fill.stream += update.append;
      // Whole lines only: a line half written would read as a cut value.
      const whole = fill.stream.slice(0, fill.stream.lastIndexOf('\n') + 1);
      if (whole.length !== fill.parsed) {
        fill.parsed = whole.length;
        const answer = parseNoteFillAnswer(whole, fill.asked);
        fill.live = answer === null ? [] : noteFindings(fill.base, answer.fields, answer.proposed ?? []);
        fill.seen = noteFillSeen(whole, fill.asked);
        moved = true;
      }
    }
    if (moved) emit();
  }

  /**
   * ✓ or «Принять все»: the suggestions are written at once, in one edit of the questionnaire as Fansly holds it now
   * (or its create). One pressed while a write is in flight waits and joins the next.
   */
  function accept(fanId: string, indices: readonly number[]): void {
    const fill = fills.get(fanId);
    if (fill?.status !== 'review' || fill.blocked) return;
    const picked = indices.filter((index) => fill.marks[index]?.state === 'pending' || (fill.marks[index]?.state === 'conflict' && fill.force.has(index)));
    if (picked.length === 0) return;
    for (const index of picked) fill.marks[index] = { state: 'saving' };
    fill.undoFailed = false;
    // Another write of this questionnaire (a field typed) is fine: a `changed` refusal sends the ✓ into the newer version.
    if (fill.writing || fill.undo?.undoing === true) {
      fill.queue.push(...picked);
      return emit();
    }
    void writeSuggestions(fanId, fill, picked, false);
  }

  /** The chosen suggestions into the questionnaire: a field changed since the Goose read it asks «Заменить?» instead. */
  async function writeSuggestions(fanId: string, fill: Review, picked: readonly number[], retried: boolean): Promise<void> {
    const data = dataOf(fanId);
    const to = data === null ? null : who(data);
    const note = data === null ? null : formNote(data);
    if (data === null || to === null || note?.cut === true) {
      for (const index of picked) fill.marks[index] = { state: 'pending' };
      return settle(fanId, fill);
    }
    const base = note?.text ?? NOTE_TEMPLATE_TEXT;
    const chosen = picked.map((index): NoteFinding => {
      const finding = fill.findings[index] as NoteFinding;
      const over = fill.force.get(index);
      return over === undefined ? finding : { ...finding, current: over };
    });
    const applied = applyNoteFindings(base, chosen);
    const skipped = new Set(applied.skipped.map(noteLabelKey));
    const homeless = new Set(applied.unplaced.map(noteLabelKey));
    const going: number[] = [];
    for (const index of picked) {
      const finding = fill.findings[index] as NoteFinding;
      const key = noteLabelKey(finding.label);
      if (skipped.has(key)) fill.marks[index] = { state: 'conflict', now: noteFieldValue(base, finding.label) ?? '' };
      else if (homeless.has(key)) {
        fill.marks[index] = { state: 'dismissed' };
        unplaced.set(fanId, [...(unplaced.get(fanId) ?? []), finding.label]);
      } else going.push(index);
    }
    if (going.length === 0) return settle(fanId, fill);
    if (applied.text === base) {
      // Already there (the same value written meanwhile): nothing to write.
      for (const index of going) fill.marks[index] = { state: 'written' };
      return settle(fanId, fill);
    }
    if (applied.text.length > FANSLY_TAB_LIMITS.noteTextMaxChars) {
      for (const index of going) fill.marks[index] = { state: 'pending' };
      fill.problem = { kind: 'too-long' };
      return settle(fanId, fill);
    }
    if (fill.undo !== null) {
      port.clearTimer(fill.undo.timer);
      fill.undo = null;
    }
    fill.writing = true;
    fill.problem = null;
    emit();
    const under = epoch;
    const answer = await writeForm(data, to, note, applied.text, noteWriteHow('fill', going.map((index) => fill.findings[index]?.label ?? '')));
    if (disposed || under !== epoch || fills.get(fanId) !== fill) return;
    fill.writing = false;
    if (answer.ok) {
      for (const index of going) {
        fill.marks[index] = { state: 'written' };
        fill.force.delete(index);
      }
      fresh.set(fanId, new Set([...(fresh.get(fanId) ?? []), ...applied.wrote.map(noteLabelKey)]));
      const written = formNote(dataOf(fanId) ?? data);
      if (written !== null) {
        const undo: Undo = { before: note === null ? null : base, after: applied.text, noteId: written.noteId, indices: going, labels: going.map((index) => fill.findings[index]?.label ?? ''), timer: null, undoing: false };
        fill.undo = { ...undo, timer: port.setTimer(NOTES_UNDO_MS, () => expireUndo(fanId, fill)) };
      }
    } else if (answer.problem.kind === 'changed' && !retried) {
      // Fansly's newer version is in the list now: the same ✓ goes into it, once, still never over a changed field.
      return writeSuggestions(fanId, fill, going, true);
    } else {
      for (const index of going) fill.marks[index] = { state: 'pending' };
      fill.problem = answer.problem;
      fill.blocked = answer.blocked;
    }
    settle(fanId, fill);
  }

  /** After a write: the next waiting ✓, or — nothing waits and nothing was written — the fill is over. */
  function settle(fanId: string, fill: Review): void {
    if (fills.get(fanId) !== fill) return emit();
    if (!fill.writing && fill.undo?.undoing !== true && fill.queue.length > 0 && !fill.blocked) {
      const next = fill.queue.splice(0).filter((index) => fill.marks[index]?.state === 'saving');
      if (next.length > 0) {
        void writeSuggestions(fanId, fill, next, false);
        return;
      }
    }
    if (fill.blocked) {
      for (const index of fill.queue.splice(0)) if (fill.marks[index]?.state === 'saving') fill.marks[index] = { state: 'pending' };
    }
    if (!waits(fill) && !fill.writing && fill.undo === null && !fill.marks.some((mark) => mark.state === 'written')) fills.delete(fanId);
    emit();
  }

  function expireUndo(fanId: string, fill: Review): void {
    if (disposed || fills.get(fanId) !== fill || fill.undo === null || fill.undo.undoing) return;
    fill.undo = null;
    if (!waits(fill) && !fill.writing && !fill.marks.some((mark) => mark.state === 'written')) fills.delete(fanId);
    emit();
  }

  /** «Отменить» of the last ✓: the questionnaire as it was before it (the one it created is deleted), its suggestions
   * waiting again. Not over a change made since: that would wipe it. */
  async function undoLast(fanId: string): Promise<void> {
    const fill = fills.get(fanId);
    const data = dataOf(fanId);
    const to = data === null ? null : who(data);
    if (fill?.status !== 'review' || fill.undo === null || fill.undo.undoing || fill.writing || data === null || to === null) return;
    const undo = fill.undo;
    port.clearTimer(undo.timer);
    const note = formNote(data);
    if (note === null || note.noteId !== undo.noteId || note.text !== undo.after) {
      fill.undo = null;
      fill.undoFailed = true;
      return settle(fanId, fill);
    }
    undo.undoing = true;
    emit();
    const under = epoch;
    const undoHow = noteWriteHow('undo', undo.labels);
    const answer = undo.before === null ? await port.remove(to, note, undoHow).catch(toFailure) : await writeForm(data, to, note, undo.before, undoHow);
    if (disposed || under !== epoch || fills.get(fanId) !== fill) return;
    undo.undoing = false;
    fill.undo = null;
    if (answer.ok) {
      if (undo.before === null) dropped(fanId, note.noteId);
      for (const index of undo.indices) fill.marks[index] = { state: 'pending' };
      const back = new Set(undo.labels.map(noteLabelKey));
      fresh.set(fanId, new Set([...(fresh.get(fanId) ?? [])].filter((key) => !back.has(key))));
    } else fill.undoFailed = true;
    settle(fanId, fill);
  }

  function dispatch(action: NotesAction): void {
    if (disposed) return;
    const data = current();
    const fanId = data?.fanRef ?? null;
    const draft = fanId === null ? undefined : drafts.get(fanId);
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
      case 'field-open':
        return openField(action.label);
      case 'field-input': {
        const edit = fanId === null ? undefined : fields.get(fanId);
        if (edit === undefined || edit.saving) return;
        edit.value = action.value;
        if (edit.problem?.kind === 'too-long') edit.problem = null;
        return emit();
      }
      case 'field-save':
        void saveField();
        return;
      case 'field-cancel': {
        const edit = fanId === null ? undefined : fields.get(fanId);
        if (fanId === null || edit === undefined || edit.saving) return;
        fields.delete(fanId);
        return emit();
      }
      case 'fill':
        void startFill();
        return;
      case 'fill-stop':
        if (fanId === null || fills.get(fanId)?.status !== 'running') return;
        stopFill(fanId);
        return emit();
      case 'suggestion-accept':
        if (fanId !== null) accept(fanId, [action.index]);
        return;
      case 'suggestion-replace': {
        const fill = fanId === null ? undefined : fills.get(fanId);
        const mark = fill?.status === 'review' ? fill.marks[action.index] : undefined;
        if (fanId === null || fill?.status !== 'review' || mark?.state !== 'conflict') return;
        fill.force.set(action.index, mark.now);
        accept(fanId, [action.index]);
        return;
      }
      case 'suggestions-accept-all': {
        const fill = fanId === null ? undefined : fills.get(fanId);
        if (fanId === null || fill?.status !== 'review') return;
        accept(
          fanId,
          fill.marks.flatMap((mark, index) => (mark.state === 'pending' ? [index] : [])),
        );
        return;
      }
      case 'suggestion-dismiss':
      case 'suggestions-dismiss-all': {
        const fill = fanId === null ? undefined : fills.get(fanId);
        if (fanId === null || fill?.status !== 'review') return;
        fill.marks.forEach((mark, index) => {
          if ((action.type === 'suggestions-dismiss-all' || index === action.index) && (mark.state === 'pending' || mark.state === 'conflict')) {
            fill.marks[index] = { state: 'dismissed' };
            fill.force.delete(index);
          }
        });
        return settle(fanId, fill);
      }
      case 'suggestion-undo':
        if (fanId !== null) void undoLast(fanId);
        return;
      case 'fill-close':
        if (fanId === null || fills.get(fanId) === undefined) return;
        stopFill(fanId);
        return emit();
      case 'quick-input': {
        if (fanId === null) return;
        const quick = quicks.get(fanId) ?? { ...NO_QUICK };
        if (quick.saving) return;
        quick.text = action.text;
        if (quick.problem?.kind === 'too-long' || quick.problem?.kind === 'empty') quick.problem = null;
        quicks.set(fanId, quick);
        return emit();
      }
      case 'quick-save':
        void saveQuick();
        return;
      case 'edit': {
        const note = data?.notes.find((entry) => entry.noteId === action.noteId);
        // FBuddy's and a cut one (audit №13: its tail lives in Fansly alone) are read only.
        if (data === null || fanId === null || note === undefined || note.foreign || note.cut === true) return;
        const form = formNote(data);
        const fill = fills.get(fanId);
        if (note === form && (fields.has(fanId) || fill?.status === 'running' || waits(fill) || (fill?.status === 'review' && fill.writing))) return;
        return startDraft(note.noteId, note.title, note.text);
      }
      case 'input':
        if (draft === undefined || draft.saving) return;
        draft.title = action.title;
        draft.text = action.text;
        if (draft.problem?.kind === 'empty' || draft.problem?.kind === 'too-long') draft.problem = null;
        return emit();
      case 'save':
        void save();
        return;
      case 'cancel':
        if (fanId === null || draft === undefined || draft.saving) return;
        drafts.delete(fanId);
        return emit();
      case 'ask-delete':
        if (data === null || deleting !== null || data.notes.some((note) => note.noteId === action.noteId && (note.cut === true || note.foreign))) return;
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
    fillDone,
    fillUpdate,
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
      for (const opId of fillOps.keys()) port.stopFill(opId);
      fillOps.clear();
      listeners.clear();
      entries.clear();
      drafts.clear();
      fields.clear();
      quicks.clear();
      fills.clear();
    },
  };
}
