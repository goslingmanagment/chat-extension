// Test support for @cg/hub: an in-memory hub behind a fetch, a key-value
// store with failure injection, an environment, and an AI stream transport
// with every capability (the stand-in for the SDK after its H-4 re-vendoring).
//
// Deliberately generic: it knows hub paths only through the map the test
// passes in (the fake hub's HUB_ROUTE_PATHS from @cg/testing/hub) and
// exchanges only by their shape, so this file needs nothing from the test
// harness package and stays inside the hub package's dependency rules.

import { AI_STREAM_CAPABILITIES, HUB_ROUTES, type AiStreamCapability, type HubRouteKey } from '@cg/contracts';
import { KernelApiError } from '@kernel/sdk';

import {
  type AiStreamTransport,
  type FetchLike,
  type HubEnvironment,
  type HubKeyValueStore,
  type HubLog,
  type HubLogFields,
  type HubLogLevel,
  type HubOs,
  type HubStorageFailureCode,
  type HubStorageResult,
} from '../../src/index';

// ── requests ───────────────────────────────────────────────────────────────

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly origin: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  /** The operation whose path and method this request has; null when none. */
  readonly route: HubRouteKey | null;
  readonly signal: AbortSignal | null;
}

/** A handler answers a request, or returns undefined to let the next one try. `'hang'` never answers (until aborted). */
export type Answer = Response | 'hang' | 'network-error';
export type Handler = (request: RecordedRequest) => Answer | undefined | Promise<Answer | undefined>;

/** What a scenario exchange looks like (structurally @cg/testing's HttpExchange). */
export interface ExchangeLike {
  readonly route: HubRouteKey;
  readonly request: unknown;
  readonly response: { readonly status: number; readonly body: unknown; readonly retryAfterSec?: number };
}

const PARAM = /\/:([A-Za-z]+)/g;

function templateRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([A-Za-z]+)/g, '/(?<$1>[^/?]+)');
  return new RegExp(`^${escaped}$`);
}

/** Stable JSON: object keys sorted, so two equal values print the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

export interface ExpectedWire {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/**
 * The facade-level request of a scenario (path params + query, or + body)
 * → method, path, query and body on the wire. Written independently of the
 * hub package's own encoders: a `:param` takes the field of its name, else
 * the fan (`conversationId`, `platformUserId` ← `fanRef`); a GET sends the
 * rest as the query, a POST as the body (a claim sends its `body`).
 */
export function expectedWire(route: HubRouteKey, request: unknown, template: string): ExpectedWire {
  const fields: Record<string, unknown> = request === null || request === undefined ? {} : { ...(request as Record<string, unknown>) };
  let usedFan = false;
  const path = template.replace(PARAM, (_match, name: string) => {
    let value = fields[name];
    if (value === undefined) {
      value = fields['fanRef'];
      usedFan = true;
    }
    delete fields[name];
    return `/${encodeURIComponent(String(value))}`;
  });
  if (usedFan) delete fields['fanRef'];
  const { method } = HUB_ROUTES[route];
  if (method === 'GET' || method === 'DELETE') {
    const query = Object.fromEntries(
      Object.entries(fields)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value as string | number | boolean)]),
    );
    return { method, path, query, body: undefined };
  }
  const body = route === 'clientFanClaim' ? fields['body'] : Object.keys(fields).length === 0 ? undefined : fields;
  return { method, path, query: {}, body };
}

export function json(status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function hubError(status: number, error: string, reason?: string): Response {
  return json(status, reason === undefined ? { error, message: `synthetic ${error}`, statusCode: status } : { error, message: `synthetic ${error}`, statusCode: status, reason });
}

const encoder = new TextEncoder();

/** A 200 SSE answer; the text is cut into `chunkSize` pieces (frames split across reads). `open` keeps the body open after the text. */
export function sse(text: string, options: { readonly chunkSize?: number; readonly open?: boolean; readonly signal?: AbortSignal | null } = {}): Response {
  const size = options.chunkSize ?? 17;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < text.length; at += size) controller.enqueue(encoder.encode(text.slice(at, at + size)));
      if (options.open !== true) controller.close();
      else
        options.signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'));
          } catch {
            // already closed
          }
        });
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** The hub's SSE framing of one frame (`event: ai`). */
export const sseFrame = (frame: unknown): string => `event: ai\ndata: ${JSON.stringify(frame)}\n\n`;

