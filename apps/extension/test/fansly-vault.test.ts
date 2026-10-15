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
function backgroundOf(context: FakeContext, kv: MemoryKv): Background {
  const rpc = createBackgroundRpc({ api: context.api, tabHosts: TAB_HOSTS, ready: Promise.resolve(), contractsVersion: CONTRACTS_VERSION, testBuild: true, siteWaitMs: 2_000 });
  const kit = {
    storage: { local: kv.open() },
    clock: { now: () => T0 },
    log: { service: () => undefined },
    site: { plug: (registry: HostSiteRegistry) => rpc.site({ ...registry, host: 'fansly-web' }) },
  } as unknown as BackgroundKit;
  return { rpc, module: fanslyModule().start(kit) };
}

interface World {
  readonly fake: FakeBrowser;
  readonly kv: MemoryKv;
  readonly backgrounds: Background[];
  tab(): TabRpcClient;
}

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.fake.unloadBackground();
});

function world(): World {
  const fake = createFakeBrowser();
  const kv = createMemoryKv();
  const backgrounds: Background[] = [];
  fake.onWake((context) => backgrounds.push(backgroundOf(context, kv)));
  const w: World = {
    fake,
    kv,
    backgrounds,
    tab() {
      const url = `${FANSLY_ORIGIN}/creator/vault`;
      return createTabRpcClient({
        api: fake.context(tabSender(fake, { url, origin: FANSLY_ORIGIN, tab: { id: 12, url } })).api,
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
      },
      lazy(entry: string) {
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
