// The fake Fansly's API on its own (R20 P6b): the envelope, the session, CORS
// for the stand page, every endpoint the page and our background ask, the
// send's echo, and the outcomes a test scripts (429, a refusal inside 200, a
// lost answer). The journal and its checks are journal.test.ts; the socket is
// socket.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import { EVENT, SERVICE, compareIds, snowflakeMs, type WireAccount, type WireAccountMe, type WireAutomatedMessage, type WireFollow, type WireFollowersPage, type WireGroup, type WireHistoryPage, type WireInboxPage, type WireMessage, type WireNote, type WireUnreadPage, type WireVaultAlbumMediaPage, type WireVaultAlbums } from '../../fixture-fansly/src/wire';
import { STAND_COOKIE } from './api';
import { SEED_FOLLOWERS, SEED_FOLLOWERS_WITH_CHAT } from './data';
import type { FakeFansly } from './index';
import { PAGE_ORIGIN, bypass, call, isEvent, openSocket, serviceEvent, startTestFansly } from './kit';

const ids = standIds(createWorld());
const [groupA, groupB] = ids.groups as [string, string];
const fanA = ids.fans[groupA] as string;

let fake: FakeFansly;

beforeAll(async () => {
  fake = await startTestFansly();
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.command({ op: 'reset' });
  fake.command({ op: 'socket', verifyDelayMs: 0 });
});

/** Every string that is all digits and at least 15 long is an id; a number that large would have lost its digits. */
function idsOf(value: unknown, found: { ids: string[]; unsafe: number[] } = { ids: [], unsafe: [] }): { ids: string[]; unsafe: number[] } {
  if (typeof value === 'string' && /^\d{15,}$/.test(value)) found.ids.push(value);
  else if (typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value)) found.unsafe.push(value);
  else if (Array.isArray(value)) for (const item of value) idsOf(item, found);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) idsOf(item, found);
  return found;
}

