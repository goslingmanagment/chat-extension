// «Заметки» on Fansly's own note endpoints (R20 P11b; FS-NOTE-3, FS-NOTE-4; the Fansly extension's src/shared/fan-notes.ts
// and the notes of src/background/fansly-client.ts): the calls the background makes — the same as Fansly's «Edit User
// Notes» window — and how their answers are read. The calls go through the client like every other (FS-NET-1's
// `notes` row and the pacer): this module only names them.
//
// - Notes live on the fan's account as the creator's session sees it: `GET /account?ids=<fan>` → `notes[]`. A regular
//   note is contentType 12000 with a title and a text, any number of them; the name for oneself is the one note of
//   contentType 12002, title «Custom Username», its text the name.
// - FBuddy keeps its fan profile in a regular note titled «FBuddy Notes» (and may mark it `[FBUDDY_SYNC]`, S5 §3.11):
//   someone else's — read, shown, never written.
// - A note's creation time is Fansly's own `createdAt`, in seconds (R20 P11b2; the Fansly extension 2.13.0, decision 171): every
//   note carries it, no note carries an edit time.
// - An edit is confirmed as Fansly's own notes window confirms it: by `success` (R20 P11b2; decision 170 of the Fansly
//   extension 2.13.0) — its answer may hold the whole note, its title and text, or nothing; what it does name must be
//   this note. A create stays strict: only its answer gives the new note's id.
// - Nothing here logs, keeps or returns more than the note itself (FS-NOTE-5).

import { FANSLY_TAB_LIMITS, type FanslyNote } from '@cg/contracts/tab-messages-fansly';

import type { FanslyCall } from './client';

/** contentType of a regular account note (`1000 × AccountService`). */
export const FANSLY_NOTE_TYPE = 12000;
/** contentType of the name for oneself. */
export const FANSLY_NAME_NOTE_TYPE = 12002;
/** The title Fansly gives the name note. */
export const FANSLY_NAME_NOTE_TITLE = 'Custom Username';
/** FBuddy's fan profile (S5 §3.11). */
export const FBUDDY_NOTE_TITLE = 'FBuddy Notes';
const FBUDDY_MARK = '[FBUDDY_SYNC]';

const FANSLY_ID = /^[1-9]\d{0,23}$/;

/** A note as Fansly stores it: the fields a write sends back. */
export interface StoredNote {
  readonly id: string;
  readonly contentType: number;
  readonly contentId: string;
  readonly title: string;
  readonly note: string;
  /** When it was created, ms; null — the answer gave no time (an edit's answer as a rule). */
  readonly createdAtMs: number | null;
}

/** The fan's notes as the panel shows them. */
export interface FanNotes {
  readonly notes: FanslyNote[];
  readonly customName: { readonly noteId: string; readonly name: string } | null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Fansly's `createdAt` is in seconds (`1790790855`); a value that already reads as milliseconds is taken as is. */
export function readNoteTimeMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value < 1e11 ? value * 1000 : value);
}

/** A stored note, or null for anything a write could not address. */
export function storedNote(raw: unknown, fanId: string): StoredNote | null {
  if (!record(raw)) return null;
  const id = raw['id'];
  const contentType = raw['contentType'];
  if (typeof id !== 'string' || !FANSLY_ID.test(id) || typeof contentType !== 'number') return null;
  const contentId = raw['contentId'];
  return {
    id,
    contentType,
    contentId: typeof contentId === 'string' && FANSLY_ID.test(contentId) ? contentId : fanId,
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    note: typeof raw['note'] === 'string' ? raw['note'] : '',
    createdAtMs: readNoteTimeMs(raw['createdAt']),
  };
}

/** FBuddy's own note: its title, or its sync mark in the text. */
export const isForeignNote = (note: Pick<StoredNote, 'title' | 'note'>): boolean => note.title.trim() === FBUDDY_NOTE_TITLE || note.note.includes(FBUDDY_MARK);

/**
 * A note as the panel shows it. One longer than the tab's limits (a title over 1000, a text over 50 000 — written in
 * Fansly's window or by FBuddy) is cut to them and marked `cut`: shown, never written back from here (audit №13 — before,
 * one such note failed the whole read and the panel showed no note at all).
 */
