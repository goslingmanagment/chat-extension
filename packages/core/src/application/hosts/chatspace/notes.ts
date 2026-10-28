// «Заметки» of a ChatSpace tab, where they are kept (2026-10-28, the owner): OnlyMonster's own fan notes, the very
// notes ChatSpace's side panel «Заметки» → «Фан» shows, read and written through the page's own session by the host
// port (host-chatspace om-api.ts). This is the store the shared notes controller asks (application/notes): the same
// promises as Fansly's background gives its tabs (bg/fansly/notes.ts), kept here in the tab:
//
// - A write only by the chatter's click (the controller asks), for the fan of the chat open on the route (MAIN checks
//   the route right before the request), one at a time per fan, never repeated here. A write whose fate is unknown
//   (no answer, a server error, an answer that cannot be read) is CG-NOTE-UNCERTAIN: the panel blocks a second create
//   until a fresh read, as on Fansly.
// - An edit reads the fan's notes first (OnlyMonster keeps no version): the note gone — `changed` with nothing to show
//   (the panel turns the draft into a new note); holding the new text already — done, nothing written; changed since
//   the panel read it (a colleague, Monster's own tab) — `changed` with `latest`, which the panel shows and the next
//   «Сохранить» writes over. Never a silent overwrite.
// - OnlyMonster keeps a note as HTML from its editor or as plain text. The panel works in lines; a note that came as
//   HTML keeps the HTML of every line the chatter did not change (`write`), and its colour; a new note is plain text.
// - A note longer than the panel holds is shown cut and read only (`cut`): written from here, its tail would be lost.
// - Nothing here is logged: a note's text goes from the port to the panel and back (FS-NOTE-5).

import type { ChatRef } from '@cg/contracts/ids';
import { NOTE_COLORS, NOTE_LIMITS, type NoteColor, type NoteData, type NotesErrorWire } from '@cg/contracts/notes';

/** OnlyMonster's fan note as the host port answers it: `text` is the raw note (HTML or plain). */
export interface OmNoteLike {
  readonly noteId: string;
  readonly title: string | null;
  readonly text: string;
  readonly color: string | null;
  readonly createdAt: string | null;
}

/** What a create or an edit sends: the whole note, as OnlyMonster's own editor does. */
export interface OmNoteInput {
  readonly title: string | null;
  readonly note: string;
  readonly color: NoteColor | null;
}

/** A refusal of the host port: `failure` its word (`identity-mismatch`, `session`, `endpoint`, `http`, `timeout`…). */
export interface OmFailed {
  readonly ok: false;
  readonly failure: string;
  readonly status: number | null;
}

/** OnlyMonster's notes of the open chat's fan, as the host port reads and writes them (it never rejects). */
export interface OmNotesHost {
  list(chat: ChatRef): Promise<{ readonly ok: true; readonly notes: readonly OmNoteLike[] } | OmFailed>;
  create(chat: ChatRef, input: OmNoteInput): Promise<{ readonly ok: true; readonly note: OmNoteLike | null } | OmFailed>;
  update(chat: ChatRef, noteId: string, input: OmNoteInput): Promise<{ readonly ok: true; readonly note: OmNoteLike | null } | OmFailed>;
  remove(chat: ChatRef, noteId: string): Promise<{ readonly ok: true } | OmFailed>;
}

export interface OmNotesStoreDeps {
  readonly host: OmNotesHost;
  /** A raw note as the panel's lines (domain/hosts/chatspace/notes-html.ts `omNoteText`). */
  readonly text: (raw: string) => string;
  /** The raw to send for the panel's text: plain stays plain, HTML keeps its untouched lines (`omNoteWrite`). */
  readonly write: (original: string | null, text: string) => string;
}

type Failure = { readonly ok: false; readonly error: NotesErrorWire };

