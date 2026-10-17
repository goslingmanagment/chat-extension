// The receipt observer (architecture.md §6.6, §6.7.6–§6.7.8): what it does to
// the page's fetch (nothing but watching), and which outcome each native
// chain ends in. The queue and its HTTP client are the fake ones of
// testing/fake-live.ts; the page's fetch is answered by the test.

/* eslint-disable @typescript-eslint/unbound-method -- the tests compare the page's `fetch` by identity */

import { FROM_MAIN } from '@cg/contracts/bridge-messages';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { frames } from '../testing/fake-live';
import { ACC, FAN, OPEN_FAN, startLive, uuid, type LiveHarness } from '../testing/live-harness';
import { toHtml } from './send-port';

let h: LiveHarness | null = null;
const start = (options?: Parameters<typeof startLive>[0]): LiveHarness => (h = startLive(options));
afterEach(() => {
  h?.dispose();
  h = null;
});

const SEND_URL = `/api/v0/accounts/${ACC}/chats/${FAN}/messages`;
const states = (live: LiveHarness, n: number): unknown[] => live.states(uuid(n)).map((view) => view['state']);
/** Every state that left MAIN is the contract's SendAttemptView. */
const valid = (live: LiveHarness): void => {
  for (const view of live.states()) expect([view, FROM_MAIN.previewSendState.safeParse({ view }).success]).toEqual([view, true]);
};

/** The native client took fetch for its request and now waits for its session token, until the test hands it over. */
const holdToken = (live: LiveHarness): (() => void) => {
  const waiting: Array<(token: string) => void> = [];
  live.queue.token = () => new Promise<string>((resolve) => waiting.push(resolve));
  return () => {
    live.queue.token = () => Promise.resolve('session-token');
    for (const resolve of waiting.splice(0)) resolve('session-token');
  };
};

/** A committed send whose native request reached the page's fetch. */
async function sent(live: LiveHarness, n: number, over: Parameters<LiveHarness['request']>[1] = {}) {
  const req = live.request(n, over);
  const answer = live.commit(req);
  expect(answer.state).toBe('nativeEnqueued');
  await live.settle();
  const call = live.calls.at(-1);
  if (!call) throw new Error('no native request');
  return { req, call, pendingId: answer.pendingId as string };
}

describe('[X8-06] the observer only watches (§6.7.6 п. 1–3, §14)', () => {
  it('is in place only for the synchronous queue call, and the native request passes through it untouched', async () => {
    const live = start();
    let during: unknown = null;
    live.queue.during = () => {
      during = live.win.fetch;
    };
    expect(live.win.fetch).toBe(live.nativeFetch);
    const { call } = await sent(live, 1);
    // Inside the queue call the global was the observer; right after it the page's own function is back.
    expect(during).not.toBe(live.nativeFetch);
    expect(typeof during).toBe('function');
    expect(live.win.fetch).toBe(live.nativeFetch);
    // The page's fetch got exactly the client's own request object, its options object and its `this`.
    expect(live.calls).toHaveLength(1);
    expect(call.input).toBe(live.queue.requests[0]);
    expect(call.init).toEqual({});
    expect(call.self).toBe(globalThis);
    expect(new URL(call.url).pathname).toBe(SEND_URL);
    // The client could still read its own request and the session header it set (the clone took nothing away).
    expect(live.queue.requests[0]?.headers.get('authorization')).toBe('Bearer session-token');
  });

  it('returns the previous function’s own promise and response, for every call', async () => {
    const live = start();
    const promise = Promise.resolve(new Response('{"id":"8001"}', { status: 200 }));
    const previous = vi.fn((..._args: unknown[]) => promise);
    live.win.fetch = previous;
    let observer: typeof fetch | null = null;
    live.queue.during = () => {
      observer = live.win.fetch;
    };
    live.commit(live.request(2));
    expect(live.win.fetch).toBe(previous);
    const through = observer as unknown as (this: unknown, ...args: unknown[]) => unknown;
    const self = { marker: true };
    // Any other call: same `this`, same arguments, the same promise back; nothing is kept of it.
    const other = { method: 'GET', headers: { authorization: 'Bearer secret' } };
    expect(through.call(self, 'https://api.example.test/api/v0/accounts', other)).toBe(promise);
    expect(previous).toHaveBeenLastCalledWith('https://api.example.test/api/v0/accounts', other);
    expect(previous.mock.contexts.at(-1)).toBe(self);
    await live.settle();
    // The send's own request went through the same way.
    expect(previous).toHaveBeenCalledTimes(2);
    const response = await promise;
    expect(response.bodyUsed).toBe(true);
    expect(live.states(uuid(2)).map((view) => view['state'])).toEqual(['nativeAccepted']);
  });

  it('never touches headers or cookies, never reads the page’s own request or response body', async () => {
    // The client took the observer and waits for its token: the test calls it, with an instrumented request and response.
    const quiet = start();
    holdToken(quiet);
    const answer = new Response('{"id":"8001"}', { status: 200 });
    quiet.win.fetch = () => Promise.resolve(answer);
    let observer: ((...args: unknown[]) => unknown) | null = null;
    quiet.queue.during = () => {
      observer = quiet.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    quiet.commit(quiet.request(3));
    const touched: string[] = [];
    const copy = { text: () => Promise.resolve(JSON.stringify({ text: '<p>hey you</p>' })) };
    const request = {
      url: `https://api.example.test${SEND_URL}`,
      method: 'POST',
      get headers() {
        touched.push('headers');
        return new Headers();
      },
      get credentials() {
        touched.push('credentials');
        return 'include';
      },
      get body() {
        touched.push('body');
        return null;
      },
      text: () => {
        touched.push('text');
        return Promise.resolve('');
      },
      clone: () => copy,
    };
    const cloned = vi.spyOn(answer, 'clone');
    const text = vi.spyOn(answer, 'text');
    const json = vi.spyOn(answer, 'json');
    const headers = vi.spyOn(answer, 'headers', 'get');
    const promise = (observer as unknown as (...args: unknown[]) => unknown)(request, {}) as Promise<Response>;
    await quiet.settle();
    expect(await promise).toBe(answer);
    // Only the copies were read: one clone of the request, one of the response.
    expect(touched).toEqual([]);
    expect(cloned).toHaveBeenCalledTimes(1);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(headers).not.toHaveBeenCalled();
    expect(answer.bodyUsed).toBe(false);
    // And the copies were enough for the receipt.
    expect(quiet.states(uuid(3)).map((view) => view['state'])).toEqual(['nativeAccepted']);
  });

  it('other requests made on the same stack go through unobserved; a later wrapper of someone else is left in place', async () => {
    const live = start();
    const later = vi.fn((...args: unknown[]) => Reflect.apply(live.nativeFetch, globalThis, args) as unknown);
    live.queue.during = () => {
      // The page asks for something else while the queue call runs…
      void live.win.fetch('https://api.example.test/api/v0/accounts/1001/chats/2003/typing', { method: 'POST' });
      void live.win.fetch(`https://api.example.test${SEND_URL}?limit=10`);
      // …and someone else wraps fetch after us.
      live.win.fetch = later as unknown as typeof fetch;
    };
    live.commit(live.request(4));
    // Not ours any more: we do not put the old value over a newer wrapper.
    expect(live.win.fetch).toBe(later);
    expect(live.calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ['POST', '/api/v0/accounts/1001/chats/2003/typing'],
      ['GET', SEND_URL],
    ]);
    await live.settle();
    live.calls.at(-1)?.respond(200, { id: '8001' });
    await live.settle();
    // Neither a typing POST nor a history GET of the same chat is the send: the receipt is the send's own.
    expect(states(live, 4)).toEqual(['nativeAccepted']);
    expect(live.states(uuid(4))[0]).toMatchObject({ platformMessageId: '8001' });
  });

  it('a page without fetch stays without it: nothing is put in its place, for X8 or for a human send', () => {
    const live = start();
    (live.win as { fetch?: unknown }).fetch = undefined;
    let during: unknown = 'not asked';
    // The queue changes its state on the stack of its own send action.
    live.queue.store.$subscribe(() => {
      during = live.win.fetch;
    });
    // No send path that can be observed: X8 never reaches the queue there.
    expect(live.commit(live.request(5))).toEqual({ state: 'held', code: 'CG-SEND-RECEIPT' });
    expect(live.queue.sends).toEqual([]);
    // The person's own send goes on as ChatSpace does it, unobserved; its fact has no receipt.
    live.live.draft = { digest: 'feedbeef00000061', draft: { revision: 5, provenance: 'our-insert', insertIntentId: uuid(0x60), editedSinceInsert: false } };
    const entry = live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text: '<p>x</p>', composerContent: { html: '<p>x</p>' } });
    expect(live.posted('humanSend')).toMatchObject([{ pendingId: entry?.id, platformMessageId: null }]);
    expect(during).toBeUndefined();
    expect(live.win.fetch).toBeUndefined();
  });

  it('a fetch that takes no assignment is left alone: a human send goes on unobserved, with a fact without a receipt', async () => {
    const live = start();
    Object.defineProperty(live.win, 'fetch', { configurable: true, get: () => live.nativeFetch });
    live.live.draft = { digest: 'feedbeef00000061', draft: { revision: 5, provenance: 'our-insert', insertIntentId: uuid(0x60), editedSinceInsert: false } };
    const entry = live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text: '<p>x</p>', composerContent: { html: '<p>x</p>' } });
    expect(live.posted('humanSend')).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: null, textDigest: 'feedbeef00000061', draft: live.live.draft.draft, cargo: { priced: false, media: false } }]);
    await live.settle();
    expect(live.calls).toHaveLength(1);
  });

  it('does not issue, repeat or delay anything: one click, one request', async () => {
    const live = start();
    const { call } = await sent(live, 5);
    call.respond(503, { code: 'INTERNAL_ERROR' });
    await live.settle();
    await live.settle();
    expect(live.calls).toHaveLength(1);
    expect(states(live, 5)).toEqual(['uncertain']);
  });
});