export function panelNote(note: StoredNote): FanslyNote {
  const cut = note.title.length > FANSLY_TAB_LIMITS.noteTitleMaxChars || note.note.length > FANSLY_TAB_LIMITS.noteTextMaxChars;
  return {
    noteId: note.id,
    title: note.title.slice(0, FANSLY_TAB_LIMITS.noteTitleMaxChars),
    text: note.note.slice(0, FANSLY_TAB_LIMITS.noteTextMaxChars),
    foreign: isForeignNote(note),
    ...(note.createdAtMs === null ? {} : { createdAtMs: note.createdAtMs }),
    ...(cut ? { cut: true as const } : {}),
  };
}

/**
 * The fan's notes from `GET /account?ids=<fan>` (the envelope already unwrapped): the regular ones in Fansly's own order
 * (its window lists them as stored) and the first name note. null — the answer has no account of this fan.
 */
export function fanNotesOf(response: unknown, fanId: string): FanNotes | null {
  const accounts: readonly unknown[] | null = Array.isArray(response) ? (response as unknown[]) : record(response) && Array.isArray(response['accounts']) ? (response['accounts'] as unknown[]) : null;
  const account: unknown = accounts?.find((entry) => record(entry) && entry['id'] === fanId);
  if (!record(account)) return null;
  const notes: FanslyNote[] = [];
  let customName: FanNotes['customName'] = null;
  for (const raw of Array.isArray(account['notes']) ? account['notes'] : []) {
    const note = storedNote(raw, fanId);
    if (note === null || note.contentId !== fanId) continue;
    if (note.contentType === FANSLY_NOTE_TYPE) notes.push(panelNote(note));
    // A name over the limit is cut for the head's field: a new name replaces it whole anyway.
    else if (note.contentType === FANSLY_NAME_NOTE_TYPE && customName === null) customName = { noteId: note.id, name: note.note.slice(0, FANSLY_TAB_LIMITS.customNameMaxChars) };
  }
  return { notes, customName };
}

/**
 * The note a write answered with. An answer about another note, another fan or another kind is no confirmation of
 * this write: null.
 */
export function writtenNote(raw: unknown, fanId: string, contentType: number, expectedId?: string): StoredNote | null {
  const note = storedNote(raw, fanId);
  return note === null || note.contentId !== fanId || note.contentType !== contentType || (expectedId !== undefined && note.id !== expectedId) ? null : note;
}

/**
 * The note an edit wrote (decision 170 of the Fansly extension): Fansly's window takes `success` as the confirmation and reads
 * only the title and the text of the answer. So an answer with the whole note, with the title and the text alone, or
 * with nothing confirms it; an id, a kind or a fan it does name must be this note's, else it is no confirmation of
 * this write (null). The title and the text are the answer's where it gives them, else the ones sent.
 */
export function editedNote(raw: unknown, fanId: string, sent: Pick<StoredNote, 'id' | 'contentType' | 'title' | 'note'>): StoredNote | null {
  const answer = record(raw) ? raw : {};
  const id = answer['id'];
  const contentType = answer['contentType'];
  const contentId = answer['contentId'];
  if ((id !== undefined && id !== sent.id) || (contentType !== undefined && contentType !== sent.contentType) || (contentId !== undefined && contentId !== fanId)) return null;
  return {
    id: sent.id,
    contentType: sent.contentType,
    contentId: fanId,
    title: typeof answer['title'] === 'string' ? answer['title'] : sent.title,
    note: typeof answer['note'] === 'string' ? answer['note'] : sent.note,
    createdAtMs: readNoteTimeMs(answer['createdAt']),
  };
}

/** The calls of «Заметки», as the client takes them (FS-NET-1 row `notes`). */
export const notesCalls = {
  /** The open group, when MAIN has not named its fan: once a chat. */
  group: (account: string, groupId: string): FanslyCall => ({ purpose: 'notes', route: 'group.detail', account, path: { group: groupId } }),
  account: (account: string, fanId: string): FanslyCall => ({ purpose: 'notes', route: 'account.byIds', account, query: { ids: fanId } }),
  create: (account: string, fanId: string, contentType: number, title: string, text: string): FanslyCall => ({
    purpose: 'notes',
    route: 'notes.create',
    account,
    body: { contentType, contentId: fanId, title, note: text },
  }),
  edit: (account: string, note: StoredNote, title: string, text: string): FanslyCall => ({
    purpose: 'notes',
    route: 'notes.edit',
    account,
    body: { id: note.id, contentType: note.contentType, contentId: note.contentId, title, note: text },
  }),
  /** Fansly's window sends the whole note it deletes. */
  remove: (account: string, note: StoredNote): FanslyCall => ({
    purpose: 'notes',
    route: 'notes.delete',
    account,
    body: { id: note.id, contentType: note.contentType, contentId: note.contentId, title: note.title, note: note.note },
  }),
};
