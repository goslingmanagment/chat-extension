// Background side of the tab/pages ↔ background protocol (architecture.md
// §5.4, §14; EX-015, NF-027): one `cg-tab` port per site tab document,
// `runtime.sendMessage` requests from the extension pages, `cg-page` ports
// that only receive events and, 1.15.0 (R20 §8.5), `cg-relay` ports of a
// site's relay frames.
//
// - Listeners are registered synchronously inside createBackgroundRpc, so a
//   port or a message can wake the event page (§7 «Фон и выгрузка»); every
//   request then waits for the one readiness promise before it is handled.
// - The sender is checked before anything is parsed: same extension, top
//   frame, a ChatSpace origin (tabs) or one of our pages (pages), the type is
//   allowed for that sender kind, a tab registers only as the host kind its
//   origin belongs to (a ChatSpace tab cannot register as fansly-web), and
//   every tab request after `tab.register` carries the session the
//   background minted for exactly that port (§5.1: a tab cannot claim
//   another tab's session). A message failing these gets no answer and only
//   bumps a counter.
// - Payloads are checked with the frozen schemas in both directions; a
//   handler's own bug (an answer that fails its schema) is an error answer,
//   never a malformed one.
// - 1.15.0: a request type the shared registry does not know, from a tab or
//   a relay, belongs to its site's own registry (tab-messages-fansly.ts),
//   plugged by the site's background chunk (`site`). The core still checks
//   the sender, the tab session, the site — a tab or a relay reaches only its
//   own site's registry — and the envelope; the registry's rules, schemas and
//   handler do the rest, as for the shared one. Such a request waits for its
//   site to be plugged within `siteWaitMs`. R20 P14b1: a page reaches a site's
//   registry too, through `pageSite` — the core names the site of the type and
//   brings its module up while the site is on (off: CG-RUNTIME-UNREACHABLE at
//   once); the registry's rules decide which of its types a page may send.
// - A relay frame (`cg-relay`) is a subframe of a tab at the site's relay
//   page; it is accepted only inside a tab that holds a registered session of
//   that site, speaks for that session only, and goes when that tab's port
//   goes. It sends only types its registry allows from `relay`. Its site hears
//   once when it goes, either way (`SiteRpc.relayGone`, R20 P9c): what it was
//   asked and has not answered will not be answered.

import { TabEnvelopeSchema, type ExtensionPage, type TabRegisterRequest, type TabSender } from '@cg/contracts/tab-protocol';
import {
  TAB_EVENTS,
  isTabRequestType,
  mayRequest,
  parseTabPayload,
  type TabEventPayload,
  type TabEventType,
  type TabPayloadCheck,
  type TabRequestPayload,
  type TabRequestType,
  type TabResponsePayload,
} from '@cg/contracts/tab-messages';
import { PAGE_PORT_NAME, RELAY_PORT_NAME, TAB_PORT_NAME } from '@cg/contracts/tab-protocol';

