// Frame side of a site's relay port (`cg-relay`, 1.15.0; R20 docs/project-unite/
// architecture.md §8.5, P9c): the relay frame of «Fansly через вкладку» — an
// extension page in a subframe of the model's tab — and the background.
//
// - One port at a time. The background takes it only from our relay page in a
//   subframe of a tab that holds a registered session of its site (rpc-common
//   `verifyRelaySender`, rpc-background), and closes it when that tab's
//   document goes. A frame speaks for that tab session and carries none of its
//   own: its requests have no `tabSessionId`.
// - There is no handshake on the wire: a port is open from `connect`; a port
//   the background refused is closed at once. `onOpen` hears every new port,
//   so the frame says who it is there (`fansly.relay.hello`) each time.
// - The port is lost (the background slept or restarted, the tab registered
//   anew): requests already sent end with CG-RUNTIME-UNREACHABLE and are NOT
//   resent — the frame's answers belong to the requests of the old port. The
//   client opens a new port after 100 ms, 0.5, 1 and then every 5 s, for as
//   long as the frame lives (its tab removes it 60 s after its last work); a
//   port that lived 5 s starts the delays over. The extension itself reloaded
//   or updated: nothing more (`reloaded`).
// - Payloads are checked by the site's own registry (`validate`): the frame
//   carries its schemas, the platform none of a site's.

import { RELAY_PORT_NAME, TabEnvelopeSchema } from '@cg/contracts/tab-protocol';

import { defaultBrowser, type BrowserApi, type PortApi } from './browser-api';
import { requestEnvelope, rpcError, type RpcResult, type TabPayloadValidator } from './rpc-common';
import { isExtensionContextAlive } from './runtime';

export type RelayConnectionState = 'connecting' | 'open' | 'reconnecting' | 'reloaded' | 'closed';

export interface RelayRpcClientOptions {
  readonly api?: BrowserApi;
  /** The site's registry: its events and the answers to its requests. */
  readonly validate: TabPayloadValidator;
  /** Default: 100 ms, 0.5 s, 1 s, then every 5 s. */
  readonly reconnectDelaysMs?: readonly number[];
  /** A port that lived this long was taken: the next loss starts the delays over (default 5 s). */
  readonly settledAfterMs?: number;
  /** Default 15 s: a cold event page answers after its readiness barrier (≤ 10 s). */
  readonly requestTimeoutMs?: number;
  readonly isContextAlive?: () => boolean;
  readonly now?: () => number;
}

export interface RelayRpcClient {
  /** A request of the site's registry from the relay (`from: relay`); the answer checked by `validate`. */
  request(type: string, payload: unknown, options?: { readonly timeoutMs?: number }): Promise<RpcResult<unknown>>;
  onEvent(type: string, listener: (payload: unknown) => void): () => void;
  /** Every new port, the first included: the frame says who it is there. */
  onOpen(listener: () => void): () => void;
  state(): RelayConnectionState;
  close(): void;
}

export const DEFAULT_RELAY_RECONNECT_DELAYS_MS: readonly number[] = [100, 500, 1_000, 5_000];
export const DEFAULT_RELAY_SETTLED_AFTER_MS = 5_000;
export const DEFAULT_RELAY_REQUEST_TIMEOUT_MS = 15_000;

