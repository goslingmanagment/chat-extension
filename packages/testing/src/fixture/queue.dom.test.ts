// The fixture's send queue and HTTP client without a browser (happy-dom, a
// scripted fetch): the properties the X8 receipt observer and its tests rely on.

import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../fixture-chatspace/src/env';
import { isSignedIn } from '../../fixture-chatspace/src/net/auth';
import { readJournal } from '../../fixture-chatspace/src/journal';
import { useQueryCache } from '../../fixture-chatspace/src/query/cache';
import { keys } from '../../fixture-chatspace/src/query/queries';
import { isMimicTakeover, QUEUE_LIMIT, usePendingMessages, type PendingEntry } from '../../fixture-chatspace/src/stores/pending-messages';
import { escapeText, textToNodes, textToParagraph } from '../../fixture-chatspace/src/ui/bridge';
import { mapRestMessage, mapSocketMessage, plainText } from '../../fixture-chatspace/src/query/model';
import { newMessageFrame, rawMessage } from '../stand/wire';

type Handler = (request: Request) => Promise<Response> | Response;

const ACCOUNT = '910101';
const CHAT = '74001001';
const realFetch = globalThis.fetch;
const sends: Array<{ url: string; via: string }> = [];
let answer: Handler = () => Response.json({ id: '5900000001' });
/** While true, the session-token endpoint refuses (no fresh token after a 401). */
let sessionGone = false;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that serves the session token and hands message POSTs to `answer`; `via` names who was called. */
function makeFetch(via: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.url.endsWith('/__stand/auth/token')) return sessionGone ? json({ code: 'UNAUTHORIZED' }, 401) : json({ token: 'stand-session-test', userId: '6100042' });
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
  sessionGone = false;
  answer = () => json({ id: '5900000001' });
  globalThis.fetch = makeFetch('page');
  useQueryCache().setQueryData(keys.accounts(), [{ id: Number(ACCOUNT), platformAccountId: '830000101', platform: 'onlyfans' }]);
  env.queueTimeoutMs = 30_000;
  isSignedIn.value = true;
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

  it('a 401 without a fresh session token fails the send (FAILED platform), never «accepted»', async () => {
    answer = () => json({ code: 'UNAUTHORIZED' }, 401);
    sessionGone = true;
    usePendingMessages().enqueue(input());
    await tick(30);
    expect(sends).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ status: 'failed', error: { kind: 'platform' } });
    expect(readJournal().some((item) => item.type === 'sign-in-redirect')).toBe(true);
  });

  it('stores the server id exactly as the response carried it (a number stays a number)', async () => {
    const cache = useQueryCache();
    cache.setQueryData(keys.chatMessages(ACCOUNT, CHAT), { pages: [{ items: [], hasMore: false, cursor: null }], pageParams: [null] });
    answer = () => json({ id: 5900000009 });
    usePendingMessages().enqueue(input());
    await tick(20);
    const history = cache.getQueryData<{ pages: Array<{ items: Array<{ id: unknown; platformMetadata: Record<string, unknown> }> }> }>(keys.chatMessages(ACCOUNT, CHAT));
    expect(history?.pages[0]?.items[0]?.id).toBe(5900000009);
    expect(history?.pages[0]?.items[0]?.platformMetadata).toEqual({ isTip: false, gifUrl: null, mediaCount: 0, isFree: true, isOpened: false, isLiked: false, isPinned: false, canBePinned: false, canReport: false, cancelSeconds: 60 });
  });

  it('silent resets: sign-out drops every entry and aborts the POST; so does an account leaving the accounts list — no action is reported', async () => {
    const aborted: string[] = [];
    answer = (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          aborted.push(request.url);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const queue = usePendingMessages();
    const actions: string[] = [];
    queue.$onAction(({ name }) => {
      actions.push(name);
    });
    queue.enqueue(input());
    await tick(10);
    expect(entries()[0]?.status).toBe('sending');
    isSignedIn.value = false;
    await tick(10);
    expect(entries()).toEqual([]);
    expect(aborted).toHaveLength(1);
    isSignedIn.value = true;

    queue.enqueue(input('<p>second</p>'));
    await tick(10);
    expect(entries()[0]?.status).toBe('sending');
    useQueryCache().setQueryData(keys.accounts(), [{ id: 910202, platformAccountId: '830000202', platform: 'onlyfans' }]);
    await tick(10);
    expect(entries()).toEqual([]);
    expect(aborted).toHaveLength(2);
    expect(actions).toEqual(['enqueue', 'enqueue']);
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
  });

  it('compares echoes like the host: every tag dropped (a <br> leaves no newline), every entity decoded, trimmed', () => {
    expect(plainText('<p>x &amp;lt; y<br>z</p>')).toBe('x &lt; yz');
    expect(plainText(' <p>a&nbsp;b &#x41;&#66; &eacute; &quot;q&quot;</p> ')).toBe('a\u00a0b AB é "q"');
  });
});

describe('fixture message cache shapes', () => {
  const account = { id: '910101', platformAccountId: '830000101', name: 'A', username: 'a', openOnStart: true };
  const message = { id: '5100000001', content: '<p>hi</p>', sentAt: '2026-09-01T09:00:00.000Z', isFromFan: true, isPinned: true };
  const RAW_ONLY = ['changedAt', 'fromUser', 'media', 'previews', 'lockedText', 'responseType', 'canPurchase'];

  it('REST and socket messages carry the mapped metadata, never the raw platform object', () => {
    const rest = mapRestMessage(rawMessage(message), 'onlyfans', { fanId: '74001001', platformAccountId: account.platformAccountId });
    const frame = newMessageFrame(account, '74001001', message) as { account: Record<string, unknown>; message: Record<string, unknown> };
    const socket = mapSocketMessage(frame.message, frame.account, 'onlyfans');
    for (const mapped of [rest, socket]) {
      for (const field of RAW_ONLY) expect(mapped.platformMetadata, field).not.toHaveProperty(field);
      expect(mapped.platformMetadata).toMatchObject({ isTip: false, gifUrl: null, isPinned: true, canBePinned: true, canReport: true, isUnsent: false, isFromQueue: false, cancelSeconds: 0 });
      expect(typeof mapped.platformMetadata.cancelSecondsAsOf).toBe('string');
    }
  });
});