describe('[X8-06] receipt and echo are linked by id, never by text (§6.7.6 п. 4–7)', () => {
  it('[TL-004] a 2xx with an id is the receipt; the outgoing echo with the same id, account and fan makes it sent', async () => {
    const live = start();
    const { call } = await sent(live, 10);
    expect(states(live, 10)).toEqual([]);
    call.respond(200, { id: '8001', content: '<p>hey you</p>' });
    await live.settle();
    expect(live.states(uuid(10))).toEqual([{ attemptId: uuid(10), state: 'nativeAccepted', platformMessageId: '8001' }]);
    // The success removed the queue's entry; that is not an outcome of its own.
    expect(live.queue.entries(ACC)).toEqual([]);
    // Echoes that are not this message: another id, another fan, a fan's message with that id.
    live.socket.receive(frames.message(ACC, FAN, '8002', false));
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8001', false));
    live.socket.receive(frames.message(ACC, FAN, '8001', true));
    expect(states(live, 10)).toEqual(['nativeAccepted']);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(live.states(uuid(10)).at(-1)).toEqual({ attemptId: uuid(10), state: 'sentObserved', platformMessageId: '8001' });
    // Once.
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 10)).toEqual(['nativeAccepted', 'sentObserved']);
    // The isolated side heard of the echo before the state that it completes.
    const order = live.live.posted.map((event) =>
      event.t === 'incoming' ? `incoming:${String(event.payload['fan'])}:${String(event.payload['msgId'])}:${String(event.payload['fromFan'])}` : `${event.t}:${String((event.payload['view'] as { state?: string } | undefined)?.state)}`,
    );
    const echo = order.indexOf(`incoming:${FAN}:8001:false`);
    expect(order.slice(echo, echo + 2)).toEqual([`incoming:${FAN}:8001:false`, 'previewSendState:sentObserved']);
    valid(live);
  });

  it('the echo may come before the response: the pair completes when the receipt arrives', async () => {
    const live = start();
    const { call } = await sent(live, 11);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 11)).toEqual([]);
    call.respond(200, { id: '8001' });
    await live.settle();
    expect(states(live, 11)).toEqual(['nativeAccepted', 'sentObserved']);
  });

  it('an early echo of another chat, or a fan’s message, with the receipt’s id is not this send’s echo', async () => {
    const live = start();
    const { call } = await sent(live, 8);
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8001', false));
    live.socket.receive(frames.message(ACC, FAN, '8001', true));
    call.respond(200, { id: '8001' });
    await live.settle();
    expect(states(live, 8)).toEqual(['nativeAccepted']);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 8)).toEqual(['nativeAccepted', 'sentObserved']);
  });

  it('an early echo is kept with its send: any number of other chats’ outgoing messages in between cannot push it out', async () => {
    const live = start();
    const { call } = await sent(live, 19);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    // A burst of outgoing frames of other chats and accounts (mass messages, queued ones) before the response.
    for (let n = 0; n < 200; n += 1) live.socket.receive(frames.message(ACC, String(4000 + n), String(9000 + n), false));
    call.respond(200, { id: '8001' });
    await live.settle();
    expect(states(live, 19)).toEqual(['nativeAccepted', 'sentObserved']);
    // What is kept is this chat's, and bounded: the first 64 outgoing ids since the queue call.
    const busy = await sent(live, 9, { fan: '2004' });
    for (let n = 0; n < 64; n += 1) live.socket.receive(frames.message(ACC, '2004', String(7000 + n), false));
    live.socket.receive(frames.message(ACC, '2004', '8002', false));
    busy.call.respond(200, { id: '8002' });
    await live.settle();
    expect(states(live, 9)).toEqual(['nativeAccepted']);
  });

  it('two sends with the same text: each one’s echo completes only its own receipt', async () => {
    const live = start();
    const first = await sent(live, 12, { plainText: 'same words' });
    first.call.respond(200, { id: '8001' });
    await live.settle();
    const second = await sent(live, 13, { plainText: 'same words', fan: '2004' });
    second.call.respond(200, { id: '8002' });
    await live.settle();
    // The same text for the other fan: its echo carries its own id.
    live.socket.receive(frames.message(ACC, '2004', '8002', false, { content: '<p>same words</p>' }));
    expect(states(live, 12)).toEqual(['nativeAccepted']);
    expect(states(live, 13)).toEqual(['nativeAccepted', 'sentObserved']);
    // A human's message with the same text is not the receipt's echo either.
    live.socket.receive(frames.message(ACC, FAN, '8003', false, { content: '<p>same words</p>' }));
    expect(states(live, 12)).toEqual(['nativeAccepted']);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 12)).toEqual(['nativeAccepted', 'sentObserved']);
  });

  it('the id is a string and never guessed: a safe number becomes its digits, anything else is no receipt', async () => {
    const live = start();
    const numeric = await sent(live, 14);
    numeric.call.respond(200, { id: 8001 });
    await live.settle();
    expect(live.states(uuid(14))[0]).toMatchObject({ state: 'nativeAccepted', platformMessageId: '8001' });

    for (const [n, body] of [
      [15, { id: Number.MAX_SAFE_INTEGER * 4 }],
      [16, { id: '' }],
      [17, { content: 'no id' }],
      [18, { id: 'abc' }],
    ] as const) {
      const { call } = await sent(live, n, { fan: String(2100 + n) });
      call.respond(200, body);
      await live.settle();
      // The native chain took it as a success and dropped its entry; without the id there is nothing to link.
      expect([n, states(live, n)]).toEqual([n, ['uncertain']]);
      expect(live.states(uuid(n))[0]).toMatchObject({ code: 'CG-SEND-UNCERTAIN' });
    }
    valid(live);
  });
});

