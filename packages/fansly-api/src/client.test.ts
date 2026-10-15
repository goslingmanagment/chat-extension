// The client (architecture.md §8.3; FS-NET-1, FS-NET-3, RB-023, ER-050,
// ER-051): admission before anything, the session's headers as they are at
// the request, the envelope, one attempt for a write and a click, the
// retries of a pass's read, the pacer told of every 429.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FANSLY_API_BASE } from './allowlist';
import type { FanslyCall, FanslyFetch, FanslyHttpResponse, FanslySessionTemplate } from './client';
import { FanslyApiError } from './errors';
import { createFanslyApi, type FanslyNetworkSession } from './index';
import type { RateLimitFactLike } from './pacer';

const T0 = Date.UTC(2026, 9, 15, 12, 0, 0);
const CREATOR = '300000000000000001';
const GROUP = '300000000000000777';

const TEMPLATE: FanslySessionTemplate = {
  legacyId: CREATOR,
  canonicalId: null,
  headers: { authorization: 'token-1', 'fansly-client-id': 'client-1', 'fansly-session-id': 'session-1', 'fansly-client-ts': '111', 'fansly-client-check': 'shared-sample' },
  checks: { group: 'check-group', message: 'check-message', account: 'check-account' },
  connected: true,
};

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
  readonly credentials: RequestCredentials | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly at: number;
}

type Reply = { status: number; body?: string; retryAfter?: string } | 'network' | 'hang';

function answer(reply: Exclude<Reply, 'network' | 'hang'>): FanslyHttpResponse {
  return {
    status: reply.status,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? (reply.retryAfter ?? null) : null) },
    text: () => Promise.resolve(reply.body ?? JSON.stringify({ success: true, response: { ok: 1 } })),
  };
}

function world() {
  let template: FanslySessionTemplate | null = { ...TEMPLATE };
  const facts: RateLimitFactLike[] = [];
  const replies: Reply[] = [];
  const sent: Sent[] = [];
  const disconnected: string[] = [];
  const session: FanslyNetworkSession = {
    ready: Promise.resolve(),
    idle: () => Promise.resolve(),
    forAccount: (id) => (template !== null && (template.legacyId === id || template.canonicalId === id) ? template : null),
    disconnect: (id) => {
      disconnected.push(id);
      if (template !== null) template = { ...template, connected: false };
      return Promise.resolve();
    },
    rateLimits: () => facts,
  };
  const data = new Map<string, unknown>();
  const storage = {
    get: (keys: readonly string[]) => Promise.resolve({ ok: true as const, value: Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)])) }),
    set: (items: Readonly<Record<string, unknown>>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
      return Promise.resolve({ ok: true as const });
    },
  };
  const fetch: FanslyFetch = (url, init) => {
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? init.body : undefined,
      credentials: init.credentials,
      redirect: init.redirect,
      at: Date.now(),
    });
    const reply = replies.shift() ?? { status: 200 };
    if (reply === 'network') return Promise.reject(new TypeError('NetworkError'));
    if (reply === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    }
    return Promise.resolve(answer(reply));
  };
  const api = createFanslyApi({ session, storage, fetch, random: () => 0 });
  return {
    api,
    facts,
    replies,
    sent,
    disconnected,
    setTemplate(next: FanslySessionTemplate | null) {
      template = next;
    },
  };
}

const registration: FanslyCall = { purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group: GROUP } };
const passRead: FanslyCall = { purpose: 'newcomers', route: 'message.history', account: CREATOR, query: { groupId: GROUP, limit: '25' } };
const greeting = (signal?: AbortSignal): FanslyCall => ({ purpose: 'greeting', route: 'message.send', account: CREATOR, body: { type: 1, content: 'hi', groupId: GROUP }, ...(signal === undefined ? {} : { signal }) });

