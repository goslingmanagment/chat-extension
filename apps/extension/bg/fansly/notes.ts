// «Заметки» in Fansly's background chunk (R20 P11b; FS-NOTE-1…5; docs/project-unite/architecture.md §8.9): the
// `fansly.notes.*` requests of a Fansly tab, over Fansly's own note calls (packages/fansly-api notes.ts) through the
// one client and pacer of this realm.
//
// - Admitted like «Регистрация»: the request names the hub page its tab is bound to; the page must be this hub
//   session's, a Fansly page of the same creator, with its own switch `notes` usable, and the tab registered — checked
//   before the call is prepared and again just before it leaves (FS-NOTE-4: the same session and account).
// - Reads (the group when MAIN has not named its fan — once a chat; then `GET /account?ids=`) are one attempt and
//   nothing during a cooldown (FS-NET-1 `notes`, FS-NOTE-3). Writes are one attempt, never repeated here; a write
//   whose fate is unknown answers CG-NOTE-UNCERTAIN. An edit (of a note or of the name) is confirmed by `success`, as
//   Fansly's own window confirms it (R20 P11b2; decision 170 of the Fansly extension 2.13.0); a create only by the new note.
// - FBuddy's «FBuddy Notes» is someone else's: never created, edited or deleted from here.
// - A note's text is answered to the tab and to nobody else: nothing of it is logged (FS-NOTE-5).

