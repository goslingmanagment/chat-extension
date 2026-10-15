// The tap of the page's socket (docs/project-unite/architecture.md §5.2;
// FS-WS-1, FS-WS-4, SN-017): what the old extension did
// (fansly-chat/src/content/page-socket-tap.ts), with its limits made explicit.
// - `window.WebSocket` becomes a Proxy with one trap, `construct`, which
//   returns `Reflect.construct(target, args, newTarget)`: the page's own
//   native instance. The statics, `prototype`, `name`, `length`,
//   `instanceof` and a call without `new` are the native's. What stays
//   visible: `Function.prototype.toString` of a Proxy prints no name, and
//   `WebSocket.prototype.constructor` is the native, not the Proxy (§5.2;
//   Fansly's page makes no such check, S2 Q10; Function.prototype is not
//   touched).
// - Fansly takes the global at every construction (main:37815), so every
//   socket of the page passes the trap. One is ours to watch when the host of
//   its address — parsed, never matched as a string — is the page's socket
//   host (`wss://wsv3.fansly.com?v=3`).
// - On that instance go our own `message`, `close` and `error` listeners,
//   through the addEventListener captured at install — before zone.js patches
//   it, so a frame costs the page no extra change detection — and before the
//   page sets its `on*` handlers, so ours run first and a
//   stopImmediatePropagation of the page cannot hide a frame (S6 Q5). No
//   `open` listener: nothing of ours waits for it.
// - We never send, close, reconnect or change a frame. The constructor is
//   never inside a guard: what `new WebSocket` throws reaches the page as it
//   would without us; our work after it is caught and counted.
// - The tap never turns off (FS-WS-4, SN-018): the old one went silent when
//   both sounds were off; the observation and the echo of a send need every
//   frame, so the sound's switches never reach here.

import type { Guard } from '@cg/host-kit/main/guard';

/** What the tap tells the runtime. */
export interface SocketSink {
  /** The page made a socket of its socket host: the newest from now on. */
  created(): void;
  /** One text frame of a socket we watch; `current` — of the newest one. Binary frames go to a handler of the page that does nothing. */
  frame(text: string, current: boolean): void;
  /** The newest socket closed or failed. */
  lost(): void;
}

export interface TapNatives {
  readonly construct: typeof Reflect.construct;
  /** EventTarget.prototype.addEventListener, captured at install. */
  readonly listenOn: (target: EventTarget, type: string, listener: (event: Event) => void) => void;
  readonly guard: Guard;
  readonly fault: (site: string) => void;
}

export interface Tap {
  /** Someone replaced the global over our Proxy (a signal for the contract, `fx.contract.tap`). */
  wrapped(): boolean;
  /** Puts the native back, if the global is still ours (a test's cleanup; the extension never takes a tap off). */
  restore(): void;
}

/** Puts the Proxy over `win.WebSocket`; `hosts` — the socket host names to watch (FS-WS-1). */
export function installWsTap(win: Window & typeof globalThis, natives: TapNatives, hosts: readonly string[], sink: SocketSink): Tap {
  const { construct, listenOn, guard, fault } = natives;
  const Native = win.WebSocket;
  const ParseUrl = win.URL;
  const base = win.location.href;
  let current: WebSocket | null = null;

  const onFrame = guard('wsFrame', (event: Event) => {
    const data: unknown = (event as MessageEvent).data;
    if (typeof data === 'string') sink.frame(data, event.target === current);
  });
  const onLost = guard('wsLost', (event: Event) => {
    if (event.target === current) sink.lost();
  });

  const tap = new Proxy(Native, {
    construct(target, args, newTarget) {
      const socket = construct(target, args, newTarget) as WebSocket;
      try {
        if (hosts.includes(new ParseUrl(String(args[0]), base).hostname)) {
          current = socket;
          listenOn(socket, 'message', onFrame);
          listenOn(socket, 'close', onLost);
          listenOn(socket, 'error', onLost);
          sink.created();
        }
      } catch {
        // The page has its socket regardless; ours goes unwatched and the count says so.
        fault('wsNew');
      }
      return socket;
    },
  });
  win.WebSocket = tap;
  return {
    wrapped: () => win.WebSocket !== tap,
    restore: () => {
      if (win.WebSocket === tap) win.WebSocket = Native;
    },
  };
}
