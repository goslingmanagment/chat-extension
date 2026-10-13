// The page's socket, as Fansly's client keeps it (S2 Q1).
// - The low-level client (module 7394, main:37762-37838): `new WebSocket(uri)`
//   with the global looked up at every construction, `binaryType`, and its
//   handlers as `on*` PROPERTIES; a reconnect timer that makes the first
//   attempt at once, looks again after 3 s and, if the socket is still not
//   open, replaces it — waiting 3, 6, 12, then 15 s between looks — and
//   settles on a look every 15 s once connected; an error or a close clears
//   the socket and starts over from 1.5 s. So a socket that does not open in
//   3 s is replaced by a new one, and every replacement is a new instance.
// - The event service (main:27420-27590): one client per `connect()`; on open
//   it sends `{t: 1, d: '{"token":…,"v":3}'}`; `t: 1` back means connected;
//   the text `"p"` goes out every 20–25 s (one interval for the page's life),
//   and when no `t: 2` came for 1.2 intervals the socket is reset instead (at
//   most once in 15 s). Frames are parsed three levels deep; a `t: 10001`
//   batch is walked frame by frame.
// A damaged frame throws inside the page's handler on the site; here it is
// counted and journaled — the page ignores it either way.

import { record } from './journal';
import type { SocketView } from './protocol';
import { SOCKET_PING, parseFrame, sessionVerifyRequest } from './wire';

type Timer = ReturnType<typeof setTimeout>;

/** `WebSocket.OPEN` (the page reads it off the instance; a test DOM may not carry the constant there). */
const OPEN = 1;
const FIRST_RETRY_MS = 1500;
const MAX_RETRY_MS = 15_000;
const RESET_GUARD_MS = 15_000;

/** The low-level client: one socket at a time, replaced by a new instance whenever it is not open at a look. */
class WebsocketClient {
  onText: ((text: string) => void) | null = null;
  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  private uri = '';
  private con: WebSocket | null = null;
  private timer: Timer | null = null;
  private timeout = FIRST_RETRY_MS;

  constructor(private readonly onCreated: () => void) {}

  isConnected(): boolean {
    return this.con !== null && this.con.readyState === OPEN;
  }

  writeText(text: string): void {
    if (this.isConnected()) this.con?.send(text);
  }

  private startReconnectTimer(now = false): void {
    if (this.timer !== null) return;
    const look = (): void => {
      this.timer = null;
      if (this.isConnected()) {
        this.timeout = MAX_RETRY_MS;
      } else {
        this.timeout = Math.min(this.timeout * 2, MAX_RETRY_MS);
        this.setUpConnection();
      }
      this.startReconnectTimer();
    };
    if (now) look();
    else this.timer = setTimeout(look, this.timeout);
  }

  private stopReconnectTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.timeout = FIRST_RETRY_MS;
  }

  resetReconnectTimer(): void {
    this.stopReconnectTimer();
    this.startReconnectTimer();
  }

  connect(uri: string): void {
    this.uri = uri;
    this.startReconnectTimer(true);
  }

  private clearConnection(): void {
    const con = this.con;
    if (con === null) return;
    con.onopen = null;
    con.onerror = null;
    con.onmessage = null;
    con.onclose = null;
    con.close();
    this.con = null;
  }

  close(): void {
    this.stopReconnectTimer();
    this.clearConnection();
  }

  private setUpConnection(): void {
    this.clearConnection();
    // The global, at this very moment: whatever stands over `WebSocket` now sees this instance.
    const con = new WebSocket(this.uri);
    this.con = con;
    this.onCreated();
    con.binaryType = 'arraybuffer';
    con.onopen = () => this.onConnect?.();
    con.onerror = () => this.lost();
    con.onmessage = (event: MessageEvent) => {
      // Bytes go to a handler that does nothing (main:27554-27555).
      if (typeof event.data === 'string') this.onText?.(event.data);
    };
    con.onclose = () => this.lost();
  }

  private lost(): void {
    this.onDisconnect?.();
    this.clearConnection();
    this.stopReconnectTimer();
    this.startReconnectTimer();
  }
}

