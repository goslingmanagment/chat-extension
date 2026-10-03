// Background side of the tab/pages ↔ background protocol (architecture.md
// §5.4, §14; EX-015, NF-027): one `cg-tab` port per ChatSpace tab document,
// `runtime.sendMessage` requests from the extension pages and `cg-page` ports
// that only receive events.
//
// - Listeners are registered synchronously inside createBackgroundRpc, so a
//   port or a message can wake the event page (§7 «Фон и выгрузка»); every
//   request then waits for the one readiness promise before it is handled.
// - The sender is checked before anything is parsed: same extension, top
//   frame, a ChatSpace origin (tabs) or one of our pages (pages), the type is
//   allowed for that sender kind, and every tab request after `tab.register`
//   carries the session the background minted for exactly that port
//   (§5.1: a tab cannot claim another tab's session). A message failing
//   these gets no answer and only bumps a counter.
// - Payloads are checked with the frozen schemas in both directions; a
//   handler's own bug (an answer that fails its schema) is an error answer,
//   never a malformed one.

import { TabEnvelopeSchema, type ExtensionPage, type TabRegisterRequest, type TabSender } from '@cg/contracts/tab-protocol';
import {
  TAB_EVENTS,
  isTabRequestType,
  mayRequest,
  parseTabPayload,
  type TabEventPayload,
  type TabEventType,
  type TabRequestPayload,
  type TabRequestType,
  type TabResponsePayload,
} from '@cg/contracts/tab-messages';
import { PAGE_PORT_NAME, TAB_PORT_NAME } from '@cg/contracts/tab-protocol';

import { defaultBrowser, type BrowserApi, type MessageSenderApi, type PortApi } from './browser-api';
import {
  RPC_REJECT_REASONS,
  eventEnvelope,
  responseEnvelope,
  rpcError,
  verifyPageSender,
  verifyTabSender,
  type RpcRejectReason,
  type RpcResult,
} from './rpc-common';

export interface TabSessionInfo {
  readonly tabSessionId: string;
  readonly tabId: number;
  readonly url: string;
  readonly registeredAt: number;
  readonly request: TabRegisterRequest;
}

export type RpcSenderContext =
  | { readonly kind: 'tab'; readonly tabSessionId: string; readonly tabId: number; readonly url: string }
  | { readonly kind: 'page'; readonly page: ExtensionPage; readonly tabId: number | null; readonly url: string };

export type HandledRequestType = Exclude<TabRequestType, 'tab.register'>;

export type TabRequestHandler<T extends HandledRequestType> = (
  payload: TabRequestPayload<T>,
  sender: RpcSenderContext,
) => RpcResult<TabResponsePayload<T>> | Promise<RpcResult<TabResponsePayload<T>>>;

export interface BackgroundRpcOptions {
  readonly api?: BrowserApi;
  /** Match patterns of the host pages (ChatSpace; plus the loopback stand in test builds). */
  readonly tabMatches: readonly string[];
  /** The readiness barrier: no request is handled before it settles. */
  readonly ready: Promise<unknown>;
  readonly contractsVersion: string;
  readonly testBuild: boolean;
  readonly mintSessionId?: () => string;
  readonly now?: () => number;
  readonly onTabRegistered?: (info: TabSessionInfo) => void;
  readonly onTabGone?: (info: TabSessionInfo) => void;
  /** A refused message: the reason and the type only, never the payload. */
  readonly onReject?: (reason: RpcRejectReason, facts: { readonly type: string | null; readonly sender: TabSender | 'unknown' }) => void;
}

export interface BackgroundRpc {
  /** Wires a handler; may happen after creation, before the readiness promise settles. */
  handle<T extends HandledRequestType>(type: T, handler: TabRequestHandler<T>): void;
  /** Sends an event to every receiver its spec allows (or one tab session); answers how many got it. */
  emit<T extends TabEventType>(type: T, payload: TabEventPayload<T>, target?: { readonly tabSessionId: string }): number;
  tabs(): readonly TabSessionInfo[];
  pagePorts(): number;
  counters(): Readonly<Record<RpcRejectReason, number>>;
  dispose(): void;
}

interface TabPortState {
  readonly port: PortApi;
  readonly tabId: number;
  readonly url: string;
  session: TabSessionInfo | null;
}

type AnyHandler = (payload: unknown, sender: RpcSenderContext) => RpcResult<unknown> | Promise<RpcResult<unknown>>;

