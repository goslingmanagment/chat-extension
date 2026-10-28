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

import { OM_NOTE_COLORS, type FanNotesFailed, type FanNotesPort, type OmFanNote } from '@cg/contracts/host';
import type { ChatRef } from '@cg/contracts/ids';
import { FAN_NOTES_LIMITS } from '@cg/contracts/limits';
import { NOTE_LIMITS, type NoteColor, type NoteData, type NotesErrorWire } from '@cg/contracts/notes';

export interface OmNotesStoreDeps {
  /** OnlyMonster's notes of the open chat's fan (HostPort.fanNotes). */
  readonly host: FanNotesPort;
  /** A raw note as the panel's lines (domain/hosts/chatspace/notes-html.ts `omNoteText`). */
  readonly text: (raw: string) => string;
  /** The raw to send for the panel's text: plain stays plain, HTML keeps its untouched lines (`omNoteWrite`). */
  readonly write: (original: string | null, text: string) => string;
}

type Failure = { readonly ok: false; readonly error: NotesErrorWire };

const CHANGED: NotesErrorWire = { code: 'CG-NOTE-WRITE', detail: 'changed' };
const LONG: NotesErrorWire = { code: 'CG-NOTE-WRITE', detail: 'long note' };
const UNCERTAIN: NotesErrorWire = { code: 'CG-NOTE-UNCERTAIN' };

const TOO_LONG: NotesErrorWire = { code: 'CG-NOTE-TOO-LONG' };

const keyOf = (chat: ChatRef): string => `${chat.hostAccountId}|${chat.platformFanId}`;
const detailOf = (failed: FanNotesFailed): string => (failed.status === null ? failed.failure : `${failed.failure} ${String(failed.status)}`);
/** ChatSpace's palette (hex as the API keeps it) as the panel names it; another value — no dot. */
const colorOf = (value: string | null): NoteColor | null => (value === null ? null : ((OM_NOTE_COLORS as Readonly<Record<string, NoteColor>>)[value.toLowerCase()] ?? null));

/** A read that failed: another chat on the route is the context's; the rest is a failed read, and nothing was written. */
function readFailure(failed: FanNotesFailed): NotesErrorWire {
  return failed.failure === 'not-open' ? { code: 'CG-CONTEXT-CHANGED' } : { code: 'CG-NOTE-READ', detail: detailOf(failed) };
}

/**
 * A write that failed. Nothing was sent — the chat changed on the route, no session or API address yet, the token came
 * too late, the input broke the bridge's limits: refused. OnlyMonster refused it (4xx): refused. The request went out
 * and no readable answer came, or a server error: its fate is unknown, it may have landed.
 */
export function omWriteFailure(failed: FanNotesFailed): NotesErrorWire {
  switch (failed.failure) {
    case 'not-open':
      return { code: 'CG-CONTEXT-CHANGED' };
    case 'input':
      return TOO_LONG;
    case 'endpoint':
    case 'session':
    case 'timeout':
    case 'unavailable':
      return { code: 'CG-NOTE-WRITE', detail: failed.failure };
    case 'http':
      return failed.status !== null && failed.status < 500 ? { code: 'CG-NOTE-WRITE', detail: detailOf(failed) } : UNCERTAIN;
    case 'unknown':
    case 'network':
    case 'invalid':
      return UNCERTAIN;
  }
}

/** The bridge carries a shorter note than the panel holds: a longer one is refused before anything is sent. */
const fitsBridge = (title: string, raw: string): boolean => title.length <= FAN_NOTES_LIMITS.titleMax && raw.length <= FAN_NOTES_LIMITS.textMax;

export function createOmNotesStore(deps: OmNotesStoreDeps) {
  /** The raw notes as last read or written, by chat and note: what an edit keeps (its HTML, its colour). */
  const raws = new Map<string, Map<string, OmFanNote>>();
  /** One write at a time per fan: the reread and the write of one never interleave with another's. */
  const writes = new Map<string, Promise<unknown>>();

  const remember = (chat: ChatRef, notes: readonly OmFanNote[], replace: boolean): void => {
    const key = keyOf(chat);
    const kept = replace ? new Map<string, OmFanNote>() : (raws.get(key) ?? new Map<string, OmFanNote>());
    for (const note of notes) kept.set(note.noteId, note);
    raws.delete(key);
    raws.set(key, kept);
    // A shift opens a few hundred chats at most.
    while (raws.size > 300) raws.delete(raws.keys().next().value as string);
  };

  /** A raw note as the panel reads it. */
  function noteOf(raw: OmFanNote): NoteData {
    const title = raw.title;
    const text = deps.text(raw.text);
    // Cut by the bridge, or longer than the panel holds: shown, never written back.
    const cut = raw.cut || title.length > NOTE_LIMITS.titleMaxChars || text.length > NOTE_LIMITS.textMaxChars;
    const color = colorOf(raw.color);
    const at = raw.createdAt === null ? NaN : Date.parse(raw.createdAt);
    return {
      noteId: raw.noteId,
      title: cut ? title.slice(0, NOTE_LIMITS.titleMaxChars) : title,
      text: cut ? text.slice(0, NOTE_LIMITS.textMaxChars) : text,
      foreign: false,
      createdAtMs: Number.isFinite(at) && at > 0 ? at : null,
      ...(cut ? { cut: true as const } : {}),
      ...(color === null ? {} : { color }),
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
  async function fresh(chat: ChatRef): Promise<{ readonly ok: true; readonly notes: readonly OmFanNote[] } | Failure> {
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
        const raw = deps.write(null, text);
        if (!fitsBridge(title, raw)) return { ok: false as const, error: TOO_LONG };
        const answer = await deps.host.create(chat, { title, text: raw, color: null });
        if (!answer.ok) return { ok: false as const, error: omWriteFailure(answer) };
        if (answer.note !== null) {
          remember(chat, [answer.note], false);
          return { ok: true as const, note: noteOf(answer.note) };
        }
        // The answer named no note: a read says whether it is there (a new id with this title and text).
        const read = await deps.host.list(chat);
        if (!read.ok) return { ok: false as const, error: UNCERTAIN };
        remember(chat, read.notes, true);
        const made = read.notes.find((note) => !before.has(note.noteId) && note.title === title && deps.text(note.text) === text);
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
        const next = deps.write(raw.text, text);
        if (!fitsBridge(title, next)) return { ok: false as const, error: TOO_LONG };
        // The whole note, as ChatSpace's own editor writes it: its own colour kept.
        const answer = await deps.host.update(chat, noteId, { title, text: next, color: raw.color });
        if (!answer.ok) return { ok: false as const, error: omWriteFailure(answer) };
        const written: OmFanNote = answer.note ?? { ...raw, title, text: next };
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