/** Runs a promise to its end while the fake clock moves. */
async function settle<T>(work: Promise<T>, stepMs = 50, maxMs = 900_000): Promise<T> {
  let end: { value: T } | { error: unknown } | null = null;
  work.then(
    (value) => (end = { value }),
    (error: unknown) => (end = { error }),
  );
  for (let spent = 0; end === null && spent <= maxMs; spent += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
  const done = end as { value: T } | { error: unknown } | null;
  if (done === null) throw new Error('did not settle');
  if ('error' in done) throw done.error;
  return done.value;
}

const failure = async (work: Promise<unknown>): Promise<FanslyApiError> => {
  const error = await settle(work).then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof FanslyApiError)) throw new Error(`expected a FanslyApiError, got ${String(error)}`);
  return error;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a request of ours', () => {
  it('[FS-NET-1] carries the session as it is now: a fresh timestamp, the route family\'s accepted check (never the shared sample), no cookie, ngsw-bypass', async () => {
    const { api, sent } = world();
    vi.setSystemTime(T0 + 1234);
    expect(await settle(api.client.call(registration))).toEqual({ response: { ok: 1 }, status: 200 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      url: `${FANSLY_API_BASE}group/${GROUP}/?ngsw-bypass=true`,
      method: 'GET',
      headers: { authorization: 'token-1', 'fansly-client-id': 'client-1', 'fansly-session-id': 'session-1', 'fansly-client-ts': String(T0 + 1234), 'fansly-client-check': 'check-group' },
      body: undefined,
      credentials: 'omit',
      redirect: 'error',
      at: T0 + 1234,
    });
    // A route whose family has no accepted check yet sends none.
    await settle(api.client.call({ purpose: 'spenders', route: 'messaging.groups', account: CREATOR, query: { search: 'fan' } }));
    expect(sent[1]?.headers['fansly-client-check']).toBeUndefined();
    // A write: JSON, its family's check.
    await settle(api.client.call(greeting()));
    expect(sent[2]).toMatchObject({ method: 'POST', url: `${FANSLY_API_BASE}message?ngsw-bypass=true`, body: JSON.stringify({ type: 1, content: 'hi', groupId: GROUP }) });
    expect(sent[2]?.headers).toMatchObject({ 'content-type': 'application/json', 'fansly-client-check': 'check-message' });
  });

  it('[FS-NET-1] [RB-022] nothing outside the list leaves: no ack, no other purpose, no body on a read, no id that is not one', async () => {
    const { api, sent } = world();
    const refused = [
      { purpose: 'newcomers', route: 'message.ack', account: CREATOR },
      { purpose: 'greeting', route: 'group.detail', account: CREATOR, path: { group: GROUP } },
      { ...registration, body: {} },
      { ...greeting(), body: undefined },
      { ...registration, path: { group: 'me' } },
    ] as unknown as FanslyCall[];
    for (const call of refused) expect(await failure(api.client.call(call))).toMatchObject({ kind: 'not-admitted', code: 'CG-FAN-REQUEST', sent: false });
    expect(sent).toEqual([]);
  });

  it('[FS-NET-3] [ER-050] without a confirmed session nothing is asked; a 401 or 403 marks it disconnected and is not asked again', async () => {
    const made = world();
    made.setTemplate(null);
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'session', code: 'CG-FAN-SESSION', sent: false });
    made.setTemplate({ ...TEMPLATE, connected: false });
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'session' });
    expect(made.sent).toEqual([]);
    made.setTemplate({ ...TEMPLATE });
    made.replies.push({ status: 401 });
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'expired', code: 'CG-FAN-EXPIRED', httpStatus: 401, sent: true });
    expect(made.sent).toHaveLength(1);
    expect(made.disconnected).toEqual([CREATOR]);
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'session' });
  });

  it('[ER-051] [RB-023] `success: false` with HTTP 200 is an error and is not asked again, even by a pass', async () => {
    const made = world();
    made.replies.push({ status: 200, body: JSON.stringify({ success: false, error: { code: 7 } }) });
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'refused', code: 'CG-FAN-REQUEST', httpStatus: 200, fanslyCode: '7', sent: true });
    expect(made.sent).toHaveLength(1);
    // It earns the lane nothing (E133): no penalty either.
    expect(made.api.pacer.view({ legacyId: CREATOR, canonicalId: null }).level).toBe(0);
  });
});

