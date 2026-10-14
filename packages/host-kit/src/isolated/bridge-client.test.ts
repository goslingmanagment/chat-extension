// The bridge client over a registry that is no site's: a made-up host with
// one read, one state event and one fact, checked by hand-written stages. What
// the client takes from its host — the types of the registry, its schema
// module and the list of events that are never coalesced — is all it knows of
// it. The shared boot (main/bridge.ts) stands on the other side of the port.
// happy-dom does not set MessageEvent.source or transfer ports, so the window
// is a shim over Node's MessageChannel. A real registry on the same transport,
// with its zod schemas and a page script pretending to be MAIN:
// host-chatspace/src/isolated/bridge.test.ts.

import type { MainProbe } from '@cg/contracts/bridge';
import { afterEach, describe, expect, it } from 'vitest';

import { installMainBridge, type MainContext } from '../main/bridge';
import { BridgeCallError, connectMainBridge, type BridgeEvent, type MainBridgeClient } from './bridge-client';
import type { BridgeValidation } from './validation';

interface ToyBridge {
  readonly requests: {
    readonly probe: { readonly payload: Record<string, never>; readonly data: MainProbe };
    readonly read: { readonly payload: { readonly key: string }; readonly data: { readonly value: string } | null };
  };
  readonly events: {
    readonly state: { readonly n: number };
    readonly fact: { readonly id: number };
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The three stages by hand: the envelope with a known type, then the answer or the payload of that type. */
const toy: BridgeValidation<ToyBridge> = {
  checkFrame(raw) {
    if (!isRecord(raw) || typeof raw['documentEpoch'] !== 'string') return { kind: 'reject', reason: 'envelope' };
    const { kind, t, documentEpoch } = raw;
    if (kind === 'evt') return t === 'state' || t === 'fact' ? { kind, t, documentEpoch, payload: raw['payload'] } : { kind: 'reject', reason: 'unknown-type' };
    if (kind !== 'res' || typeof raw['id'] !== 'number' || (t !== 'probe' && t !== 'read')) return { kind: 'reject', reason: 'envelope' };
    return raw['ok'] === true ? { kind, id: raw['id'], t, documentEpoch, ok: true, data: raw['data'] } : { kind, id: raw['id'], t, documentEpoch, ok: false, err: raw['err'] as 'not-ready' };
  },
  parseAnswer(t, data) {
    const passes = t === 'probe' ? isRecord(data) && data['v'] === 1 : data === null || (isRecord(data) && typeof data['value'] === 'string');
    return passes ? { ok: true, data: data as never } : { ok: false };
  },
  parseEvent(t, payload) {
    return isRecord(payload) && typeof payload[t === 'state' ? 'n' : 'id'] === 'number' ? (payload as never) : null;
  },
};

type Listener = (event: { source: unknown; data: unknown; ports: readonly MessagePort[] }) => void;

function fakeWindow(): Window {
  const listeners = new Set<Listener>();
  const win = {
    location: { origin: 'http://127.0.0.1:4100' },
    document: { readyState: 'loading' },
    performance,
    crypto,
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    postMessage(data: unknown, _origin: string, transfer: MessagePort[] = []) {
      const event = { source: win, data: structuredClone(data), ports: transfer };
      setTimeout(() => {
        for (const listener of [...listeners]) listener(event);
      }, 0);
    },
  };
  return win as unknown as Window;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The shared boot with a scripted runtime and the client of the toy host; `undroppable` — what that host never lets coalesce. */
async function connected(undroppable: readonly string[], handle: (t: string, payload: unknown) => unknown = () => null) {
  const win = fakeWindow();
  let context: MainContext | null = null;
  const main = installMainBridge(win, { runtime: (ctx) => ((context = ctx), { handle, dispose: () => undefined }) });
  const client: MainBridgeClient<ToyBridge> = await connectMainBridge<ToyBridge>(win, () => Promise.resolve(toy), undroppable, 1000);
  cleanups.push(() => client.close(), () => main.dispose());
  // MAIN holds the port once the probe comes back.
  await client.probe();
  const seen: Array<BridgeEvent<ToyBridge>> = [];
  client.onEvent((event) => seen.push(event));
  return { client, seen, context: () => context as unknown as MainContext };
}

describe('[EX-008] the bridge client is its host’s: the registry, the schemas and the events that never coalesce are handed in', () => {
  it('connects to the shared boot, which answers `probe` itself; the host’s own request goes to its runtime and its answer through the host’s schema', async () => {
    // A runtime answers with data; a string of its own is a transport refusal (main/bridge.ts).
    const { client } = await connected([], (t, payload) => (t !== 'read' ? 'unknown-request' : (payload as { key: string }).key === 'k1' ? { value: 'of k1' } : null));
    expect(await client.probe()).toEqual({ v: 1, readyStateAtStart: 'loading', installMs: expect.any(Number) as unknown, wsTap: false });
    const answer: { readonly value: string } | null = await client.request('read', { key: 'k1' });
    expect(answer).toEqual({ value: 'of k1' });
    // A `null` the host's schema allows is an answer, not a broken one.
    expect(await client.request('read', { key: 'k2' })).toBeNull();
  });

  it('an answer the host’s schema refuses fails the call as `invalid-answer`; a frame of a type the host does not know is dropped and counted', async () => {
    const { client, seen, context } = await connected([], () => 42);
    const error = (await client.request('read', { key: 'k1' }).catch((e: unknown) => e)) as BridgeCallError;
    expect(error).toBeInstanceOf(BridgeCallError);
    expect([error.failure, error.t, error.executed]).toEqual(['invalid-answer', 'read', 'maybe']);
    context().post('gossip', {});
    context().post('fact', { id: 'not a number' });
    await pause(30);
    expect(seen).toEqual([]);
    expect(client.stats()).toMatchObject({ invalidAnswers: 1, invalidEvents: 1, rejected: { 'unknown-type': 1 } });
  });

  it('events the host names undroppable arrive one by one, in order; its other events fold into the latest of their type', async () => {
    const { client, seen, context } = await connected(['fact']);
    const ctx = context();
    // `post` leaves MAIN at once, unthrottled: whatever folds, folds on this side.
    for (let i = 1; i <= 5; i += 1) {
      ctx.post('fact', { id: i });
      ctx.post('state', { n: i });
    }
    await pause(80);
    expect(seen.filter((event) => event.t === 'fact').map((event) => event.payload)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    const states = seen.filter((event) => event.t === 'state').map((event) => (event.payload as { n: number }).n);
    expect([states[0], states.at(-1), states.length <= 2]).toEqual([1, 5, true]);
    expect(client.stats().coalesced).toBe(5 - states.length);
  });

  it('the list is the host’s alone: a host that names every event of its wire loses none, one that names none may fold any', async () => {
    const all = await connected(['state', 'fact']);
    for (let i = 1; i <= 4; i += 1) all.context().post('state', { n: i });
    await pause(60);
    expect(all.seen.map((event) => event.payload)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
    expect(all.client.stats().coalesced).toBe(0);

    const none = await connected([]);
    for (let i = 1; i <= 4; i += 1) none.context().post('fact', { id: i });
    await pause(60);
    const ids = none.seen.map((event) => (event.payload as { id: number }).id);
    expect([ids[0], ids.at(-1), ids.length <= 2]).toEqual([1, 4, true]);
  });
});
