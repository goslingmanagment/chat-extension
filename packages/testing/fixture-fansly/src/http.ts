// The page's HTTP client, as Fansly's reaches its API (S2 Q2): Angular's
// HttpClient over XHR, behind Fansly's own callback wrapper.
// - `new XMLHttpRequest()` at request time — the global is looked up on every
//   request (main:107553-107560, :114841-114843), so a wrapper installed over
//   it sees every later one;
// - everything up to `send()` runs synchronously inside the caller: a send of
//   the composer is created, opened and sent inside its Enter keydown or Send
//   click (main:29012-29023);
// - `open(method, url)`, `withCredentials`, the request's headers, then
//   `Accept` and `Content-Type`, `responseType = 'text'` for a JSON request —
//   the page parses the string itself, an XHR never holds a parsed object
//   (main:107557-107567); listeners by `addEventListener` (`load`, `error`,
//   `timeout`, `abort`), no `onload`;
// - every address carries `ngsw-bypass=true` (main:25694-25697) and Fansly's
//   session headers (main:25671-25690, :26082-26084): `authorization`,
//   `fansly-client-id`, `fansly-client-ts`, `fansly-session-id`,
//   `fansly-client-check` — synthetic here, the check changing with every
//   request as the site's does;
// - the callback takes `body.response` only when `body.success` (main:28316-28420).
// Each request is journaled the way the stand's own backend journals its
// answers: the path Fansly's client asks for and the handler it was made in.

import { inHandler } from './events';
import { record } from './journal';
import type { ApiCall } from './protocol';
import { FANSLY_API_PATH, NGSW_BYPASS, type WireEnvelope, type WireError } from './wire';

export interface HttpConfig {
  /** `http://localhost:<port>`: the fake Fansly's API origin. */
  readonly apiOrigin: string;
  /** The page's session token. */
  readonly token: string;
}

/** `error` — the request failed (a status outside 2xx, no answer, a body that is not JSON) or the server refused it (`success: false`). */
export type HttpCallback<T> = (error: WireError | 'failed' | null, response: T | null, status: number) => void;

let checks = 0;
let inFlight = 0;

/** Requests of the page sent and not yet ended (a test waits for quiet before it scripts the next thing). */
export function pendingRequests(): number {
  return inFlight;
}

export class FanslyHttp {
  private readonly clientId = `stand-client-${String(Math.floor(Math.random() * 9e8) + 1e8)}`;
  private readonly sessionId: string;

  constructor(private readonly config: HttpConfig) {
    this.sessionId = `stand-session-id-${config.token.slice(-8)}`;
  }

  /**
   * One API request. `path` is what follows `/api/v1` (with its own query); `detail` goes to the page's journal only.
   * The XHR is created and sent before this returns.
   */
  request<T>(method: ApiCall['method'], path: string, body: unknown, callback: HttpCallback<T>, detail: Record<string, unknown> = {}): void {
    const address = `${FANSLY_API_PATH}${path}${path.includes('?') ? '&' : '?'}${NGSW_BYPASS}=true`;
    const entry: ApiCall = { method, path: address, during: inHandler() };
    record('api', { ...entry, ...detail });
    const family = path.split(/[/?]/)[1] ?? '';
    checks += 1;

    const xhr = new XMLHttpRequest();
    xhr.open(method, `${this.config.apiOrigin}${address}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('authorization', this.config.token);
    xhr.setRequestHeader('fansly-client-id', this.clientId);
    xhr.setRequestHeader('fansly-client-ts', String(Date.now()));
    xhr.setRequestHeader('fansly-session-id', this.sessionId);
    xhr.setRequestHeader('fansly-client-check', `stand-check-${family}-${checks}`);
    xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
    if (body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.responseType = 'text';
    inFlight += 1;
    xhr.addEventListener('loadend', () => {
      inFlight -= 1;
    });
    xhr.addEventListener('load', () => {
      let parsed: WireEnvelope<T> | null;
      try {
        parsed = JSON.parse(String(xhr.response)) as WireEnvelope<T>;
      } catch {
        parsed = null;
      }
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok || parsed === null) callback('failed', null, xhr.status);
      else if (parsed.success) callback(null, parsed.response, xhr.status);
      else callback(parsed.error, null, xhr.status);
    });
    const failed = (): void => callback('failed', null, 0);
    xhr.addEventListener('error', failed);
    xhr.addEventListener('timeout', failed);
    xhr.addEventListener('abort', failed);
    xhr.send(body === null ? null : JSON.stringify(body));
  }
}
