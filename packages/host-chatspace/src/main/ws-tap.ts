// Passive WebSocket tap (architecture.md §6.8, §6.7.5), the script the
// background registers through scripting.registerContentScripts({world:
// 'MAIN', runAt: 'document_start'}) only while the `wsTap` flag is on.
//
// - Only the constructor is wrapped (`new Proxy` + Reflect.construct):
//   instances, `instanceof`, statics and the prototype stay native.
// - A `message` and a `close` listener go only onto ChatSpace's own socket
//   (its URL path), one socket at a time. We never send, connect, subscribe
//   or reconnect, never change a frame or stop its propagation; our failures
//   stay inside.
// - A cheap substring filter comes before JSON.parse: frames that name
//   `account_new_message` and the `authenticated` frame are parsed, any other
//   frame only says which account it is for. Counters of fan messages per
//   (account, fan), without duplicates by id, are updated before anything is
//   forwarded; the text of a message never leaves this file. An outgoing
//   message is forwarded as it comes (a redelivery is not told apart).
// - A message frame of an account that is not in the set the runtime gives
//   (the OnlyFans accounts ChatSpace subscribed; it subscribes other
//   platforms on the same socket) is not ours: not counted, not forwarded,
//   never «unreadable».
// - An account is «armed» (§6.8 п. 6) when the current socket saw
//   `authenticated`, the account is in ChatSpace's `subscribedAccountIds`
//   (which the tap watches) and a frame of that account came on this socket
//   since it was last subscribed. A new socket, a lost subscription, a sleep
//   gap, an overflow or a frame that names a message and cannot be read as
//   one void every checkpoint taken before: coverage is `unknown`, never
//   «nothing new». So does a second socket on that path while the previous
//   one is still open (ChatSpace closes its socket before it makes the next):
//   frames may then come where the tap no longer listens.
// - The time our handler takes is bounded by the frame length it parses
//   (MAX_FRAME) and measured (§6.8 п. 3, §11): frames seen, their total and
//   the longest one, read through the handle (`frameTime`).
// - Cleanup restores the global only if it is still ours (п. 11).
// - Our listeners, the sleep tick and the adoption of a socket are guarded
//   (guard.ts): a failure of ours goes to the bridge's count once the live
//   port is attached (before that it is only dropped). The constructor itself
//   is never inside a guard: whatever `new WebSocket` throws reaches the page
//   as it would without us.
//
// The same script carries the rest of §6.6–§6.8 — the send port, the receipt
// observer, the observation of human sends (live-port.ts): none of it means
// anything without the tap, and the document_start bundle has no room for it
// (§11). The bridge's runtime takes it through the handle (live.ts).

import { idOf, isPlain } from './check';
import { guardWith } from './guard';
import { createLivePort } from './live-port';
import { type Checkpoint, type LiveHost, type Tap, type TapSink, type WsTapHandle } from './live';
import { iso } from './page';
import { CG_SEND_FRESHNESS, CG_SEND_STALE, KNOWN_FAN_MESSAGES, WS_AUTHENTICATED, WS_NEW_MESSAGE, WS_PATH, WS_TAP_KEY } from './protocol';

export { type WsTapHandle } from './live';

/** Chats with counters. One more, and all counters start over: every checkpoint taken before is void (never «nothing new»). */
const MAX_CHATS = 5000;
/** Fan message ids kept per chat, newest first: duplicates are told by them. */
const MAX_IDS = 32;
/** A longer frame is not parsed; one that names a message voids the coverage. */
const MAX_FRAME = 262_144;
/** The sleep check: a tick this late means the observation had a gap. */
const TICK_MS = 30_000;
const GAP_MS = 20_000;
const SOCKET_OPEN = 1;
/** The account a frame is for, without parsing it. */
const ACCOUNT_OF = /"account_id"\s*:\s*"?(\d{1,30})/;

interface Account {
  /** Grows whenever checkpoints taken before can no longer be compared. */
  epoch: number;
  subscribed: boolean;
  /** A frame of this account came on this socket since the subscription. */
  framed: boolean;
  /** Coverage as last reported. */
  ok: boolean;
}

interface Chat {
  seq: number;
  ids: string[];
}

/** A socket that can still deliver frames: connecting or open (a closing one delivers none). */
const delivers = (socket: WebSocket): boolean => socket.readyState <= SOCKET_OPEN;

