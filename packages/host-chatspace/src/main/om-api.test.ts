// Whether the fan read our newest message on ChatSpace: the history — whose read marks the chat read on OnlyFans — is
// read only when the live chat list says our message is the last and nothing is unread, and a fan message that came
// between the two reads is told (`raced`), never passed off as a mark. #293 read a field the list never carries.

import { FanNotesAnswerSchema, FanNoteWriteAnswerSchema } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { fanNote, fanNotesOf, listedOf, readStateOf, writtenNote } from './om-api';

const FAN = '518588958';
const CREATOR = '514788334';

const listMessage = (id: string, from: string) => ({ id, sent_at: '2026-10-19T23:23:28+00:00', platform_metadata: { fromUser: { id: Number(from) }, isFree: true, isOpened: false } });
const chat = (last: unknown, unread: unknown = 0, meta: Record<string, unknown> = {}) => ({ platform_fan_id: FAN, unread_messages_count: unread, last_message: last, platform_metadata: { hasUnreadTips: false, ...meta } });
const list = (...items: unknown[]) => ({ items });
const historyMessage = (id: string, fromFan: boolean, isNew: boolean | undefined) => ({
  id,
  sent_at: '2026-10-20T23:48:47+00:00',
  is_from_fan: fromFan,
  platform_metadata: isNew === undefined ? {} : { isNew },
});

describe('chatReadState: when the history may be read', () => {
  it('our message last, nothing unread: the history may be read', () => {
    expect(listedOf(list(chat(listMessage('20', CREATOR))), FAN, CREATOR)).toEqual({
      last: { messageId: '20', direction: 'model', sentAt: '2026-10-19T23:23:28.000Z', read: null, readAt: null },
      mayRead: true,
    });
  });

  it('never when the fan wrote last, something is unread, a tip is unread or the sender is not the creator', () => {
    expect(listedOf(list(chat(listMessage('20', FAN))), FAN, CREATOR)).toMatchObject({ last: { direction: 'fan' }, mayRead: false });
    expect(listedOf(list(chat(listMessage('20', CREATOR), 1)), FAN, CREATOR)).toMatchObject({ mayRead: false });
    expect(listedOf(list(chat(listMessage('20', CREATOR), '0')), FAN, CREATOR)).toMatchObject({ mayRead: false });
    expect(listedOf(list(chat(listMessage('20', CREATOR), 0, { hasUnreadTips: true })), FAN, CREATOR)).toMatchObject({ mayRead: false });
    expect(listedOf(list(chat(listMessage('20', '777'))), FAN, CREATOR)).toEqual({ last: null, mayRead: false });
    expect(listedOf(list(chat(listMessage('20', CREATOR))), FAN, null)).toEqual({ last: null, mayRead: false });
  });

  it('only the chat of the exact fan id: another fan the search found, or none, reads nothing', () => {
    expect(listedOf(list({ ...chat(listMessage('20', CREATOR)), platform_fan_id: '5185889580' }), FAN, CREATOR)).toEqual({ last: null, mayRead: false });
    expect(listedOf(list(), FAN, CREATOR)).toEqual({ last: null, mayRead: false });
    expect(listedOf({ chats: [] }, FAN, CREATOR)).toMatchObject({ ok: false, failure: 'invalid' });
  });
});

describe('chatReadState: what the history says', () => {
  const ours = { messageId: '20', direction: 'model', sentAt: null, read: null, readAt: null };

  it('our message still the newest: read once the fan opened it', () => {
    expect(readStateOf({ items: [historyMessage('20', false, false), historyMessage('19', true, false)] }, ours)).toEqual({
      ok: true,
      last: { messageId: '20', direction: 'model', sentAt: '2026-10-20T23:48:47.000Z', read: true, readAt: null },
    });
    expect(readStateOf({ items: [historyMessage('20', false, true)] }, ours)).toMatchObject({ ok: true, last: { messageId: '20', read: false } });
    expect(readStateOf({ items: [historyMessage('20', false, undefined)] }, ours)).toMatchObject({ ok: true, last: { messageId: '20', read: null } });
  });

  it('a fan message that came between the reads, unread before ours: raced, never a mark', () => {
    expect(readStateOf({ items: [historyMessage('21', true, true), historyMessage('20', false, false)] }, ours)).toMatchObject({ ok: true, last: { messageId: '21', direction: 'fan' }, raced: true });
    // Our next message and a fan message both came between: still raced.
    expect(readStateOf({ items: [historyMessage('22', false, true), historyMessage('21', true, true), historyMessage('20', false, false)] }, ours)).toMatchObject({ raced: true, last: { messageId: '21' } });
  });

  it('a newer fan message read already (someone opened the chat): no mark and no race', () => {
    const answer = readStateOf({ items: [historyMessage('21', true, false), historyMessage('20', false, false)] }, ours);
    expect(answer).toEqual({ ok: true, last: { messageId: '21', direction: 'fan', sentAt: '2026-10-20T23:48:47.000Z', read: null, readAt: null } });
  });

  it('our newer message only: its own state', () => {
    expect(readStateOf({ items: [historyMessage('22', false, true), historyMessage('20', false, false)] }, ours)).toMatchObject({ last: { messageId: '22', read: false } });
  });

  it('our message gone (deleted): no mark', () => {
    expect(readStateOf({ items: [historyMessage('19', true, false)] }, ours)).toEqual({ ok: true, last: null });
    expect(readStateOf({ list: [] }, ours)).toMatchObject({ ok: false, failure: 'invalid' });
  });
});

