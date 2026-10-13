// Loopback listeners of the stand: one address, or a NAME — `localhost` — on
// both loopback addresses. Never every interface.

import type { Server } from 'node:http';

/** The loopback name of the Fansly stand and of the fake Fansly: ChatSpace's stand is `127.0.0.1` (architecture.md §13). */
export const LOOPBACK_NAME = 'localhost';

export async function listen(server: Server, port: number, host = '127.0.0.1'): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stand server has no TCP address');
  return address.port;
}

/**
 * A server under the name `localhost`: on 127.0.0.1, and on the same port of ::1 where the machine has IPv6 loopback
 * (a browser may try `localhost` there first). Loopback only, never every interface.
 */
export async function listenLocalhost(primary: Server, secondary: Server, port: number): Promise<number> {
  const actual = await listen(primary, port);
  try {
    await listen(secondary, actual, '::1');
  } catch {
    // No IPv6 loopback (or the port is taken there): 127.0.0.1 alone serves the name.
  }
  return actual;
}

/** Closes the servers that listen, with every connection they hold. */
export async function closeServers(servers: readonly Server[]): Promise<void> {
  const listening = servers.filter((server) => server.listening);
  for (const server of listening) server.closeAllConnections();
  await Promise.all(listening.map((server) => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))));
}