function headerRecord(headers: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) return out;
  new Headers(headers).forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export class FakeHub {
  readonly requests: RecordedRequest[] = [];
  /** Requests no handler answered: a test that ends with any is wrong. */
  readonly unexpected: RecordedRequest[] = [];
  private readonly handlers: Handler[] = [];
  private readonly matchers: Array<{ readonly route: HubRouteKey; readonly regex: RegExp; readonly method: string }>;
  private inFlight = 0;
  /** The most requests that were open at once. */
  maxInFlight = 0;

  constructor(readonly paths: Readonly<Record<HubRouteKey, string>>) {
    this.matchers = (Object.keys(paths) as HubRouteKey[]).map((route) => ({ route, regex: templateRegex(paths[route]), method: HUB_ROUTES[route].method }));
  }

  /** Handlers are tried newest first. */
  use(handler: Handler): this {
    this.handlers.unshift(handler);
    return this;
  }

  /** Answers one route with `answer` (a function of the request, or a fixed response factory). */
  on(route: HubRouteKey, answer: (request: RecordedRequest) => Answer | Promise<Answer>): this {
    return this.use((request) => (request.route === route ? answer(request) : undefined));
  }

  /**
   * Scenario exchanges: each answers ONE request whose route, path, query
   * and body equal the exchange's facade-level request, first unused first.
   */
  serve(exchanges: readonly ExchangeLike[]): { readonly left: () => readonly ExchangeLike[] } {
    const unused = [...exchanges];
    this.use((request) => {
      if (request.route === null) return undefined;
      const index = unused.findIndex((exchange) => {
        if (exchange.route !== request.route) return false;
        const wire = expectedWire(exchange.route, exchange.request, this.paths[exchange.route]);
        return wire.path === request.path && canonical(wire.query) === canonical(request.query) && canonical(wire.body) === canonical(request.body);
      });
      if (index < 0) return undefined;
      const [exchange] = unused.splice(index, 1);
      if (exchange === undefined) return undefined;
      const { status, body, retryAfterSec } = exchange.response;
      return json(status, body, retryAfterSec === undefined ? {} : { 'retry-after': String(retryAfterSec) });
    });
    return { left: () => unused };
  }

  routeOf(method: string, path: string): HubRouteKey | null {
    return this.matchers.find((matcher) => matcher.method === method && matcher.regex.test(path))?.route ?? null;
  }

  of(route: HubRouteKey): RecordedRequest[] {
    return this.requests.filter((request) => request.route === route);
  }

  readonly fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' && init.body !== '' ? (JSON.parse(init.body) as unknown) : undefined;
    const request: RecordedRequest = {
      method,
      url: input,
      origin: url.origin,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: headerRecord(init.headers),
      body,
      route: this.routeOf(method, url.pathname),
      signal: init.signal ?? null,
    };
    this.requests.push(request);
    const signal = init.signal ?? null;
    if (signal?.aborted === true) throw new DOMException('The operation was aborted.', 'AbortError');
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      let answer: Answer | undefined;
      for (const handler of [...this.handlers]) {
        answer = await handler(request);
        if (answer !== undefined) break;
      }
      if (answer === undefined) {
        this.unexpected.push(request);
        return json(599, { error: 'unexpected_request', message: `${method} ${url.pathname}`, statusCode: 599 });
      }
      if (answer === 'network-error') throw new TypeError('fetch failed');
      if (answer === 'hang') {
        return await new Promise<Response>((_resolve, reject) => {
          if (signal === null) return;
          signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true });
        });
      }
      return answer;
    } finally {
      this.inFlight -= 1;
    }
  };
}

// ── storage ────────────────────────────────────────────────────────────────

