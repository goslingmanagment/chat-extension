// The X8 send port (architecture.md §6.7.1–§6.7.4, §6.7.7, §6.7.11) through
// the live port, over a ChatSpace-like queue: what reaches the queue, what
// never does, and the answer of each case.

/* eslint-disable @typescript-eslint/unbound-method -- the tests compare the page's `fetch` by identity */

import { PreviewSendCommitSchema, PreviewSendPreflightSchema } from '@cg/contracts/send';
import { PREVIEW_SEND_CONDITION_CODES } from '@cg/contracts/send-rules';
import { afterEach, describe, expect, it } from 'vitest';

import { frames, type QueueEntry } from '../testing/fake-live';
import { fakeStore } from '../testing/fake-page';
import { ACC, FAN, OPEN_FAN, startLive, uuid, type LiveHarness } from '../testing/live-harness';
import { QUEUE_SEND, toHtml } from './send-port';

let h: LiveHarness | null = null;
const start = (options?: Parameters<typeof startLive>[0]): LiveHarness => (h = startLive(options));
afterEach(() => {
  h?.dispose();
  h = null;
});

const failedEntry = (fan: string, n: number): QueueEntry => ({ id: `stuck-${n}`, accountId: ACC, chatId: fan, platform: 'onlyfans', status: 'failed', error: { kind: 'platform' }, createdAt: '2026-10-03T10:00:00.000Z', payload: {} });

