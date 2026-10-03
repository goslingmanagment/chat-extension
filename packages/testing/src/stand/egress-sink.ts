// Egress sink for e2e: the browser profile sends every non-loopback request to
// this loopback "proxy", which records the request line (CONNECT host:443 or
// GET http://host/…) and drops the connection. Nothing leaves the machine and
// no outside name is even resolved; the BiDi network trap reports the same
// attempts from the browser's side.

import { createServer, type Server, type Socket } from 'node:net';

export interface EgressSink {
  readonly port: number;
  /** Request lines seen so far, oldest first. */
  attempts(): readonly string[];
  close(): Promise<void>;
}

const MAX_ATTEMPTS = 1000;

export async function startEgressSink(): Promise<EgressSink> {
  const attempts: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once('data', (chunk: Buffer) => {
      const firstLine = chunk.toString('latin1').split('\r\n', 1)[0] ?? '';
      attempts.push(firstLine.slice(0, 300));
      if (attempts.length > MAX_ATTEMPTS) attempts.shift();
      socket.destroy();
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('egress sink has no TCP address');
  return {
    port: address.port,
    attempts: () => [...attempts],
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/**
 * Firefox prefs that route every non-loopback request through the sink.
 * Loopback (127.0.0.1, localhost) never goes through a proxy in Firefox
 * (`network.proxy.allow_hijacking_localhost` stays false), so the stand and
 * the fake hub are reached directly.
 */
export function egressProxyPrefs(port: number): Record<string, string | number | boolean> {
  return {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': port,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': port,
    'network.proxy.share_proxy_settings': true,
    'network.proxy.allow_hijacking_localhost': false,
    'network.proxy.no_proxies_on': '',
    // No speculative work toward outside names.
    'network.dns.disablePrefetch': true,
    'network.prefetch-next': false,
    'network.http.speculative-parallel-limit': 0,
    'network.captive-portal-service.enabled': false,
    'network.connectivity-service.enabled': false,
    'extensions.update.enabled': false,
    'extensions.getAddons.cache.enabled': false,
    'browser.safebrowsing.malware.enabled': false,
    'browser.safebrowsing.phishing.enabled': false,
    'browser.safebrowsing.downloads.enabled': false,
  };
}
