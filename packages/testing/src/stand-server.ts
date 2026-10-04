// Loopback stand server for e2e (architecture.md §12 п. 3–4), 127.0.0.1 only,
// on two origins like ChatSpace (page on chat.<domain>, API and socket on the
// apex):
// - the page origin: the ChatSpace-like fixture app (packages/testing/
//   fixture-chatspace, built into .cache/fixture-chatspace) on `/`,
//   `/accounts/...` and its assets, the session-token endpoint, control
//   endpoints for tests (`/__stand/...`), the M0 spike page (`/spike.html`)
//   and the UI galleries (`/kit-gallery/`, `/dock-gallery/`, `/boards-gallery/`, `/pages-gallery/`, built into .cache/*-gallery);
// - the API origin: the native API (`/api/...`, CORS for the page origin with
//   preflights) and the socket (`/api/chat-space/ws`), with synthetic data.
// A journal labels every call by who made it (protocol.ts CallOrigin).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

import {
  CONTROL_REQUEST_HEADER,
  NATIVE_REQUEST_HEADER,
  STAND_API_ORIGIN_META,
  STAND_API_PREFIX,
  STAND_CONTROL_PREFIX,
  STAND_TOKEN_PATH,
  STAND_WS_PATH,
  type CallOrigin,
} from '../fixture-chatspace/src/protocol';
import { handleApi, sendJson, type ApiContext } from './stand/api';
import { handleControl, type EgressLog } from './stand/control';
import { ServerJournal } from './stand/journal';
import { FIXTURE_BUILD_DIR, GALLERIES, SPIKE_STAND_DIR } from './stand/paths';
import { SocketHub } from './stand/socket-hub';
import { StandState } from './stand/state';

export interface StandServerOptions {
  /** Page origin port; 0 = pick a free port. */
  readonly port?: number;
  /** API origin port; 0 = pick a free port. */
  readonly apiPort?: number;
  /** Where the e2e egress sink records outside attempts (exposed at /__stand/egress). */
  readonly egress?: EgressLog;
  /** Built fixture app; defaults to .cache/fixture-chatspace. */
  readonly fixtureDir?: string;
  /** How long a socket may stay silent before it is labelled foreign (ms). */
  readonly socketGraceMs?: number;
}

export interface StandServer {
  /** The page origin (app, control, session token). */
  readonly origin: string;
  /** The API origin (native API and socket). */
  readonly apiOrigin: string;
  readonly port: number;
  readonly apiPort: number;
  readonly state: StandState;
  readonly journal: ServerJournal;
  readonly hub: SocketHub;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Pages of the M0 spike stand (packages/testing/stand). */
const SPIKE_FILES = new Set(['/spike.html', '/stand.js', '/stand.css']);

/** A CSP at least as strict as a modern SPA's: no inline script, no eval, self only. */
export const STRICT_STAND_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'";

/**
 * The same strictness for the ChatSpace-like fixture (`?csp=strict` on any of
 * its paths): the page may also talk to its own API origin and socket, and
 * nothing else — no inline script or style, no eval. Our UI must work under
 * it (lazy chunks by import(), sheets adopted in closed roots).
 */
export function strictFixtureCsp(apiOrigin: string): string {
  const socket = apiOrigin.replace(/^http/, 'ws');
  return `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${apiOrigin} ${socket}; object-src 'none'; base-uri 'none'`;
}

const API_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const API_ALLOWED_HEADERS = `authorization, content-type, ${NATIVE_REQUEST_HEADER}`;
const PREFLIGHT_MAX_AGE_S = 600;
const KEEP_ALIVE_MS = 60_000;
const DEFAULT_SOCKET_GRACE_MS = 5000;

const headerText = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value.join(',') : value);

/**
 * Native request ids: each may be answered once. A second request with an id
 * already answered is a replay. A browser that silently re-sends a request
 * whose connection died before any answer (idempotent retry on a reset
 * keep-alive socket) is not.
 */
class NativeIds {
  private readonly ids = new Map<string, { state: 'open' | 'answered' | 'dropped'; readonly response: ServerResponse }>();

