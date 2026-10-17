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
// - Nothing here logs, keeps or returns more than the note itself (FS-NOTE-5).

import type { FanslyNote } from '@cg/contracts/tab-messages-fansly';

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
}

/** The fan's notes as the panel shows them. */
export interface FanNotes {
  readonly notes: FanslyNote[];
  readonly customName: { readonly noteId: string; readonly name: string } | null;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

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
  };
}

/** FBuddy's own note: its title, or its sync mark in the text. */
export const isForeignNote = (note: Pick<StoredNote, 'title' | 'note'>): boolean => note.title.trim() === FBUDDY_NOTE_TITLE || note.note.includes(FBUDDY_MARK);

export const panelNote = (note: StoredNote): FanslyNote => ({ noteId: note.id, title: note.title, text: note.note, foreign: isForeignNote(note) });

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
    else if (note.contentType === FANSLY_NAME_NOTE_TYPE && customName === null) customName = { noteId: note.id, name: note.note };
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
 * The note an edit answered with. Fansly's own window confirms an edit by `success` alone and takes only the title and
 * the text from the answer, which may carry nothing more (E170 of the old extension: a live edit that landed was
 * refused here for asking for an id). An id, a kind or a fan the answer does name must be this note's: null otherwise.
 */
export function editedNote(raw: unknown, sent: StoredNote, title: string, text: string): StoredNote | null {
  const answer = record(raw) ? raw : {};
  const names = (key: 'id' | 'contentType' | 'contentId', ours: string | number): boolean => answer[key] === undefined || answer[key] === null || answer[key] === ours;
  if (!names('id', sent.id) || !names('contentType', sent.contentType) || !names('contentId', sent.contentId)) return null;
  return {
    id: sent.id,
    contentType: sent.contentType,
    contentId: sent.contentId,
    title: typeof answer['title'] === 'string' ? answer['title'] : title,
    note: typeof answer['note'] === 'string' ? answer['note'] : text,
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
