// The page's socket, shaped like ChatSpace's three layers (metadata.ts
// «socket»): a manager that creates a NEW WebSocket on every (re)connect and
// sets onopen/onmessage/onclose as properties; a bus that parses each frame's
// top-level `event` and calls private listeners (not store actions); and a
// per-store helper that authenticates ('auth' → 'authenticated', 10 s × 3)
// and then calls onConnect / onReconnect. Like ChatSpace's manager, it also
// forces a NEW socket on the window's `online` and `offline` events, and when
// the tab becomes visible while the socket is neither open nor connecting —
// the reconnect waves the extension must never cause (architecture.md §6.10).

import { shallowRef, watch, type ShallowRef } from 'vue';

import { env } from '../env';
import { record } from '../journal';
import { STAND_WS_PATH } from '../protocol';
import { getToken } from './auth';

export type SocketStatus = 'CLOSED' | 'CONNECTING' | 'OPEN' | 'DISCONNECTED';
export type Frame = Readonly<Record<string, unknown>>;
export type FrameHandler = (frame: Frame) => void;
export type SendAction = (action: string, payload?: Record<string, unknown>) => Promise<void>;

const AUTH_WAIT_MS = 10_000;
const AUTH_TRIES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const RECONNECT_BUDGET = 10;

/** The socket URL on the API origin; ChatSpace keeps the same thing in its config, the extension's tap matches on it. */
export const SOCKET_URL = `${env.apiOrigin.replace(/^http/, 'ws')}${STAND_WS_PATH}`;

class SocketManager {
  readonly status: ShallowRef<SocketStatus> = shallowRef('CLOSED');
  /** Sockets created so far (each reconnect is a new one). */
  epoch = 0;
  sent = 0;
  private socket: WebSocket | null = null;
  private attempts = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Connected at least once and not closed on purpose (sign-out). */
  private active = false;

  constructor(
    private readonly url: string,
    private readonly onFrame: (text: string) => void,
  ) {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.recover('online'));
    window.addEventListener('offline', () => this.recover('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const state = this.socket?.readyState;
      if (state !== WebSocket.CONNECTING && state !== WebSocket.OPEN) this.recover('visible');
    });
  }

  /** Forced reconnect on a window signal; skipped while connecting or when the app is not connected at all. */
  private recover(cause: 'online' | 'offline' | 'visible'): void {
    if (!this.active || this.socket?.readyState === WebSocket.CONNECTING) {
      record('ws-recover-skipped', { cause });
      return;
    }
    record('ws-recover', { cause });
    this.reconnect();
  }

  /** Closes on purpose (sign-out): no reconnect, no recovery. */
  close(): void {
    this.active = false;
    clearTimeout(this.timer);
    const old = this.socket;
    this.socket = null;
    this.status.value = 'CLOSED';
    old?.close(1000, 'signed-out');
  }

  connect(): void {
    this.active = true;
    if (this.socket !== null && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.timer);
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.epoch += 1;
    this.status.value = 'CONNECTING';
    record('ws-connect', { epoch: this.epoch });
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempts = 0;
      this.status.value = 'OPEN';
      record('ws-open', { epoch: this.epoch });
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket === socket && typeof event.data === 'string') this.onFrame(event.data);
    };
    socket.onerror = () => undefined;
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      record('ws-close', { epoch: this.epoch, code: event.code });
      if (event.code === 1000) {
        this.status.value = 'CLOSED';
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.attempts >= RECONNECT_BUDGET) {
      this.status.value = 'DISCONNECTED';
      record('ws-give-up');
      return;
    }
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempts, BACKOFF_MAX_MS) + Math.random() * 1000;
    this.attempts += 1;
    this.status.value = 'CLOSED';
    this.timer = setTimeout(() => this.connect(), delay);
  }

  /** Forced reconnect (ChatSpace does it on window online/offline): close and open a new socket now. */
  reconnect(): void {
    const old = this.socket;
    this.socket = null;
    old?.close(4001, 'forced');
    this.attempts = 0;
    this.connect();
  }

  send(text: string): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(text);
    this.sent += 1;
    return true;
  }
}

const listeners = new Map<string, Set<FrameHandler>>();

function dispatch(text: string): void {
  let frame: Frame;
  try {
    frame = JSON.parse(text) as Frame;
  } catch {
    record('ws-frame-unparsed');
    return;
  }
  const event = frame['event'];
  if (typeof event !== 'string' || event === '') {
    record('ws-frame-without-event');
    return;
  }
  record('ws-frame', { event });
  listeners.get(event)?.forEach((handler) => {
    try {
      handler(frame);
    } catch (error) {
      record('ws-handler-error', { event, message: error instanceof Error ? error.message : String(error) });
    }
  });
}

export const socket = new SocketManager(SOCKET_URL, dispatch);

export function listen(event: string, handler: FrameHandler): () => void {
  const set = listeners.get(event) ?? new Set<FrameHandler>();
  set.add(handler);
  listeners.set(event, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(event);
  };
}

/** Every client action carries a fresh session token, like ChatSpace's bus. */
export const sendAction: SendAction = async (action, payload = {}) => {
  const token = await getToken();
  if (token === null) return;
  const sent = socket.send(JSON.stringify({ action, token, ...payload }));
  record('ws-send', { action, sent });
};

let authenticatedEpoch = 0;
let authInFlight: { epoch: number; promise: Promise<boolean> } | null = null;

function waitForAuthenticated(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, AUTH_WAIT_MS);
    const stop = listen('authenticated', () => {
      clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}

function authenticate(): Promise<boolean> {
  const epoch = socket.epoch;
  if (authenticatedEpoch === epoch) return Promise.resolve(true);
  if (authInFlight?.epoch === epoch) return authInFlight.promise;
  const promise = (async () => {
    for (let attempt = 1; attempt <= AUTH_TRIES; attempt += 1) {
      const answered = waitForAuthenticated();
      await sendAction('auth');
      if (await answered) {
        authenticatedEpoch = epoch;
        return true;
      }
    }
    record('ws-connect-failed', { epoch });
    return false;
  })();
  authInFlight = { epoch, promise };
  return promise;
}

export interface SocketClient {
  readonly onConnect?: (send: SendAction) => void | Promise<void>;
  readonly onReconnect?: (send: SendAction) => void | Promise<void>;
  readonly listeners?: ReadonlyArray<{ readonly event: string; readonly handler: FrameHandler }>;
}

/** A store's socket hook-up: listeners now, onConnect/onReconnect after each authenticated (re)connect. */
export function useSocket(client: SocketClient): { readonly send: SendAction; readonly status: ShallowRef<SocketStatus> } {
  for (const { event, handler } of client.listeners ?? []) listen(event, handler);
  let connectedEpoch = 0;
  const run = async (): Promise<void> => {
    const epoch = socket.epoch;
    if (!(await authenticate()) || epoch === connectedEpoch) return;
    const first = connectedEpoch === 0;
    connectedEpoch = epoch;
    await (first ? client.onConnect : client.onReconnect)?.(sendAction);
  };
  watch(socket.status, (status) => {
    if (status === 'OPEN') void run();
  });
  if (socket.status.value === 'OPEN') void run();
  return { send: sendAction, status: socket.status };
}

export function socketState(): { status: SocketStatus; sockets: number; authenticated: boolean; sent: number } {
  return { status: socket.status.value, sockets: socket.epoch, authenticated: authenticatedEpoch === socket.epoch && socket.epoch > 0, sent: socket.sent };
}
