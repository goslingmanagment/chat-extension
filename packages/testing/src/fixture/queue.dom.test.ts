// The fixture's send queue and HTTP client without a browser (happy-dom, a
// scripted fetch): the properties the X8 receipt observer and its tests rely on.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../fixture-chatspace/src/env';
import { readJournal } from '../../fixture-chatspace/src/journal';
import { useQueryCache } from '../../fixture-chatspace/src/query/cache';
import { keys } from '../../fixture-chatspace/src/query/queries';
import { isMimicTakeover, QUEUE_LIMIT, usePendingMessages, type PendingEntry } from '../../fixture-chatspace/src/stores/pending-messages';
import { escapeText, textToNodes, textToParagraph } from '../../fixture-chatspace/src/ui/bridge';
import { plainText } from '../../fixture-chatspace/src/query/model';

type Handler = (request: Request) => Promise<Response> | Response;

const ACCOUNT = '910101';
const CHAT = '74001001';
const realFetch = globalThis.fetch;
const sends: Array<{ url: string; via: string }> = [];
let answer: Handler = () => Response.json({ id: '5900000001' });

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that serves the session token and hands message POSTs to `answer`; `via` names who was called. */
function makeFetch(via: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.url.endsWith('/__stand/auth/token')) return json({ token: 'stand-session-test', userId: '6100042' });
    if (request.url.includes('/messages')) {
      sends.push({ url: request.url, via });
      return answer(request);
    }
    return json({});
  };
}

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const entries = (): PendingEntry[] => usePendingMessages().messagesByAccountId[ACCOUNT] ?? [];
const input = (text = '<p>hello</p>', chatId = CHAT) => ({ accountId: ACCOUNT, chatId, platform: 'onlyfans', text, platformMetadata: {} });

beforeEach(() => {
  setActivePinia(createPinia());
  sends.length = 0;
  answer = () => json({ id: '5900000001' });
  globalThis.fetch = makeFetch('page');
  useQueryCache().setQueryData(keys.accounts(), [{ id: Number(ACCOUNT), platformAccountId: '830000101', platform: 'onlyfans' }]);
  env.queueTimeoutMs = 30_000;
});

afterEach(() => {
  usePendingMessages().resetAll();
  globalThis.fetch = realFetch;
});