describe('the fake Fansly API: envelope, session, CORS', () => {
  it('answers in Fansly’s envelope under `/api/v1`, with the creator of the stand’s world', async () => {
    const me = await call<WireAccountMe>(fake, 'GET', bypass('/account/me'));
    expect(me.status).toBe(200);
    expect(me.json).toMatchObject({ success: true });
    expect(me.response?.account).toMatchObject({ id: ids.creator, username: 'stand_creator' });
    expect(me.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('needs a live session: no token or another one is 401 with the error envelope', async () => {
    for (const token of [null, 'somebody-else']) {
      const refused = await call(fake, 'GET', bypass('/account/me'), { token });
      expect(refused.status).toBe(401);
      expect(refused.json).toEqual({ success: false, error: { code: 401, details: 'no session' } });
    }
    fake.command({ op: 'session', expire: true });
    expect((await call(fake, 'GET', bypass('/account/me'))).status).toBe(401);
  });

  it('answers under its own loopback name only (421), and has nothing outside `/api/v1`', async () => {
    const api = new URL(fake.apiOrigin);
    expect((await call(fake, 'GET', bypass('/account/me'), { host: `127.0.0.1:${api.port}` })).status).toBe(421);
    expect((await call(fake, 'GET', '', { target: '/messages' })).status).toBe(404);
    const unknown = await call(fake, 'GET', bypass('/timelinenew/1'));
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ success: false, error: { code: 404 } });
  });

  it('is cross-origin for the page as apiv3 is: a preflight and credentials for the stand page’s origin, nothing for another', async () => {
    const preflight = await call(fake, 'OPTIONS', bypass('/message'), { token: null, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,fansly-client-check,fansly-client-id,fansly-client-ts,fansly-session-id' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(PAGE_ORIGIN);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    const allowed = String(preflight.headers['access-control-allow-headers']);
    for (const name of ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id', 'fansly-client-check', 'content-type']) expect(allowed).toContain(name);
    const page = await call(fake, 'GET', bypass('/account/me'));
    expect(page.headers['access-control-allow-origin']).toBe(PAGE_ORIGIN);
    // The page's requests carry credentials: the API gives it a cookie. A request of ours must never bring it back (journal.test.ts).
    expect(String(page.headers['set-cookie'])).toContain(`${STAND_COOKIE}=`);
    const stranger = await call(fake, 'GET', bypass('/account/me'), { as: 'stranger' });
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
    const ours = await call(fake, 'GET', bypass('/account/me'), { as: 'ours' });
    expect(ours.status).toBe(200);
    expect(ours.headers['set-cookie']).toBeUndefined();
  });
});

describe('the fake Fansly API: what the page asks', () => {
  it('`/messaging/groups`: 20 a page, newest conversation first, with `aggregationData` groups and accounts', async () => {
    const first = await call<WireInboxPage>(fake, 'GET', bypass('/messaging/groups?sortOrder=1&flags=0&subscriptionTierId=&listIds=&search=&limit=20&offset=0'));
    const page = first.response as WireInboxPage;
    expect(page.data).toHaveLength(20);
    expect(page.aggregationData.groups.map((group) => group.id)).toEqual(page.data.map((entry) => entry.groupId));
    const last = page.data.map((entry) => entry.lastMessageId ?? '');
    expect([...last].sort((a, b) => compareIds(b, a))).toEqual(last);
    const entry = page.data.find((item) => item.groupId === groupA);
    expect(entry).toMatchObject({ partnerAccountId: fanA, partnerUsername: 'stand fan 1', flags: 0 });
    const group = page.aggregationData.groups.find((item) => item.id === groupA) as WireGroup;
    expect(group.users.map((user) => user.userId).sort()).toEqual([ids.creator, fanA].sort());
    expect(group.lastMessage?.id).toBe(entry?.lastMessageId);
    expect(group.dmPermissionFlags).toEqual([]);
    const account = page.aggregationData.accounts.find((item) => item.id === fanA) as WireAccount;
    expect(account).toMatchObject({ username: 'stand_fan_1', displayName: 'Stand Fan 1' });
    // An avatar is an address on Fansly's CDN: data, never loaded by the stand.
    expect(account.avatar?.locations[0]?.location).toMatch(/^https:\/\/cdn3\.fansly\.com\/\d+\/\d+\.jpeg$/);
    const unread = page.data.filter((item) => item.unreadCount > 0);
    expect(unread.length).toBeGreaterThan(0);
    for (const item of unread) expect(item.lastUnreadMessageId).toMatch(/^\d{18}$/);

    const second = (await call<WireInboxPage>(fake, 'GET', bypass('/messaging/groups?sortOrder=1&flags=0&limit=20&offset=20'))).response as WireInboxPage;
    expect(second.data).toHaveLength(20);
    expect(second.data.some((item) => page.data.some((known) => known.groupId === item.groupId))).toBe(false);
    const search = (await call<WireInboxPage>(fake, 'GET', bypass('/messaging/groups?sortOrder=1&flags=0&search=Stand%20Fan%2017&limit=100&offset=0'))).response as WireInboxPage;
    expect(search.data.map((item) => item.partnerUsername)).toEqual(['stand fan 17']);
  });

  it('`/group/<id>/` with the slash and without: the same group; an unknown one is 404', async () => {
    const slash = await call<WireGroup>(fake, 'GET', bypass(`/group/${groupA}/`));
    const bare = await call<WireGroup>(fake, 'GET', bypass(`/group/${groupA}`));
    expect(slash.response).toEqual(bare.response);
    expect(slash.response).toMatchObject({ id: groupA, type: 1, createdBy: fanA, hasDmPermissionFlags: false, sendReadReceipts: true });
    expect(slash.response?.users).toHaveLength(2);
    expect((await call(fake, 'GET', bypass('/group/801000000000000001/'))).status).toBe(404);
  });

  it('`/group/<id>/` carries the partner’s DM rules when they are not met', async () => {
    fake.command({ op: 'group', groupId: groupB, dmRulesUnmet: true });
    const group = (await call<WireGroup>(fake, 'GET', bypass(`/group/${groupB}/`))).response as WireGroup;
    expect(group.hasDmPermissionFlags).toBe(true);
    expect(group.dmPermissionFlags).toEqual([expect.objectContaining({ accountId: ids.fans[groupB], flags: 2, verificationFlags: 0 })]);
  });

  it('`/message?groupId=`: the fresh end is the newest 25, newest first; `before` walks to the start; the arrays the page walks are there', async () => {
    const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${ids.longHistory}&limit=25`))).response as WireHistoryPage;
    expect(fresh.messages).toHaveLength(25);
    const order = fresh.messages.map((message) => message.id);
    expect([...order].sort((a, b) => compareIds(b, a))).toEqual(order);
    for (const name of ['tips', 'stories', 'accountMedia', 'accountMediaBundles', 'accountMediaOrders', 'storyOrders'] as const) expect(fresh[name]).toEqual([]);
    expect(fresh.messages[0]).toMatchObject({ groupId: ids.longHistory, type: 1, dataVersion: 1, correlationId: null, inReplyTo: null, attachments: [], embeds: [], likes: [], totalTipAmount: 0 });
    // `before=0` is the fresh end too (the page's own «no cursor»).
    const zero = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${ids.longHistory}&before=0&limit=25`))).response as WireHistoryPage;
    expect(zero.messages.map((message) => message.id)).toEqual(order);

    const sizes = [25];
    let oldest = order.at(-1) as string;
    for (;;) {
      const page = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${ids.longHistory}&before=${oldest}&limit=25`))).response as WireHistoryPage;
      sizes.push(page.messages.length);
      if (page.messages.length === 0) break;
      for (const message of page.messages) expect(compareIds(message.id, oldest)).toBeLessThan(0);
      oldest = page.messages.at(-1)?.id as string;
    }
    // 90 messages: three full pages, a short one, then the empty page a pass stops at.
    expect(sizes).toEqual([25, 25, 25, 15, 0]);
    expect((await call(fake, 'GET', bypass('/message?limit=25'))).status).toBe(400);
  });

  it('a short conversation’s fresh end is shorter than 25: the start of the conversation is in it', async () => {
    const short = createWorld().groups.find((group) => group.history.length < 25);
    const page = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${short?.id ?? ''}&limit=25`))).response as WireHistoryPage;
    expect(page.messages).toHaveLength(short?.history.length ?? -1);
  });

  it('`/messages?ids=` gives the messages named; `/message/unread` the creator’s unread ones, a chunk at a time by `before`', async () => {
    const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`))).response as WireHistoryPage;
    const two = fresh.messages.slice(0, 2).map((message) => message.id);
    const byIds = (await call<WireHistoryPage>(fake, 'GET', bypass(`/messages?ids=${two.join(',')},801000000000000001`))).response as WireHistoryPage;
    expect(byIds.messages.map((message) => message.id).sort()).toEqual([...two].sort());

    const all = (await call<WireUnreadPage>(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'))).response as WireUnreadPage;
    expect(all.total).toBe(all.messageInteractions.length);
    expect(all.total).toBeGreaterThan(10);
    expect(all.messageInteractions[0]).toMatchObject({ userId: ids.creator, readAt: 0, deliveredAt: 0, deletedAt: null, validMessage: true });
    const chunk = (await call<WireUnreadPage>(fake, 'GET', bypass('/message/unread?limit=5&offset=0&before=0'))).response as WireUnreadPage;
    expect(chunk.messageInteractions).toHaveLength(5);
    expect(chunk.total).toBe(all.total);
    const next = (await call<WireUnreadPage>(fake, 'GET', bypass(`/message/unread?limit=5&offset=0&before=${chunk.messageInteractions.at(-1)?.messageId ?? ''}`))).response as WireUnreadPage;
    expect(next.messageInteractions.map((item) => item.messageId)).toEqual(all.messageInteractions.slice(5, 10).map((item) => item.messageId));
  });

  it('`POST /message` stores the message, answers with it and echoes it on the socket (`5/1`)', async () => {
    const socket = await openSocket(fake);
    await socket.next((frame) => frame.startsWith('{"t":1'));
    const before = Date.now();
    const sent = await call<WireMessage>(fake, 'POST', bypass('/message'), { body: { type: 1, attachments: [], likes: [], content: 'stand hello', groupId: groupA, scheduledFor: 0, inReplyTo: null, createdAt: Date.now() / 1000 } });
    const message = sent.response as WireMessage;
    expect(message).toMatchObject({ groupId: groupA, senderId: ids.creator, content: 'stand hello', type: 1 });
    expect(message.id).toMatch(/^\d{18,19}$/);
    // A fresh id is a snowflake of now: newer than everything the world started with.
    expect(Math.abs(snowflakeMs(message.id) - before)).toBeLessThan(5000);
    const echo = serviceEvent(await socket.next(isEvent(SERVICE.message, EVENT.message.created)));
    expect((echo?.event['message'] as WireMessage).id).toBe(message.id);
    const fresh = (await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`))).response as WireHistoryPage;
    expect(fresh.messages[0]?.id).toBe(message.id);
    expect((await call(fake, 'POST', bypass('/message'), { body: { content: 'nowhere', groupId: '801000000000000001' } })).status).toBe(404);
    socket.socket.close();
  });

  it('the echo of a send comes after its answer, before it, or not at all — as a test sets it', async () => {
    const socket = await openSocket(fake);
    await socket.next((frame) => frame.startsWith('{"t":1'));
    const body = (content: string) => ({ type: 1, attachments: [], likes: [], content, groupId: groupA, scheduledFor: 0, inReplyTo: null, createdAt: 0 });
    const created = isEvent(SERVICE.message, EVENT.message.created);

    fake.command({ op: 'send', echo: 'before', receiptDelayMs: 150 });
    const started = Date.now();
    const answer = call<WireMessage>(fake, 'POST', bypass('/message'), { body: body('echo first') });
    await socket.next(created);
    const echoAt = Date.now() - started;
    await answer;
    expect(echoAt).toBeLessThan(140);
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);

    fake.command({ op: 'send', echo: 'after', receiptDelayMs: 0, echoDelayMs: 150 });
    const count = socket.frames.filter(created).length;
    await call(fake, 'POST', bypass('/message'), { body: body('answer first') });
    expect(socket.frames.filter(created)).toHaveLength(count);
    await socket.next(created);

    fake.command({ op: 'send', echo: 'none', echoDelayMs: 0 });
    await call(fake, 'POST', bypass('/message'), { body: body('no echo') });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(socket.frames.filter(created)).toHaveLength(count + 1);
    socket.socket.close();
  });

  it('`POST /message/ack` (the page’s own) clears the unread marks and tells the account’s sockets (`4/2`)', async () => {
    const socket = await openSocket(fake);
    await socket.next((frame) => frame.startsWith('{"t":1'));
    const unread = (await call<WireUnreadPage>(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'))).response as WireUnreadPage;
    const some = unread.messageInteractions.slice(0, 3).map((item) => item.messageId);
    const since = fake.journal.next;
    const acked = await call(fake, 'POST', bypass('/message/ack'), { body: { messageIds: some, type: 2 } });
    expect(acked.json).toEqual({ success: true, response: {} });
    // The journal keeps WHAT was marked — the ids and the kind of mark: the page sends its marks in chunks, so a
    // test compares the marks, not the number of calls.
    expect(fake.journal.calls('page', since).map((entry) => [entry.route, entry.status, entry.detail?.['ackType'], entry.detail?.['messageIds']])).toEqual([['message.ack', 200, 2, some]]);
    const receipt = serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.ack)));
    expect(receipt?.event['ackCommand']).toEqual({ type: 2, userId: ids.creator, messageIds: some });
    const after = (await call<WireUnreadPage>(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'))).response as WireUnreadPage;
    expect(after.total).toBe(unread.total - 3);
    expect((await call(fake, 'POST', bypass('/message/ack'), { body: { messageIds: [], type: 2 } })).status).toBe(400);
    socket.socket.close();
  });

  it('`/message/automated`: the creator’s automations, their text inside `messageTemplate` (a JSON string)', async () => {
    const automated = (await call<WireAutomatedMessage[]>(fake, 'GET', bypass('/message/automated'))).response as WireAutomatedMessage[];
    const texts = automated.map((item) => (JSON.parse(item.messageTemplate) as { content: string | null }).content);
    expect(texts).toEqual(['Stand welcome: thanks for the follow', 'Stand welcome: thanks for subscribing', null]);
    expect((await call(fake, 'POST', bypass('/message/typing'), { body: { groupId: groupA } })).json).toEqual({ success: true, response: {} });
  });
});

