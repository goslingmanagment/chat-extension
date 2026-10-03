// The WS tap alone (architecture.md §6.8, §6.7.5): a ChatSpace-like socket
// class, frames the test sends, and a sink in place of the live port.

import { FreshnessCheckpointSchema } from '@cg/contracts/send';
import { FROM_MAIN } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket, frames } from '../testing/fake-live';
import { type Checkpoint, type Fact, type Tap } from './live';
import { createTap, installWsTap } from './ws-tap';

const ACC = '1001';
const OTHER_ACC = '1002';
const FAN = '2003';
const URL_OK = 'wss://chat.example.test/api/chat-space/ws';

type TapWindow = Window & typeof globalThis;

function fakeWindow(): TapWindow {
  return { WebSocket: FakeSocket, setInterval: (cb: () => void, ms: number) => setInterval(cb, ms), clearInterval: (id: number) => clearInterval(id) } as unknown as TapWindow;
}

interface Harness {
  readonly win: TapWindow;
  readonly tap: Tap;
  readonly facts: Fact[];
  readonly coverage: Array<[string, string, string]>;
  subscribed: Set<string> | null;
  changes: number;
  /** A new ChatSpace socket (a reconnect creates a new one). */
  connect(url?: string): FakeSocket;
  /** A socket that is authenticated and has seen a frame of ACC. */
  armed(): FakeSocket;
  checkpoint(fan?: string, acc?: string): Checkpoint;
}

function start(): Harness {
  FakeSocket.made = [];
  const win = fakeWindow();
  const tap = createTap(win);
  const h: Harness = {
    win,
    tap,
    facts: [],
    coverage: [],
    subscribed: new Set([ACC]),
    changes: 0,
    connect: (url = URL_OK) => new win.WebSocket(url) as unknown as FakeSocket,
    armed: () => {
      const socket = h.connect();
      socket.receive(frames.authenticated);
      socket.receive(frames.summary(ACC));
      return socket;
    },
    checkpoint: (fan = FAN, acc = ACC) => ({ ...tap.checkpoint(acc, fan), documentEpoch: 'doc1' }),
  };
  tap.connect({
    fact: (fact) => h.facts.push(fact),
    coverage: (acc, state, reason) => h.coverage.push([acc, state, reason]),
    changed: () => {
      h.changes += 1;
    },
    members: () => h.subscribed,
  });
  return h;
}

let current: Harness | null = null;
const begin = (): Harness => (current = start());

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-03T10:00:00.000Z') });
});
afterEach(() => {
  current?.tap.off();
  current = null;
  vi.useRealTimers();
});