export class MemoryStore implements HubKeyValueStore {
  readonly data = new Map<string, unknown>();
  /** Every successful write, in order (keys and values). */
  readonly writes: Array<Readonly<Record<string, unknown>>> = [];
  readonly removals: Array<readonly string[]> = [];
  fail: { get?: HubStorageFailureCode; set?: HubStorageFailureCode; remove?: HubStorageFailureCode } = {};

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, structuredClone(value));
  }

  get(keys: readonly string[]): Promise<HubStorageResult<Readonly<Record<string, unknown>>>> {
    if (this.fail.get !== undefined) return Promise.resolve({ ok: false, code: this.fail.get, detail: 'injected' });
    const value: Record<string, unknown> = {};
    for (const key of keys) if (this.data.has(key)) value[key] = structuredClone(this.data.get(key));
    return Promise.resolve({ ok: true, value });
  }

  set(items: Readonly<Record<string, unknown>>): Promise<HubStorageResult<void>> {
    if (this.fail.set !== undefined) return Promise.resolve({ ok: false, code: this.fail.set, detail: 'injected' });
    const copy = structuredClone(items) as Record<string, unknown>;
    for (const [key, value] of Object.entries(copy)) this.data.set(key, value);
    this.writes.push(copy);
    return Promise.resolve({ ok: true, value: undefined });
  }

  remove(keys: readonly string[]): Promise<HubStorageResult<void>> {
    if (this.fail.remove !== undefined) return Promise.resolve({ ok: false, code: this.fail.remove, detail: 'injected' });
    for (const key of keys) this.data.delete(key);
    this.removals.push([...keys]);
    return Promise.resolve({ ok: true, value: undefined });
  }
}

// ── environment and log ────────────────────────────────────────────────────

export interface TestEnv extends HubEnvironment {
  origin: string;
  debug: boolean;
  testBuild: boolean;
  extensionVersion: string;
}

export function testEnv(over: Partial<{ origin: string; debug: boolean; testBuild: boolean; extensionVersion: string; os: HubOs }> = {}): TestEnv {
  const env = {
    origin: over.origin ?? 'https://hub.example.test',
    debug: over.debug ?? false,
    testBuild: over.testBuild ?? false,
    extensionVersion: over.extensionVersion ?? '0.2.0',
    os: over.os ?? 'macos',
    hubOrigin: () => env.origin,
    debugEnabled: () => env.debug,
  };
  return env;
}

export interface LogLine {
  readonly level: HubLogLevel;
  readonly message: string;
  readonly fields: HubLogFields | undefined;
}

export function memoryLog(): { readonly log: HubLog; readonly lines: LogLine[]; readonly text: () => string } {
  const lines: LogLine[] = [];
  return {
    lines,
    log: (level, message, fields) => lines.push({ level, message, fields }),
    text: () => JSON.stringify(lines),
  };
}

export function counterUuid(prefix = 'e'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8${prefix === 'e' ? '0' : '1'}00-${n.toString(16).padStart(12, '0')}`;
  };
}

// ── the AI stream with every capability ────────────────────────────────────

/**
 * What `streamAiFeature` will do once the hub's H-4 SDK change is vendored:
 * the capability list on `x-kernel-ai-capabilities`, `event: ai` frames as
 * parsed JSON, a refused handshake as a KernelApiError with the envelope.
 */
export function fullStreamTransport(capabilities: readonly AiStreamCapability[] = AI_STREAM_CAPABILITIES): AiStreamTransport {
  return {
    capabilities,
    async open(input) {
      const headers: Record<string, string> = { accept: 'text/event-stream', 'content-type': 'application/json', ...input.headers, authorization: `Bearer ${input.token}` };
      if (input.capabilities.length > 0) headers['x-kernel-ai-capabilities'] = input.capabilities.join(',');
      let response: Response;
      try {
        response = await input.fetch(`${input.hubOrigin}/api/v1/ai/features/${encodeURIComponent(input.feature)}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(input.body),
          signal: input.signal,
        });
      } catch (error) {
        if (input.signal.aborted) return;
        void error;
        throw new KernelApiError('network', 'network', null, 'network_error', null);
      }
      if (!response.ok || response.body === null) {
        const text = await response.text();
        let body: unknown = text;
        try {
          body = text === '' ? null : JSON.parse(text);
        } catch {
          // not JSON: kept as text
        }
        const envelope = (body ?? {}) as { error?: unknown };
        const error = new KernelApiError('refused', response.status === 401 || response.status === 403 ? 'auth' : 'http', response.status, typeof envelope.error === 'string' ? envelope.error : null, body);
        if (response.status === 401 || response.status === 403) input.onAuthError(error);
        throw error;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let event: string | null = null;
            let data = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7);
              else if (line.startsWith('data: ')) data += line.slice(6);
            }
            if (event === 'ai' && data !== '') input.onFrame(JSON.parse(data));
          }
        }
      } catch (error) {
        if (input.signal.aborted) return;
        throw error;
      }
    },
  };
}