interface Pending {
  readonly type: string;
  readonly resolve: (result: RpcResult<unknown>) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createRelayRpcClient(options: RelayRpcClientOptions): RelayRpcClient {
  const api = options.api ?? defaultBrowser();
  const alive = options.isContextAlive ?? (() => isExtensionContextAlive(api));
  const delays = options.reconnectDelaysMs ?? DEFAULT_RELAY_RECONNECT_DELAYS_MS;
  const settledAfterMs = options.settledAfterMs ?? DEFAULT_RELAY_SETTLED_AFTER_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RELAY_REQUEST_TIMEOUT_MS;
  const now = options.now ?? (() => Date.now());

  let state: RelayConnectionState = 'connecting';
  let port: PortApi | null = null;
  let openedAt = 0;
  let attempt = 0;
  let nextId = 1;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const inflight = new Map<number, Pending>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const openListeners = new Set<() => void>();

  const finish = (id: number, result: RpcResult<unknown>): void => {
    const pending = inflight.get(id);
    if (pending === undefined) return;
    inflight.delete(id);
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.resolve(result);
  };
  const endAll = (code: 'CG-RUNTIME-UNREACHABLE' | 'CG-RUNTIME-RELOADED', detail: string): void => {
    for (const id of [...inflight.keys()]) finish(id, rpcError(code, detail));
  };

  function onMessage(raw: unknown): void {
    const parsed = TabEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const envelope = parsed.data;
    if (envelope.kind === 'evt') {
      const listeners = eventListeners.get(envelope.type);
      if (listeners === undefined || listeners.size === 0) return;
      const checked = options.validate('evt', envelope.type, envelope.payload);
      if (!checked.ok) return;
      for (const listener of [...listeners]) listener(checked.payload);
      return;
    }
    if (envelope.kind !== 'res') return;
    const pending = inflight.get(envelope.id);
    if (pending === undefined || pending.type !== envelope.type) return;
    if (!envelope.ok) {
      finish(envelope.id, { ok: false, error: envelope.error });
      return;
    }
    const checked = options.validate('res', pending.type, envelope.payload);
    finish(envelope.id, checked.ok ? { ok: true, payload: checked.payload } : rpcError('CG-UNKNOWN', `invalid ${pending.type} response`));
  }

  function onLost(): void {
    if (state === 'closed' || state === 'reloaded') return;
    const lived = port !== null && now() - openedAt >= settledAfterMs;
    port = null;
    if (!alive()) {
      endAll('CG-RUNTIME-RELOADED', 'extension reloaded');
      state = 'reloaded';
      return;
    }
    endAll('CG-RUNTIME-UNREACHABLE', 'port lost');
    if (lived) attempt = 0;
    state = 'reconnecting';
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? 0;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (state === 'closed' || state === 'reloaded') return;
    if (!alive()) {
      onLost();
      return;
    }
    let next: PortApi;
    try {
      next = api.runtime.connect({ name: RELAY_PORT_NAME });
    } catch {
      onLost();
      return;
    }
    port = next;
    openedAt = now();
    state = 'open';
    next.onMessage.addListener((message) => {
      if (port === next) onMessage(message);
    });
    next.onDisconnect.addListener(() => {
      if (port === next) onLost();
    });
    for (const listener of [...openListeners]) {
      if (port !== next) break;
      listener();
    }
  }

  // The first port after the caller has had its turn to listen (`onOpen`, `onEvent`).
  queueMicrotask(connect);

  return {
    request(type, payload, requestOptions) {
      return new Promise((resolve) => {
        if (state === 'reloaded') {
          resolve(rpcError('CG-RUNTIME-RELOADED', 'extension reloaded'));
          return;
        }
        const current = port;
        if (current === null || state !== 'open') {
          resolve(rpcError('CG-RUNTIME-UNREACHABLE', state));
          return;
        }
        const id = nextId++;
        const pending: Pending = { type, resolve, timer: null };
        inflight.set(id, pending);
        pending.timer = setTimeout(() => finish(id, rpcError('CG-RUNTIME-UNREACHABLE', `${type} timeout`)), requestOptions?.timeoutMs ?? requestTimeoutMs);
        try {
          current.postMessage(requestEnvelope(id, type, payload));
        } catch {
          finish(id, rpcError('CG-RUNTIME-UNREACHABLE', 'port closed'));
        }
      });
    },
    onEvent(type, listener) {
      let set = eventListeners.get(type);
      if (set === undefined) {
        set = new Set();
        eventListeners.set(type, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },
    onOpen(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    state: () => state,
    close() {
      if (state === 'closed') return;
      state = 'closed';
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      const old = port;
      port = null;
      endAll('CG-RUNTIME-UNREACHABLE', 'closed');
      try {
        old?.disconnect();
      } catch {
        // already gone
      }
    },
  };
}