describe('[X8-04] the WS tap wraps only the constructor (§6.8 п. 1–3, 11)', () => {
  it('instances, `instanceof`, statics and the prototype stay native; the page’s own handler still gets every frame', () => {
    const h = begin();
    expect(h.win.WebSocket).not.toBe(FakeSocket);
    const socket = h.connect();
    expect(socket).toBeInstanceOf(FakeSocket);
    expect(socket).toBeInstanceOf(h.win.WebSocket);
    expect(Object.getPrototypeOf(socket)).toBe(FakeSocket.prototype);
    expect(h.win.WebSocket.OPEN).toBe(1);
    expect(h.win.WebSocket.CONNECTING).toBe(0);
    expect(h.win.WebSocket.prototype).toBe(FakeSocket.prototype);
    expect(socket.url).toBe(URL_OK);
    const seen: string[] = [];
    socket.onmessage = (event) => seen.push(String(event.data));
    socket.receive(frames.authenticated);
    socket.receive(frames.message(ACC, FAN, '5001', true));
    expect(seen).toHaveLength(2);
    // Passive: nothing is ever sent on the page's socket.
    expect(socket.sent).toEqual([]);
  });

  it('listens only on ChatSpace’s own socket (its URL path); other sockets are not touched', () => {
    const h = begin();
    const foreign = h.connect('wss://elsewhere.example.test/live');
    const spy = vi.spyOn(foreign, 'addEventListener');
    foreign.receive(frames.authenticated);
    foreign.receive(frames.message(ACC, FAN, '5001', true));
    expect(spy).not.toHaveBeenCalled();
    expect(h.facts).toEqual([]);
    expect(h.checkpoint().socketEpoch).toBe(0);
    // The query string and a URL object do not hide the path.
    h.connect(`${URL_OK}?v=2`);
    new h.win.WebSocket(new URL(URL_OK));
    expect(h.checkpoint().socketEpoch).toBe(2);
  });

  it('installs once, hands itself over through a non-enumerable symbol, and restores the global only while it is still ours', () => {
    FakeSocket.made = [];
    const win = fakeWindow();
    const handle = installWsTap(win);
    expect(handle).not.toBeNull();
    expect(installWsTap(win)).toBeNull();
    expect(Reflect.get(win, Symbol.for('chatgoose.wsTap'))).toBe(handle);
    expect(Object.keys(win)).not.toContain('chatgoose.wsTap');
    expect(Object.getOwnPropertySymbols(win).map((key) => Object.getOwnPropertyDescriptor(win, key)?.enumerable)).toEqual([false]);
    new win.WebSocket(URL_OK);
    expect(handle?.socketCount()).toBe(1);
    handle?.dispose();
    expect(win.WebSocket).toBe(FakeSocket);
    expect(Reflect.get(win, Symbol.for('chatgoose.wsTap'))).toBeUndefined();

    // A later wrapper of someone else stays where it is.
    const second = installWsTap(win);
    const later = new Proxy(win.WebSocket, {});
    win.WebSocket = later;
    second?.dispose();
    expect(win.WebSocket).toBe(later);
  });

  it('a failure of ours never reaches the page: the frame still arrives, the socket still constructs', () => {
    const h = begin();
    h.tap.connect({
      fact: () => {
        throw new Error('sink failed');
      },
      coverage: () => {
        throw new Error('sink failed');
      },
      changed: () => undefined,
      members: () => h.subscribed,
    });
    const socket = h.connect();
    const seen: unknown[] = [];
    socket.onmessage = (event) => seen.push(event.data);
    expect(() => socket.receive(frames.authenticated)).not.toThrow();
    expect(() => socket.receive(frames.message(ACC, FAN, '5001', true))).not.toThrow();
    expect(() => socket.close()).not.toThrow();
    expect(() => h.connect()).not.toThrow();
    expect(seen).toHaveLength(2);
    h.tap.off();
    expect(h.win.WebSocket).toBe(FakeSocket);
  });
});

describe('[X8-04] [SN-001] counters and facts (§6.7.5, §6.8 п. 4–5)', () => {
  it('counts every fan message once per (account, fan) by id, and forwards facts without the text', () => {
    const h = begin();
    const socket = h.armed();
    socket.receive(frames.message(ACC, FAN, '5001', true));
    socket.receive(frames.message(ACC, FAN, '5001', true));
    socket.receive(frames.message(ACC, FAN, '5002', true, { platformMetadata: { isTip: true, isFromQueue: false } }));
    socket.receive(frames.message(ACC, '2004', '5003', true));
    socket.receive(frames.message(ACC, FAN, '5004', false, { platformMetadata: { isFromQueue: true } }));
    socket.receive(frames.message(ACC, FAN, '5004', false));

    expect(h.checkpoint()).toMatchObject({ fanSequence: 2, lastFanMessageId: '5002', knownFanMessageIds: ['5002', '5001'], coverage: 'ok' });
    expect(h.checkpoint('2004')).toMatchObject({ fanSequence: 1, lastFanMessageId: '5003' });
    expect(h.facts.map((fact) => [fact.fan, fact.msgId, fact.fromFan, fact.fanSequence])).toEqual([
      [FAN, '5001', true, 1],
      [FAN, '5002', true, 2],
      ['2004', '5003', true, 1],
      [FAN, '5004', false, 2],
    ]);
    expect(h.facts[1]).toMatchObject({ tip: true, automatic: false, sentAt: '2026-10-03T10:00:00.000Z', socketEpoch: 1 });
    expect(h.facts[3]).toMatchObject({ automatic: true });
    // What goes to the isolated side is the contract's fact: ids, direction, time — and no text.
    for (const fact of h.facts) {
      expect(FROM_MAIN.incoming.safeParse(fact).success).toBe(true);
      expect(JSON.stringify(fact)).not.toContain('text of');
    }
    expect(FreshnessCheckpointSchema.safeParse(h.checkpoint()).success).toBe(true);
  });

  it('keeps at most ten known fan ids, newest first; numeric ids of a frame become strings', () => {
    const h = begin();
    const socket = h.armed();
    for (let i = 1; i <= 12; i += 1) socket.receive(frames.message(ACC, FAN, String(6000 + i), true));
    const frame = frames.message(ACC, FAN, '0', true);
    socket.receive({ ...frame, message: { ...frame.message, id: 6013 } });
    const checkpoint = h.checkpoint();
    expect(checkpoint.fanSequence).toBe(13);
    expect(checkpoint.knownFanMessageIds).toHaveLength(10);
    expect(checkpoint.knownFanMessageIds[0]).toBe('6013');
    expect(checkpoint.lastFanMessageId).toBe('6013');
  });

  it('tells duplicates by the last 32 ids of a chat, and keeps the last 64 outgoing ids', () => {
    const h = begin();
    const socket = h.armed();
    for (let n = 0; n < 33; n += 1) socket.receive(frames.message(ACC, FAN, String(5000 + n), true));
    socket.receive(frames.message(ACC, FAN, '5032', true));
    expect(h.checkpoint().fanSequence).toBe(33);
    // The oldest id left the window: its redelivery cannot be told from a new message, and holds a send.
    socket.receive(frames.message(ACC, FAN, '5000', true));
    expect(h.checkpoint().fanSequence).toBe(34);

    for (let n = 0; n < 65; n += 1) socket.receive(frames.message(ACC, FAN, String(7000 + n), false));
    expect(h.tap.echoed(ACC, FAN, '7000')).toBe(false);
    expect(h.tap.echoed(ACC, FAN, '7001')).toBe(true);
    expect(h.tap.echoed(ACC, FAN, '7064')).toBe(true);
  });

  it('remembers outgoing ids for a receipt that comes after its echo, by account, fan and id', () => {
    const h = begin();
    const socket = h.armed();
    socket.receive(frames.message(ACC, FAN, '7001', false));
    expect(h.tap.echoed(ACC, FAN, '7001')).toBe(true);
    expect(h.tap.echoed(ACC, '2004', '7001')).toBe(false);
    expect(h.tap.echoed(OTHER_ACC, FAN, '7001')).toBe(false);
    // A fan's message with that id is not an echo.
    socket.receive(frames.message(ACC, FAN, '7002', true));
    expect(h.tap.echoed(ACC, FAN, '7002')).toBe(false);
  });
});

