// Test kit of the fake Fansly's own tests: one server, and requests to it as
// each kind of caller would make them — the page (its `Origin`), our
// background (no `Origin`), a stranger — over node:http to 127.0.0.1 under the
// API's own name, and a socket as the page opens it.

import { request as httpRequest } from 'node:http';

import { WebSocket } from 'ws';

import { FANSLY_API_PATH, sessionVerifyRequest, type WireEnvelope } from '../../fixture-fansly/src/wire';
import { startFakeFansly, type FakeFansly } from './index';

/** The stand page's origin in these tests: nothing listens there. */
export const PAGE_ORIGIN = 'http://localhost:5999';

export type As = 'page' | 'ours' | 'stranger';

export interface CallOptions {
  readonly as?: As;
  readonly body?: unknown;
  /** `null` — no `authorization` at all. */
  readonly token?: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  /** The `Host` the request names (the API's own by default). */
  readonly host?: string;
  /** The port to connect to (the API's by default): the proxy's, a door behind it. */
  readonly port?: number;
  /** The request target as written (a proxy takes an absolute address). */
  readonly target?: string;
}

export interface Answer<T = unknown> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly text: string;
  /** The parsed envelope; null — the body is not JSON. */
  readonly json: WireEnvelope<T> | null;
  /** `json.response` of a success; undefined otherwise. */
  readonly response: T | undefined;
}

const ORIGINS: Readonly<Record<As, string | undefined>> = { page: PAGE_ORIGIN, ours: undefined, stranger: 'http://stranger.invalid' };

/** One API call. `path` follows `/api/v1`; `ngsw-bypass=true` is NOT added — a caller writes its own address. */
export function call<T = unknown>(fake: FakeFansly, method: 'GET' | 'POST' | 'OPTIONS', path: string, options: CallOptions = {}): Promise<Answer<T>> {
  const api = new URL(fake.apiOrigin);
  const origin = ORIGINS[options.as ?? 'page'];
  const text = options.body === undefined ? undefined : JSON.stringify(options.body);
  const token = options.token === undefined ? fake.token : options.token;
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: options.port ?? api.port,
        method,
        path: options.target ?? `${FANSLY_API_PATH}${path}`,
        headers: {
          host: options.host ?? api.host,
          ...(origin !== undefined ? { origin } : {}),
          ...(token !== null ? { authorization: token } : {}),
          ...(text !== undefined ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json: WireEnvelope<T> | null;
          try {
            json = JSON.parse(body) as WireEnvelope<T>;
          } catch {
            json = null;
          }
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text: body, json, response: json !== null && json.success ? json.response : undefined });
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(text);
  });
}

/** `?ngsw-bypass=true` on a path, as the page and our client both write it. */
export const bypass = (path: string): string => `${path}${path.includes('?') ? '&' : '?'}ngsw-bypass=true`;

export interface TestSocket {
  readonly socket: WebSocket;
  /** Text frames received so far, in order. */
  readonly frames: string[];
  /** Resolves with the first frame (already received or yet to come) the predicate takes. */
  next(match: (frame: string) => boolean, timeoutMs?: number): Promise<string>;
  closed(): Promise<number>;
}

/** A socket to the fake Fansly as the page opens it (its `Origin`); `verify` sends the page's first frame once open. */
export function openSocket(fake: FakeFansly, options: { readonly as?: As; readonly verify?: boolean; readonly token?: string } = {}): Promise<TestSocket> {
  const url = new URL(fake.socketUrl);
  const origin = ORIGINS[options.as ?? 'page'];
  const socket = new WebSocket(`ws://127.0.0.1:${url.port}/?v=3`, { headers: { host: url.host }, ...(origin !== undefined ? { origin } : {}) });
  const frames: string[] = [];
  const waiters: Array<{ match: (frame: string) => boolean; resolve: (frame: string) => void }> = [];
  let seen = 0;
  socket.on('message', (data, binary) => {
    if (binary) return;
    const frame = (data as Buffer).toString('utf8');
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (!waiter.match(frame)) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  });
  const test: TestSocket = {
    socket,
    frames,
    next: (match, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const known = frames.slice(seen).find(match);
        if (known !== undefined) {
          seen = frames.indexOf(known) + 1;
          resolve(known);
          return;
        }
        const timer = setTimeout(() => reject(new Error(`no such frame in ${timeoutMs} ms; got ${frames.length}`)), timeoutMs);
        waiters.push({
          match,
          resolve: (frame) => {
            clearTimeout(timer);
            seen = frames.indexOf(frame) + 1;
            resolve(frame);
          },
        });
      }),
    closed: () => new Promise((resolve) => (socket.readyState === socket.CLOSED ? resolve(0) : socket.once('close', (code: number) => resolve(code)))),
  };
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () => {
      socket.off('error', reject);
      socket.on('error', () => undefined);
      if (options.verify !== false) socket.send(sessionVerifyRequest(options.token ?? fake.token));
      resolve(test);
    });
  });
}

/** `t` of a frame's wrapper; NaN — not JSON. */
export function frameType(frame: string): number {
  try {
    return Number((JSON.parse(frame) as { t?: unknown }).t);
  } catch {
    return Number.NaN;
  }
}

/** The service event of a `t: 10000` frame after its three parses; null — another frame. */
export function serviceEvent(frame: string): { readonly serviceId: number; readonly event: Record<string, unknown> } | null {
  try {
    const wrapper = JSON.parse(frame) as { t?: unknown; d?: unknown };
    if (wrapper.t !== 10000 || typeof wrapper.d !== 'string') return null;
    const service = JSON.parse(wrapper.d) as { serviceId: number; event: string };
    return { serviceId: service.serviceId, event: JSON.parse(service.event) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export const isEvent =
  (serviceId: number, type: number) =>
  (frame: string): boolean => {
    const parsed = serviceEvent(frame);
    return parsed !== null && parsed.serviceId === serviceId && parsed.event['type'] === type;
  };

export async function startTestFansly(): Promise<FakeFansly> {
  const fake = await startFakeFansly({ pageOrigin: PAGE_ORIGIN });
  // The socket verifies at once unless a test asks for the delay.
  fake.command({ op: 'socket', verifyDelayMs: 0 });
  return fake;
}

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
