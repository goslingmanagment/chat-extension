// One frame of the page's socket, read as the page reads it (docs/project-unite/
// architecture.md §5.3): three levels, packages, the projections of the one
// parse, and the completeness sign the old extension did not have
// (SN-019: it stopped its walk at the limits without a word). Frames are built
// the way the fake Fansly builds them (packages/testing/fixture-fansly/src/wire.ts).

import { describe, expect, it, vi } from 'vitest';

import { frameMessage, readFrame } from './frame-parse';

const CREATOR = '700000000000000001';
const FAN = '700000000000000002';
const GROUP = '700000000000000010';

const service = (serviceId: number, event: Record<string, unknown>): string => JSON.stringify({ t: 10000, d: JSON.stringify({ serviceId, event: JSON.stringify(event) }) });
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
});
