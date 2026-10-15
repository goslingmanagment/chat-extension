// The XHR observer's response table and its deferred queue (docs/project-unite/
// architecture.md §5.4): which answers of the page MAIN reads — by address and
// form, without a hook on `open` — and how a long one waits for an idle moment
// within bounds.

import { describe, expect, it } from 'vitest';

import { DEFERRED_MAX_CHARS, DEFERRED_MAX_ITEMS } from './protocol';
import { classifyAddress, createResponseQueue, readResponse, type Deferred } from './responses';

const API = ['https://apiv3.fansly.com'];
const STAND = ['https://apiv3.fansly.com', 'http://localhost'];
const GROUP = '700000000000000010';
const at = (path: string, origin = 'https://apiv3.fansly.com'): string => `${origin}/api/v1/${path}`;
const ok = (response: unknown): string => JSON.stringify({ success: true, response });

describe('[host:fansly] the response table of the XHR observer (§5.4)', () => {
  it('tells the table’s answers by their address alone; `ngsw-bypass` and the order of the query do not matter', () => {
    const table: Array<[string, string | null, string | null]> = [
      [`message?groupId=${GROUP}&limit=25&ngsw-bypass=true`, 'history', GROUP],
      [`message?ngsw-bypass=true&groupId=${GROUP}&before=700000000000000101&limit=25`, 'older', GROUP],
      ['message?ngsw-bypass=true', 'receipt', null],
      ['message', 'receipt', null],
      ['messages?ids=700000000000000101,700000000000000102&ngsw-bypass=true', 'byIds', null],
      ['message/unread?ngsw-bypass=true', 'unread', null],
      [`group/${GROUP}/?ngsw-bypass=true`, 'group', GROUP],
      [`group/${GROUP}`, 'group', GROUP],
      ['messaging/groups?limit=50&ngsw-bypass=true', 'groups', null],
      ['account/me?ngsw-bypass=true', 'me', null],
      ['account?ids=700000000000000002,700000000000000003&ngsw-bypass=true', 'accounts', null],
      ['message/automated?ngsw-bypass=true', 'automated', null],
      ['vault/albums/media?ngsw-bypass=true', 'vault', null],
      // The API's, not the table's.
      ['message/ack?ngsw-bypass=true', 'other', null],
      ['message/typing', 'other', null],
      ['message/broadcast', 'other', null],
      ['vault/albums/media/extra', 'other', null],
      ['vault/albumsnew', 'other', null],
      ['group/abc/', 'other', null],
      ['messages', 'other', null],
      ['account', 'other', null],
      ['account?usernames=fan', 'other', null],
    ];
    for (const [path, kind, groupId] of table) expect(classifyAddress(at(path), API), path).toMatchObject({ kind, groupId });
  });

  it('keeps the page’s own `limit=` of the history: a fresh end shorter than it proves the start (§5.6)', () => {
    expect(classifyAddress(at(`message?groupId=${GROUP}&limit=25&ngsw-bypass=true`), API)).toEqual({ kind: 'history', groupId: GROUP, limit: 25 });
    expect(classifyAddress(at(`message?groupId=${GROUP}&before=700000000000000101&limit=25`), API)).toEqual({ kind: 'older', groupId: GROUP, limit: 25 });
    for (const limit of ['', '&limit=', '&limit=0', '&limit=-3', '&limit=2.5', '&limit=x']) {
      expect(classifyAddress(at(`message?groupId=${GROUP}${limit}`), API), limit).toEqual({ kind: 'history', groupId: GROUP, limit: null });
    }
  });

  it('is the API’s only on its origins, whose port may follow — the stand’s loopback API, never a look-alike host', () => {
    expect(classifyAddress(at('account/me', 'http://localhost:43123'), STAND)).toEqual({ kind: 'me', groupId: null });
    expect(classifyAddress(at('account/me', 'http://localhost:43123'), API)).toBeNull();
    expect(classifyAddress(at('account/me', 'https://apiv3.fansly.com.example.org'), API)).toBeNull();
    expect(classifyAddress('https://apiv3.fansly.com/api/v2/account/me', API)).toBeNull();
    expect(classifyAddress('https://fansly.com/api/v1/account/me', API)).toBeNull();
    expect(classifyAddress('https://cdn3.fansly.com/abc.jpg?ngsw-bypass=true', API)).toBeNull();
    expect(classifyAddress('', API)).toBeNull();
  });

  it('reads only `{success: true, response}` of the form its kind asks', () => {
    expect(readResponse({ kind: 'me', groupId: null }, ok({ account: { id: '700000000000000001' } }), JSON.parse)).toEqual({ kind: 'me', groupId: null, response: { account: { id: '700000000000000001' } } });
    expect(readResponse({ kind: 'me', groupId: null }, ok({ account: { id: 'x' } }), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'me', groupId: null }, JSON.stringify({ success: false, error: { code: 401 } }), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'history', groupId: GROUP }, ok({ messages: [] }), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'history', groupId: GROUP }, '{"success":true,', JSON.parse)).toBeNull();
    // `POST /group/<id>/` answers a part: only a whole group of that id is the group.
    expect(readResponse({ kind: 'group', groupId: GROUP }, ok({ users: [{ userId: '1' }] }), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'group', groupId: GROUP }, ok({ id: '700000000000000011', type: 1, users: [] }), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'group', groupId: GROUP }, ok({ id: GROUP, type: 1, users: [] }), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'receipt', groupId: null }, ok({ id: '700000000000000105', groupId: GROUP, senderId: '700000000000000001' }), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'receipt', groupId: null }, ok({}), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'groups', groupId: null }, ok({ data: [], aggregationData: {} }), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'unread', groupId: null }, ok({ messageInteractions: [] }), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'automated', groupId: null }, ok([]), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'automated', groupId: null }, ok({}), JSON.parse)).toBeNull();
    expect(readResponse({ kind: 'accounts', groupId: null }, ok([{ id: '700000000000000002' }]), JSON.parse)).not.toBeNull();
    expect(readResponse({ kind: 'accounts', groupId: null }, ok({ accounts: [] }), JSON.parse)).toBeNull();
    // The page does not read the vault's answer: its success is the whole confirmation.
    expect(readResponse({ kind: 'vault', groupId: null }, ok(null), JSON.parse)).toEqual({ kind: 'vault', groupId: null, response: null });
    expect(readResponse({ kind: 'other', groupId: null }, ok({}), JSON.parse)).toBeNull();
  });

  it('a long answer waits in a queue of ≤ 8 answers and ≤ 1 MiB, read in an idle moment or drained within a budget', async () => {
    const read: string[] = [];
    let idled = 0;
    const idle: Array<(deadline: IdleDeadline) => void> = [];
    const queue = createResponseQueue<number>(
      { now: () => performance.now(), idle: (callback) => idle.push(callback), later: () => undefined, guard: (_site, fn) => (...args) => void fn(...args) },
      (item: Deferred<number>) => read.push(`${item.call.kind}:${String(item.stamp)}`),
      () => (idled += 1),
    );
    const item = (n: number, chars = 100 * 1024): Deferred<number> => ({ call: { kind: 'groups', groupId: null }, text: 'x'.repeat(chars), stamp: n });
    for (let n = 0; n < DEFERRED_MAX_ITEMS; n += 1) expect(queue.push(item(n))).toBe(true);
    expect(queue.push(item(99, 10))).toBe(false);
    expect(queue.size()).toBe(DEFERRED_MAX_ITEMS);
    expect(queue.chars()).toBe(DEFERRED_MAX_ITEMS * 100 * 1024);
    // One idle callback asked, however many answers wait.
    expect(idle).toHaveLength(1);
    let left = 3;
    idle[0]?.({ didTimeout: false, timeRemaining: () => (left-- > 0 ? 10 : 0) });
    expect(read).toEqual(['groups:0', 'groups:1', 'groups:2']);
    expect(idled).toBe(1);
    // Answers still wait: another idle callback is asked for.
    expect(idle).toHaveLength(2);
    // A snapshot drains within its budget (P7b); with time enough nothing waits.
    expect(queue.drain(50)).toBe(true);
    expect(read).toHaveLength(DEFERRED_MAX_ITEMS);
    expect(queue.chars()).toBe(0);
    // By size too: one answer of 1 MiB fills it.
    expect(queue.push(item(1, DEFERRED_MAX_CHARS))).toBe(true);
    expect(queue.push(item(2, 1))).toBe(false);
    await Promise.resolve();
  });

  it('without requestIdleCallback a timer stands in, one answer a turn', () => {
    const timers: Array<() => void> = [];
    const read: number[] = [];
    const queue = createResponseQueue<number>(
      { now: () => performance.now(), idle: null, later: (callback) => timers.push(callback), guard: (_site, fn) => (...args) => void fn(...args) },
      (item) => read.push(item.stamp ?? -1),
      () => undefined,
    );
    queue.push({ call: { kind: 'groups', groupId: null }, text: '{}', stamp: 1 });
    queue.push({ call: { kind: 'groups', groupId: null }, text: '{}', stamp: 2 });
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(read).toEqual([1]);
    timers[1]?.();
    expect(read).toEqual([1, 2]);
  });

  it('tells an answer that is not the table’s by a string comparison, with no tenfold regression of 0.01 ms (§5.4)', () => {
    const urls = ['https://cdn3.fansly.com/abc.jpg?ngsw-bypass=true', at('message/ack?ngsw-bypass=true'), 'https://metrics.fansly.com/x'];
    const rounds = 10_000;
    const started = performance.now();
    for (let i = 0; i < rounds; i += 1) for (const url of urls) classifyAddress(url, API);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect((performance.now() - started) / (rounds * urls.length)).toBeLessThan(0.1);
  });
});
