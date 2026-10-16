// The fake Fansly's socket on its own (R20 P6b; S2 Q1): epochs and re-creation,
// the session (`t: 1`, `t: 0`), the ping, every event the plan names — `5/1`,
// `5/10` with the cascade of a `type 3` parent, `4/2`, `5/22`, `3/2` — batches
// (`t: 10001`) and damaged frames, exactly as they are on the wire.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import { EVENT, FRAME, SERVICE, parseFrame, serviceFrame, type WireFollow, type WireHistoryPage, type WireMessage } from '../../fixture-fansly/src/wire';
import { DEFAULT_VERIFY_DELAY_MS, type FakeFansly } from './index';
import { bypass, call, frameType, isEvent, openSocket, pause, serviceEvent, startTestFansly } from './kit';
import { STAND_CLOSE_CODE } from './socket';

const ids = standIds(createWorld());
const [groupA, groupB, groupC] = ids.groups as [string, string, string];
const fanA = ids.fans[groupA] as string;
const isSession = (frame: string): boolean => frameType(frame) === FRAME.session;

let fake: FakeFansly;
let since = 0;

beforeAll(async () => {
  fake = await startTestFansly();
});

afterAll(async () => {
  await fake.close();
});

beforeEach(async () => {
  fake.command({ op: 'reset' });
  await expect.poll(() => fake.command({ op: 'status' }).status?.sockets, { timeout: 3000 }).toEqual([]);
  fake.command({ op: 'socket', verifyDelayMs: 0 });
  since = fake.journal.next;
});

