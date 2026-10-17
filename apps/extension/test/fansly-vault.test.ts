// The vault's checkpoints between a Fansly tab and the background (R20 P13b; docs/project-unite/architecture.md §1.6,
// §3.3, §7.21; FS-VLT-1, VA-005, FS-PERM-5): Fansly's background module plugs its own registry into the core's RPC
// through the kit; the tab asks `fansly.vault.*` over its port and checks each answer by Fansly's registry; the
// checkpoint is on disk, so the event page's sleep and a new tab session keep it. The platform's fake browser stands for
// Firefox (ports, the event page unloaded and woken again by the tab's port).

import { CONTRACTS_VERSION } from '@cg/contracts';
import type { I18nKey } from '@cg/contracts/errors';
import type { HostEvent } from '@cg/contracts/host';
import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { createLiveI18n } from '@cg/core/domain/i18n/live';
import type { FanslyPort } from '@cg/host-fansly/isolated';
import { createVaultPanel, vaultMediaKey, type VaultUploader } from '@cg/host-fansly/isolated/vault';
import { createBackgroundRpc, createTabRpcClient, type BackgroundRpc, type TabRpcClient } from '@cg/platform';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryKv, type MemoryKv } from '../../../packages/core/src/services/test-support/memory-kv.ts';
import { FANSLY_ORIGIN, TAB_HOSTS, createFakeBrowser, tabSender, type FakeBrowser, type FakeContext } from '../../../packages/platform/src/test-support/fake-browser.ts';
import { fanslyModule } from '../bg/fansly.ts';
import { parseTabPayload as fanslyProtocol } from '../lazy/fansly/tab-protocol.ts';
import type { BackgroundHostHandle, BackgroundKit, HostSiteRegistry } from '../src/composition/background/host-module.ts';
import type { SiteAppEnv } from '../src/composition/tab/adapter.ts';
import { startFanslySurfaces } from '../src/composition/tab/hosts/fansly/app.ts';
import { fanslyRequest } from '../src/composition/tab/hosts/fansly/requests.ts';
import { vaultStoreOf, withVaultTexts } from '../src/composition/tab/hosts/fansly/vault.ts';
import { until } from './support/world.ts';

const CREATOR = '700000000000000017';
const ALBUM = '807000000000000021';
const ID = '00000000-0000-4000-8000-000000000610';
const T0 = 1_790_000_000_000;
const target = { hostAccountId: CREATOR, albumId: ALBUM };
const checkpoint = (confirmed: number, pending: number | null): VaultCheckpoint => ({
  ...target,
  uploadId: ID,
  files: [
    { name: 'c.jpg', size: 3, lastModified: T0 - 1000 },
    { name: 'b.jpg', size: 2, lastModified: T0 - 1000 },
    { name: 'a.jpg', size: 1, lastModified: T0 - 1000 },
  ],
  confirmed,
  pending: pending === null ? null : { index: pending, passedAt: T0 },
  updatedAt: T0,
});

interface Background {
  readonly rpc: BackgroundRpc;
  readonly module: Promise<BackgroundHostHandle>;
}

/** The core's RPC and Fansly's module as an event page starts them: the kit's `site` port is the core's (composition/background.ts). */
function backgroundOf(context: FakeContext, kv: MemoryKv, access: { on: boolean } = { on: true }): Background {
  const rpc = createBackgroundRpc({ api: context.api, tabHosts: TAB_HOSTS, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: true, siteWaitMs: 2_000 });
  const kit = {
    storage: { local: kv.open() },
    clock: { now: () => T0 },
    log: { service: () => undefined },
    router: { tabs: () => rpc.tabs().map((tab) => tab.tabSessionId) },
    site: { plug: (registry: HostSiteRegistry) => rpc.site({ ...registry, host: 'fansly-web' }) },
    // R20 P14c: «Включить Fansly» and the browser's rights, as the core's site access reads them now (FS-PERM-5).
    siteActive: () => access.on,
  } as unknown as BackgroundKit;
  return { rpc, module: fanslyModule().start(kit) };
}

interface World {
  readonly fake: FakeBrowser;
  readonly kv: MemoryKv;
  /** Fansly on and its rights granted (the core's site access). */
  readonly access: { on: boolean };
  readonly backgrounds: Background[];
  tab(id?: number): TabRpcClient;
}

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.fake.unloadBackground();
});