export function createTap(win: Window & typeof globalThis): Tap & { readonly constructed: () => number } {
  const Native = win.WebSocket;
  const clock = Date.now;
  const accounts = new Map<string, Account>();
  const chats = new Map<string, Chat>();
  let sink: TapSink | null = null;
  let on = true;
  let constructed = 0;
  let epoch = 0;
  let socket: WebSocket | null = null;
  /** Sockets that were replaced while they could still deliver frames. */
  let left: WebSocket[] = [];
  let authed = false;
  /** A frame that names a message could not be read since the last good one. */
  let bad = false;
  /** The subscription set was readable at the last sync. */
  let observable = false;
  let tickAt = clock();
  /** §11 `handlerMs`: frames our listener got, the time it spent on them in all and on the slowest one (ms). */
  let frames = 0;
  let spent = 0;
  let slowest = 0;
  // Counted by the bridge, once the live port is attached.
  const fail = (site: string): void => sink?.fault(site);
  const guard = guardWith(fail);

  const armed = (state: Account | undefined): boolean => on && authed && socket?.readyState === SOCKET_OPEN && !left.some(delivers) && !!state && state.subscribed && state.framed;
  const report = (acc: string, state: Account, reason: string): void => {
    const ok = armed(state);
    if (ok === state.ok) return;
    state.ok = ok;
    sink?.coverage(acc, ok ? 'ok' : 'unknown', reason);
  };
  const account = (acc: string): Account => {
    let state = accounts.get(acc);
    if (!state) accounts.set(acc, (state = { epoch: 1, subscribed: sink?.members()?.has(acc) === true, framed: false, ok: false }));
    return state;
  };
  /** Checkpoints of one account, or of all, can no longer be compared. */
  const lose = (reason: string, only?: string): void => {
    for (const [acc, state] of accounts) {
      if (only !== undefined && only !== acc) continue;
      state.epoch += 1;
      state.framed = false;
      report(acc, state, reason);
    }
  };
  const sync = (): void => {
    const members = sink?.members() ?? null;
    for (const [acc, state] of accounts) {
      const moved = (members?.has(acc) === true) !== state.subscribed;
      if (moved) state.subscribed = !state.subscribed;
      // The first readable set is the baseline: until it no account was armed, so no checkpoint could be compared.
      if (moved && observable) lose('subscription', acc);
      // What else arms an account may have changed without an event of ours (a replaced socket closed at last).
      else report(acc, state, 'sync');
    }
    observable = members !== null;
  };
  /** A sleep (or a stalled tab) between two ticks: frames may have been missed. */
  const tick = (): void => {
    const now = clock();
    if (now - tickAt > TICK_MS + GAP_MS) lose('sleep');
    tickAt = now;
  };
  const timer = win.setInterval(guard('tick', tick), TICK_MS);
  /** The `wsFrames` anchor follows the last frame that named a message. */
  const readable = (ok: boolean): void => {
    if (bad !== ok) return;
    bad = !ok;
    sink?.changed();
  };
  const unreadable = (acc?: string): void => {
    lose('schema', acc);
    readable(false);
  };
  /** A frame of this account on the current socket (one small record per account ChatSpace's own socket names). */
  const touch = (acc: string): void => {
    const state = account(acc);
    if (state.framed) return;
    state.framed = true;
    report(acc, state, 'armed');
  };

  /** A frame that names a message. */
  const message = (frame: unknown): void => {
    const root = isPlain(frame) ? frame : {};
    const acc = idOf(isPlain(root['account']) ? root['account']['account_id'] : null);
    // Not an account of this port (another platform's, or not subscribed): the frame is not ours, readable or not.
    if (acc && observable && !account(acc).subscribed) return;
    // Anything but a message frame as we know it — another envelope, an id or a direction we cannot read — may have
    // carried a fan's message: «unknown», never «nothing new» (§6.7.5).
    const body = root['event'] === WS_NEW_MESSAGE && isPlain(root['message']) ? root['message'] : {};
    const fan = idOf(body['chatId']);
    const id = idOf(body['id']);
    const fromFan = body['is_from_fan'];
    if (!acc || !fan || !id || typeof fromFan !== 'boolean') return unreadable(acc ?? undefined);
    readable(true);
    touch(acc);
    const key = `${acc}:${fan}`;
    let chat = chats.get(key);
    if (fromFan) {
      if (chat?.ids.includes(id)) return;
      if (!chat) {
        if (chats.size >= MAX_CHATS) {
          chats.clear();
          lose('overflow');
        }
        chats.set(key, (chat = { seq: 0, ids: [] }));
      }
      chat.seq += 1;
      if (chat.ids.unshift(id) > MAX_IDS) chat.ids.pop();
    }
    const meta = isPlain(body['platformMetadata']) ? body['platformMetadata'] : {};
    sink?.fact({ acc, fan, msgId: id, fromFan, automatic: meta['isFromQueue'] === true, tip: meta['isTip'] === true, sentAt: iso(body['sentAt']), socketEpoch: epoch, fanSequence: chat?.seq ?? 0 });
  };

  const parse = (data: string): unknown => {
    try {
      return data.length > MAX_FRAME ? undefined : JSON.parse(data);
    } catch {
      return undefined;
    }
  };
  const read = (data: unknown): void => {
    if (typeof data !== 'string') return;
    if (data.includes(WS_NEW_MESSAGE)) {
      const frame = parse(data);
      // Too long or not JSON although it names a message: nothing can be said about what it carried.
      if (frame === undefined) unreadable();
      else message(frame);
    } else if (!authed && data.includes(WS_AUTHENTICATED) && (parse(data) as { event?: unknown } | null | undefined)?.event === WS_AUTHENTICATED) {
      authed = true;
      for (const [acc, state] of accounts) report(acc, state, WS_AUTHENTICATED);
      sink?.changed();
    } else {
      const acc = ACCOUNT_OF.exec(data)?.[1];
      if (acc) touch(acc);
    }
  };
  // Both listen on one socket at a time: `adopt` takes them off the previous one. A failure of ours stays in them: the frame is the page's.
  const onMessage = guard('message', (event: MessageEvent) => {
    const from = performance.now();
    try {
      read(event.data);
    } finally {
      const took = performance.now() - from;
      frames += 1;
      spent += took;
      if (took > slowest) slowest = took;
    }
  });
  const onClose = guard('close', () => {
    authed = false;
    lose('closed');
    sink?.changed();
  });
  const release = (): void => {
    socket?.removeEventListener('message', onMessage);
    socket?.removeEventListener('close', onClose);
  };
  /** ChatSpace creates a new socket on every (re)connect: a new socket epoch. */
  const adopt = (next: WebSocket): void => {
    release();
    // ChatSpace closes its socket before it makes the next one. One left open may still get the frames the tap now
    // misses: no account is armed until it is closed (a foreign socket on this path can only hold a send, §6.8).
    left = left.concat(socket ?? []).filter(delivers);
    socket = next;
    epoch += 1;
    authed = false;
    next.addEventListener('message', onMessage);
    next.addEventListener('close', onClose);
    lose('reconnect');
    sink?.changed();
  };

  const Tapped = new Proxy(Native, {
    construct(target, args: ConstructorParameters<typeof WebSocket>, newTarget) {
      // The page's own call: what the constructor throws is the page's, never caught here.
      const made = Reflect.construct(target, args, newTarget) as WebSocket;
      constructed += 1;
      try {
        if (on && String(args[0]).split(/[?#]/)[0]?.endsWith(WS_PATH)) adopt(made);
      } catch {
        // The socket is the page's; a failure of ours never reaches it.
        fail('socket');
      }
      return made;
    },
  });
  win.WebSocket = Tapped;

  /** The counters of one chat as they are now. */
  const checkpoint = (acc: string, fan: string): Omit<Checkpoint, 'documentEpoch'> => {
    tick();
    sync();
    const state = account(acc);
    const chat = chats.get(`${acc}:${fan}`);
    return {
      socketEpoch: epoch,
      subscriptionEpoch: state.epoch,
      hostAccountId: acc,
      platformFanId: fan,
      fanSequence: chat?.seq ?? 0,
      lastFanMessageId: chat?.ids[0] ?? null,
      knownFanMessageIds: chat?.ids.slice(0, KNOWN_FAN_MESSAGES) ?? [],
      observedAt: clock(),
      coverage: armed(state) ? 'ok' : 'unknown',
    };
  };

  return {
    guard,
    fail,
    constructed: () => constructed,
    on: () => on,
    anchor: () => (bad ? 'shape' : on && authed ? 'ok' : 'missing'),
    frameTime: () => [frames, spent, slowest],
    sync,
    checkpoint,
    /** A checkpoint is fresh when one taken now tells the same: both covered, the same epochs, no new fan message. */
    fresh(then) {
      const now = checkpoint(then.hostAccountId, then.platformFanId);
      if (then.coverage !== 'ok' || now.coverage !== 'ok' || then.socketEpoch !== now.socketEpoch || then.subscriptionEpoch !== now.subscriptionEpoch || now.fanSequence < then.fanSequence) return CG_SEND_FRESHNESS;
      return now.fanSequence > then.fanSequence || now.lastFanMessageId !== then.lastFanMessageId ? CG_SEND_STALE : null;
    },
    connect(next) {
      sink = next;
      sync();
    },
    off() {
      if (!on) return;
      on = false;
      win.clearInterval(timer);
      release();
      if (win.WebSocket === Tapped) win.WebSocket = Native;
      lose('off');
      sink?.changed();
    },
  };
}

/** Installs the tap and leaves its handle under the non-enumerable `Symbol.for('wsTap')`; null when one is there already. */
export function installWsTap(win: Window & typeof globalThis = window): WsTapHandle | null {
  const key = Symbol.for(WS_TAP_KEY);
  if (key in win) return null;
  const tap = createTap(win);
  let taken = false;
  const page = win as unknown as Record<symbol, unknown>;
  const dispose = (): void => {
    tap.off();
    if (page[key] === handle) delete page[key];
  };
  const handle: WsTapHandle = {
    version: 1,
    socketCount: tap.constructed,
    frameTime: tap.frameTime,
    attach: (host: LiveHost) => {
      if (taken || !tap.on()) return null;
      taken = true;
      return createLivePort(win, tap, host, dispose);
    },
    dispose,
  };
  // Not enumerable, not writable (the defaults); configurable, so `dispose` can take it away.
  Object.defineProperty(win, key, { value: handle, configurable: true });
  return handle;
}
