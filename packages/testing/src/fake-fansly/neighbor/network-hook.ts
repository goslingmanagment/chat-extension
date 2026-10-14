// C. FBuddy's network hook (`injections/fbuddy-network-hook.js`, S5 §2.3,
// §2.4, §6.2 C), a page script:
// - `OriginalXHR = window.XMLHttpRequest` is read ONCE, when the script runs
//   — our constructor Proxy if we stood first — and `open`, `setRequestHeader`
//   and `send` are patched on `OriginalXHR.prototype` (through a Proxy: the
//   native prototype). The constructor is never replaced, never called, never
//   compared;
// - `open` rewrites a media address of the cdn hosts with `ngsw-bypass=true`
//   and puts `__fbuddyRequestInfo` on the instance for a Fansly API address;
//   `setRequestHeader` records the four client headers; `send` keeps the body
//   of `POST /message` (and `/message/broadcast`), adds its `load`, `error`,
//   `abort`, `timeout` listeners AT SEND TIME, then calls the original;
// - `window.fetch` is replaced by a wrapper that always builds `new Request`;
//   for an API address it reads clones of the request (`POST /message`) and
//   of the response;
// - every API answer goes to the «isolated» side whole, through the bridge;
// - the modern build disposes the instance before it (a re-injection) and
//   `dispose()` restores a method only if it is still on top — otherwise the
//   wrapper stays in the chain as a pass-through;
// - `legacy` (July): every XHR and fetch, every body; a flag guard instead of
//   `dispose` — a second injection is a no-op and the hooks never leave.
// On the stand «a Fansly API address» is one of the fake Fansly's API origin
// under `/api/` (the real: `fansly.com` or `*.fansly.com`, path `/api/…`).

import { BRIDGE_EVENTS, FBUDDY_KEYS, FBUDDY_XHR, RECORDED_HEADERS, type NetworkEventPayload } from './protocol';
import { original } from './util';

export interface HookOptions {
  /** The fake Fansly's API origin; null — the page has none (the local backend): nothing is an API address. */
  readonly apiOrigin: string | null;
  readonly legacy: boolean;
  /** The number of this install (the injector counts). */
  readonly instance: number;
  /** Where events go (the page bridge). */
  readonly post: (name: string, payload: NetworkEventPayload) => void;
}

export interface HookInstance {
  readonly id: number;
  readonly legacy: boolean;
  readonly disposed: boolean;
  /** The July build has none: its hooks never leave. */
  dispose(): void;
}

interface HookRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