function world(): World {
  const fake = createFakeBrowser();
  const kv = createMemoryKv();
  const backgrounds: Background[] = [];
  const access = { on: true };
  fake.onWake((context) => backgrounds.push(backgroundOf(context, kv, access)));
  const w: World = {
    fake,
    kv,
    access,
    backgrounds,
    tab(id = 12) {
      const url = `${FANSLY_ORIGIN}/creator/vault`;
      return createTabRpcClient({
        api: fake.context(tabSender(fake, { url, origin: FANSLY_ORIGIN, tab: { id, url } })).api,
        validate: fanslyProtocol,
        register: { host: 'fansly-web', lateInjection: false, contractsVersion: CONTRACTS_VERSION },
        reconnectDelaysMs: [5, 10, 20],
      });
    },
  };
  worlds.push(w);
  return w;
}

describe('[host:fansly] the vault’s checkpoints between the tab and the background (R20 P13b)', () => {
  it('[VA-005] [FS-VLT-1] the tab writes and reads them over its port; Fansly’s registry is plugged by its module and checks both ways', async () => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the tab registered');
    const store = vaultStoreOf(client);
    expect(await store.load(target)).toBeNull();
    expect(await store.save(checkpoint(0, 0))).toBe(true);
    expect(await store.save(checkpoint(1, null))).toBe(true);
    expect(await store.load(target)).toEqual(checkpoint(1, null));
    // A body Fansly's registry refuses never reaches the module: the core answers it as the shared registry would.
    const refused = await fanslyRequest(client, 'fansly.vault.checkpoint', { checkpoint: { ...checkpoint(1, null), confirmed: 9 } });
    expect(refused).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid fansly.vault.checkpoint request' } });
    // A family not served yet answers with a shared code, never a guess.
    expect(await fanslyRequest(client, 'fansly.voice.attempts', { pageId: 13, conversationRef: '700000000000000033' })).toMatchObject({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE' } });
    // The person's reset clears exactly that upload.
    expect(await store.clear(target, '00000000-0000-4000-8000-000000000999')).toBe(false);
    expect(await store.clear(target, ID)).toBe(true);
    expect(await store.load(target)).toBeNull();
  });

  it('[VA-005] [FS-PERM-5] a checkpoint survives the event page’s sleep and a reload of the tab: the next background and the next tab session read it as it was', async () => {
    const w = world();
    const first = w.tab();
    await until(() => first.state() === 'ready', 'the tab registered');
    expect(await vaultStoreOf(first).save(checkpoint(1, 1))).toBe(true);
    const session = first.tabSessionId();

    // The event page goes to sleep: its ports and its module go; the tab's port wakes a new one.
    w.fake.unloadBackground();
    await until(() => first.state() === 'ready' && first.tabSessionId() !== session, 'the tab registered with the new background');
    expect(w.backgrounds).toHaveLength(2);
    expect(await vaultStoreOf(first).load(target)).toEqual(checkpoint(1, 1));

    // A reload of the tab: a new document, a new session — the same checkpoint for its panel.
    first.close();
    const second = w.tab();
    await until(() => second.state() === 'ready', 'the reloaded tab registered');
    expect(await vaultStoreOf(second).load(target)).toEqual(checkpoint(1, 1));
    expect(w.kv.read(`fansly.vault.${CREATOR}.${ALBUM}`)).toEqual(checkpoint(1, 1));
  });

  it('[FS-PERM-5] Fansly switched off or its rights taken back while the tab runs (R20 P14c): nothing new begins — a pass, a greeting, a read of Fansly’s answer CG-FAN-OFF; the vault hands no next file over, the one in flight is still recorded', async () => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the tab registered');
    const store = vaultStoreOf(client);
    expect(await store.save(checkpoint(0, 0))).toBe(true);
    w.access.on = false;
    // The file in flight landed: its confirmation is kept; the next one is not handed over.
    expect(await store.save(checkpoint(1, null))).toBe(true);
    expect(await store.save(checkpoint(1, 1))).toBe(false);
    expect(await store.load(target)).toEqual(checkpoint(1, null));
    const off = { ok: true, payload: { ok: false, error: { code: 'CG-FAN-OFF' } } };
    expect(await fanslyRequest(client, 'fansly.followers.scan', { hostAccountId: CREATOR, windowHours: 48 })).toEqual(off);
    expect(await fanslyRequest(client, 'fansly.registration.read', { pageId: 13, hostAccountId: CREATOR, groupId: '810000000000000001' })).toEqual(off);
    expect(await fanslyRequest(client, 'fansly.spenders.names', { hostAccountId: CREATOR, fanRefs: ['920000000000000003'] })).toEqual(off);
    // On again: the run goes on from its checkpoint.
    w.access.on = true;
    expect(await store.save(checkpoint(1, 1))).toBe(true);
    expect(await fanslyRequest(client, 'fansly.registration.read', { pageId: 13, hostAccountId: CREATOR, groupId: '810000000000000001' })).not.toEqual(off);
  });

  it.each(['first-on-top', 'last-on-top'] as const)('[FS-PERM-5] the panel in album order %s: the first upload can be at either end of its list; off mid-file, it records one and stops before the next handoff, then resumes', async (order) => {
    const w = world();
    const client = w.tab();
    await until(() => client.state() === 'ready', 'the tab registered');
    const store = vaultStoreOf(client);
    const taken: string[] = [];
    let land = (): void => undefined;
    const uploader: VaultUploader = {
      view: () => ({ route: true, ...target, title: null, loading: false, uploader: 'ready', cards: [] }),
      ticket: () => 'same-album',
      async upload(file) {
        taken.push(file.name);
        if (taken.length === 1) await new Promise<void>((resolve) => { land = resolve; });
        return { state: 'done', path: 'data-transfer', top: vaultMediaKey(file.name) };
      },
      stats: () => ({ watching: false, watches: taken.length, mutations: 0 }),
      dispose: () => undefined,
    };
    const panel = createVaultPanel({ uploader, store, account: () => null, onPage: () => () => undefined, now: () => T0, newId: () => ID });
    try {
      panel.setShown(true);
      panel.dispatch({ type: 'open' });
      panel.dispatch({ type: 'order', order });
      panel.dispatch({ type: 'pick', files: ['a.jpg', 'b.jpg', 'c.jpg'].map((name) => new File(['x'], name, { lastModified: T0 })) });
      await until(() => panel.view().controls.blocked === null, 'the set ready');
      panel.dispatch({ type: 'start' });
      await until(() => taken.length === 1, 'the first file handed over');
      const states = () => panel.view().selection?.items.map((item) => item.state);
      expect(panel.view().run).toMatchObject({ state: 'running', done: 0, total: 3 });
      expect(states()).toEqual(order === 'first-on-top' ? ['pending', 'pending', 'uploading'] : ['uploading', 'pending', 'pending']);

      w.access.on = false;
      land();
      await until(() => panel.view().run?.state === 'stopped', 'the run stopped at its checkpoint');
      expect(panel.view().run).toMatchObject({ done: 1, total: 3, code: 'CG-VAULT-STOPPED' });
      expect(states()).toEqual(order === 'first-on-top' ? ['pending', 'pending', 'verified'] : ['verified', 'pending', 'pending']);
      expect(taken).toEqual([order === 'first-on-top' ? 'c.jpg' : 'a.jpg']);
      expect(await store.load(target)).toMatchObject({ confirmed: 1, pending: null });

      panel.dispatch({ type: 'start' });
      expect(panel.view().run?.state).toBe('running');
      await until(() => panel.view().run?.state === 'stopped', 'Start while off stopped again');
      expect(taken).toHaveLength(1);
      w.access.on = true;
      panel.dispatch({ type: 'start' });
      await until(() => panel.view().run?.state === 'complete', 'the run resumed from its checkpoint');
      expect(taken).toEqual(order === 'first-on-top' ? ['c.jpg', 'b.jpg', 'a.jpg'] : ['a.jpg', 'b.jpg', 'c.jpg']);
      expect(await store.load(target)).toBeNull();
    } finally {
      panel.dispose();
      client.close();
    }
  });

  it('[VA-005] one tab at a time (review of P13b): the tab that wrote the album’s row holds it while its session is registered — another tab’s write is answered `held` and its read says so; the holder’s tab gone, the album is free', async () => {
    const w = world();
    const first = w.tab(12);
    const second = w.tab(13);
    await until(() => first.state() === 'ready' && second.state() === 'ready', 'both tabs registered');
    expect(await vaultStoreOf(first).save(checkpoint(1, null))).toBe(true);
    expect(await fanslyRequest(second, 'fansly.vault.checkpoint', { checkpoint: checkpoint(1, 1) })).toEqual({ ok: true, payload: { recorded: false, held: true } });
    expect(await vaultStoreOf(second).look(target)).toEqual({ checkpoint: checkpoint(1, null), held: true });
    expect(await vaultStoreOf(first).look(target)).toEqual({ checkpoint: checkpoint(1, null), held: false });
    first.close();
    await until(() => w.backgrounds[0]?.rpc.tabs().length === 1, 'the first tab’s session gone');
    expect(await vaultStoreOf(second).look(target)).toEqual({ checkpoint: checkpoint(1, null), held: false });
    expect(await vaultStoreOf(second).save(checkpoint(1, 1))).toBe(true);
  });

  it('the tab’s protocol lets Fansly’s answers through to the code that asks, and checks every shared one as before', () => {
    expect(fanslyProtocol('res', 'fansly.vault.resume', { anything: true })).toEqual({ ok: true, payload: { anything: true } });
    expect(fanslyProtocol('res', 'tab.presence', { recorded: 'no' })).toEqual({ ok: false });
    expect(fanslyProtocol('res', 'tab.presence', { recorded: true })).toEqual({ ok: true, payload: { recorded: true } });
  });
});