describe('[X8-02] the one queue call (§6.7.1)', () => {
  it('[SP-054] [X8-05] a cold target — no composer, no chat tab, no cache — gets exactly one call with the §6.7.1 arguments', async () => {
    const live = start();
    const req = live.request(1, { plainText: 'hey you' });
    expect(live.preflight(req)).toEqual({ ok: true });
    expect(live.queue.sends).toEqual([]);
    const answer = live.commit(req);
    expect(PreviewSendCommitSchema.safeParse(answer).success).toBe(true);
    expect(answer).toEqual({ state: 'nativeEnqueued', pendingId: live.queue.entries(ACC)[0]?.id });
    expect(live.queue.sends).toEqual([
      {
        accountId: ACC,
        chatId: FAN,
        platform: 'onlyfans',
        text: '<p>hey you</p>',
        hasAttachments: false,
        isAiGenerated: true,
        isCopied: false,
        platformMetadata: {},
        composerContent: { html: '<p>hey you</p>', media: null, gif: null, taggedCreators: [] },
      },
    ]);
    await live.settle();
    // One native request, to the target chat, created by ChatSpace's own client.
    expect(live.calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([['POST', `/api/v0/accounts/${ACC}/chats/${FAN}/messages`]]);
    // The route did not move, nothing but the events went out.
    expect(live.live.route).toEqual({ name: 'chat', acc: ACC, fan: OPEN_FAN });
  });

  it('builds the HTML like ChatSpace’s own setText: `&` first, then `<` `>`, our line breaks, one <p>; quotes stay', () => {
    expect(toHtml('a & b')).toBe('<p>a &amp; b</p>');
    // A literal entity in the text stays a literal: `&lt;` is shown as the five characters.
    expect(toHtml('&lt;3')).toBe('<p>&amp;lt;3</p>');
    expect(toHtml('<b>bold</b> > x')).toBe('<p>&lt;b&gt;bold&lt;/b&gt; &gt; x</p>');
    expect(toHtml(`"quotes" and 'apostrophes'`)).toBe(`<p>"quotes" and 'apostrophes'</p>`);
    expect(toHtml('one\r\ntwo\rthree\nfour')).toBe('<p>one<br>two<br>three<br>four</p>');
    expect(toHtml('first\n\nthird')).toBe('<p>first<br><br>third</p>');
    // Nothing of the model's output can become markup: no attribute, no tag survives.
    expect(toHtml('<img src=x onerror=alert(1)>')).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });

  it('[X53] the picked media go in the same call, as ChatSpace’s own composer puts them: ids as numbers, audio with a thumb, the price in USD, the free previews and the release-form tags', async () => {
    const live = start();
    const media = {
      items: [
        { id: '660000155', type: 'photo', duration: 0, thumb: 'https://pw365.ompcdn.com/a.jpg', free: true },
        { id: '660000160', type: 'video', duration: 75, thumb: null, free: false },
        { id: '660000170', type: 'audio', duration: 12, thumb: null, free: false },
      ],
      priceCents: 2499,
      tags: { users: ['77'], guests: ['91'] },
    };
    const answer = live.commit(live.request(5, { plainText: 'just for you', media }));
    expect(answer.state).toBe('nativeEnqueued');
    expect(live.queue.sends).toEqual([
      {
        accountId: ACC,
        chatId: FAN,
        platform: 'onlyfans',
        text: '<p>just for you</p>',
        hasAttachments: true,
        isAiGenerated: true,
        isCopied: false,
        platformMetadata: { mediaFiles: [660000155, 660000160, { id: 660000170, thumbId: 0 }], rfTag: ['77'], rfGuest: ['91'], price: 24.99, previews: [660000155] },
        composerContent: {
          html: '<p>just for you</p>',
          media: {
            medias: [
              { id: '660000155', type: 'photo', duration: 0, isFree: true, imageUrl: 'https://pw365.ompcdn.com/a.jpg' },
              { id: '660000160', type: 'video', duration: 75, isFree: false, imageUrl: undefined },
              { id: '660000170', type: 'audio', duration: 12, isFree: false, imageUrl: undefined },
            ],
            price: 24.99,
            lockedText: false,
          },
          gif: null,
          taggedCreators: [
            { id: '77', name: '77', avatarUrl: null, type: 'user' },
            { id: '91', name: '91', avatarUrl: null, type: 'guest' },
          ],
        },
      },
    ]);
    await live.settle();
    // One native request to that chat, made by ChatSpace's own client.
    expect(live.calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([['POST', `/api/v0/accounts/${ACC}/chats/${FAN}/messages`]]);
  });

  it('[X53] free media: no price and no previews on the wire', () => {
    const live = start();
    live.commit(live.request(6, { media: { items: [{ id: '11', type: 'gif', duration: 0, thumb: null, free: false }], priceCents: 0, tags: { users: [], guests: [] } } }));
    expect(live.queue.sends[0]).toMatchObject({ hasAttachments: true, platformMetadata: { mediaFiles: [11] }, composerContent: { media: { price: null } } });
    expect(Object.keys(live.queue.sends[0]?.['platformMetadata'] as object)).toEqual(['mediaFiles']);
  });

  it('`isAiGenerated` is the request’s (ChatSpace’s own mark, decided before MAIN); `isCopied` is always false, the metadata always empty', () => {
    const live = start();
    live.commit(live.request(2, { isAiGenerated: false, plainText: 'a\nb' }));
    expect(live.queue.sends[0]).toMatchObject({ isAiGenerated: false, isCopied: false, platformMetadata: {}, hasAttachments: false, text: '<p>a<br>b</p>' });
  });
});

describe('[X8-03] every condition is checked in MAIN, with no side effect, and again right before the call (§6.7.4)', () => {
  /** Each case breaks one condition of an otherwise clean page. */
  const cases: Array<[string, string, (live: LiveHarness) => void]> = [
    ['the flag is off (the latch)', 'CG-SEND-OFF', (live) => void live.port.handle('flags', { wsTap: true, previewSend: false })],
    ['the queue store is missing', 'CG-SEND-HOST', (live) => void live.live.stores.delete('pendingMessages')],
    ['the queue store is not the one we know', 'CG-SEND-HOST', (live) => void live.live.stores.set('pendingMessages', fakeStore('pendingMessages', { messagesByAccountId: {} }))],
    [
      'the queue store has no per-account «processing» state (§6.2: condition 13 could not be read)',
      'CG-SEND-HOST',
      (live) => void live.live.stores.set('pendingMessages', fakeStore('pendingMessages', { messagesByAccountId: {}, [QUEUE_SEND]: () => null })),
    ],
    [
      'a read of ours throws (a page we do not know)',
      'CG-SEND-HOST',
      (live) =>
        void ((live.live.host as { route: unknown }).route = () => {
          throw new Error('ours');
        }),
    ],
    ['the page’s fetch takes no assignment (a getter alone): no send path that can be observed', 'CG-SEND-RECEIPT', (live) => void Object.defineProperty(live.win, 'fetch', { configurable: true, get: () => live.nativeFetch })],
    ['the page’s fetch is not writable', 'CG-SEND-RECEIPT', (live) => void Object.defineProperty(live.win, 'fetch', { configurable: true, writable: false, value: live.nativeFetch })],
    ['the page has no fetch', 'CG-SEND-RECEIPT', (live) => void ((live.win as { fetch?: unknown }).fetch = undefined)],
    ['the account is not among the loaded accounts', 'CG-SEND-PERMISSION', (live) => live.live.set(['accounts'], [{ id: 1002, platformAccountId: '3003' }])],
    ['the account is bound to another creator', 'CG-SEND-PERMISSION', (live) => live.live.set(['accounts'], [{ id: 1001, platformAccountId: '3999' }])],
    ['the accounts are not loaded', 'CG-SEND-PERMISSION', (live) => void live.live.data.delete(JSON.stringify(['accounts']))],
    ['the permissions are not loaded', 'CG-SEND-PERMISSION', (live) => void live.live.data.delete(JSON.stringify(['userPermissions']))],
    ['the role cannot send messages', 'CG-SEND-PERMISSION', (live) => live.live.set(['userPermissions'], ['of_block_message_sending'])],
    ['the target is the open chat', 'CG-SEND-ACTIVE-CHAT', (live) => void (live.live.route = { name: 'chat', acc: ACC, fan: FAN })],
    ['the target’s history query is observed', 'CG-SEND-HISTORY', (live) => void live.live.entries.set(JSON.stringify(['chatMessages', ACC, FAN]), { active: true, asyncStatus: { value: 'idle' } })],
    ['the target’s history query is loading', 'CG-SEND-HISTORY', (live) => void live.live.entries.set(JSON.stringify(['chatMessages', ACC, FAN]), { active: false, asyncStatus: { value: 'loading' } })],
    ['the target’s history entry cannot be read', 'CG-SEND-HISTORY', (live) => void live.live.entries.set(JSON.stringify(['chatMessages', ACC, FAN]), {})],
    ['the fan is blocked', 'CG-SEND-FAN', (live) => live.live.set(['fansMap', ACC], { [FAN]: { isBlocked: true, canReceiveMessages: true, isRestricted: false } })],
    ['the fan cannot receive messages', 'CG-SEND-FAN', (live) => live.live.set(['fansMap', ACC], { [FAN]: { isBlocked: false, canReceiveMessages: false, isRestricted: false } })],
    ['the fan is restricted', 'CG-SEND-FAN', (live) => live.live.set(['fansMap', ACC], { [FAN]: { isBlocked: false, canReceiveMessages: true, isRestricted: true } })],
    ['Mimic’s settings are not loaded', 'CG-SEND-MIMIC', (live) => void live.live.data.delete(JSON.stringify(['mimicSettings']))],
    ['Mimic’s chats are not loaded', 'CG-SEND-MIMIC', (live) => void live.live.data.delete(JSON.stringify(['mimicChats']))],
    [
      'Mimic runs this chat',
      'CG-SEND-MIMIC',
      (live) => {
        live.live.set(['mimicSettings'], { isActive: true });
        live.live.set(['mimicChats'], { [`${ACC}:${FAN}`]: { status: 'enabled' } });
      },
    ],
    ['the translator would translate on send', 'CG-SEND-TRANSLATOR', (live) => void ((live.live.stores.get('composerTranslator')?.['settings'] as Record<string, unknown>)[ACC] = { enabled: true, autoTranslate: true })],
    ['the translator store is missing', 'CG-SEND-TRANSLATOR', (live) => void live.live.stores.delete('composerTranslator')],
    ['the translator’s settings cannot be read', 'CG-SEND-TRANSLATOR', (live) => void live.live.stores.set('composerTranslator', fakeStore('composerTranslator', { getAccountSettings: () => ({ value: 'on' }) }))],
    ['the account’s queue is processing', 'CG-SEND-BUSY', (live) => void ((live.queue.store['processingByAccountId'] as Record<string, boolean>)[ACC] = true)],
    ['another send waits in the account’s queue', 'CG-SEND-BUSY', (live) => void ((live.queue.store['messagesByAccountId'] as Record<string, QueueEntry[]>)[ACC] = [{ ...failedEntry(OPEN_FAN, 1), status: 'pending', error: null }])],
    ['the chat’s queue is full', 'CG-SEND-BUSY', (live) => void ((live.queue.store['messagesByAccountId'] as Record<string, QueueEntry[]>)[ACC] = Array.from({ length: 50 }, (_, n) => failedEntry(FAN, n)))],
    ['the fan wrote after Generate', 'CG-SEND-STALE', (live) => live.socket.receive(frames.message(ACC, FAN, '5001', true))],
    ['the socket reconnected after Generate', 'CG-SEND-FRESHNESS', (live) => live.socket.close()],
    ['the account lost its subscription', 'CG-SEND-FRESHNESS', (live) => void ((live.live.subscribed = new Set()), live.port.sync())],
  ];

  it.each(cases)('%s → %s: the button is refused and the click makes no queue call', async (_name, code, breakIt) => {
    const live = start();
    const req = live.request(3);
    expect(live.preflight(req)).toEqual({ ok: true });
    breakIt(live);
    const before = JSON.stringify([...live.live.data]);
    const fetchBefore = live.win.fetch;
    const preflight = live.preflight(req);
    expect(preflight).toEqual({ ok: false, code });
    expect(PreviewSendPreflightSchema.safeParse(preflight).success).toBe(true);
    expect(PREVIEW_SEND_CONDITION_CODES).toContain(code);
    const answer = live.commit(req);
    expect(answer).toEqual({ state: 'held', code });
    expect(PreviewSendCommitSchema.safeParse(answer).success).toBe(true);
    await live.settle();
    // «Held» is positive knowledge that the queue was not called (§6.7.7 п. 6): the same answer again, never «uncertain».
    expect(live.commit(req)).toEqual({ state: 'held', code });
    // Nothing was sent, nothing in page memory was touched, the page's fetch is the page's.
    expect(live.queue.sends).toEqual([]);
    expect(live.calls).toEqual([]);
    expect(JSON.stringify([...live.live.data])).toBe(before);
    expect(live.win.fetch).toBe(fetchBefore);
    expect(live.states()).toEqual([]);
  });

  it('what the page does not forbid is not refused: an unknown fan, an idle unobserved history, Mimic on another chat or escalated, a manual translator', () => {
    const live = start();
    live.live.set(['fansMap', ACC], {});
    live.live.entries.set(JSON.stringify(['chatMessages', ACC, FAN]), { active: false, asyncStatus: { value: 'idle' } });
    live.live.set(['mimicSettings'], { isActive: true });
    live.live.set(['mimicChats'], { [`${ACC}:${OPEN_FAN}`]: { status: 'enabled' }, [`${ACC}:${FAN}`]: { status: 'escalated' } });
    (live.live.stores.get('composerTranslator')?.['settings'] as Record<string, unknown>)[ACC] = { enabled: true, autoTranslate: false };
    (live.queue.store['messagesByAccountId'] as Record<string, QueueEntry[]>)[ACC] = Array.from({ length: 49 }, (_, n) => failedEntry(FAN, n)).concat(Array.from({ length: 50 }, (_, n) => failedEntry(OPEN_FAN, 100 + n)));
    expect(live.preflight(live.request(4))).toEqual({ ok: true });
    live.live.data.delete(JSON.stringify(['fansMap', ACC]));
    expect(live.preflight(live.request(5))).toEqual({ ok: true });
  });

  it('an empty text, a checkpoint without coverage or of another document, and a late ticket are held', () => {
    const live = start();
    expect(live.commit(live.request(6, { plainText: ' \n ' }))).toEqual({ state: 'held', code: 'CG-SEND-PART' });
    const good = live.checkpoint();
    expect(live.commit(live.request(7, { checkpoint: { ...good, coverage: 'unknown' } }))).toEqual({ state: 'held', code: 'CG-SEND-FRESHNESS' });
    expect(live.commit(live.request(8, { checkpoint: { ...good, documentEpoch: 'doc0' } }))).toEqual({ state: 'held', code: 'CG-SEND-FRESHNESS' });
    // §6.7.11: a command after the ticket's deadline is held, never a late send.
    expect(live.commit(live.request(9, { expiresAt: Date.now() - 1 }))).toEqual({ state: 'held', code: 'CG-TIMEOUT' });
    expect(live.queue.sends).toEqual([]);
  });

  it('[AI-120] nothing is sent before the flag is known to be on: the latch starts closed', () => {
    const live = start({ flags: false });
    expect(live.port.handle('flags', { wsTap: true, previewSend: false })).toEqual({ wsTap: true, previewSend: false, attribution: false });
    expect(live.commit(live.request(10))).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    const fresh = startLive({ flags: false });
    expect(fresh.commit(fresh.request(11))).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    expect(fresh.queue.sends).toEqual([]);
    fresh.dispose();
  });

  it('the flag goes off between the ready button and the click: zero queue calls; a send already started is not called a cancel', async () => {
    const live = start();
    const first = live.request(12);
    expect(live.commit(first).state).toBe('nativeEnqueued');
    const second = live.request(13, { fan: '2004' });
    expect(live.port.handle('flags', { wsTap: true, previewSend: false })).toEqual({ wsTap: true, previewSend: false, attribution: false });
    expect(live.preflight(second)).toEqual({ ok: false, code: 'CG-SEND-OFF' });
    expect(live.commit(second)).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    expect(live.queue.sends).toHaveLength(1);
    // The first send goes on to its receipt.
    await live.settle();
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    expect(live.states(first.attemptId).map((view) => view['state'])).toEqual(['nativeAccepted']);
  });
});

describe('[X8-03] one attempt, one queue call (§6.7.7)', () => {
  it('twenty fast clicks of one attempt reach the queue once and get the first answer', () => {
    const live = start();
    const req = live.request(20);
    const answers = Array.from({ length: 20 }, () => live.commit(req));
    expect(live.queue.sends).toHaveLength(1);
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    expect(answers[0]?.state).toBe('nativeEnqueued');
  });

  it('twenty attempts for the account in one tick: the first is queued, the others find the queue busy', () => {
    const live = start();
    const answers = Array.from({ length: 20 }, (_, n) => live.commit(live.request(30 + n, { fan: String(2100 + n) })));
    expect(live.queue.sends).toHaveLength(1);
    expect(answers[0]?.state).toBe('nativeEnqueued');
    expect(answers.slice(1)).toEqual(Array.from({ length: 19 }, () => ({ state: 'held', code: 'CG-SEND-BUSY' })));
  });

  it('remembers the last 256 held attempts; an older one is new again, and its own deadline still guards it', () => {
    const live = start({ flags: false });
    const first = live.request(1);
    expect(live.commit(first)).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    for (let n = 0; n < 256; n += 1) live.commit(live.request(1000 + n));
    live.port.handle('flags', { wsTap: true, previewSend: true });
    // An attempt still remembered keeps its first answer; the one pushed out is judged as it is now.
    expect(live.commit(live.request(1255))).toEqual({ state: 'held', code: 'CG-SEND-OFF' });
    expect(live.commit({ ...first, checkpoint: live.checkpoint(), expiresAt: Date.now() - 1 })).toEqual({ state: 'held', code: 'CG-TIMEOUT' });
    expect(live.queue.sends).toEqual([]);
  });

  it('an attempt that may have reached the queue is never forgotten: its command after 300 others gets the first answer, not a second queue call', async () => {
    const live = start();
    const queued = live.request(1);
    expect(live.commit(queued).state).toBe('nativeEnqueued');
    live.queue.refuseNext();
    await live.settle();
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    const refused = live.request(2, { fan: '2004' });
    expect(live.commit(refused)).toEqual({ state: 'notEnqueued', code: 'CG-SEND-QUEUE' });
    // Three hundred clicks that were held (the target became the open chat).
    live.live.route = { name: 'chat', acc: ACC, fan: '2100' };
    for (let n = 0; n < 300; n += 1) expect(live.commit(live.request(1000 + n, { fan: '2100' }))).toEqual({ state: 'held', code: 'CG-SEND-ACTIVE-CHAT' });
    live.live.route = { name: 'chat', acc: ACC, fan: OPEN_FAN };
    // The page would let both through now (a free queue, a fresh checkpoint, a ticket that has not expired).
    expect(live.preflight({ ...queued, checkpoint: live.checkpoint() })).toEqual({ ok: true });
    expect(live.commit({ ...queued, checkpoint: live.checkpoint() })).toMatchObject({ state: 'nativeEnqueued' });
    expect(live.commit({ ...refused, checkpoint: live.checkpoint('2004') })).toEqual({ state: 'notEnqueued', code: 'CG-SEND-QUEUE' });
    expect(live.queue.sends).toHaveLength(2);
  });

  it('a command of the same attempt that comes while its queue call runs does not reach the queue', () => {
    const live = start();
    const req = live.request(3);
    let inner: unknown = null;
    // Inside ChatSpace's own send action, on the stack of our one call.
    live.queue.during = () => {
      inner = live.commit(req);
    };
    expect(live.commit(req).state).toBe('nativeEnqueued');
    // What is known at that moment: the queue may have been called, the result is not.
    expect(inner).toEqual({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(live.queue.sends).toHaveLength(1);
  });

  it('the observer cannot be put in place (the page’s fetch refuses the assignment): held, never «uncertain» — nothing reached the queue', () => {
    const live = start();
    Object.defineProperty(live.win, 'fetch', {
      configurable: true,
      get: () => live.nativeFetch,
      set: () => {
        throw new Error('not yours');
      },
    });
    const req = live.request(4);
    expect(live.commit(req)).toEqual({ state: 'held', code: 'CG-SEND-HOST' });
    expect(live.commit(req)).toEqual({ state: 'held', code: 'CG-SEND-HOST' });
    expect(live.queue.sends).toEqual([]);
    expect(live.win.fetch).toBe(live.nativeFetch);
  });

  it('a held attempt stays held when its command comes again, even after the reason is gone', () => {
    const live = start();
    live.live.set(['userPermissions'], ['of_block_message_sending']);
    const req = live.request(21);
    expect(live.commit(req)).toEqual({ state: 'held', code: 'CG-SEND-PERMISSION' });
    live.live.set(['userPermissions'], []);
    expect(live.commit(req)).toEqual({ state: 'held', code: 'CG-SEND-PERMISSION' });
    expect(live.queue.sends).toEqual([]);
  });

  it('the queue returns null (the call boundary intact): notEnqueued; it throws, or returns no entry id: uncertain — the page’s fetch is back in both', async () => {
    const live = start();
    live.queue.refuseNext();
    expect(live.commit(live.request(22))).toEqual({ state: 'notEnqueued', code: 'CG-SEND-QUEUE' });
    expect(live.win.fetch).toBe(live.nativeFetch);
    // A refusal of the queue is its own answer: the next send is not closed by it.
    expect(live.preflight(live.request(27))).toEqual({ ok: true });
    live.queue.throwNext();
    expect(live.commit(live.request(23))).toEqual({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(live.win.fetch).toBe(live.nativeFetch);
    const odd = startLive();
    odd.live.stores.set('pendingMessages', fakeStore('pendingMessages', { messagesByAccountId: {}, processingByAccountId: {}, [QUEUE_SEND]: () => ({ id: 17 }) }));
    expect(odd.commit(odd.request(24))).toEqual({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    odd.dispose();
    await live.settle();
    expect(live.states()).toEqual([]);
  });

  it.each([
    ['throws', (live: LiveHarness) => live.queue.throwNext()],
    ['returns an entry without `status` (a renamed key)', (live: LiveHarness) => void (live.queue.reshape = ({ status: _status, ...rest }) => ({ ...rest, state: 'pending' }))],
    ['returns an entry without `error`', (live: LiveHarness) => void (live.queue.reshape = ({ error: _error, ...rest }) => rest)],
    ['returns an entry without `createdAt`', (live: LiveHarness) => void (live.queue.reshape = ({ createdAt: _createdAt, ...rest }) => rest)],
    ['returns an entry without `payload`', (live: LiveHarness) => void (live.queue.reshape = ({ payload: _payload, ...rest }) => rest)],
    ['returns an entry whose id is not a reference', (live: LiveHarness) => void (live.queue.reshape = (entry) => ({ ...entry, id: 17 }))],
  ])('§6.2 `pendingMessages`: the queue %s — not the entry we know: uncertain, and X8 is off for the document with CG-SEND-HOST', async (_name, breakIt) => {
    const live = start();
    breakIt(live);
    expect(live.commit(live.request(50))).toEqual({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(live.win.fetch).toBe(live.nativeFetch);
    live.queue.reshape = null;
    // Its chain could not be read to its end, so nothing is said of it — and nothing more is sent this way.
    await live.settle();
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    expect(live.states()).toEqual([]);
    const next = live.request(51, { fan: '2004' });
    expect(live.preflight(next)).toEqual({ ok: false, code: 'CG-SEND-HOST' });
    expect(live.commit(next)).toEqual({ state: 'held', code: 'CG-SEND-HOST' });
    expect(live.queue.sends).toHaveLength(1);
  });

  it('a fan message in the pause between the preflight and the click holds the send; editing the text does not lift it', () => {
    const live = start();
    const req = live.request(25);
    expect(live.preflight(req)).toEqual({ ok: true });
    live.socket.receive(frames.message(ACC, FAN, '5001', true, { content: '' }));
    expect(live.commit(req)).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
    // Another attempt with the same checkpoint (the old result, edited): still stale.
    expect(live.commit({ ...req, attemptId: uuid(26), plainText: 'edited' })).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
    expect(live.queue.sends).toEqual([]);
  });

  it('three parts: a click each, one after the other; a new fan message blocks the rest', async () => {
    const live = start();
    const checkpoint = live.checkpoint();
    const part = (n: number, text: string) => live.request(40 + n, { plainText: text, checkpoint });
    expect(live.commit(part(0, 'one')).state).toBe('nativeEnqueued');
    // While the first is on its way the account's queue is busy: the second click is refused, not queued behind it.
    expect(live.commit(part(1, 'two'))).toEqual({ state: 'held', code: 'CG-SEND-BUSY' });
    await live.settle();
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(live.commit({ ...part(1, 'two'), attemptId: uuid(48) }).state).toBe('nativeEnqueued');
    await live.settle();
    live.calls[1]?.respond(200, { id: '8002' });
    await live.settle();
    // Our own echoes did not move the fan's counter; the fan's reply does.
    live.socket.receive(frames.message(ACC, FAN, '5009', true));
    expect(live.commit(part(2, 'three'))).toEqual({ state: 'held', code: 'CG-SEND-STALE' });
    expect(live.queue.sends.map((input) => input['text'])).toEqual(['<p>one</p>', '<p>two</p>']);
  });
});
