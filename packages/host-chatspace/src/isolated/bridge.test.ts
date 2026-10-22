// ChatSpace's bridge as a whole against a minimal window: the shared MAIN boot
// and isolated client (@cg/host-kit) over ChatSpace's registry — its schemas
// (validate.ts) and its events that are never coalesced (wire.ts), as start.ts
// hands them to the client. happy-dom does not set MessageEvent.source or
// transfer ports, so this test shims window messaging over Node's
// MessageChannel; the real-browser path is covered by the e2e (spike M0 and
// the R09 harness on the stand).

import { BRIDGE_LIMITS } from '@cg/contracts/limits';
import { afterEach, describe, expect, it } from 'vitest';

import { connectMainBridge } from '@cg/host-kit/isolated/bridge-client';
import { installMainBridge, type MainContext, type MainRuntime } from '@cg/host-kit/main/bridge';
import { type BridgeCallError, type ChatSpaceBridge, type MainBridgeClient } from './bridge-client';
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

describe('[EX-008] the boot routes requests to the runtime', () => {
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
    /** Until `count` answers came back (a cold MessageChannel under a loaded CI may take longer than a fixed pause). */
    const settle = async (count: number): Promise<void> => {
      for (let i = 0; i < 100 && answers.length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    };
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
    await raw.settle(2);
    expect(runs).toBe(1);
    expect(raw.answers.map((answer) => [answer['id'], answer['ok'], answer['data']])).toEqual([
      [7, true, { state: 'rejected', code: 'CG-INSERT-FAILED' }],
      [7, true, { state: 'rejected', code: 'CG-INSERT-FAILED' }],
    ]);
    raw.send({ id: 8, t: 'listAccounts' });
    raw.send({ id: 8, t: 'listAccounts' });
    await raw.settle(4);
    expect(runs).toBe(3);
  });

  it('[EX-008] a repeated request id of an attach drops the file once: the second gets the first answer', async () => {
    let drops = 0;
    const raw = await rawPort((t) => (t === 'attachFile' ? ((drops += 1), { state: 'attached', ms: 3 }) : null));
    const file = { name: '00000000-0000-4000-8000-000000000031.mp3', type: 'audio/mpeg', bytes: new ArrayBuffer(8) };
    raw.send({ id: 9, t: 'attachFile', payload: { intentId: '00000000-0000-4000-8000-000000000030', expected: {}, file } });
    raw.send({ id: 9, t: 'attachFile', payload: { intentId: '00000000-0000-4000-8000-000000000030', expected: {}, file } });
    await raw.settle(2);
    expect(drops).toBe(1);
    expect(raw.answers.map((answer) => [answer['id'], answer['data']])).toEqual([
      [9, { state: 'attached', ms: 3 }],
      [9, { state: 'attached', ms: 3 }],
    ]);
  });

  it('[EX-008] a request carrying another document’s epoch is refused before it runs (stale-document)', async () => {
    let runs = 0;
    const raw = await rawPort(() => ((runs += 1), []));
    raw.send({ id: 1, t: 'listAccounts', documentEpoch: 'not-this-document' });
    raw.send({ id: 2, t: 'listAccounts', documentEpoch: raw.main.documentEpoch });
    await raw.settle(2);
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

  it('a request that gets no answer times out (2 s by default) and is never retried', async () => {
    const { client } = await connected(() => new Promise(() => undefined));
    const error = (await client.request('listAccounts', {}, 30).catch((e: unknown) => e)) as BridgeCallError;
    expect(error.failure).toBe('timeout');
    expect(error.executed).toBe('maybe');
    expect(client.stats().timeouts).toBe(1);
    expect(BRIDGE_LIMITS.callTimeoutMs).toBe(2000);
  });
});