import { defaultBrowser, type BrowserApi, type MessageSenderApi, type PortApi } from './browser-api';
import {
  RPC_REJECT_REASONS,
  eventEnvelope,
  responseEnvelope,
  rpcError,
  verifyPageSender,
  verifyRelaySender,
  verifyTabSender,
  type RelayPages,
  type RpcRejectReason,
  type RpcResult,
  type TabHostKind,
  type TabHostMatches,
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

/**
 * 1.15.0: who sent a request of a site's registry — a tab of the site, the relay frame of a tab session, or (R20
 * P14b1) one of our pages, routed to the site by `pageSite`.
 */
export type SiteSenderContext =
  | { readonly kind: 'tab'; readonly host: TabHostKind; readonly tabSessionId: string; readonly tabId: number; readonly url: string }
  | { readonly kind: 'relay'; readonly host: TabHostKind; readonly tabSessionId: string; readonly tabId: number; readonly frameId: number; readonly url: string }
  | { readonly kind: 'page'; readonly host: TabHostKind; readonly page: ExtensionPage; readonly tabId: number | null; readonly url: string };

/**
 * R20 P14b1: where a page's request of a type the shared registry does not know goes. `hostOf` — the site whose
 * registry the type belongs to (by its prefix), null — none: refused without an answer, as before; `open` — the site
 * is on and its module is being brought up for it (its registry is then waited for, `siteWaitMs`); false — it is off:
 * answered CG-RUNTIME-UNREACHABLE at once.
 */
export interface PageSiteRoute {
  hostOf(type: string): TabHostKind | null;
  open(host: TabHostKind): Promise<boolean>;
  /** Current permission/settings admission, checked synchronously immediately before dispatch. */
  active(host: TabHostKind): boolean;
}

/**
 * A site's own registry and its handler (1.15.0; R20 architecture §1.6, §3.3; contracts `tab-messages-fansly.ts`),
 * plugged by the site's background chunk. The core has checked the sender, its tab session, its site and the
 * envelope; the registry's sender rules, its schemas (both ways) and its handler are the site's.
 */
export interface SiteRpc {
  readonly host: TabHostKind;
  /** Every type of the registry starts with it (`fansly.`); no shared type does. */
  readonly prefix: string;
  isRequestType(type: string): boolean;
  /** The registry's sender rules (`senderAllowed` of its spec); `host` — the tab's or the relay's site, null for a page. */
  mayRequest(type: string, sender: TabSender, page: ExtensionPage | null, host: TabHostKind | null): boolean;
  parse(kind: 'req' | 'res' | 'evt', type: string, payload: unknown): TabPayloadCheck;
  /** Who an event of the registry goes to; null — not one of its events. */
  eventTargets(type: string): readonly TabSender[] | null;
  /** A shared CG code in a failure: a site's own failure travels in its payload (contracts errors-fansly.ts). */
  handle(type: string, payload: unknown, sender: SiteSenderContext): RpcResult<unknown> | Promise<RpcResult<unknown>>;
  /**
   * R20 P9c: a relay frame of the site is gone — its port closed, or the core closed it with its tab's document. What
   * the frame was asked and has not answered will not be answered. Called once per relay port.
   */
  relayGone?(sender: Extract<SiteSenderContext, { readonly kind: 'relay' }>): void;
}

export type TabRequestHandler<T extends HandledRequestType> = (
  payload: TabRequestPayload<T>,
  sender: RpcSenderContext,
) => RpcResult<TabResponsePayload<T>> | Promise<RpcResult<TabResponsePayload<T>>>;

export interface BackgroundRpcOptions {
  readonly api?: BrowserApi;
  /** Match patterns of the host pages per host kind (ChatSpace; plus the loopback stand, as ChatSpace, in test builds). */
  readonly tabHosts: TabHostMatches;
  /** 1.15.0: the relay page of each site that has one (`cg-relay`); none — no relay is accepted. */
  readonly relayPages?: RelayPages;
  /** 1.15.0: how long a tab's or relay's request of a site's registry waits for that site to be plugged (default 10 s). */
  readonly siteWaitMs?: number;
  /** R20 P14b1: a page's requests of a site's registry; absent — a page reaches no site registry. */
  readonly pageSite?: PageSiteRoute;
  /** The readiness barrier: no request is handled before it settles. */
  readonly ready: Promise<unknown>;
  readonly contractsVersion: string;
  readonly testBuild: boolean;
  readonly mintSessionId?: () => string;
  readonly now?: () => number;
  /**
   * Whether a site's tab may register now; false — the site is off in this browser, and the tab hears `CG-SITE-OFF`
   * (it lets go of the site). A promise: the answer may wait for a change of the site's access in flight.
   * A rejection means access is unknown: the tab hears CG-RUNTIME-UNREACHABLE and can reconnect.
   */
  readonly allowTab?: (host: TabHostKind) => boolean | Promise<boolean>;
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
  /** 1.15.0: plugs a site's registry (its chunk started); the answer unplugs it. One per site: a new one replaces the old. */
  site(registry: SiteRpc): () => void;
  /**
   * 1.15.0: an event of a site's registry, checked against it, to the receivers it names among that site's tabs,
   * their relay frames and the pages — or to one tab session (and its relay); answers how many got it.
   */
  emitSite(host: TabHostKind, type: string, payload: unknown, target?: { readonly tabSessionId: string }): number;
  tabs(): readonly TabSessionInfo[];
  /**
   * Lets go of a site's tabs: their ports close, as if the tabs went away. Each tab connects again at once, and
   * `allowTab` decides its new registration (the site went off: the tab hears `CG-SITE-OFF`).
   */
  dropTabs(host: TabHostKind): void;
  pagePorts(): number;
  counters(): Readonly<Record<RpcRejectReason, number>>;
  dispose(): void;
}

interface TabPortState {
  readonly port: PortApi;
  readonly host: TabHostKind;
  readonly tabId: number;
  readonly url: string;
  session: TabSessionInfo | null;
}

interface RelayPortState {
  readonly port: PortApi;
  readonly host: TabHostKind;
  readonly tabSessionId: string;
  /** What its requests carry to the site's handler. */
  readonly sender: Extract<SiteSenderContext, { readonly kind: 'relay' }>;
  /** The tab document it is framed in: it goes with it. */
  readonly owner: TabPortState;
}

/** Above the background's readiness deadline (10 s, core READINESS_DEADLINE_MS), as a tab waits for `tab.register`. */
export const DEFAULT_SITE_WAIT_MS = 10_000;

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
  const relayPorts = new Set<RelayPortState>();
  const sites = new Map<TabHostKind, SiteRpc>();
  const siteWaiters = new Map<TabHostKind, Set<() => void>>();
  const siteWaitMs = options.siteWaitMs ?? DEFAULT_SITE_WAIT_MS;
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
  /**
   * Payload in, handler, answer checked against its schema — for either registry (`parse`: the shared
   * parseTabPayload or a site's). An undefined handler: none is wired for the type.
   */
  async function run(
    type: string,
    parse: (kind: 'req' | 'res', type: string, payload: unknown) => TabPayloadCheck,
    handler: ((payload: unknown) => RpcResult<unknown> | Promise<RpcResult<unknown>>) | undefined,
    payload: unknown,
    kind: TabSender,
  ): Promise<RpcResult<unknown>> {
    const input = parse('req', type, payload);
    if (!input.ok) {
      reject('payload', type, kind);
      return rpcError('CG-UNKNOWN', `invalid ${type} request`);
    }
    if (!handler) {
      reject('handler', type, kind);
      return rpcError('CG-UNKNOWN', `no handler for ${type}`);
    }
    let result: RpcResult<unknown>;
    try {
      result = await handler(input.payload);
    } catch {
      reject('handler', type, kind);
      return rpcError('CG-UNKNOWN', `${type} handler failed`);
    }
    if (!result.ok) return result;
    const output = parse('res', type, result.payload);
    if (!output.ok) {
      reject('response', type, kind);
      return rpcError('CG-UNKNOWN', `invalid ${type} response`);
    }
    return { ok: true, payload: output.payload };
  }

  /** The readiness barrier before any request; false — it failed (answered CG-UNKNOWN). */
  async function ready(type: string, kind: TabSender): Promise<boolean> {
    if (await whenReady()) return true;
    reject('not-ready', type, kind);
    return false;
  }

  /** Validated dispatch of the shared registry. */
  async function dispatch(type: TabRequestType, payload: unknown, sender: RpcSenderContext): Promise<RpcResult<unknown>> {
    if (!(await ready(type, sender.kind))) return rpcError('CG-UNKNOWN', 'background not ready');
    const handler = handlers.get(type);
    return run(type, parseTabPayload, handler && ((input) => handler(input, sender)), payload, sender.kind);
  }

  /** An event to every receiver `to` names — of one site only when `host` is given — or to one tab session (and its relay). */
  function deliver(message: unknown, to: readonly TabSender[], host: TabHostKind | null, target?: { readonly tabSessionId: string }): number {
    let delivered = 0;
    const wanted = (portHost: TabHostKind, tabSessionId: string): boolean => (host === null || portHost === host) && (!target || tabSessionId === target.tabSessionId);
    if (includes(to, 'tab')) for (const state of tabPorts) if (state.session && wanted(state.host, state.session.tabSessionId) && post(state.port, message)) delivered += 1;
    if (includes(to, 'relay')) for (const relay of relayPorts) if (wanted(relay.host, relay.tabSessionId) && post(relay.port, message)) delivered += 1;
    if (includes(to, 'page') && !target) for (const port of pagePorts) if (post(port, message)) delivered += 1;
    return delivered;
  }

  /** null — refused without an answer (a host kind its origin does not belong to). */
  async function register(state: TabPortState, payload: unknown): Promise<RpcResult<unknown> | null> {
    if (!(await ready('tab.register', 'tab'))) return rpcError('CG-UNKNOWN', 'background not ready');
    const input = parseTabPayload('req', 'tab.register', payload);
    if (!input.ok) {
      reject('payload', 'tab.register', 'tab');
      return rpcError('CG-UNKNOWN', 'invalid tab.register request');
    }
    if ((input.payload as TabRegisterRequest).host !== state.host) {
      reject('origin', 'tab.register', 'tab');
      return null;
    }
    try {
      if ((await options.allowTab?.(state.host)) === false) return rpcError('CG-SITE-OFF', 'site disabled');
    } catch {
      return rpcError('CG-RUNTIME-UNREACHABLE', 'site access unavailable');
    }
    if (!tabPorts.has(state)) return rpcError('CG-RUNTIME-UNREACHABLE', 'port closed');
    // One session per port: a repeated register answers the same session.
    if (!state.session) {
      state.session = { tabSessionId: mint(), tabId: state.tabId, url: state.url, registeredAt: now(), request: input.payload as TabRegisterRequest };
      options.onTabRegistered?.(state.session);
    }
    return { ok: true, payload: { tabSessionId: state.session.tabSessionId, contractsVersion: options.contractsVersion, testBuild: options.testBuild } };
  }

  /** The plugged registry of a site, waiting for its chunk to plug it (`siteWaitMs`); null — none came. */
  function siteOf(host: TabHostKind): Promise<SiteRpc | null> {
    const plugged = sites.get(host);
    if (plugged) return Promise.resolve(plugged);
    return new Promise((resolve) => {
      const waiting = siteWaiters.get(host) ?? new Set<() => void>();
      siteWaiters.set(host, waiting);
      const done = (): void => {
        clearTimeout(timer);
        waiting.delete(done);
        resolve(sites.get(host) ?? null);
      };
      const timer = setTimeout(done, siteWaitMs);
      waiting.add(done);
    });
  }

  /** A relay port is gone (its frame closed it, or the core did with its tab's document): its site hears it once. */
  function relayGone(relay: RelayPortState): void {
    if (!relayPorts.delete(relay)) return;
    try {
      sites.get(relay.host)?.relayGone?.(relay.sender);
    } catch {
      reject('handler', null, 'relay');
    }
  }

  /** A request of the sender's site's registry (a tab or a relay). null — refused without an answer (unknown type, wrong sender), as for the shared registry. */
  async function dispatchSite(type: string, payload: unknown, sender: SiteSenderContext): Promise<RpcResult<unknown> | null> {
    if (!(await ready(type, sender.kind))) return rpcError('CG-UNKNOWN', 'background not ready');
    const site = await siteOf(sender.host);
    if (site === null || !type.startsWith(site.prefix) || !site.isRequestType(type)) {
      reject('unknown-type', type, sender.kind);
      return null;
    }
    if (!site.mayRequest(type, sender.kind, null, sender.host)) {
      reject('sender-kind', type, sender.kind);
      return null;
    }
    return run(type, (kind, t, p) => site.parse(kind, t, p), (input) => site.handle(type, input, sender), payload, sender.kind);
  }

  /**
   * R20 P14b1: a page's request of a site's registry. The site is opened first (its module comes up while the site is
   * on); null — refused without an answer (a type the registry does not have, or not a page's), as for the shared one.
   */
  async function dispatchPageSite(type: string, payload: unknown, sender: Extract<SiteSenderContext, { kind: 'page' }>, route: PageSiteRoute): Promise<RpcResult<unknown> | null> {
    if (!(await ready(type, 'page'))) return rpcError('CG-UNKNOWN', 'background not ready');
    if (!(await route.open(sender.host).catch(() => false))) return rpcError('CG-RUNTIME-UNREACHABLE', 'site off');
    const site = await siteOf(sender.host);
    if (site === null) return rpcError('CG-RUNTIME-UNREACHABLE', 'site not running');
    if (!type.startsWith(site.prefix) || !site.isRequestType(type)) {
      reject('unknown-type', type, 'page');
      return null;
    }
    if (!site.mayRequest(type, 'page', sender.page, null)) {
      reject('sender-kind', type, 'page');
      return null;
    }
    if (!route.active(sender.host)) return rpcError('CG-RUNTIME-UNREACHABLE', 'site off');
    return run(type, (kind, t, p) => site.parse(kind, t, p), (input) => site.handle(type, input, sender), payload, 'page');
  }

  function onRelayMessage(state: RelayPortState, raw: unknown): void {
    const envelope = TabEnvelopeSchema.safeParse(raw);
    // A relay speaks for the tab session it is framed in: it carries none of its own.
    if (!envelope.success || envelope.data.kind !== 'req' || envelope.data.tabSessionId !== undefined) {
      reject('envelope', null, 'relay');
      return;
    }
    const { id, type, payload } = envelope.data;
    if (!tabPorts.has(state.owner) || state.owner.session?.tabSessionId !== state.tabSessionId) {
      reject('session', type, 'relay');
      return;
    }
    // The shared registry has nothing a relay may send.
    if (isTabRequestType(type)) {
      reject('sender-kind', type, 'relay');
      return;
    }
    void dispatchSite(type, payload, state.sender).then((result) => {
      if (result !== null && relayPorts.has(state)) post(state.port, responseEnvelope(id, type, result));
    });
  }

  function onTabMessage(state: TabPortState, raw: unknown): void {
    const envelope = TabEnvelopeSchema.safeParse(raw);
    if (!envelope.success || envelope.data.kind !== 'req') {
      reject('envelope', null, 'tab');
      return;
    }
    const { id, type, payload, tabSessionId } = envelope.data;
    if (!isTabRequestType(type)) {
      // 1.15.0: a type of the tab's own site, after the session check every request but `tab.register` passes.
      const session = state.session;
      if (!session || tabSessionId !== session.tabSessionId || session.tabId !== state.tabId) {
        // A type no plugged site knows reads as unknown, as before sites had registries.
        reject([...sites.values()].some((site) => site.isRequestType(type)) ? 'session' : 'unknown-type', type, 'tab');
        return;
      }
      const sender: SiteSenderContext = { kind: 'tab', host: state.host, tabSessionId: session.tabSessionId, tabId: state.tabId, url: state.url };
      void dispatchSite(type, payload, sender).then((result) => {
        if (result !== null && tabPorts.has(state)) post(state.port, responseEnvelope(id, type, result));
      });
      return;
    }
    if (!mayRequest(type, 'tab', null, state.host)) {
      reject('sender-kind', type, 'tab');
      return;
    }
    let work: Promise<RpcResult<unknown> | null>;
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
      if (result !== null && tabPorts.has(state)) post(state.port, responseEnvelope(id, type, result));
    });
  }

  /** A tab's document is gone (its port closed): its relay frames go with it, and the background hears of it. */
  function tabGone(state: TabPortState): void {
    if (!tabPorts.delete(state)) return;
    // Its relay frames belong to this document: they go with it (a port closed on this side hears no onDisconnect).
    for (const relay of [...relayPorts]) {
      if (relay.owner !== state) continue;
      relay.port.disconnect();
      relayGone(relay);
    }
    if (state.session) options.onTabGone?.(state.session);
  }

  const onConnect = (port: PortApi): void => {
    if (disposed) return;
    if (port.name === TAB_PORT_NAME) {
      const verdict = verifyTabSender(port.sender, runtimeId, options.tabHosts);
      if (!verdict.ok || verdict.kind !== 'tab') {
        reject(verdict.ok ? 'origin' : verdict.reason, null, 'tab');
        port.disconnect();
        return;
      }
      const state: TabPortState = { port, host: verdict.host, tabId: verdict.tabId, url: verdict.url, session: null };
      tabPorts.add(state);
      port.onMessage.addListener((message) => onTabMessage(state, message));
      port.onDisconnect.addListener(() => tabGone(state));
      return;
    }
    if (port.name === RELAY_PORT_NAME) {
      const verdict = verifyRelaySender(port.sender, runtimeId, ownBase, options.relayPages ?? {});
      if (!verdict.ok || verdict.kind !== 'relay') {
        reject(verdict.ok ? 'not-a-relay' : verdict.reason, null, 'relay');
        port.disconnect();
        return;
      }
      // The newest registered document of that tab, of that site: the relay speaks for its session only.
      const owner = [...tabPorts].filter((tab) => tab.tabId === verdict.tabId && tab.host === verdict.host && tab.session !== null).at(-1);
      const tabSessionId = owner?.session?.tabSessionId;
      if (owner === undefined || tabSessionId === undefined) {
        reject('not-a-relay', null, 'relay');
        port.disconnect();
        return;
      }
      const { host, tabId, frameId, url } = verdict;
      const state: RelayPortState = { port, host, tabSessionId, owner, sender: { kind: 'relay', host, tabSessionId, tabId, frameId, url } };
      relayPorts.add(state);
      port.onMessage.addListener((message) => onRelayMessage(state, message));
      port.onDisconnect.addListener(() => relayGone(state));
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
    // A type of a site's registry (R20 P14b1): its site, while it is on; without a route or a site — unknown, as before.
    if (!isTabRequestType(type)) {
      const host = options.pageSite?.hostOf(type) ?? null;
      if (options.pageSite === undefined || host === null) {
        reject('unknown-type', type, 'page');
        return undefined;
      }
      const sender: Extract<SiteSenderContext, { kind: 'page' }> = { kind: 'page', host, page: verdict.page, tabId: verdict.tabId, url: verdict.url };
      return dispatchPageSite(type, payload, sender, options.pageSite).then((result) => (result === null ? undefined : responseEnvelope(id, type, result)));
    }
    if (type === 'tab.register' || !mayRequest(type, 'page', verdict.page, null)) {
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
      return deliver(eventEnvelope(type, checked.payload), TAB_EVENTS[type].to, null, target);
    },
    site(registry) {
      sites.set(registry.host, registry);
      for (const done of [...(siteWaiters.get(registry.host) ?? [])]) done();
      return () => {
        if (sites.get(registry.host) === registry) sites.delete(registry.host);
      };
    },
    emitSite(host, type, payload, target) {
      const site = sites.get(host);
      const to = site?.eventTargets(type) ?? null;
      const checked = site !== undefined && to !== null ? site.parse('evt', type, payload) : { ok: false as const };
      if (to === null || !checked.ok) {
        reject('response', type, 'unknown');
        return 0;
      }
      return deliver(eventEnvelope(type, checked.payload), to, host, target);
    },
    tabs() {
      return [...tabPorts].flatMap((state) => (state.session ? [state.session] : []));
    },
    dropTabs(host) {
      for (const state of [...tabPorts]) {
        if (state.host !== host) continue;
        // A port closed on this side hears no onDisconnect: the tab is let go here.
        try {
          state.port.disconnect();
        } catch {
          // already gone
        }
        tabGone(state);
      }
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
      for (const relay of relayPorts) relay.port.disconnect();
      for (const state of tabPorts) state.port.disconnect();
      for (const port of pagePorts) port.disconnect();
      relayPorts.clear();
      tabPorts.clear();
      pagePorts.clear();
      sites.clear();
      for (const waiting of siteWaiters.values()) for (const done of [...waiting]) done();
      siteWaiters.clear();
    },
  };
}
