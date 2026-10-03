// Shared pieces of the tab/pages ↔ background RPC (architecture.md §5.4,
// §14): the result type, sender checks and envelope builders. Light: only the
// light contract module (tab-protocol) and types, so the early isolated
// bundle can carry the tab client.

import type { CgCode, CgErrorWire } from '@cg/contracts/errors';
import { EXTENSION_PAGES, TAB_PROTOCOL_VERSION, type ExtensionPage } from '@cg/contracts/tab-protocol';
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

export type SenderVerdict =
  | { readonly ok: true; readonly kind: 'tab'; readonly tabId: number; readonly url: string }
  | { readonly ok: true; readonly kind: 'page'; readonly page: ExtensionPage; readonly tabId: number | null; readonly url: string }
  | { readonly ok: false; readonly reason: RpcRejectReason };

/** Why a message got no answer (counters for diagnostics; never the payload). */
export const RPC_REJECT_REASONS = [
  'foreign-extension',
  'subframe',
  'origin',
  'not-a-page',
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
 * names the sender's origin too, it must be the URL's origin.
 */
export function verifyTabSender(sender: MessageSenderApi | undefined, runtimeId: string, tabMatches: readonly string[]): SenderVerdict {
  if (!sender || sender.id !== runtimeId) return { ok: false, reason: 'foreign-extension' };
  if (sender.frameId !== 0 || typeof sender.tab?.id !== 'number') return { ok: false, reason: 'subframe' };
  const url = parseUrl(sender.url);
  if (!url || !tabMatches.some((pattern) => urlMatchesPattern(url, pattern))) return { ok: false, reason: 'origin' };
  if (sender.origin !== undefined && sender.origin !== url.origin) return { ok: false, reason: 'origin' };
  return { ok: true, kind: 'tab', tabId: sender.tab.id, url: url.href };
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
