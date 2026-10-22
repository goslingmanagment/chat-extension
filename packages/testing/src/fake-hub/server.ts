// Loopback mode of the fake hub (architecture.md §12 п. 4): a node:http server
// on 127.0.0.1 only, serving the same pipeline as the in-process fetch, for
// e2e (the test build's hub address points here; the test manifest allows
// loopback). SSE goes out chunk by chunk as the stream produces it; a reset
// step destroys the socket (the client sees a broken body, not an EOF); a
// client that disconnects aborts its stream; a request the hub drops or never
// answers (a voice create scripted `drop` or `hang`) loses its socket with no
// answer at all. The control endpoints (`/__fake-hub/control`,
// `/__fake-hub/journal`) need the control header.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { FakeHub, FakeHubConnectionDrop, type FakeHubOptions } from './hub';

export interface FakeHubServerOptions extends FakeHubOptions {
  /** 0 (default) = a free port. */
  readonly port?: number;
}

export interface FakeHubServer {
  readonly origin: string;
  readonly port: number;
  readonly hub: FakeHub;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function serve(hub: FakeHub, origin: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  const method = (req.method ?? 'GET').toUpperCase();
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  const request = new Request(new URL(req.url ?? '/', origin), {
    method,
    headers,
    signal: abort.signal,
    ...(body === undefined || body.length === 0 ? {} : { body: new Uint8Array(body) }),
  });
  let response: Response;
  try {
    response = await hub.handle(request, abort.signal);
  } catch (error) {
    // Dropped, or never answered and the client gone: the connection closes without a word.
    if (error instanceof FakeHubConnectionDrop || abort.signal.aborted) {
      res.destroy();
      return;
    }
    throw error;
  }
  const out: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    out[name] = value;
  });
  res.writeHead(response.status, out);
  res.flushHeaders();
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Wait until the chunk is handed to the socket: a reset right after must not swallow frames already sent.
      await new Promise<void>((resolve) => res.write(value, () => resolve()));
    }
    res.end();
  } catch {
    // The stream broke (a reset step, the hub closing, the client gone): drop the connection, no clean end.
    res.destroy();
  }
}

/** Starts the fake hub on a loopback port (system clock unless options say otherwise). */
export async function startFakeHub(options: FakeHubServerOptions = {}): Promise<FakeHubServer> {
  let hub: FakeHub | null = null;
  let origin = '';
  const server: Server = createServer((req, res) => {
    if (hub === null) {
      res.writeHead(503).end();
      return;
    }
    serve(hub, origin, req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'internal_error', message: 'fake hub: server error', statusCode: 500 }));
      else res.destroy();
    });
  });
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake hub: no TCP address');
  origin = `http://127.0.0.1:${address.port}`;
  hub = new FakeHub({ clock: 'system', ...options, origin });
  const started = hub;
  return {
    origin,
    port: address.port,
    hub: started,
    close: async () => {
      started.closeStreams();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
