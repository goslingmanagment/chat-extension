// Real runtime, site hosts and application. Hold each startup boundary so a
// retirement can win before the first UI appears (P7g review regression).
import { startChatSpaceHost, loadValidation as chatspaceValidation } from '@cg/host-chatspace/isolated';
import type { FanslySoundFacts } from '@cg/contracts/tab-messages-fansly';
import { startFanslyTab, type FanslyPort } from '@cg/host-fansly/isolated';
import * as fanslyValidation from '@cg/host-fansly/isolated/validation';
import type * as Platform from '@cg/platform';
import { createTabRpcClient, type TabRpcClient } from '@cg/platform';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as ai from '../../../lazy/entries/ai';
import * as dock from '../../../lazy/entries/dock';
import * as navigation from '../../../lazy/entries/navigation';
import * as protocol from '../../../lazy/entries/tab-protocol';
import * as chatspaceApp from '../../../lazy/entries/tab-app';
import * as fanslyApp from '../../../lazy/fansly/tab-app';
import type { LazyEntryName } from '../../../lazy/entries/names';
import { withSoundReports } from '../../entrypoints/fansly';
import type { StartedHost } from './adapter';
import type { TabApp, TabAppEnv } from './app';
import { startTabKeys } from './keys';
import { startTabRuntime, type TabAppChunk, type TabRuntimeEnv } from './runtime';

vi.mock('@cg/platform', async (original) => ({
  ...await original<typeof Platform>(),
  createTabRpcClient: vi.fn(),
  extensionUrl: () => 'moz-extension://test/',
  extensionVersionOf: () => '0.0.0',
}));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  document.documentElement.removeAttribute('data-fx-instance');
  document.documentElement.removeAttribute('data-fx-reload');
  document.documentElement.replaceChildren(document.createElement('head'), document.createElement('body'));
  vi.restoreAllMocks();
});

const sites: Array<{ kind: TabRuntimeEnv['kind']; start(): StartedHost; chunk: TabAppChunk }> = [
  // As the entry starts it: its sound's facts go by the tab's port (R20 P14a).
  { kind: 'fansly-web', start: () => withSoundReports(startFanslyTab({ win: window, validation: () => Promise.resolve(fanslyValidation), redeem: () => Promise.resolve(false), handshakeTimeoutMs: 1 })), chunk: fanslyApp },
  { kind: 'chatspace', start: () => ({ staleHosts: 0, ...startChatSpaceHost({ win: window, validation: chatspaceValidation, redeem: () => Promise.resolve(false), handshakeTimeoutMs: 1 }) }), chunk: chatspaceApp },
];

async function setup(site: typeof sites[number], boundary: 'imports' | 'settings' | 'chunks' | 'none') {
  const host = site.start();
  const port = await host.host;
  if (host.activation) expect(await host.activation.ready).toBe(true);
  const life = new AbortController();
  const keys = startTabKeys({
    win: window, mounts: host.mounts, onWaiting: () => undefined,
    site: { hotkeyClient: site.kind === 'fansly-web' ? 'fansly' : 'extension', keyProbe: () => ({ focus: () => 'page', nativeModalOpen: () => false, deliver: () => false }), keyPending: () => () => undefined, routeOfLocation: () => ({ kind: 'other', epoch: 'test' }) },
  });
  life.signal.addEventListener('abort', () => { keys.dispose(); host.mounts.dispose(); host.theme.dispose(); port.dispose(); });
  host.activation?.stopped.addEventListener('abort', () => life.abort('host-retired'));
  cleanups.push(() => life.abort('test done'));
  const pending = Promise.withResolvers<void>();
  let reached = false;
  const pause = async (at: typeof boundary): Promise<void> => {
    if (boundary !== at) return;
    reached = true;
    await pending.promise;
  };
  const request = vi.fn(async (type: string) => {
    if (type === 'settings.get') await pause('settings');
    return { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } };
  });
  const rpc = {
    request, onState: vi.fn(() => () => undefined), onEvent: vi.fn(() => () => undefined),
    state: () => 'closed', tabSessionId: () => null, reconnect: vi.fn(), close: vi.fn(),
  } as unknown as TabRpcClient;
  vi.mocked(createTabRpcClient).mockReturnValue(rpc);
  const apps: TabApp[] = [];
  cleanups.push(() => { for (const app of apps) app.dispose(); });
  const start = vi.fn(async (env: TabAppEnv) => {
    const app = await site.chunk.startTabApp(env);
    apps.push(app);
    return app;
  });
  const lazy = async <T>(entry: LazyEntryName): Promise<T> => {
    if (entry === 'tab-app') { await pause('imports'); return { startTabApp: start } as T; }
    if (entry === 'tab-protocol') return protocol as T;
    if (entry === 'dock') { await pause('chunks'); return dock as T; }
    if (entry === 'ai') return ai as T;
    if (entry === 'navigation') return navigation as T;
    if (entry.startsWith('i18n-')) return { CATALOG: {} } as T;
    // Stage two is outside this test's startup interval.
    return new Promise<T>(() => undefined);
  };
  const env: TabRuntimeEnv = {
    win: window, kind: site.kind, host, keys, life: life.signal, abort: (reason) => life.abort(reason), lazy,
    lateInjection: false, staleHosts: 0, probe: null, setNavInsertTimeoutMs: () => undefined, takeDiagnostics: () => [],
  };
  const retire = async (): Promise<void> => {
    if (site.kind === 'fansly-web') {
      // The duplicate MAIN's DOM signal, observed by the real host.
      document.documentElement.setAttribute('data-fx-reload', 'update');
      await vi.waitFor(() => expect(life.signal.aborted).toBe(true));
      expect(document.querySelectorAll('[data-host="reload-notice"]')).toHaveLength(1);
    } else life.abort('host-retired');
    expect(document.querySelectorAll('[data-host="overlay"]')).toHaveLength(0);
  };
  return { env, host, port, rpc, request, start, apps, life, retire, release: () => pending.resolve(), reached: () => reached };
}

