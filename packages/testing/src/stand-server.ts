// Loopback stand server for e2e (architecture.md §12 п. 3–4), 127.0.0.1 only,
// on two origins like ChatSpace (page on chat.<domain>, API and socket on the
// apex):
// - the page origin: the ChatSpace-like fixture app (packages/testing/
//   fixture-chatspace, built into .cache/fixture-chatspace) on `/`,
//   `/accounts/...` and its assets, the session-token endpoint, control
//   endpoints for tests (`/__stand/...`), the M0 spike page (`/spike.html`),
//   the UI galleries (`/kit-gallery/`, `/dock-gallery/`, `/boards-gallery/`, `/pages-gallery/`, built into .cache/*-gallery)
//   and the collector of the page's Sentry (`/sentry/api/<project>/envelope/`, stand/sentry-inbox.ts);
// - the API origin: the native API (`/api/...`, CORS for the page origin with
//   preflights) and the socket (`/api/chat-space/ws`), with synthetic data;
// - the Fansly stand (R20 P6a): the Fansly-like page (packages/testing/
//   fixture-fansly, built into .cache/fixture-fansly) on a loopback NAME of its
//   own, `http://localhost:<port>` — ChatSpace's stand is `127.0.0.1`, and an
//   address that two sites claim is refused by the background (architecture.md
//   §13, S1b G-10); a request under any other name is refused here (421). The
//   page is told where the fake Fansly is (R20 P6b, src/fake-fansly: its API,
//   its socket and its session token, in `<meta>` tags of the served page) and
//   asks it by XHR and a socket of its own, as fansly.com asks apiv3 and wsv3.
//   On a test's word it also gets the FBuddy-like neighbour (R20 P6d,
//   src/fake-fansly/neighbor): `?stand-neighbor=<spec>` on the page's address,
//   or a default set with POST /__stand/neighbor (the control header), puts
//   the neighbour's boot script first in the page's `<head>`; its one script
//   is served at /neighbor/neighbor.js.
// - the Telegram stand (docs/specs/2026-10-27-telegram-site.md §6.10): the
//   Telegram Web A-like page (packages/testing/fixture-telegram, built into
//   .cache/fixture-telegram) at `/a/` of a loopback name of its own,
//   `http://telegram.localhost:<port>` (Firefox takes every `*.localhost` for
//   loopback); a request under any other name is refused (421). It talks to
//   nobody: its world is in the page.
// A journal labels every call by who made it (protocol.ts CallOrigin); the
// Fansly stand's page origin keeps its own, and the fake Fansly its own.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { FANSLY_STAND_PARAMS } from '../fixture-fansly/src/protocol';
import { FANSLY_SERVER_META } from '../fixture-fansly/src/server-protocol';

import {
  CONTROL_REQUEST_HEADER,
  NATIVE_REQUEST_HEADER,
  STAND_API_ORIGIN_META,
  STAND_API_PREFIX,
  STAND_CONTROL_PREFIX,
  STAND_SENTRY_PREFIX,
  STAND_TOKEN_PATH,
  STAND_WORLD_ATTRIBUTE,
  STAND_WS_PATH,
  type CallOrigin,
} from '../fixture-chatspace/src/protocol';
import { startFakeFansly, type FakeFansly } from './fake-fansly';
import { NEIGHBOR_CONTROL_PATH, NEIGHBOR_SCRIPT_PATH, neighborConfig, type NeighborConfig } from './fake-fansly/neighbor/protocol';
import { neighborFor, withNeighbor } from './fake-fansly/neighbor/serve';
import { SHOWCASE } from './showcase';
import { handleApi, sendJson, type ApiContext } from './stand/api';
import { handleControl, type EgressLog } from './stand/control';
import { ServerJournal } from './stand/journal';
import { LOOPBACK_NAME, closeServers, listen, listenLocalhost } from './stand/listen';
import { FANSLY_FIXTURE_BUILD_DIR, FANSLY_NEIGHBOR_BUILD_DIR, FIXTURE_BUILD_DIR, GALLERIES, SPIKE_STAND_DIR, TELEGRAM_FIXTURE_BUILD_DIR } from './stand/paths';
import { SENTRY_ENVELOPE_PATH, SentryInbox } from './stand/sentry-inbox';
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
  /** Fansly stand port; 0 = pick a free port. */
  readonly fanslyPort?: number;
  /** Built Fansly stand; defaults to .cache/fixture-fansly. */
  readonly fanslyDir?: string;
  /** Built neighbour (`neighbor.js`); defaults to .cache/fansly-neighbor. */
  readonly neighborDir?: string;
  /** The fake Fansly's API, socket and proxy ports; 0 = pick a free port. */
  readonly fanslyApiPort?: number;
  readonly fanslySocketPort?: number;
  readonly fanslyProxyPort?: number;
  /** Telegram stand port; 0 = pick a free port. */
  readonly telegramPort?: number;
  /** Built Telegram stand; defaults to .cache/fixture-telegram. */
  readonly telegramDir?: string;
}