describe('[host:fansly] the vault’s chunk comes with `/creator/vault` (R20 P13b; FS-PERF-3)', () => {
  it('[VA-001] loaded the first time the tab is there, once — never on a chat; a chunk that did not load is said and asked again on the next visit; it stops with the application', async () => {
    const listeners = new Set<(event: HostEvent) => void>();
    const location = { pathname: '/messages/700000000000000033' };
    const loads: string[] = [];
    const reports: unknown[] = [];
    let stops = 0;
    let failNext = true;
    const env = {
      win: { location },
      life: new AbortController().signal,
      host: {
        subscribe(listener: (event: HostEvent) => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        launcher: { serve: () => () => undefined },
      },
      lazy(entry: string) {
        if (entry === 'registration') return Promise.resolve({ startFanslyRegistration: () => () => undefined });
        if (entry === 'notes') return Promise.resolve({ startFanslyNotes: () => () => undefined });
        loads.push(entry);
        if (failNext) {
          failNext = false;
          return Promise.reject(new TypeError('error loading dynamically imported module'));
        }
        return Promise.resolve({ startFanslyVault: () => () => (stops += 1) });
      },
      report: (failure: unknown) => reports.push(failure),
    } as unknown as SiteAppEnv<FanslyPort>;
    const route = async (path: string): Promise<void> => {
      location.pathname = path;
      for (const listener of [...listeners]) listener({ type: 'route' } as HostEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const stop = startFanslySurfaces(env);
    await route('/messages/700000000000000034');
    expect(loads).toEqual([]);
    await route('/creator/vault');
    expect(loads).toEqual(['vault']);
    expect(reports).toEqual([{ kind: 'render', surface: 'vault', code: 'CG-UI-FAILED', name: 'TypeError' }]);
    await route('/creator/vault/');
    await route('/messages/700000000000000033');
    await route('/creator/vault');
    expect(loads).toEqual(['vault', 'vault']);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stops).toBe(1);
  });
});

describe('[host:fansly] the vault’s texts come with its chunk (R20 P13b)', () => {
  it('[I18-001] its keys are answered in the tab’s language of the moment; every other text, number and time is the tab’s own port’s', () => {
    const base = createLiveI18n((language) => (language === 'ru' ? { 'common.close': 'Закрыть' } : { 'common.close': 'Close' }), { language: 'ru' });
    const i18n = withVaultTexts(base);
    const key = (name: string): I18nKey => name as I18nKey;
    expect(i18n.t(key('fansly.vault.progress'), { done: 1, total: 3 })).toBe('Готово 1 из 3');
    expect(i18n.plural(key('fansly.vault.files'), 5)).toBe('5 файлов');
    expect(i18n.t('common.close')).toBe('Закрыть');
    base.setLanguage('en');
    expect(i18n.language).toBe('en');
    expect(i18n.t(key('fansly.vault.progress'), { done: 1, total: 3 })).toBe('1 of 3 done');
    expect(i18n.plural(key('fansly.vault.files'), 1)).toBe('1 file');
    expect(i18n.t('common.close')).toBe('Close');
    expect(i18n.formatMoneyMills(12_480_000)).toBe(base.formatMoneyMills(12_480_000));
  });
});
