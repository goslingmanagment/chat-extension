// The relay frame of «Fansly через вкладку» (R20 P9c; architecture.md §8.5, §8.6; FS-NET-4, FX-001): its part of
// the last check right before its own fetch — the frame the route was chosen with, the account it serves, Fansly's
// API alone —, its answers like `fetch` (the head first, then the body, or why none), its hello on every new port.

import { FANSLY_RELAY_TARGET, FANSLY_TAB_EVENTS, FANSLY_TAB_LIMITS } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { accountOfAddress, readRelayFetch, RELAY_BODY_MAX_CHARS, RELAY_TARGET, serveFrom, startFanslyRelay, type RelayChannel } from '../src/entrypoints/fansly-relay/relay.ts';

const CREATOR = '700000000000000001';
const OTHER = '700000000000000002';
const RELAY_ID = '00000000-0000-4000-8000-000000000501';
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const fetchOf = (n: number, overrides: Record<string, unknown> = {}) => ({
  requestId: uuid(n),
  method: 'GET',
  url: `${RELAY_TARGET}group/1/?ngsw-bypass=true`,
  headers: [['authorization', 'token'], ['x-cg-request-id', uuid(900 + n)]],
  expect: { hostAccountId: CREATOR, relayId: RELAY_ID },
  ...overrides,
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function channel() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const opens = new Set<() => void>();
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const port: RelayChannel = {
    request(type, payload) {
      sent.push({ type, payload: payload as Record<string, unknown> });
      return Promise.resolve({ ok: true, payload: { recorded: true } });
    },
    onEvent(type, listener) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    onOpen(listener) {
      opens.add(listener);
      return () => opens.delete(listener);
    },
  };
  return {
    port,
    sent,
    open: () => {
      for (const listener of opens) listener();
    },
    event: (type: string, payload: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(payload);
    },
  };
}

interface Fetched {
  readonly url: string;
  readonly init: RequestInit;
}

function frame(options: { readonly reply?: (url: string, init: RequestInit) => Promise<Response>; readonly stand?: string | null } = {}) {
  const wire = channel();
  const fetched: Fetched[] = [];
  const relay = startFanslyRelay({
    channel: wire.port,
    fetch: (url, init) => {
      fetched.push({ url, init });
      return options.reply?.(url, init) ?? Promise.resolve(new Response('{"success":true,"response":{}}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', 'retry-after': '5' } }));
    },
    hostAccountId: CREATOR,
    relayId: RELAY_ID,
    serve: serveFrom(options.stand ?? null),
  });
  return { ...wire, fetched, relay };
}

