// Small helpers for tests that talk to the fake hub by hand (in-process fetch
// or the loopback origin): call one route with a facade request the way the
// client would send it, and read an SSE body into frames like the vendored
// SDK does (blank-line frames, `event: ai`, `data:` lines, comments skipped).

import { type HubRouteKey } from '@cg/contracts';

import { wireOf } from './routing';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HubCallOptions {
  readonly token?: string | null;
  readonly clientVersion?: string;
  readonly signal?: AbortSignal;
}

/** Calls one route of the hub at `origin` with a facade request (HUB_ROUTE_SCHEMAS[route].request shape). */
export function hubCall(fetchImpl: FetchLike, origin: string, route: HubRouteKey, request: unknown, options: HubCallOptions = {}): Promise<Response> {
  const wire = wireOf(route, request);
  const headers: Record<string, string> = {
    ...wire.headers,
    ...(options.token === undefined || options.token === null ? {} : { authorization: `Bearer ${options.token}` }),
    ...(options.clientVersion === undefined ? {} : { 'x-client-version': options.clientVersion }),
  };
  return fetchImpl(`${origin}${wire.path}`, {
    method: wire.method,
    headers,
    ...(wire.body === undefined ? {} : { body: wire.body }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

export interface SseRead {
  /** Parsed `data:` of every `event: ai` frame, in order. */
  readonly frames: unknown[];
  /** Other events and raw blocks (unknown events, comments are skipped). */
  readonly others: string[];
  /** Bytes after the last complete frame (a cut frame). */
  readonly rest: string;
  /** How the body ended. */
  readonly end: 'eof' | 'error';
  readonly error: unknown;
  /** ms from the read start to each frame. */
  readonly times: number[];
}

/** Reads an SSE body to its end (or error) the way the SDK's parser frames it. */
export async function readSse(response: Response, onFrame?: (frame: unknown, index: number) => void): Promise<SseRead> {
  const frames: unknown[] = [];
  const others: string[] = [];
  const times: number[] = [];
  const started = performance.now();
  if (response.body === null) return { frames, others, rest: '', end: 'eof', error: null, times };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let end: SseRead['end'] = 'eof';
  let error: unknown = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = raw.split('\n').filter((line) => !line.startsWith(':'));
        if (lines.length === 0) continue;
        const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? null;
        const data = lines
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n');
        if (event === 'ai' && data !== '') {
          const frame = JSON.parse(data) as unknown;
          frames.push(frame);
          times.push(performance.now() - started);
          onFrame?.(frame, frames.length - 1);
        } else others.push(raw);
      }
    }
  } catch (caught) {
    end = 'error';
    error = caught;
  }
  return { frames, others, rest: buffer, end, error, times };
}
