// The observer of the page's requests (docs/project-unite/architecture.md §5.4):
// Fansly's Angular client talks to its API by XHR, with `responseType = 'text'`
// (fansly-web.md §4) — a tap of `fetch` would miss it all.
// - `window.XMLHttpRequest` becomes a Proxy with one trap, `construct`,
//   returning the native instance (as the socket's, ws-tap.ts). `video.js`
//   takes the global when its script loads: it gets our Proxy, which is safe.
// - On the instance go our `loadstart` (the request's place in the order of
//   observations, its socket epoch — §5.6 — and, from P7f, the person's
//   gesture, §5.9) and `loadend` (the answer, read by the response table:
//   responses.ts). `loadend` comes after every `load` listener — Angular's and
//   FBuddy's — in the same task: the page has the answer already.
// - NEVER our own `open`, `send` or `setRequestHeader` on an instance, and no
//   call of the prototype's: FBuddy hooks those methods on the prototype after
//   us (S5 §2.3), and a call around its hooks would switch its word filter and
//   its journal off without a word. We read only the answer's getters.
// - The constructor is never inside a guard: what `new XMLHttpRequest` throws
//   reaches the page as it would without us.

import type { Tap, TapNatives } from './ws-tap';

/** What the observer tells the runtime: `start` stamps a request at `loadstart`; `end` gets the stamp back at `loadend`. */
export interface RequestSink<S> {
  start(): S;
  end(request: XMLHttpRequest, stamp: S | undefined): void;
}

export function installXhrTap<S>(win: Window & typeof globalThis, natives: TapNatives, sink: RequestSink<S>): Tap {
  const { construct, listenOn, guard, fault } = natives;
  const Native = win.XMLHttpRequest;
  const stamps = new WeakMap<XMLHttpRequest, S>();

  const onStart = guard('xhrStart', (event: Event) => {
    stamps.set(event.target as XMLHttpRequest, sink.start());
  });
  const onEnd = guard('xhrEnd', (event: Event) => {
    const request = event.target as XMLHttpRequest;
    const stamp = stamps.get(request);
    stamps.delete(request);
    sink.end(request, stamp);
  });

  const tap = new Proxy(Native, {
    construct(target, args, newTarget) {
      const request = construct(target, args, newTarget) as XMLHttpRequest;
      try {
        listenOn(request, 'loadstart', onStart);
        listenOn(request, 'loadend', onEnd);
      } catch {
        fault('xhrNew');
      }
      return request;
    },
  });
  win.XMLHttpRequest = tap;
  return {
    wrapped: () => win.XMLHttpRequest !== tap,
    restore: () => {
      if (win.XMLHttpRequest === tap) win.XMLHttpRequest = Native;
    },
  };
}
