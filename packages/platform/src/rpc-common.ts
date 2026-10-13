// Shared pieces of the tab/pages ↔ background RPC (architecture.md §5.4,
// §14; R20 architecture §8.5): the result type, sender checks (tabs, pages
// and, 1.15.0, a site's relay frame) and envelope builders. Light: only the
// light contract module (tab-protocol) and types, so the early isolated
// bundle can carry the tab client.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import { EXTENSION_PAGES, TAB_PROTOCOL_VERSION, type ExtensionPage, type TabRegisterRequest } from '@cg/contracts/tab-protocol';
import type { TabPayloadCheck } from '@cg/contracts/tab-messages';

import type { MessageSenderApi } from './browser-api';

/** An answer of the background: the response payload, or a CG error as code and facts. */
export type RpcResult<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: CgErrorWire };

/**
 * Second-stage payload check by type (`parseTabPayload` of
 * @cg/contracts/tab-messages). Injected so the early tab bundle decides when
 * to load the request registry.
 */
export type TabPayloadValidator = (kind: 'req' | 'res' | 'evt', type: string, payload: unknown) => TabPayloadCheck;

export const rpcError = (code: CgCode, detail?: string): { readonly ok: false; readonly error: CgErrorWire } => ({
  ok: false,
  error: detail === undefined ? { code } : { code, detail },
});

export const requestEnvelope = (id: number, type: string, payload: unknown, tabSessionId?: string): Record<string, unknown> =>
  tabSessionId === undefined
    ? { v: TAB_PROTOCOL_VERSION, kind: 'req', id, type, payload }
    : { v: TAB_PROTOCOL_VERSION, kind: 'req', id, type, tabSessionId, payload };

export const responseEnvelope = (id: number, type: string, result: RpcResult<unknown>): Record<string, unknown> =>
  result.ok
    ? { v: TAB_PROTOCOL_VERSION, kind: 'res', id, type, ok: true, payload: result.payload }
    : { v: TAB_PROTOCOL_VERSION, kind: 'res', id, type, ok: false, error: result.error };

export const eventEnvelope = (type: string, payload: unknown): Record<string, unknown> => ({ v: TAB_PROTOCOL_VERSION, kind: 'evt', type, payload });

/** Delays of the reconnect attempts after a lost port (RB-010: 100/200/400 ms). */
export const RECONNECT_DELAYS_MS: readonly number[] = [100, 200, 400];

/**
 * A WebExtension match pattern of the `scheme://host/path` form, as in the
 * manifest (`https://chat.example/*`, `http://127.0.0.1/*`, `*.example`):
 * the host has no port, so any port of that host matches.
 */
export function urlMatchesPattern(url: URL, pattern: string): boolean {
  const parsed = /^(\*|https?|wss?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(pattern);
  if (!parsed) return false;
  const [, scheme = '', host = '', path = ''] = parsed;
  const urlScheme = url.protocol.slice(0, -1);
  if (scheme === '*' ? urlScheme !== 'http' && urlScheme !== 'https' : urlScheme !== scheme) return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2).toLowerCase();
      const hostname = url.hostname.toLowerCase();
      if (hostname !== base && !hostname.endsWith(`.${base}`)) return false;
    } else if (url.hostname.toLowerCase() !== host.toLowerCase()) return false;
  }
  const pathPattern = path.endsWith('*') ? path.slice(0, -1) : path;
  const urlPath = url.pathname + url.search;
  return path.endsWith('*') ? urlPath.startsWith(pathPattern) : urlPath === pathPattern;
}

/** The host kinds a tab registers as (`tab.register` `host`). */
export type TabHostKind = TabRegisterRequest['host'];

/** Match patterns per host kind (ChatSpace; the loopback stand counts as ChatSpace in test builds). */
export type TabHostMatches = Readonly<Partial<Record<TabHostKind, readonly string[]>>>;

/**
 * 1.15.0: the relay page of a site, per host kind (`fansly-relay.html`: a file at the extension's own base). A site
 * without one has no relay; the composition root takes it from the host table.
 */
export type RelayPages = Readonly<Partial<Record<TabHostKind, string>>>;

export type SenderVerdict =
  | { readonly ok: true; readonly kind: 'tab'; readonly host: TabHostKind; readonly tabId: number; readonly url: string }
  | { readonly ok: true; readonly kind: 'page'; readonly page: ExtensionPage; readonly tabId: number | null; readonly url: string }
  /** 1.15.0: a site's relay frame in tab `tabId`; whether that tab holds a session of `host` is the background's own check. */
  | { readonly ok: true; readonly kind: 'relay'; readonly host: TabHostKind; readonly tabId: number; readonly frameId: number; readonly url: string }
  | { readonly ok: false; readonly reason: RpcRejectReason };

