// Passive WebSocket tap (architecture.md §6.8, §6.7.5), the script the
// background registers through scripting.registerContentScripts({world:
// 'MAIN', runAt: 'document_start'}) only while the `wsTap` flag is on.
//
// - Only the constructor is wrapped (`new Proxy` + Reflect.construct):
//   instances, `instanceof`, statics and the prototype stay native.
// - A `message` and a `close` listener go only onto ChatSpace's own socket
//   (its URL path). We never send, connect, subscribe or reconnect, never
//   change a frame or stop its propagation; our failures stay inside.
// - A cheap substring filter comes before JSON.parse: `account_new_message`
//   and `authenticated` frames are parsed, any other frame only says which
//   account it is for. Counters of fan messages per (account, fan), without
//   duplicates by id, are updated before anything is forwarded; the text of a
//   message never leaves this file.
// - An account is «armed» (§6.8 п. 6) when the current socket saw
//   `authenticated`, the account is in ChatSpace's `subscribedAccountIds`
//   (which the tap watches) and a frame of that account came on this socket
//   since it was last subscribed. A new socket, a lost subscription, a sleep
//   gap, an overflow or an unreadable frame void every checkpoint taken
//   before: coverage is `unknown`, never «nothing new».
// - Cleanup restores the global only if it is still ours (п. 11).
//
// The same script carries the rest of §6.6–§6.8 — the send port, the receipt
// observer, the observation of human sends (live-port.ts): none of it means
// anything without the tap, and the document_start bundle has no room for it
// (§11). The bridge's runtime takes it through the handle (live.ts).

import { idOf, isPlain } from './check';
import { createLivePort } from './live-port';
import { type LiveHost, type Tap, type TapSink, type WsTapHandle } from './live';
import { iso } from './page';
import { CG_SEND_FRESHNESS, CG_SEND_STALE, KNOWN_FAN_MESSAGES, WS_AUTHENTICATED, WS_NEW_MESSAGE, WS_PATH, WS_TAP_KEY } from './protocol';

export { type WsTapHandle } from './live';

/** Chats with counters. One more, and all counters start over: every checkpoint taken before is void (never «nothing new»). */
const MAX_CHATS = 5000;
/** Fan message ids kept per chat, newest first: duplicates are told by them. */
const MAX_IDS = 32;
/** Outgoing ids kept for a receipt that comes after its echo. */
const MAX_ECHOES = 64;
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

