import { describe, expect, it, vi } from 'vitest';

import type { ChatRef } from '@cg/contracts/ids';

import { createOmNotesStore, omWriteFailure, type OmNoteLike, type OmNotesHost } from './notes';

const chat: ChatRef = { host: 'chatspace', hostAccountId: '36408', platformFanId: '518588958' };
const text = (raw: string): string => raw.replace(/<\/p><p>/g, '\n').replace(/<\/?p>/g, '');
const write = (original: string | null, next: string): string => (original !== null && original.startsWith('<p>') ? `<p>${next.split('\n').join('</p><p>')}</p>` : next);

function world(notes: OmNoteLike[]) {
  const store = new Map(notes.map((note) => [note.noteId, note]));
  const host: OmNotesHost = {
    list: vi.fn(() => Promise.resolve({ ok: true as const, notes: [...store.values()] })),
    create: vi.fn((_chat, input) => {
      const note = { noteId: String(100 + store.size), title: input.title, text: input.note, color: input.color, createdAt: '2026-10-28T10:00:00.000Z' };
      store.set(note.noteId, note);
      return Promise.resolve({ ok: true as const, note });
    }),
    update: vi.fn((_chat, noteId: string, input) => {
      const was = store.get(noteId) as OmNoteLike;
      store.set(noteId, { ...was, title: input.title, text: input.note, color: input.color });
      return Promise.resolve({ ok: true as const, note: null });
    }),
    remove: vi.fn(() => Promise.resolve({ ok: true as const })),
  };
  return { store, host, notes: createOmNotesStore({ host, text, write }) };
}

const form: OmNoteLike = { noteId: '7', title: 'Анкета', text: 'Имя: Трей\nЛокация: США', color: null, createdAt: '2026-09-01T10:00:00.000Z' };

describe('ChatSpace notes over OnlyMonster', () => {
  it('an edit writes only over the version the panel read; a colleague’s change comes back as `latest`, never overwritten', async () => {
    const w = world([form]);
    const read = await w.notes.read(chat);
    expect(read.ok && read.notes[0]?.text).toBe('Имя: Трей\nЛокация: США');
    // A colleague changed the note in Monster's tab meanwhile.
    w.store.set('7', { ...form, text: 'Имя: Трей\nЛокация: Огайо' });
    const edit = await w.notes.edit(chat, '7', 'Анкета', 'Имя: Трей\nЛокация: США\nВозраст: 30', { title: 'Анкета', text: 'Имя: Трей\nЛокация: США' });
    expect(edit).toMatchObject({ ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'changed' }, latest: { text: 'Имя: Трей\nЛокация: Огайо' } });
    expect(w.host.update).not.toHaveBeenCalled();
    // Gone meanwhile: `changed` with nothing to show (the panel makes the draft a new note).
    w.store.delete('7');
    expect(await w.notes.edit(chat, '7', 'Анкета', 'x', { title: 'Анкета', text: 'Имя: Трей\nЛокация: Огайо' })).toEqual({ ok: false, error: { code: 'CG-NOTE-WRITE', detail: 'changed' } });
  });

  it('an HTML note keeps its HTML and colour on an edit; a new note is plain text with no colour', async () => {
    const w = world([{ noteId: '8', title: 'Фетиши', text: '<p>ноги</p><p>чулки</p>', color: 'red', createdAt: null }]);
    const edit = await w.notes.edit(chat, '8', 'Фетиши', 'ноги\nчулки\nлатекс', { title: 'Фетиши', text: 'ноги\nчулки' });
    expect(edit).toMatchObject({ ok: true, note: { text: 'ноги\nчулки\nлатекс', color: 'red' } });
    expect(w.host.update).toHaveBeenCalledWith(chat, '8', { title: 'Фетиши', note: '<p>ноги</p><p>чулки</p><p>латекс</p>', color: 'red' });
    // Already holding the text (the answer of an earlier edit was lost): nothing is written again.
    expect(await w.notes.edit(chat, '8', 'Фетиши', 'ноги\nчулки\nлатекс', { title: 'Фетиши', text: 'ноги\nчулки' })).toMatchObject({ ok: true });
    expect(w.host.update).toHaveBeenCalledTimes(1);
    const made = await w.notes.create(chat, 'dmitriy', 'любит кошек');
    expect(made).toMatchObject({ ok: true, note: { title: 'dmitriy', text: 'любит кошек' } });
    expect(w.host.create).toHaveBeenCalledWith(chat, { title: 'dmitriy', note: 'любит кошек', color: null });
  });

  it('a write whose fate is unknown is uncertain; a refusal before or by OnlyMonster is a refusal', () => {
    expect(omWriteFailure({ ok: false, failure: 'timeout', status: null })).toEqual({ code: 'CG-NOTE-UNCERTAIN' });
    expect(omWriteFailure({ ok: false, failure: 'http', status: 502 })).toEqual({ code: 'CG-NOTE-UNCERTAIN' });
    expect(omWriteFailure({ ok: false, failure: 'network', status: null })).toEqual({ code: 'CG-NOTE-UNCERTAIN' });
    expect(omWriteFailure({ ok: false, failure: 'http', status: 403 })).toEqual({ code: 'CG-NOTE-WRITE', detail: 'http 403' });
    expect(omWriteFailure({ ok: false, failure: 'session', status: null })).toEqual({ code: 'CG-NOTE-WRITE', detail: 'session' });
    expect(omWriteFailure({ ok: false, failure: 'identity-mismatch', status: null })).toEqual({ code: 'CG-CONTEXT-CHANGED' });
  });
});