describe('[host:fansly] the relay frame (R20 P9c, FS-NET-4)', () => {
  it('[FX-001] says it is up on every new port: the account it serves and its own id', () => {
    const f = frame();
    f.open();
    f.open();
    expect(f.sent).toEqual([
      { type: 'fansly.relay.hello', payload: { hostAccountId: CREATOR, relayId: RELAY_ID } },
      { type: 'fansly.relay.hello', payload: { hostAccountId: CREATOR, relayId: RELAY_ID } },
    ]);
  });

  it('[FX-001] [FS-NET-4] fetches Fansly’s API as asked — no cookie, no redirect, no referrer — and answers like fetch: the head, then the body', async () => {
    const f = frame();
    f.event('fansly.relay.fetch', fetchOf(1, { method: 'POST', url: `${RELAY_TARGET}message?ngsw-bypass=true`, body: '{"type":1}' }));
    expect(f.fetched).toHaveLength(1);
    expect(f.fetched[0]?.url).toBe(`${FANSLY_RELAY_TARGET}message?ngsw-bypass=true`);
    expect(f.fetched[0]?.init).toMatchObject({ method: 'POST', body: '{"type":1}', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(f.fetched[0]?.init.headers).toEqual([['authorization', 'token'], ['x-cg-request-id', uuid(901)]]);
    await settle();
    expect(f.sent).toEqual([
      { type: 'fansly.relay.head', payload: { requestId: uuid(1), status: 200, headers: [['content-type', 'application/json'], ['retry-after', '5']] } },
      { type: 'fansly.relay.body', payload: { requestId: uuid(1), body: '{"success":true,"response":{}}' } },
    ]);
    // Its answers fit the contract it shares with the background.
    expect(FANSLY_TAB_EVENTS['fansly.relay.fetch'].payload.safeParse(fetchOf(1)).success).toBe(true);
    expect(RELAY_TARGET).toBe(FANSLY_RELAY_TARGET);
    expect(RELAY_BODY_MAX_CHARS).toBe(FANSLY_TAB_LIMITS.relayResponseBodyMaxChars);
  });

  it('[FS-NET-4] its own last check, before its fetch: another account is refused, another address too — provably no request', async () => {
    const f = frame();
    f.event('fansly.relay.fetch', fetchOf(2, { expect: { hostAccountId: OTHER, relayId: RELAY_ID } }));
    f.event('fansly.relay.fetch', fetchOf(3, { url: 'https://apiv3.fansly.com/api/v2/x' }));
    f.event('fansly.relay.fetch', fetchOf(4, { url: 'https://fansly.com/api/v1/account/me' }));
    await settle();
    expect(f.fetched).toEqual([]);
    expect(f.sent).toEqual([2, 3, 4].map((n) => ({ type: 'fansly.relay.failure', payload: { requestId: uuid(n), reason: 'refused' } })));
  });

  it('[FS-NET-4] another frame’s request it leaves alone — no fetch, no answer; a repeated request id is one request', async () => {
    const f = frame();
    f.event('fansly.relay.fetch', fetchOf(5, { expect: { hostAccountId: CREATOR, relayId: uuid(777) } }));
    f.event('fansly.relay.fetch', { ...fetchOf(6), url: 42 });
    expect([f.fetched, f.sent]).toEqual([[], []]);
    let release: (response: Response) => void = () => undefined;
    const g = frame({ reply: () => new Promise((resolve) => (release = resolve)) });
    g.event('fansly.relay.fetch', fetchOf(7));
    g.event('fansly.relay.fetch', fetchOf(7));
    expect(g.fetched).toHaveLength(1);
    release(new Response('{}', { status: 200 }));
    await settle();
  });

  it('[FS-NET-3] a 429 is told by its head even when its body never comes; no answer — `network`; an abort — `aborted`; a body too large — `too-large`', async () => {
    const broken = frame({
      reply: () =>
        Promise.resolve({
          status: 429,
          headers: new Headers({ 'retry-after': '30' }),
          text: () => Promise.reject(new TypeError('body lost')),
        } as unknown as Response),
    });
    broken.event('fansly.relay.fetch', fetchOf(8));
    await settle();
    expect(broken.sent).toEqual([
      { type: 'fansly.relay.head', payload: { requestId: uuid(8), status: 429, headers: [['retry-after', '30']] } },
      { type: 'fansly.relay.failure', payload: { requestId: uuid(8), reason: 'network' } },
    ]);
    const down = frame({ reply: () => Promise.reject(new TypeError('NetworkError')) });
    down.event('fansly.relay.fetch', fetchOf(9));
    await settle();
    expect(down.sent).toEqual([{ type: 'fansly.relay.failure', payload: { requestId: uuid(9), reason: 'network' } }]);
    const hanging = frame({ reply: (_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) });
    hanging.event('fansly.relay.fetch', fetchOf(10));
    expect(hanging.relay.inflight()).toBe(1);
    hanging.event('fansly.relay.abort', { requestId: uuid(10) });
    await settle();
    expect(hanging.sent).toEqual([{ type: 'fansly.relay.failure', payload: { requestId: uuid(10), reason: 'aborted' } }]);
    expect(hanging.relay.inflight()).toBe(0);
    const huge = frame({ reply: () => Promise.resolve(new Response('x'.repeat(RELAY_BODY_MAX_CHARS + 1), { status: 200 })) });
    huge.event('fansly.relay.fetch', fetchOf(11));
    await settle();
    expect(huge.sent.map((entry) => entry.type)).toEqual(['fansly.relay.head', 'fansly.relay.failure']);
    expect(huge.sent[1]?.payload).toEqual({ requestId: uuid(11), reason: 'too-large' });
  });

  it('[FS-NET-4] a test build serves Fansly’s address from its stand; a release frame from Fansly itself', () => {
    expect(serveFrom(null)(`${RELAY_TARGET}account/me?ngsw-bypass=true`)).toBe(`${FANSLY_RELAY_TARGET}account/me?ngsw-bypass=true`);
    expect(serveFrom('http://localhost:4100/api/v1/')(`${RELAY_TARGET}account/me?ngsw-bypass=true`)).toBe('http://localhost:4100/api/v1/account/me?ngsw-bypass=true');
    expect(serveFrom('http://localhost:4100/api/v1/')('http://localhost:4100/api/v1/account/me')).toBeNull();
  });

  it('reads its account from its address, and the background’s request by the contract’s shape', () => {
    expect(accountOfAddress(`#a=${CREATOR}`)).toBe(CREATOR);
    for (const hash of ['', '#', '#a=', '#a=abc', '#b=1', `#a=0${CREATOR}`]) expect(accountOfAddress(hash), hash).toBeNull();
    expect(readRelayFetch(fetchOf(12))).toEqual(fetchOf(12));
    for (const bad of [null, [], fetchOf(13, { requestId: 'r1' }), fetchOf(13, { method: 'DELETE' }), fetchOf(13, { headers: [['Authorization', 'x']] }), fetchOf(13, { expect: { hostAccountId: 'creator' } }), fetchOf(13, { expect: { hostAccountId: CREATOR, relayId: 'frame' } })]) {
      expect(readRelayFetch(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
