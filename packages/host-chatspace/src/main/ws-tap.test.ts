// The WS tap alone (architecture.md §6.8, §6.7.5): a ChatSpace-like socket
// class, frames the test sends, and a sink in place of the live port.

import { FreshnessCheckpointSchema } from '@cg/contracts/send';
import { FROM_MAIN } from '@cg/contracts/bridge-messages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSocket, frames } from '../testing/fake-live';
import { type Checkpoint, type Fact, type Tap } from './live';
import { createTap } from './ws-tap';

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
  /** Failures the tap's guard handed to the bridge, by site. */
  readonly faults: string[];
  /** 2026-10-28: the fans whose OnlyMonster notes the socket said changed. */
  readonly notes: Array<[string, string]>;
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
    faults: [],
    notes: [],
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
    fault: (site) => h.faults.push(site),
    notes: (acc, fan) => h.notes.push([acc, fan]),
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
    // A fan's message goes out once; an outgoing one as it came (a redelivery is not told apart, and moves no counter).
    expect(h.facts.map((fact) => [fact.fan, fact.msgId, fact.fromFan, fact.fanSequence])).toEqual([
      [FAN, '5001', true, 1],
      [FAN, '5002', true, 2],
      ['2004', '5003', true, 1],
      [FAN, '5004', false, 2],
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

  it('a numeric id too large to be exact is no id: two fan messages never read as one', () => {
    const h = begin();
    const socket = h.armed();
    const before = h.checkpoint();
    // As the server would write them: two different ids, the same number once parsed.
    const raw = (id: string): string => JSON.stringify(frames.message(ACC, FAN, '1', true)).replace('"id":"1"', `"id":${id}`);
    socket.receive(raw('12345678901234567890'));
    socket.receive(raw('12345678901234567891'));
    // Neither was counted as «the same message again»: the account's coverage is unknown, a send is held.
    expect(h.facts).toEqual([]);
    expect(h.coverage.at(-1)).toEqual([ACC, 'unknown', 'schema']);
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
    // The same ids as strings are two messages.
    socket.receive(frames.message(ACC, FAN, '12345678901234567890', true));
    socket.receive(frames.message(ACC, FAN, '12345678901234567891', true));
    expect(h.checkpoint().fanSequence).toBe(2);
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

  it('a foreign socket on ChatSpace’s path can only hold a send: the real one’s fan message is never «nothing new»', () => {
    const h = begin();
    const real = h.armed();
    const before = h.checkpoint();
    // Code of the page opens its own socket whose URL ends the same way, and feeds it what arms an account.
    const forged = h.connect('wss://evil.example.test/api/chat-space/ws');
    forged.receive(frames.authenticated);
    forged.receive(frames.summary(ACC));
    // The fan writes on ChatSpace's real socket, where the tap no longer listens.
    real.receive(frames.message(ACC, FAN, '5001', true));
    expect(h.checkpoint()).toMatchObject({ coverage: 'unknown', fanSequence: 0 });
    expect(h.tap.fresh(before)).toBe('CG-SEND-FRESHNESS');
    // ChatSpace reconnects (it closes its socket first): while the foreign one stays open, nothing is armed.
    real.close();
    const next = h.connect();
    next.receive(frames.authenticated);
    next.receive(frames.summary(ACC));
    expect(h.checkpoint().coverage).toBe('unknown');
    forged.close();
    expect(h.checkpoint().coverage).toBe('ok');
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

describe('2026-10-28: a fan’s OnlyMonster notes changed', () => {
  const notesFrame = (acc: unknown, fan: unknown, type = 'user-notes') => ({ event: 'account_data_updated', type, id: fan, account: { account_id: acc, platform: 'onlyfans' } });

  it('said on for a fan of an account of this port, as ChatSpace’s socket names them; nothing else, no message counted', () => {
    const h = begin();
    const socket = h.armed();
    socket.receive(notesFrame(Number(ACC), Number(FAN)));
    socket.receive(notesFrame(ACC, FAN, 'fan-info'));
    // Another platform's account on the same socket, a frame without its fan: not ours to tell.
    socket.receive(notesFrame(OTHER_ACC, FAN));
    socket.receive(notesFrame(ACC, undefined));
    expect(h.notes).toEqual([[ACC, FAN]]);
    expect(h.facts).toEqual([]);
    expect(h.checkpoint().fanSequence).toBe(0);
  });
});
