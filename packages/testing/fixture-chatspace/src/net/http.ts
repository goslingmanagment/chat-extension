// The page's native HTTP client, shaped like the Ky client ChatSpace uses
// (metadata.ts «http-client»): every call creates a new request object that
// takes `options.fetch ?? globalThis.fetch.bind(globalThis)` SYNCHRONOUSLY in
// its constructor, before the first await; the token comes in an async
// before-request hook; a 401 refreshes the token and re-runs the request once
// as a bare request created at that moment (so it captures fetch anew);
// POST is never retried, idempotent methods are on 408/413/429/5xx.

import { record } from '../journal';
import { NATIVE_REQUEST_HEADER } from '../protocol';
import { getToken } from './auth';

export class HTTPError extends Error {
  override readonly name = 'HTTPError';
  constructor(
    readonly response: Response,
    readonly request: Request,
  ) {
    super(`Request failed with status code ${response.status}`);
  }
}

export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
  constructor(readonly request: Request) {
    super('Request timed out');
  }
}

export interface RequestOptions {
  readonly json?: unknown;
  readonly searchParams?: URLSearchParams;
  readonly signal?: AbortSignal;
  /** ms; the client default is 40 s. */
  readonly timeout?: number;
  /** Ky's `fetch` option. The app never sets it: the global is taken at creation. */
  readonly fetch?: typeof globalThis.fetch;
  /** false: a bare request without the token hook, the 401 handler or retries. */
  readonly hooks?: boolean;
}

export type ResponsePromise = Promise<Response> & { json<T = unknown>(): Promise<T> };

export interface HttpClient {
  get(path: string, options?: RequestOptions): ResponsePromise;
  post(path: string, options?: RequestOptions): ResponsePromise;
  delete(path: string, options?: RequestOptions): ResponsePromise;
}

const CLIENT_TIMEOUT_MS = 40_000;
const RETRY_LIMIT = 2;
const RETRY_METHODS = new Set(['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE']);
const RETRY_STATUSES = new Set([408, 413, 429, 500, 502, 503, 504]);

/** The global as it was when the stand booted; only for labelling captures in the journal. */
const BOOT_FETCH = globalThis.fetch;

let requestSeq = 0;

type Attempt = 'first' | 'retry' | 'after-401';

function createRequest(method: string, url: URL, options: RequestOptions, attempt: Attempt, retries: number, base: Request | null): ResponsePromise {
  // ── Synchronous part: the request object and its fetch are fixed here. ──
  requestSeq += 1;
  const seq = requestSeq;
  const fetchCapture = options.fetch !== undefined ? 'option' : globalThis.fetch === BOOT_FETCH ? 'native' : 'substituted';
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  if (options.searchParams) for (const [name, value] of options.searchParams) url.searchParams.append(name, value);
  const timeoutController = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;
  const headers = new Headers(base?.headers);
  headers.set(NATIVE_REQUEST_HEADER, String(seq));
  let body: string | null = null;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers.set('content-type', 'application/json');
  }
  const request = base !== null ? new Request(base, { headers, signal }) : new Request(url, { method, headers, body, signal });
  const hooks = options.hooks !== false;
  record('http-request', { seq, method, path: `${url.pathname}${url.search}`, fetchCapture, attempt });

  const promise = (async (): Promise<Response> => {
    const timer = setTimeout(() => timeoutController.abort(new TimeoutError(request)), options.timeout ?? CLIENT_TIMEOUT_MS);
    try {
      if (hooks) {
        const token = await getToken();
        if (token !== null) request.headers.set('authorization', `Bearer ${token}`);
      }
      let response: Response;
      try {
        response = await fetchFn(request.clone());
      } catch (error) {
        if (timeoutController.signal.aborted && options.signal?.aborted !== true) throw new TimeoutError(request);
        throw error;
      }
      record('http-response', { seq, status: response.status });
      if (hooks && response.status === 401) {
        const fresh = await getToken({ skipCache: true });
        if (fresh === null) {
          record('sign-in-redirect', { seq });
          location.assign('/sign-in');
          return response;
        }
        const retryHeaders = new Headers(request.headers);
        retryHeaders.set('authorization', `Bearer ${fresh}`);
        // Bare re-run: a new request object, created now, outside the caller's stack.
        return await createRequest(method, new URL(url), { hooks: false, signal: request.signal }, 'after-401', 0, new Request(request, { headers: retryHeaders }));
      }
      if (!response.ok) {
        if (hooks && retries < RETRY_LIMIT && RETRY_METHODS.has(method) && RETRY_STATUSES.has(response.status)) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(300 * 2 ** retries, 3000)));
          // The URL already carries the search params.
          const { searchParams: _applied, ...again } = options;
          return await createRequest(method, new URL(url), again, 'retry', retries + 1, null);
        }
        throw new HTTPError(response, request);
      }
      return response;
    } catch (error) {
      record('http-error', { seq, name: error instanceof Error ? error.name : 'unknown' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
  return Object.assign(promise, { json: <T = unknown>(): Promise<T> => promise.then((response) => response.json() as Promise<T>) });
}

export function createClient(prefixUrl: string): HttpClient {
  const call = (method: string) => (path: string, options: RequestOptions = {}) => createRequest(method, new URL(path, prefixUrl), options, 'first', 0, null);
  return { get: call('GET'), post: call('POST'), delete: call('DELETE') };
}

/** The app's client (ChatSpace keeps one; each call still creates its own request object). */
export const api: HttpClient = createClient(`${location.origin}/`);

/** The server's error body, if any (`{code, message, details: {upstream_message}}`). */
export async function errorBody(error: unknown): Promise<{ code?: string; message?: string; upstreamMessage?: string } | null> {
  if (!(error instanceof HTTPError)) return null;
  try {
    const body = (await error.response.clone().json()) as { code?: unknown; message?: unknown; details?: { upstream_message?: unknown } };
    return {
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
      ...(typeof body.message === 'string' ? { message: body.message } : {}),
      ...(typeof body.details?.upstream_message === 'string' ? { upstreamMessage: body.details.upstream_message } : {}),
    };
  } catch {
    return null;
  }
}