describe('the fake Fansly socket: sessions and epochs', () => {
  it('verifies the page’s session with `t: 1` carrying the session, three levels of JSON nowhere yet', async () => {
    const socket = await openSocket(fake);
    const frame = await socket.next(isSession);
    const wrapper = JSON.parse(frame) as { t: number; d: string };
    expect(typeof wrapper.d).toBe('string');
    expect(JSON.parse(wrapper.d)).toMatchObject({ session: { accountId: ids.creator, token: fake.token, deviceId: null } });
    expect(parseFrame(frame)).toEqual({ t: 1 });
    expect(fake.command({ op: 'status' }).status?.sockets).toEqual([{ id: expect.any(Number) as number, caller: 'page', via: 'direct', verified: true, pings: 0 }]);
    socket.socket.close();
  });

  it('by default verifies a moment after the request, so a page’s first read of the fresh end can start before `t: 1`', async () => {
    fake.command({ op: 'reset' });
    const started = Date.now();
    const socket = await openSocket(fake);
    await socket.next(isSession);
    expect(Date.now() - started).toBeGreaterThanOrEqual(DEFAULT_VERIFY_DELAY_MS - 10);
    socket.socket.close();
  });

  it('a dead or wrong session gets `t: 0` with 401 and no events', async () => {
    const socket = await openSocket(fake, { token: 'somebody-else' });
    expect(parseFrame(await socket.next((frame) => frameType(frame) === FRAME.error))).toEqual({ t: 0, code: 401 });
    fake.command({ op: 'typing', groupId: groupA });
    await pause(60);
    expect(socket.frames).toHaveLength(1);
    socket.socket.close();

    const live = await openSocket(fake);
    await live.next(isSession);
    fake.command({ op: 'session', expire: true });
    expect(parseFrame(await live.next((frame) => frameType(frame) === FRAME.error))).toEqual({ t: 0, code: 401 });
    live.socket.close();
  });

  it('events go to verified sockets only', async () => {
    fake.command({ op: 'socket', verify: false });
    const silent = await openSocket(fake);
    await pause(40);
    expect(fake.command({ op: 'typing', groupId: groupA }).sent).toBe(0);
    fake.command({ op: 'socket', verify: true });
    const verified = await openSocket(fake);
    await verified.next(isSession);
    expect(fake.command({ op: 'typing', groupId: groupA }).sent).toBe(1);
    await verified.next(isEvent(SERVICE.message, EVENT.message.typing));
    expect(silent.frames).toEqual([]);
    silent.socket.close();
    verified.socket.close();
  });

  it('every connection is a new socket with the next number; a close by the stand is not a clean one', async () => {
    const first = await openSocket(fake);
    await first.next(isSession);
    const firstId = fake.command({ op: 'status' }).status?.sockets[0]?.id ?? 0;
    expect(fake.command({ op: 'socket', close: true }).sent).toBe(1);
    expect(await first.closed()).toBe(STAND_CLOSE_CODE);
    await expect.poll(() => fake.command({ op: 'status' }).status?.sockets, { timeout: 3000 }).toEqual([]);
    const second = await openSocket(fake);
    await second.next(isSession);
    expect(fake.command({ op: 'status' }).status?.sockets.map((socket) => socket.id)).toEqual([firstId + 1]);
    const own = fake.journal.read(since).entries.filter((entry) => (entry.kind === 'ws-open' || entry.kind === 'ws-close') && (entry.socketId ?? 0) >= firstId);
    expect(own.map((entry) => [entry.kind, entry.socketId])).toEqual([
      ['ws-open', firstId],
      ['ws-close', firstId],
      ['ws-open', firstId + 1],
    ]);
    second.socket.close();
  });

  it('a stalled connection never opens (the page would replace it after 3 s); the next one does', async () => {
    fake.command({ op: 'socket', stall: 1 });
    const url = new URL(fake.socketUrl);
    const stalled = new WebSocket(`ws://127.0.0.1:${url.port}/?v=3`, { headers: { host: url.host }, origin: 'http://localhost:5999' });
    stalled.on('error', () => undefined);
    await pause(150);
    expect(stalled.readyState).toBe(WebSocket.CONNECTING);
    expect(fake.journal.read(since).entries.filter((entry) => entry.kind === 'ws-stalled' || entry.kind === 'ws-open').map((entry) => entry.kind)).toEqual(['ws-stalled']);
    const next = await openSocket(fake);
    await next.next(isSession);
    expect(fake.command({ op: 'status' }).status).toMatchObject({ connections: fake.hub.count, sockets: [{ verified: true }] });
    stalled.terminate();
    next.socket.close();
  });

  it('answers the text ping `"p"` with `t: 2`, unless told not to', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    socket.socket.send('p');
    expect(parseFrame(await socket.next((frame) => frameType(frame) === FRAME.pong))).toEqual({ t: 2 });
    fake.command({ op: 'socket', pong: false });
    socket.socket.send('p');
    await pause(60);
    expect(socket.frames.filter((frame) => frameType(frame) === FRAME.pong)).toHaveLength(1);
    expect(fake.command({ op: 'status' }).status?.sockets[0]?.pings).toBe(2);
    socket.socket.close();
  });

  it('answers under its own name only, and to WebSocket only', async () => {
    const url = new URL(fake.socketUrl);
    const wrong = new WebSocket(`ws://127.0.0.1:${url.port}/?v=3`);
    const failed = await new Promise<boolean>((resolve) => {
      wrong.on('error', () => resolve(true));
      wrong.on('open', () => resolve(false));
    });
    expect(failed).toBe(true);
    const plain = await call(fake, 'GET', '', { port: Number(url.port), host: url.host, target: '/' });
    expect(plain.status).toBe(426);
  });
});