describe('repeats and parallelism (RB-023)', () => {
  it('[RB-023] a read of a pass is asked again after 1, 2 and 4 s on a 5xx — four attempts at most; a click\'s read and a write once', async () => {
    const made = world();
    made.replies.push({ status: 502 }, { status: 503 }, { status: 500 }, { status: 200 });
    expect(await settle(made.api.client.call(passRead))).toMatchObject({ status: 200 });
    const gaps = made.sent.slice(1).map((entry, index) => entry.at - (made.sent[index]?.at ?? 0));
    expect(gaps).toEqual([1000, 2000, 4000]);

    const five = world();
    five.replies.push({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 200 });
    expect(await failure(five.api.client.call(passRead))).toMatchObject({ kind: 'http', httpStatus: 500 });
    expect(five.sent).toHaveLength(4);

    const once = world();
    once.replies.push({ status: 502 }, { status: 502 });
    expect(await failure(once.api.client.call(registration))).toMatchObject({ kind: 'http', httpStatus: 502, sent: true });
    expect(await failure(once.api.client.call(greeting()))).toMatchObject({ kind: 'http', httpStatus: 502 });
    expect(once.sent).toHaveLength(2);
  });

  it('[RB-023] no answer is not asked again: a network failure, a request that hangs past 30 s; a write\'s lost answer stays the caller\'s to read', async () => {
    const made = world();
    made.replies.push('network');
    expect(await failure(made.api.client.call(passRead))).toMatchObject({ kind: 'network', sent: true });
    made.replies.push('hang');
    const hung = failure(made.api.client.call(passRead));
    expect(await hung).toMatchObject({ kind: 'timeout', code: 'CG-FAN-REQUEST', sent: true });
    expect(Date.now() - T0).toBeGreaterThanOrEqual(30_000);
    made.replies.push('network');
    expect(await failure(made.api.client.call(greeting()))).toMatchObject({ kind: 'network', sent: true });
    expect(made.sent).toHaveLength(3);
  });

  it('[RB-023] [NF-037] a 429 cools the creator down: a pass\'s read waits the cooldown out and is asked again; a click\'s read is refused without a request', async () => {
    const made = world();
    made.replies.push({ status: 429, retryAfter: '45' });
    expect(await settle(made.api.client.call(passRead))).toMatchObject({ status: 200 });
    expect(made.sent).toHaveLength(2);
    // Retry-After 45 s against the first rung of the ladder (30 s): the longer wins.
    expect((made.sent[1]?.at ?? 0) - (made.sent[0]?.at ?? 0)).toBeGreaterThanOrEqual(45_000);

    const click = world();
    click.replies.push({ status: 429 });
    const at = Date.now();
    const limited = await failure(click.api.client.call(registration));
    expect(limited).toMatchObject({ kind: 'rate-limited', code: 'CG-FAN-RATE-LIMIT', httpStatus: 429, sent: true, retryAt: at + 30_000 });
    const refused = await failure(click.api.client.call(registration));
    expect(refused).toMatchObject({ kind: 'cooling', code: 'CG-FAN-RATE-LIMIT', sent: false, retryAt: at + 30_000 });
    expect(await failure(click.api.client.call(greeting()))).toMatchObject({ kind: 'cooling', sent: false });
    expect(await failure(click.api.client.call({ purpose: 'spenders', route: 'group.create', account: CREATOR, body: { users: [] } }))).toMatchObject({ kind: 'cooling', sent: false });
    expect(click.sent).toHaveLength(1);
  });

  it('[RB-023] [FS-NET-3] a foreign 429 (a fact of the core) closes our next call of that creator before any request', async () => {
    const made = world();
    made.facts.push({ requestId: 'neighbour-1', at: T0, accountId: CREATOR, source: 'page' });
    expect(await failure(made.api.client.call(registration))).toMatchObject({ kind: 'cooling', retryAt: T0 + 30_000, sent: false });
    expect(made.sent).toEqual([]);
  });

  it('[RB-023] reads of one creator go one at a time, 400 ms apart at least; a write never waits behind them', async () => {
    const made = world();
    const reads = [0, 1, 2].map((index) => made.api.client.call({ ...passRead, query: { groupId: GROUP, before: String(index + 1) } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(made.sent).toHaveLength(1);
    // A greeting while a read is in flight and two wait: it goes at once.
    const write = made.api.client.call(greeting());
    await settle(Promise.all([...reads, write]));
    const readsAt = made.sent.filter((entry) => entry.method === 'GET').map((entry) => entry.at);
    expect(readsAt).toEqual([T0, T0 + 500, T0 + 1000]);
    expect(made.sent.find((entry) => entry.method === 'POST')?.at).toBe(T0);
  });
});

describe('a write the hub\'s custody guards (§8.6)', () => {
  it('[FS-NET-3] prepare does what may wait or refuse; start is synchronous up to fetch and reads the session at that moment', async () => {
    const made = world();
    const prepared = await settle(made.api.client.prepare(greeting()));
    expect(made.sent).toEqual([]);
    made.setTemplate({ ...TEMPLATE, headers: { ...TEMPLATE.headers, authorization: 'token-2' } });
    const started = prepared.start();
    // fetch ran inside start(), before any await.
    expect(made.sent).toHaveLength(1);
    expect(made.sent[0]?.headers['authorization']).toBe('token-2');
    await settle(started);
    await expect(prepared.start()).rejects.toMatchObject({ kind: 'aborted', sent: false });

    // The caller gave up between the custody and the request: refused, nothing sent.
    const controller = new AbortController();
    const dropped = await settle(made.api.client.prepare(greeting(controller.signal)));
    controller.abort();
    await expect(dropped.start()).rejects.toMatchObject({ kind: 'aborted', sent: false });
    expect(made.sent).toHaveLength(1);

    // The session went away between the custody and the request: refused, nothing sent.
    const gone = await settle(made.api.client.prepare(greeting()));
    made.setTemplate(null);
    await expect(gone.start()).rejects.toMatchObject({ kind: 'session', sent: false });
    expect(made.sent).toHaveLength(1);
  });

  it('[FS-NET-3] a cooldown refuses the write in prepare — before the custody — and a caller that gave up is told so without a request', async () => {
    const made = world();
    made.facts.push({ requestId: 'page-1', at: T0, accountId: CREATOR, source: 'page' });
    expect(await failure(made.api.client.prepare(greeting()))).toMatchObject({ kind: 'cooling', sent: false });
    const controller = new AbortController();
    controller.abort();
    expect(await failure(made.api.client.prepare(greeting(controller.signal)))).toMatchObject({ kind: 'aborted', sent: false });
    expect(made.sent).toEqual([]);
  });
});