describe('the fake Fansly API: «Новые», notes, vault', () => {
  it('`followersnew`: newest first, 100 a page by `before`, with the followers’ accounts; another creator’s list is empty', async () => {
    const first = (await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${ids.creator}/followersnew?before=0&after=0&limit=100&offset=0&search=&lastSeenAfter=`))).response as WireFollowersPage;
    expect(first.followers).toHaveLength(100);
    expect(first.aggregationData.accounts).toHaveLength(100);
    const order = first.followers.map((follow) => follow.id);
    expect([...order].sort((a, b) => compareIds(b, a))).toEqual(order);
    // The id of a follow is its moment: the newest was minutes before the start, none in the future.
    const newest = snowflakeMs(order[0] as string);
    expect(Date.now() - newest).toBeGreaterThan(60_000);
    expect(Date.now() - newest).toBeLessThan(3_600_000);
    const second = (await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${ids.creator}/followersnew?before=${order.at(-1) ?? ''}&after=0&limit=100&offset=0&search=&lastSeenAfter=`))).response as WireFollowersPage;
    expect(second.followers).toHaveLength(SEED_FOLLOWERS - 100);
    const third = (await call<WireFollowersPage>(fake, 'GET', bypass(`/account/${ids.creator}/followersnew?before=${second.followers.at(-1)?.id ?? ''}&after=0&limit=100&offset=0&search=&lastSeenAfter=`))).response as WireFollowersPage;
    expect(third.followers).toEqual([]);
    expect(((await call<WireFollowersPage>(fake, 'GET', bypass('/account/801000000000000001/followersnew?before=0&limit=100'))).response as WireFollowersPage).followers).toEqual([]);
    // Some followers have a conversation already, most have none yet.
    const inbox = new Set(createWorld().groups.map((group) => group.fan.id));
    expect([...first.followers, ...second.followers].filter((follow) => inbox.has(follow.followerId))).toHaveLength(SEED_FOLLOWERS_WITH_CHAT);
  });

  it('`POST /group` is get-or-create by its two users: the fan’s old conversation, or a new empty one (and a `4/8` frame)', async () => {
    const socket = await openSocket(fake);
    await socket.next((frame) => frame.startsWith('{"t":1'));
    const body = (fanId: string) => ({ users: [{ userId: fanId, permissionFlags: 0 }, { userId: ids.creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 });
    const known = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(fanA) })).response as WireGroup;
    expect(known.id).toBe(groupA);
    expect(known.lastMessage).not.toBeNull();

    const stranger = '931000000000000123';
    const created = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(stranger) })).response as WireGroup;
    expect(created.id).not.toBe(stranger);
    expect(created.id).toMatch(/^\d{18,19}$/);
    expect(created.lastMessage).toBeNull();
    expect(created.users.map((user) => user.userId).sort()).toEqual([ids.creator, stranger].sort());
    expect(created.users.find((user) => user.userId === ids.creator)?.userSettings).toEqual({ customName: '', hidden: 0 });
    expect(serviceEvent(await socket.next(isEvent(SERVICE.group, EVENT.group.created)))?.event['id']).toBe(created.id);
    const again = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(stranger) })).response as WireGroup;
    expect(again.id).toBe(created.id);
    expect((await call(fake, 'POST', bypass('/group'), { body: { users: [{ userId: ids.creator }] } })).status).toBe(400);
    expect((await call(fake, 'POST', bypass('/group'), { body: { users: [{ userId: fanA }, { userId: ids.creator }] } })).status).toBe(400);
    socket.socket.close();
  });

  it('a follower whose DMs are closed to the creator (R20 P10b2): the chat `POST /group` makes carries the unmet rules', async () => {
    const body = (fanId: string) => ({ users: [{ userId: fanId, permissionFlags: 0 }, { userId: ids.creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 });
    const follow = fake.command({ op: 'follow', silent: true, dmRulesUnmet: true }).follow as WireFollow;
    const closed = (await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(follow.followerId) })).response as WireGroup;
    expect(closed.dmPermissionFlags).toEqual([expect.objectContaining({ accountId: follow.followerId, flags: 2, verificationFlags: 0 })]);
    const open = fake.command({ op: 'follow', silent: true }).follow as WireFollow;
    expect(((await call<WireGroup>(fake, 'POST', bypass('/group'), { body: body(open.followerId) })).response as WireGroup).dmPermissionFlags).toEqual([]);
  });

  it('`/account?ids=` gives accounts with the creator’s notes; notes are created, edited and deleted by Fansly’s own endpoints', async () => {
    const created = (await call<WireNote>(fake, 'POST', bypass('/notes'), { body: { contentType: 12000, contentId: fanA, title: 'Stand note', note: 'Likes: stand things' } })).response as WireNote;
    expect(created).toMatchObject({ contentType: 12000, contentId: fanA, accountId: ids.creator, title: 'Stand note', note: 'Likes: stand things' });
    const name = (await call<WireNote>(fake, 'POST', bypass('/notes'), { body: { contentType: 12002, contentId: fanA, title: 'Custom Username', note: 'Stand nickname' } })).response as WireNote;
    const accounts = (await call<WireAccount[]>(fake, 'GET', bypass(`/account?ids=${fanA},${String(ids.fans[groupB])},801000000000000001`))).response as WireAccount[];
    expect(accounts.map((account) => account.id)).toEqual([fanA, ids.fans[groupB]]);
    expect(accounts[0]?.notes.map((note) => [note.id, note.contentType])).toEqual([
      [created.id, 12000],
      [name.id, 12002],
    ]);
    expect(accounts[1]?.notes).toEqual([]);

    const edited = (await call<WireNote>(fake, 'POST', bypass('/notes/edit'), { body: { id: created.id, contentType: 12000, contentId: fanA, title: 'Stand note', note: 'Likes: other things' } })).response as WireNote;
    expect(edited).toMatchObject({ id: created.id, note: 'Likes: other things' });
    expect(edited.updatedAt).not.toBeNull();
    // A delete has nothing to hand back: `success` is its whole answer.
    const deleted = await call(fake, 'POST', bypass('/notes/delete'), { body: { id: name.id, contentType: 12002, contentId: fanA, title: 'Custom Username', note: 'Stand nickname' } });
    expect(deleted.json).toEqual({ success: true });
    const after = (await call<WireAccount[]>(fake, 'GET', bypass(`/account?ids=${fanA}`))).response as WireAccount[];
    expect(after[0]?.notes.map((note) => note.id)).toEqual([created.id]);
    expect((await call(fake, 'POST', bypass('/notes/edit'), { body: { id: '801000000000000001', title: 'x', note: 'y' } })).status).toBe(404);
  });

  it('the vault: albums, and media added to one (the page checks only `success`)', async () => {
    const albums = (await call<WireVaultAlbums>(fake, 'GET', bypass('/vault/albumsnew'))).response as WireVaultAlbums;
    expect(albums.albums.map((album) => album.title)).toEqual(['Stand album', 'Stand album 2']);
    const album = albums.albums[0]?.id as string;
    const added = await call(fake, 'POST', bypass('/vault/albums/media'), { body: { albumId: album, mediaIds: ['841000000000000001'] } });
    expect(added.json).toEqual({ success: true, response: {} });
    const after = (await call<WireVaultAlbums>(fake, 'GET', bypass('/vault/albums'))).response as WireVaultAlbums;
    expect(after.albums[0]).toMatchObject({ id: album, itemCount: 1, lastItemId: '841000000000000001' });
    expect((await call(fake, 'POST', bypass('/vault/albums/media'), { body: { albumId: '801000000000000001', mediaIds: ['1'] } })).status).toBe(404);
  });

  it('the vault: an uploaded file is a medium with its name; an album lists its media the newest first, with the media they name (R20 P13a)', async () => {
    const album = '807000000000000022';
    expect((await call<WireVaultAlbumMediaPage>(fake, 'GET', bypass(`/media/vaultnew?albumId=${album}&mediaType=0&search=&before=0&after=0`))).response).toEqual({ albumMedia: [], media: [] });
    const created = (await call<Array<{ contentId: string }>>(fake, 'POST', bypass('/account/media'), { body: [{ name: 'IMG_1.JPG', type: 'image/jpeg', size: 10 }, { name: 'clip.mp4', type: 'video/mp4', size: 20 }] })).response as Array<{ contentId: string }>;
    const [first, second] = created.map((item) => item.contentId);
    await call(fake, 'POST', bypass('/vault/albums/media'), { body: { albumId: album, mediaIds: [first] } });
    await call(fake, 'POST', bypass('/vault/albums/media'), { body: { albumId: album, mediaIds: [second] } });
    const page = (await call<WireVaultAlbumMediaPage>(fake, 'GET', bypass(`/media/vaultnew?albumId=${album}&mediaType=0&search=&before=0&after=0`))).response as WireVaultAlbumMediaPage;
    expect(page.albumMedia.map((item) => [item.albumId, item.mediaId])).toEqual([
      [album, second],
      [album, first],
    ]);
    expect(page.media.map((item) => [item.id, item.filename, item.mimetype])).toEqual([
      [second, 'clip.mp4', 'video/mp4'],
      [first, 'IMG_1.JPG', 'image/jpeg'],
    ]);
    // A type album keeps nothing here; an album that does not exist is not found.
    expect((await call<WireVaultAlbumMediaPage>(fake, 'GET', bypass('/media/vaultnew?type=1000&before=0&after=0'))).response).toEqual({ albumMedia: [], media: [] });
    expect((await call(fake, 'GET', bypass('/media/vaultnew?albumId=801000000000000001&mediaType=0'))).status).toBe(404);
  });

  it('every id in every answer is a string of 17–19 digits; no number is too large to be exact', async () => {
    const paths = ['/account/me', '/messaging/groups?limit=20&offset=0', `/group/${groupA}/`, `/message?groupId=${ids.longHistory}&limit=25`, '/message/unread?limit=100&offset=0&before=0', `/account/${ids.creator}/followersnew?before=0&limit=100`, `/account?ids=${fanA}`, '/message/automated', '/vault/albumsnew', '/media/vaultnew?albumId=807000000000000021&mediaType=0'];
    let seen = 0;
    for (const path of paths) {
      const answer = await call(fake, 'GET', bypass(path));
      const found = idsOf(answer.json);
      expect(found.unsafe, path).toEqual([]);
      for (const id of found.ids) expect(id, path).toMatch(/^[1-9]\d{16,18}$/);
      seen += found.ids.length;
    }
    expect(seen).toBeGreaterThan(500);
  });
});