describe('[X8-06] what is not a receipt (§6.7.6 п. 4, §6.7.8)', () => {
  it('a 401 is not an outcome: nothing is said at the 401, and the native re-run that succeeds leaves the attempt uncertain', async () => {
    const live = start();
    const { call } = await sent(live, 20);
    call.respond(401, { code: 'UNAUTHORIZED' });
    await live.settle();
    // The native client refreshed its token and re-ran the request — outside the observer.
    expect(live.calls).toHaveLength(2);
    expect(live.win.fetch).toBe(live.nativeFetch);
    expect(states(live, 20)).toEqual([]);
    live.calls[1]?.respond(200, { id: '8001' });
    await live.settle();
    expect(live.states(uuid(20))).toEqual([{ attemptId: uuid(20), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 401' } }]);
    // Its echo cannot complete what was never linked.
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 20)).toEqual(['uncertain']);
    valid(live);
  });

  it('after a 401 only Message Guard at the end of the chain is a refusal — without a status of its own', async () => {
    const live = start();
    const { call } = await sent(live, 21);
    call.respond(401, { code: 'UNAUTHORIZED' });
    await live.settle();
    live.calls[1]?.respond(422, { code: 'MESSAGE_GUARD_VIOLATION', topic_matches: ['direct_contact'] });
    await live.settle();
    const view = live.states(uuid(21))[0];
    expect(view).toMatchObject({ state: 'rejected', code: 'CG-SEND-GUARD', detail: { guardTopics: ['Topic direct_contact'] } });
    expect(view).not.toHaveProperty('httpStatus');
    valid(live);

    // After a 401 any other end of the chain proves nothing.
    const other = await sent(live, 22, { fan: '2004' });
    other.call.respond(401, {});
    await live.settle();
    live.calls.at(-1)?.respond(403, { code: 'FORBIDDEN' });
    await live.settle();
    expect(states(live, 22)).toEqual(['uncertain']);
  });

  it('Message Guard is a proven refusal with its topics and status; a 403 too; the native Resend stays the person’s', async () => {
    const live = start();
    const guard = await sent(live, 23);
    guard.call.respond(422, { code: 'MESSAGE_GUARD_VIOLATION', word_matches: ['word'], topic_matches: ['direct_contact', 'underage'] });
    await live.settle();
    expect(live.states(uuid(23))).toEqual([
      { attemptId: uuid(23), state: 'rejected', code: 'CG-SEND-GUARD', httpStatus: 422, detail: { guardTopics: ['direct_contact', 'underage'], upstream: 'HTTP 422 MESSAGE_GUARD_VIOLATION' } },
    ]);
    // The failed entry is still in ChatSpace's queue with its own buttons; we never call them.
    expect(live.queue.entries(ACC).map((entry) => entry.status)).toEqual(['failed']);

    const forbidden = await sent(live, 24, { fan: '2004' });
    forbidden.call.respond(403, { code: 'FORBIDDEN', message: 'no' });
    await live.settle();
    expect(live.states(uuid(24))).toEqual([{ attemptId: uuid(24), state: 'rejected', code: 'CG-SEND-REJECTED', httpStatus: 403, detail: { upstream: 'HTTP 403 FORBIDDEN' } }]);
    valid(live);

    // The person presses ChatSpace's own Resend on the Guard entry: a native request, not ours, and no new state.
    (live.queue.store['resend'] as (acc: string, id: string) => void)(ACC, guard.pendingId);
    await live.settle();
    expect(live.calls).toHaveLength(3);
    live.calls[2]?.respond(200, { id: '8009' });
    await live.settle();
    live.socket.receive(frames.message(ACC, FAN, '8009', false));
    expect(states(live, 23)).toEqual(['rejected']);
    expect(live.queue.sends).toHaveLength(2);
  });

  it.each([
    ['a 5xx', (call: { respond(status: number, body?: unknown): void }) => call.respond(502, { code: 'INTERNAL_ERROR' }), 'HTTP 502'],
    ['a network failure', (call: { fail(): void }) => call.fail(), 'no receipt'],
  ])('%s is uncertain, never a refusal', async (_name, end, upstream) => {
    const live = start();
    const { call } = await sent(live, 25);
    end(call);
    await live.settle();
    expect(live.states(uuid(25))).toEqual([{ attemptId: uuid(25), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream } }]);
    valid(live);
  });

  it('the native timeout after a real POST is uncertain; a late echo cannot complete it (no receipt was linked)', async () => {
    const live = start();
    const { pendingId } = await sent(live, 26);
    // The request is on the wire and never answered; ChatSpace's own 30 s timeout aborts it.
    live.queue.timeout(pendingId);
    await live.settle();
    expect(states(live, 26)).toEqual(['uncertain']);
    expect(live.queue.entries(ACC)[0]).toMatchObject({ status: 'failed', error: { kind: 'timeout' } });
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 26)).toEqual(['uncertain']);
    expect(live.calls).toHaveLength(1);
  });

  it.each([
    ['cancel', (live: LiveHarness, id: string) => (live.queue.store['cancel'] as (acc: string, id: string) => void)(ACC, id)],
    ['resetForAccount', (live: LiveHarness) => (live.queue.store['resetForAccount'] as (acc: string) => void)(ACC)],
    ['resetAll (a sign-out)', (live: LiveHarness) => (live.queue.store['resetAll'] as () => void)()],
  ])('the entry is taken away by %s while the request is out: uncertain, not «not sent»', async (_name, take) => {
    const live = start();
    const { pendingId } = await sent(live, 27);
    take(live, pendingId);
    await live.settle();
    expect(states(live, 27)).toEqual(['uncertain']);
    expect(live.queue.entries(ACC)).toEqual([]);
    expect(live.calls).toHaveLength(1);
  });

  it('the entry is taken away while its answer is being read: a 2xx with an id is still the receipt, said once; a refusal without the FAILED entry is not proven', async () => {
    const live = start();
    const cancel = live.queue.store['cancel'] as (acc: string, id: string) => void;
    const accepted = await sent(live, 28);
    // The observer already holds the response when the person cancels the entry.
    accepted.call.respond(200, { id: '8001' });
    cancel(ACC, accepted.pendingId);
    await live.settle();
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    // The server accepted the message; nothing was said before the answer was read, and each state is said once.
    expect(states(live, 28)).toEqual(['nativeAccepted', 'sentObserved']);

    const refused = await sent(live, 29, { fan: '2004' });
    refused.call.respond(403, { code: 'FORBIDDEN' });
    cancel(ACC, refused.pendingId);
    await live.settle();
    // The chain did not end in ChatSpace's own FAILED: whether it ran the request again is not known.
    expect(live.states(uuid(29))).toEqual([{ attemptId: uuid(29), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 403 FORBIDDEN' } }]);
    valid(live);
  });

  it('a second request through the same function proves nothing — even with the same text and an id of its own, and even next to a refusal', async () => {
    const live = start();
    let observer: ((...args: unknown[]) => unknown) | null = null;
    live.queue.during = () => {
      observer = live.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    const again = (fan: string, text: string): void =>
      void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test/api/v0/accounts/${ACC}/chats/${fan}/messages`, { method: 'POST', body: JSON.stringify({ text: toHtml(text) }) }), {});

    const first = await sent(live, 30, { fan: '2004' });
    // The same captured function is called again for the same chat with the same text: which one is «the» send cannot be told.
    again('2004', first.req.plainText);
    live.calls.at(-1)?.respond(200, { id: '8003' });
    first.call.respond(200, { id: '8002' });
    await live.settle();
    expect(states(live, 30)).toEqual(['uncertain']);

    const second = await sent(live, 35, { fan: '2005' });
    again('2005', second.req.plainText);
    second.call.respond(403, { code: 'FORBIDDEN' });
    await live.settle();
    expect(live.queue.entries(ACC).at(-1)).toMatchObject({ status: 'failed' });
    expect(states(live, 35)).toEqual(['uncertain']);
    valid(live);
  });

  it('an answer too long to be a receipt is not parsed: no id, nothing claimed', async () => {
    const live = start();
    const { call } = await sent(live, 36);
    call.respond(200, { id: '8001', padding: 'x'.repeat(70_000) });
    await live.settle();
    expect(live.states(uuid(36))).toEqual([{ attemptId: uuid(36), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 200' } }]);
  });

  it('at most 32 receipts wait for their echo; the oldest is let go and stays «accepted»', async () => {
    const live = start();
    for (let n = 0; n < 33; n += 1) {
      const { call } = await sent(live, 100 + n, { fan: String(3000 + n) });
      call.respond(200, { id: String(9000 + n) });
      await live.settle();
    }
    live.socket.receive(frames.message(ACC, '3000', '9000', false));
    live.socket.receive(frames.message(ACC, '3032', '9032', false));
    expect(states(live, 100)).toEqual(['nativeAccepted']);
    expect(states(live, 132)).toEqual(['nativeAccepted', 'sentObserved']);
  });

  it('a failure of ours inside the queue’s own state change never reaches the page', async () => {
    const live = start();
    const { call } = await sent(live, 37);
    call.respond(401, {});
    await live.settle();
    // The chain is still followed (the native re-run is out); our reading of the queue now fails.
    (live.live.host as { entries: unknown }).entries = () => {
      throw new Error('ours');
    };
    expect(() => live.queue.store.$changed()).not.toThrow();
  });

  it('a request of another chat through the observer is not this send’s, whatever it carries', async () => {
    const quiet = start();
    holdToken(quiet);
    quiet.win.fetch = () => Promise.resolve(new Response('{"id":"8001"}', { status: 200 }));
    let observer: ((...args: unknown[]) => unknown) | null = null;
    quiet.queue.during = () => {
      observer = quiet.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    const req = quiet.request(34);
    expect(quiet.commit(req).state).toBe('nativeEnqueued');
    // The same text, answered 200 with an id — for another chat of the account.
    void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test/api/v0/accounts/${ACC}/chats/2004/messages`, { method: 'POST', body: JSON.stringify({ text: toHtml(req.plainText) }) }), {});
    await quiet.settle();
    expect(quiet.states(uuid(34))).toEqual([{ attemptId: uuid(34), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'no receipt' } }]);
  });

  it('a text in the request that is not the one queued is not ours to confirm', async () => {
    const quiet = start();
    holdToken(quiet);
    quiet.win.fetch = () => Promise.resolve(new Response('{"id":"8001"}', { status: 200 }));
    let observer: ((...args: unknown[]) => unknown) | null = null;
    quiet.queue.during = () => {
      observer = quiet.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    expect(quiet.commit(quiet.request(31)).state).toBe('nativeEnqueued');
    // The observer sees a POST of this chat with another text, answered 200 with an id.
    void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test${SEND_URL}`, { method: 'POST', body: JSON.stringify({ text: '<p>other</p>' }) }), {});
    await quiet.settle();
    expect(quiet.states(uuid(31))).toEqual([{ attemptId: uuid(31), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'HTTP 200' } }]);
  });

  it('a send whose request did not take the observer closes X8 for the document (the send path is not the profile’s)', async () => {
    const live = start({ queue: { earlyFetch: true } });
    // The client took fetch when it was built, not for this request: the message is queued, and nothing of it can be seen.
    expect(live.commit(live.request(32))).toEqual({ state: 'uncertain', code: 'CG-SEND-UNCERTAIN' });
    expect(live.win.fetch).toBe(live.nativeFetch);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(live.states()).toEqual([]);
    const next = live.request(33, { fan: '2004' });
    expect(live.preflight(next)).toEqual({ ok: false, code: 'CG-SEND-RECEIPT' });
    expect(live.commit(next)).toEqual({ state: 'held', code: 'CG-SEND-RECEIPT' });
    expect(live.queue.sends).toHaveLength(1);
  });

  it.each([
    ['cancel', (live: LiveHarness, id: string) => (live.queue.store['cancel'] as (acc: string, id: string) => void)(ACC, id)],
    ['resetForAccount', (live: LiveHarness) => (live.queue.store['resetForAccount'] as (acc: string) => void)(ACC)],
    ['resetAll (a sign-out)', (live: LiveHarness) => (live.queue.store['resetAll'] as () => void)()],
  ])('the entry is taken away by %s before its request reached fetch (the client waits for its token): uncertain, and X8 stays on', async (_name, take) => {
    const live = start();
    const handOver = holdToken(live);
    const answer = live.commit(live.request(60));
    expect(answer.state).toBe('nativeEnqueued');
    await live.settle();
    expect(live.calls).toEqual([]);
    take(live, answer.pendingId as string);
    await live.settle();
    expect(live.states(uuid(60))).toEqual([{ attemptId: uuid(60), state: 'uncertain', code: 'CG-SEND-UNCERTAIN', detail: { upstream: 'no receipt' } }]);
    // The token comes at last: the client's aborted request ends in its own way, and nothing more is said.
    handOver();
    await live.settle();
    expect(states(live, 60)).toEqual(['uncertain']);
    // The send path was the profile's (the client took the observer); the entry was simply taken away.
    const next = live.request(61, { fan: '2004' });
    expect(live.preflight(next)).toEqual({ ok: true });
    expect(live.commit(next).state).toBe('nativeEnqueued');
    valid(live);
  });

  it('after an outcome the kept function says nothing more: a later request through it is only passed on', async () => {
    const live = start();
    let observer: ((...args: unknown[]) => unknown) | null = null;
    live.queue.during = () => {
      observer = live.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    const { req, call } = await sent(live, 62);
    call.respond(200, { id: '8001' });
    await live.settle();
    expect(states(live, 62)).toEqual(['nativeAccepted']);
    // The function the client captured lives on in its closure; whatever goes through it now is not this attempt's.
    const later = (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test${SEND_URL}`, { method: 'POST', body: JSON.stringify({ text: toHtml(req.plainText) }) }), {});
    expect(live.calls).toHaveLength(2);
    live.calls[1]?.respond(403, { code: 'FORBIDDEN' });
    await live.settle();
    expect(((await later) as Response).status).toBe(403);
    expect(states(live, 62)).toEqual(['nativeAccepted']);
    live.socket.receive(frames.message(ACC, FAN, '8001', false));
    expect(states(live, 62)).toEqual(['nativeAccepted', 'sentObserved']);
  });
});