  /** null = fresh; otherwise the id it replays. */
  claim(id: string, response: ServerResponse): string | null {
    const seen = this.ids.get(id);
    if (seen?.state === 'answered') return id;
    // Still open: a re-send is the browser's only if the first connection is already gone.
    if (seen?.state === 'open' && seen.response.socket !== null && !seen.response.socket.destroyed) return id;
    const entry = { state: 'open' as 'open' | 'answered' | 'dropped', response };
    this.ids.set(id, entry);
    response.on('close', () => {
      entry.state = response.writableFinished ? 'answered' : 'dropped';
    });
    return null;
  }
}

interface Classified {
  readonly origin: CallOrigin;
  readonly replayOf?: string;
}

function classify(request: IncomingMessage, response: ServerResponse, nativeIds: NativeIds): Classified {
  if (request.headers[CONTROL_REQUEST_HEADER] !== undefined) return { origin: 'control' };
  const native = headerText(request.headers[NATIVE_REQUEST_HEADER]);
  if (native !== undefined) {
    const replayOf = nativeIds.claim(native, response);
    return replayOf === null ? { origin: 'native' } : { origin: 'foreign', replayOf };
  }
  if (request.method === 'OPTIONS') {
    // A CORS preflight carries no custom header, only their names.
    const asked = (headerText(request.headers['access-control-request-headers']) ?? '').toLowerCase().split(',').map((name) => name.trim());
    return { origin: asked.includes(NATIVE_REQUEST_HEADER) ? 'native' : 'foreign' };
  }
  // Navigations and page subresources name what they load; a fetch/XHR says `empty`.
  const dest = headerText(request.headers['sec-fetch-dest']);
  if (request.method === 'GET' && dest !== undefined && dest !== 'empty') return { origin: 'asset' };
  return { origin: 'foreign' };
}

async function serveFile(response: ServerResponse, file: string, csp: string | null, transform?: (text: string) => string): Promise<number> {
  try {
    const raw = await readFile(file);
    const body = transform === undefined ? raw : transform(raw.toString('utf8'));
    const headers: Record<string, string> = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (csp !== null) headers['content-security-policy'] = csp;
    response.writeHead(200, headers).end(body);
    return 200;
  } catch {
    response.writeHead(404).end();
    return 404;
  }
}

const META_PATTERN = new RegExp(`(<meta name="${STAND_API_ORIGIN_META}" content=")[^"]*(")`);

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stand server has no TCP address');
  return address.port;
}

/** The gallery a normalized relative path belongs to (`kit-gallery/x.js` → `/kit-gallery/`), or null. */
function galleryOf(relative: string): string | null {
  return Object.keys(GALLERIES).find((base) => `/${relative}/`.startsWith(base)) ?? null;
}

