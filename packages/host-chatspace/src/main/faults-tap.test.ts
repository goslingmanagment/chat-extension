// Fault injection into the tap script (decision X22): the tap, the live port
// and the receipt observer run where ChatSpace calls them — its socket's
// listeners, the sleep tick, the WebSocket constructor, the queue's
// `after`/`onError` and `$subscribe`, its HTTP client's fetch — so a failure
// of ours (here: the runtime's LiveHost failing under them) must never reach
// ChatSpace: the frame still reaches the page, the socket is constructed, the
// send returns its entry, no promise of ours is left rejected. The failures
// go to the bridge's count (LiveHost.fault). And what ChatSpace's own
// functions throw or reject with passes through us as it is: the very same
// value, never counted as ours.
// The bridge's and the runtime's side is faults.dom.test.ts.

/* eslint-disable @typescript-eslint/unbound-method -- the tests compare the page's `fetch` by identity */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket, frames } from '../testing/fake-live';
import { ACC, OPEN_FAN, SOCKET_URL, startLive, uuid, type LiveHarness } from '../testing/live-harness';
import { createTap } from './ws-tap';

/** The test runner's process (Node): unhandled rejections are reported there; the package carries no Node types. */
const runner = (globalThis as unknown as { process: { on(event: 'unhandledRejection', listener: (reason: unknown) => void): void; off(event: 'unhandledRejection', listener: (reason: unknown) => void): void } }).process;

const fail = (): never => {
  throw new Error('ours');
};

let rejections: unknown[] = [];
const onRejection = (reason: unknown): void => void rejections.push(reason);
let h: LiveHarness | null = null;
const start = (): LiveHarness => (h = startLive());

beforeEach(() => {
  rejections = [];
  runner.on('unhandledRejection', onRejection);
});
afterEach(async () => {
  // The tap's own switch-off reports coverage through the host: a working one again (the switch-off is not ChatSpace's call).
  if (h) (h.live.host as { post: unknown }).post = () => undefined;
  h?.dispose();
  h = null;
  // A promise of ours left rejected would reach the page as `unhandledrejection`.
  await new Promise((resolve) => setTimeout(resolve, 5));
  runner.off('unhandledRejection', onRejection);
  expect(rejections).toEqual([]);
});

/** The open chat's draft is our unchanged insert: the person's Send is followed with the observer in place. */
const OURS = { digest: 'feedbeef00000061', draft: { revision: 5, provenance: 'our-insert' as const, insertIntentId: uuid(0x60), editedSinceInsert: false } };
/** The person presses ChatSpace's Send in the open chat. */
const composerSend = (live: LiveHarness) =>
  live.queue.send({ accountId: ACC, chatId: OPEN_FAN, platform: 'onlyfans', text: '<p>inserted</p>', hasAttachments: false, platformMetadata: {}, composerContent: { html: '<p>inserted</p>', media: null, gif: null, taggedCreators: [] } });

/** The runtime's LiveHost fails from now on wherever the tap script posts an event. */
const breakPost = (live: LiveHarness): void => {
  (live.live.host as { post: unknown }).post = fail;
};

