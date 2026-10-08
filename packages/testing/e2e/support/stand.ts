// Helpers for the ChatSpace-like stand in e2e: URLs, opening the page, the
// page's test-control API (window.__stand) and the server's control endpoints
// and journal (read from Node, never through the browser).

import { request as httpRequest } from 'node:http';

import { browser } from '@wdio/globals';

import {
  CONTROL_REQUEST_HEADER,
  type CallOrigin,
  type MimicState,
  type SendOutcome,
  type ServerJournalEntry,
  type SocketTraffic,
  type ServerJournalPage,
  type StandBreak,
  type StandControl,
} from '../../fixture-chatspace/src/protocol';
import { STAND_IDS } from '../../src/stand/dataset';
import type { EgressPage } from '../../src/stand/egress-sink';

export { STAND_IDS };

export function standOrigin(): string {
  const origin = process.env['CG_STAND_ORIGIN'];
  if (!origin) throw new Error('CG_STAND_ORIGIN not set (wdio onPrepare starts the stand)');
  return origin;
}

/** The stand's API and socket origin (a second loopback origin, like ChatSpace's apex). */
export function standApiOrigin(): string {
  const origin = process.env['CG_STAND_API_ORIGIN'];
  if (!origin) throw new Error('CG_STAND_API_ORIGIN not set (wdio onPrepare starts the stand)');
  return origin;
}

export const chatPath = (accountId: string, chatId?: string): string => `/accounts/${accountId}/chats/${chatId ?? ''}`;

export async function waitForStandReady(timeout = 15_000): Promise<void> {
  let state: string | null = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await browser.execute(() => document.documentElement.getAttribute('data-stand-ready'));
        return state === '1' || state === 'failed';
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`stand page not ready in ${timeout} ms (data-stand-ready=${String(state)})`);
  }
  if (state === 'failed') throw new Error('stand page failed to boot (see window.__stand journal / boot-failed)');
}

/** Opens a stand path (optionally as a «new build» without some anchors, or with a slow start) and waits for the app — and for the open chat, if any. */
export async function openStand(path: string, options: { readonly breaks?: readonly StandBreak[]; readonly waitForChat?: boolean; readonly csp?: 'strict'; readonly slowStartMs?: number } = {}): Promise<void> {
  const url = new URL(path, standOrigin());
  if (options.breaks !== undefined && options.breaks.length > 0) url.searchParams.set('stand-break', options.breaks.join(','));
  // A slow start: the app is on the page this long before its app-wide data start to load.
  if (options.slowStartMs !== undefined) url.searchParams.set('stand-slow-start', String(options.slowStartMs));
  // The fixture's document comes with a strict CSP (src/stand-server.ts `strictFixtureCsp`).
  if (options.csp !== undefined) url.searchParams.set('csp', options.csp);
  await browser.url(url.toString());
  await waitForStandReady();
  const chat = /^\/accounts\/([^/]+)\/chats\/([^/?#]+)/.exec(url.pathname);
  if (chat !== null && options.waitForChat !== false) await waitForChatReady(chat[1] ?? '', chat[2] ?? '');
}

/** The open chat has its first history page and a shown composer with a live editor. */
export async function waitForChatReady(accountId: string, chatId: string, timeout = 10_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const history = await callStand('queryState', ['chatMessages', accountId, chatId]);
      const composer = (await callStand('composers')).find((item) => item.accountId === accountId && item.chatId === chatId && item.shown);
      return history.hasData && composer?.hasEditor === true;
    },
    { timeout, interval: 50, timeoutMsg: `chat ${accountId}/${chatId} not ready in ${timeout} ms` },
  );
}

type Method = { [K in keyof StandControl]: StandControl[K] extends (...args: never[]) => unknown ? K : never }[keyof StandControl];
type Fn<K extends Method> = StandControl[K] extends (...args: infer A) => infer R ? { args: A; result: Awaited<R> } : never;

/** Calls `window.__stand[method](...args)` in the page and returns its (JSON) result. */
export async function callStand<K extends Method>(method: K, ...args: Fn<K>['args']): Promise<Fn<K>['result']> {
  const name: string = method;
  const list: unknown[] = [...args];
  const result: unknown = await browser.execute(
    async (name: string, list: unknown[]) => {
      const api = (window as unknown as { __stand?: Record<string, (...items: unknown[]) => unknown> }).__stand;
      if (api === undefined) throw new Error('window.__stand is missing');
      const fn = api[name];
      if (typeof fn !== 'function') throw new Error(`window.__stand.${name} is not a function`);
      return (await fn(...list)) ?? null;
    },
    name,
    list,
  );
  return result;
}

/**
 * One control call over node:http. In the wdio worker the global fetch often
 * waited 0.1–1.9 s on its first call after a pause (the server answers in
 * ~1 ms), which the per-test trap reads turned into seconds per spec.
 */