export async function startStandServer(options: StandServerOptions = {}): Promise<StandServer> {
  const state = new StandState();
  const journal = new ServerJournal();
  const hub = new SocketHub(state, journal, { graceMs: options.socketGraceMs ?? DEFAULT_SOCKET_GRACE_MS });
  const fixtureDir = options.fixtureDir ?? FIXTURE_BUILD_DIR;
  const nativeIds = new NativeIds();
  const context: ApiContext & { egress: EgressLog | null } = { state, journal, hub, hanging: new Set(), egress: options.egress ?? null };
  let pageOrigin = '';
  let apiOrigin = '';

  const record = (classified: Classified, method: string, path: string, status: number): void => {
    journal.record({ kind: 'http', origin: classified.origin, method, path, status, ...(classified.replayOf !== undefined ? { detail: { replayOf: classified.replayOf } } : {}) });
  };

  const handlePage = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const classified = classify(request, response, nativeIds);

    if (path.startsWith(STAND_CONTROL_PREFIX)) {
      if (classified.origin !== 'control' && path !== STAND_TOKEN_PATH) {
        sendJson(response, 403, { error: 'control endpoints need the control header' });
        record(classified, method, path, 403);
        return;
      }
      await handleControl(context, request, response, url, classified.origin);
      return;
    }

    const relative = normalize(path).replace(/^([/\\])+/, '');
    let status: number;
    if (relative.startsWith('..')) {
      response.writeHead(400).end();
      status = 400;
    } else if (path.startsWith(STAND_API_PREFIX)) {
      // The API lives on its own origin; the page origin has none.
      sendJson(response, 404, { error: 'the API is on the API origin' });
      status = 404;
    } else if (SPIKE_FILES.has(path)) {
      status = await serveFile(response, join(SPIKE_STAND_DIR, relative), url.searchParams.get('csp') === 'strict' ? STRICT_STAND_CSP : null);
    } else if (galleryOf(relative) !== null) {
      // A gallery of our UI (normalized path, so no `..` leaves its folder): the index for the folder, assets by name.
      const base = galleryOf(relative) as string;
      const inside = relative.slice(base.length - 1);
      status = await serveFile(response, join(GALLERIES[base] as string, inside === '' || inside.endsWith('/') ? `${inside}index.html` : inside), null);
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
      status = 204;
    } else if (path.startsWith('/assets/')) {
      status = await serveFile(response, join(fixtureDir, relative), null);
    } else if (existsSync(join(fixtureDir, 'index.html'))) {
      // History-mode SPA: every other path is the app's index, told where its API is.
      status = await serveFile(response, join(fixtureDir, 'index.html'), url.searchParams.get('csp') === 'strict' ? strictFixtureCsp(apiOrigin) : null, (text) =>
        text.replace(META_PATTERN, `$1${apiOrigin}$2`),
      );
    } else {
      response
        .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        .end('The ChatSpace fixture is not built: run `pnpm --filter @cg/testing build:stand`.');
      status = 503;
    }
    record(classified, method, `${path}${url.search}`, status);
  };

  const handleApiOrigin = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const method = request.method ?? 'GET';
    const classified = classify(request, response, nativeIds);
    // CORS for the page origin only; every answer carries it, errors included.
    response.setHeader('access-control-allow-origin', pageOrigin);
    response.setHeader('vary', 'Origin');
    if (method === 'OPTIONS') {
      response
        .writeHead(204, { 'access-control-allow-methods': API_METHODS, 'access-control-allow-headers': API_ALLOWED_HEADERS, 'access-control-max-age': String(PREFLIGHT_MAX_AGE_S) })
        .end();
      record(classified, method, `${url.pathname}${url.search}`, 204);
      return;
    }
    if (!url.pathname.startsWith(STAND_API_PREFIX)) {
      sendJson(response, 404, { error: 'not an API path' });
      record(classified, method, url.pathname, 404);
      return;
    }
    await handleApi(context, request, response, url, classified.origin, classified.replayOf);
  };

  const onError = (response: ServerResponse) => (error: unknown) => {
    if (!response.headersSent) sendJson(response, 500, { error: String(error) });
  };
  const pageServer: Server = createServer((request, response) => void handlePage(request, response).catch(onError(response)));
  const apiServer: Server = createServer((request, response) => void handleApiOrigin(request, response).catch(onError(response)));
  for (const server of [pageServer, apiServer]) server.keepAliveTimeout = KEEP_ALIVE_MS;
  pageServer.on('upgrade', (_request, socket) => socket.destroy());
  apiServer.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === STAND_WS_PATH) hub.handleUpgrade(request, socket, head);
    else socket.destroy();
  });

  const port = await listen(pageServer, options.port ?? 0);
  const apiPort = await listen(apiServer, options.apiPort ?? 0);
  pageOrigin = `http://127.0.0.1:${port}`;
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  return {
    origin: pageOrigin,
    apiOrigin,
    port,
    apiPort,
    state,
    journal,
    hub,
    close: async () => {
      for (const response of context.hanging) response.destroy();
      await hub.close();
      for (const server of [pageServer, apiServer]) server.closeAllConnections();
      await Promise.all([pageServer, apiServer].map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
    },
  };
}