export function createTap(win: Window & typeof globalThis): Tap & { readonly constructed: () => number } {
  const Native = win.WebSocket;
  const clock = Date.now;
  const accounts = new Map<string, Account>();
  const chats = new Map<string, Chat>();
  const echoes: string[] = [];
  let sink: TapSink | null = null;
  let on = true;
  let constructed = 0;
  let epoch = 0;
  let socket: WebSocket | null = null;
  let authed = false;
  /** A message frame could not be read since the last good one. */
  let bad = false;
  /** The subscription set was readable at the last sync. */
  let observable = false;
  let tickAt = clock();

  const armed = (state: Account | undefined): boolean => on && authed && socket?.readyState === SOCKET_OPEN && !!state && state.subscribed && state.framed;
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
      if ((members?.has(acc) === true) === state.subscribed) continue;
      state.subscribed = !state.subscribed;
      // The first readable set is the baseline: until it no account was armed, so no checkpoint could be compared.
      if (observable) lose('subscription', acc);
      else report(acc, state, 'armed');
    }
    observable = members !== null;
  };
  /** A sleep (or a stalled tab) between two ticks: frames may have been missed. */
  const tick = (): void => {
    const now = clock();
    if (now - tickAt > TICK_MS + GAP_MS) lose('sleep');
    tickAt = now;
  };
  const timer = win.setInterval(tick, TICK_MS);
  const unreadable = (acc?: string): void => {
    lose('schema', acc);
    if (!bad) sink?.changed();
    bad = true;
  };
  /** A frame of this account on the current socket (one small record per account ChatSpace's own socket names). */
  const touch = (acc: string): void => {
    const state = account(acc);
    if (state.framed) return;
    state.framed = true;
    report(acc, state, 'armed');
  };

  const message = (frame: unknown): void => {
    const root = isPlain(frame) ? frame : {};
    const acc = idOf(isPlain(root['account']) ? root['account']['account_id'] : null);
    if (root['event'] !== WS_NEW_MESSAGE) {
      if (acc) touch(acc);
      return;
    }
    const body = isPlain(root['message']) ? root['message'] : {};
    const fan = idOf(body['chatId']);
    const id = idOf(body['id']);
    const fromFan = body['is_from_fan'];
    if (!acc || !fan || !id || typeof fromFan !== 'boolean') return unreadable(acc ?? undefined);
    if (bad) {
      bad = false;
      sink?.changed();
    }
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
    } else {
      const tag = `${key}:${id}`;
      if (echoes.includes(tag)) return;
      if (echoes.push(tag) > MAX_ECHOES) echoes.shift();
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
      for (const [acc, state] of accounts) report(acc, state, 'authenticated');
      sink?.changed();
    } else {
      const acc = ACCOUNT_OF.exec(data)?.[1];
      if (acc) touch(acc);
    }
  };
  // Both listen on one socket at a time: `adopt` takes them off the previous one.
  const onMessage = (event: MessageEvent): void => {
    try {
      read(event.data);
    } catch {
      // A failure of ours stays here: the frame is the page's.
    }
  };
  const onClose = (): void => {
    authed = false;
    try {
      lose('closed');
      sink?.changed();
    } catch {
      // As above.
    }
  };
  const release = (): void => {
    socket?.removeEventListener('message', onMessage);
    socket?.removeEventListener('close', onClose);
  };
  /** ChatSpace creates a new socket on every (re)connect: a new socket epoch. */
  const adopt = (next: WebSocket): void => {
    release();
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
      const made = Reflect.construct(target, args, newTarget) as WebSocket;
      constructed += 1;
      try {
        if (on && String(args[0]).split(/[?#]/)[0]?.endsWith(WS_PATH)) adopt(made);
      } catch {
        // The socket is the page's; a failure of ours never reaches it.
      }
      return made;
    },
  });
  win.WebSocket = Tapped;

  return {
    constructed: () => constructed,
    on: () => on,
    anchor: () => (bad ? 'shape' : on && authed ? 'ok' : 'missing'),
    sync,
    checkpoint(acc, fan) {
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
    },
    fresh(checkpoint) {
      tick();
      sync();
      const state = accounts.get(checkpoint.hostAccountId);
      const chat = chats.get(`${checkpoint.hostAccountId}:${checkpoint.platformFanId}`);
      const seq = chat?.seq ?? 0;
      if (checkpoint.coverage !== 'ok' || !armed(state) || checkpoint.socketEpoch !== epoch || checkpoint.subscriptionEpoch !== state?.epoch || seq < checkpoint.fanSequence) return CG_SEND_FRESHNESS;
      return seq > checkpoint.fanSequence || (chat?.ids[0] ?? null) !== checkpoint.lastFanMessageId ? CG_SEND_STALE : null;
    },
    echoed: (acc, fan, id) => echoes.includes(`${acc}:${fan}:${id}`),
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

/** Installs the tap and leaves its handle under the non-enumerable `Symbol.for('chatgoose.wsTap')`; null when one is there already. */
export function installWsTap(win: Window & typeof globalThis = window): WsTapHandle | null {
  const key = Symbol.for(WS_TAP_KEY);
  if (Object.prototype.hasOwnProperty.call(win, key)) return null;
  const tap = createTap(win);
  let taken = false;
  const dispose = (): void => {
    tap.off();
    if (Reflect.get(win, key) === handle) Reflect.deleteProperty(win, key);
  };
  const handle: WsTapHandle = Object.freeze({
    version: 1 as const,
    socketCount: tap.constructed,
    attach: (host: LiveHost) => {
      if (taken || !tap.on()) return null;
      taken = true;
      return createLivePort(win, tap, host, dispose);
    },
    dispose,
  });
  Object.defineProperty(win, key, { value: handle, enumerable: false, configurable: true, writable: false });
  return handle;
}