/** Why a message got no answer (counters for diagnostics; never the payload). */
export const RPC_REJECT_REASONS = [
  'foreign-extension',
  'subframe',
  'origin',
  'not-a-page',
  /** 1.15.0: not a relay frame of a site, or no registered tab of that site holds it. */
  'not-a-relay',
  'envelope',
  'unknown-type',
  'sender-kind',
  'session',
  'payload',
  'response',
  'handler',
  'not-ready',
] as const;
export type RpcRejectReason = (typeof RPC_REJECT_REASONS)[number];

function parseUrl(raw: string | undefined): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * A tab: same extension, top frame of a tab, document origin among the host
 * patterns (ChatSpace; the loopback stand in test builds). When the browser
 * names the sender's origin too, it must be the URL's origin. The verdict
 * names the host kind whose patterns matched: a tab may register only as it.
 */
export function verifyTabSender(sender: MessageSenderApi | undefined, runtimeId: string, tabHosts: TabHostMatches): SenderVerdict {
  if (!sender || sender.id !== runtimeId) return { ok: false, reason: 'foreign-extension' };
  if (sender.frameId !== 0 || typeof sender.tab?.id !== 'number') return { ok: false, reason: 'subframe' };
  const url = parseUrl(sender.url);
  if (!url) return { ok: false, reason: 'origin' };
  const hosts = (Object.entries(tabHosts) as [TabHostKind, readonly string[] | undefined][]).filter(([, patterns]) => patterns?.some((pattern) => urlMatchesPattern(url, pattern)));
  // No host, or patterns of two kinds matching one URL (a misconfiguration): refused.
  const host = hosts.length === 1 ? hosts[0]?.[0] : undefined;
  if (host === undefined) return { ok: false, reason: 'origin' };
  if (sender.origin !== undefined && sender.origin !== url.origin) return { ok: false, reason: 'origin' };
  return { ok: true, kind: 'tab', host, tabId: sender.tab.id, url: url.href };
}

/**
 * An extension page: same extension, `<own base>/<page>.html` for one of
 * EXTENSION_PAGES. A page in a tab (options opens in a tab) must be its top
 * frame; the popup has no tab and no frame id.
 */
export function verifyPageSender(sender: MessageSenderApi | undefined, runtimeId: string, ownBase: string): SenderVerdict {
  if (!sender || sender.id !== runtimeId) return { ok: false, reason: 'foreign-extension' };
  if (sender.tab !== undefined ? sender.frameId !== 0 : sender.frameId !== undefined && sender.frameId !== 0) return { ok: false, reason: 'subframe' };
  const url = parseUrl(sender.url);
  const base = parseUrl(ownBase);
  // Compared by scheme and host: `moz-extension:` is not a special scheme, so `URL.origin` may be "null".
  if (!url || !base || base.host === '' || url.protocol !== base.protocol || url.host !== base.host) return { ok: false, reason: 'not-a-page' };
  const name = /^\/([a-z-]+)\.html$/.exec(url.pathname)?.[1];
  const page = EXTENSION_PAGES.find((candidate) => candidate === name);
  if (page === undefined) return { ok: false, reason: 'not-a-page' };
  return { ok: true, kind: 'page', page, tabId: typeof sender.tab?.id === 'number' ? sender.tab.id : null, url: url.href };
}

/**
 * A site's relay frame (1.15.0; R20 architecture §8.5): same extension, a subframe (`frameId !== 0`) of a tab — the
 * `frameId === 0` rule of a tab is not relaxed for it — at `<own base>/<relay page>` of exactly one site. The verdict
 * names that site and the tab; the background then requires a registered tab session of that site in that tab.
 */
export function verifyRelaySender(sender: MessageSenderApi | undefined, runtimeId: string, ownBase: string, relayPages: RelayPages): SenderVerdict {
  if (!sender || sender.id !== runtimeId) return { ok: false, reason: 'foreign-extension' };
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number' || typeof sender.frameId !== 'number' || sender.frameId === 0) return { ok: false, reason: 'not-a-relay' };
  const url = parseUrl(sender.url);
  const base = parseUrl(ownBase);
  if (!url || !base || base.host === '' || url.protocol !== base.protocol || url.host !== base.host) return { ok: false, reason: 'not-a-relay' };
  const file = url.pathname.slice(1);
  const hosts = (Object.entries(relayPages) as [TabHostKind, string | undefined][]).filter(([, page]) => page !== undefined && page === file);
  const host = hosts.length === 1 ? hosts[0]?.[0] : undefined;
  if (host === undefined) return { ok: false, reason: 'not-a-relay' };
  return { ok: true, kind: 'relay', host, tabId, frameId: sender.frameId, url: url.href };
}
