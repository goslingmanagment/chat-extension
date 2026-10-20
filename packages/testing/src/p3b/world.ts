// The world of the P3b harness (docs/project-unite/spike.md «P3b: как прогнать»;
// e2e/manual/p3b-signed-builds.e2e.ts): what a SIGNED release-flavour build
// meets in a throwaway headless Firefox, on loopback alone.
//
// A release build matches only the real addresses (https://fansly.com/*,
// https://apiv3.fansly.com/*, and its page predicate compares the origin
// `https://fansly.com` exactly), so the Fansly stand is served UNDER THOSE
// NAMES, on port 443 as the browser sees it, without one packet leaving the
// machine:
// - the browser's proxy (`proxyPort`, http and https) is ours. A `CONNECT` to
//   fansly.com:443, apiv3.fansly.com:443 or wsv3.fansly.com:443 is tunnelled to
//   our own TLS front on 127.0.0.1; every other request is recorded and dropped
//   (the egress sink's rule: nothing leaves, no outside name is even resolved —
//   `egress()` lists them, and the spec fails on any);
// - the TLS front holds a throwaway self-signed certificate for the three names
//   (made by openssl into a temporary folder, never kept); the session accepts
//   it (`acceptInsecureCerts`). By the Host header it serves the Fansly-like
//   page (fixture-fansly, as built for the e2e) to fansly.com, forwards
//   apiv3.fansly.com to the fake Fansly's API and upgrades wsv3.fansly.com to
//   its socket — the fake Fansly started for the page origin
//   `https://fansly.com`, its CORS and its journal as on the stand;
// - the page carries a probe as the FIRST script of its head
//   (`data-p3b-start`: were WebSocket and XMLHttpRequest already ours when the
//   page's first script ran — our MAIN script replaces both with a Proxy, whose
//   source text has no name; `data-p3b-notice`: when the reload notice
//   appeared);
// - the update feed (`feedUrl`, plain http on 127.0.0.1, which a browser never
//   sends through a proxy): the test builds carry no update_url, so Firefox
//   asks `extensions.update.url`, which the session points here; `offer()`
//   chooses the XPI it offers (`update_hash` sha256, so http is allowed).
//
// `?p3b-account=b` on the page's address gives the page a second session token
// whose `authorization` names another account (its legacy id is
// SECOND_ACCOUNT): the fake Fansly takes it as live, so the page works as
// before, and the background must bind the tab to the other account.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import type { Duplex } from 'node:stream';

import { FANSLY_SERVER_META } from '../../fixture-fansly/src/server-protocol';
import { startFakeFansly, type FakeFansly } from '../fake-fansly';
import { egressHost, type EgressAttempt } from '../stand/egress-sink';
import { closeServers, listen } from '../stand/listen';
import { FANSLY_FIXTURE_BUILD_DIR } from '../stand/paths';

/** The real names a release build knows; here they lead to our TLS front and nowhere else. */
export const P3B_PAGE_HOST = 'fansly.com';
export const P3B_API_HOST = 'apiv3.fansly.com';
export const P3B_SOCKET_HOST = 'wsv3.fansly.com';
export const P3B_PAGE_ORIGIN = `https://${P3B_PAGE_HOST}`;
const TUNNELLED = new Set([P3B_PAGE_HOST, P3B_API_HOST, P3B_SOCKET_HOST].map((host) => `${host}:443`));
/** The legacy account id the second token names (`?p3b-account=b`); the creator's own is the fake world's. */
export const SECOND_ACCOUNT = '700000000000000002';

/** What the page's first script saw (`data-p3b-start`): true — the native constructor, false — already ours (a Proxy). */
export interface ProbeStart {
  readonly at: number;
  readonly nativeWebSocket: boolean | null;
  readonly nativeXhr: boolean | null;
}

