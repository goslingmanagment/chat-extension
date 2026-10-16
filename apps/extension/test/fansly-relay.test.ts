// «Fansly через вкладку» end to end on the fake browser (R20 P9c; architecture.md §8.5, §8.6; FS-NET-4, FX-001):
// the core's RPC (platform rpc-background, its `cg-relay` port), Fansly's module's relay (bg/fansly/relay.ts over
// packages/fansly-api's transport and client), the Fansly tab's early transport (its lease of the frame) and the
// frame itself (entrypoints/fansly-relay over platform rpc-relay) — each its own context of the browser, talking
// over ports only. A request of the API is routed through the tab before anything is handed to the hub's custody:
// the tab raises its frame, the frame says it is up, the request is the frame's fetch; with the switch off it is the
// event page's own. The frame goes 60 s after the last work; a document that went takes it along, and the request
// prepared through it is refused before it leaves.

import { CONTRACTS_VERSION } from '@cg/contracts';
import { createFanslyApi, type FanslyApi, type FanslySessionTemplate } from '@cg/fansly-api';
import { createBackgroundRpc, createRelayRpcClient, createTabRpcClient, type BackgroundRpc, type TabRpcClient } from '@cg/platform';
import { parseFanslyTabPayload } from '@cg/contracts/tab-messages-fansly';
import { parseTabPayload } from '@cg/contracts/tab-messages';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowser, FANSLY_ORIGIN, flush, TAB_HOSTS, type FakeBrowser, type FakeContext } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { fanslyRegistry } from '../bg/fansly.ts';
import { createRelayService, type RelayService } from '../bg/fansly/relay.ts';
import type { BackgroundKit } from '../src/composition/background/host-module.ts';
import { relayTransport } from '../src/composition/tab/hosts/fansly/relay.ts';
import { readRelayFetch, serveFrom, startFanslyRelay, type FanslyRelay } from '../src/entrypoints/fansly-relay/relay.ts';

const CREATOR = '700000000000000001';
const GROUP = '700000000000000777';
const TAB_ID = 12;
const FRAME_ID = 7;
const T0 = 1_790_000_000_000;