describe('[X22] the tap’s listeners and the constructor: the page’s socket is never touched by our failure', () => {
  it('a frame: the page’s own listener still gets it', () => {
    const live = start();
    const seen: unknown[] = [];
    live.socket.onmessage = (event) => seen.push(event.data);
    breakPost(live);
    expect(() => live.socket.receive(frames.message(ACC, OPEN_FAN, '5001', true))).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(live.live.faults).toEqual(['message']);
  });

  it('a close and a new socket: the page gets its socket, an instance of its own class', () => {
    const win = { WebSocket: FakeSocket, setInterval: () => 0, clearInterval: () => undefined } as unknown as Window & typeof globalThis;
    const tap = createTap(win);
    const faults: string[] = [];
    let broken = false;
    const changed = (): void => {
      if (broken) fail();
    };
    tap.connect({ fact: () => undefined, coverage: () => undefined, changed, members: () => new Set([ACC]), fault: (site) => faults.push(site) });
    const socket = new win.WebSocket(SOCKET_URL) as unknown as FakeSocket;
    socket.receive(frames.authenticated);
    broken = true;
    expect(() => socket.close()).not.toThrow();
    let next: unknown = null;
    expect(() => (next = new win.WebSocket(SOCKET_URL))).not.toThrow();
    expect(next).toBeInstanceOf(FakeSocket);
    expect(faults).toEqual(['close', 'socket']);
    broken = false;
    tap.off();
  });

  it('the sleep tick', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-03T10:00:00.000Z') });
    try {
      const win = { WebSocket: FakeSocket, setInterval: (cb: () => void, ms: number) => setInterval(cb, ms), clearInterval: (id: number) => clearInterval(id) } as unknown as Window & typeof globalThis;
      const tap = createTap(win);
      const faults: string[] = [];
      tap.connect({ fact: () => undefined, coverage: fail, changed: () => undefined, members: () => new Set([ACC]), fault: (site) => faults.push(site) });
      const socket = new win.WebSocket(SOCKET_URL) as unknown as FakeSocket;
      // Arming reports coverage — through the failing sink, in the message listener.
      socket.receive(frames.authenticated);
      socket.receive(frames.summary(ACC));
      // A gap longer than the tick and its slack: the tick says «sleep» — and fails there.
      vi.setSystemTime(Date.now() + 60_000);
      expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
      expect(faults).toEqual(['message', 'tick']);
      tap.off();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('[X22] the receipt observer inside ChatSpace’s send: the send goes on', () => {
  it('the queue’s `after`: the send action returns its entry; the queue’s state change completes', async () => {
    const live = start();
    live.live.draft = OURS;
    // From inside the action on (its body runs after our listener): reading the queue fails in `after` and later.
    const entries = live.live.host.entries;
    let broken = false;
    (live.live.host as { entries: unknown }).entries = (acc: string) => (broken ? fail() : entries(acc));
    live.queue.during = () => {
      broken = true;
    };
    const entry = composerSend(live);
    expect(entry?.chatId).toBe(OPEN_FAN);
    expect(() => live.queue.store.$changed()).not.toThrow();
    await live.settle();
    expect(live.live.faults).toEqual(expect.arrayContaining(['after', 'decide']));
  });

  it('the read of the kept copies ends in a failure of ours: the promise is caught, the page’s own response is as it was', async () => {
    const live = start();
    const req = live.request(1);
    expect(live.commit(req).state).toBe('nativeEnqueued');
    await live.settle();
    // The read decides at its end — and fails there, asynchronously.
    breakPost(live);
    live.calls[0]?.respond(200, { id: '8001' });
    await live.settle();
    expect(live.live.faults).toEqual(expect.arrayContaining(['read']));
    // The native chain went on: the entry is gone from the queue.
    expect(live.queue.entries(ACC)).toEqual([]);
  });

  it('putting the page’s fetch back fails (a getter that throws): the send action still returns its entry', async () => {
    const live = start();
    live.live.draft = OURS;
    live.queue.during = () => {
      const observer = live.win.fetch;
      Object.defineProperty(live.win, 'fetch', {
        configurable: true,
        get: fail,
        set: () => undefined,
      });
      expect(typeof observer).toBe('function');
    };
    const entry = composerSend(live);
    expect(entry?.chatId).toBe(OPEN_FAN);
    await live.settle();
    // In `after` and in the microtask that makes sure it is back: both counted, at the same site.
    expect(live.live.faults.filter((site) => site === 'release')).toHaveLength(2);
  });
});

describe('[X22] what ChatSpace’s own functions throw passes through us as it is', () => {
  it('the previous fetch throws on the same stack: the caller gets the very same error; ours is counted apart', async () => {
    const live = start();
    live.live.draft = OURS;
    const theirs = new TypeError('their fetch');
    // What the observer puts itself in front of: a function of the page's that throws (a wrapper of someone else's).
    live.win.fetch = vi.fn(() => {
      throw theirs;
    });
    let caught: unknown = null;
    live.queue.during = () => {
      // Another call of ChatSpace's on the send's stack, with options our look at the call cannot read (counted as ours).
      const options = {
        get method(): string {
          throw new Error('unreadable');
        },
      };
      try {
        void live.win.fetch('https://api.example.test/other', options);
      } catch (error) {
        caught = error;
      }
    };
    composerSend(live);
    expect(caught).toBe(theirs);
    await live.settle();
    expect(live.live.faults).toContain('observe');
  });

  it('the previous fetch rejects: the observer returns its very own promise, and the rejection is ChatSpace’s', async () => {
    const live = start();
    const theirs = new TypeError('network');
    const promise = Promise.reject(theirs);
    promise.catch(() => undefined);
    live.win.fetch = vi.fn(() => promise);
    let returned: unknown = null;
    live.queue.during = () => {
      returned = live.win.fetch('https://api.example.test/other', {});
    };
    expect(live.commit(live.request(2)).state).toBe('nativeEnqueued');
    expect(returned).toBe(promise);
    await expect(returned as Promise<unknown>).rejects.toBe(theirs);
    await live.settle();
  });

  it('the WebSocket constructor throws: the page gets the very same error, and nothing is counted', () => {
    const theirs = new SyntaxError('bad url');
    class Strict extends FakeSocket {
      constructor(url: string | URL) {
        if (String(url) === 'not a url') throw theirs;
        super(url);
      }
    }
    const win = { WebSocket: Strict, setInterval: () => 0, clearInterval: () => undefined } as unknown as Window & typeof globalThis;
    const tap = createTap(win);
    const faults: string[] = [];
    tap.connect({ fact: () => undefined, coverage: () => undefined, changed: () => undefined, members: () => null, fault: (site) => faults.push(site) });
    let caught: unknown = null;
    try {
      new win.WebSocket('not a url');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(theirs);
    expect(faults).toEqual([]);
    tap.off();
  });
});
