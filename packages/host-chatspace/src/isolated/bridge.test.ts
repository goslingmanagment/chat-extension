// ChatSpace's bridge as a whole against a minimal window: the shared MAIN boot
// and isolated client (@cg/host-kit) over ChatSpace's registry — its schemas
// (validate.ts) and its events that are never coalesced (wire.ts), as start.ts
// hands them to the client. happy-dom does not set MessageEvent.source or
// transfer ports, so this test shims window messaging over Node's
// MessageChannel; the real-browser path is covered by the e2e (spike M0 and
// the R09 harness on the stand).

import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { connectMainBridge } from '@cg/host-kit/isolated/bridge-client';
import { attachMainRuntime, exposeMainRuntimeHook, installMainBridge, type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { BridgeCallError, type BridgeEvent, type ChatSpaceBridge, type MainBridgeClient } from './bridge-client';
import { loadValidation } from './validation';
import { UNDROPPABLE_EVENTS } from './wire';

type Listener = (event: { source: unknown; data: unknown; ports: readonly MessagePort[] }) => void;

function fakeWindow(): Window & { listeners: Set<Listener>; posted: unknown[] } {
  const listeners = new Set<Listener>();
  const posted: unknown[] = [];
  const win = {
    listeners,
    posted,
    location: { origin: 'http://127.0.0.1:4100' },
    document: { readyState: 'loading' },
    performance,
    crypto,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    postMessage(data: unknown, _origin: string, transfer: MessagePort[] = []) {
      posted.push(data);
      const event = { source: win, data: structuredClone(data), ports: transfer };
      setTimeout(() => {
        for (const listener of [...listeners]) listener(event);
      }, 0);
    },
  };
  return win as unknown as Window & { listeners: Set<Listener>; posted: unknown[] };
}

/** The client as start.ts connects it: ChatSpace's schemas and its undroppable events. */
const connect = (win: Window, timeoutMs: number): Promise<MainBridgeClient> => connectMainBridge<ChatSpaceBridge>(win, loadValidation, UNDROPPABLE_EVENTS, timeoutMs);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A boot with a scripted runtime; returns the client and what the runtime saw. */
async function connected(handle: (t: string, payload: unknown, context: MainContext) => unknown = () => null) {
  const win = fakeWindow();
  const calls: Array<{ t: string; payload: unknown }> = [];
  let context: MainContext | null = null;
  const runtime = (ctx: MainContext): MainRuntime => {
    context = ctx;
    return { handle: (t, payload) => (calls.push({ t, payload }), handle(t, payload, ctx)), dispose: () => undefined };
  };
  const main = installMainBridge(win, { runtime });
  const client = await connect(win, 1000);
  cleanups.push(() => client.close(), () => main.dispose());
  // MAIN holds the port once the probe comes back.
  await client.probe();
  return { win, main, client, calls, context: () => context as unknown as MainContext };
}

describe('[EX-008] MAIN ↔ isolated handshake (§5.3)', () => {
  it('[EX-007] connects when MAIN starts first and answers a schema-checked probe', async () => {
    const win = fakeWindow();
    const main = installMainBridge(win);
    const client = await connect(win, 1000);
    cleanups.push(() => client.close(), () => main.dispose());
    expect(await client.probe()).toEqual({ v: 1, readyStateAtStart: 'loading', installMs: expect.any(Number) as unknown, wsTap: false });
    expect(main.isConnected()).toBe(true);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(main.installMs).toBeLessThan(10);
    expect(client.documentEpoch).toBe(main.documentEpoch);
  });

  it('connects when the isolated side says hello before MAIN exists', async () => {
    const win = fakeWindow();
    const pending = connect(win, 1000);
    const main = installMainBridge(win);
    const client = await pending;
    cleanups.push(() => client.close(), () => main.dispose());
    expect((await client.probe()).v).toBe(1);
  });

  it('MAIN accepts only the first connect and then stops listening on window', async () => {
    const win = fakeWindow();
    const main = installMainBridge(win);
    const client = await connect(win, 1000);
    cleanups.push(() => client.close(), () => main.dispose());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(win.listeners.size).toBe(0);
  });

  it('times out instead of hanging when there is no MAIN bridge', async () => {
    await expect(connect(fakeWindow(), 50)).rejects.toThrow('main-bridge-timeout');
  });
});

describe('[EX-008] the boot routes requests to the runtime', () => {
  it('without a runtime everything but probe is not ready; a later MAIN script attaches it through the one-shot hook', async () => {
    const win = fakeWindow();
    const main = installMainBridge(win);
    exposeMainRuntimeHook(main, win);
    const client = await connect(win, 1000);
    cleanups.push(() => client.close(), () => main.dispose());
    const refused = await client.request('listAccounts', {}).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(BridgeCallError);
    expect((refused as BridgeCallError).failure).toBe('not-ready');
    expect((refused as BridgeCallError).executed).toBe('no');
    expect(attachMainRuntime(() => ({ handle: () => [], dispose: () => undefined }), win)).toBe(true);
    expect(attachMainRuntime(() => ({ handle: () => [], dispose: () => undefined }), win)).toBe(false);
    expect(main.attach(() => ({ handle: () => [], dispose: () => undefined }))).toBe(false);
    expect(await client.request('listAccounts', {})).toEqual([]);
  });

  it('the live requests go to the runtime like any other; its `disabled` (no tap script) is a refusal before execution', async () => {
    const { client, calls } = await connected(() => 'disabled');
    for (const t of ['checkpoint', 'previewSendPreflight', 'previewSendCommit'] as const) {
      const payload = t === 'checkpoint' ? { acc: '1001', fan: '2002' } : ({} as never);
      const error = (await client.request(t, payload).catch((e: unknown) => e)) as BridgeCallError;
      expect(error.failure).toBe('disabled');
      expect(error.executed).toBe('no');
    }
    expect(calls.map((call) => call.t)).toEqual(['checkpoint', 'previewSendPreflight', 'previewSendCommit']);
  });

  it('a write is executed once per request id; its answer is checked against the contract', async () => {
    let runs = 0;
    const { win, client } = await connected((t) => {
      if (t !== 'insertGuarded') return null;
      runs += 1;
      return { state: 'rejected', code: 'CG-INSERT-FAILED' };
    });
    void win;
    const intent = {
      intentId: '00000000-0000-4000-8000-000000000001',
      operationId: '00000000-0000-4000-8000-000000000002',
      part: { index: 0 },
      target: { host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' },
      expected: { kind: 'open', documentEpoch: 'doc', routeEpoch: 1, composerInstanceId: 'c1', draftRevision: 0, draftDigest: '0123456789abcdef' },
      mode: 'replace',
      text: 'hi',
      confirmationId: null,
      createdAt: 1,
      expiresAt: 2,
    } as const;
    expect(await client.request('insertGuarded', { intent })).toEqual({ state: 'rejected', code: 'CG-INSERT-FAILED' });
    expect(runs).toBe(1);
  });

  /** The isolated side by hand: our own port to MAIN, raw frames in and out. */
  async function rawPort(handle: (t: string, payload: unknown) => unknown) {
    const win = fakeWindow();
    const main = installMainBridge(win, { runtime: () => ({ handle, dispose: () => undefined }) });
    const channel = new MessageChannel();
    const answers: Array<Record<string, unknown>> = [];
    channel.port1.onmessage = (event: MessageEvent<Record<string, unknown>>) => answers.push(event.data);
    win.postMessage({ tag: 'connect', v: 1, nonce: 'n1' }, '*', [channel.port2]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    cleanups.push(() => channel.port1.close(), () => main.dispose());
    let seq = 0;
    const send = (frame: Record<string, unknown>): void => channel.port1.postMessage({ v: 1, kind: 'req', documentEpoch: null, seq: seq++, payload: {}, ...frame });
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
    return { main, send, answers, settle };
  }

  it('[EX-008] a repeated request id of a write runs once and gets the first answer again; a read runs every time', async () => {
    let runs = 0;
    const raw = await rawPort((t) => (t === 'insertGuarded' || t === 'listAccounts' ? ((runs += 1), t === 'listAccounts' ? [] : { state: 'rejected', code: 'CG-INSERT-FAILED' }) : null));
    const intent = {
      intentId: '00000000-0000-4000-8000-000000000001',
      operationId: '00000000-0000-4000-8000-000000000002',
      part: { index: 0 },
      target: { host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' },
      expected: { kind: 'open', documentEpoch: 'doc', routeEpoch: 1, composerInstanceId: 'c1', draftRevision: 0, draftDigest: '0123456789abcdef' },
      mode: 'replace',
      text: 'hi',
      confirmationId: null,
      createdAt: 1,
      expiresAt: 2,
    };
    raw.send({ id: 7, t: 'insertGuarded', payload: { intent } });
    raw.send({ id: 7, t: 'insertGuarded', payload: { intent } });
    await raw.settle();
    expect(runs).toBe(1);
    expect(raw.answers.map((answer) => [answer['id'], answer['ok'], answer['data']])).toEqual([
      [7, true, { state: 'rejected', code: 'CG-INSERT-FAILED' }],
      [7, true, { state: 'rejected', code: 'CG-INSERT-FAILED' }],
    ]);
    raw.send({ id: 8, t: 'listAccounts' });
    raw.send({ id: 8, t: 'listAccounts' });
    await raw.settle();
    expect(runs).toBe(3);
  });

  it('[EX-008] a request carrying another document’s epoch is refused before it runs (stale-document)', async () => {
    let runs = 0;
    const raw = await rawPort(() => ((runs += 1), []));
    raw.send({ id: 1, t: 'listAccounts', documentEpoch: 'not-this-document' });
    raw.send({ id: 2, t: 'listAccounts', documentEpoch: raw.main.documentEpoch });
    await raw.settle();
    expect(raw.answers.map((answer) => [answer['id'], answer['ok'], answer['err'] ?? null])).toEqual([
      [1, false, 'stale-document'],
      [2, true, null],
    ]);
    expect(runs).toBe(1);
  });

  it('an answer that breaks its schema fails the call as `invalid-answer` (a write may have run)', async () => {
    const { client } = await connected(() => ({ wrong: true }));
    const error = (await client.request('listAccounts', {}).catch((e: unknown) => e)) as BridgeCallError;
    expect(error.failure).toBe('invalid-answer');
    expect(error.executed).toBe('maybe');
    expect(client.stats().invalidAnswers).toBe(1);
  });

  it('a `null` its schema allows is an answer, not a broken one: «ChatSpace holds no such fan / chat yet» (fourth live check)', async () => {
    const { client } = await connected((t) => (t === 'fan' || t === 'chatWindow' ? null : t === 'listAccounts' ? null : undefined));
    expect(await client.request('fan', { acc: '1001', fan: '2002' })).toBeNull();
    expect(await client.request('chatWindow', { acc: '1001', fan: '2002', max: 10 })).toBeNull();
    // Where the schema allows no null, a null is still a broken answer.
    expect(((await client.request('listAccounts', {}).catch((e: unknown) => e)) as BridgeCallError).failure).toBe('invalid-answer');
    expect(client.stats().invalidAnswers).toBe(1);
  });

  it('a request that gets no answer times out (2 s by default) and is never retried', async () => {
    const { client } = await connected(() => new Promise(() => undefined));
    const error = (await client.request('listAccounts', {}, 30).catch((e: unknown) => e)) as BridgeCallError;
    expect(error.failure).toBe('timeout');
    expect(error.executed).toBe('maybe');
    expect(client.stats().timeouts).toBe(1);
    expect(BRIDGE_LIMITS.callTimeoutMs).toBe(2000);
  });

  it('closing the client fails what is pending and stops the events', async () => {
    const { client } = await connected(() => new Promise(() => undefined));
    const pending = client.request('listAccounts', {}).catch((e: unknown) => e);
    client.close();
    expect(((await pending) as BridgeCallError).failure).toBe('closed');
    expect(((await client.request('listAccounts', {}).catch((e: unknown) => e)) as BridgeCallError).failure).toBe('closed');
  });
});

describe('events MAIN → isolated (§5.3 limits)', () => {
  const events = (client: MainBridgeClient): BridgeEvent[] => {
    const seen: BridgeEvent[] = [];
    client.onEvent((event) => seen.push(event));
    return seen;
  };

  it('[EX-008] checked events arrive in order; UI events coalesce, the latest wins', async () => {
    const { client, context } = await connected();
    const seen = events(client);
    const ctx = context();
    ctx.emit('chatCache', () => ({ acc: '1001', fan: '2002' }));
    for (let i = 0; i < 5; i += 1) ctx.emit('chatCache', () => ({ acc: '1001', fan: String(2010 + i) }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const fans = seen.filter((event) => event.t === 'chatCache').map((event) => (event.payload as { fan: string }).fan);
    expect(fans[0]).toBe('2002');
    expect(fans.at(-1)).toBe('2014');
    expect(fans.length).toBeLessThanOrEqual(3);
  });

  it('[EX-008] an unchanged state is not repeated; a signal (chatCache, accounts) always goes out', async () => {
    const { client, context } = await connected();
    const seen = events(client);
    const ctx = context();
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    ctx.emit('composer', () => ({ state: null }));
    ctx.emit('chatCache', () => ({ acc: '1001', fan: '2002' }));
    ctx.emit('accounts', () => ({}));
    await pause(100);
    // The same chat's cache changed again and the accounts query refreshed: both must reach the isolated side.
    ctx.emit('composer', () => ({ state: null }));
    ctx.emit('chatCache', () => ({ acc: '1001', fan: '2002' }));
    ctx.emit('accounts', () => ({}));
    await pause(100);
    const count = (t: string): number => seen.filter((event) => event.t === t).length;
    expect([count('composer'), count('chatCache'), count('accounts')]).toEqual([1, 2, 2]);
  });

  it('[RB-008] an event of the right type but a broken payload is dropped and counted', async () => {
    const { client, context } = await connected();
    const seen = events(client);
    context().emit('chatCache', () => ({ acc: '1001', fan: 2002 }));
    context().emit('route', () => ({ route: { epoch: -1 }, hostLoginEpoch: null }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(seen).toEqual([]);
    expect(client.stats().invalidEvents).toBe(2);
  });
});

describe('a page script pretending to be MAIN (§14)', () => {
  /** Answers every request with `answer(request)`. */
  function forgeMain(win: ReturnType<typeof fakeWindow>, answer: (request: { id: number; t: string; seq: number }) => unknown): void {
    win.addEventListener('message', ((event: { data: { tag?: string }; ports: readonly MessagePort[] }) => {
      if (event.data.tag === 'iso-hello') win.postMessage({ tag: 'main-ready', v: 1 }, '*');
      const port = event.ports[0];
      if (event.data.tag === 'connect' && port) {
        port.onmessage = (message: MessageEvent<{ id: number; t: string; seq: number }>) => port.postMessage(answer(message.data));
      }
    }) as unknown as EventListener);
  }

  let seq = 0;
  const envelope = (request: { id: number; t: string }) => ({ v: 1, kind: 'res', id: request.id, t: request.t, documentEpoch: 'forged', seq: seq++ });

  it('rejects a forged probe answer with a valid envelope but invalid data', async () => {
    const win = fakeWindow();
    forgeMain(win, (request) => ({ ...envelope(request), ok: true, data: { v: 1, evil: true } }));
    const client = await connect(win, 1000);
    cleanups.push(() => client.close());
    await expect(client.probe()).rejects.toMatchObject({ failure: 'invalid-answer' });
  });

  it('drops answers that break the envelope, the frame limits or the request type, and counts them', async () => {
    const probe = { v: 1, readyStateAtStart: 'loading', installMs: 0, wsTap: false };
    const forgeries: Array<(request: { id: number; t: string; seq: number }) => unknown> = [
      // no documentEpoch / seq: the R00 shape
      (request) => ({ v: 1, kind: 'res', id: request.id, ok: true, data: probe }),
      // a prototype key
      (request) => JSON.parse(JSON.stringify({ ...envelope(request), ok: true, data: probe }).replace('"ok":true', '"ok":true,"__proto__":{}')) as unknown,
      // an answer of another request type
      (request) => ({ ...envelope(request), t: 'snapshot', ok: true, data: probe }),
      // a frame over the size limit
      (request) => ({ ...envelope(request), ok: true, data: { ...probe, pad: 'x'.repeat(20_001) } }),
    ];
    for (const forge of forgeries) {
      const win = fakeWindow();
      forgeMain(win, forge);
      const client = await connect(win, 100);
      await expect(client.request('probe', {}, 60)).rejects.toMatchObject({ failure: 'timeout' });
      const stats = client.stats();
      expect(Object.values(stats.rejected).reduce((sum, n) => sum + n, 0) + stats.late).toBeGreaterThan(0);
      client.close();
    }
  });

  it('[RB-008] an event of an unknown type or a broken envelope is dropped and counted by reason', async () => {
    const win = fakeWindow();
    let port: MessagePort | null = null;
    win.addEventListener('message', ((event: { data: { tag?: string }; ports: readonly MessagePort[] }) => {
      if (event.data.tag === 'iso-hello') win.postMessage({ tag: 'main-ready', v: 1 }, '*');
      if (event.data.tag === 'connect') port = event.ports[0] ?? null;
    }) as unknown as EventListener);
    const client = await connect(win, 100);
    cleanups.push(() => client.close());
    await new Promise((resolve) => setTimeout(resolve, 10));
    const send = (frame: unknown): void => (port as unknown as MessagePort).postMessage(frame);
    send({ v: 1, kind: 'evt', t: 'gossip', documentEpoch: 'doc', seq: 1, payload: {} });
    send({ v: 1, kind: 'evt', t: 'route', documentEpoch: 'doc', seq: 2 });
    send({ v: 1, kind: 'other', t: 'route', documentEpoch: 'doc', seq: 3, payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(client.stats().rejected).toEqual({ 'unknown-type': 1, envelope: 2 });
  });

  it('a frame of another document epoch is dropped, even with a newer sequence number', async () => {
    const win = fakeWindow();
    let n = 0;
    forgeMain(win, (request) => ({ v: 1, kind: 'res', id: request.id, t: request.t, documentEpoch: n === 0 ? 'one' : 'two', seq: 5 + n++, ok: true, data: [] }));
    const client = await connect(win, 100);
    cleanups.push(() => client.close());
    expect(await client.request('listAccounts', {})).toEqual([]);
    await expect(client.request('listAccounts', {}, 60)).rejects.toMatchObject({ failure: 'timeout' });
    expect(client.stats().stale).toBe(1);
    vi.useRealTimers();
  });

  it('a frame of this document with an old sequence number (a replay) is dropped', async () => {
    const win = fakeWindow();
    forgeMain(win, (request) => ({ v: 1, kind: 'res', id: request.id, t: request.t, documentEpoch: 'one', seq: 5, ok: true, data: [] }));
    const client = await connect(win, 100);
    cleanups.push(() => client.close());
    expect(await client.request('listAccounts', {})).toEqual([]);
    await expect(client.request('listAccounts', {}, 60)).rejects.toMatchObject({ failure: 'timeout' });
    expect(client.stats().stale).toBe(1);
  });
});
