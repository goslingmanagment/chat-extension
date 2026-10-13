// The fake Fansly's socket (`wss://wsv3.fansly.com?v=3` on the real site; S2
// Q1): text frames `{t, d}`.
// - Every connection is a new socket — an epoch, counted here as the page's
//   tap counts its own instances (architecture.md §5.2). The page makes a new
//   one after a close and whenever one has not opened within 3 s
//   (main:37789-37800): `stall` holds connections without opening them.
// - The page's first frame is `{t: 1, d: '{"token":…,"v":3}'}` (main:27523-27529);
//   the server answers `t: 1` (SessionVerifiedEvent, carrying the token), or
//   `t: 0` with code 401 for a dead session (the page logs out). Events go
//   only to verified sockets.
// - The page's ping is the text `"p"` every 20–25 s; the answer is `t: 2`
//   (main:27483-27495). Without it the page resets its socket.
// - Events are `t: 10000` frames, built by fixture-fansly/src/wire.ts; a test
//   pushes them — one by one, as a `t: 10001` batch, or raw (a damaged one).

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import type { FakeFanslySocketView } from '../../fixture-fansly/src/server-protocol';
import { FRAME, SOCKET_PING, batchFrame, errorFrame, pongFrame, sessionFrame } from '../../fixture-fansly/src/wire';
import { classifyCaller, type FanslyCaller, type FanslyVia } from './journal';
import type { FanslyState } from './state';

interface Connection {
  readonly id: number;
  readonly socket: WebSocket;
  readonly caller: FanslyCaller;
  readonly via: FanslyVia;
  verified: boolean;
  pings: number;
  verifyTimer: ReturnType<typeof setTimeout> | undefined;
}

/** The close code of a socket the stand closed on purpose: not 1000, so the page takes it as a lost connection. */
export const STAND_CLOSE_CODE = 4000;

const headerText = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value.join(',') : value);

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/** The token of the page's verify request, or null — not a verify request. */
function verifyToken(text: string): string | null {
  try {
    const wrapper = JSON.parse(text) as { t?: unknown; d?: unknown };
    if (wrapper.t !== FRAME.session || typeof wrapper.d !== 'string') return null;
    const token = (JSON.parse(wrapper.d) as { token?: unknown }).token;
    return typeof token === 'string' ? token : null;
  } catch {
    return null;
  }
}

export class FanslySocketHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<number, Connection>();
  /** Connections held without a handshake (`stall`). */
  private readonly stalled = new Set<Duplex>();
  private taken = 0;

  constructor(private readonly state: FanslyState) {}

  /** Connections taken since the start, stalled ones included. */
  get count(): number {
    return this.taken;
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, via: FanslyVia): void {
    if (headerText(request.headers.host) !== this.state.socketHost) {
      socket.destroy();
      return;
    }
    this.taken += 1;
    const id = this.taken;
    const caller = classifyCaller({ origin: headerText(request.headers.origin), control: false, tokenLabel: null }, this.state.pageOrigin);
    if (this.state.socket.stall > 0) {
      // Never answered: the page's socket stays CONNECTING until the page gives up on it.
      this.state.socket.stall -= 1;
      this.stalled.add(socket);
      socket.on('close', () => this.stalled.delete(socket));
      socket.on('error', () => socket.destroy());
      this.state.journal.record({ kind: 'ws-stalled', caller, via, socketId: id });
      return;
    }
    this.server.handleUpgrade(request, socket, head, (ws) => this.accept(id, ws, caller, via));
  }

  private accept(id: number, socket: WebSocket, caller: FanslyCaller, via: FanslyVia): void {
    const connection: Connection = { id, socket, caller, via, verified: false, pings: 0, verifyTimer: undefined };
    this.connections.set(id, connection);
    this.state.journal.record({ kind: 'ws-open', caller, via, socketId: id });
    socket.on('message', (data: RawData, binary: boolean) => {
      // The page sends text only; its own handler for bytes is empty (main:27554-27555).
      if (!binary) this.onText(connection, rawText(data));
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', (code: number) => {
      clearTimeout(connection.verifyTimer);
      this.connections.delete(id);
      this.state.journal.record({ kind: 'ws-close', caller, via, socketId: id, detail: { code } });
    });
  }

  private onText(connection: Connection, text: string): void {
    const { state } = this;
    if (text === SOCKET_PING) {
      connection.pings += 1;
      state.journal.record({ kind: 'ws-in', caller: connection.caller, via: connection.via, socketId: connection.id, detail: { frame: 'ping', answered: state.socket.pong } });
      if (state.socket.pong) connection.socket.send(pongFrame());
      return;
    }
    const token = verifyToken(text);
    if (token === null) {
      state.journal.record({ kind: 'ws-in', caller: connection.caller, via: connection.via, socketId: connection.id, detail: { frame: 'unknown' } });
      return;
    }
    const live = state.isLive(token);
    state.journal.record({ kind: 'ws-in', caller: connection.caller, via: connection.via, socketId: connection.id, detail: { frame: 'verify', live, answered: live ? state.socket.verify : true } });
    if (!live) {
      connection.socket.send(errorFrame(401));
      return;
    }
    if (!state.socket.verify) return;
    clearTimeout(connection.verifyTimer);
    connection.verifyTimer = setTimeout(() => {
      if (connection.socket.readyState !== connection.socket.OPEN) return;
      connection.verified = true;
      connection.socket.send(sessionFrame({ id: state.world.nextId(), accountId: state.world.creatorId, token }));
      state.journal.record({ kind: 'ws-out', caller: connection.caller, via: connection.via, socketId: connection.id, detail: { frame: 'session' } });
    }, state.socket.verifyDelayMs);
  }

  /** Sends text frames, as they are, to every verified socket; `batch` — as one `t: 10001`. Returns the sockets reached. */
  emit(frames: readonly string[], what: string, batch = false): number {
    const out = batch ? [batchFrame(frames)] : frames;
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (!connection.verified || connection.socket.readyState !== connection.socket.OPEN) continue;
      for (const frame of out) connection.socket.send(frame);
      sent += 1;
    }
    this.state.journal.record({ kind: 'ws-out', caller: 'control', via: 'direct', detail: { frame: what, frames: frames.length, batch, sockets: sent } });
    return sent;
  }

  /** The session died: `t: 0` with 401 to every socket (the page logs out, main:27530-27532). */
  expire(): void {
    for (const connection of this.connections.values()) {
      connection.verified = false;
      if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(errorFrame(401));
    }
  }

  /** Closes every socket and lets go of the stalled ones: the page makes a new socket — a new epoch. */
  closeAll(code = STAND_CLOSE_CODE): number {
    const count = this.connections.size + this.stalled.size;
    for (const connection of this.connections.values()) connection.socket.close(code, 'stand');
    for (const socket of this.stalled) socket.destroy();
    this.stalled.clear();
    return count;
  }

  views(): FakeFanslySocketView[] {
    return [...this.connections.values()].map((connection) => ({ id: connection.id, caller: connection.caller, via: connection.via, verified: connection.verified, pings: connection.pings }));
  }

  close(): Promise<void> {
    for (const connection of this.connections.values()) {
      clearTimeout(connection.verifyTimer);
      connection.socket.terminate();
    }
    for (const socket of this.stalled) socket.destroy();
    this.stalled.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
