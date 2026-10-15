// One frame of the page's socket, read as the page reads it (docs/project-unite/
// architecture.md §5.3): three levels, packages, the projections of the one
// parse, and the completeness sign the old extension did not have
// (SN-019: it stopped its walk at the limits without a word). Frames are built
// the way the fake Fansly builds them (packages/testing/fixture-fansly/src/wire.ts).

import { describe, expect, it, vi } from 'vitest';

import { frameMessage, readFrame } from './frame-parse';
import { FRAME_MAX_CHARS, FRAME_MAX_DEPTH, FRAME_MAX_NODES } from './protocol';

const CREATOR = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '700000000000000010';
const OTHER_GROUP = '700000000000000011';

const service = (serviceId: number, event: Record<string, unknown>): string => JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
const pack = (frames: readonly string[]): string => JSON.stringify({ t: 10001, d: frames });
const message = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 1,
  content: 'hi there',
  groupId: GROUP,
  senderId: FAN,
  correlationId: null,
  inReplyTo: null,
  createdAt: 1_790_000_000,
  attachments: [],
  totalTipAmount: 0,
  ...over,
});
const created = (id: string, over: Record<string, unknown> = {}): string => service(5, { type: 1, message: message(id, over) });
const read = (text: string) => readFrame(text, JSON.parse);

