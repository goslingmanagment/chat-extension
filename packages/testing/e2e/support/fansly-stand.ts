// Helpers for the Fansly-like stand in e2e (fixture-fansly, R20 P6a): its
// origin (its own loopback name, `localhost`), opening a page and waiting for
// the app, the page's test-control API (window.__fanslyStand), and the fake
// Fansly the page asks (R20 P6b): its commands and its journal by caller —
// where «only FS-NET-1» and «no `/message/ack` of ours» are checked — and the
// page's own «settled» signal for a test that compares journals.

import { request as httpRequest } from 'node:http';

import { browser } from '@wdio/globals';

import { CONTROL_REQUEST_HEADER, type ServerJournalEntry, type ServerJournalPage } from '../../fixture-chatspace/src/protocol';
import { FANSLY_STAND_GLOBAL, FANSLY_STAND_READY_ATTRIBUTE, type FanslyStandControl } from '../../fixture-fansly/src/protocol';
import { fakeFanslyControl, type FakeFanslyControlClient } from '../../src/fake-fansly';
import { FANSLY_STAND_JOURNAL_PATH } from '../../src/stand-server';

export function fanslyStandOrigin(): string {
  const origin = process.env['CG_FANSLY_STAND_ORIGIN'];
  if (!origin) throw new Error('CG_FANSLY_STAND_ORIGIN not set (wdio onPrepare starts the stand)');
  return origin;
}

export const fanslyStandUrl = (path: string): string => new URL(path, fanslyStandOrigin()).toString();

/** The fake Fansly from the test process: commands (a fan writes, the socket closes, a 429…) and its journal. */
export function fakeFansly(): FakeFanslyControlClient {
  const origin = process.env['CG_FANSLY_API_ORIGIN'];
  if (!origin) throw new Error('CG_FANSLY_API_ORIGIN not set (wdio onPrepare starts the stand)');
  return fakeFanslyControl(origin);
}

export async function waitForFanslyStandReady(timeout = 15_000): Promise<void> {
  let state: string | null = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await browser.execute((name: string) => document.documentElement.getAttribute(name), FANSLY_STAND_READY_ATTRIBUTE);
        return state === '1' || state === 'failed';
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`the Fansly stand is not ready in ${timeout} ms (${FANSLY_STAND_READY_ATTRIBUTE}=${String(state)})`);
  }
  if (state === 'failed') throw new Error('the Fansly stand failed to boot (its journal has boot-failed)');
}

/**
 * Waits until the stand page has settled — `window.__fanslyStand.idle()`: its socket verified, no request of its own
 * in flight, its unread reading over, no read mark waiting or going out — and has stayed so for `stableMs`. The
 * moment to mark a journal and the moment to read one: the page sends its marks later and in chunks 200 ms apart, so
 * a window cut by a pause lands in a different place of that series every run. Watched inside the page, so no flip
 * between two WebDriver calls is missed. A page whose request never ends (a neighbour's guard swallowed it) never
 * settles: this throws.
 */
export async function waitForFanslyStandIdle(timeout = 15_000, stableMs = 300): Promise<void> {
  const settled = await browser.execute(
    async (global: string, stable: number, limit: number) => {
      const control = (window as unknown as Record<string, { idle?: () => boolean } | undefined>)[global];
      const started = performance.now();
      let since: number | null = null;
      for (;;) {
        const now = performance.now();
        if (control?.idle?.() === true) {
          since ??= now;
          if (now - since >= stable) return true;
        } else since = null;
        if (now - started > limit) return false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    FANSLY_STAND_GLOBAL,
    stableMs,
    timeout,
  );
  if (!settled) throw new Error(`the Fansly stand page did not settle in ${timeout} ms (a request in flight, marks to send, or no verified socket)`);
}

export async function openFanslyStand(path: string): Promise<void> {
  await browser.url(fanslyStandUrl(path));
  await waitForFanslyStandReady();
}

type Methods = { [K in keyof FanslyStandControl as FanslyStandControl[K] extends (...args: never[]) => unknown ? K : never]: FanslyStandControl[K] };

/** Calls a method of `window.__fanslyStand` in the page and returns its (JSON) result. */
export async function callFansly<K extends keyof Methods>(method: K, ...args: Parameters<Methods[K]>): Promise<Awaited<ReturnType<Methods[K]>>> {
  const values: unknown[] = args;
  const result = await browser.execute(
    async (global: string, name: string, list: unknown[]) => {
      const control = (window as unknown as Record<string, Record<string, (...items: unknown[]) => unknown>>)[global];
      const fn = control?.[name];
      if (typeof fn !== 'function') throw new Error(`no ${global}.${name}`);
      const value = await fn.apply(control, list);
      return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
    },
    FANSLY_STAND_GLOBAL,
    String(method),
    values,
  );
  return result as Awaited<ReturnType<Methods[K]>>;
}

/** The ids of the stand's synthetic world. */
export async function fanslyIds(): Promise<FanslyStandControl['ids']> {
  return browser.execute((global: string) => (window as unknown as Record<string, FanslyStandControl>)[global]?.ids as FanslyStandControl['ids'], FANSLY_STAND_GLOBAL);
}

/** The main chat's anchors: only under `app-messages-conversation-route` (docs/research/fansly.md §4). */
export const FANSLY_MAIN = {
  route: 'app-messages-conversation-route',
  container: 'app-messages-conversation-route > app-group-message-container',
  composer: 'app-messages-conversation-route > app-group-message-container > app-group-message-input',
  field: 'app-messages-conversation-route app-group-message-input textarea.message-input',
  send: 'app-messages-conversation-route app-group-message-input .send-button',
  list: 'app-messages-conversation-route .message-content-list',
} as const;

/** The Fansly stand's server journal, read from the test process over node:http (127.0.0.1, under the stand's own name). */
async function readFanslyJournal(since: number): Promise<ServerJournalPage> {
  const origin = new URL(fanslyStandOrigin());
  const text = await new Promise<string>((resolve, reject) => {
    const call = httpRequest(
      { hostname: '127.0.0.1', port: origin.port, path: `${FANSLY_STAND_JOURNAL_PATH}?since=${since}`, headers: { host: origin.host, [CONTROL_REQUEST_HEADER]: '1' } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => (response.statusCode === 200 ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error(`Fansly stand journal: HTTP ${String(response.statusCode)}`))));
      },
    );
    call.on('error', reject);
    call.end();
  });
  return JSON.parse(text) as ServerJournalPage;
}

export const fanslyStandServer = {
  /** Sequence number to read from later. */
  mark: async (): Promise<number> => (await readFanslyJournal(0)).next,
  journal: async (since = 0): Promise<readonly ServerJournalEntry[]> => (await readFanslyJournal(since)).entries,
};