describe('the fake Fansly socket: events', () => {
  it('`5/1`: a fan’s message — `{t: 10000}` → `{serviceId: 5, event}` → `{type: 1, message}`, each level a JSON string', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    const result = fake.command({ op: 'message', groupId: groupA, text: 'stand line' });
    const frame = await socket.next(isEvent(SERVICE.message, EVENT.message.created));
    const wrapper = JSON.parse(frame) as { t: number; d: string };
    expect(wrapper.t).toBe(10000);
    const service = JSON.parse(wrapper.d) as { serviceId: number; event: string };
    expect(service.serviceId).toBe(5);
    expect(typeof service.event).toBe('string');
    const message = (JSON.parse(service.event) as { type: number; message: WireMessage }).message;
    expect(message).toEqual(result.message);
    expect(message).toMatchObject({ groupId: groupA, senderId: fanA, content: 'stand line', type: 1 });
    expect(Math.abs(message.createdAt - Date.now() / 1000)).toBeLessThan(5);
    // It is in the history too, and unread for the creator.
    const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`))).response as WireHistoryPage;
    expect(fresh.messages[0]?.id).toBe(message.id);
    socket.socket.close();
  });

  it('a message can be an automated one, carry a `correlationId`, an old `createdAt` or a given id; `silent` keeps it off the socket', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    const automated = fake.command({ op: 'message', groupId: groupA, text: 'Stand welcome: thanks for the follow', from: 'creator', type: 2, correlationId: '806000000000000011', createdAt: 1_700_000_000 }).message as WireMessage;
    expect(automated).toMatchObject({ senderId: ids.creator, type: 2, correlationId: '806000000000000011', inReplyTo: null, createdAt: 1_700_000_000 });
    await socket.next(isEvent(SERVICE.message, EVENT.message.created));
    const long = fake.command({ op: 'message', groupId: groupA, text: 'a 19-digit id', id: '1000000000000000123', silent: true }).message as WireMessage;
    expect(long.id).toBe('1000000000000000123');
    await pause(50);
    expect(socket.frames.filter(isEvent(SERVICE.message, EVENT.message.created))).toHaveLength(1);
    // The silent one is the newest of the history all the same: a 19-digit id is newer than any 18-digit one.
    const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`))).response as WireHistoryPage;
    expect(fresh.messages[0]?.id).toBe('1000000000000000123');
    socket.socket.close();
  });

  it('`5/10`: ONE frame for a deleted mass send’s parent (`type 3`); its copies leave every conversation on the server', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    const sent = fake.command({ op: 'broadcast', text: 'Stand mass send', groupIds: [groupA, groupB] });
    const parent = sent.message as WireMessage;
    expect(parent).toMatchObject({ type: 3, senderId: ids.creator, correlationId: null });
    expect(sent.messages?.map((copy) => [copy.groupId, copy.correlationId, copy.inReplyTo, copy.type])).toEqual([
      [groupA, parent.id, null, 1],
      [groupB, parent.id, null, 1],
    ]);
    const other = fake.command({ op: 'message', groupId: groupC, text: 'unrelated', from: 'creator' }).message as WireMessage;
    await socket.next((frame) => serviceEvent(frame)?.event['message'] !== undefined && (serviceEvent(frame)?.event['message'] as WireMessage).id === other.id);
    const before = socket.frames.length;

    const deleted = fake.command({ op: 'delete', messageId: parent.id });
    expect(deleted.messages?.map((copy) => copy.groupId)).toEqual([groupA, groupB]);
    const frame = serviceEvent(await socket.next(isEvent(SERVICE.message, EVENT.message.deleted)));
    expect(frame?.event['message']).toMatchObject({ id: parent.id, type: 3 });
    await pause(50);
    expect(socket.frames).toHaveLength(before + 1);
    for (const groupId of [groupA, groupB]) {
      const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupId}&limit=25`))).response as WireHistoryPage;
      expect(fresh.messages.some((message) => message.correlationId === parent.id)).toBe(false);
    }
    const kept = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupC}&limit=25`))).response as WireHistoryPage;
    expect(kept.messages[0]?.id).toBe(other.id);

    // A plain message goes alone.
    const plain = fake.command({ op: 'delete', messageId: other.id });
    expect(plain.messages).toEqual([]);
    expect(serviceEvent(await socket.next(isEvent(SERVICE.message, EVENT.message.deleted)))?.event['message']).toMatchObject({ id: other.id, type: 1 });
    expect(() => fake.command({ op: 'delete', messageId: other.id })).toThrow(/no message/);
    socket.socket.close();
  });

  it('`4/2`: a receipt as production sends it — GroupService, `{type: 2, ackCommand}`', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    const own = fake.command({ op: 'message', groupId: groupA, text: 'read me', from: 'creator' }).message as WireMessage;
    fake.command({ op: 'ack', messageIds: [own.id] });
    const receipt = serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.ack)));
    expect(receipt).toEqual({ serviceId: 4, event: { type: 2, ackCommand: { type: 2, userId: fanA, messageIds: [own.id] } } });
    fake.command({ op: 'ack', messageIds: [own.id], type: 1, userId: fanA });
    expect(serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.ack)))?.event['ackCommand']).toMatchObject({ type: 1 });
    socket.socket.close();
  });

  it('`5/22` typing and `3/2` a new follower', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    fake.command({ op: 'typing', groupId: groupB });
    const typing = serviceEvent(await socket.next(isEvent(SERVICE.message, EVENT.message.typing)));
    expect(typing?.event).toMatchObject({ type: 22, typingAnnounceEvent: { accountId: ids.fans[groupB], groupId: groupB } });
    expect(Math.abs(Number((typing?.event['typingAnnounceEvent'] as { lastAnnounce: number }).lastAnnounce) - Date.now())).toBeLessThan(5000);

    const follow = fake.command({ op: 'follow' }).follow as WireFollow;
    expect(follow).toMatchObject({ accountId: ids.creator });
    expect(follow.followerId).toMatch(/^\d{18}$/);
    expect(serviceEvent(await socket.next(isEvent(SERVICE.follower, EVENT.follower.followed)))?.event).toEqual({ type: 2, follow });
    // The newest of the followers' list now.
    const page = (await call<{ followers: Array<{ id: string }> }>(fake, 'GET', bypass(`/account/${ids.creator}/followersnew?before=0&limit=100`))).response;
    expect(page?.followers[0]?.id).toBe(follow.id);
    socket.socket.close();
  });

  it('`4/6` and `4/7`: members come and leave a group', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    fake.command({ op: 'group', groupId: groupA, partners: 2 });
    const added = serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.userAdded)));
    const guest = (added?.event['groupUser'] as { userId: string }).userId;
    expect(added?.event['groupUser']).toMatchObject({ groupId: groupA });
    expect(guest).not.toBe(fanA);
    fake.command({ op: 'group', groupId: groupA, partners: 1 });
    expect(serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.userRemoved)))?.event['groupUser']).toMatchObject({ groupId: groupA, userId: guest });
    socket.socket.close();
  });

  it('a batch is `t: 10001` with an ARRAY of wrapper strings; a damaged frame goes out as it is', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    const inner = [serviceFrame(SERVICE.message, { type: 22, typingAnnounceEvent: { accountId: fanA, groupId: groupA, lastAnnounce: 1 } }), serviceFrame(SERVICE.follower, { type: 2, follow: { id: '808000000000000031', accountId: ids.creator, followerId: fanA } })];
    expect(fake.command({ op: 'frames', frames: inner, batch: true }).sent).toBe(1);
    const batch = await socket.next((frame) => frameType(frame) === FRAME.batch);
    const wrapper = JSON.parse(batch) as { t: number; d: unknown };
    expect(wrapper.d).toEqual(inner);
    expect(parseFrame(batch)).toEqual({ t: 10001, frames: inner });

    const damaged = ['{"t":10000,"d":"{\\"serviceId\\":5,\\"event\\":\\"{broken"}', '{"t":10001,"d":"not an array"}', 'not json at all', '{"t":777,"d":"{}"}'];
    fake.command({ op: 'frames', frames: damaged });
    await socket.next((frame) => frame === damaged[3]);
    expect(socket.frames.slice(-4)).toEqual(damaged);
    expect(() => parseFrame(damaged[0] as string)).toThrow();
    expect(() => parseFrame(damaged[2] as string)).toThrow();
    expect(parseFrame(damaged[3] as string)).toBeNull();
    socket.socket.close();
  });

  it('the control’s frames are journaled as one entry each, never as the page’s traffic', async () => {
    const socket = await openSocket(fake);
    await socket.next(isSession);
    since = fake.journal.next;
    fake.command({ op: 'typing', groupId: groupA });
    fake.command({ op: 'frames', frames: ['a', 'b'], batch: true });
    expect(fake.journal.read(since).entries.map((entry) => [entry.kind, entry.caller, entry.detail])).toEqual([
      ['ws-out', 'control', { frame: '5/22', frames: 1, batch: false, sockets: 1 }],
      ['ws-out', 'control', { frame: 'raw', frames: 2, batch: true, sockets: 1 }],
    ]);
    socket.socket.close();
  });
});