describe('[X8-04] an account is armed only with proof (§6.7.5 «Готовность», §6.8 п. 6–9, 12)', () => {
  it('needs `authenticated`, ChatSpace’s subscription and a frame of that account on this socket', () => {
    const h = begin();
    expect(h.checkpoint().coverage).toBe('unknown');
    const socket = h.connect();
    expect(h.tap.anchor()).toBe('missing');
    // A frame before `authenticated` proves nothing yet; a frame that only mentions the word is not it.
    socket.receive(frames.summary(ACC));
    socket.receive({ event: 'error', message: 'not authenticated' });
    expect(h.checkpoint().coverage).toBe('unknown');
    expect(h.tap.anchor()).toBe('missing');
    socket.receive(frames.authenticated);
    expect(h.tap.anchor()).toBe('ok');
    expect(h.checkpoint().coverage).toBe('ok');
    expect(h.coverage.at(-1)).toEqual([ACC, 'ok', 'authenticated']);

    // Subscribed by ChatSpace's set, but no frame of it on this socket: membership alone is not proof.
    h.subscribed = new Set([ACC, OTHER_ACC]);
    h.tap.sync();
    expect(h.checkpoint(FAN, OTHER_ACC).coverage).toBe('unknown');
    socket.receive(frames.message(OTHER_ACC, FAN, '5001', true));
    expect(h.checkpoint(FAN, OTHER_ACC).coverage).toBe('ok');

    // Frames of an account ChatSpace did not subscribe never arm it.
    socket.receive(frames.summary('1009'));
    expect(h.checkpoint(FAN, '1009').coverage).toBe('unknown');
  });

  it('frames that came before the runtime took the tap count at the first reading of ChatSpace’s set', () => {
    FakeSocket.made = [];
    const win = fakeWindow();
    const tap = createTap(win);
    const socket = new win.WebSocket(URL_OK) as unknown as FakeSocket;
    socket.receive(frames.authenticated);
    socket.receive(frames.summary(ACC));
    socket.receive(frames.summary(OTHER_ACC));
    const coverage: Array<[string, string, string]> = [];
    tap.connect({ fact: () => undefined, coverage: (acc, state, reason) => coverage.push([acc, state, reason]), changed: () => undefined, members: () => new Set([ACC]) });
    expect(coverage).toEqual([[ACC, 'ok', 'armed']]);
    expect(tap.checkpoint(ACC, FAN).coverage).toBe('ok');
    // Not in ChatSpace's set: its frame proved nothing.
    expect(tap.checkpoint(OTHER_ACC, FAN).coverage).toBe('unknown');
    tap.off();
  });

  it('a subscription set that cannot be observed arms nothing', () => {
    const h = begin();
    h.subscribed = null;
    h.tap.sync();
    h.armed();
    expect(h.checkpoint().coverage).toBe('unknown');
    expect(h.tap.fresh(h.checkpoint())).toBe('CG-SEND-FRESHNESS');
  });

  it('a new socket is a new epoch: coverage is unknown until it is armed again, and an old checkpoint cannot be compared', () => {
    const h = begin();
    const first = h.armed();
    const before = h.checkpoint();
    expect(h.tap.fresh(before)).toBeNull();

    first.close();
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'closed']);
    expect(h.tap.anchor()).toBe('missing');
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');

    const second = h.connect();
    second.receive(frames.authenticated);
    expect(h.checkpoint().coverage).toBe('unknown');
    second.receive(frames.summary(ACC));
    const after = h.checkpoint();
    expect(after).toMatchObject({ socketEpoch: 2, coverage: 'ok' });
    expect(h.tap.fresh(after)).toBeNull();
    // Nothing new was seen, but the gap between the sockets was not observed.
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
    // The old socket's late frames and its close are not the current one's.
    first.receive(frames.message(ACC, FAN, '5001', true));
    first.close();
    expect(h.checkpoint().fanSequence).toBe(0);
    expect(h.tap.fresh(after)).toBeNull();
  });

  it('a new socket while the old one never said it closed: nothing of the old socket arms the new one', () => {
    const h = begin();
    h.armed();
    const second = h.connect();
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'reconnect']);
    second.receive(frames.authenticated);
    // The account's frame came on the old socket: this one has proved nothing about it yet.
    expect(h.checkpoint().coverage).toBe('unknown');
    second.receive(frames.summary(ACC));
    expect(h.checkpoint().coverage).toBe('ok');
  });

  it('a socket that is closing has no coverage, even before its close event', () => {
    const h = begin();
    const socket = h.armed();
    const before = h.checkpoint();
    socket.readyState = FakeSocket.CLOSING;
    expect(h.checkpoint().coverage).toBe('unknown');
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
  });

  it('a lost or renewed subscription voids the checkpoints of that account only', () => {
    const h = begin();
    h.subscribed = new Set([ACC, OTHER_ACC]);
    const socket = h.armed();
    socket.receive(frames.summary(OTHER_ACC));
    const mine = h.checkpoint();
    const others = h.checkpoint(FAN, OTHER_ACC);

    h.subscribed = new Set([OTHER_ACC]);
    h.tap.sync();
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'subscription']);
    expect(h.tap.fresh(mine)).toBe('CG-SEND-FRESHNESS');
    expect(h.tap.fresh(others)).toBeNull();

    // Subscribed again: a frame may have been missed in between, and membership is set before the server confirms.
    h.subscribed = new Set([ACC, OTHER_ACC]);
    h.tap.sync();
    expect(h.checkpoint().coverage).toBe('unknown');
    socket.receive(frames.summary(ACC));
    expect(h.checkpoint().coverage).toBe('ok');
    expect(h.tap.fresh(mine)).toBe('CG-SEND-FRESHNESS');
  });

  it('a sleep gap voids every checkpoint; a frame after it arms the account again', () => {
    const h = begin();
    const socket = h.armed();
    const before = h.checkpoint();
    // Ordinary time: the 30 s tick is on time, nothing is lost.
    vi.advanceTimersByTime(95_000);
    expect(h.tap.fresh(before)).toBeNull();
    // The machine slept: the wall clock jumped, no tick ran meanwhile.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'sleep']);
    expect(h.checkpoint().coverage).toBe('unknown');
    socket.receive(frames.summary(ACC));
    const after = h.checkpoint();
    expect(after.coverage).toBe('ok');
    expect(h.tap.fresh(after)).toBeNull();
  });

  it('a late tick sees the gap too', () => {
    const h = begin();
    h.armed();
    const before = h.checkpoint();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    vi.advanceTimersByTime(30_000);
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'sleep']);
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
  });

  it('a message frame that cannot be read means «unknown», never «nothing new»', () => {
    const h = begin();
    const socket = h.armed();
    const before = h.checkpoint();
    const good = frames.message(ACC, FAN, '5001', true);
    // No direction: only that account loses its coverage.
    socket.receive({ ...good, message: { ...good.message, is_from_fan: undefined } });
    expect(h.tap.anchor()).toBe('shape');
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'schema']);
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
    // The next good frame clears the anchor and arms again; the old checkpoint stays void.
    socket.receive(good);
    expect(h.tap.anchor()).toBe('ok');
    const after = h.checkpoint();
    expect(after).toMatchObject({ coverage: 'ok', fanSequence: 1 });
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');

    // Not JSON, and no account to blame: everyone loses.
    socket.receive('account_new_message {broken');
    expect(h.tap.anchor()).toBe('shape');
    expect(h.tap.fresh(after)).toBe('CG-SEND-FRESHNESS');
    // Too long to parse.
    socket.receive(frames.message(ACC, FAN, '5002', true));
    const third = h.checkpoint();
    socket.receive(JSON.stringify({ ...frames.message(ACC, FAN, '5003', true), pad: 'x'.repeat(270_000) }));
    expect(h.tap.fresh(third)).toBe('CG-SEND-FRESHNESS');
  });

  it('too many chats: the counters start over and every checkpoint is void', () => {
    const h = begin();
    const socket = h.armed();
    socket.receive(frames.message(ACC, FAN, '5001', true));
    const before = h.checkpoint();
    for (let i = 0; i < 5000; i += 1) socket.receive(frames.message(ACC, String(900_000 + i), '5002', true));
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'overflow']);
    socket.receive(frames.summary(ACC));
    expect(h.checkpoint()).toMatchObject({ coverage: 'ok', fanSequence: 0 });
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
  });
});

