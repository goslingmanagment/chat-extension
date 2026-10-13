// P3a spike: a prototype of the whole Fansly MAIN (architecture §5). Not production code: it exists to measure the
// gzip size, the install time, the per-frame and per-response cost and the memory accounting, and to run the
// gesture predicate (А7) on geckodriver. Natives are captured once at document_start (§5.1): only what we call
// ourselves; never XMLHttpRequest.prototype.open/send/setRequestHeader, never Map.prototype.

export interface Natives {
  readonly construct: typeof Reflect.construct;
  readonly listen: (target: EventTarget, type: string, fn: EventListener, capture?: boolean) => void;
  readonly parse: (text: string) => unknown;
  readonly micro: (fn: () => void) => void;
  readonly idle: (fn: (deadline: IdleDeadline) => void) => void;
  readonly closest: (el: Element, selector: string) => Element | null;
  readonly now: () => number;
  readonly hasOwn: (o: object, k: PropertyKey) => boolean;
}

export function captureNatives(win: Window & typeof globalThis): Natives {
  const add = win.EventTarget.prototype.addEventListener;
  const closest = win.Element.prototype.closest;
  const parse = win.JSON.parse;
  const queue = win.queueMicrotask.bind(win);
  const ric = typeof win.requestIdleCallback === 'function' ? win.requestIdleCallback.bind(win) : null;
  const later = win.setTimeout.bind(win);
  const perf = win.performance;
  const now = perf.now.bind(perf);
  const own = Object.prototype.hasOwnProperty;
  return {
    construct: Reflect.construct,
    listen: (target, type, fn, capture = false) => add.call(target, type, fn, { capture, passive: true }),
    parse: (text) => parse(text) as unknown,
    micro: queue,
    idle: (fn) => {
      if (ric) ric(fn, { timeout: 2000 });
      else later(() => fn({ didTimeout: true, timeRemaining: () => 5 } as IdleDeadline), 0);
    },
    closest: (el, selector) => closest.call(el, selector),
    now,
    hasOwn: (o, k) => own.call(o, k),
  };
}

/** Snowflake order: by length, then by string (§5.5). */
export const cmpId = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** FNV-1a 32 ×2 over UTF-16 code units: a cheap digest for `contentDigest` (the real one is host-kit's). */
export function digest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
