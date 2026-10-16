// The relay frame of «Fansly через вкладку» (R20 P9c; docs/project-unite/
// architecture.md §8.5, §8.6; spec FS-NET-4, FX-001; as the Fansly extension's
// relay frame did it). An extension page the Fansly tab
// mounts in a closed root for a batch of the background's work and 60 s after:
// Firefox attributes its requests to that tab and its container, so the
// container's proxy carries them, as it carries the page's own.
//
// It holds no session and decides nothing. The background hands it ready
// requests (`fansly.relay.fetch`) over its port (`cg-relay`); before its own
// `fetch`, synchronously, it repeats its part of the last check:
// - the request is for this frame (`expect.relayId`: the frame the route was
//   chosen with) — another frame's request it leaves alone, unanswered;
// - the account the request expects is the one this frame serves: the account
//   its tab was on when it mounted it (its address says it; the tab tears the
//   frame down when its account changes) — else `failure: refused`, provably no
//   request;
// - the address is Fansly's API (FS-NET-1) — else refused too. A test build
//   serves Fansly's address from the stand it was pointed at.
// The document is its own check: a frame lives in one document of its tab
// and goes with it.
//
// It answers like `fetch`: the status and three headers as soon as they come
// (`fansly.relay.head`: a 429 or a 401 counts even when its body never does),
// then the body (`.body`), or why there is none (`.failure`). An abort from
// the background (`fansly.relay.abort`) aborts its request. On every new port
// it says it is up (`fansly.relay.hello`): its account and its own id.

/** Fansly's API: the only address the frame requests (contracts FANSLY_RELAY_TARGET; a test pins them equal). */
export const RELAY_TARGET = 'https://apiv3.fansly.com/api/v1/';
/** Response headers the client reads; the rest stays in the frame. */
export const RELAY_RESPONSE_HEADERS = ['content-type', 'content-length', 'retry-after'] as const;
/** Full encoded URL (contracts FANSLY_TAB_LIMITS.relayRequestUrlMaxChars; allowlist.test.ts checks every route). */
export const RELAY_URL_MAX_CHARS = 128 * 1024;
/** The longest body handed back (contracts FANSLY_TAB_LIMITS.relayResponseBodyMaxChars). */
export const RELAY_BODY_MAX_CHARS = 4 * 1024 * 1024;

export interface RelayFetch {
  readonly requestId: string;
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly body?: string;
  readonly expect: { readonly hostAccountId: string; readonly relayId?: string };
}

/** The port's client as the frame uses it (platform `RelayRpcClient`). */
export interface RelayChannel {
  request(type: string, payload: unknown): Promise<unknown>;
  onEvent(type: string, listener: (payload: unknown) => void): () => void;
  onOpen(listener: () => void): () => void;
}

export interface FanslyRelayDeps {
  readonly channel: RelayChannel;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The account the tab was on when it mounted the frame. */
  readonly hostAccountId: string;
  /** This frame's own id. */
  readonly relayId: string;
  /** Where Fansly's address is served from: itself (release), or a test build's stand; null — not Fansly's API. */
  readonly serve: (url: string) => string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]{0,39}$/;
const HEADER_NAME = /^[a-z0-9-]{1,64}$/;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The background's request as the frame takes it (the background checked it by Fansly's schema too); null — not one. */
export function readRelayFetch(raw: unknown): RelayFetch | null {
  if (!record(raw)) return null;
  const { requestId, method, url, headers, body, expect } = raw;
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return null;
  if (method !== 'GET' && method !== 'POST') return null;
  if (typeof url !== 'string' || url.length > RELAY_URL_MAX_CHARS) return null;
  if (!Array.isArray(headers) || headers.length > 32) return null;
  const list: Array<readonly [string, string]> = [];
  for (const entry of headers as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [name, value] = entry as unknown[];
    if (typeof name !== 'string' || !HEADER_NAME.test(name) || typeof value !== 'string' || value.length > 4096) return null;
    list.push([name, value]);
  }
  if (body !== undefined && (typeof body !== 'string' || body.length > 256 * 1024)) return null;
  if (!record(expect) || typeof expect['hostAccountId'] !== 'string' || !ID.test(expect['hostAccountId'])) return null;
  const relayId = expect['relayId'];
  if (relayId !== undefined && (typeof relayId !== 'string' || !UUID.test(relayId))) return null;
  return {
    requestId,
    method,
    url,
    headers: list,
    ...(body === undefined ? {} : { body }),
    expect: { hostAccountId: expect['hostAccountId'], ...(relayId === undefined ? {} : { relayId }) },
  };
}

