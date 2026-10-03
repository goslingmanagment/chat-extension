// Loopback stand server for e2e (architecture.md §12 п. 3–4), 127.0.0.1 only:
// - the ChatSpace-like fixture app (packages/testing/fixture-chatspace, built
//   into .cache/fixture-chatspace) on `/`, `/accounts/...` and its assets;
// - its native API (`/api/...`) and socket (`/api/chat-space/ws`) with
//   synthetic data;
// - control endpoints for tests (`/__stand/...`) and a journal that labels
//   every call by who made it;
// - the M0 spike page (`/spike.html`, static).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

import {
  CONTROL_REQUEST_HEADER,
  NATIVE_REQUEST_HEADER,
  STAND_API_PREFIX,
  STAND_CONTROL_PREFIX,
  STAND_TOKEN_PATH,
  STAND_WS_PATH,
  type CallOrigin,
} from '../fixture-chatspace/src/protocol';
import { handleApi, sendJson, type ApiContext } from './stand/api';
import { handleControl, type EgressLog } from './stand/control';
import { ServerJournal } from './stand/journal';
import { FIXTURE_BUILD_DIR, SPIKE_STAND_DIR } from './stand/paths';
import { SocketHub } from './stand/socket-hub';
import { StandState } from './stand/state';

export interface StandServerOptions {
  /** 0 = pick a free port. */
  readonly port?: number;
  /** Where the e2e egress sink records outside attempts (exposed at /__stand/egress). */
  readonly egress?: EgressLog;
  /** Built fixture app; defaults to .cache/fixture-chatspace. */
  readonly fixtureDir?: string;
}

export interface StandServer {
  readonly origin: string;
  readonly port: number;
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

function originOf(request: IncomingMessage, path: string): CallOrigin {
  if (request.headers[CONTROL_REQUEST_HEADER] !== undefined) return 'control';
  if (request.headers[NATIVE_REQUEST_HEADER] !== undefined) return 'native';
  if (path.startsWith(STAND_API_PREFIX) || path.startsWith(STAND_CONTROL_PREFIX)) return 'foreign';
  return 'asset';
}

async function serveFile(response: ServerResponse, file: string, csp: string | null): Promise<number> {
  try {
    const body = await readFile(file);
    const headers: Record<string, string> = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' };
    if (csp !== null) headers['content-security-policy'] = csp;
    response.writeHead(200, headers).end(body);
    return 200;
  } catch {
    response.writeHead(404).end();
    return 404;
  }
}

export async function startStandServer(options: StandServerOptions = {}): Promise<StandServer> {
  const state = new StandState();
  const journal = new ServerJournal();
  const hub = new SocketHub(state, journal);
  const fixtureDir = options.fixtureDir ?? FIXTURE_BUILD_DIR;
  const context: ApiContext & { egress: EgressLog | null } = { state, journal, hub, hanging: new Set(), egress: options.egress ?? null };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;
    const origin = originOf(request, path);

    if (path.startsWith(STAND_API_PREFIX)) {
      await handleApi(context, request, response, url, origin);
      return;
    }
    if (path.startsWith(STAND_CONTROL_PREFIX)) {
      if (origin !== 'control' && path !== STAND_TOKEN_PATH) {
        sendJson(response, 403, { error: 'control endpoints need the control header' });
        journal.record({ kind: 'http', origin, method: request.method ?? 'GET', path, status: 403 });
        return;
      }
      await handleControl(context, request, response, url, origin);
      return;
    }

    const relative = normalize(path).replace(/^([/\\])+/, '');
    if (relative.startsWith('..')) {
      response.writeHead(400).end();
      return;
    }
    let status: number;
    if (SPIKE_FILES.has(path)) {
      status = await serveFile(response, join(SPIKE_STAND_DIR, relative), url.searchParams.get('csp') === 'strict' ? STRICT_STAND_CSP : null);
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
      status = 204;
    } else if (path.startsWith('/assets/')) {
      status = await serveFile(response, join(fixtureDir, relative), null);
    } else if (existsSync(join(fixtureDir, 'index.html'))) {
      // History-mode SPA: every other path is the app's index.
      status = await serveFile(response, join(fixtureDir, 'index.html'), null);
    } else {
      response
        .writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
        .end('The ChatSpace fixture is not built: run `pnpm --filter @cg/testing build:stand`.');
      status = 503;
    }
    journal.record({ kind: 'http', origin, method: request.method ?? 'GET', path, status });
  };

  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) sendJson(response, 500, { error: String(error) });
    });
  });
  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === STAND_WS_PATH) hub.handleUpgrade(request, socket, head);
    else socket.destroy();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stand server has no TCP address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    state,
    journal,
    hub,
    close: async () => {
      for (const response of context.hanging) response.destroy();
      await hub.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
