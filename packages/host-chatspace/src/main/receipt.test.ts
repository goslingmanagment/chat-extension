// The receipt observer (architecture.md §6.6, §6.7.6–§6.7.8): what it does to
// the page's fetch (nothing but watching), and which outcome each native
// chain ends in. The queue and its HTTP client are the fake ones of
// testing/fake-live.ts; the page's fetch is answered by the test.


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
  ])('the entry is taken away by %s while the request is out: uncertain, not «not sent»', async (_name, take) => {
    const live = start();
    const { pendingId } = await sent(live, 27);
    take(live, pendingId);
    await live.settle();
    expect(states(live, 27)).toEqual(['uncertain']);
    expect(live.queue.entries(ACC)).toEqual([]);
    expect(live.calls).toHaveLength(1);
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
  ])('[a] a harmless rewrite of the same text is no trip: %s', async (_name, content) => {
    const live = start();
    await accepted(live, 75, '8751', { plainText: 'Tom & Jerry say "hi" <3 > 2\r\nline two' });
    echo(live, '8751', content);
    expect(states(live, 75)).toEqual(['nativeAccepted', 'sentObserved']);
    expect(fuses(live)).toEqual([]);
  });

  it.each([
    ['another word', '<p>Tom &amp; Jerry say &quot;bye&quot; &lt;3 &gt; 2<br>line two</p>'],
    ['an empty message', ''],
  ])('[a] another text trips it: %s', async (_name, content) => {
    const live = start();
    await accepted(live, 76, '8761', { plainText: 'Tom & Jerry say "hi" <3 > 2\nline two' });
    echo(live, '8761', content);
    expect(fuses(live)).toMatchObject([{ attemptId: uuid(76), reason: 'text', where: 'echo' }]);
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
});