/** The frame's address names its account: `fansly-relay.html#a=<id>`; null — none (the frame then serves nothing). */
export function accountOfAddress(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('a');
  return value !== null && ID.test(value) ? value : null;
}

/** Fansly's address as the frame serves it: as it is, or under a test build's stand (`<origin>/api/v1/`). */
export function serveFrom(standBase: string | null): (url: string) => string | null {
  return (url) => {
    if (!url.startsWith(RELAY_TARGET)) return null;
    return standBase === null ? url : `${standBase}${url.slice(RELAY_TARGET.length)}`;
  };
}

export interface FanslyRelay {
  /** Requests under way. */
  inflight(): number;
  stop(): void;
}

export function startFanslyRelay(deps: FanslyRelayDeps): FanslyRelay {
  const { channel } = deps;
  const inflight = new Map<string, AbortController>();
  const reply = (type: 'fansly.relay.head' | 'fansly.relay.body' | 'fansly.relay.failure', payload: Record<string, unknown>): void => {
    // Nobody may wait for this answer any more (the background slept, the port went): nothing to do about it.
    void channel.request(type, payload).catch(() => undefined);
  };

  async function run(request: RelayFetch, target: string, controller: AbortController): Promise<void> {
    try {
      const response = await deps.fetch(target, {
        method: request.method,
        headers: request.headers.map(([name, value]): [string, string] => [name, value]),
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      reply('fansly.relay.head', {
        requestId: request.requestId,
        status: response.status,
        headers: RELAY_RESPONSE_HEADERS.flatMap((name): Array<[string, string]> => {
          const value = response.headers.get(name);
          return value === null ? [] : [[name, value.slice(0, 4096)]];
        }),
      });
      const text = await response.text();
      if (text.length > RELAY_BODY_MAX_CHARS) reply('fansly.relay.failure', { requestId: request.requestId, reason: 'too-large' });
      else reply('fansly.relay.body', { requestId: request.requestId, body: text });
    } catch {
      reply('fansly.relay.failure', { requestId: request.requestId, reason: controller.signal.aborted ? 'aborted' : 'network' });
    } finally {
      inflight.delete(request.requestId);
    }
  }

  const offOpen = channel.onOpen(() => {
    void channel.request('fansly.relay.hello', { hostAccountId: deps.hostAccountId, relayId: deps.relayId }).catch(() => undefined);
  });
  const offFetch = channel.onEvent('fansly.relay.fetch', (raw) => {
    const request = readRelayFetch(raw);
    if (request === null || inflight.has(request.requestId)) return;
    // Another frame's request: not ours to answer.
    if (request.expect.relayId !== undefined && request.expect.relayId !== deps.relayId) return;
    // The frame's part of the last check, synchronously, right before its own fetch.
    const target = request.expect.hostAccountId === deps.hostAccountId ? deps.serve(request.url) : null;
    if (target === null) {
      reply('fansly.relay.failure', { requestId: request.requestId, reason: 'refused' });
      return;
    }
    const controller = new AbortController();
    inflight.set(request.requestId, controller);
    void run(request, target, controller);
  });
  const offAbort = channel.onEvent('fansly.relay.abort', (raw) => {
    if (record(raw) && typeof raw['requestId'] === 'string') inflight.get(raw['requestId'])?.abort();
  });

  return {
    inflight: () => inflight.size,
    stop() {
      offOpen();
      offFetch();
      offAbort();
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
    },
  };
}