const TEMPLATE: FanslySessionTemplate = {
  legacyId: CREATOR,
  canonicalId: null,
  headers: { authorization: 'token-1', 'fansly-client-id': 'client-1', 'fansly-session-id': 'session-1' },
  checks: { group: 'check-group' },
  connected: true,
  observedAt: T0,
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await flush(20);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

interface Fetched {
  readonly url: string;
  readonly init: RequestInit;
}

/** The frame the tab mounts: a context of its own (our relay page in a subframe of tab 12), the real frame logic. */
class Frame {
  readonly fetched: Fetched[] = [];
  context: FakeContext | null = null;
  relay: FanslyRelay | null = null;
  mounts = 0;
  constructor(private readonly fake: FakeBrowser) {}

  mount(account: string): void {
    this.mounts += 1;
    const context = this.fake.context({ id: this.fake.runtimeId, url: `${this.fake.base}fansly-relay.html`, frameId: FRAME_ID, tab: { id: TAB_ID } });
    const channel = createRelayRpcClient({ api: context.api, validate: (kind, type, payload) => (kind === 'evt' && type === 'fansly.relay.fetch' ? (readRelayFetch(payload) === null ? { ok: false } : { ok: true, payload }) : parseFanslyTabPayload(kind, type, payload)) });
    this.context = context;
    this.relay = startFanslyRelay({
      channel,
      fetch: (url, init) => {
        this.fetched.push({ url, init });
        return Promise.resolve(new Response(JSON.stringify({ success: true, response: { id: GROUP } }), { status: 200, headers: { 'content-type': 'application/json' } }));
      },
      hostAccountId: account,
      relayId: crypto.randomUUID(),
      serve: serveFrom(null),
    });
  }

  /** The tab removed it: its document is gone, its port closes. */
  remove(): void {
    this.relay?.stop();
    for (const port of [...(this.context?.ports ?? [])]) port.disconnect();
    if (this.context !== null) this.context.alive = false;
    this.context = null;
    this.relay = null;
  }
}

interface World {
  readonly fake: FakeBrowser;
  readonly rpc: BackgroundRpc;
  readonly relay: RelayService;
  readonly api: FanslyApi;
  readonly frame: Frame;
  readonly tab: { client: TabRpcClient; context: FakeContext; life: AbortController };
  /** The tab's lease timers, fired by hand. */
  readonly leases: Array<{ fire: () => void; cleared: boolean }>;
  readonly direct: string[];
  viaTab: boolean | null;
}

async function world(): Promise<World> {
  const fake = createFakeBrowser();
  const background = fake.startBackground();
  const rpc = createBackgroundRpc({ api: background.api, tabHosts: TAB_HOSTS, relayPages: { 'fansly-web': 'fansly-relay.html' }, siteWaitMs: 50, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: false });
  const direct: string[] = [];
  const state = { viaTab: true as boolean | null };
  const kit = {
    site: {
      plug: (registry: Parameters<NonNullable<BackgroundKit['site']>['plug']>[0]) => rpc.site({ ...registry, host: 'fansly-web' }),
      emit: (type: string, payload: unknown, target: { readonly tabSessionId: string }) => rpc.emitSite('fansly-web', type, payload, target),
    },
    siteTabs: { registered: () => rpc.tabs().flatMap((tab) => (tab.request.host === 'fansly-web' ? [{ tabSessionId: tab.tabSessionId, tabId: tab.tabId, accounts: [] }] : [])) },
    networkSession: { forTab: (tabId: number) => (tabId === TAB_ID ? TEMPLATE : null) },
    ids: { uuid: () => crypto.randomUUID(), token: () => 'token' },
    clock: { now: () => Date.now(), setTimer: (ms: number, fn: () => void) => setTimeout(fn, ms), clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  } as unknown as BackgroundKit;
  // The event page's own requests are recorded: nothing of this test reaches the network.
  const directFetch = (url: string) => {
    direct.push(url);
    return Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve(JSON.stringify({ success: true, response: { id: GROUP } })) });
  };
  const relay = createRelayService(kit, () => state.viaTab, { fetch: directFetch });
  const unplug = kit.site?.plug(fanslyRegistry((type, payload, sender) => relay.handle(type, payload, sender) ?? { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } }, (sender) => relay.gone(sender)));
  const data = new Map<string, unknown>();
  const api = createFanslyApi({
    session: { ready: Promise.resolve(), idle: () => Promise.resolve(), forAccount: (id) => (id === CREATOR ? TEMPLATE : null), disconnect: () => Promise.resolve(), rateLimits: () => [] },
    storage: {
      get: (keys: readonly string[]) => Promise.resolve({ ok: true as const, value: Object.fromEntries(keys.filter((key) => data.has(key)).map((key) => [key, data.get(key)])) }),
      set: (items: Readonly<Record<string, unknown>>) => {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
        return Promise.resolve({ ok: true as const });
      },
    },
    transport: relay.hub,
    fetch: directFetch,
  });
  // The Fansly tab: its port registered as Fansly's, its early transport over it, a page port whose relay mounts the frame.
  const frame = new Frame(fake);
  const leases: World['leases'] = [];
  const context = fake.context({ id: fake.runtimeId, url: `${FANSLY_ORIGIN}/messages/${GROUP}`, origin: FANSLY_ORIGIN, frameId: 0, tab: { id: TAB_ID } });
  const life = new AbortController();
  const page = {
    fansly: {
      relay: {
        open: () => {
          if (frame.context === null) frame.mount(CREATOR);
          return Promise.resolve('open' as const);
        },
        close: () => frame.remove(),
      },
    },
  };
  const transport = relayTransport(Promise.resolve(page), () => undefined, {
    setTimer: (callback) => {
      const lease = { fire: callback, cleared: false };
      leases.push(lease);
      return lease;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  // The tab's validation: Fansly's early transport first, the shared registry after it (composition/tab/runtime.ts).
  const client = createTabRpcClient({
    api: context.api,
    validate: (kind, type, payload) => transport.validate(kind, type, payload) ?? parseTabPayload(kind, type, payload),
    register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION },
  });
  transport.connect(client, life.signal);
  cleanups.push(() => {
    life.abort();
    client.close();
    unplug?.();
    rpc.dispose();
  });
  const made: World = {
    fake,
    rpc,
    relay,
    api,
    frame,
    tab: { client, context, life },
    leases,
    direct,
    get viaTab() {
      return state.viaTab;
    },
    set viaTab(value) {
      state.viaTab = value;
    },
  };
  await settle();
  return made;
}

describe('[host:fansly] «Fansly через вкладку» on the fake browser (R20 P9c)', () => {
  it('[FX-001] [FS-NET-4] off: the event page’s own request; no frame is raised in the tab', async () => {
    const w = await world();
    w.viaTab = false;
    const prepared = await w.api.client.prepare({ purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group: GROUP } });
    expect(prepared.transport).toBe('direct');
    expect((await prepared.start()).status).toBe(200);
    expect(w.direct).toEqual([`https://apiv3.fansly.com/api/v1/group/${GROUP}/?ngsw-bypass=true`]);
    expect([w.frame.mounts, w.leases.length]).toEqual([0, 0]);
  });

  it.each([false, true])('[FS-NET-4] a newcomers batch of 100 eighteen-digit account ids is one fetch (viaTab=%s)', async (viaTab) => {
    const w = await world();
    w.viaTab = viaTab;
    const ids = Array.from({ length: 100 }, (_, index) => String(700000000000000001n + BigInt(index))).join(',');
    expect(ids).toHaveLength(1899);
    const url = `https://apiv3.fansly.com/api/v1/account?ids=${encodeURIComponent(ids)}&ngsw-bypass=true`;
    expect(url).toHaveLength(2158);
    const prepared = await w.api.client.prepare({ purpose: 'newcomers', route: 'account.byIds', account: CREATOR, query: { ids } });
    expect(prepared.transport).toMatch(viaTab ? /^tab:/ : /^direct$/);
    await expect(prepared.start()).resolves.toEqual({ response: { id: GROUP }, status: 200 });
    expect(w.direct).toEqual(viaTab ? [] : [url]);
    expect(w.frame.fetched.map((entry) => entry.url)).toEqual(viaTab ? [url] : []);
  });

  it.each([false, true])('[FS-NET-4] an account ids value over the client limit is refused before either route (viaTab=%s)', async (viaTab) => {
    const w = await world();
    w.viaTab = viaTab;
    const ids = Array.from({ length: 108 }, (_, index) => String(700000000000000001n + BigInt(index))).join(',');
    expect(ids).toHaveLength(2051);
    await expect(w.api.client.prepare({ purpose: 'newcomers', route: 'account.byIds', account: CREATOR, query: { ids } })).rejects.toMatchObject({ kind: 'not-admitted', sent: false });
    expect([w.direct, w.frame.fetched, w.frame.mounts]).toEqual([[], [], 0]);
  });

  it('[FX-001] [FS-NET-4] on: the tab raises its frame for the batch, the frame says it is up, the request is the frame’s fetch — none of the event page’s own; 60 s after the last work the frame goes', async () => {
    const w = await world();
    // Nothing yet: lazily, for work.
    expect(w.frame.mounts).toBe(0);
    const preparing = w.api.client.prepare({ purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group: GROUP } });
    await settle();
    const prepared = await preparing;
    expect(prepared.transport).toMatch(/^tab:/);
    expect(w.frame.mounts).toBe(1);
    expect(w.relay.hub.frames()).toEqual([{ tabSessionId: w.tab.client.tabSessionId(), frameId: FRAME_ID, hostAccountId: CREATOR, relayId: expect.any(String) as string }]);
    const answer = prepared.start();
    await settle();
    expect(await answer).toEqual({ response: { id: GROUP }, status: 200 });
    expect(w.frame.fetched.map((entry) => entry.url)).toEqual([`https://apiv3.fansly.com/api/v1/group/${GROUP}/?ngsw-bypass=true`]);
    expect(w.frame.fetched[0]?.init).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(new Map(w.frame.fetched[0]?.init.headers as Array<[string, string]>).get('authorization')).toBe('token-1');
    expect(w.direct).toEqual([]);
    // The lease: renewed by the route and by the send; the last one running takes the frame down.
    const running = w.leases.filter((lease) => !lease.cleared);
    expect([w.leases.length, running.length]).toEqual([2, 1]);
    running[0]?.fire();
    await settle();
    expect(w.frame.context).toBeNull();
    expect(w.relay.hub.frames()).toEqual([]);
    // The next batch raises it anew.
    const again = w.api.client.prepare({ purpose: 'registration', route: 'group.detail', account: CREATOR, path: { group: GROUP } });
    await settle();
    expect((await again).transport).toMatch(/^tab:/);
    expect(w.frame.mounts).toBe(2);
  });

  it('[FS-NET-4] a document change between the route and the send: the frame went with it, the request is refused before it leaves', async () => {
    const w = await world();
    const preparing = w.api.client.prepare({ purpose: 'greeting', route: 'message.send', account: CREATOR, body: { type: 1, content: 'hi', groupId: GROUP } });
    await settle();
    const prepared = await preparing;
    // The tab's document goes (a reload): its port closes, the core closes its frame's port.
    w.tab.client.close();
    await settle();
    expect(prepared.holds()).toBe(false);
    await expect(prepared.start()).rejects.toMatchObject({ kind: 'tab', code: 'CG-FAN-TAB', sent: false });
    expect([w.frame.fetched, w.direct]).toEqual([[], []]);
  });
});