/** The first script of the page's head: what it found, and when the reload notice appeared. */
export const PROBE_SCRIPT = `<script>(function(){var d=document.documentElement;
function native(f,name){try{return Function.prototype.toString.call(f).indexOf(name)>=0}catch(e){return null}}
d.setAttribute('data-p3b-start',JSON.stringify({at:Date.now(),nativeWebSocket:native(window.WebSocket,'WebSocket'),nativeXhr:native(window.XMLHttpRequest,'XMLHttpRequest')}));
new MutationObserver(function(){if(!d.hasAttribute('data-p3b-notice')&&document.querySelector('[data-host="reload-notice"]'))d.setAttribute('data-p3b-notice',String(Date.now()))}).observe(d,{childList:true,subtree:true});
})();</script>`;

export interface FeedOffer {
  readonly version: string;
  readonly file: string;
}

export interface P3bWorld {
  /** The browser's proxy, http and https: 127.0.0.1:<port>. */
  readonly proxyPort: number;
  /** What `extensions.update.url` names: the add-on's id and version are filled in by Firefox. */
  readonly feedUrl: string;
  readonly fake: FakeFansly;
  /** The page's second token (`?p3b-account=b`). */
  readonly secondToken: string;
  /** The feed offers this XPI to the test add-on, or nothing. */
  offer(geckoId: string, offer: FeedOffer | null): void;
  /** How many times Firefox asked the feed, and downloaded an XPI from it. */
  feedStats(): { readonly checks: number; readonly downloads: number };
  /** Requests the proxy dropped: anything not of the three names. */
  egress(): readonly EgressAttempt[];
  close(): Promise<void>;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const metaPattern = (name: string): RegExp => new RegExp(`(<meta name="${name}" content=")[^"]*(")`);

/** A throwaway certificate for the three names: openssl into a temporary folder, read, the folder removed. */
function throwawayCertificate(): { readonly key: Buffer; readonly cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-p3b-tls-'));
  try {
    const san = [P3B_PAGE_HOST, P3B_API_HOST, P3B_SOCKET_HOST].map((host) => `DNS:${host}`).join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', `/CN=${P3B_PAGE_HOST}`, '-addext', `subjectAltName=${san}`, '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' });
    return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hostOf = (request: IncomingMessage): string => (request.headers.host ?? '').replace(/:443$/, '').toLowerCase();

export async function startP3bWorld(options: { readonly fixtureDir?: string } = {}): Promise<P3bWorld> {
  const fixtureDir = options.fixtureDir ?? FANSLY_FIXTURE_BUILD_DIR;
  const fake = await startFakeFansly({ pageOrigin: P3B_PAGE_ORIGIN });
  const fakeApi = new URL(fake.apiOrigin);
  const fakeSocket = new URL(fake.socketUrl);
  // The second account's session: the shape of Fansly's `authorization` (base64 of `<accountId>:…`), live on the fake.
  const secondToken = Buffer.from(`${SECOND_ACCOUNT}:1:2:${randomBytes(12).toString('hex')}`).toString('base64');
  fake.state.labelled.set(secondToken, 'neighbour');

  // ── the page ──
  const page = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', P3B_PAGE_ORIGIN);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const relative = normalize(url.pathname).replace(/^([/\\])+/, '');
    if (relative.startsWith('..')) {
      response.writeHead(400).end();
      return;
    }
    const file = url.pathname.startsWith('/assets/') ? join(fixtureDir, relative) : join(fixtureDir, 'index.html');
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      response.writeHead(file.endsWith('index.html') ? 503 : 404, { 'content-type': 'text/plain; charset=utf-8' }).end('the Fansly stand is not built: pnpm --filter @cg/testing build:stand');
      return;
    }
    if (file.endsWith('index.html')) {
      const token = url.searchParams.get('p3b-account') === 'b' ? secondToken : fake.token;
      const values: ReadonlyArray<readonly [string, string]> = [
        [FANSLY_SERVER_META.api, `https://${P3B_API_HOST}`],
        [FANSLY_SERVER_META.socket, `wss://${P3B_SOCKET_HOST}?v=3`],
        [FANSLY_SERVER_META.token, token],
      ];
      const html = values.reduce((text, [name, value]) => text.replace(metaPattern(name), `$1${value}$2`), body.toString('utf8'));
      body = Buffer.from(html.replace(/<head>/i, (head) => `${head}${PROBE_SCRIPT}`));
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  };

  // ── the API: forwarded to the fake Fansly under the one name it answers to ──
  const api = (request: IncomingMessage, response: ServerResponse): void => {
    const upstream = httpRequest(
      { host: '127.0.0.1', port: Number(fakeApi.port), method: request.method, path: request.url, headers: { ...request.headers, host: fakeApi.host } },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on('error', () => response.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  };

  const tls = throwawayCertificate();
  const front = createHttpsServer({ key: tls.key, cert: tls.cert }, (request, response) => {
    const host = hostOf(request);
    if (host === P3B_PAGE_HOST) void page(request, response).catch(() => response.destroy());
    else if (host === P3B_API_HOST) api(request, response);
    else response.writeHead(421, { 'content-type': 'text/plain; charset=utf-8' }).end(`not one of the stand's names: ${host}`);
  });
  // The socket: the upgrade request goes to the fake Fansly's socket as it came, under the name it answers to.
  front.on('upgrade', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    if (hostOf(request) !== P3B_SOCKET_HOST) {
      client.destroy();
      return;
    }
    const upstream = connect(Number(fakeSocket.port), '127.0.0.1', () => {
      const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1`];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index] ?? '';
        lines.push(`${name}: ${name.toLowerCase() === 'host' ? fakeSocket.host : (request.rawHeaders[index + 1] ?? '')}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  const frontPort = await listen(front, 0);

  // ── the browser's proxy ──
  const attempts: EgressAttempt[] = [];
  let seq = 0;
  const drop = (line: string): void => {
    seq += 1;
    attempts.push({ seq, line: line.slice(0, 300), host: egressHost(line) });
  };
  const tunnels = new Set<Socket | Duplex>();
  const proxy = createHttpServer((request, response) => {
    drop(`${request.method ?? 'GET'} ${request.url ?? ''} HTTP/1.1`);
    response.destroy();
  });
  proxy.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const target = (request.url ?? '').toLowerCase();
    if (!TUNNELLED.has(target)) {
      drop(`CONNECT ${request.url ?? ''} HTTP/1.1`);
      client.destroy();
      return;
    }
    const upstream = connect(frontPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    tunnels.add(upstream).add(client);
    const end = (): void => {
      upstream.destroy();
      client.destroy();
      tunnels.delete(upstream);
      tunnels.delete(client);
    };
    upstream.on('error', end).on('close', end);
    client.on('error', end).on('close', end);
  });
  const proxyPort = await listen(proxy, 0);

  // ── the update feed ──
  const offers = new Map<string, FeedOffer>();
  let checks = 0;
  let downloads = 0;
  let feedOrigin = '';
  const feed = createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/updates.json') {
      checks += 1;
      const id = url.searchParams.get('id') ?? '';
      const offer = offers.get(id);
      const updates =
        offer === undefined
          ? []
          : [{ version: offer.version, update_link: `${feedOrigin}/xpi/${encodeURIComponent(offer.file)}`, update_hash: `sha256:${createHash('sha256').update(readFileSync(offer.file)).digest('hex')}` }];
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ addons: { [id]: { updates } } }));
      return;
    }
    const file = url.pathname.startsWith('/xpi/') ? decodeURIComponent(url.pathname.slice('/xpi/'.length)) : null;
    if (file !== null && [...offers.values()].some((offer) => offer.file === file)) {
      downloads += 1;
      response.writeHead(200, { 'content-type': 'application/x-xpinstall' }).end(readFileSync(file));
      return;
    }
    response.writeHead(404).end();
  });
  const feedPort = await listen(feed, 0);
  feedOrigin = `http://127.0.0.1:${feedPort}`;

  return {
    proxyPort,
    feedUrl: `${feedOrigin}/updates.json?id=%ITEM_ID%&version=%ITEM_VERSION%`,
    fake,
    secondToken,
    offer: (geckoId, offer) => {
      if (offer === null) offers.delete(geckoId);
      else offers.set(geckoId, offer);
    },
    feedStats: () => ({ checks, downloads }),
    egress: () => [...attempts],
    close: async () => {
      for (const socket of tunnels) socket.destroy();
      await closeServers([proxy, feed, front]);
      await fake.close();
    },
  };
}