describe('[SN-019] [host:fansly] a frame of the page’s socket, read as the page reads it', () => {
  it('[FS-WS-2] 5/1 → a message: three parses, ids as strings, the side, the time, a tip and media apart', () => {
    const result = read(created('700000000000000101', { attachments: [{ contentType: 7, contentId: '1', pos: 0, messageId: null }, { contentType: 1, contentId: '2', pos: 1, messageId: null }] }));
    expect(result).toEqual({
      known: true,
      whole: true,
      touched: null,
      typing: 0,
      items: [
        {
          k: 'message',
          m: { id: '700000000000000101', groupId: GROUP, senderId: FAN, type: 1, createdAt: 1_790_000_000, correlationId: null, inReplyTo: null, content: 'hi there', tip: true, media: true },
        },
      ],
    });
    // A tip by its amount alone; ids that came as safe numbers become strings.
    expect(frameMessage(message('700000000000000102', { totalTipAmount: 500, groupId: 12345, correlationId: '0' }))).toMatchObject({ groupId: '12345', tip: true, media: false, correlationId: null });
  });

  it('[FS-WS-2] 5/10 → a deletion, a `type 3` with its cascade; 3/2 → a follow; 4/6–4/8 → members; 4/2 and 5/2 → receipts', () => {
    expect(read(service(5, { type: 10, message: message('700000000000000103', { type: 3 }) })).items).toEqual([{ k: 'deleted', id: '700000000000000103', groupId: GROUP, cascade: true }]);
    expect(read(service(5, { type: 10, message: message('700000000000000104') })).items).toEqual([{ k: 'deleted', id: '700000000000000104', groupId: GROUP, cascade: false }]);
    expect(read(service(3, { type: 2, follow: { id: '700000000000000201', accountId: CREATOR, followerId: FAN } })).items).toEqual([{ k: 'follow', eventId: '700000000000000201', accountId: CREATOR, followerId: FAN }]);
    expect(read(service(3, { type: 3, follow: { id: '700000000000000202', accountId: CREATOR, followerId: FAN } })).items).toEqual([]);
    expect(read(service(4, { type: 6, groupUser: { groupId: GROUP, userId: FAN } })).items).toEqual([{ k: 'members', type: 6, groupId: GROUP, userId: FAN }]);
    expect(read(service(4, { type: 8, group: { id: OTHER_GROUP } })).items).toEqual([{ k: 'members', type: 8, groupId: OTHER_GROUP, userId: null }]);
    expect(read(service(4, { type: 2, ackCommand: { type: 2, userId: FAN, messageIds: ['700000000000000101', 'x'] } })).items).toEqual([{ k: 'read', userId: FAN, ids: ['700000000000000101'] }]);
    expect(read(service(5, { type: 2, messageAckEvent: { userId: FAN, messageIds: ['700000000000000102'] } })).items).toEqual([{ k: 'read', userId: FAN, ids: ['700000000000000102'] }]);
  });

  it('[FS-WS-3] reads every frame in full, typing and receipts too — no filter by prefix; typing is counted, never passed on', () => {
    const parse = vi.fn(JSON.parse);
    const typing = service(5, { type: 22, typingAnnounceEvent: { accountId: FAN, groupId: GROUP, lastAnnounce: 1 } });
    expect(readFrame(typing, parse)).toEqual({ known: true, whole: true, touched: null, items: [], typing: 1 });
    // The wrapper, the service event and its `event`: three parses.
    expect(parse).toHaveBeenCalledTimes(3);
    parse.mockClear();
    readFrame(service(4, { type: 2, ackCommand: { type: 2, userId: FAN, messageIds: [] } }), parse);
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('[FS-WS-1] never parses the `d` of `t:0/1/2` — `t:1` carries the session token; `t:1` confirms the socket; the ping is a ping', () => {
    const parse = vi.fn(JSON.parse);
    const session = JSON.stringify({ t: 1, d: JSON.stringify({ session: { id: '1', accountId: CREATOR, token: 'secret', deviceId: null } }) });
    expect(readFrame(session, parse)).toEqual({ known: true, whole: true, touched: null, items: [{ k: 'session' }], typing: 0 });
    expect(parse).toHaveBeenCalledTimes(1);
    for (const t of [0, 2]) expect(readFrame(JSON.stringify({ t, d: '{"code":401}' }), parse)).toEqual({ known: true, whole: true, touched: null, items: [], typing: 0 });
    expect(parse).toHaveBeenCalledTimes(3);
    expect(readFrame('p', parse)).toMatchObject({ known: true, whole: true, items: [] });
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it('[FS-WS-2] a package (`t:10001`) is read frame by frame, and nested ones up to the depth limit', () => {
    const inner = [created('700000000000000105'), created('700000000000000106', { groupId: OTHER_GROUP })];
    expect(read(pack(inner)).items.map((item) => (item.k === 'message' ? item.m.id : item.k))).toEqual(['700000000000000105', '700000000000000106']);
    let nested = created('700000000000000107');
    for (let depth = 0; depth < FRAME_MAX_DEPTH; depth += 1) nested = pack([nested]);
    expect(read(nested)).toMatchObject({ whole: true, items: [{ k: 'message' }] });
    expect(read(pack([nested]))).toEqual({ known: true, whole: false, touched: null, items: [], typing: 0 });
  });

  it('[FS-WS-2] the completeness sign: over a limit, damaged, a package not an array — not whole, and every chat touched; never a silent cut', () => {
    const lost = { known: false, whole: false, touched: null, items: [], typing: 0 };
    expect(read(`{"t":10000,"d":"${'x'.repeat(FRAME_MAX_CHARS)}"}`)).toEqual(lost);
    expect(read('{"t":10000,')).toEqual(lost);
    expect(read(JSON.stringify({ t: 10000, d: '{"serviceId":5,"event":"{broken' }))).toMatchObject({ known: true, whole: false, touched: null });
    expect(read(JSON.stringify({ t: 10001, d: 'not an array' }))).toMatchObject({ known: true, whole: false, touched: null });
    // A package over the node limit: what fits is read, the rest is a loss of every chat.
    const many = Array.from({ length: FRAME_MAX_NODES }, (_, i) => created(`7000000000001${String(i).padStart(5, '0')}`));
    const result = read(pack(many));
    expect(result).toMatchObject({ known: true, whole: false, touched: null });
    expect(result.items).toHaveLength(FRAME_MAX_NODES - 1);
    // A damaged frame inside a package: the rest of it is still read, and every chat is unknown.
    const mixed = read(pack([created('700000000000000108'), '{broken', created('700000000000000109')]));
    expect(mixed).toMatchObject({ whole: false, touched: null });
    expect(mixed.items).toHaveLength(1);
  });

  it('[FS-WS-2] a message that names its chat but not itself loses that chat alone; an unsafe number is no id', () => {
    expect(read(service(5, { type: 1, message: { groupId: GROUP, senderId: FAN, type: 1 } }))).toEqual({ known: true, whole: false, touched: [GROUP], items: [], typing: 0 });
    expect(read(service(5, { type: 1, message: message(String(2 ** 60), { id: 2 ** 60 }) }))).toMatchObject({ whole: false, touched: [GROUP] });
    expect(read(service(5, { type: 10, message: { groupId: OTHER_GROUP } }))).toMatchObject({ whole: false, touched: [OTHER_GROUP] });
    // Members of a group it does not name: whose fan is whose is not known for any chat.
    expect(read(service(4, { type: 7, groupUser: { userId: FAN } }))).toMatchObject({ whole: false, touched: null });
  });

  it('a `t` the page does not know is no frame it reads, and nothing is lost (FS-WS-5 counts these)', () => {
    expect(read(JSON.stringify({ t: 42, d: 'whatever' }))).toEqual({ known: false, whole: true, touched: null, items: [], typing: 0 });
    expect(read(JSON.stringify([1, 2]))).toMatchObject({ known: false, whole: false });
    // A follow it cannot read names no chat: no loss either.
    expect(read(service(3, { type: 2, follow: { id: 'x' } }))).toEqual({ known: true, whole: true, touched: null, items: [], typing: 0 });
    // Another service, another type: read, nothing of ours.
    expect(read(service(9, { type: 1 }))).toEqual({ known: true, whole: true, touched: null, items: [], typing: 0 });
  });

  it('reads a frame of the busiest page’s mix within its budget (≤ 0.1 ms on average, §5.3)', () => {
    const mix = [
      ...Array.from({ length: 46 }, () => service(5, { type: 22, typingAnnounceEvent: { accountId: FAN, groupId: GROUP, lastAnnounce: 1 } })),
      ...Array.from({ length: 30 }, () => service(4, { type: 2, ackCommand: { type: 2, userId: FAN, messageIds: ['700000000000000101', '700000000000000102'] } })),
      ...Array.from({ length: 22 }, (_, i) => created(`7000000000002${String(i).padStart(5, '0')}`, { content: 'x'.repeat(400) })),
      service(3, { type: 2, follow: { id: '700000000000000203', accountId: CREATOR, followerId: FAN } }),
      JSON.stringify({ t: 2, d: '{"lastPing":1}' }),
    ];
    for (const frame of mix) read(frame);
    const rounds = 50;
    const started = performance.now();
    for (let round = 0; round < rounds; round += 1) for (const frame of mix) read(frame);
    const average = (performance.now() - started) / (rounds * mix.length);
    expect(average).toBeLessThan(0.1);
  });
});
