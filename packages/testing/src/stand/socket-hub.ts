// The stand's WebSocket endpoint: the observable ChatSpace socket protocol
// (client actions auth / subscribe_account / unsubscribe_account / ping, server
// frames with a top-level `event`). Every connection is a new socket, as on
// ChatSpace reconnects; tests inject frames and close sockets through control.

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import type { ServerJournal } from './journal';
import type { StandState } from './state';

interface Connection {
  readonly id: number;
  readonly socket: WebSocket;
  label: 'pending' | 'native' | 'foreign';
  authenticated: boolean;
  readonly accounts: Set<string>;
}

export interface SocketSummary {
  readonly id: number;
  readonly label: Connection['label'];
  readonly authenticated: boolean;
  readonly accounts: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseFrame(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

export class SocketHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<number, Connection>();
  private nextId = 0;

  constructor(
    private readonly state: StandState,
    private readonly journal: ServerJournal,
  ) {}

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.server.handleUpgrade(request, socket, head, (ws) => this.accept(ws));
  }

  private accept(socket: WebSocket): void {
    this.nextId += 1;
    const connection: Connection = { id: this.nextId, socket, label: 'pending', authenticated: false, accounts: new Set() };
    this.connections.set(connection.id, connection);
    this.journal.record({ kind: 'ws-open', origin: 'pending', socketId: connection.id });
    socket.on('message', (data: RawData) => this.onMessage(connection, data));
    socket.on('close', (code: number) => {
      this.connections.delete(connection.id);
      this.journal.record({ kind: 'ws-close', origin: connection.label, socketId: connection.id, detail: { code } });
    });
  }

  private onMessage(connection: Connection, data: RawData): void {
    const frame = parseFrame(rawText(data));
    const action = typeof frame?.['action'] === 'string' ? frame['action'] : '(unparsed)';
    const token = typeof frame?.['token'] === 'string' ? frame['token'] : null;
    const account = asRecord(frame?.['account']);
    const accountId = account && typeof account['account_id'] === 'string' ? account['account_id'] : undefined;
    // Every client action carries the session token; one without a valid token is not the page's client.
    if (this.state.isValidToken(token)) {
      if (connection.label === 'pending') connection.label = 'native';
    } else {
      connection.label = 'foreign';
    }
    this.journal.record({ kind: 'ws-in', origin: connection.label, socketId: connection.id, ...(accountId !== undefined ? { accountId } : {}), detail: { action } });
    if (connection.label !== 'native') return;
    if (action === 'auth') {
      // A withheld auth leaves the socket open but unauthenticated: no frames for it.
      if (this.state.withholdAuth) return;
      connection.authenticated = true;
      this.sendTo(connection, { event: 'authenticated' });
    } else if (action === 'subscribe_account' && accountId !== undefined) {
      connection.accounts.add(accountId);
    } else if (action === 'unsubscribe_account' && accountId !== undefined) {
      connection.accounts.delete(accountId);
    }
  }

  private sendTo(connection: Connection, frame: Record<string, unknown>): void {
    connection.socket.send(JSON.stringify(frame));
    const event = typeof frame['event'] === 'string' ? frame['event'] : '(no event)';
    const account = asRecord(frame['account']);
    const accountId = account && typeof account['account_id'] === 'string' ? account['account_id'] : undefined;
    this.journal.record({ kind: 'ws-out', origin: 'native', socketId: connection.id, ...(accountId !== undefined ? { accountId } : {}), detail: { event } });
  }

  /** Sends to every authenticated page socket subscribed to the account (all of them when accountId is null). */
  broadcast(frame: Record<string, unknown>, accountId: string | null): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (connection.label !== 'native' || !connection.authenticated) continue;
      if (accountId !== null && !connection.accounts.has(accountId)) continue;
      this.sendTo(connection, frame);
      sent += 1;
    }
    return sent;
  }

  /** Closes every socket (code ≠ 1000 makes the page reconnect with a NEW socket). */
  closeAll(code = 4000): number {
    const count = this.connections.size;
    for (const connection of this.connections.values()) connection.socket.close(code, 'stand-control');
    return count;
  }

  summary(): SocketSummary[] {
    return [...this.connections.values()].map((connection) => ({
      id: connection.id,
      label: connection.label,
      authenticated: connection.authenticated,
      accounts: [...connection.accounts].sort(),
    }));
  }

  close(): Promise<void> {
    for (const connection of this.connections.values()) connection.socket.terminate();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}
