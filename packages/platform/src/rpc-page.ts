// Extension-page side of the protocol (architecture.md §5.4, §9.9; EX-015):
// requests through `runtime.sendMessage` (the answer is the reply), events
// through a `cg-page` port opened on the first subscription. A background
// that does not answer is CG-RUNTIME-UNREACHABLE (the popup's card instead
// of an endless spinner, PU-*); nothing is resent by itself.
//
// The event port and the event page's idle unload (§7 «Фон и выгрузка»).
// Firefox unloads the background after its idle timeout, and an open port
// does not hold it: the port of an open page is then disconnected. Opening
// it again at once would start the background again — which unloads again
// after the next timeout: a settings tab left open without any ChatSpace tab
// restarted the event page once per idle timeout for as long as it stayed
// open (about 2,900 starts a day at Firefox's 30 s), each start writing its
// records into the log. So a port that lived and was dropped is PARKED: no
// timer opens it. It is opened again with the page's next word to the
// background — a request (which wakes the background anyway), a new
// subscription, or `resume()` when the page comes back on screen. A sleeping
// background emits nothing, so nothing is missed while it sleeps; what
// another page or tab changed while this one was parked is read by the
// page's controller when the port is open again (`onEventsState`).

import { PAGE_PORT_NAME, TabEnvelopeSchema } from '@cg/contracts/tab-protocol';
import type { TabEventPayload, TabEventType, TabRequestPayload, TabResponsePayload } from '@cg/contracts/tab-messages';

import { defaultBrowser, type BrowserApi, type PortApi } from './browser-api';
import { RECONNECT_DELAYS_MS, requestEnvelope, rpcError, type RpcResult, type TabPayloadValidator } from './rpc-common';
import type { TabClientRequestType } from './rpc-tab';

export interface PageRpcClientOptions {
  readonly api?: BrowserApi;
  readonly validate: TabPayloadValidator;
  readonly requestTimeoutMs?: number;
  readonly reconnectDelaysMs?: readonly number[];
}

/** `parked` — the port lived and the background went away (its idle unload): it waits for the page's next word. */
export type PageEventsState = 'idle' | 'open' | 'reconnecting' | 'parked' | 'lost' | 'closed';

export interface PageRpcClient {
  request<T extends TabClientRequestType>(
    type: T,
    payload: TabRequestPayload<T>,
    options?: { readonly timeoutMs?: number },
  ): Promise<RpcResult<TabResponsePayload<T>>>;
  onEvent<T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): () => void;
  onEventsState(listener: (state: PageEventsState) => void): () => void;
  /** The page is on screen or in focus again: a parked event port is opened. Anything else — nothing. */
  resume(): void;
  close(): void;
}

export const DEFAULT_PAGE_REQUEST_TIMEOUT_MS = 30_000;
/** A page port open at least this long counts as a working connection. */
const STABLE_PORT_MS = 1000;

export function createPageRpcClient(options: PageRpcClientOptions): PageRpcClient {
  const api = options.api ?? defaultBrowser();
  const delays = options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_PAGE_REQUEST_TIMEOUT_MS;
  let nextId = 1;
  let port: PortApi | null = null;
  let eventsState: PageEventsState = 'idle';
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  const stateListeners = new Set<(state: PageEventsState) => void>();

  const setEventsState = (next: PageEventsState): void => {
    if (next === eventsState) return;
    eventsState = next;
    for (const listener of [...stateListeners]) listener(next);
  };

  function onEventMessage(raw: unknown): void {
    const parsed = TabEnvelopeSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== 'evt') return;
    const listeners = eventListeners.get(parsed.data.type);
    if (!listeners || listeners.size === 0) return;
    const checked = options.validate('evt', parsed.data.type, parsed.data.payload);
    if (!checked.ok) return;
    for (const listener of [...listeners]) listener(checked.payload);
  }

  function openEvents(): void {
    if (eventsState === 'closed' || port) return;
    let next: PortApi;
    try {
      next = api.runtime.connect({ name: PAGE_PORT_NAME });
    } catch {
      scheduleRetry();
      return;
    }
    port = next;
    const openedAt = Date.now();
    setEventsState('open');
    next.onMessage.addListener((message) => {
      if (port === next) onEventMessage(message);
    });
    next.onDisconnect.addListener(() => {
      if (port !== next) return;
      port = null;
      // A port that lived is a background that came and went — an event page after its idle timeout. It is not
      // woken for the port's sake: the port waits for the page's next word (see the head of this file).
      if (Date.now() - openedAt >= STABLE_PORT_MS) {
        attempt = 0;
        setEventsState('parked');
        return;
      }
      scheduleRetry();
    });
  }

  /** A parked port is opened again: the page talks to the background, or is back on screen. */
  const unpark = (): void => {
    if (eventsState === 'parked') openEvents();
  };

  function scheduleRetry(): void {
    if (eventsState === 'closed') return;
    if (attempt >= delays.length) {
      setEventsState('lost');
      return;
    }
    setEventsState('reconnecting');
    const delay = delays[attempt] ?? 0;
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      openEvents();
    }, delay);
  }

  return {
    async request(type, payload, requestOptions) {
      if (eventsState === 'closed') return rpcError('CG-RUNTIME-UNREACHABLE', 'closed');
      // The request wakes the background anyway: the events it may cause are heard.
      unpark();
      const id = nextId++;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), requestOptions?.timeoutMs ?? timeoutMs);
      });
      let raw: unknown;
      try {
        raw = await Promise.race([api.runtime.sendMessage(requestEnvelope(id, type, payload)), timeout]);
      } catch {
        return rpcError('CG-RUNTIME-UNREACHABLE', `${type} not delivered`);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
      if (raw === 'timeout') return rpcError('CG-RUNTIME-UNREACHABLE', `${type} timeout`);
      const parsed = TabEnvelopeSchema.safeParse(raw);
      if (!parsed.success || parsed.data.kind !== 'res' || parsed.data.id !== id || parsed.data.type !== type) {
        return rpcError('CG-RUNTIME-UNREACHABLE', `${type} unanswered`);
      }
      if (!parsed.data.ok) return { ok: false, error: parsed.data.error };
      const checked = options.validate('res', type, parsed.data.payload);
      return checked.ok ? { ok: true, payload: checked.payload as TabResponsePayload<typeof type> } : rpcError('CG-UNKNOWN', `invalid ${type} response`);
    },
    onEvent(type, listener) {
      let set = eventListeners.get(type);
      if (!set) {
        set = new Set();
        eventListeners.set(type, set);
      }
      const wrapped = listener as (payload: unknown) => void;
      set.add(wrapped);
      if (eventsState === 'lost') attempt = 0;
      if (eventsState === 'idle' || eventsState === 'lost' || eventsState === 'parked') openEvents();
      return () => set.delete(wrapped);
    },
    onEventsState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    resume: unpark,
    close() {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      const old = port;
      port = null;
      setEventsState('closed');
      if (old) {
        try {
          old.disconnect();
        } catch {
          // already gone
        }
      }
    },
  };
}
