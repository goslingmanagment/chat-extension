// The stand's proxy: what a container's proxy is to a Fansly tab on a
// chatter's machine. «Fansly через вкладку» (FS-NET-4, architecture.md §8.5)
// exists so that our own request leaves through the tab's proxy instead of
// the chatter's own line; its test needs a proxy to see the request arrive
// through. This one is an HTTP forward proxy on 127.0.0.1 that forwards only
// to the fake Fansly's own names:
// - `GET http://localhost:<api port>/…` (how a browser sends plain HTTP through
//   a proxy) and `CONNECT localhost:<port>` (how it tunnels a socket) go to the
//   name's DOOR BEHIND the proxy — a second listener of the same API or
//   socket, reached only from here, whose calls are journaled `via: 'proxy'`.
//   So «the request went through the proxy» is a fact of the server's journal;
// - any other target is refused and journaled: nothing leaves the machine
//   through it.
// How Firefox is told to use it for one tab — a helper that copies
// Multi-Account Containers' decision — is the relay suite's own (P9c,
// e2e/support/fansly-proxy.ts).

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { connect as netConnect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';

import { closeServers, listen } from '../stand/listen';
import type { FanslyJournal } from './journal';

export interface FanslyProxyOptions {
  /** A public `host:port` of the fake Fansly → the loopback port behind the proxy it is forwarded to. */
  readonly routes: ReadonlyMap<string, number>;
  readonly journal: FanslyJournal;
  /** 0 (default) = a free port. */
  readonly port?: number;
}

export interface FanslyProxy {
  /** `127.0.0.1:<port>`: an HTTP proxy. */
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

/** Headers that belong to the hop to the proxy, not to the request it forwards. */
const HOP_HEADERS = new Set(['proxy-connection', 'proxy-authorization', 'proxy-authenticate']);

export async function startFanslyProxy(options: FanslyProxyOptions): Promise<FanslyProxy> {
  const { routes, journal } = options;
  const tunnels = new Set<Socket | Duplex>();
  const refuse = (target: string, method: string): void => {
    journal.record({ kind: 'proxy-refused', caller: 'foreign', via: 'proxy', method, path: target.slice(0, 300) });
  };

  const forward = (request: IncomingMessage, response: ServerResponse): void => {
    // A proxy request names its target in full: `GET http://host:port/path`.
    let target: URL | null;
    try {
      target = new URL(request.url ?? '');
    } catch {
      target = null;
    }
    const port = target === null || target.protocol !== 'http:' ? undefined : routes.get(target.host);
    if (target === null || port === undefined) {
      refuse(request.url ?? '', request.method ?? 'GET');
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end('The stand proxy forwards to the fake Fansly only.');
      return;
    }
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !HOP_HEADERS.has(name)));
    const upstream = httpRequest({ host: '127.0.0.1', port, method: request.method, path: `${target.pathname}${target.search}`, headers: { ...headers, host: target.host } }, (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    });
    upstream.on('error', () => response.destroy());
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  };

  const server: Server = createServer(forward);
  server.on('connect', (request: IncomingMessage, client: Duplex, head: Buffer) => {
    const port = routes.get(request.url ?? '');
    if (port === undefined) {
      refuse(request.url ?? '', 'CONNECT');
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = netConnect(port, '127.0.0.1', () => {
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

  const port = await listen(server, options.port ?? 0);
  return {
    host: `127.0.0.1:${port}`,
    port,
    close: async () => {
      for (const tunnel of tunnels) tunnel.destroy();
      await closeServers([server]);
    },
  };
}
