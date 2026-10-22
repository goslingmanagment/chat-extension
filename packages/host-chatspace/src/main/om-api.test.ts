// Whether the fan read our newest message on ChatSpace: the history — whose read marks the chat read on OnlyFans — is
// read only when the live chat list says our message is the last and nothing is unread, and a fan message that came
// between the two reads is told (`raced`), never passed off as a mark. #293 read a field the list never carries.

import { describe, expect, it } from 'vitest';

import { listedOf, readStateOf } from './om-api';

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
