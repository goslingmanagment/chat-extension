// Tab side of the tab ↔ background protocol (architecture.md §5.4; EX-015,
// RB-010): one `cg-tab` port for the life of the document, `tab.register`
// first, then requests carrying the minted tab session.
//
// - The port is lost (the background unloaded or crashed): requests already
//   sent end with CG-RUNTIME-UNREACHABLE and are NOT resent — a write may
//   have run (§7: nothing indeterminate is repeated); the client reconnects
//   after 100/200/400 ms and registers again (a new tab session); requests
//   issued meanwhile wait for it within their own timeout. All attempts
//   failed — `lost`: requests end at once with CG-RUNTIME-UNREACHABLE. `lost`
//   is not for ever while the extension is the same instance: `reconnect()`
//   — the tab's keepalive beat, the tab coming back on screen, the person's
//   «Повторить» — tries once more, quietly: the state stays `lost` until the
//   background answers, so a try that failed changes nothing on screen.
// - The extension itself was reloaded or updated under the tab: the runtime
//   is gone for good — `reloaded`, everything ends with CG-RUNTIME-RELOADED
//   (the «перезагрузите вкладку» banner, UP-009).
// - Light: the request registry is injected (`validate`), so the early
//   isolated bundle decides when to load it.

import { TAB_PORT_NAME, TabEnvelopeSchema, type TabRegisterRequest } from '@cg/contracts/tab-protocol';
import type { TabEventPayload, TabEventType, TabRequestPayload, TabRequestType, TabResponsePayload } from '@cg/contracts/tab-messages';

import { defaultBrowser, type BrowserApi, type PortApi } from './browser-api';
import { RECONNECT_DELAYS_MS, requestEnvelope, rpcError, type RpcResult, type TabPayloadValidator } from './rpc-common';
import { isExtensionContextAlive } from './runtime';

export type RpcConnectionState = 'connecting' | 'ready' | 'reconnecting' | 'lost' | 'reloaded' | 'closed';

export interface TabRpcClientOptions {
  readonly api?: BrowserApi;
  readonly validate: TabPayloadValidator;
  readonly register: TabRegisterRequest;
  /** Default 60 s: some reads page through the hub (Spenders board). */
  readonly requestTimeoutMs?: number;
  /**
   * A cold event page answers `tab.register` after its readiness barrier,
   * which opens within 10 s (core READINESS_DEADLINE_MS): the default leaves
   * room above that, so a slow cold start is not counted as a failed attempt.
   */
  readonly registerTimeoutMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
  readonly isContextAlive?: () => boolean;
}

export type TabClientRequestType = Exclude<TabRequestType, 'tab.register'>;

export interface TabRpcClient {
  request<T extends TabClientRequestType>(
    type: T,
    payload: TabRequestPayload<T>,
    options?: { readonly timeoutMs?: number },
  ): Promise<RpcResult<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
  onState(listener: (state: RpcConnectionState, tabSessionId: string | null) => void): () => void;
  state(): RpcConnectionState;
  tabSessionId(): string | null;
  /**
   * After `lost`: one more try — the tab's keepalive beat, the tab coming back on screen, the person's «Повторить».
   * The state stays `lost` until the background answers `tab.register` (then `ready`); a try in flight is not doubled.
   */
  reconnect(): void;
  close(): void;
}