import type { CgAnyErrorWire } from '@cg/contracts/errors-fansly';
import type { FanslyTabRequestPayload, FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { pageFlagState } from '@cg/core/domain/ops';
import {
  FANSLY_NAME_NOTE_TITLE,
  FANSLY_NAME_NOTE_TYPE,
  FANSLY_NOTE_TYPE,
  FanslyApiError,
  editedNote,
  fanNotesOf,
  isForeignNote,
  notesCalls,
  panelNote,
  writtenNote,
  type FanslyAnswer,
  type FanslyCall,
  type FanslyClient,
  type StoredNote,
} from '@cg/fansly-api';

import type { BackgroundKit, HostSiteSender } from '../../src/composition/background/host-module';
import { registrationFanId } from './registration';

export type NotesRequestType = 'fansly.notes.read' | 'fansly.notes.create' | 'fansly.notes.edit' | 'fansly.notes.delete' | 'fansly.notes.name';
type Answer<T extends NotesRequestType> = FanslyTabResponsePayload<T>;
type Target = { readonly pageId: number; readonly hostAccountId: string };

/** Chats whose fan this realm learned from their group: a shift opens fewer. */
const KEPT_GROUPS = 300;
/** The answer's own cap (contracts FANSLY_TAB_LIMITS.notesPerFan). */
const NOTES_PER_ANSWER = 200;

class Refused extends Error {
  constructor(readonly wire: CgAnyErrorWire) {
    super(wire.code);
  }
}

/** A write's failure: one Fansly answered is the code it maps to; one whose fate is unknown may have landed. */
export function writeFailure(error: unknown): CgAnyErrorWire {
  if (error instanceof Refused) return error.wire;
  if (!(error instanceof FanslyApiError)) return { code: 'CG-NOTE-UNCERTAIN' };
  const unknownFate = error.sent && (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'malformed' || error.kind === 'aborted' || (error.kind === 'http' && (error.httpStatus ?? 0) >= 500));
  return unknownFate ? { code: 'CG-NOTE-UNCERTAIN' } : error.toWire();
}

const readFailure = (error: unknown): CgAnyErrorWire => (error instanceof Refused ? error.wire : error instanceof FanslyApiError ? error.toWire() : { code: 'CG-NOTE-READ' });

export function createNotesService(kit: BackgroundKit, clientOf: () => Promise<FanslyClient | null>) {
  const fans = new Map<string, string>();
  // Both tabs' reread + write must run in order, including two creates of the name (12002).
  const writes = new Map<string, Promise<unknown>>();

  /** The admission of one request; the returned check is asked again around the call. */
  async function admit(target: Target, sender: HostSiteSender): Promise<() => boolean> {
    if (sender.kind !== 'tab') throw new Refused({ code: 'CG-CONTEXT-CHANGED' });
    const owner = kit.hub.session();
    const grant = await kit.hub.page(target.pageId, sender);
    if (!grant.ok) throw new Refused({ code: grant.code });
    const allowed = (): boolean => {
      const session = kit.hub.session();
      const page = kit.hub.bootstrap()?.pages.find((p) => p.pageId === target.pageId);
      return (
        owner !== null &&
        session?.hubOrigin === owner.hubOrigin &&
        session.userId === owner.userId &&
        page?.platform === 'fansly' &&
        page.platformAccountId === target.hostAccountId &&
        pageFlagState(page, 'notes').usable &&
        kit.router.tabs().includes(sender.tabSessionId)
      );
    };
    if (!allowed()) throw new Refused({ code: 'CG-FEATURE-DISABLED' });
    return allowed;
  }

  /** One call: prepared (admission, session, pacer), checked, sent once. A read is checked again after its answer. */
  async function call(request: FanslyCall, allowed: () => boolean, write: boolean): Promise<FanslyAnswer> {
    const client = await clientOf();
    if (client === null) throw new Refused({ code: 'CG-FAN-SESSION' });
    const prepared = await client.prepare(request);
    if (!allowed()) {
      prepared.cancel();
      throw new Refused({ code: 'CG-CONTEXT-CHANGED' });
    }
    const answer = await prepared.start();
    if (!write && !allowed()) throw new Refused({ code: 'CG-CONTEXT-CHANGED' });
    return answer;
  }

  async function read(request: FanslyTabRequestPayload<'fansly.notes.read'>, sender: HostSiteSender): Promise<Answer<'fansly.notes.read'>> {
    try {
      const allowed = await admit(request, sender);
      let fan = request.fanRef;
      if (fan === null) {
        if (request.groupId === null) return { ok: false, error: { code: 'CG-FAN-GROUP' } };
        const key = `${request.hostAccountId}|${request.groupId}`;
        fan = fans.get(key) ?? null;
        if (fan === null) {
          const group = await call(notesCalls.group(request.hostAccountId, request.groupId), allowed, false);
          fan = registrationFanId(group.response, request.groupId, request.hostAccountId);
          if (fan === null) return { ok: false, error: { code: 'CG-FAN-GROUP' } };
          fans.set(key, fan);
          while (fans.size > KEPT_GROUPS) fans.delete(fans.keys().next().value as string);
        }
      }
      const answer = await call(notesCalls.account(request.hostAccountId, fan), allowed, false);
      const notes = fanNotesOf(answer.response, fan);
      if (notes === null) return { ok: false, error: { code: 'CG-NOTE-READ' } };
      return { ok: true, fanRef: fan, notes: notes.notes.slice(0, NOTES_PER_ANSWER), customName: notes.customName, readAt: new Date(kit.clock.now()).toISOString() };
    } catch (error) {
      return { ok: false, error: readFailure(error) };
    }
  }

  async function fresh(target: Target & { readonly fanRef: string }, allowed: () => boolean) {
    try {
      const answer = await call(notesCalls.account(target.hostAccountId, target.fanRef), allowed, false);
      const notes = fanNotesOf(answer.response, target.fanRef);
      if (notes === null) throw new Refused({ code: 'CG-NOTE-READ' });
      return notes;
    } catch (error) {
      // This is still a read: no write could have landed.
      throw new Refused(readFailure(error));
    }
  }

  /** A write of a regular note or of the name; the note Fansly answered with, or why not. */
  async function write(target: Target & { readonly fanRef: string }, sender: HostSiteSender, prepare: FanslyCall | ((allowed: () => boolean) => Promise<FanslyCall | null>), confirm: (response: unknown, request: FanslyCall) => StoredNote | null): Promise<{ readonly ok: true; readonly note: StoredNote | null } | { readonly ok: false; readonly error: CgAnyErrorWire }> {
    try {
      const allowed = await admit(target, sender);
      const key = `${target.hostAccountId}|${target.fanRef}`;
      const pending = (writes.get(key) ?? Promise.resolve()).then(async () => {
        const request = typeof prepare === 'function' ? await prepare(allowed) : prepare;
        if (request === null) return { ok: true as const, note: null };
        const answer = await call(request, allowed, true);
        const note = confirm(answer.response, request);
        return note === null && request.route !== 'notes.delete' ? { ok: false as const, error: { code: 'CG-NOTE-UNCERTAIN' as const } } : { ok: true as const, note };
      });
      writes.set(key, pending.catch(() => undefined));
      const queued = writes.get(key);
      try { return await pending; }
      finally { if (writes.get(key) === queued) writes.delete(key); }
    } catch (error) {
      return { ok: false, error: writeFailure(error) };
    }
  }

  const foreign: CgAnyErrorWire = { code: 'CG-NOTE-WRITE', detail: 'foreign note' };
  const changed: CgAnyErrorWire = { code: 'CG-NOTE-WRITE', detail: 'changed' };

  return {
    read,
    async create(request: FanslyTabRequestPayload<'fansly.notes.create'>, sender: HostSiteSender): Promise<Answer<'fansly.notes.create'>> {
      if (isForeignNote({ title: request.title, note: request.text })) return { ok: false, error: foreign };
      const done = await write(request, sender, notesCalls.create(request.hostAccountId, request.fanRef, FANSLY_NOTE_TYPE, request.title, request.text), (raw) => writtenNote(raw, request.fanRef, FANSLY_NOTE_TYPE));
      return done.ok && done.note !== null ? { ok: true, note: panelNote(done.note) } : { ok: false, error: done.ok ? { code: 'CG-NOTE-UNCERTAIN' } : done.error };
    },
    async edit(request: FanslyTabRequestPayload<'fansly.notes.edit'>, sender: HostSiteSender): Promise<Answer<'fansly.notes.edit'>> {
      if (isForeignNote({ title: request.title, note: request.text })) return { ok: false, error: foreign };
      const done = await write(request, sender, async (allowed) => {
        const note = (await fresh(request, allowed)).notes.find((note) => note.noteId === request.noteId);
        if (note === undefined || request.current === undefined || note.title !== request.current.title || note.text !== request.current.text) throw new Refused(changed);
        if (note.foreign) throw new Refused(foreign);
        const stored: StoredNote = { id: note.noteId, contentType: FANSLY_NOTE_TYPE, contentId: request.fanRef, title: note.title, note: note.text, createdAtMs: note.createdAtMs ?? null };
        return notesCalls.edit(request.hostAccountId, stored, request.title, request.text);
      }, (raw) => editedNote(raw, request.fanRef, { id: request.noteId, contentType: FANSLY_NOTE_TYPE, title: request.title, note: request.text }));
      return done.ok && done.note !== null ? { ok: true, note: panelNote(done.note) } : { ok: false, error: done.ok ? { code: 'CG-NOTE-UNCERTAIN' } : done.error };
    },
    async remove(request: FanslyTabRequestPayload<'fansly.notes.delete'>, sender: HostSiteSender): Promise<Answer<'fansly.notes.delete'>> {
      if (isForeignNote({ title: request.title, note: request.text })) return { ok: false, error: foreign };
      const stored: StoredNote = { id: request.noteId, contentType: FANSLY_NOTE_TYPE, contentId: request.fanRef, title: request.title, note: request.text, createdAtMs: null };
      const done = await write(request, sender, notesCalls.remove(request.hostAccountId, stored), () => null);
      return done.ok ? { ok: true } : { ok: false, error: done.error };
    },
    /** The name for oneself: edited or deleted where there is one, created only where there was none. */
    async name(request: FanslyTabRequestPayload<'fansly.notes.name'>, sender: HostSiteSender): Promise<Answer<'fansly.notes.name'>> {
      const name = request.name.trim();
      let expectedId: string | undefined;
      const done = await write(request, sender, async (allowed) => {
        const latest = (await fresh(request, allowed)).customName;
        if (latest?.noteId !== request.current?.noteId || latest?.name !== request.current?.name) throw new Refused(changed);
        const current: StoredNote | null = latest === null ? null : { id: latest.noteId, contentType: FANSLY_NAME_NOTE_TYPE, contentId: request.fanRef, title: FANSLY_NAME_NOTE_TITLE, note: latest.name, createdAtMs: null };
        expectedId = current?.id;
        // Fansly's own «trash-undo»: no note, the fan's display name again.
        if (name === '') return current === null ? null : notesCalls.remove(request.hostAccountId, current);
        return current === null ? notesCalls.create(request.hostAccountId, request.fanRef, FANSLY_NAME_NOTE_TYPE, FANSLY_NAME_NOTE_TITLE, name) : notesCalls.edit(request.hostAccountId, current, FANSLY_NAME_NOTE_TITLE, name);
      }, (raw, sent) =>
        // The name rides the same edit as a note (decision 170): confirmed by `success`; a created name only by its note.
        sent.route === 'notes.edit' && expectedId !== undefined
          ? editedNote(raw, request.fanRef, { id: expectedId, contentType: FANSLY_NAME_NOTE_TYPE, title: FANSLY_NAME_NOTE_TITLE, note: name })
          : writtenNote(raw, request.fanRef, FANSLY_NAME_NOTE_TYPE, expectedId));
      if (name === '') return done.ok ? { ok: true, customName: null } : { ok: false, error: done.error };
      return done.ok && done.note !== null ? { ok: true, customName: { noteId: done.note.id, name: done.note.note } } : { ok: false, error: done.ok ? { code: 'CG-NOTE-UNCERTAIN' } : done.error };
    },
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