/** The Telegram stand: Web A's page under its own loopback name (`http://telegram.localhost:<port>/a/`). */
export interface TelegramStandServer {
  /** `http://telegram.localhost:<port>`. */
  readonly origin: string;
  readonly port: number;
  /** Every call to the Telegram stand, labelled like the ChatSpace stand's (assets, foreign). */
  readonly journal: ServerJournal;
}

/** The Fansly stand: its page, under its own loopback name, and the fake Fansly the page asks. */
export interface FanslyStandServer {
  /** `http://localhost:<port>`. */
  readonly origin: string;
  readonly port: number;
  /** Every call to the Fansly stand's PAGE origin, labelled like the ChatSpace stand's (assets, foreign). */
  readonly journal: ServerJournal;
  /** The fake Fansly (R20 P6b): its API origin, socket address, proxy, world, scripts and its own journal by caller. */
  readonly fake: FakeFansly;
  /** The FBuddy-like neighbour (R20 P6d) of every later page load that names none itself. */
  readonly neighbor: FanslyNeighborSetting;
}

/** The stand's default neighbour: null — none (the default); a page's own `?stand-neighbor=` overrides it. */
export interface FanslyNeighborSetting {
  readonly current: NeighborConfig | null;
  set(config: Partial<NeighborConfig> | null): void;
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
  /** What the page's Sentry sent (?stand-sentry=1). */
  readonly sentry: SentryInbox;
  /** The Fansly stand (R20 P6a). */
  readonly fansly: FanslyStandServer;
  /** The Telegram stand (Telegram spec §6.10). */
  readonly telegram: TelegramStandServer;
  close(): Promise<void>;
}

/**
 * The Fansly stand's loopback name (docs/project-unite/architecture.md §13): the test build's Fansly stand
 * permission (apps/extension/src/hosts/fansly.ts, `http://localhost/*`) names it, ChatSpace's (`127.0.0.1`) does not.
 */
export const FANSLY_STAND_HOSTNAME = LOOPBACK_NAME;

/** The Fansly stand's journal for the test process (GET with the control header, `?since=`). */
export const FANSLY_STAND_JOURNAL_PATH = '/__stand/journal';

/**
 * The Telegram stand's loopback name (Telegram spec §6.10): the test build's Telegram permission
 * (`TELEGRAM_STAND_MATCHES`, `http://telegram.localhost/*`) names it, neither ChatSpace's (`127.0.0.1`) nor Fansly's
 * (`localhost`) does. Firefox resolves every `*.localhost` to loopback without asking a resolver.
 */
export const TELEGRAM_STAND_HOSTNAME = 'telegram.localhost';

/** Where Web A lives on its origin: the page is `/a/` and the chat its hash (fixture-telegram/src/protocol.ts). */
const TELEGRAM_PAGE_PATH = '/a/';

/** The Telegram stand's journal for the test process (GET with the control header, `?since=`). */
export const TELEGRAM_STAND_JOURNAL_PATH = '/__stand/journal';

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

/** X54: the path of a chat's messages on the API origin, the one our extension may read itself (the open chat's). */
const OUR_READ_PATH = /^\/api\/v0\/accounts\/\d+\/chats\/\d+\/messages$/;
/** 2026-10-28: the paths of a fan's OnlyMonster notes, which our extension reads and writes for the open chat's fan. */
const OUR_NOTES_PATH = /^\/api\/v0\/accounts\/\d+\/fans\/\d+\/notes(?:\/[A-Za-z0-9_-]+)?$/;
const OUR_NOTES_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

