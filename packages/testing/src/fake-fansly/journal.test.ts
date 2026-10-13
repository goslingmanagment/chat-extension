// The fake Fansly's journal and the checks that live on the server (R20 P6b;
// spec.md FS-NET-1, architecture.md §8.3, §13): who made a call, how it came,
// and whether a call of OURS broke a rule — outside the list FS-NET-1, a
// `POST /message/ack`, an address without `ngsw-bypass=true`, a cookie, a
// socket of our own. A request without `Origin` is ours: that is how an
// extension page with the host permission asks, and how these tests play it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createWorld, standIds } from '../../fixture-fansly/src/data';
import { STAND_COOKIE } from './api';
import type { FakeFansly } from './index';
import { FS_NET_1, FanslyJournal, classifyCaller, describeViolations, violationsOf, type FanslyJournalEntry } from './journal';
import { PAGE_ORIGIN, bypass, call, openSocket, startTestFansly } from './kit';

const ids = standIds(createWorld());
const [groupA] = ids.groups as [string];
const fanA = ids.fans[groupA] as string;

let fake: FakeFansly;
let since = 0;

beforeAll(async () => {
  fake = await startTestFansly();
});

afterAll(async () => {
  await fake.close();
});

beforeEach(() => {
  fake.command({ op: 'reset' });
  fake.command({ op: 'socket', verifyDelayMs: 0 });
  since = fake.journal.next;
});

const reasons = (): string[] => fake.journal.violations(since).map((violation) => `${violation.reason}: ${violation.what.replace(/[?&]ngsw-bypass=true/, '')}`);