for (const site of sites) describe(`${site.kind}: startup retirement`, () => {
  it('an already-aborted runtime opens no background port', async () => {
    const w = await setup(site, 'none');
    await w.retire();
    vi.mocked(createTabRpcClient).mockClear();
    expect(() => startTabRuntime(w.env)).toThrow('host-retired');
    expect(createTabRpcClient).not.toHaveBeenCalled();
  });

  it('a host that resolves after retirement gets no presence subscription', async () => {
    const w = await setup(site, 'none');
    const pending = Promise.withResolvers<typeof w.port>();
    startTabRuntime({ ...w.env, host: { ...w.host, host: pending.promise } });
    await w.retire();
    const subscribe = vi.spyOn(w.port, 'subscribe');
    pending.resolve(w.port);
    await pending.promise;
    expect(subscribe).not.toHaveBeenCalled();
  });

  for (const boundary of ['imports', 'settings', 'chunks'] as const) {
    it(`retirement while ${boundary} are pending cannot recreate overlays or install application listeners`, async () => {
      const w = await setup(site, boundary);
      const runtime = startTabRuntime(w.env);
      runtime.wake();
      await vi.waitFor(() => expect(w.reached()).toBe(true));
      await w.retire();
      const overlay = vi.spyOn(w.host.mounts, 'overlay');
      const listeners = vi.spyOn(window, 'addEventListener');
      w.release();
      // Drain the startup promise and the first UI render.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(overlay).not.toHaveBeenCalled();
      expect(listeners).not.toHaveBeenCalled();
      expect(w.apps).toHaveLength(0);
      expect(document.querySelectorAll('[data-host="overlay"]')).toHaveLength(0);
      if (boundary === 'imports') expect(w.start).not.toHaveBeenCalled();
    });
  }

  it('an already-aborted app refuses startup before settings or lazy work', async () => {
    const w = await setup(site, 'none');
    await w.retire();
    const env: TabAppEnv = {
      ...w.env, rpc: w.rpc, host: w.port, mounts: w.host.mounts, theme: w.host.theme,
      ownOrigin: 'moz-extension://test', extensionVersion: '0.0.0', contractsVersion: '1.15.0', drafts: null,
    };
    await expect(w.start(env)).rejects.toBe('host-retired');
    expect(w.request).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[data-host="overlay"]')).toHaveLength(0);
  });
});

describe('[host:fansly] a place of the site’s own without a composer (R20 P13b)', () => {
  const fansly = sites[0] as (typeof sites)[number];

  it('on `/creator/vault` the application comes for the vault’s entry, no composer and no key needed', async () => {
    history.replaceState({}, '', '/creator/vault');
    cleanups.push(() => history.replaceState({}, '', '/'));
    const w = await setup(fansly, 'none');
    startTabRuntime(w.env);
    await vi.waitFor(() => expect(w.start).toHaveBeenCalledTimes(1));
  });

  it('elsewhere without a composer it does not; the page’s own move to the vault brings it', async () => {
    history.replaceState({}, '', '/notifications');
    cleanups.push(() => history.replaceState({}, '', '/'));
    const w = await setup(fansly, 'none');
    startTabRuntime(w.env);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(w.start).not.toHaveBeenCalled();
    history.pushState({}, '', '/creator/vault');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(w.start).toHaveBeenCalledTimes(1));
  });
});

describe('[host:fansly] the sound’s facts from the early bundle (R20 P14a)', () => {
  const fansly = sites[0] as (typeof sites)[number];

  it('[SN-016] the runtime hands the site’s host the tab’s port at once; a batch Fansly’s page heard goes by it as ONE `fansly.sound.facts` — on a page with no composer, no application loaded', async () => {
    history.replaceState({}, '', '/notifications');
    cleanups.push(() => history.replaceState({}, '', '/'));
    const w = await setup(fansly, 'none');
    let report: ((facts: FanslySoundFacts) => void) | null = null;
    vi.spyOn((w.port as FanslyPort).sound, 'onReport').mockImplementation((cb) => {
      report = cb;
      return () => undefined;
    });
    startTabRuntime(w.env);
    await vi.waitFor(() => expect(report).not.toBeNull());
    const facts: FanslySoundFacts = {
      creatorId: '700000000000000001',
      messages: [{ groupId: '700000000000000003', fanId: '700000000000000002', senderId: '700000000000000002', msgId: '700000000000000101', fromFan: true, automated: false, tip: false, createdAt: null }],
      follows: [{ eventId: '700000000000000201', accountId: '700000000000000001', followerId: '700000000000000002' }],
    };
    (report as unknown as (facts: FanslySoundFacts) => void)(facts);
    expect(w.request.mock.calls.filter(([type]) => type === 'fansly.sound.facts')).toEqual([['fansly.sound.facts', facts]]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(w.start).not.toHaveBeenCalled();
  });
});