async function control(path: string, init: { readonly method?: string; readonly body?: unknown } = {}): Promise<unknown> {
  const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  const { status, text } = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = httpRequest(
      `${standOrigin()}${path}`,
      {
        method: init.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { [CONTROL_REQUEST_HEADER]: '1', 'content-type': 'application/json', ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    request.end(body);
  });
  if (status < 200 || status >= 300) throw new Error(`stand control ${path}: HTTP ${status}`);
  return JSON.parse(text) as unknown;
}

/** The stand server's control API, from the test process. */
export const standServer = {
  reset: async (): Promise<void> => {
    await control('/__stand/reset', { body: {} });
  },
  journal: async (since = 0): Promise<ServerJournalPage> => (await control(`/__stand/journal?since=${since}`)) as ServerJournalPage,
  /** Sequence number to read from later («everything after this point»). */
  mark: async (): Promise<number> => ((await control('/__stand/journal?since=0')) as ServerJournalPage).next,
  script: async (accountId: string, chatId: string, outcomes: readonly SendOutcome[]): Promise<void> => {
    await control('/__stand/script/send', { body: { accountId, chatId, outcomes } });
  },
  fanMessage: async (accountId: string, fanId: string, text?: string): Promise<string> =>
    ((await control('/__stand/fan-message', { body: { accountId, fanId, ...(text !== undefined ? { text } : {}) } })) as { id: string }).id,
  wsFrame: async (frame: Record<string, unknown>, accountId: string | null = null): Promise<number> =>
    ((await control('/__stand/ws/frame', { body: { frame, accountId } })) as { delivered: number }).delivered,
  wsClose: async (code = 4000): Promise<number> => ((await control('/__stand/ws/close', { body: { code } })) as { closed: number }).closed,
  withholdAuth: async (withhold: boolean): Promise<void> => {
    await control('/__stand/ws/auth', { body: { withhold } });
  },
  /** What the socket sends on its own (summaries, typing storms, stray accounts); `reset` restores the defaults. */
  traffic: async (patch: Partial<SocketTraffic>): Promise<void> => {
    await control('/__stand/ws/traffic', { body: patch });
  },
  setMimic: async (mimic: MimicState): Promise<void> => {
    await control('/__stand/state', { body: { mimic } });
  },
  /** Takes an account out of (or back into) the accounts list; pages hear accounts_list_updated and refetch. */
  hideAccount: async (accountId: string, hidden = true): Promise<void> => {
    await control('/__stand/accounts/hide', { body: { accountId, hidden } });
  },
  /** Holds the Mimic endpoints until released: pages loaded meanwhile stay in «Mimic data loading». */
  holdMimic: async (hold: boolean): Promise<void> => {
    await control('/__stand/state', { body: { holdMimic: hold } });
  },
  /** Holds the fans endpoint until released: a page loaded meanwhile does not know the fans of its chats yet. */
  holdFans: async (hold: boolean): Promise<void> => {
    await control('/__stand/state', { body: { holdFans: hold } });
  },
  state: async (): Promise<{ sockets: Array<{ id: number; label: string; authenticated: boolean; accounts: string[] }> }> =>
    (await control('/__stand/state')) as { sockets: Array<{ id: number; label: string; authenticated: boolean; accounts: string[] }> },
  /** Outside requests the browser tried (the egress sink), after the cursor `since`. */
  egress: async (since = 0): Promise<EgressPage> => (await control(`/__stand/egress?since=${since}`)) as EgressPage,
};

export function byOrigin(entries: readonly ServerJournalEntry[], origin: CallOrigin): ServerJournalEntry[] {
  return entries.filter((entry) => entry.origin === origin);
}

/** Calls that reached the stand's API or socket from anything but the page's own client or the harness. */
export function foreignCalls(entries: readonly ServerJournalEntry[]): ServerJournalEntry[] {
  return byOrigin(entries, 'foreign');
}

export async function waitForJournal(predicate: (entries: readonly ServerJournalEntry[]) => boolean, since: number, message: string, timeout = 10_000): Promise<ServerJournalEntry[]> {
  let entries: readonly ServerJournalEntry[] = [];
  try {
    await browser.waitUntil(
      async () => {
        entries = (await standServer.journal(since)).entries;
        return predicate(entries);
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: not seen in ${timeout} ms; journal: ${JSON.stringify(entries.slice(-20))}`);
  }
  return [...entries];
}

/**
 * The composer roots the extension must choose from, judged in the page the
 * way architecture.md §6.3 defines «active»: connected, visible along the
 * whole chain, non-zero box. Keys are the stand's own composer keys.
 */
export async function composerRoots(): Promise<{ readonly all: string[]; readonly active: string[]; readonly firstSlotOwner: string | null }> {
  return browser.execute(() => {
    const slots = [...document.querySelectorAll<HTMLElement>('[data-id="browser-composer-translator"]')];
    const rootOf = (slot: HTMLElement): HTMLElement | null => slot.closest('.composer-frame')?.parentElement ?? null;
    const keyOf = (root: HTMLElement | null): string => root?.getAttribute('data-stand-composer') ?? '(no key)';
    const active = slots
      .map(rootOf)
      .filter((root): root is HTMLElement => root !== null && root.isConnected && root.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      .filter((root) => {
        const box = root.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
    const first = document.querySelector<HTMLElement>('[data-id="browser-composer-translator"]');
    return { all: slots.map((slot) => keyOf(rootOf(slot))), active: active.map(keyOf), firstSlotOwner: first === null ? null : keyOf(rootOf(first)) };
  });
}

/** Where the dock host sits: the stand composer key of its parent, and whether it is the first child. */
export async function dockPlacement(): Promise<{ readonly hosts: number; readonly parentKey: string | null; readonly firstChild: boolean; readonly visible: boolean }> {
  return browser.execute(() => {
    const hosts = document.querySelectorAll<HTMLElement>('[data-host="dock"]');
    const host = hosts[0];
    const parent = host?.parentElement ?? null;
    return {
      hosts: hosts.length,
      parentKey: parent?.getAttribute('data-stand-composer') ?? null,
      firstChild: parent !== null && parent.firstElementChild === host,
      visible: host?.checkVisibility() ?? false,
    };
  });
}
