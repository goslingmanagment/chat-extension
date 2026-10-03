// Passive WebSocket tap (architecture.md §6.8), registered by the background
// through scripting.registerContentScripts({world: 'MAIN'}) only while the
// `wsTap` flag is on. R00 installs the constructor Proxy and the hand-off
// global; R09 adds the frame listener on the ChatSpace socket and counters.
//
// Rules kept from §6.8: wrap only the constructor (`new Proxy` + Reflect.construct),
// instances/static/prototype stay native; never send, never change frames;
// on cleanup restore the global only if it is still ours.

import { WS_TAP_KEY } from './protocol';

export interface WsTapHandle {
  readonly version: 1;
  /** Sockets constructed through the tap since install. */
  socketCount(): number;
  dispose(): void;
}

export function installWsTap(win: Window & typeof globalThis = window): WsTapHandle | null {
  const key = Symbol.for(WS_TAP_KEY);
  if (Object.prototype.hasOwnProperty.call(win, key)) return null;

  const NativeWebSocket = win.WebSocket;
  let sockets = 0;

  const TappedWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args: ConstructorParameters<typeof WebSocket>, newTarget) {
      const socket = Reflect.construct(target, args, newTarget) as WebSocket;
      sockets += 1;
      return socket;
    },
  });

  const handle: WsTapHandle = Object.freeze({
    version: 1 as const,
    socketCount: () => sockets,
    dispose: () => {
      if (win.WebSocket === TappedWebSocket) win.WebSocket = NativeWebSocket;
      if (Reflect.get(win, key) === handle) Reflect.deleteProperty(win, key);
    },
  });

  win.WebSocket = TappedWebSocket;
  Object.defineProperty(win, key, { value: handle, enumerable: false, configurable: true, writable: false });
  return handle;
}