const CHANGED: NotesErrorWire = { code: 'CG-NOTE-WRITE', detail: 'changed' };
const LONG: NotesErrorWire = { code: 'CG-NOTE-WRITE', detail: 'long note' };
const UNCERTAIN: NotesErrorWire = { code: 'CG-NOTE-UNCERTAIN' };

const keyOf = (chat: ChatRef): string => `${chat.hostAccountId}|${chat.platformFanId}`;
const isColor = (value: string | null): value is NoteColor => value !== null && (NOTE_COLORS as readonly string[]).includes(value);
const detailOf = (failed: OmFailed): string => (failed.status === null ? failed.failure : `${failed.failure} ${String(failed.status)}`);

/** A read that failed: another chat on the route is the context's; the rest is a failed read, and nothing was written. */
function readFailure(failed: OmFailed): NotesErrorWire {
  return failed.failure === 'identity-mismatch' ? { code: 'CG-CONTEXT-CHANGED' } : { code: 'CG-NOTE-READ', detail: detailOf(failed) };
}

/**
 * A write that failed. Nothing was sent: the chat changed on the route, no session or no API address yet — refused.
 * OnlyMonster answered with a refusal (4xx) — refused. No answer, a server error or an answer that cannot be read —
 * its fate is unknown: it may have landed.
 */
export function omWriteFailure(failed: OmFailed): NotesErrorWire {
  if (failed.failure === 'identity-mismatch') return { code: 'CG-CONTEXT-CHANGED' };
  if (failed.failure === 'session' || failed.failure === 'endpoint') return { code: 'CG-NOTE-WRITE', detail: failed.failure };
  if (failed.failure === 'http' && failed.status !== null && failed.status < 500) return { code: 'CG-NOTE-WRITE', detail: detailOf(failed) };
  return UNCERTAIN;
}

