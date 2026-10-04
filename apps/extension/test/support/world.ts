// The extension's wiring in one process: the background composition root and
// the tab's runtime on the platform's fake browser (contexts, ports, storage,
// alarms, an event page that is unloaded and woken again), IndexedDB from
// fake-indexeddb and the in-process fake hub. Every start of the event page is
// a new context and a new composition, as in the browser.

import 'fake-indexeddb/auto';

import { CONTRACTS_VERSION, DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { account, chat } from '@cg/contracts/fixtures';
import type { HostAccount } from '@cg/contracts/ids';
import { parseTabPayload } from '@cg/contracts/tab-messages';
import { createPageRpcClient, createTabRpcClient, type PageRpcClient, type TabRpcClient } from '@cg/platform';
import { createFakeHub, type FakeHub } from '@cg/testing/fake-hub';
import { WORLD } from '@cg/testing/hub';

import { createFakeBrowser, pageSender, tabSender, type FakeBrowser, type FakeContext } from '../../../../packages/platform/src/test-support/fake-browser.ts';
import { composeBackground } from '../../src/composition/background.ts';
import { startTabRuntime, type TabRuntimeEnv } from '../../src/composition/tab/runtime.ts';
import { CHATSPACE_MATCHES } from '../../src/hosts.ts';

export const HUB_ORIGIN = WORLD.hubOrigin;
export const PASSWORD = 'synthetic-password';
/** A ChatSpace document: the release build's content scripts match only the real origin (named in hosts.ts alone). */
export const CHATSPACE_ORIGIN = new URL(CHATSPACE_MATCHES[0] ?? '').origin;

/** A tone the background's player was asked for (what would have rung). */
export interface PlayedTone {
  readonly notes: number;
  readonly level: number;
}

export interface World {
  readonly fake: FakeBrowser;
  readonly hub: FakeHub;
  /** Every tone the sound arbiter started, in order. */
  readonly played: PlayedTone[];
  /** The browser's network to the hub: `down` — every request of the background fails like an offline one. */
  readonly net: { down: boolean };
  /** How many times the event page started. */
  starts(): number;
  /** Starts the event page now (it also starts by itself when a port, a message or an alarm needs it). */
  start(): FakeContext;
  /** An extension page's client. */
  page(page?: 'options' | 'popup' | 'debug-journal' | 'debug-prompt'): PageRpcClient;
  /** A raw client of the tab protocol in a ChatSpace tab (no runtime): requests of a registered tab. */
  tabClient(tabId?: number): { readonly client: TabRpcClient; readonly context: FakeContext };
  /** The tab's own runtime (composition/tab/runtime.ts) in a ChatSpace tab. */
  tabRuntime(options?: TabOptions): RunningTab;
  /** Stops everything this world started. */
  dispose(): void;
}

export interface TabOptions {
  readonly tabId?: number;
  readonly accounts?: readonly HostAccount[];
  readonly keepaliveMs?: number;
  readonly focused?: boolean;
}

export interface RunningTab {
  readonly context: FakeContext;
  readonly life: AbortController;
  focused: boolean;
  /** Fires the page's `focus` or `blur`. */
  focus(on: boolean): void;
}

export function settingsFor(hubOrigin: string = HUB_ORIGIN, over: Partial<SettingsV1> = {}): SettingsV1 {
  return { ...DEFAULT_SETTINGS, ...over, hub: { baseUrl: hubOrigin } };
}

export function createWorld(options: { readonly settings?: SettingsV1 | null; /** Another browser's hub: two installs, one hub. */ readonly hub?: FakeHub } = {}): World {
  const fake = createFakeBrowser();
  const hub = options.hub ?? createFakeHub({ clock: 'system' });
  // The owner linked the hub page to the creator account ChatSpace shows as the fixture account.
  if (options.hub === undefined) hub.control({ op: 'pageAccount', pageLabel: WORLD.pages.one.pageLabel, platformAccountId: account.platformAccountId });
  // The extension may run on ChatSpace (the manifest's host permission): without it nothing of ours rings there.
  for (const pattern of CHATSPACE_MATCHES) fake.permissions.origins.add(pattern);
  const played: PlayedTone[] = [];
  const net = { down: false };
  const settings = options.settings === undefined ? settingsFor() : options.settings;
  if (settings !== null) fake.areas.local.set(STORAGE_KEYS.settings, settings);
  let starts = 0;
  const lives: AbortController[] = [];
  const clients: { close(): void }[] = [];

  const compose = (context: FakeContext): void => {
    starts += 1;
    let blocked = 0;
    composeBackground({
      api: context.api,
      // A dead instance's timers find no network, like a page that is gone.
      fetch: (input, init) => (context.alive && !net.down ? hub.fetch(input, init) : Promise.reject(new TypeError('NetworkError: the page is gone'))),
      // The event page's AudioContext does not exist here: the tones are counted instead of played.
      audio: {
        prepare: () => Promise.resolve(true),
        play(tone, level) {
          if (!context.alive) {
            blocked += 1;
            return Promise.resolve({ played: false, code: 'CG-AUDIO-BLOCKED', reason: 'unavailable' });
          }
          played.push({ notes: tone.notes.length, level });
          return Promise.resolve({ played: true });
        },
        stats: () => ({ played: played.length, blocked, contextState: 'running' }),
      },
    });
  };
  fake.onWake(compose);

  const chatSpaceSender = (tabId: number) => {
    const url = `${CHATSPACE_ORIGIN}/accounts/${chat.hostAccountId}/chats/${chat.platformFanId}`;
    return tabSender(fake, { url, origin: CHATSPACE_ORIGIN, tab: { id: tabId, url } });
  };

  return {
    fake,
    hub,
    played,
    net,
    starts: () => starts,
    start() {
      const context = fake.startBackground();
      compose(context);
      return context;
    },
    page(page = 'options') {
      const client = createPageRpcClient({ api: fake.context(pageSender(fake, page)).api, validate: parseTabPayload, reconnectDelaysMs: [5, 10, 20] });
      clients.push(client);
      return client;
    },
    tabClient(tabId = 7) {
      const context = fake.context(chatSpaceSender(tabId));
      const client = createTabRpcClient({ api: context.api, validate: parseTabPayload, register: { host: 'chatspace', lateInjection: false, contractsVersion: CONTRACTS_VERSION }, reconnectDelaysMs: [5, 10, 20] });
      clients.push(client);
      return { client, context };
    },
    tabRuntime(tab = {}) {
      const context = fake.context(chatSpaceSender(tab.tabId ?? 7));
      const life = new AbortController();
      lives.push(life);
      const listeners = new Map<string, Set<() => void>>();
      const on = (type: string, listener: () => void): void => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      };
      const off = (type: string, listener: () => void): void => void listeners.get(type)?.delete(listener);
      const running: RunningTab = {
        context,
        life,
        focused: tab.focused ?? true,
        focus(value) {
          running.focused = value;
          for (const listener of listeners.get(value ? 'focus' : 'blur') ?? []) listener();
        },
      };
      const snapshot = { route: { chat, epoch: 1, account }, accounts: tab.accounts ?? [account], composer: null };
      const win = {
        document: { visibilityState: 'visible', hasFocus: () => running.focused, addEventListener: on, removeEventListener: off },
        addEventListener: on,
        removeEventListener: off,
      };
      const env = {
        win,
        life: life.signal,
        abort: (reason: string) => life.abort(reason),
        host: {
          // No composer on this page: the application chunk is never asked for.
          mounts: { points: () => ({ dock: { kind: 'none', composerInstanceId: null, width: null }, overlay: { ready: false, container: null } }), onChange: () => () => undefined },
          theme: {},
          bridge: Promise.resolve(null),
          host: Promise.resolve({ current: () => snapshot, subscribe: () => () => undefined }),
        },
        lateInjection: false,
        staleHosts: 0,
        probe: null,
        setNavInsertTimeoutMs: () => undefined,
        takeDiagnostics: () => [],
        api: context.api,
        ...(tab.keepaliveMs === undefined ? {} : { keepaliveMs: tab.keepaliveMs }),
      };
      startTabRuntime(env as unknown as TabRuntimeEnv);
      return running;
    },
    dispose() {
      for (const life of lives) life.abort('test over');
      for (const client of clients) client.close();
      if (options.hub === undefined) hub.closeStreams();
      fake.unloadBackground();
    },
  };
}

/**
 * Waits (real time) until `check` holds; the composition runs on real timers, IndexedDB and storage latency.
 * The limit is generous on purpose: it is reached only by a failure, and a loaded machine must not make one.
 */
export async function until(check: () => boolean | Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`not reached in ${timeoutMs} ms: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
