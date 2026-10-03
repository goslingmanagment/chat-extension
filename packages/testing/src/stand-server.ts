// Loopback stand server for e2e (architecture.md §12 п. 3–4). Serves our own
// synthetic pages from packages/testing/stand on 127.0.0.1 only. R02 grows
// this into the full ChatSpace fixture (Vue 3 + Pinia + router + TipTap).

import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface StandServerOptions {
  /** 0 = pick a free port. */
  readonly port?: number;
}

export interface StandServer {
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
}

const STAND_DIR = fileURLToPath(new URL('../stand/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** A CSP at least as strict as a modern SPA's: no inline script, no eval, self only. */
export const STRICT_STAND_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'; base-uri 'none'";

export async function startStandServer(options: StandServerOptions = {}): Promise<StandServer> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relative = normalize(url.pathname === '/' ? '/spike.html' : url.pathname).replace(/^([/\\])+/, '');
      if (relative.startsWith('..')) {
        response.writeHead(400).end();
        return;
      }
      try {
        const body = await readFile(join(STAND_DIR, relative));
        const headers: Record<string, string> = {
          'content-type': TYPES[extname(relative)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        };
        if (url.searchParams.get('csp') === 'strict') headers['content-security-policy'] = STRICT_STAND_CSP;
        response.writeHead(200, headers).end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stand server has no TCP address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
