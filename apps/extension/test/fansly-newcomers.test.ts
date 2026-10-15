// «Новые» of a Fansly tab against the core's RPC and Fansly's background module (R20 P10a; docs/project-unite/
// architecture.md §8.15; NF-027, FX-017, NF-004): the window's requests are checked by Fansly's registry on both sides
// and asked only from the top frame of a fansly.com tab; an answer or an event that does not fit the registry is
// never read; and against today's background — whose pass comes with P10b1 — the window says the list was not read,
// never that nobody followed. The platform's fake browser stands for Firefox.

import { CONTRACTS_VERSION } from '@cg/contracts';
import type { Bootstrap, BootstrapPage } from '@cg/contracts/hub';
import type { HostAccount, HubBinding } from '@cg/contracts/ids';
import { mayRequestFansly } from '@cg/contracts/tab-messages-fansly';
import { NEWCOMER_CHECK_FILTERS, type NewcomersVM } from '@cg/contracts/vm';
import { Surfaces, type PageContextPort, type PageContextState } from '@cg/core/application/boards';
import type { NewcomersControllerDeps } from '@cg/core/application/newcomers';
import { createI18n } from '@cg/core/domain/i18n';
import { createBackgroundRpc, createTabRpcClient, verifyTabSender, type BackgroundRpc, type TabRpcClient } from '@cg/platform';
import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryKv } from '../../../packages/core/src/services/test-support/memory-kv.ts';
import { FANSLY_ORIGIN, TAB_HOSTS, createFakeBrowser, tabSender, type FakeBrowser, type FakeContext } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { fanslyModule, fanslyRegistry } from '../bg/fansly.ts';
import * as FanslyBoards from '../lazy/fansly/boards.ts';
import { parseTabPayload as fanslyProtocol } from '../lazy/fansly/tab-protocol.ts';
import * as SharedBoards from '../lazy/entries/boards.ts';
import type { BackgroundKit, HostSiteRegistry } from '../src/composition/background/host-module.ts';
import { createFanslyNewcomersController, fanslyFollowersPort } from '../src/composition/tab/hosts/fansly/newcomers.ts';
import { fanslyRequest } from '../src/composition/tab/hosts/fansly/requests.ts';
import { until } from './support/world.ts';

const CREATOR = '700000000000000017';
const PAGE_ID = 13;
const T0 = 1_790_000_000_000;
const FOLLOWERS = ['fansly.followers.scan', 'fansly.followers.read', 'fansly.followers.history', 'fansly.followers.close'] as const;

function backgroundOf(context: FakeContext): BackgroundRpc {
  const rpc = createBackgroundRpc({ api: context.api, tabHosts: TAB_HOSTS, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: true, siteWaitMs: 2_000 });
  const kit = {
    storage: { local: createMemoryKv().open() },
    clock: { now: () => T0 },
    log: { service: () => undefined },
    router: { tabs: () => rpc.tabs().map((tab) => tab.tabSessionId) },
    site: { plug: (registry: HostSiteRegistry) => rpc.site({ ...registry, host: 'fansly-web' }) },
  } as unknown as BackgroundKit;
  void fanslyModule().start(kit);
  return rpc;
}

const fakes: FakeBrowser[] = [];
afterEach(() => {
  for (const fake of fakes.splice(0)) fake.unloadBackground();
});

function browserWithBackground(): FakeBrowser {
  const fake = createFakeBrowser();
  fake.onWake((context) => void backgroundOf(context));
  fakes.push(fake);
  return fake;
}

function fanslyTab(fake: FakeBrowser): TabRpcClient {
  const url = `${FANSLY_ORIGIN}/messages`;
  return createTabRpcClient({
    api: fake.context(tabSender(fake, { url, origin: FANSLY_ORIGIN, tab: { id: 12, url } })).api,
    validate: fanslyProtocol,
    register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION },
    reconnectDelaysMs: [5, 10, 20],
  });
}

function contextOf(): PageContextPort {
  const one = BOOTSTRAP_PILOT_PAGES.pages[0] as BootstrapPage;
  const page: BootstrapPage = { ...one, pageId: PAGE_ID, platform: 'fansly', features: { ...one.features, newcomers: { available: true } } };
  const bootstrap: Bootstrap = { ...BOOTSTRAP_PILOT_PAGES, pages: [page] };
  const account: HostAccount = { host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, username: 'lora_vie', displayName: null };
  const binding: HubBinding = { hubOrigin: 'https://hub.example.test', principalId: 7, loginEpoch: 3, host: 'fansly-web', hostAccountId: CREATOR, platform: 'fansly', platformAccountId: CREATOR, pageId: PAGE_ID, pageLabel: 'lora', bindingRevision: 1 };
  const state: PageContextState = { phase: 'ready', blocker: null, session: null, bootstrap, account, binding, page, settings: null, persona: null, epoch: 1 };
  return { current: () => state, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };
}

function depsOf(rpc: NewcomersControllerDeps['rpc']): NewcomersControllerDeps {
  return {
    rpc,
    host: {} as NewcomersControllerDeps['host'],
    i18n: createI18n({ language: 'ru', now: () => T0, timeZone: 'Europe/Moscow' }),
    clock: { now: () => T0, setTimer: () => 0, clearTimer: () => undefined },
    context: contextOf(),
    surfaces: new Surfaces(),
    navigator: { open: () => Promise.reject(new Error('the window of a pass opens no chat')) },
    connectivity: null,
    random: () => 0,
  };
}

