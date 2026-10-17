import { describe, expect, it } from 'vitest';

import { admit } from './allowlist';
import { FANSLY_NAME_NOTE_TYPE, FANSLY_NOTE_TYPE, editedNote, fanNotesOf, isForeignNote, notesCalls, readNoteTimeMs, writtenNote } from './notes';

const FAN = '920000000000000003';
const note = (id: string, contentType: number, title: string, text: string, contentId = FAN) => ({ id, accountId: '700000000000000017', contentType, contentId, title, note: text, createdAt: 1_790_790_855, updatedAt: null });

describe('«Заметки»: Fansly’s own note calls and answers (R20 P11b)', () => {
  it('[FS-NOTE-2] the account read gives the regular notes in Fansly’s order and the first name note; FBuddy’s profile is someone else’s', () => {
    const account = {
      id: FAN,
      notes: [
        note('801', FANSLY_NOTE_TYPE, 'Анкета', 'Имя: Алекс'),
        note('802', FANSLY_NAME_NOTE_TYPE, 'Custom Username', 'Алекс из Риги'),
        note('803', FANSLY_NOTE_TYPE, 'FBuddy Notes', 'likes: cats'),
        note('804', FANSLY_NOTE_TYPE, 'Sync', 'x [FBUDDY_SYNC] y'),
        note('805', FANSLY_NAME_NOTE_TYPE, 'Custom Username', 'second'),
        note('806', 13000, 'Other', 'a post note'),
        note('807', FANSLY_NOTE_TYPE, 'Another fan', 'not this one', '920000000000000032'),
        { id: 'bad', contentType: FANSLY_NOTE_TYPE },
      ],
    };
    expect(fanNotesOf([{ id: '920000000000000032', notes: [] }, account], FAN)).toEqual({
      notes: [
        { noteId: '801', title: 'Анкета', text: 'Имя: Алекс', foreign: false, createdAtMs: 1_790_790_855_000 },
        { noteId: '803', title: 'FBuddy Notes', text: 'likes: cats', foreign: true, createdAtMs: 1_790_790_855_000 },
        { noteId: '804', title: 'Sync', text: 'x [FBUDDY_SYNC] y', foreign: true, createdAtMs: 1_790_790_855_000 },
      ],
      customName: { noteId: '802', name: 'Алекс из Риги' },
    });
    expect(fanNotesOf([], FAN)).toBeNull();
    expect(fanNotesOf([{ id: FAN }], FAN)).toEqual({ notes: [], customName: null });
    expect(isForeignNote({ title: ' FBuddy Notes ', note: '' })).toBe(true);
  });

  it('[FS-NOTE-4] a write is confirmed only by the note it addressed: this fan, this kind, this id', () => {
    const raw = note('801', FANSLY_NOTE_TYPE, 'T', 'x');
    expect(writtenNote(raw, FAN, FANSLY_NOTE_TYPE)).toMatchObject({ id: '801', contentId: FAN });
    expect(writtenNote(raw, FAN, FANSLY_NOTE_TYPE, '801')).not.toBeNull();
    expect(writtenNote(raw, FAN, FANSLY_NOTE_TYPE, '802')).toBeNull();
    expect(writtenNote(raw, FAN, FANSLY_NAME_NOTE_TYPE)).toBeNull();
    expect(writtenNote(note('801', FANSLY_NOTE_TYPE, 'T', 'x', '920000000000000032'), FAN, FANSLY_NOTE_TYPE)).toBeNull();
    expect(writtenNote(null, FAN, FANSLY_NOTE_TYPE)).toBeNull();
  });

  it('[FX-019] [FS-NOTE-2] a note’s creation time is Fansly’s own `createdAt`, in seconds; a value already in ms is kept, anything else is none (decision 171 of the Fansly extension 2.13.0)', () => {
    expect(readNoteTimeMs(1_790_790_855)).toBe(1_790_790_855_000);
    expect(readNoteTimeMs(1_790_790_855_123)).toBe(1_790_790_855_123);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '1790790855', null, undefined]) expect(readNoteTimeMs(bad)).toBeNull();
    const account = { id: FAN, notes: [{ ...note('801', FANSLY_NOTE_TYPE, 'A', 'x'), createdAt: undefined }] };
    expect(fanNotesOf([account], FAN)?.notes).toEqual([{ noteId: '801', title: 'A', text: 'x', foreign: false }]);
  });

  it('[FX-020] [FS-NOTE-4] an edit is confirmed by `success`, its answer read as Fansly’s window reads it; what it names must be this note (decision 170)', () => {
    const sent = { id: '801', contentType: FANSLY_NOTE_TYPE, title: 'T', note: 'y' };
    for (const raw of [undefined, null, true, {}, { title: 'T', note: 'y' }]) expect(editedNote(raw, FAN, sent)).toEqual({ ...sent, contentId: FAN, createdAtMs: null });
    expect(editedNote({ title: 'T2', note: 'z' }, FAN, sent)).toMatchObject({ title: 'T2', note: 'z' });
    expect(editedNote(note('801', FANSLY_NOTE_TYPE, 'T', 'y'), FAN, sent)).toMatchObject({ id: '801', createdAtMs: 1_790_790_855_000 });
    for (const raw of [{ id: '802' }, { id: 801 }, { contentType: FANSLY_NAME_NOTE_TYPE }, { contentId: '920000000000000032' }]) expect(editedNote(raw, FAN, sent)).toBeNull();
  });

  it('[FS-NOTE-3] [FS-NOTE-4] the calls are Fansly’s window’s, admitted by FS-NET-1’s `notes` row: reads once and never during a cooldown, writes once', () => {
    const stored = { id: '801', contentType: FANSLY_NOTE_TYPE, contentId: FAN, title: 'T', note: 'x', createdAtMs: null };
    expect(notesCalls.account('7', FAN)).toEqual({ purpose: 'notes', route: 'account.byIds', account: '7', query: { ids: FAN } });
    expect(notesCalls.group('7', '81')).toEqual({ purpose: 'notes', route: 'group.detail', account: '7', path: { group: '81' } });
    expect(notesCalls.create('7', FAN, FANSLY_NOTE_TYPE, 'T', 'x').body).toEqual({ contentType: FANSLY_NOTE_TYPE, contentId: FAN, title: 'T', note: 'x' });
    expect(notesCalls.edit('7', stored, 'T2', 'y').body).toEqual({ id: '801', contentType: FANSLY_NOTE_TYPE, contentId: FAN, title: 'T2', note: 'y' });
    expect(notesCalls.remove('7', stored).body).toEqual({ id: '801', contentType: FANSLY_NOTE_TYPE, contentId: FAN, title: 'T', note: 'x' });
    for (const call of [notesCalls.account('7', FAN), notesCalls.group('7', '81')]) expect(admit(call.purpose, call.route)).toEqual({ mode: 'check', attempts: 1 });
    for (const call of [notesCalls.create('7', FAN, 1, '', ''), notesCalls.edit('7', stored, '', ''), notesCalls.remove('7', stored)]) expect(admit(call.purpose, call.route)).toEqual({ mode: 'dispatch', attempts: 1 });
  });
});
