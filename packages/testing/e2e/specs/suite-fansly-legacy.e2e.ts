// P7g: real Fansly bundles in Firefox, never a live site. `legacy` neighbour
// means old FBuddy, NOT old ChatGoose; only ChatGoose's own markers retire us.
import type { FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import { browser, expect } from '@wdio/globals';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { fakeFansly, fanslyIds, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { injectFanslyMain, installFanslyTapHarness, tap, waitForFanslyTap, type FanslyTapHarness } from '../support/fansly-tap';
import { useNetworkTrap } from '../support/network-trap';
import { capturePage } from '../support/pages';
import { installTestBuild, waitForReport } from '../support/extension';
import { switchFanslyOnForTheStand } from '../support/fansly-site';

const notice = () => browser.execute(() => {
  const host = document.querySelector('[data-host="reload-notice"]');
  return { count: document.querySelectorAll('[data-host="reload-notice"]').length, visible: (host?.getBoundingClientRect().height ?? 0) > 0, docks: document.querySelectorAll('[data-host="dock"], [data-host="overlay"]').length };
});

describe('[NEW-12] [FS-CO-1] Fansly coexistence on the stand', () => {
  useNetworkTrap();
  let harness: FanslyTapHarness | null = null;
  let ids: Awaited<ReturnType<typeof fanslyIds>>;
  before(async () => {
    await fakeFansly().command({ op: 'reset' }); await browser.setWindowSize(1440, 900);
    await openWithNeighbor('/messages', { mode: 'off' });
    ids = await fanslyIds();
  });
  afterEach(async () => { await harness?.remove(); harness = null; await browser.url('about:blank'); });
  after(async () => { await setFanslyNeighbor(null); expect(await fakeFansly().calls('ours', 0)).toEqual([]); });

  for (const legacy of ['before', 'after'] as const) {
    it(`[NEW-12] [FS-CO-1] old ChatGoose ${legacy} MAIN: no page facts forwarded, even beside legacy FBuddy +guard +generic`, async () => {
      harness = await installFanslyTapHarness({ main: 'start', legacy });
      await openWithNeighbor('/messages', { mode: 'legacy', guard: ['forbidden'], generic: 'proxy' });
      await waitForFanslyTap(); await waitForFanslyStandIdle();
      const state = await tap<FanslyState>('state');
      expect(state.identity).toMatchObject({ legacy: true, creatorId: null, fbuddy: { windowBridge: true, networkHook: true, styleFixes: true, wordFilter: true } });
      const before = await tap<FanslyHealth>('health');
      const ids = await fanslyIds();
      await fakeFansly().command({ op: 'message', groupId: String(ids.groups[0]), text: 'old extension owns this' });
      await waitForFanslyStandIdle();
      expect((await tap<FanslyHealth>('health')).frames.seen).toBe(before.frames.seen);
      expect((await tap<Array<{ t: string }>>('events')).filter((event) => ['fx.incoming', 'fx.follow', 'fx.sent'].includes(event.t))).toEqual([]);
    });
  }

  for (const mode of ['off', 'after', 'legacy'] as const) {
    it(`[NEW-12] [FS-CO-1] ${mode} FBuddy is admitted, its booleans truthful; an old copy of our MAIN retires the host with a visible banner`, async () => {
      harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
      await openWithNeighbor(`/messages/${String(ids.groups[0])}`, { mode, guard: mode === 'off' ? [] : ['forbidden'], generic: 'subclass' });
      await waitForFanslyTap(); await waitForFanslyStandIdle();
      expect(await tap('activation')).toEqual({ ready: true, stopped: false });
      await browser.waitUntil(async () => (await notice()).docks > 0, { timeout: 5000 });
      expect((await tap<FanslyState>('state')).identity).toMatchObject({ legacy: false, fbuddy: { windowBridge: mode !== 'off', networkHook: mode !== 'off', styleFixes: mode !== 'off', wordFilter: mode !== 'off' } });
      await injectFanslyMain();
      await browser.waitUntil(async () => (await tap<{ stopped: boolean }>('activation')).stopped, { timeout: 5000 });
      expect(await notice()).toEqual({ count: 1, visible: true, docks: 0 });
      expect(await tap('port')).toMatchObject({ accounts: [], identity: null, composer: null });
      expect((await tap<{ capabilities: Record<string, { state: string; reason: string }> }>('report')).capabilities.identity).toMatchObject({ state: 'off', reason: 'update' });
      if (mode === 'after') await capturePage('p7g-old-copy-notice');
    });
  }

  it('[NEW-12] [FS-CO-1] old symbol installed at DOMContentLoaded, then disabled without reload: banner stays and no host is admitted', async () => {
    harness = await installFanslyTapHarness({ main: 'start', consumer: 'port', legacy: 'ready' });
    await openWithNeighbor('/messages', { mode: 'after' });
    await waitForFanslyTap();
    expect(await tap('activation')).toEqual({ ready: false, stopped: true });
    expect(await notice()).toEqual({ count: 1, visible: true, docks: 0 });
    await browser.execute(() => { const node = document.createElement('div'); node.id = 'chatgoose-root'; document.body.append(node); });
    // Disabling the old add-on cannot remove its MAIN Symbol. Removing its UI
    // alone must not wake our host either.
    await browser.execute(() => document.querySelector('#chatgoose-root')?.remove());
    expect(await tap('activation')).toEqual({ ready: false, stopped: true });
    await capturePage('p7g-legacy-notice');
  });
});

describe('[NEW-12] [FS-CO-1] the installed extension steps aside and P9a notices updates', () => {
  useNetworkTrap();
  after(async () => { await setFanslyNeighbor(null); });
  it('[NEW-12] [FS-CO-1] DOM-only old ChatGoose: whole tab stops; reinstalling into an open document shows one live reload banner', async () => {
    await setFanslyNeighbor({ mode: 'after', guard: ['forbidden'] });
    await installTestBuild();
    await switchFanslyOnForTheStand();
    const old = await browser.scriptAddPreloadScript({ functionDeclaration: `() => {
      document.addEventListener('DOMContentLoaded', () => {
        const host = document.createElement('div'); host.id = 'chatgoose-root'; document.body.append(host);
      }, { once: true });
    }` });
    try {
      await browser.url(fanslyStandUrl('/messages')); await waitForFanslyStandReady();
      await waitForReport((report) => report.runtime === 'shut-down', 'old extension stops the entire tab');
      expect(await notice()).toEqual({ count: 1, visible: true, docks: 0 });
      await browser.execute(() => document.querySelector('#chatgoose-root')?.remove());
      await waitForReport((report) => report.runtime === 'shut-down' && report.rpc?.registered !== true, 'no background registration after removal');
      await browser.execute(() => document.querySelector('[data-host="reload-notice"]')?.setAttribute('data-dead', 'true'));
      await installTestBuild();
      await browser.waitUntil(() => browser.execute(() => document.querySelector('[data-host="reload-notice"]') !== null && document.querySelector('[data-dead]') === null), { timeout: 15_000 });
      expect(await notice()).toEqual({ count: 1, visible: true, docks: 0 });
      await capturePage('p7g-update-notice');
    } finally { await browser.scriptRemovePreloadScript({ script: old.script }); }
    await browser.refresh(); await waitForFanslyStandReady();
    await waitForReport((report) => report.rpc?.registered === true, 'new document admitted after update');
    expect((await notice()).count).toBe(0);
    const ids = await fanslyIds();
    await browser.url(fanslyStandUrl(`/messages/${String(ids.groups[0])}`));
    await waitForFanslyStandReady();
    await waitForReport((report) => report.dock?.strip === true, 'the real dock rendered after reload');
    expect((await notice()).docks).toBeGreaterThan(0);
    await injectFanslyMain();
    await waitForReport((report) => report.runtime === 'shut-down', 'a duplicate MAIN stops the running dock');
    expect(await notice()).toEqual({ count: 1, visible: true, docks: 0 });
    await capturePage('p7g-running-dock-retired');
  });
});