type Xhr = XMLHttpRequest & { [FBUDDY_XHR.requestInfo]?: HookRequest };
type XhrOpen = (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) => void;
type XhrSend = (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
type XhrSetHeader = (this: XMLHttpRequest, name: string, value: string) => void;

const RECORDED = new Set<string>(RECORDED_HEADERS);

/** A media address of Fansly's cdn hosts gets `ngsw-bypass=true` (S5 §2.3). The stand has no cdn host. */
export function rewriteMediaUrl(address: string, base: string): string {
  let url: URL;
  try {
    url = new URL(address, base);
  } catch {
    return address;
  }
  if (!/^cdn\d*\./.test(url.hostname) || url.searchParams.get('ngsw-bypass') === 'true') return address;
  url.searchParams.set('ngsw-bypass', 'true');
  return url.toString();
}

/** A Fansly API address on the stand: the fake Fansly's API origin, path `/api/…`. */
export function isApiAddress(address: string, base: string, apiOrigin: string | null): boolean {
  if (apiOrigin === null) return false;
  try {
    const url = new URL(address, base);
    return url.origin === apiOrigin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/** `POST /api/v1/message` or `/message/broadcast`: the only request bodies the modern build keeps (S5 §2.4). */
export function isMessagePost(method: string, address: string, base: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  try {
    return /^\/api\/v1\/message(?:\/broadcast)?$/.test(new URL(address, base).pathname);
  } catch {
    return false;
  }
}

const textOf = (xhr: XMLHttpRequest): string | null => {
  if (xhr.responseType !== '' && xhr.responseType !== 'text') return null;
  try {
    return xhr.responseText;
  } catch {
    return null;
  }
};

/** Installs the hook on `win`; null — the July build found its flag (already installed). */
export function installNetworkHook(win: Window & typeof globalThis, options: HookOptions): HookInstance | null {
  const { legacy, apiOrigin } = options;
  if (legacy) {
    if (Reflect.get(win, FBUDDY_KEYS.hook) === true) return null;
  } else {
    (Reflect.get(win, FBUDDY_KEYS.hookInstance) as HookInstance | undefined)?.dispose();
  }
  Reflect.set(win, FBUDDY_KEYS.hook, true);

  const base = win.location.href;
  const OriginalXHR = win.XMLHttpRequest;
  const proto = OriginalXHR.prototype;
  const originalOpen = original<XhrOpen>(proto, 'open');
  const originalSend = original<XhrSend>(proto, 'send');
  const originalSetHeader = original<XhrSetHeader>(proto, 'setRequestHeader');
  const originalFetch = original<typeof fetch>(win, 'fetch');
  let disposed = false;
  const tracked = (address: string): boolean => legacy || isApiAddress(address, base, apiOrigin);
  const keepsBody = (method: string, address: string): boolean => legacy || isMessagePost(method, address, base);
  const emit = (payload: Omit<NetworkEventPayload, 'instance'>): void => options.post(BRIDGE_EVENTS.network, { instance: options.instance, ...payload });

  function open(this: Xhr, method: string, url: string | URL, ...rest: unknown[]): void {
    if (disposed) return originalOpen.call(this, method, url, ...rest);
    const address = rewriteMediaUrl(String(url), base);
    if (tracked(address)) this[FBUDDY_XHR.requestInfo] = { method: String(method).toUpperCase(), url: address, headers: {}, body: null };
    return originalOpen.call(this, method, address, ...rest);
  }

  function setRequestHeader(this: Xhr, name: string, value: string): void {
    const info = this[FBUDDY_XHR.requestInfo];
    if (!disposed && info !== undefined && RECORDED.has(name.toLowerCase())) info.headers[name.toLowerCase()] = value;
    return originalSetHeader.call(this, name, value);
  }

  function send(this: Xhr, body?: Document | XMLHttpRequestBodyInit | null): void {
    const info = this[FBUDDY_XHR.requestInfo];
    if (!disposed && info !== undefined) {
      if (keepsBody(info.method, info.url)) info.body = typeof body === 'string' ? body : null;
      const report = (outcome: NetworkEventPayload['outcome']) => () =>
        emit({
          kind: 'xhr',
          method: info.method,
          url: info.url,
          status: this.status,
          outcome,
          headers: { ...info.headers },
          requestBody: info.body,
          responseText: outcome === 'load' ? textOf(this) : null,
        });
      this.addEventListener('load', report('load'));
      this.addEventListener('error', report('error'));
      this.addEventListener('abort', report('abort'));
      this.addEventListener('timeout', report('timeout'));
    }
    return originalSend.call(this, body);
  }

  const fetchHook = function fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (disposed) return originalFetch.call(win, input, init);
    let request = new win.Request(input, init);
    const address = rewriteMediaUrl(request.url, base);
    if (address !== request.url) request = new win.Request(address, request);
    if (!tracked(request.url)) return originalFetch.call(win, request);
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      if (RECORDED.has(name)) headers[name] = value;
    });
    const sentBody = keepsBody(request.method, request.url) ? request.clone().text() : Promise.resolve(null);
    const event = { kind: 'fetch' as const, method: request.method.toUpperCase(), url: request.url, headers };
    return originalFetch.call(win, request).then(
      (response) => {
        void Promise.all([sentBody, response.clone().text()]).then(([requestBody, responseText]) =>
          emit({ ...event, status: response.status, outcome: 'load', requestBody: requestBody === '' ? null : requestBody, responseText }),
        );
        return response;
      },
      (error: unknown) => {
        emit({ ...event, status: 0, outcome: 'error', requestBody: null, responseText: null });
        throw error;
      },
    );
  };

  Reflect.set(proto, 'open', open);
  Reflect.set(proto, 'setRequestHeader', setRequestHeader);
  Reflect.set(proto, 'send', send);
  Reflect.set(win, 'fetch', fetchHook);

  const instance: HookInstance = {
    id: options.instance,
    legacy,
    get disposed() {
      return disposed;
    },
    dispose: () => {
      if (legacy || disposed) return;
      disposed = true;
      // Restore only what is still ours on top; a method someone wrapped after us stays, and ours passes through.
      if (Reflect.get(proto, 'open') === open) Reflect.set(proto, 'open', originalOpen);
      if (Reflect.get(proto, 'setRequestHeader') === setRequestHeader) Reflect.set(proto, 'setRequestHeader', originalSetHeader);
      if (Reflect.get(proto, 'send') === send) Reflect.set(proto, 'send', originalSend);
      if (Reflect.get(win, 'fetch') === fetchHook) Reflect.set(win, 'fetch', originalFetch);
      if (Reflect.get(win, FBUDDY_KEYS.hookInstance) === instance) {
        Reflect.set(win, FBUDDY_KEYS.hookInstance, undefined);
        Reflect.set(win, FBUDDY_KEYS.hook, false);
      }
    },
  };
  Reflect.set(win, FBUDDY_KEYS.hookInstance, instance);
  return instance;
}