// 2026-10-28: OnlyMonster's notes of the open fan as MAIN hands them on — every id checked, every string within the
// bridge's bounds, an unreadable note left out and said so, a long one cut and said so (never written back).
describe('fan notes: what MAIN makes of the API’s answers', () => {
  const rawNote = (over: Record<string, unknown> = {}) => ({
    id: 8801,
    organisation_id: 12,
    fan_id: 518588958,
    account_id: 36408,
    updated_by_user_id: 5501,
    title: 'Характеристика',
    note: 'Любит долгие разговоры\nПишет по вечерам',
    color: null,
    pinned: false,
    created_at: '2026-08-28T10:00:00+00:00',
    updated_at: '2026-09-11T12:30:00.000000Z',
    ...over,
  });

  it('a note as the team writes it: plain text, no colour; numbers become ids, times ISO', () => {
    expect(fanNote(rawNote())).toEqual({
      noteId: '8801',
      title: 'Характеристика',
      text: 'Любит долгие разговоры\nПишет по вечерам',
      color: null,
      createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-09-11T12:30:00.000Z',
      updatedBy: '5501',
      cut: false,
    });
    // As ChatSpace reads them: no title is ''; a colour of its palette is kept as the API keeps it.
    expect(fanNote(rawNote({ id: '0d6c2b1e-3f4a-4b5c-8d9e-0f1a2b3c4d5e', title: null, color: '#480A09', updated_by_user_id: 'user_2abc', created_at: 'later' }))).toMatchObject({
      noteId: '0d6c2b1e-3f4a-4b5c-8d9e-0f1a2b3c4d5e',
      title: '',
      color: '#480A09',
      updatedBy: 'user_2abc',
      createdAt: null,
    });
  });

  it('unreadable: no id or one that leaves its path segment, a body or a title that is no text, a colour that is no colour', () => {
    for (const over of [{ id: null }, { id: '../8801' }, { id: 0 }, { id: 2 ** 60 }, { note: null }, { note: ['x'] }, { title: 7 }, { color: 'red; background: url(x)' }, { color: 3 }]) {
      expect(fanNote(rawNote(over)), JSON.stringify(over)).toBeNull();
    }
    expect(fanNote(rawNote({ updated_by_user_id: 'who?' }))).toMatchObject({ updatedBy: null });
  });

  it('a note longer than the bridge carries comes cut, never half a character, and says so', () => {
    const text = `${'я'.repeat(19_999)}😀tail`;
    const note = fanNote(rawNote({ note: text, title: 't'.repeat(250) })) as Record<string, unknown>;
    expect(note['cut']).toBe(true);
    expect(note['text']).toBe('я'.repeat(19_999));
    expect((note['title'] as string).length).toBe(200);
  });

  it('the list: in the API’s order; one left out makes it incomplete; no list at all is invalid', () => {
    const whole = fanNotesOf({ items: [rawNote(), rawNote({ id: 8802, title: 'Фетиши' })] });
    expect(FanNotesAnswerSchema.parse(whole)).toMatchObject({ ok: true, complete: true, notes: [{ noteId: '8801' }, { noteId: '8802' }] });
    expect(fanNotesOf({ items: [rawNote({ id: null }), rawNote()] })).toMatchObject({ ok: true, complete: false, notes: [{ noteId: '8801' }] });
    expect(fanNotesOf({ items: [] })).toEqual({ ok: true, notes: [], complete: true });
    expect(fanNotesOf({ notes: [] })).toEqual({ ok: false, failure: 'invalid', status: null });
    // Past a frame's budget or the count: the rest is left out, and the answer says it is not all.
    const big = fanNotesOf({ items: Array.from({ length: 20 }, (_, index) => rawNote({ id: 9000 + index, note: 'ж'.repeat(19_000) })) });
    expect(FanNotesAnswerSchema.parse(big)).toMatchObject({ ok: true, complete: false });
    expect((big['notes'] as unknown[]).length).toBeLessThan(20);
    const many = fanNotesOf({ items: Array.from({ length: 120 }, (_, index) => rawNote({ id: 9000 + index, note: 'x' })) });
    expect((many['notes'] as unknown[]).length).toBe(100);
    expect(many['complete']).toBe(false);
  });

  it('a write the API took: the note it names, wrapped or not; none — null, read again', () => {
    expect(FanNoteWriteAnswerSchema.parse(writtenNote(rawNote()))).toMatchObject({ ok: true, note: { noteId: '8801' } });
    expect(writtenNote({ data: rawNote({ id: 8803 }) })).toMatchObject({ ok: true, note: { noteId: '8803' } });
    expect(writtenNote({ item: rawNote({ id: 8804 }) })).toMatchObject({ ok: true, note: { noteId: '8804' } });
    expect(writtenNote({})).toEqual({ ok: true, note: null });
    expect(writtenNote(null)).toEqual({ ok: true, note: null });
    expect(writtenNote({ success: true })).toEqual({ ok: true, note: null });
  });
});