describe('[host:fansly] «Новые» of a Fansly tab over the core’s RPC and Fansly’s module (R20 P10a)', () => {
  it('[NF-027] the window’s requests: Fansly’s types, from the top frame of a fansly.com tab only, their bodies checked by Fansly’s registry before the module sees them', async () => {
    for (const type of FOLLOWERS) {
      expect(mayRequestFansly(type, 'tab', null, 'fansly-web'), type).toBe(true);
      expect(mayRequestFansly(type, 'tab', null, 'chatspace'), type).toBe(false);
      expect(mayRequestFansly(type, 'relay', null, 'fansly-web'), type).toBe(false);
      expect(mayRequestFansly(type, 'page', 'options', null), type).toBe(false);
      // The background module's own registry says the same.
      expect(fanslyRegistry(() => Promise.reject(new Error('unused'))).mayRequest(type, 'tab', null, 'fansly-web')).toBe(true);
    }
    const fake = browserWithBackground();
    // A frame inside a fansly.com page is not a tab: its port is refused before any request.
    const url = `${FANSLY_ORIGIN}/messages`;
    expect(verifyTabSender(tabSender(fake, { url, origin: FANSLY_ORIGIN, frameId: 2, tab: { id: 12, url } }), fake.runtimeId, TAB_HOSTS)).toEqual({ ok: false, reason: 'subframe' });

    const client = fanslyTab(fake);
    await until(() => client.state() === 'ready', 'the tab registered');
    // A body outside the registry (721 hours) never reaches the module.
    expect(await fanslyRequest(client, 'fansly.followers.scan', { hostAccountId: CREATOR, windowHours: 721 })).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid fansly.followers.scan request' } });
    // Today's module does not serve the pass yet (P10b1): a shared code, never a guess.
    expect(await fanslyRequest(client, 'fansly.followers.scan', { hostAccountId: CREATOR, windowHours: 48 })).toMatchObject({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    client.close();
  });

  it('[FX-017] [NF-001] the window on today’s background: the dock’s «Новые» opens it, the scan is asked once, and it says the list was not read — not «nobody new»', async () => {
    const fake = browserWithBackground();
    const client = fanslyTab(fake);
    await until(() => client.state() === 'ready', 'the tab registered');
    const asked: string[] = [];
    const rpc = {
      ...client,
      request: ((type: string, payload: unknown, options?: { readonly timeoutMs?: number }) => {
        asked.push(type);
        return (client.request as (t: string, p: unknown, o?: { readonly timeoutMs?: number }) => Promise<unknown>)(type, payload, options);
      }) as TabRpcClient['request'],
    };
    const controller = createFanslyNewcomersController(depsOf(rpc), FANSLY_ORIGIN);
    // The chip of the dock and the popup open it the same way: `Navigate` to `newcomers`.
    await controller.dispatch({ type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } });
    await until(() => controller.getSnapshot({ of: 'newcomers' }).pass?.stage === 'failed', 'the list failed');
    const vm: NewcomersVM = controller.getSnapshot({ of: 'newcomers' });
    expect([vm.view.s, vm.pass?.failure?.code, vm.rows]).toEqual(['offline', 'CG-RUNTIME-UNREACHABLE', []]);
    expect(vm.view.s).not.toBe('empty');
    expect(asked).toEqual(['fansly.followers.scan']);
    expect(vm.pass?.filters.map((filter) => filter.id)).toEqual([...NEWCOMER_CHECK_FILTERS]);
    controller.dispose();
    client.close();
  });

  it('[NF-027] an answer or an event that does not fit Fansly’s registry is never read: a failure for the answer, nothing for the event', async () => {
    const heard: unknown[] = [];
    const listeners: ((payload: unknown) => void)[] = [];
    const rpc = {
      request: () => Promise.resolve({ ok: true, payload: { pass: null, rows: [{ fanRef: '1', groupId: 'group-1' }], total: 1 } }),
      onEvent: (_type: string, listener: (payload: unknown) => void) => {
        listeners.push(listener);
        return () => undefined;
      },
    } as unknown as NewcomersControllerDeps['rpc'];
    const port = fanslyFollowersPort(rpc);
    expect(await port.request('fansly.followers.read', { passId: '00000000-0000-4000-8000-000000000301', offset: 0, limit: 100 })).toEqual({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid fansly.followers.read response' } });
    port.onChanged((change) => heard.push(change));
    for (const listener of listeners) listener({ pass: null, seq: 1, rows: [] });
    expect(heard).toEqual([]);
  });

  it('[NF-004] a port that came back after a loss is told once — the changes meanwhile are lost, the list is read again', () => {
    const states: ((state: 'ready' | 'reconnecting' | 'lost') => void)[] = [];
    const rpc = { request: () => Promise.reject(new Error('unused')), onEvent: () => () => undefined, onState: (listener: (state: 'ready' | 'reconnecting' | 'lost') => void) => (states.push(listener), () => undefined), state: () => 'ready' } as unknown as NewcomersControllerDeps['rpc'];
    let told = 0;
    fanslyFollowersPort(rpc).onReconnect(() => (told += 1));
    const say = (state: 'ready' | 'reconnecting' | 'lost'): void => states.forEach((listener) => listener(state));
    say('ready');
    expect(told).toBe(0);
    say('reconnecting');
    say('lost');
    say('ready');
    say('ready');
    expect(told).toBe(1);
  });

  it('[NF-001] Fansly’s boards are the shared boards with «Новые» of the pass: the same names the tab’s application loads', () => {
    expect(Object.keys(FanslyBoards).sort()).toEqual(Object.keys(SharedBoards).sort());
    expect(FanslyBoards.createNewcomersController).not.toBe(SharedBoards.createNewcomersController);
    expect(FanslyBoards.createSpendersController).not.toBe(SharedBoards.createSpendersController);
    for (const name of ['Surfaces', 'createChatNavigator', 'createPageContext', 'createFanPanelController', 'createPaletteDirectory'] as const) {
      expect(FanslyBoards[name], name).toBe(SharedBoards[name]);
    }
  });
});