function classify(request: IncomingMessage, response: ServerResponse, nativeIds: NativeIds): Classified {
  if (request.headers[CONTROL_REQUEST_HEADER] !== undefined) return { origin: 'control' };
  const native = headerText(request.headers[NATIVE_REQUEST_HEADER]);
  if (native !== undefined) {
    const replayOf = nativeIds.claim(native, response);
    return replayOf === null ? { origin: 'native' } : { origin: 'foreign', replayOf };
  }
  const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const ourRead = OUR_READ_PATH.test(path);
  const ourNotes = OUR_NOTES_PATH.test(path);
  if (request.method === 'OPTIONS') {
    // A CORS preflight carries no custom header, only their names.
    const asked = (headerText(request.headers['access-control-request-headers']) ?? '').toLowerCase().split(',').map((name) => name.trim());
    const method = headerText(request.headers['access-control-request-method']) ?? '';
    return { origin: asked.includes(NATIVE_REQUEST_HEADER) ? 'native' : (ourRead && method === 'GET') || (ourNotes && OUR_NOTES_METHODS.includes(method)) ? 'ours' : 'foreign' };
  }
  // X54: our read of a chat's messages with the page's bearer; whether it was the open chat's, the tests check.
  if (ourRead && request.method === 'GET' && request.headers.authorization !== undefined) return { origin: 'ours' };
  // 2026-10-28: our read or write of a fan's notes with the page's bearer; whether it was the open chat's fan, the tests check.
  if (ourNotes && OUR_NOTES_METHODS.includes(request.method ?? '') && request.headers.authorization !== undefined) return { origin: 'ours' };
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

const metaPattern = (name: string): RegExp => new RegExp(`(<meta name="${name}" content=")[^"]*(")`);
const META_PATTERN = metaPattern(STAND_API_ORIGIN_META);

/** The showcase world (src/showcase.ts) on a stand page's `<html>`: the page's own words read like a working day's. */
const inWorld = (html: string): string => (SHOWCASE ? html.replace(/<html\b/, `<html ${STAND_WORLD_ATTRIBUTE}="showcase"`) : html);

/** Tells the served Fansly stand page where the fake Fansly is and which session it has (server-protocol.ts). */
function withFanslyServer(html: string, fake: FakeFansly): string {
  const values: ReadonlyArray<readonly [string, string]> = [
    [FANSLY_SERVER_META.api, fake.apiOrigin],
    [FANSLY_SERVER_META.socket, fake.socketUrl],
    [FANSLY_SERVER_META.token, fake.token],
  ];
  return values.reduce((text, [name, value]) => text.replace(metaPattern(name), `$1${value}$2`), html);
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
  const sentry = new SentryInbox();
  const context: ApiContext & { egress: EgressLog | null; sentry: SentryInbox } = { state, journal, hub, hanging: new Set(), egress: options.egress ?? null, sentry };
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

    // The page's own Sentry, on its own origin (no CORS): kept as sent, never journaled.
    if (path.startsWith(STAND_SENTRY_PREFIX)) {
      const inside = path.slice(STAND_SENTRY_PREFIX.length);
      if (method !== 'POST' || !SENTRY_ENVELOPE_PATH.test(inside)) {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      sentry.add(inside, Buffer.concat(chunks).toString('utf8'));
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }

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
        inWorld(text.replace(META_PATTERN, `$1${apiOrigin}$2`)),
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

  const fanslyDir = options.fanslyDir ?? FANSLY_FIXTURE_BUILD_DIR;
  const fanslyJournal = new ServerJournal();
  let fanslyHost = '';
  let fake: FakeFansly | null = null;
  const neighborDir = options.neighborDir ?? FANSLY_NEIGHBOR_BUILD_DIR;
  let standingNeighbor: NeighborConfig | null = null;
  const neighbor: FanslyNeighborSetting = {
    get current() {
      return standingNeighbor;
    },
    set: (config) => {
      standingNeighbor = config === null ? null : neighborConfig(config);
    },
  };
  const handleFansly = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const classified = classify(request, response, nativeIds);
    let status: number;
    const relative = normalize(path).replace(/^([/\\])+/, '');
    if (headerText(request.headers.host) !== fanslyHost) {
      // One stand address, one site: the Fansly stand answers under its own name only.
      response.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end(`The Fansly stand answers at http://${fanslyHost} only.`);
      status = 421;
    } else if (path === FANSLY_STAND_JOURNAL_PATH && classified.origin === 'control') {
      // The test process reads the journal; reading it is not journaled.
      sendJson(response, 200, fanslyJournal.read(Number(url.searchParams.get('since') ?? 0)));
      return;
    } else if (path === NEIGHBOR_CONTROL_PATH && classified.origin === 'control') {
      // The test process sets the default neighbour: a config (partial — defaults fill it) or null.
      if (method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const text = Buffer.concat(chunks).toString('utf8').trim();
        neighbor.set(text === '' ? null : (JSON.parse(text) as Partial<NeighborConfig> | null));
      }
      sendJson(response, 200, { neighbor: neighbor.current });
      return;
    } else if (relative.startsWith('..')) {
      response.writeHead(400).end();
      status = 400;
    } else if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405).end();
      status = 405;
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
      status = 204;
    } else if (path.startsWith('/assets/')) {
      status = await serveFile(response, join(fanslyDir, relative), null);
    } else if (path === NEIGHBOR_SCRIPT_PATH) {
      status = await serveFile(response, join(neighborDir, 'neighbor.js'), null);
    } else if (existsSync(join(fanslyDir, 'index.html'))) {
      // History-mode app: every other path is its index, told where the fake Fansly is — and, if a test asked, with
      // the neighbour's boot script first in its head (a bad `?stand-neighbor=` spec is the test's error: 400).
      let pageNeighbor: NeighborConfig | null;
      try {
        pageNeighbor = neighborFor(url, standingNeighbor);
      } catch (error) {
        response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
        fanslyJournal.record({ kind: 'http', origin: classified.origin, method, path: `${path}${url.search}`, status: 400 });
        return;
      }
      const apiOrigin = fake === null || url.searchParams.get(FANSLY_STAND_PARAMS.backend) === 'local' ? null : fake.apiOrigin;
      status = await serveFile(response, join(fanslyDir, 'index.html'), null, (text) => {
        const served = inWorld(fake === null ? text : withFanslyServer(text, fake));
        return pageNeighbor === null ? served : withNeighbor(served, { config: pageNeighbor, apiOrigin });
      });
    } else {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('The Fansly stand is not built: run `pnpm --filter @cg/testing build:stand`.');
      status = 503;
    }
    fanslyJournal.record({ kind: 'http', origin: classified.origin, method, path: `${path}${url.search}`, status });
  };

  const telegramDir = options.telegramDir ?? TELEGRAM_FIXTURE_BUILD_DIR;
  const telegramJournal = new ServerJournal();
  let telegramHost = '';
  const handleTelegram = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${TELEGRAM_STAND_HOSTNAME}`);
    const path = url.pathname;
    const method = request.method ?? 'GET';
    const classified = classify(request, response, nativeIds);
    let status: number;
    const relative = normalize(path).replace(/^([/\\])+/, '');
    if (headerText(request.headers.host) !== telegramHost) {
      // One stand address, one site: the Telegram stand answers under its own name only.
      response.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end(`The Telegram stand answers at http://${telegramHost} only.`);
      status = 421;
    } else if (path === TELEGRAM_STAND_JOURNAL_PATH && classified.origin === 'control') {
      // The test process reads the journal; reading it is not journaled.
      sendJson(response, 200, telegramJournal.read(Number(url.searchParams.get('since') ?? 0)));
      return;
    } else if (relative.startsWith('..')) {
      response.writeHead(400).end();
      status = 400;
    } else if (method !== 'GET' && method !== 'HEAD') {
      response.writeHead(405).end();
      status = 405;
    } else if (path === '/favicon.ico') {
      response.writeHead(204).end();
      status = 204;
    } else if (path === '/' || path === '/a') {
      // web.telegram.org/ and /a both lead to the app at /a/, the address's query and hash kept by the browser.
      response.writeHead(302, { location: `${TELEGRAM_PAGE_PATH}${url.search}` }).end();
      status = 302;
    } else if (path.startsWith(`${TELEGRAM_PAGE_PATH}assets/`)) {
      status = await serveFile(response, join(telegramDir, relative.slice(TELEGRAM_PAGE_PATH.length - 1)), null);
    } else if (path === TELEGRAM_PAGE_PATH || path === `${TELEGRAM_PAGE_PATH}index.html`) {
      if (existsSync(join(telegramDir, 'index.html'))) status = await serveFile(response, join(telegramDir, 'index.html'), null, inWorld);
      else {
        response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('The Telegram stand is not built: run `pnpm --filter @cg/testing build:stand`.');
        status = 503;
      }
    } else {
      response.writeHead(404).end();
      status = 404;
    }
    telegramJournal.record({ kind: 'http', origin: classified.origin, method, path: `${path}${url.search}`, status });
  };

  const onError = (response: ServerResponse) => (error: unknown) => {
    if (!response.headersSent) sendJson(response, 500, { error: String(error) });
  };
  const pageServer: Server = createServer((request, response) => void handlePage(request, response).catch(onError(response)));
  const apiServer: Server = createServer((request, response) => void handleApiOrigin(request, response).catch(onError(response)));
  const fanslyServers: Server[] = [0, 1].map(() => createServer((request, response) => void handleFansly(request, response).catch(onError(response))));
  const telegramServers: Server[] = [0, 1].map(() => createServer((request, response) => void handleTelegram(request, response).catch(onError(response))));
  for (const server of [pageServer, apiServer, ...fanslyServers, ...telegramServers]) server.keepAliveTimeout = KEEP_ALIVE_MS;
  for (const server of [...fanslyServers, ...telegramServers]) server.on('upgrade', (_request, socket) => socket.destroy());
  pageServer.on('upgrade', (_request, socket) => socket.destroy());
  apiServer.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === STAND_WS_PATH) hub.handleUpgrade(request, socket, head);
    else socket.destroy();
  });

  const port = await listen(pageServer, options.port ?? 0);
  const apiPort = await listen(apiServer, options.apiPort ?? 0);
  const fanslyPort = await listenLocalhost(fanslyServers[0] as Server, fanslyServers[1] as Server, options.fanslyPort ?? 0);
  pageOrigin = `http://127.0.0.1:${port}`;
  apiOrigin = `http://127.0.0.1:${apiPort}`;
  fanslyHost = `${FANSLY_STAND_HOSTNAME}:${fanslyPort}`;
  const fanslyOrigin = `http://${fanslyHost}`;
  // The name resolves to loopback in the browser; the servers listen where `localhost` does (127.0.0.1 and ::1).
  const telegramPort = await listenLocalhost(telegramServers[0] as Server, telegramServers[1] as Server, options.telegramPort ?? 0);
  telegramHost = `${TELEGRAM_STAND_HOSTNAME}:${telegramPort}`;
  const telegramOrigin = `http://${telegramHost}`;
  const fakeFansly = await startFakeFansly({
    pageOrigin: fanslyOrigin,
    apiPort: options.fanslyApiPort ?? 0,
    socketPort: options.fanslySocketPort ?? 0,
    proxyPort: options.fanslyProxyPort ?? 0,
    // A tab behind the proxy loads its page through it too.
    proxyRoutes: new Map([[fanslyHost, fanslyPort]]),
  });
  fake = fakeFansly;
  return {
    origin: pageOrigin,
    apiOrigin,
    port,
    apiPort,
    state,
    journal,
    hub,
    sentry,
    fansly: { origin: fanslyOrigin, port: fanslyPort, journal: fanslyJournal, fake: fakeFansly, neighbor },
    telegram: { origin: telegramOrigin, port: telegramPort, journal: telegramJournal },
    close: async () => {
      for (const response of context.hanging) response.destroy();
      await hub.close();
      await fakeFansly.close();
      await closeServers([pageServer, apiServer, ...fanslyServers, ...telegramServers]);
    },
  };
}