const includes = (list: readonly TabSender[], sender: TabSender): boolean => list.includes(sender);

export function createBackgroundRpc(options: BackgroundRpcOptions): BackgroundRpc {
  const api = options.api ?? defaultBrowser();
  const runtimeId = api.runtime.id;
  const ownBase = api.runtime.getURL('');
  const mint = options.mintSessionId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? (() => Date.now());
  const handlers = new Map<string, AnyHandler>();
  const tabPorts = new Set<TabPortState>();
  const pagePorts = new Set<PortApi>();
  const counters = Object.fromEntries(RPC_REJECT_REASONS.map((reason) => [reason, 0])) as Record<RpcRejectReason, number>;
  let readyOk: Promise<boolean> | null = null;
  let disposed = false;

  const reject = (reason: RpcRejectReason, type: string | null, sender: TabSender | 'unknown'): void => {
    counters[reason] += 1;
    options.onReject?.(reason, { type, sender });
  };

  const whenReady = (): Promise<boolean> =>
    (readyOk ??= options.ready.then(
      () => true,
      () => false,
    ));

  const post = (port: PortApi, message: unknown): boolean => {
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };

  /** Validated dispatch: payload in, handler, answer checked against its schema. */
  async function dispatch(type: TabRequestType, payload: unknown, sender: RpcSenderContext): Promise<RpcResult<unknown>> {
    if (!(await whenReady())) {
      reject('not-ready', type, sender.kind);
      return rpcError('CG-UNKNOWN', 'background not ready');
    }
    const input = parseTabPayload('req', type, payload);
    if (!input.ok) {
      reject('payload', type, sender.kind);
      return rpcError('CG-UNKNOWN', `invalid ${type} request`);
    }
    const handler = handlers.get(type);
    if (!handler) {
      reject('handler', type, sender.kind);
      return rpcError('CG-UNKNOWN', `no handler for ${type}`);
    }
    let result: RpcResult<unknown>;
    try {
      result = await handler(input.payload, sender);
    } catch {
      reject('handler', type, sender.kind);
      return rpcError('CG-UNKNOWN', `${type} handler failed`);
    }
    if (!result.ok) return result;
    const output = parseTabPayload('res', type, result.payload);
    if (!output.ok) {
      reject('response', type, sender.kind);
      return rpcError('CG-UNKNOWN', `invalid ${type} response`);
    }
    return { ok: true, payload: output.payload };
  }

  async function register(state: TabPortState, payload: unknown): Promise<RpcResult<unknown>> {
    if (!(await whenReady())) {
      reject('not-ready', 'tab.register', 'tab');
      return rpcError('CG-UNKNOWN', 'background not ready');
    }
    const input = parseTabPayload('req', 'tab.register', payload);
    if (!input.ok) {
      reject('payload', 'tab.register', 'tab');
      return rpcError('CG-UNKNOWN', 'invalid tab.register request');
    }
    if (!tabPorts.has(state)) return rpcError('CG-RUNTIME-UNREACHABLE', 'port closed');
    // One session per port: a repeated register answers the same session.
    if (!state.session) {
      state.session = { tabSessionId: mint(), tabId: state.tabId, url: state.url, registeredAt: now(), request: input.payload as TabRegisterRequest };
      options.onTabRegistered?.(state.session);
    }
    return { ok: true, payload: { tabSessionId: state.session.tabSessionId, contractsVersion: options.contractsVersion, testBuild: options.testBuild } };
  }

  function onTabMessage(state: TabPortState, raw: unknown): void {
    const envelope = TabEnvelopeSchema.safeParse(raw);
    if (!envelope.success || envelope.data.kind !== 'req') {
      reject('envelope', null, 'tab');
      return;
    }
    const { id, type, payload, tabSessionId } = envelope.data;
    if (!isTabRequestType(type)) {
      reject('unknown-type', type, 'tab');
      return;
    }
    if (!mayRequest(type, 'tab', null)) {
      reject('sender-kind', type, 'tab');
      return;
    }
    let work: Promise<RpcResult<unknown>>;
    if (type === 'tab.register') {
      if (tabSessionId !== undefined) {
        reject('session', type, 'tab');
        return;
      }
      work = register(state, payload);
    } else {
      const session = state.session;
      if (!session || tabSessionId !== session.tabSessionId || session.tabId !== state.tabId) {
        reject('session', type, 'tab');
        return;
      }
      work = dispatch(type, payload, { kind: 'tab', tabSessionId: session.tabSessionId, tabId: state.tabId, url: state.url });
    }
    void work.then((result) => {
      if (tabPorts.has(state)) post(state.port, responseEnvelope(id, type, result));
    });
  }

  const onConnect = (port: PortApi): void => {
    if (disposed) return;
    if (port.name === TAB_PORT_NAME) {
      const verdict = verifyTabSender(port.sender, runtimeId, options.tabMatches);
      if (!verdict.ok || verdict.kind !== 'tab') {
        reject(verdict.ok ? 'origin' : verdict.reason, null, 'tab');
        port.disconnect();
        return;
      }
      const state: TabPortState = { port, tabId: verdict.tabId, url: verdict.url, session: null };
      tabPorts.add(state);
      port.onMessage.addListener((message) => onTabMessage(state, message));
      port.onDisconnect.addListener(() => {
        tabPorts.delete(state);
        if (state.session) options.onTabGone?.(state.session);
      });
      return;
    }
    if (port.name === PAGE_PORT_NAME) {
      const verdict = verifyPageSender(port.sender, runtimeId, ownBase);
      if (!verdict.ok) {
        reject(verdict.reason, null, 'page');
        port.disconnect();
        return;
      }
      pagePorts.add(port);
      // A page port carries events only; requests go through sendMessage.
      port.onMessage.addListener(() => reject('envelope', null, 'page'));
      port.onDisconnect.addListener(() => pagePorts.delete(port));
    }
  };

  const onMessage = (raw: unknown, sender: MessageSenderApi): Promise<unknown> | undefined => {
    if (disposed) return undefined;
    const verdict = verifyPageSender(sender, runtimeId, ownBase);
    if (!verdict.ok || verdict.kind !== 'page') {
      reject(verdict.ok ? 'not-a-page' : verdict.reason, null, 'unknown');
      return undefined;
    }
    const envelope = TabEnvelopeSchema.safeParse(raw);
    if (!envelope.success || envelope.data.kind !== 'req' || envelope.data.tabSessionId !== undefined) {
      reject('envelope', null, 'page');
      return undefined;
    }
    const { id, type, payload } = envelope.data;
    if (!isTabRequestType(type)) {
      reject('unknown-type', type, 'page');
      return undefined;
    }
    if (type === 'tab.register' || !mayRequest(type, 'page', verdict.page)) {
      reject('sender-kind', type, 'page');
      return undefined;
    }
    const context: RpcSenderContext = { kind: 'page', page: verdict.page, tabId: verdict.tabId, url: verdict.url };
    return dispatch(type, payload, context).then((result) => responseEnvelope(id, type, result));
  };

  // Synchronously, before anything else: an incoming port or message wakes the event page.
  api.runtime.onConnect.addListener(onConnect);
  api.runtime.onMessage.addListener(onMessage);

  return {
    handle(type, handler) {
      handlers.set(type, handler as unknown as AnyHandler);
    },
    emit(type, payload, target) {
      const checked = parseTabPayload('evt', type, payload);
      if (!checked.ok) {
        reject('response', type, 'unknown');
        return 0;
      }
      const to: readonly TabSender[] = TAB_EVENTS[type].to;
      const message = eventEnvelope(type, checked.payload);
      let delivered = 0;
      if (includes(to, 'tab')) {
        for (const state of tabPorts) {
          if (!state.session) continue;
          if (target && state.session.tabSessionId !== target.tabSessionId) continue;
          if (post(state.port, message)) delivered += 1;
        }
      }
      if (includes(to, 'page') && !target) {
        for (const port of pagePorts) if (post(port, message)) delivered += 1;
      }
      return delivered;
    },
    tabs() {
      return [...tabPorts].flatMap((state) => (state.session ? [state.session] : []));
    },
    pagePorts() {
      return pagePorts.size;
    },
    counters() {
      return { ...counters };
    },
    dispose() {
      disposed = true;
      api.runtime.onConnect.removeListener(onConnect);
      api.runtime.onMessage.removeListener(onMessage);
      for (const state of tabPorts) state.port.disconnect();
      for (const port of pagePorts) port.disconnect();
      tabPorts.clear();
      pagePorts.clear();
    },
  };
}