describe('[X8-04] freshness: «the fan wrote something new» (§6.7.5)', () => {
  it('a fan message after the checkpoint is stale — text, media or empty; an echo or a duplicate is not', () => {
    const h = begin();
    const socket = h.armed();
    socket.receive(frames.message(ACC, FAN, '5001', true));
    const checkpoint = h.checkpoint();
    expect(h.tap.fresh(checkpoint)).toBeNull();
    socket.receive(frames.message(ACC, FAN, '5001', true));
    socket.receive(frames.message(ACC, FAN, '7001', false));
    socket.receive(frames.message(ACC, '2004', '5002', true));
    expect(h.tap.fresh(checkpoint)).toBeNull();
    socket.receive(frames.message(ACC, FAN, '5003', true, { content: '' }));
    expect(h.tap.fresh(checkpoint)).toBe('CG-SEND-STALE');
    // Asking again does not lift it.
    expect(h.tap.fresh(checkpoint)).toBe('CG-SEND-STALE');
  });

  it('a checkpoint taken without coverage, or of another socket or subscription epoch, proves nothing', () => {
    const h = begin();
    const cold = h.checkpoint();
    const socket = h.armed();
    expect(h.tap.fresh(cold)).toBe('CG-SEND-FRESHNESS');
    const good = h.checkpoint();
    expect(h.tap.fresh({ ...good, socketEpoch: good.socketEpoch + 1 })).toBe('CG-SEND-FRESHNESS');
    expect(h.tap.fresh({ ...good, subscriptionEpoch: good.subscriptionEpoch + 1 })).toBe('CG-SEND-FRESHNESS');
    expect(h.tap.fresh({ ...good, fanSequence: good.fanSequence + 1 })).toBe('CG-SEND-FRESHNESS');
    expect(h.tap.fresh({ ...good, hostAccountId: OTHER_ACC })).toBe('CG-SEND-FRESHNESS');

    // A checkpoint that is not this tap's state — an older count, or another last message — is never «nothing new».
    socket.receive(frames.message(ACC, FAN, '5001', true));
    const later = h.checkpoint();
    expect(h.tap.fresh(later)).toBeNull();
    expect(h.tap.fresh({ ...later, fanSequence: later.fanSequence - 1 })).toBe('CG-SEND-STALE');
    expect(h.tap.fresh({ ...later, lastFanMessageId: '4999', knownFanMessageIds: ['4999'] })).toBe('CG-SEND-STALE');
  });
});

describe('[NEW-08] «выключись» (§6.8 п. 10–11)', () => {
  it('stops listening, restores the constructor, and nothing is fresh any more', () => {
    const h = begin();
    const socket = h.armed();
    const checkpoint = h.checkpoint();
    const removed = vi.spyOn(socket, 'removeEventListener');
    h.tap.off();
    expect(h.tap.on()).toBe(false);
    expect(h.win.WebSocket).toBe(FakeSocket);
    expect(removed).toHaveBeenCalledTimes(2);
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'off']);
    expect(h.tap.anchor()).toBe('missing');
    socket.receive(frames.message(ACC, FAN, '5001', true));
    expect(h.facts).toEqual([]);
    expect(h.tap.fresh(checkpoint)).toBe('CG-SEND-FRESHNESS');
    // No timer of ours is left behind.
    expect(vi.getTimerCount()).toBe(0);
  });
});