export function createOmNotesStore(deps: OmNotesStoreDeps) {
  /** The raw notes as last read or written, by chat and note: what an edit keeps (its HTML, its colour). */
  const raws = new Map<string, Map<string, OmNoteLike>>();
  /** One write at a time per fan: the reread and the write of one never interleave with another's. */
  const writes = new Map<string, Promise<unknown>>();

  const remember = (chat: ChatRef, notes: readonly OmNoteLike[], replace: boolean): void => {
    const key = keyOf(chat);
    const kept = replace ? new Map<string, OmNoteLike>() : (raws.get(key) ?? new Map<string, OmNoteLike>());
    for (const note of notes) kept.set(note.noteId, note);
    raws.delete(key);
    raws.set(key, kept);
    // A shift opens a few hundred chats at most.
    while (raws.size > 300) raws.delete(raws.keys().next().value as string);
  };

  /** A raw note as the panel reads it. */
  function noteOf(raw: OmNoteLike): NoteData {
    const title = raw.title ?? '';
    const text = deps.text(raw.text);
    const cut = title.length > NOTE_LIMITS.titleMaxChars || text.length > NOTE_LIMITS.textMaxChars;
    const at = raw.createdAt === null ? NaN : Date.parse(raw.createdAt);
    return {
      noteId: raw.noteId,
      title: cut ? title.slice(0, NOTE_LIMITS.titleMaxChars) : title,
      text: cut ? text.slice(0, NOTE_LIMITS.textMaxChars) : text,
      foreign: false,
      createdAtMs: Number.isFinite(at) && at > 0 ? at : null,
      ...(cut ? { cut: true as const } : {}),
      ...(isColor(raw.color) ? { color: raw.color } : {}),
    };
  }

  /** Runs `job` after every write of the same fan before it. */
  async function queued<T>(chat: ChatRef, job: () => Promise<T>): Promise<T> {
    const key = keyOf(chat);
    const pending = (writes.get(key) ?? Promise.resolve()).then(job);
    const tail = pending.catch(() => undefined);
    writes.set(key, tail);
    try {
      return await pending;
    } finally {
      if (writes.get(key) === tail) writes.delete(key);
    }
  }

  /** The fan's notes read again before a write: a failure here is a read's, and nothing was written. */
  async function fresh(chat: ChatRef): Promise<{ readonly ok: true; readonly notes: readonly OmNoteLike[] } | Failure> {
    const read = await deps.host.list(chat);
    if (!read.ok) return { ok: false, error: readFailure(read) };
    remember(chat, read.notes, true);
    return read;
  }

  return {
    async read(chat: ChatRef): Promise<{ readonly ok: true; readonly notes: readonly NoteData[] } | Failure> {
      const read = await deps.host.list(chat);
      if (!read.ok) return { ok: false, error: readFailure(read) };
      remember(chat, read.notes, true);
      return { ok: true, notes: read.notes.slice(0, NOTE_LIMITS.perFan).map(noteOf) };
    },

    /** A new note: plain text, no colour. Confirmed by the note OnlyMonster answers, or found by a read right after. */
    create(chat: ChatRef, title: string, text: string): Promise<{ readonly ok: true; readonly note: NoteData } | Failure> {
      return queued(chat, async () => {
        const before = new Set(raws.get(keyOf(chat))?.keys() ?? []);
        const answer = await deps.host.create(chat, { title: title === '' ? null : title, note: deps.write(null, text), color: null });
        if (!answer.ok) return { ok: false as const, error: omWriteFailure(answer) };
        if (answer.note !== null) {
          remember(chat, [answer.note], false);
          return { ok: true as const, note: noteOf(answer.note) };
        }
        // The answer named no note: a read says whether it is there (a new id with this title and text).
        const read = await deps.host.list(chat);
        if (!read.ok) return { ok: false as const, error: UNCERTAIN };
        remember(chat, read.notes, true);
        const made = read.notes.find((note) => !before.has(note.noteId) && (note.title ?? '') === title && deps.text(note.text) === text);
        return made === undefined ? { ok: false as const, error: UNCERTAIN } : { ok: true as const, note: noteOf(made) };
      });
    },

    /** The edit of a note as the panel read it (`current`); see the header for what a change elsewhere does. */
    edit(chat: ChatRef, noteId: string, title: string, text: string, current: { readonly title: string; readonly text: string } | undefined): Promise<{ readonly ok: true; readonly note: NoteData } | (Failure & { readonly latest?: NoteData })> {
      return queued(chat, async () => {
        const read = await fresh(chat);
        if (!read.ok) return read;
        const raw = read.notes.find((note) => note.noteId === noteId);
        if (raw === undefined) return { ok: false as const, error: CHANGED };
        const latest = noteOf(raw);
        if (latest.cut === true) return { ok: false as const, error: LONG };
        if (latest.title === title && latest.text === text) return { ok: true as const, note: latest };
        if (current === undefined || latest.title !== current.title || latest.text !== current.text) return { ok: false as const, error: CHANGED, latest };
        const answer = await deps.host.update(chat, noteId, { title: title === '' ? null : title, note: deps.write(raw.text, text), color: isColor(raw.color) ? raw.color : null });
        if (!answer.ok) return { ok: false as const, error: omWriteFailure(answer) };
        const written: OmNoteLike = answer.note ?? { ...raw, title: title === '' ? null : title, text: deps.write(raw.text, text) };
        remember(chat, [written], false);
        // OnlyMonster's answer may drop the creation time: the one read stays.
        const note = noteOf(written);
        return { ok: true as const, note: note.createdAtMs === null ? { ...note, createdAtMs: latest.createdAtMs ?? null } : note };
      });
    },

    remove(chat: ChatRef, noteId: string): Promise<{ readonly ok: true } | Failure> {
      return queued(chat, async () => {
        const answer = await deps.host.remove(chat, noteId);
        if (!answer.ok) return { ok: false as const, error: omWriteFailure(answer) };
        raws.get(keyOf(chat))?.delete(noteId);
        return { ok: true as const };
      });
    },
  };
}

export type OmNotesStore = ReturnType<typeof createOmNotesStore>;
