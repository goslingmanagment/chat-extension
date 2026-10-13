// The FBuddy-like neighbour in e2e (R20 P6d; src/fake-fansly/neighbor): a
// page of the Fansly stand with the neighbour in a chosen mode — by its own
// address (`?stand-neighbor=<spec>`) or by the stand's default for every later
// load (`setFanslyNeighbor`, e.g. for pages our extension reloads) — and its
// test control in the page (`window.__fanslyNeighbor`). Every later Fansly PR
// that touches the tap, the XHR observer, the dock, insertion, sending or the
// header runs itself next to it in `off` and `after` (plan.md §0).

import { request as httpRequest } from 'node:http';

import { browser } from '@wdio/globals';

import { CONTROL_REQUEST_HEADER } from '../../fixture-chatspace/src/protocol';
import { NEIGHBOR_CONTROL_PATH, NEIGHBOR_GLOBAL, NEIGHBOR_PARAM, neighborSpec, type NeighborConfig, type NeighborControl, type NeighborState } from '../../src/fake-fansly/neighbor/protocol';
import { fanslyStandOrigin, fanslyStandUrl, waitForFanslyStandReady } from './fansly-stand';

/** The stand page's address with the neighbour named in it. */
export function neighborUrl(path: string, config: Partial<NeighborConfig>): string {
  const url = new URL(fanslyStandUrl(path));
  url.searchParams.set(NEIGHBOR_PARAM, neighborSpec(config));
  return url.toString();
}

type Methods = { [K in keyof NeighborControl as NeighborControl[K] extends (...args: never[]) => unknown ? K : never]: NeighborControl[K] };

/** Calls a method of `window.__fanslyNeighbor` in the page and returns its (JSON) result. */
export async function callNeighbor<K extends keyof Methods>(method: K, ...args: Parameters<Methods[K]>): Promise<Awaited<ReturnType<Methods[K]>>> {
  const values: unknown[] = args;
  const result = await browser.execute(
    async (global: string, name: string, list: unknown[]) => {
      const control = (window as unknown as Record<string, Record<string, (...items: unknown[]) => unknown>>)[global];
      const fn = control?.[name];
      if (typeof fn !== 'function') throw new Error(`no ${global}.${name}: is the neighbour on this page?`);
      const value = await fn.apply(control, list);
      return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
    },
    NEIGHBOR_GLOBAL,
    String(method),
    values,
  );
  return result as Awaited<ReturnType<Methods[K]>>;
}

export const neighborState = (): Promise<NeighborState> => callNeighbor('state');

/** Opens a stand page with the neighbour in `config` and waits for the page — and for the neighbour unless it is `off`. */
export async function openWithNeighbor(path: string, config: Partial<NeighborConfig>, timeout = 15_000): Promise<void> {
  await browser.url(neighborUrl(path, config));
  await waitForFanslyStandReady(timeout);
  if (config.mode === 'off') return;
  await browser.waitUntil(async () => (await neighborState()).ready, { timeout, interval: 50, timeoutMsg: `the neighbour (${neighborSpec(config)}) did not get ready` });
}

/** The stand's default neighbour for every later page load that names none itself; null — none. */
export async function setFanslyNeighbor(config: Partial<NeighborConfig> | null): Promise<NeighborConfig | null> {
  const origin = new URL(fanslyStandOrigin());
  const body = JSON.stringify(config);
  const text = await new Promise<string>((resolve, reject) => {
    const call = httpRequest(
      {
        hostname: '127.0.0.1',
        port: origin.port,
        path: NEIGHBOR_CONTROL_PATH,
        method: 'POST',
        headers: { host: origin.host, [CONTROL_REQUEST_HEADER]: '1', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => (response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`Fansly stand neighbour: HTTP ${String(response.statusCode)}`))));
      },
    );
    call.on('error', reject);
    call.end(body);
  });
  return (JSON.parse(text) as { neighbor: NeighborConfig | null }).neighbor;
}