describe('who made a call', () => {
  it('is told by the control header, a named token, the stand page’s `Origin`, or the absence of one', () => {
    const facts = { origin: undefined, control: false, tokenLabel: null } as const;
    expect(classifyCaller({ ...facts, origin: PAGE_ORIGIN }, PAGE_ORIGIN)).toBe('page');
    expect(classifyCaller(facts, PAGE_ORIGIN)).toBe('ours');
    expect(classifyCaller({ ...facts, origin: 'null' }, PAGE_ORIGIN)).toBe('ours');
    expect(classifyCaller({ ...facts, origin: 'moz-extension://0d5c3f2a-0000-4000-8000-000000000001' }, PAGE_ORIGIN)).toBe('ours');
    expect(classifyCaller({ ...facts, origin: 'http://localhost:1' }, PAGE_ORIGIN)).toBe('foreign');
    expect(classifyCaller({ ...facts, origin: PAGE_ORIGIN, tokenLabel: 'neighbour' }, PAGE_ORIGIN)).toBe('neighbour');
    expect(classifyCaller({ ...facts, origin: PAGE_ORIGIN, control: true }, PAGE_ORIGIN)).toBe('control');
  });

  it('is journaled with the call: method, path with its query, route, status, and how it came', async () => {
    await call(fake, 'GET', bypass('/account/me'), { as: 'page' });
    await call(fake, 'GET', bypass(`/group/${groupA}`), { as: 'ours' });
    await call(fake, 'GET', bypass('/account/me'), { as: 'stranger' });
    await call(fake, 'GET', bypass('/nowhere'), { as: 'page' });
    await call(fake, 'OPTIONS', bypass('/message'), { as: 'page', token: null });
    expect(fake.journal.read(since).entries.map((entry) => [entry.kind, entry.caller, entry.via, entry.method, entry.path, entry.route ?? null, entry.status])).toEqual([
      ['http', 'page', 'direct', 'GET', '/api/v1/account/me?ngsw-bypass=true', 'account.me', 200],
      ['http', 'ours', 'direct', 'GET', `/api/v1/group/${groupA}?ngsw-bypass=true`, 'group.detail', 200],
      ['http', 'foreign', 'direct', 'GET', '/api/v1/account/me?ngsw-bypass=true', 'account.me', 200],
      ['http', 'page', 'direct', 'GET', '/api/v1/nowhere?ngsw-bypass=true', null, 404],
      ['preflight', 'page', 'direct', 'OPTIONS', '/api/v1/message?ngsw-bypass=true', null, 204],
    ]);
    expect(fake.journal.calls('ours', since).map((entry) => entry.route)).toEqual(['group.detail']);
  });

  it('a token issued for a neighbour names its calls, whatever their `Origin`', async () => {
    const token = fake.command({ op: 'session', issue: 'neighbour' }).token as string;
    await call(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'), { as: 'page', token });
    await call(fake, 'POST', bypass('/message/ack'), { as: 'ours', token, body: { messageIds: ['801000000000000001'], type: 2 } });
    expect(fake.journal.calls('neighbour', since).map((entry) => entry.route)).toEqual(['message.unread', 'message.ack']);
    expect(fake.journal.calls('page', since)).toEqual([]);
    expect(fake.journal.calls('ours', since)).toEqual([]);
    // A neighbour's requests are not ours: none of our rules is theirs to break.
    expect(fake.journal.violations(since)).toEqual([]);
  });

  it('control requests are not journaled, and are closed without the control header', async () => {
    const closed = await call(fake, 'POST', '', { target: '/__stand/fansly', body: { op: 'status' } });
    expect(closed.status).toBe(403);
    const open = await call<never>(fake, 'POST', '', { target: '/__stand/fansly', body: { op: 'status' }, headers: { 'x-stand-control': '1' } });
    expect(open.status).toBe(200);
    expect(JSON.parse(open.text)).toMatchObject({ ok: true, status: { creatorId: ids.creator, token: fake.token } });
    expect((await call(fake, 'POST', '', { target: '/__stand/fansly', body: { op: 'message', groupId: '801000000000000001', text: 'x' }, headers: { 'x-stand-control': '1' } })).status).toBe(400);
    expect(fake.journal.read(since).entries).toEqual([]);
  });
});

describe('FS-NET-1 on the server: what our own calls may be', () => {
  it('every call of the list passes: the pass of «Новые», the greeting, Spenders, «Регистрация», «Заметки», the identity', async () => {
    const group = { users: [{ userId: fanA, permissionFlags: 0 }, { userId: ids.creator, permissionFlags: 0 }], recipients: [], lastMessage: null, userSettings: null, type: 1 };
    const note = { contentType: 12000, contentId: fanA, title: 'Stand note', note: 'Stand text' };
    await call(fake, 'GET', bypass('/account/me'), { as: 'ours' });
    await call(fake, 'GET', bypass(`/account/${ids.creator}/followersnew?before=0&after=0&limit=100&offset=0&search=&lastSeenAfter=`), { as: 'ours' });
    await call(fake, 'GET', bypass('/messaging/groups?sortOrder=1&flags=0&subscriptionTierId=&listIds=&search=&limit=100&offset=0'), { as: 'ours' });
    await call(fake, 'GET', bypass(`/account?ids=${fanA}`), { as: 'ours' });
    await call(fake, 'GET', bypass(`/group/${groupA}`), { as: 'ours' });
    await call(fake, 'GET', bypass(`/group/${groupA}/`), { as: 'ours' });
    await call(fake, 'POST', bypass('/group'), { as: 'ours', body: group });
    await call(fake, 'GET', bypass(`/message?groupId=${groupA}&limit=25`), { as: 'ours' });
    await call(fake, 'GET', bypass('/message/automated'), { as: 'ours' });
    await call(fake, 'POST', bypass('/message'), { as: 'ours', body: { type: 1, content: 'Stand greeting', groupId: groupA, attachments: [], likes: [], scheduledFor: 0, inReplyTo: null, createdAt: Date.now() } });
    const created = await call<{ id: string }>(fake, 'POST', bypass('/notes'), { as: 'ours', body: note });
    await call(fake, 'POST', bypass('/notes/edit'), { as: 'ours', body: { ...note, id: created.response?.id } });
    await call(fake, 'POST', bypass('/notes/delete'), { as: 'ours', body: { ...note, id: created.response?.id } });
    const ours = fake.journal.calls('ours', since);
    expect(ours.map((entry) => entry.status)).toEqual(Array.from({ length: 13 }, () => 200));
    expect(new Set(ours.map((entry) => entry.route))).toEqual(new Set(FS_NET_1));
    expect(reasons()).toEqual([]);
  });

  it('`POST /message/ack` from us is a violation of its own: our reads never mark a message read', async () => {
    await call(fake, 'POST', bypass('/message/ack'), { as: 'ours', body: { messageIds: ['801000000000000001'], type: 2 } });
    expect(reasons()).toEqual(['ack: POST /api/v1/message/ack']);
    // The page's own ack is the page's business.
    since = fake.journal.next;
    await call(fake, 'POST', bypass('/message/ack'), { as: 'page', body: { messageIds: ['801000000000000001'], type: 2 } });
    expect(fake.journal.calls('page', since)).toHaveLength(1);
    expect(reasons()).toEqual([]);
  });

  it('a call of ours outside the list is a violation, whatever it is: unread, messages by id, typing, the vault, a path nobody serves', async () => {
    await call(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'), { as: 'ours' });
    await call(fake, 'GET', bypass('/messages?ids=801000000000000001'), { as: 'ours' });
    await call(fake, 'POST', bypass('/message/typing'), { as: 'ours', body: { groupId: groupA } });
    await call(fake, 'GET', bypass('/vault/albumsnew'), { as: 'ours' });
    await call(fake, 'POST', bypass(`/group/${groupA}/`), { as: 'ours', body: { groupId: groupA, groupUsers: [] } });
    await call(fake, 'GET', bypass('/subscribers?status=3'), { as: 'ours' });
    expect(reasons()).toEqual([
      'not-allowlisted: GET /api/v1/message/unread?limit=100&offset=0&before=0',
      'not-allowlisted: GET /api/v1/messages?ids=801000000000000001',
      'not-allowlisted: POST /api/v1/message/typing',
      'not-allowlisted: GET /api/v1/vault/albumsnew',
      `not-allowlisted: POST /api/v1/group/${groupA}/`,
      'not-allowlisted: GET /api/v1/subscribers?status=3',
    ]);
    // The same calls by the page break nothing.
    since = fake.journal.next;
    await call(fake, 'GET', bypass('/message/unread?limit=100&offset=0&before=0'), { as: 'page' });
    await call(fake, 'GET', bypass('/vault/albumsnew'), { as: 'page' });
    expect(reasons()).toEqual([]);
  });

  it('a call of ours without `ngsw-bypass=true`, or with a cookie, is a violation though its route is allowed', async () => {
    await call(fake, 'GET', `/group/${groupA}`, { as: 'ours' });
    await call(fake, 'GET', bypass(`/group/${groupA}`), { as: 'ours', headers: { cookie: `${STAND_COOKIE}=1` } });
    expect(reasons()).toEqual([`ngsw-bypass: GET /api/v1/group/${groupA}`, `credentials: GET /api/v1/group/${groupA}`]);
    // An unauthorised call of ours is still ours: a dead session does not hide a wrong address.
    since = fake.journal.next;
    await call(fake, 'GET', bypass('/message/unread'), { as: 'ours', token: 'stale' });
    expect(fake.journal.calls('ours', since).map((entry) => entry.status)).toEqual([401]);
    expect(reasons()).toEqual(['not-allowlisted: GET /api/v1/message/unread']);
  });

  it('a socket of our own is a violation; the page’s is not', async () => {
    const page = await openSocket(fake, { as: 'page' });
    expect(fake.journal.violations(since)).toEqual([]);
    const ours = await openSocket(fake, { as: 'ours' });
    expect(fake.journal.violations(since).map((violation) => [violation.reason, violation.what])).toEqual([['socket', 'socket']]);
    page.socket.close();
    ours.socket.close();
  });

  it('violations are read by position, with the page of the journal, and described one a line', async () => {
    await call(fake, 'POST', bypass('/message/ack'), { as: 'ours', body: { messageIds: ['801000000000000001'], type: 2 } });
    const page = fake.journal.read(since);
    expect(page.violations).toHaveLength(1);
    expect(describeViolations(page.violations)).toMatch(/^#\d+ ack: POST \/api\/v1\/message\/ack\?ngsw-bypass=true$/);
    expect(fake.journal.read(page.next).violations).toEqual([]);
    const over = await call<never>(fake, 'GET', '', { target: `/__stand/fansly/journal?since=${since}`, headers: { 'x-stand-control': '1' } });
    expect((JSON.parse(over.text) as { violations: unknown[] }).violations).toHaveLength(1);
  });

  it('the checks are a pure rule of the entry: only ours, only what was asked', () => {
    const entry = (over: Partial<FanslyJournalEntry>): FanslyJournalEntry => ({ seq: 1, at: 0, kind: 'http', caller: 'ours', via: 'direct', method: 'GET', path: '/api/v1/account/me?ngsw-bypass=true', route: 'account.me', status: 200, ...over });
    const clean = { ngswBypass: true, cookie: false };
    expect(violationsOf(entry({}), clean)).toEqual([]);
    expect(violationsOf(entry({ via: 'proxy' }), clean)).toEqual([]);
    expect(violationsOf(entry({ route: 'message.ack' }), clean).map((violation) => violation.reason)).toEqual(['ack']);
    expect(violationsOf(entry({ route: null }), clean).map((violation) => violation.reason)).toEqual(['not-allowlisted']);
    expect(violationsOf(entry({ caller: 'page', route: 'message.ack' }), { ngswBypass: false, cookie: true })).toEqual([]);
    expect(violationsOf(entry({ kind: 'preflight' }), clean)).toEqual([]);
    const journal = new FanslyJournal();
    journal.record({ kind: 'http', caller: 'ours', via: 'direct', method: 'POST', path: '/api/v1/message/ack', route: 'message.ack', status: 200 }, { ngswBypass: false, cookie: false });
    expect(journal.violations().map((violation) => violation.reason)).toEqual(['ack', 'ngsw-bypass']);
  });
});
