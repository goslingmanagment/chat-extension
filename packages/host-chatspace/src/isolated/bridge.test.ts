// The handshake against a minimal window: happy-dom does not set
// MessageEvent.source or transfer ports, so the real-browser path is covered by
// the e2e (spike M0) and this test pins the protocol logic.

import { describe, expect, it } from 'vitest';

import { installMainBridge } from '../main/bridge';
import { connectMainBridge } from './bridge-client';

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

describe('MAIN ↔ isolated handshake (§5.3)', () => {
  it('connects when MAIN starts first and answers a schema-checked probe', async () => {
    const win = fakeWindow();
    const main = installMainBridge(win);
    const client = await connectMainBridge(win, 1000);
    expect(await client.probe()).toEqual({ v: 1, readyStateAtStart: 'loading', installMs: expect.any(Number) as unknown, wsTap: false });
    expect(main.isConnected()).toBe(true);
    client.close();
    main.dispose();
  });

  it('connects when the isolated side says hello before MAIN exists', async () => {
    const win = fakeWindow();
    const pending = connectMainBridge(win, 1000);
    const main = installMainBridge(win);
    const client = await pending;
    expect((await client.probe()).v).toBe(1);
    client.close();
    main.dispose();
  });

  it('MAIN accepts only the first connect and then stops listening on window', async () => {
    const win = fakeWindow();
    const main = installMainBridge(win);
    const client = await connectMainBridge(win, 1000);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Only the isolated client's own listener could remain; MAIN removed its one.
    expect(win.listeners.size).toBe(0);
    client.close();
    main.dispose();
  });

  it('rejects a forged probe answer', async () => {
    const win = fakeWindow();
    // A page script pretending to be MAIN: answers with an invalid shape.
    win.addEventListener('message', ((event: { data: { cg?: string }; ports: readonly MessagePort[] }) => {
      if (event.data.cg === 'iso-hello') win.postMessage({ cg: 'main-ready', v: 1 }, '*');
      const port = event.ports[0];
      if (event.data.cg === 'connect' && port) {
        port.onmessage = (message: MessageEvent<{ id: number }>) => port.postMessage({ v: 1, kind: 'res', id: message.data.id, ok: true, data: { v: 1, evil: true } });
      }
    }) as unknown as EventListener);
    const client = await connectMainBridge(win, 1000);
    await expect(client.probe()).rejects.toThrow('main-probe-invalid');
    client.close();
  });

  it('times out instead of hanging when there is no MAIN bridge', async () => {
    await expect(connectMainBridge(fakeWindow(), 50)).rejects.toThrow('main-bridge-timeout');
  });
});
