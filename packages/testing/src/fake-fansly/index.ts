// The fake Fansly (R20 P6b; docs/project-unite/architecture.md §13): what the
// Fansly-like stand page talks to instead of answering itself, and what our
// background will ask — an XHR API (api.ts), a socket (socket.ts), a proxy for
// «Fansly через вкладку» (proxy.ts) and a journal of every call by who made it
// (journal.ts), over a synthetic world (data.ts). Loopback only, under the
// stand's own name `localhost`, as three origins like the real site's three
// hosts (fansly.com, apiv3.fansly.com, wsv3.fansly.com):
//   the page  http://localhost:<stand's Fansly port>   (stand-server.ts)
//   the API   http://localhost:<api port>/api/v1/…
//   the socket ws://localhost:<socket port>?v=3
// `http://` on a loopback NAME is what an MV3 background can reach: its CSP
// upgrades `http://` of any other name to `https` (P3a, spike.md п. 5).
//
// The socket verifies a session DEFAULT_VERIFY_DELAY_MS after the page asked:
// on a page load the route's first request for the fresh end of the open chat
// then starts before `t: 1` and a second one follows it, as on the live site
// (S2 Q1.7: two `/message` requests per load). A test sets the delay to 0 for
// the other order.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { FakeFanslyCommand, FakeFanslyResult } from '../../fixture-fansly/src/server-protocol';
import { LOOPBACK_NAME, closeServers, listen, listenLocalhost } from '../stand/listen';
import { handleFanslyApi } from './api';
import { runCommand } from './control';
import type { FanslyJournal, FanslyVia } from './journal';
import { startFanslyProxy, type FanslyProxy } from './proxy';
import { FanslySocketHub } from './socket';
import { FanslyState } from './state';

export interface FakeFanslyOptions {
  /** The stand page's origin: whose calls are the page's, and who CORS lets in. */
  readonly pageOrigin: string;
  /** 0 (default) = a free port. */
  readonly apiPort?: number;
  readonly socketPort?: number;
  readonly proxyPort?: number;
  /** More names the proxy forwards to (the stand page's own): `host:port` → a loopback port. */
  readonly proxyRoutes?: ReadonlyMap<string, number>;
}

export interface FakeFansly {
  /** `http://localhost:<port>`: the API lives under `/api/v1`. */
  readonly apiOrigin: string;
  /** `ws://localhost:<port>?v=3`, as the page builds its socket address (main:27424). */
  readonly socketUrl: string;
  readonly proxy: FanslyProxy;
  readonly state: FanslyState;
  readonly journal: FanslyJournal;
  readonly hub: FanslySocketHub;
  /** The page's session token (synthetic). */
  readonly token: string;
  command(command: FakeFanslyCommand): FakeFanslyResult;
  close(): Promise<void>;
}

const KEEP_ALIVE_MS = 60_000;

export async function startFakeFansly(options: FakeFanslyOptions): Promise<FakeFansly> {
  const state = new FanslyState();
  const hub = new FanslySocketHub(state);
  state.pageOrigin = options.pageOrigin;

  const api =
    (via: FanslyVia) =>
    (request: IncomingMessage, response: ServerResponse): void => {
      void handleFanslyApi(state, hub, request, response, via).catch((error: unknown) => {
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(error) }));
      });
    };
  const noHttp = (_request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(426, { 'content-type': 'text/plain; charset=utf-8' }).end('The fake Fansly socket speaks WebSocket only.');
  };
  // Two listeners a name (127.0.0.1 and ::1) and one more behind the proxy.
  const apiServers: Server[] = [createServer(api('direct')), createServer(api('direct')), createServer(api('proxy'))];
  const socketServers: Server[] = [createServer(noHttp), createServer(noHttp), createServer(noHttp)];
  for (const server of apiServers) {
    server.keepAliveTimeout = KEEP_ALIVE_MS;
    server.on('upgrade', (_request, socket) => socket.destroy());
  }
  for (const [index, server] of socketServers.entries()) {
    server.on('upgrade', (request, socket, head) => hub.handleUpgrade(request, socket, head, index === 2 ? 'proxy' : 'direct'));
  }

  const apiPort = await listenLocalhost(apiServers[0] as Server, apiServers[1] as Server, options.apiPort ?? 0);
  const socketPort = await listenLocalhost(socketServers[0] as Server, socketServers[1] as Server, options.socketPort ?? 0);
  const apiBehindProxy = await listen(apiServers[2] as Server, 0);
  const socketBehindProxy = await listen(socketServers[2] as Server, 0);
  state.apiHost = `${LOOPBACK_NAME}:${apiPort}`;
  state.socketHost = `${LOOPBACK_NAME}:${socketPort}`;
  const proxy = await startFanslyProxy({
    journal: state.journal,
    port: options.proxyPort ?? 0,
    routes: new Map([...(options.proxyRoutes ?? []), [state.apiHost, apiBehindProxy], [state.socketHost, socketBehindProxy]]),
  });

  return {
    apiOrigin: `http://${state.apiHost}`,
    socketUrl: `ws://${state.socketHost}?v=3`,
    proxy,
    state,
    journal: state.journal,
    hub,
    get token() { return state.token; },
    command: (command) => runCommand(state, hub, command),
    close: async () => {
      state.releaseHanging();
      await proxy.close();
      await hub.close();
      await closeServers([...apiServers, ...socketServers]);
    },
  };
}

export { DEFAULT_VERIFY_DELAY_MS } from './state';
export { FS_NET_1, describeViolations, type FanslyJournalEntry, type FanslyJournalPage, type FanslyRoute, type FanslyViolation } from './journal';
export { fakeFanslyControl, type FakeFanslyControlClient } from './client';
