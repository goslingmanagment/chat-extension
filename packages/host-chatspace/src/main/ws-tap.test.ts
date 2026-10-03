import { describe, expect, it } from 'vitest';

import { installWsTap } from './ws-tap';

class FakeWebSocket {
  static readonly OPEN = 1;
  constructor(readonly url: string) {}
}

function fakeWindow(): Window & typeof globalThis {
  return { WebSocket: FakeWebSocket } as unknown as Window & typeof globalThis;
}

describe('WS tap (§6.8)', () => {
  it('wraps only the constructor: instances, statics and prototype stay native', () => {
    const win = fakeWindow();
    const tap = installWsTap(win);
    expect(tap).not.toBeNull();
    const socket = new win.WebSocket('wss://example.test/');
    expect(socket).toBeInstanceOf(FakeWebSocket);
    expect(socket).toBeInstanceOf(win.WebSocket);
    expect(Object.getPrototypeOf(socket)).toBe(FakeWebSocket.prototype);
    expect(win.WebSocket.OPEN).toBe(1);
    expect(tap?.socketCount()).toBe(1);
  });

  it('installs once and hands itself over through a non-enumerable symbol', () => {
    const win = fakeWindow();
    const tap = installWsTap(win);
    expect(installWsTap(win)).toBeNull();
    expect(Reflect.get(win, Symbol.for('chatgoose.wsTap'))).toBe(tap);
    expect(Object.keys(win)).not.toContain('chatgoose.wsTap');
  });

  it('restores the global on dispose only while it is still ours', () => {
    const win = fakeWindow();
    installWsTap(win)?.dispose();
    expect(win.WebSocket).toBe(FakeWebSocket);

    const second = installWsTap(win);
    const laterWrapper = new Proxy(win.WebSocket, {});
    win.WebSocket = laterWrapper;
    second?.dispose();
    expect(win.WebSocket).toBe(laterWrapper);
  });
});