export interface EventServiceOptions {
  /** `ws://localhost:<port>?v=3`. */
  readonly url: string;
  readonly token: string;
  /** The ping interval; 20–25 s on the site, one value for the page's life. */
  readonly pingInterval: number;
  /** A service event (`t: 10000`): the service and its parsed `event`. */
  readonly onServiceEvent: (serviceId: number, event: Readonly<Record<string, unknown>>) => void;
  /** `t: 1`: the session is verified on the current socket. */
  readonly onSessionVerified: () => void;
  /** `t: 0` with 401: the session is dead. */
  readonly onUnauthorized: () => void;
}

export class EventService {
  private client: WebsocketClient | null = null;
  private state: SocketView['state'] = 'disconnected';
  private created = 0;
  private verified = 0;
  private frames = 0;
  private damaged = 0;
  private lastPingResponse = 0;
  private lastConnectionReset = 0;
  private readonly pingTimer: Timer;

  constructor(private readonly options: EventServiceOptions) {
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastPingResponse > 1.2 * options.pingInterval) {
        if (now - this.lastConnectionReset > RESET_GUARD_MS) {
          this.lastConnectionReset = now;
          record('socket-reset', { reason: 'no-pong' });
          this.connect();
        }
      } else if (this.client?.isConnected() === true) {
        this.client.writeText(SOCKET_PING);
      }
    }, options.pingInterval);
  }

  /** A new low-level client (the old one closed): `connectWebsocket` of the event service. */
  connect(): void {
    this.client?.close();
    const client = new WebsocketClient(() => {
      this.created += 1;
      record('socket-created', { socket: this.created });
    });
    this.client = client;
    this.state = 'connecting';
    client.onConnect = () => {
      this.lastPingResponse = Date.now();
      this.state = 'authorizing';
      record('socket-open', { socket: this.created });
      client.writeText(sessionVerifyRequest(this.options.token));
    };
    client.onDisconnect = () => {
      this.state = 'disconnected';
      record('socket-closed', { socket: this.created });
    };
    client.onText = (text) => this.handleText(text);
    client.connect(this.options.url);
  }

  /** The tab is visible again: a socket that got no answer for 30 s is replaced, otherwise its timer starts over (main:27581-27585). */
  assertConnection(): void {
    const now = Date.now();
    if (now - this.lastPingResponse > 30_000 && now - this.lastConnectionReset > RESET_GUARD_MS) {
      this.lastConnectionReset = now;
      this.connect();
      return;
    }
    this.client?.resetReconnectTimer();
  }

  private handleText(text: string): void {
    this.frames += 1;
    try {
      this.dispatch(text);
    } catch {
      // `JSON.parse` threw somewhere inside: the rest of the frame (of a batch too) is lost with it.
      this.damaged += 1;
      record('socket-frame-damaged', { socket: this.created, length: text.length });
    }
  }

  private dispatch(text: string): void {
    const frame = parseFrame(text);
    if (frame === null) return;
    if (frame.t === 0) {
      if (frame.code === 401) {
        this.state = 'disconnected';
        this.options.onUnauthorized();
      }
    } else if (frame.t === 1) {
      this.state = 'connected';
      this.verified += 1;
      record('socket-verified', { socket: this.created });
      this.options.onSessionVerified();
    } else if (frame.t === 2) {
      this.lastPingResponse = Date.now();
    } else if (frame.t === 10000) {
      this.options.onServiceEvent(frame.serviceId, frame.event);
    } else {
      // Walked by index, as the page does: a `d` that is a string is walked by characters, and the first one throws.
      for (let index = 0; index < frame.frames.length; index += 1) this.dispatch(frame.frames[index] as string);
    }
  }

  view(): SocketView {
    return { created: this.created, state: this.state, verified: this.verified, frames: this.frames, damaged: this.damaged };
  }

  destroy(): void {
    clearInterval(this.pingTimer);
    this.client?.close();
    this.client = null;
  }
}