describe('the fake Fansly API: scripted outcomes', () => {
  it('429 with `Retry-After` for the next call of a route, then the normal answer again', async () => {
    fake.command({ op: 'api', rules: [{ route: 'message.unread', times: 1, outcome: { kind: 'status', status: 429, retryAfterS: 7 } }] });
    const limited = await call(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('7');
    expect(limited.json).toEqual({ success: false, error: { code: 429 } });
    expect((await call(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'))).status).toBe(200);
  });

  it('a rule can be for one caller only: the page is limited, our own call is not', async () => {
    fake.command({ op: 'api', rules: [{ route: '*', caller: 'page', outcome: { kind: 'status', status: 429 } }] });
    expect((await call(fake, 'GET', bypass('/account/me'), { as: 'page' })).status).toBe(429);
    expect((await call(fake, 'GET', bypass('/account/me'), { as: 'ours' })).status).toBe(200);
    expect((await call(fake, 'GET', bypass(`/group/${groupA}`), { as: 'page' })).status).toBe(429);
  });

  it('a refusal inside HTTP 200 (`success: false`), a body that is not JSON, and a dropped connection', async () => {
    fake.command({
      op: 'api',
      rules: [
        { route: 'group.detail', times: 1, outcome: { kind: 'refuse', code: 3 } },
        { route: 'group.detail', times: 1, outcome: { kind: 'garbage' } },
        { route: 'group.detail', times: 1, outcome: { kind: 'drop' } },
      ],
    });
    const refused = await call(fake, 'GET', bypass(`/group/${groupA}/`));
    expect([refused.status, refused.json]).toEqual([200, { success: false, error: { code: 3 } }]);
    const garbage = await call(fake, 'GET', bypass(`/group/${groupA}/`));
    expect([garbage.status, garbage.json]).toEqual([200, null]);
    await expect(call(fake, 'GET', bypass(`/group/${groupA}/`))).rejects.toThrow();
    expect((await call(fake, 'GET', bypass(`/group/${groupA}/`))).status).toBe(200);
  });

  it('a write whose answer is lost: without `effect` nothing was sent; with it the message is stored and echoed, only the answer is gone', async () => {
    const socket = await openSocket(fake);
    await socket.next((frame) => frame.startsWith('{"t":1'));
    const body = (content: string) => ({ type: 1, attachments: [], likes: [], content, groupId: groupA, scheduledFor: 0, inReplyTo: null, createdAt: 0 });
    const newest = async (): Promise<string> => ((await call<WireHistoryPage>(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`))).response as WireHistoryPage).messages[0]?.content ?? '';
    const was = await newest();

    fake.command({ op: 'api', rules: [{ route: 'message.send', times: 1, outcome: { kind: 'drop' } }] });
    await expect(call(fake, 'POST', bypass('/message'), { body: body('never sent') })).rejects.toThrow();
    expect(await newest()).toBe(was);

    fake.command({ op: 'api', rules: [{ route: 'message.send', times: 1, effect: true, outcome: { kind: 'drop' } }] });
    await expect(call(fake, 'POST', bypass('/message'), { body: body('sent, answer lost') })).rejects.toThrow();
    expect(await newest()).toBe('sent, answer lost');
    const echo = serviceEvent(await socket.next(isEvent(SERVICE.message, EVENT.message.created)));
    expect((echo?.event['message'] as WireMessage).content).toBe('sent, answer lost');

    fake.command({ op: 'api', rules: [{ route: 'message.send', times: 1, effect: true, outcome: { kind: 'refuse', code: 9 } }] });
    const refused = await call(fake, 'POST', bypass('/message'), { body: body('stored, refused') });
    expect(refused.json).toEqual({ success: false, error: { code: 9 } });
    expect(await newest()).toBe('stored, refused');
    socket.socket.close();
  });

  it('a delay keeps the normal answer back; a hang never answers until the reset', async () => {
    fake.command({ op: 'api', rules: [{ route: 'account.me', times: 1, outcome: { kind: 'delay', ms: 120 } }] });
    const started = Date.now();
    expect((await call(fake, 'GET', bypass('/account/me'))).status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);

    fake.command({ op: 'api', rules: [{ route: 'account.me', times: 1, outcome: { kind: 'hang' } }] });
    let settled = false;
    const hung = call(fake, 'GET', bypass('/account/me')).then(
      () => 'answered',
      () => 'dropped',
    );
    void hung.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);
    fake.command({ op: 'reset' });
    expect(await hung).toBe('dropped');
  });
});