interface Pending {
  readonly id: number;
  readonly type: string;
  readonly payload: unknown;
  readonly resolve: (result: RpcResult<unknown>) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Above the background's readiness deadline (10 s), with room for waking the event page. */
export const DEFAULT_REGISTER_TIMEOUT_MS = 15_000;

export function createTabRpcClient(options: TabRpcClientOptions): TabRpcClient {
  const api = options.api ?? defaultBrowser();
  const alive = options.isContextAlive ?? (() => isExtensionContextAlive(api));
  const delays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;

  let state: RpcConnectionState = 'connecting';
  let session: string | null = null;
  let port: PortApi | null = null;
  let nextId = 1;
  let attempt = 0;
  let registerId: number | null = null;
  let registerTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const waiting: Pending[] = [];
  const inflight = new Map<number, Pending>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const stateListeners = new Set<(state: RpcConnectionState, tabSessionId: string | null) => void>();

  const setState = (next: RpcConnectionState): void => {
    if (next === state) return;
    state = next;
    for (const listener of [...stateListeners]) listener(state, session);
  };

  const finish = (pending: Pending, result: RpcResult<unknown>): void => {
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;
    pending.resolve(result);
  };

  const endAll = (list: Iterable<Pending>, code: 'CG-RUNTIME-UNREACHABLE' | 'CG-RUNTIME-RELOADED', detail: string): void => {
    for (const pending of [...list]) finish(pending, rpcError(code, detail));
  };

  const send = (pending: Pending): void => {
    if (!port || session === null) return;
    inflight.set(pending.id, pending);
    try {
      port.postMessage(requestEnvelope(pending.id, pending.type, pending.payload, session));
    } catch {
      inflight.delete(pending.id);
      finish(pending, rpcError('CG-RUNTIME-UNREACHABLE', 'port closed'));
    }
  };

  const clearRegister = (): void => {
    if (registerTimer !== null) clearTimeout(registerTimer);
    registerTimer = null;
    registerId = null;
  };

  const dropPort = (): void => {
    clearRegister();
    const old = port;
    port = null;
    session = null;
    if (old) {
      try {
        old.disconnect();
      } catch {
        // already gone
      }
    }
  };

  /** The port is gone: end what was sent, then reconnect or give up. */
  function onLost(): void {
    if (state === 'closed' || state === 'reloaded') return;
    const wasSent = [...inflight.values()];
    inflight.clear();
    dropPort();
    if (!alive()) {
      endAll(wasSent, 'CG-RUNTIME-RELOADED', 'extension reloaded');
      endAll(waiting.splice(0), 'CG-RUNTIME-RELOADED', 'extension reloaded');
      setState('reloaded');
      return;
    }
    endAll(wasSent, 'CG-RUNTIME-UNREACHABLE', 'port lost');
    // A quiet try from `lost` failed: nothing changes, the next `reconnect()` asks again.
    if (state !== 'lost') scheduleRetry();
  }

  function scheduleRetry(): void {
    if (attempt >= delays.length) {
      endAll(waiting.splice(0), 'CG-RUNTIME-UNREACHABLE', 'background unreachable');
      setState('lost');
      return;
    }
    setState('reconnecting');
    const delay = delays[attempt] ?? 0;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function onMessage(raw: unknown): void {
    const parsed = TabEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return;
    const envelope = parsed.data;
    if (envelope.kind === 'evt') {
      const listeners = eventListeners.get(envelope.type);
      if (!listeners || listeners.size === 0) return;
      const checked = options.validate('evt', envelope.type, envelope.payload);
      if (!checked.ok) return;
      for (const listener of [...listeners]) listener(checked.payload);
      return;
    }
    if (envelope.kind !== 'res') return;
    if (envelope.id === registerId && envelope.type === 'tab.register') {
      clearRegister();
      const checked = envelope.ok ? options.validate('res', 'tab.register', envelope.payload) : { ok: false as const };
      const tabSessionId = checked.ok ? (checked.payload as { tabSessionId: string }).tabSessionId : null;
      if (tabSessionId === null) {
        onLost();
        return;
      }
      session = tabSessionId;
      attempt = 0;
      setState('ready');
      for (const pending of waiting.splice(0)) send(pending);
      return;
    }
    const pending = inflight.get(envelope.id);
    if (!pending || pending.type !== envelope.type) return;
    inflight.delete(envelope.id);
    if (!envelope.ok) {
      finish(pending, { ok: false, error: envelope.error });
      return;
    }
    const checked = options.validate('res', pending.type, envelope.payload);
    finish(pending, checked.ok ? { ok: true, payload: checked.payload } : rpcError('CG-UNKNOWN', `invalid ${pending.type} response`));
  }

  function connect(): void {
    if (state === 'closed' || state === 'reloaded') return;
    if (!alive()) {
      onLost();
      return;
    }
    let next: PortApi;
    try {
      next = api.runtime.connect({ name: TAB_PORT_NAME });
    } catch {
      onLost();
      return;
    }
    port = next;
    next.onMessage.addListener((message) => {
      if (port === next) onMessage(message);
    });
    next.onDisconnect.addListener(() => {
      if (port === next) onLost();
    });
    const id = nextId++;
    registerId = id;
    registerTimer = setTimeout(() => {
      if (port === next) onLost();
    }, registerTimeoutMs);
    try {
      next.postMessage(requestEnvelope(id, 'tab.register', options.register));
    } catch {
      if (port === next) onLost();
    }
  }

  connect();

  return {
    request(type, payload, requestOptions) {
      return new Promise((resolve) => {
        if (state === 'closed' || state === 'lost') {
          resolve(rpcError('CG-RUNTIME-UNREACHABLE', state));
          return;
        }
        if (state === 'reloaded') {
          resolve(rpcError('CG-RUNTIME-RELOADED', 'extension reloaded'));
          return;
        }
        const pending: Pending = { id: nextId++, type, payload, resolve: resolve as (result: RpcResult<unknown>) => void, timer: null };
        pending.timer = setTimeout(() => {
          inflight.delete(pending.id);
          const index = waiting.indexOf(pending);
          if (index >= 0) waiting.splice(index, 1);
          pending.timer = null;
          resolve(rpcError('CG-RUNTIME-UNREACHABLE', `${type} timeout`));
        }, requestOptions?.timeoutMs ?? requestTimeoutMs);
        if (state === 'ready') send(pending);
        else waiting.push(pending);
      });
    },
    onEvent(type, listener) {
      let set = eventListeners.get(type);
      if (!set) {
        set = new Set();
        eventListeners.set(type, set);
      }
      const wrapped = listener as (payload: unknown) => void;
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    state: () => state,
    tabSessionId: () => session,
    reconnect() {
      if (state !== 'lost' || port !== null) return;
      attempt = 0;
      connect();
    },
    close() {
      if (state === 'closed') return;
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      const sent = [...inflight.values()];
      inflight.clear();
      dropPort();
      endAll(sent, 'CG-RUNTIME-UNREACHABLE', 'closed');
      endAll(waiting.splice(0), 'CG-RUNTIME-UNREACHABLE', 'closed');
      setState('closed');
    },
  };
}