describe('fixture send queue', () => {
  it('creates the request object on the enqueue stack: a fetch swapped in only for that call is the one that sends', async () => {
    const observer = makeFetch('observer');
    const before = globalThis.fetch;
    globalThis.fetch = observer;
    let entry: PendingEntry | null;
    try {
      entry = usePendingMessages().enqueue(input());
      // SENDING is set synchronously, before enqueue returns.
      expect(entries()[0]?.status).toBe('sending');
    } finally {
      globalThis.fetch = before;
    }
    expect(entry).not.toBeNull();
    await tick(10);
    expect(sends).toEqual([{ url: expect.stringContaining(`/api/v0/accounts/${ACCOUNT}/chats/${CHAT}/messages`) as string, via: 'observer' }]);
    expect(entries()).toEqual([]);
    expect(readJournal().filter((item) => item.type === 'http-request').at(-1)).toMatchObject({ fetchCapture: 'substituted', attempt: 'first' });
  });

  it('is sequential per account: the second request object exists only after the first POST settled', async () => {
    let release: () => void = () => undefined;
    answer = () => new Promise<Response>((resolve) => (release = () => resolve(json({ id: '5900000002' }))));
    const queue = usePendingMessages();
    queue.enqueue(input('<p>one</p>'));
    queue.enqueue(input('<p>two</p>'));
    await tick(10);
    expect(entries().map((item) => item.status)).toEqual(['sending', 'pending']);
    expect(sends).toHaveLength(1);
    answer = () => json({ id: '5900000003' });
    release();
    await tick(20);
    expect(sends).toHaveLength(2);
    expect(entries()).toEqual([]);
  });

  it('refuses with null when Mimic runs the chat or the chat holds 50 entries', () => {
    const cache = useQueryCache();
    cache.setQueryData(keys.mimicSettings(), { isActive: true });
    cache.setQueryData(keys.mimicChats(), { [`${ACCOUNT}:${CHAT}`]: { status: 'enabled' } });
    expect(isMimicTakeover(cache, ACCOUNT, CHAT)).toBe(true);
    expect(usePendingMessages().enqueue(input())).toBeNull();
    cache.setQueryData(keys.mimicSettings(), { isActive: false });

    answer = () => new Promise<Response>(() => undefined);
    const queue = usePendingMessages();
    for (let index = 0; index < QUEUE_LIMIT; index += 1) expect(queue.enqueue(input(`<p>${index}</p>`))).not.toBeNull();
    expect(queue.enqueue(input('<p>one too many</p>'))).toBeNull();
    expect(queue.enqueue(input('<p>other chat</p>', '74001002'))).not.toBeNull();
  });

  it('Message Guard → FAILED blocked with topics; never retried on its own', async () => {
    answer = () => json({ code: 'MESSAGE_GUARD_VIOLATION', message: 'blocked', word_matches: ['w'], topic_matches: ['direct_contact'] }, 422);
    usePendingMessages().enqueue(input());
    await tick(20);
    expect(entries()[0]).toMatchObject({ status: 'failed', error: { kind: 'blocked', guard: { words: ['w'], topics: ['Direct contact'] } } });
    expect(sends).toHaveLength(1);
  });

  it('a POST that never answers ends as FAILED timeout after the queue timeout', async () => {
    env.queueTimeoutMs = 50;
    answer = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    usePendingMessages().enqueue(input());
    await tick(120);
    expect(entries()[0]).toMatchObject({ status: 'failed', error: { kind: 'timeout' } });
  });

  it('401 → fresh token → one bare re-run, created later with whatever fetch is global then', async () => {
    let calls = 0;
    answer = () => (calls++ === 0 ? json({ code: 'UNAUTHORIZED' }, 401) : json({ id: '5900000004' }));
    const observer = makeFetch('observer');
    const before = globalThis.fetch;
    globalThis.fetch = observer;
    try {
      usePendingMessages().enqueue(input());
    } finally {
      globalThis.fetch = before;
    }
    await tick(20);
    expect(sends.map((item) => item.via)).toEqual(['observer', 'page']);
    expect(readJournal().filter((item) => item.type === 'http-request').slice(-2)).toMatchObject([{ attempt: 'first' }, { attempt: 'after-401' }]);
    expect(entries()).toEqual([]);
  });

  it('confirms an outgoing echo by plain text: SENDING → CONFIRMED, then a late failure only removes it', async () => {
    let fail: () => void = () => undefined;
    answer = () => new Promise<Response>((resolve) => (fail = () => resolve(json({ code: 'INTERNAL_ERROR' }, 500))));
    const queue = usePendingMessages();
    queue.enqueue(input('<p>a &amp; b</p>'));
    await tick(10);
    queue.confirmEchoedMessage(ACCOUNT, CHAT, '<p>a &amp; b</p>');
    expect(entries()[0]?.status).toBe('confirmed');
    fail();
    await tick(20);
    expect(entries()).toEqual([]);
  });
});

describe('fixture text helpers', () => {
  it('escapes only & < > (& first) and builds <p> with <br> like the composer bridge', () => {
    expect(escapeText('a&b <c> "d" \'e\'')).toBe('a&amp;b &lt;c&gt; "d" \'e\'');
    expect(textToParagraph('x &lt; y\nz')).toBe('<p>x &amp;lt; y<br>z</p>');
    expect(textToNodes('a\n\nb')).toEqual([{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }]);
    expect(plainText('<p>x &amp;lt; y<br>z</p>')).toBe('x &lt; y\nz');
  });
});
