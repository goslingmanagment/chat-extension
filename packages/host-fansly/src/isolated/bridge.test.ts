// Fansly's bridge as a whole against a minimal window: Fansly's MAIN world (the
// shared boot of host-kit with Fansly's runtime, R20 P7a) and the shared isolated client over
// Fansly's registry — its schemas (validate.ts) and the frames it never
// coalesces (wire.ts), as the starter hands them to the client. happy-dom does
// not set MessageEvent.source or transfer ports, so this test shims window
// messaging over Node's MessageChannel; the real browser is the e2e on the
// Fansly stand (suite-fansly-site.e2e.ts).

import { FANSLY_BRIDGE_LIMITS, FANSLY_WIRE_EVENT_TYPES } from '@cg/contracts/bridge-fansly';
import { BridgeCallError, connectMainBridge, type MainBridgeClient } from '@cg/host-kit/isolated/bridge-client';
import { afterEach, describe, expect, it } from 'vitest';

import { installFanslyMain } from '../main/index';
import type { FanslyBridge } from './bridge-client';
import { checkFrame, parseAnswer, parseEvent } from './validate';
import { loadValidation } from './validation';
import { UNDROPPABLE_EVENTS } from './wire';

type Listener = (event: { source: unknown; data: unknown; ports: readonly MessagePort[] }) => void;

function fakeWindow(): Window {
  const listeners = new Set<Listener>();
  const win = {
    location: { origin: 'http://localhost:4200', href: 'http://localhost:4200/messages' },
    document: { readyState: 'loading' },
    performance,
    crypto,
    URL,
    EventTarget,
    // The page's constructors MAIN stands its Proxies over (their own tests: main/runtime.test.ts).
    WebSocket: class WebSocket extends EventTarget {},
    XMLHttpRequest: class XMLHttpRequest extends EventTarget {},
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

const EPOCH = 'a1b2c3d4e5f6a1b2c3d4e5f6';

describe('Fansly’s bridge: its MAIN world and the shared client over its registry (R20 P7a0)', () => {
  it('connects to Fansly’s MAIN, whose boot answers `probe` itself through Fansly’s own schemas; its runtime answers `fx.state`, the observation’s requests wait for P7b', async () => {
    const win = fakeWindow();
    const main = installFanslyMain(win, { socketHosts: ['localhost'], apiOrigins: ['http://localhost'] });
    const client: MainBridgeClient<FanslyBridge> = await connectMainBridge<FanslyBridge>(win, loadValidation, UNDROPPABLE_EVENTS, 1000);
    cleanups.push(() => client.close(), () => main.dispose());
    expect(await client.probe()).toEqual({ v: 1, readyStateAtStart: 'loading', installMs: expect.any(Number) as unknown, wsTap: false });
    expect(main.isConnected()).toBe(true);
    // On a busy machine a unit test only catches a tenfold regression; the budget itself is measured in e2e.
    expect(main.installMs).toBeLessThan(10);
    expect(client.documentEpoch).toBe(main.documentEpoch);
    expect(await client.request('fx.state', {})).toEqual({
      identity: { creatorId: null, accountMeSeen: false, legacy: false, fbuddy: { windowBridge: false, networkHook: false, styleFixes: false, wordFilter: false } },
      socket: { epoch: 0, confirmed: false },
      chat: null,
      contract: { anchors: { accountMe: 'notYet', socket: 'notYet', frames: 'notYet', xhr: 'notYet' }, tap: 'ok' },
      lastBatch: 0,
    });
    const refused = (await client.request('fx.windowMeta', { groupId: '700000000000000010' }).catch((error: unknown) => error)) as BridgeCallError;
    expect(refused).toBeInstanceOf(BridgeCallError);
    expect([refused.failure, refused.executed]).toEqual(['not-ready', 'no']);
  });

  it('never coalesces a frame of Fansly’s port: the list is the wire’s, as the contracts name it', () => {
    expect([...UNDROPPABLE_EVENTS].sort()).toEqual([...FANSLY_WIRE_EVENT_TYPES].sort());
  });

  it('checks a frame against the byte limit of its own type, its envelope and the schema of its type', () => {
    const gap = { v: 1, kind: 'evt', t: 'fx.gap', documentEpoch: EPOCH, seq: 3, payload: { reason: 'overflow' } };
    expect(checkFrame(gap)).toEqual({ kind: 'evt', t: 'fx.gap', documentEpoch: EPOCH, payload: { reason: 'overflow' } });
    expect(parseEvent('fx.gap', { reason: 'overflow' })).toEqual({ reason: 'overflow' });
    expect(parseEvent('fx.gap', { reason: 'tired' })).toBeNull();
    // A batch over its own 64 KiB is too large, though under the bridge's 256 KiB.
    const big = { v: 1, kind: 'evt', t: 'fx.batch', documentEpoch: EPOCH, seq: 4, payload: { n: 1, events: [], pad: Array.from({ length: 5 }, () => 'x'.repeat(FANSLY_BRIDGE_LIMITS.maxBatchBytes / 4)) } };
    expect(checkFrame(big)).toEqual({ kind: 'reject', reason: 'too-large' });
    // A ChatSpace event is no frame of Fansly's.
    expect(checkFrame({ v: 1, kind: 'evt', t: 'route', documentEpoch: EPOCH, seq: 5, payload: {} })).toEqual({ kind: 'reject', reason: 'unknown-type' });
    expect(checkFrame({ v: 1, kind: 'res', id: 1, t: 'snapshot', documentEpoch: EPOCH, seq: 6, ok: true, data: null })).toEqual({ kind: 'reject', reason: 'envelope' });
    expect(parseAnswer('probe', { v: 1, readyStateAtStart: 'loading', installMs: 0.1, wsTap: false })).toEqual({ ok: true, data: { v: 1, readyStateAtStart: 'loading', installMs: 0.1, wsTap: false } });
    expect(parseAnswer('fx.ack', null)).toEqual({ ok: true, data: null });
    expect(parseAnswer('fx.ack', {})).toEqual({ ok: false });
  });
});