describe('[TL-004] a human send from the composer (§6.6)', () => {
  const ours = { digest: 'feedbeef00000061', draft: { revision: 5, provenance: 'our-insert' as const, insertIntentId: uuid(0x60), editedSinceInsert: false } };
  const composerSend = (live: LiveHarness, fan = OPEN_FAN, text = '<p>inserted</p>') =>
    live.queue.send({ accountId: ACC, chatId: fan, platform: 'onlyfans', text, hasAttachments: false, platformMetadata: {}, composerContent: { html: text, media: null, gif: null, taggedCreators: [] } });
  const facts = (live: LiveHarness) => live.posted('humanSend');
  /** A send of text alone (decision X48): no price, no media. */
  const NONE = { priced: false, media: false };

  it('our unchanged insert, a free queue: the receipt of exactly this send and its echo go out as one fact, once, with the draft recorded before the send', async () => {
    const live = start();
    live.live.draft = ours;
    let during: unknown = null;
    live.queue.during = () => {
      during = live.win.fetch;
    };
    const entry = composerSend(live);
    expect(during).not.toBe(live.nativeFetch);
    expect(live.win.fetch).toBe(live.nativeFetch);
    expect(facts(live)).toEqual([]);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8101' });
    await live.settle();
    // The receipt alone is not «sent» (§6.6 п. 4): the fact waits for the outgoing echo with the same id, account and fan.
    expect(facts(live)).toEqual([]);
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8102', false));
    live.socket.receive(frames.message(ACC, FAN, '8101', false));
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8101', true));
    expect(facts(live)).toEqual([]);
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8101', false));
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: '8101', textDigest: ours.digest, draft: ours.draft, cargo: NONE }]);
    expect(FROM_MAIN.humanSend.safeParse(facts(live)[0]).success).toBe(true);
    // Once; and the isolated side heard of the echo before the fact that it completes.
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8101', false));
    expect(facts(live)).toHaveLength(1);
    const order = live.live.posted.map((event) => (event.t === 'incoming' ? `incoming:${String(event.payload['msgId'])}:${String(event.payload['fan'])}:${String(event.payload['fromFan'])}` : event.t));
    const echo = order.indexOf(`incoming:8101:${OPEN_FAN}:false`);
    expect(order.slice(echo, echo + 2)).toEqual([`incoming:8101:${OPEN_FAN}:false`, 'humanSend']);
    // Nothing of X8 was said, and the page's own fetch got the composer's own request.
    expect(live.states()).toEqual([]);
    expect(live.calls[0]?.input).toBe(live.queue.requests[0]);
  });

  it('the echo may come before the response: the fact goes out when the receipt arrives', async () => {
    const live = start();
    live.live.draft = ours;
    const entry = composerSend(live);
    await live.settle();
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8109', false));
    expect(facts(live)).toEqual([]);
    live.calls[0]?.respond(200, { id: '8109' });
    await live.settle();
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: '8109', textDigest: ours.digest, draft: ours.draft, cargo: NONE }]);
  });

  it('a client that did not take the observer for a human send: a fact without a receipt, and X8 is not closed by it', async () => {
    const live = start({ queue: { earlyFetch: true } });
    live.live.draft = ours;
    const entry = composerSend(live);
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: null, textDigest: ours.digest, draft: ours.draft, cargo: NONE }]);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8110' });
    await live.settle();
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8110', false));
    expect(facts(live)).toHaveLength(1);
    expect(live.preflight(live.request(70))).toEqual({ ok: true });
  });

  it('the answer may be read before the queue hands over its entry: the fact waits for the entry and is said once', async () => {
    const live = start();
    live.live.draft = ours;
    const text = '<p>inserted</p>';
    let finish: ((entry: unknown) => void) | null = null;
    // The queue's action as an asynchronous one would be: Pinia calls `after` when its promise settles.
    live.port.sent(
      { accountId: ACC, chatId: OPEN_FAN, text, composerContent: { html: text } },
      (callback) => (finish = callback),
      () => undefined,
    );
    void (live.win.fetch as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test/api/v0/accounts/${ACC}/chats/${OPEN_FAN}/messages`, { method: 'POST', body: JSON.stringify({ text }) }), {});
    // The observer does not wait for the action to finish: the page's fetch is back when this stack ends.
    await Promise.resolve();
    expect(live.win.fetch).toBe(live.nativeFetch);
    live.calls[0]?.respond(200, { id: '8105' });
    await live.settle();
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8105', false));
    expect(facts(live)).toEqual([]);
    (finish as unknown as (entry: unknown) => void)({ id: 'entry-1' });
    expect(live.win.fetch).toBe(live.nativeFetch);
    expect(facts(live)).toEqual([]);
    // The entry came after the echo: what was seen for the chat before is not this send's to claim; the next echo is.
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8105', false));
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: 'entry-1', platformMessageId: '8105', textDigest: ours.digest, draft: ours.draft, cargo: NONE }]);
  });

  it('the queue’s state is watched only while a send is followed', async () => {
    const live = start();
    let watching = 0;
    const subscribe = live.queue.store.$subscribe.bind(live.queue.store);
    live.queue.store.$subscribe = (listener, options) => {
      watching += 1;
      const stop = subscribe(listener, options);
      return () => {
        watching -= 1;
        stop();
      };
    };
    live.live.draft = ours;
    // A refused send is not followed at all.
    live.queue.refuseNext();
    composerSend(live);
    expect(watching).toBe(0);
    composerSend(live);
    expect(watching).toBe(1);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8108' });
    await live.settle();
    // The native chain ended with the receipt: the queue is no longer watched while the fact waits for its echo.
    expect(watching).toBe(0);
    expect(facts(live)).toEqual([]);
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8108', false));
    expect(facts(live)).toHaveLength(1);
  });

  it('a text too long to compare is not ours to attribute', async () => {
    const live = start();
    live.live.draft = ours;
    composerSend(live, OPEN_FAN, `<p>${'x'.repeat(70_000)}</p>`);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8106' });
    await live.settle();
    expect(facts(live)).toMatchObject([{ platformMessageId: null, textDigest: ours.digest }]);
  });

  it('an edited insert keeps its intent and says «edited»', async () => {
    const live = start();
    live.live.draft = { digest: 'feedbeef00000062', draft: { revision: 8, provenance: 'human-or-unknown', insertIntentId: uuid(0x60), editedSinceInsert: true } };
    composerSend(live);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8102' });
    await live.settle();
    live.socket.receive(frames.message(ACC, OPEN_FAN, '8102', false));
    expect(facts(live)[0]).toMatchObject({ platformMessageId: '8102', draft: { insertIntentId: uuid(0x60), editedSinceInsert: true } });
  });

  it('a send that waits in a busy queue has no receipt: attribution unknown, and fetch is never touched', async () => {
    const live = start();
    await sent(live, 40);
    live.live.draft = ours;
    let during: unknown = null;
    live.queue.during = () => {
      during = live.win.fetch;
    };
    const entry = composerSend(live);
    // The fact goes out at once: there is nothing to wait for.
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: null, textDigest: ours.digest, draft: ours.draft, cargo: NONE }]);
    // The waiting send creates its request later, when the first is done: the observer is long gone.
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    expect(during).toBe(live.nativeFetch);
    live.calls[1]?.respond(200, { id: '8103' });
    await live.settle();
    expect(facts(live)).toHaveLength(1);
  });

  it('a draft that is not from our insert is a fact without a receipt, and nothing watches its request', () => {
    const live = start();
    live.live.draft = { digest: 'feedbeef00000063', draft: { revision: 11, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } };
    let during: unknown = null;
    live.queue.during = () => {
      during = live.win.fetch;
    };
    const entry = composerSend(live);
    expect(during).toBe(live.nativeFetch);
    expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: null, textDigest: 'feedbeef00000063', draft: live.live.draft.draft, cargo: NONE }]);
  });

  it('no receipt, no id: a refusal, a 5xx or a 401 chain leave the attribution unknown', async () => {
    for (const [status, body] of [
      [422, { code: 'MESSAGE_GUARD_VIOLATION' }],
      [500, {}],
    ] as const) {
      const live = startLive();
      live.live.draft = ours;
      composerSend(live);
      await live.settle();
      live.calls[0]?.respond(status, body);
      await live.settle();
      expect(live.posted('humanSend')).toMatchObject([{ platformMessageId: null, draft: { insertIntentId: uuid(0x60) } }]);
      live.dispose();
    }
    const live = start();
    live.live.draft = ours;
    composerSend(live);
    await live.settle();
    live.calls[0]?.respond(401, {});
    await live.settle();
    live.calls[1]?.respond(200, { id: '8104' });
    await live.settle();
    expect(facts(live)).toMatchObject([{ platformMessageId: null }]);
  });

  it('what is not the open chat’s composer is not reported: a quick reply, another chat, a refused or failed queue call, our own X8 call', async () => {
    const live = start();
    live.live.draft = ours;
    let during: unknown = null;
    live.queue.during = () => {
      during = live.win.fetch;
    };
    // A notification's quick reply passes no composer content.
    live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text: 'quick', platformMetadata: {} });
    expect(during).toBe(live.nativeFetch);
    live.calls.at(-1);
    await live.settle();
    live.calls[0]?.respond(200, { id: '8105' });
    await live.settle();
    // Another chat's composer (not the route's): its draft is not known.
    composerSend(live, '2009');
    await live.settle();
    live.calls[1]?.respond(200, { id: '8106' });
    await live.settle();
    // The queue refuses, then throws: nothing was sent, and fetch is the page's again.
    live.queue.refuseNext();
    composerSend(live);
    expect(live.win.fetch).toBe(live.nativeFetch);
    live.queue.throwNext();
    expect(() => composerSend(live)).toThrow('queue failed');
    expect(live.win.fetch).toBe(live.nativeFetch);
    // The same for the person's own text, which nothing watches.
    live.live.draft = { digest: 'feedbeef00000064', draft: { revision: 2, provenance: 'human-or-unknown', insertIntentId: null, editedSinceInsert: null } };
    live.queue.refuseNext();
    composerSend(live);
    // Our own preview send is an X8 attempt, not a human send — even to a chat whose draft is ours.
    live.live.route = { name: 'chat', acc: ACC, fan: '2010' };
    live.live.draft = ours;
    const { call } = await sent(live, 41);
    call.respond(200, { id: '8107' });
    await live.settle();
    expect(facts(live)).toEqual([]);
    expect(states(live, 41)).toEqual(['nativeAccepted']);
  });
  describe('[X48] who sent each message: while the hub records it, every human send of the composer is followed', () => {
    const typed = { digest: 'feedbeef00000071', draft: { revision: 3, provenance: 'human-or-unknown' as const, insertIntentId: null, editedSinceInsert: null } };
    const attributing = (options?: Parameters<typeof startLive>[0]): LiveHarness => {
      const live = start(options);
      expect(live.port.handle('flags', { wsTap: true, previewSend: true, attribution: true })).toEqual({ wsTap: true, previewSend: true, attribution: true });
      live.live.draft = typed;
      return live;
    };

    it('the person’s own text, a free queue: the receipt of exactly this send and its echo name the message, once', async () => {
      const live = attributing();
      let during: unknown = null;
      live.queue.during = () => {
        during = live.win.fetch;
      };
      const entry = composerSend(live, OPEN_FAN, '<p>my own words</p>');
      expect(during).not.toBe(live.nativeFetch);
      expect(live.win.fetch).toBe(live.nativeFetch);
      await live.settle();
      live.calls[0]?.respond(200, { id: '8201' });
      await live.settle();
      expect(facts(live)).toEqual([]);
      live.socket.receive(frames.message(ACC, OPEN_FAN, '8201', false));
      expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: '8201', textDigest: typed.digest, draft: typed.draft, cargo: NONE }]);
      expect(FROM_MAIN.humanSend.safeParse(facts(live)[0]).success).toBe(true);
      // Never a part of ours: the draft names no insert, so nothing downstream takes it for one.
      expect(facts(live)[0]?.['draft']).toMatchObject({ insertIntentId: null });
      expect(live.states()).toEqual([]);
    });

    it('a PPV: a price above zero and its media are two marks — never the price, the media or the text', async () => {
      const live = attributing();
      const text = '<p>for you</p>';
      live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text, hasAttachments: true, platformMetadata: { price: 25, mediaFiles: [{ processId: 'p1' }], previews: [] }, composerContent: { html: text, media: [{ id: 1 }], gif: null, taggedCreators: [] } });
      await live.settle();
      live.calls[0]?.respond(200, { id: '8202' });
      await live.settle();
      live.socket.receive(frames.message(ACC, OPEN_FAN, '8202', false));
      expect(facts(live)).toMatchObject([{ platformMessageId: '8202', cargo: { priced: true, media: true } }]);
      expect(JSON.stringify(facts(live))).not.toMatch(/25|p1|for you/);
      // Free media with a price of zero, or a price the queue writes as text.
      live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text, hasAttachments: true, platformMetadata: { price: 0, mediaFiles: [{ processId: 'p2' }] }, composerContent: { html: text, media: null } });
      await live.settle();
      live.calls[1]?.respond(200, { id: '8203' });
      await live.settle();
      live.socket.receive(frames.message(ACC, OPEN_FAN, '8203', false));
      live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text, hasAttachments: false, platformMetadata: { price: '9.99', lockedText: true }, composerContent: { html: text, media: null } });
      await live.settle();
      live.calls[2]?.respond(200, { id: '8204' });
      await live.settle();
      live.socket.receive(frames.message(ACC, OPEN_FAN, '8204', false));
      expect(facts(live).map((fact) => fact['cargo'])).toEqual([{ priced: true, media: true }, { priced: false, media: true }, { priced: true, media: false }]);
    });

    it('a send that waits in a busy queue still has no receipt: its request comes later, when the observer is long gone', async () => {
      const live = attributing();
      await sent(live, 42);
      const entry = composerSend(live);
      expect(facts(live)).toEqual([{ acc: ACC, fan: OPEN_FAN, pendingId: entry?.id, platformMessageId: null, textDigest: typed.digest, draft: typed.draft, cargo: NONE }]);
    });

    it('off again, or without the tap: the person’s own text is not watched, as before', () => {
      const live = attributing();
      expect(live.port.handle('flags', { wsTap: true, previewSend: true })).toEqual({ wsTap: true, previewSend: true, attribution: false });
      let during: unknown = null;
      live.queue.during = () => {
        during = live.win.fetch;
      };
      composerSend(live);
      expect(during).toBe(live.nativeFetch);
      expect(facts(live)).toMatchObject([{ platformMessageId: null }]);
      // The tap told to stand down takes the latch with it.
      expect(live.port.handle('flags', { wsTap: false, previewSend: true, attribution: true })).toMatchObject({ wsTap: false, attribution: false });
    });
  });
});

// Decision X25: X8 runs on any ChatSpace build; after a send whose outcome is known the observer checks what it already
// holds, and tells the isolated side when it is not what we sent. It never sends, retries or changes an outcome.
describe('[X8-06] the fuse after a send (decision X25)', () => {
  /** The words MAIN said to the isolated side about the fuse, as the contract has them. */
  const fuses = (live: LiveHarness): Array<Record<string, unknown>> => {
    const posted = live.posted('previewSendFuse');
    for (const fact of posted) expect([fact, FROM_MAIN.previewSendFuse.safeParse(fact).success]).toEqual([fact, true]);
    return posted;
  };
  /** A send of `text` to FAN answered 200 with `id` (and the response's own content, if any). */
  async function accepted(live: LiveHarness, n: number, id: string, over: Parameters<LiveHarness['request']>[1] = {}, content?: string) {
    const out = await sent(live, n, over);
    out.call.respond(200, content === undefined ? { id } : { id, content });
    await live.settle();
    return out;
  }
  const echo = (live: LiveHarness, id: string, content: string, fan = FAN, acc = ACC): void => live.socket.receive(frames.message(acc, fan, id, false, { content }));

  it('[a] the echo of the receipt’s id shows another text: the attempt stays sent, the fuse trips once — lengths only, never the text — and nothing is sent again', async () => {
    const live = start();
    await accepted(live, 70, '8701', { plainText: 'Hello there, my friend' });
    echo(live, '8701', '<p>Something else entirely</p>');
    expect(states(live, 70)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([{ attemptId: uuid(70), reason: 'text', where: 'echo', sentChars: 'Hellothere,myfriend'.length, seenChars: 'Somethingelseentirely'.length }]);
    expect(JSON.stringify(live.live.posted)).not.toContain('Something else');
    // The same echo again, or another text: said once per attempt.
    echo(live, '8701', '<p>Yet another</p>');
    expect(fuses(live)).toHaveLength(1);
    // One click, one queue call, one POST: the fuse neither repeats nor sends.
    expect(live.queue.sends).toHaveLength(1);
    expect(live.calls).toHaveLength(1);
  });

  it('[a] the echo may come first: its text is judged when the receipt names its id', async () => {
    const live = start();
    const { call } = await sent(live, 71, { plainText: 'hey you' });
    echo(live, '8711', '<p>not what we sent</p>');
    expect(fuses(live)).toEqual([]);
    call.respond(200, { id: '8711' });
    await live.settle();
    expect(states(live, 71)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([{ attemptId: uuid(71), reason: 'text', where: 'echo', sentChars: 6, seenChars: 'notwhatwesent'.length }]);
  });

  it('[a] the message the response carries shows another text; a response without one says nothing', async () => {
    const live = start();
    await accepted(live, 72, '8721', {}, '<p>rewritten by someone</p>');
    expect(fuses(live)).toMatchObject([{ attemptId: uuid(72), reason: 'text', where: 'response' }]);
    expect(states(live, 72)).toEqual(['nativeAccepted']);
    const quiet = start();
    await accepted(quiet, 73, '8731');
    echo(quiet, '8731', '<p>hey you</p>');
    expect(states(quiet, 73)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(quiet)).toEqual([]);
  });

  it('[a] the request ChatSpace put on the wire carries another text: uncertain as before, and the fuse trips', async () => {
    const quiet = start();
    holdToken(quiet);
    quiet.win.fetch = () => Promise.resolve(new Response('{"id":"8741"}', { status: 200 }));
    let observer: ((...args: unknown[]) => unknown) | null = null;
    quiet.queue.during = () => {
      observer = quiet.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    expect(quiet.commit(quiet.request(74)).state).toBe('nativeEnqueued');
    void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test${SEND_URL}`, { method: 'POST', body: JSON.stringify({ text: '<p>other</p>' }) }), {});
    await quiet.settle();
    expect(states(quiet, 74)).toEqual(['uncertain']);
    expect(fuses(quiet)).toMatchObject([{ attemptId: uuid(74), reason: 'text', where: 'request' }]);
  });

  it.each([
    ['the platform’s own HTML: `<br />`, entities for the quotes', '<p>Tom &amp; Jerry say &quot;hi&quot; &lt;3 &gt; 2<br />line two</p>'],
    ['a paragraph per line', '<p>Tom &amp; Jerry say &#34;hi&#34; &lt;3 &gt; 2</p><p>line two</p>'],
    ['plain text with an unescaped ampersand and quotes', 'Tom & Jerry say "hi" &lt;3 &gt; 2\nline two'],
    ['numeric and hex entities, a non-breaking space', '<p>Tom&#160;&#x26; Jerry say &#x22;hi&#x22; &#60;3 &#62; 2<br>line two</p>'],
    ['the angle brackets left unescaped by the platform', '<p>Tom &amp; Jerry say "hi" <3 > 2<br>line two</p>'],
    ['white space trimmed and doubled', '  <p>Tom &amp;  Jerry say "hi" &lt;3 &gt; 2</p>\n\n<p> line two </p> '],
    ['decoded twice (an escaped entity read once more)', '<p>Tom &amp;amp; Jerry say &amp;quot;hi&amp;quot; &amp;lt;3 &amp;gt; 2<br>line two</p>'],
  ])('[a] a harmless rewrite of the same text is no trip: %s', async (_name, content) => {
    const live = start();
    await accepted(live, 75, '8751', { plainText: 'Tom & Jerry say "hi" <3 > 2\r\nline two' });
    echo(live, '8751', content);
    expect(states(live, 75)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([]);
  });

  it.each([
    ['another word', '<p>Tom &amp; Jerry say &quot;bye&quot; &lt;3 &gt; 2<br>line two</p>'],
    ['a line lost', '<p>Tom &amp; Jerry say &quot;hi&quot; &lt;3 &gt; 2</p>'],
    ['curly quotes for straight ones', '<p>Tom &amp; Jerry say “hi” &lt;3 &gt; 2<br>line two</p>'],
    ['an empty message', ''],
  ])('[a] another text trips it: %s', async (_name, content) => {
    const live = start();
    await accepted(live, 76, '8761', { plainText: 'Tom & Jerry say "hi" <3 > 2\nline two' });
    echo(live, '8761', content);
    expect(fuses(live)).toMatchObject([{ attemptId: uuid(76), reason: 'text', where: 'echo' }]);
  });

  it('[a] an echo without a text (a media message, a frame of another shape) is not compared', async () => {
    const live = start();
    await accepted(live, 77, '8771');
    live.socket.receive(frames.message(ACC, FAN, '8771', false, { content: null }));
    expect(states(live, 77)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([]);
  });

  it('[b] one click, two POSTs through the observer: uncertain as before, and the fuse trips with `count`', async () => {
    const live = start();
    let observer: ((...args: unknown[]) => unknown) | null = null;
    live.queue.during = () => {
      observer = live.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    const first = await sent(live, 78);
    void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test${SEND_URL}`, { method: 'POST', body: JSON.stringify({ text: toHtml(first.req.plainText) }) }), {});
    live.calls.at(-1)?.respond(200, { id: '8782' });
    first.call.respond(200, { id: '8781' });
    await live.settle();
    expect(states(live, 78)).toEqual(['uncertain']);
    expect(fuses(live)).toEqual([{ attemptId: uuid(78), reason: 'count', where: 'request' }]);
  });

  it('[b] a second outgoing message with our text in that chat, around the receipt: `count`; a redelivered echo is the same message', async () => {
    const live = start();
    await accepted(live, 79, '8791');
    echo(live, '8791', '<p>hey you</p>');
    echo(live, '8791', '<p>hey you</p>');
    expect(fuses(live)).toEqual([]);
    // Another chat's message with the same text, or another text in this chat, is not ours.
    echo(live, '8793', '<p>hey you</p>', '2004');
    echo(live, '8794', '<p>something else</p>');
    expect(fuses(live)).toEqual([]);
    echo(live, '8792', '<p>hey you</p>');
    expect(states(live, 79)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([{ attemptId: uuid(79), reason: 'count', where: 'echo' }]);
  });

  it('[b] the chat is watched until shortly after the receipt; after a chain that ended without one (the person may press Resend), not at all', async () => {
    const live = start();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await accepted(live, 80, '8801');
    echo(live, '8801', '<p>hey you</p>');
    clock.mockReturnValue(now + 11_000);
    echo(live, '8802', '<p>hey you</p>');
    expect(fuses(live)).toEqual([]);
    clock.mockRestore();
    // A refusal: the person's own Resend of the same text later is theirs.
    const refused = await sent(live, 81, { fan: '2004' });
    refused.call.respond(403, { code: 'FORBIDDEN' });
    await live.settle();
    expect(states(live, 81)).toEqual(['rejected']);
    echo(live, '8811', '<p>hey you</p>', '2004');
    echo(live, '8812', '<p>hey you</p>', '2004');
    expect(fuses(live)).toEqual([]);
  });

  it('[b] a new send in that chat — ours or the person’s — ends the tail: its own message with the same words is not a second one of the first click', async () => {
    const live = start();
    await accepted(live, 88, '8881');
    echo(live, '8881', '<p>hey you</p>');
    // The next part of the group, the same words, a few seconds later: a click of its own.
    await accepted(live, 89, '8891');
    echo(live, '8891', '<p>hey you</p>');
    expect(states(live, 89)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([]);
    // The person's own send in that chat ends the tail too (its echo is theirs).
    const human = start();
    await accepted(human, 90, '8901');
    echo(human, '8901', '<p>hey you</p>');
    human.queue.send({ accountId: ACC, chatId: FAN, platform: 'onlyfans', text: '<p>hey you</p>', composerContent: { html: '<p>hey you</p>' } });
    echo(human, '8902', '<p>hey you</p>');
    expect(fuses(human)).toEqual([]);
  });

  it('[c] a POST through the observer for another chat: uncertain as before, and the fuse trips with `target`', async () => {
    const quiet = start();
    holdToken(quiet);
    quiet.win.fetch = () => Promise.resolve(new Response('{"id":"8821"}', { status: 200 }));
    let observer: ((...args: unknown[]) => unknown) | null = null;
    quiet.queue.during = () => {
      observer = quiet.win.fetch as unknown as (...args: unknown[]) => unknown;
    };
    const req = quiet.request(82);
    expect(quiet.commit(req).state).toBe('nativeEnqueued');
    void (observer as unknown as (...args: unknown[]) => unknown)(new Request(`https://api.example.test/api/v0/accounts/${ACC}/chats/2004/messages`, { method: 'POST', body: JSON.stringify({ text: toHtml(req.plainText) }) }), {});
    await quiet.settle();
    expect(states(quiet, 82)).toEqual(['uncertain']);
    expect(fuses(quiet)).toEqual([{ attemptId: uuid(82), reason: 'target', where: 'request' }]);
  });

  it('[c] the echo of our receipt’s id comes in another chat: `target`, and the attempt is not completed by it (an account the page does not serve never reaches the tap)', async () => {
    const live = start();
    await accepted(live, 83, '8831');
    echo(live, '8831', '<p>hey you</p>', '2004');
    expect(states(live, 83)).toEqual(['nativeAccepted']);
    expect(fuses(live)).toEqual([{ attemptId: uuid(83), reason: 'target', where: 'echo' }]);
    // The right chat's echo still completes the pair (the fuse changes no outcome).
    echo(live, '8831', '<p>hey you</p>');
    expect(states(live, 83)).toEqual(['nativeAccepted', 'sentObserved']);
  });

  it('[b] [c] one click made more than one queue entry, or one of another chat: the fuse trips with `count` or `target` (the queue’s word)', () => {
    const live = start();
    live.queue.during = () => {
      live.queue.during = null;
      (live.queue.store['messagesByAccountId'] as Record<string, unknown[]>)[ACC]?.push({ id: `extra-${FAN}`, accountId: ACC, chatId: FAN, platform: 'onlyfans', status: 'failed', error: null, createdAt: new Date().toISOString(), payload: {} });
    };
    expect(live.commit(live.request(85)).state).toBe('nativeEnqueued');
    expect(fuses(live)).toEqual([{ attemptId: uuid(85), reason: 'count', where: 'queue' }]);
    const other = start();
    other.queue.during = () => {
      other.queue.during = null;
      (other.queue.store['messagesByAccountId'] as Record<string, unknown[]>)[ACC]?.push({ id: 'extra-2004', accountId: ACC, chatId: '2004', platform: 'onlyfans', status: 'failed', error: null, createdAt: new Date().toISOString(), payload: {} });
    };
    expect(other.commit(other.request(86)).state).toBe('nativeEnqueued');
    expect(fuses(other)).toEqual([{ attemptId: uuid(86), reason: 'target', where: 'queue' }]);
    // A queue that adds the one entry it returns: nothing to say.
    const plain = start();
    expect(plain.commit(plain.request(87)).state).toBe('nativeEnqueued');
    expect(fuses(plain)).toEqual([]);
  });

  it('a human send from the composer is never the fuse’s: another text in its echo trips nothing', async () => {
    const live = start();
    live.live.draft = { digest: 'feedbeef00000061', draft: { revision: 5, provenance: 'our-insert', insertIntentId: uuid(0x60), editedSinceInsert: false } };
    live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text: '<p>mine</p>', composerContent: { html: '<p>mine</p>' } });
    await live.settle();
    live.calls.at(-1)?.respond(200, { id: '8881', content: '<p>changed</p>' });
    await live.settle();
    echo(live, '8881', '<p>changed again</p>', OPEN_FAN);
    echo(live, '8882', '<p>mine</p>', OPEN_FAN);
    echo(live, '8883', '<p>mine</p>', OPEN_FAN);
    expect(live.posted('humanSend')).toHaveLength(1);
    expect(fuses(live)).toEqual([]);
  });
});
