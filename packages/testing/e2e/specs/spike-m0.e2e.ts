// What is left of spike M0 (architecture.md §3, docs/spike-m0.md) on the M1
// build: the TEST build as a temporary add-on in headless Firefox, nobody
// signed in. The start of the content scripts is checked where the page
// cannot blur it — the minimal loopback page (`/spike.html`: only the
// observable composer structure of §6.3, no ChatSpace application) — and
// what needs a composer of a real application on the ChatSpace-like fixture:
// - the MAIN bundle (boot + runtime, X11) runs at document_start and its
//   whole synchronous start stays ≤ 1 ms; the isolated bundle ≤ 3 ms (§11);
// - a page without ChatSpace's application gets nothing of ours: no chunk,
//   no host (EX-011);
// - the lazy chunks load by import() from the isolated script, and a strict
//   page CSP blocks neither them nor our styles (EX-009, EX-012);
// - a page cannot switch our content script off with WXT's event;
// - an already open tab after the extension is removed and installed again
//   behaves predictably (stale hosts go, the tab is told to reload).
// The spike's own surfaces (the 1000-row list, the input in the dock) went
// with the spike UI; the kit and the host adapter have their own specs
// (kit-gallery, host-adapter), the signed-in path is integration-m1.
// Measurements go to .cache/e2e/spike-m0.json.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';

import { TEST_GECKO_ID } from '../support/constants';
import { htmlAttribute, installTestBuild, mainBundleMs, readReport, standUrl, summarize, waitForReport, type SpikeReport } from '../support/extension';
import { allowedE2eOrigins, useNetworkTrap } from '../support/network-trap';
import { chatPath, composerRoots, dockPlacement, openStand, STAND_IDS, standServer } from '../support/stand';

const evidence: Record<string, unknown> = {};
const evidenceDir = fileURLToPath(new URL('../../../../.cache/e2e/', import.meta.url));

const { a: accountA } = STAND_IDS.accounts;
const { a1 } = STAND_IDS.fans;

/** Loads of the page for the timing series (§11 budgets are judged on the median and the max). */
const TIMING_LOADS = 12;
/** §11: early isolated bootstrap ≤ 3 ms on winpc; the Mac must stay inside it. */
const BOOTSTRAP_MEDIAN_MS = 3;
/** §11, X11: everything the MAIN bundle does at document_start ≤ 1 ms. */
const MAIN_MEDIAN_MS = 1;
/** No single start may take a frame. */
const START_MAX_MS = 16;

const settled = (report: SpikeReport): boolean => report.dock !== undefined || report.appError !== undefined || report.runtimeError !== undefined;

/** The dock on the fixture's open chat, as the extension reports it; fails with the reason when the application did not start. */
async function dockOnFixture(message: string, predicate: (report: SpikeReport) => boolean = () => true): Promise<SpikeReport> {
  const report = await waitForReport((r) => r.appError !== undefined || r.runtimeError !== undefined || (r.dock !== undefined && predicate(r)), message);
  expect(report.appError).toBeUndefined();
  expect(report.runtimeError).toBeUndefined();
  return report;
}

const dockHeight = (): Promise<number> => browser.execute(() => document.querySelector('[data-host="dock"]')?.getBoundingClientRect().height ?? 0);

describe('spike M0 on the M1 build — the start of the content scripts', () => {
  // stand.js probes the WebSocket constructor with a socket to the closed loopback port 9.
  useNetworkTrap(() => [...allowedE2eOrigins(), 'ws://127.0.0.1:9']);

  before(async () => {
    const capabilities = browser.capabilities as Record<string, unknown>;
    evidence['browser'] = `${String(capabilities['browserName'])} ${String(capabilities['browserVersion'])}`;
    await standServer.reset();
    evidence['addonId'] = await installTestBuild();
  });

  after(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}spike-m0.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('the MAIN bundle runs at document_start and hands a port to the isolated script; the tab registers with the background', async () => {
    await browser.url(standUrl());
    const report = await waitForReport((r) => r.main !== undefined || r.mainError !== undefined, 'MAIN probe');
    expect(report.mainError).toBeUndefined();
    expect(report.main?.readyStateAtStart).toBe('loading');
    expect(report.readyStateAtStart).toBe('loading');
    expect(report.lifecycle).toEqual({ staleHosts: 0, lateInjection: false });
    // Nobody signed in: no bootstrap, so no WS tap is registered.
    expect(report.main?.wsTap).toBe(false);
    expect(await htmlAttribute('data-stand-ws-tap-at-head')).toBe('false');
    evidence['main'] = { ...report.main, bundleMs: await mainBundleMs() };
    const boot = await waitForReport((r) => r.bootstrap !== undefined && r.rpc?.registered === true, 'bootstrap timing and the tab registration');
    expect(boot.bootstrap?.bundleMs).not.toBeNull();
    expect(boot.runtimeError).toBeUndefined();
    // The first start after the install is the cold one (docs/spike-m0.md): recorded, judged by the series below.
    evidence['isolated'] = { startedAt: boot.startedAt, firstStart: boot.bootstrap };
  });

  it('[EX-011] a page without ChatSpace’s application gets nothing of ours: no lazy chunk, no host element', async () => {
    // The page has the composer markup of §6.3, but no application behind it: the adapter reports no composer.
    await browser.pause(700);
    const report = await readReport();
    expect(report?.app).toBeUndefined();
    expect(report?.appError).toBeUndefined();
    expect(report?.dock).toBeUndefined();
    expect(await browser.execute(() => document.querySelectorAll('[data-host]').length)).toBe(0);
  });

  it(`§11 timings over ${TIMING_LOADS} loads: the whole synchronous start of the MAIN bundle (≤ 1 ms, X11) and of the isolated bundle (≤ 3 ms)`, async () => {
    const series: Record<string, number[]> = { mainBundleMs: [], mainInstallMs: [], bundleMs: [], evalMs: [], composeMs: [] };
    const push = (key: string, value: number | null | undefined): void => {
      if (typeof value === 'number') series[key]?.push(value);
    };
    for (let load = 0; load < TIMING_LOADS; load += 1) {
      await browser.url(standUrl());
      const report = await waitForReport((r) => r.bootstrap !== undefined && r.main !== undefined, `timings, load ${load + 1}`);
      push('mainBundleMs', await mainBundleMs());
      push('mainInstallMs', report.main?.installMs);
      push('bundleMs', report.bootstrap?.bundleMs);
      push('evalMs', report.bootstrap?.evalMs);
      push('composeMs', report.bootstrap?.composeMs);
    }
    const timings = Object.fromEntries(Object.entries(series).map(([key, values]) => [key, summarize(values)]));
    evidence['timings'] = { loads: TIMING_LOADS, ...timings };
    const main = summarize(series['mainBundleMs'] ?? []);
    expect(main.n).toBe(TIMING_LOADS);
    expect(main.median).toBeLessThanOrEqual(MAIN_MEDIAN_MS);
    expect(main.max).toBeLessThanOrEqual(START_MAX_MS);
    const bundle = summarize(series['bundleMs'] ?? []);
    expect(bundle.n).toBe(TIMING_LOADS);
    expect(bundle.median).toBeLessThanOrEqual(BOOTSTRAP_MEDIAN_MS);
    expect(bundle.max).toBeLessThanOrEqual(START_MAX_MS);
  });

  it("a page cannot switch our content script off with WXT's «script started» event", async () => {
    await browser.url(standUrl());
    const before = await waitForReport((r) => r.rpc?.registered === true, 'the tab registered before the spoof');
    // WXT invalidates its ContentScriptContext on this CustomEvent; the name is
    // public (gecko id + entry name), so any page can send it.
    await browser.execute((name) => {
      document.dispatchEvent(new CustomEvent(name, { detail: { contentScriptName: 'chatspace', messageId: 'spoof' } }));
    }, `${TEST_GECKO_ID}:chatspace:wxt:content-script-started`);
    const report = await waitForReport((r) => (r.ignoredInvalidations ?? 0) >= 1, 'spoofed invalidation reached WXT and was ignored');
    expect(report.runtime).toBeUndefined();
    expect(report.rpc).toEqual(before.rpc);
    evidence['spoofedInvalidation'] = { ignoredInvalidations: report.ignoredInvalidations, stillRegistered: report.rpc?.registered };
  });

  it('[EX-009] [EX-012] with a composer the lazy chunks load by import() from the isolated script; Preact renders the dock in a closed shadow root with adopted sheets', async () => {
    await openStand(chatPath(accountA, a1));
    const report = await dockOnFixture('dock mounted on the fixture', (r) => r.dock?.status === 'not-signed-in');
    expect(report.app?.loadMs).toBeGreaterThan(0);
    expect(report.dock).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, styleMode: 'adopted', contract: 'ok', banner: 'CG-AUTH-REQUIRED' });
    const roots = await composerRoots();
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
    expect(await browser.execute(() => document.querySelector('[data-host="dock"]')?.shadowRoot ?? null)).toBeNull();
    // Our sheets apply inside the closed root: an unstyled status row is a ~20 px block, ours is the 34 px strip and its banner.
    const height = await dockHeight();
    expect(height).toBeGreaterThanOrEqual(34);
    expect(report.dock?.height).toBe(height);
    evidence['dock'] = { ...report.dock, appLoadMs: report.app?.loadMs };
    mkdirSync(evidenceDir, { recursive: true });
    await browser.saveScreenshot(`${evidenceDir}stand-dock.png`);
  });

  it('[EX-009] [EX-012] a strict page CSP blocks neither the lazy chunks nor our styles', async () => {
    const plain = evidence['dock'] as { height: number; text: string | null };
    await openStand(chatPath(accountA, a1), { csp: 'strict' });
    // The page really runs under the policy: its own inline script is refused.
    const inlineRan = await browser.execute(() => {
      const script = document.createElement('script');
      script.textContent = 'document.documentElement.setAttribute("data-inline-ran", "1")';
      document.head.append(script);
      script.remove();
      return document.documentElement.hasAttribute('data-inline-ran');
    });
    expect(inlineRan).toBe(false);
    const report = await dockOnFixture('dock under the strict CSP', (r) => r.dock?.status === 'not-signed-in' && r.main !== undefined);
    expect(report.mainError).toBeUndefined();
    expect(report.main?.readyStateAtStart).toBe('loading');
    // Styles, not just the mount: the same sheets mode, text and height as without the CSP.
    expect(report.dock).toMatchObject({ kind: 'in-flow', inFlowFirstChild: true, styleMode: 'adopted', contract: 'ok', height: plain.height, text: plain.text });
    expect(await dockHeight()).toBe(plain.height);
    mkdirSync(evidenceDir, { recursive: true });
    await browser.saveScreenshot(`${evidenceDir}stand-dock-strict-csp.png`);
    evidence['strictCsp'] = { dock: report.dock, appLoadMs: report.app?.loadMs, main: report.main };
  });

  it('an already-open tab after the extension is removed and installed again behaves predictably', async () => {
    await openStand(chatPath(accountA, a1));
    const before: SpikeReport = await dockOnFixture('dock before reinstall');
    // Classic `uninstallAddOn` is broken in WebdriverIO 9.32 on Node 26 (it sends a
    // GET with a body); the BiDi command does the same thing.
    await browser.webExtensionUninstall({ extension: String(evidence['addonId']) });
    // Removal has no page-visible event to wait for.
    await browser.pause(1000);
    const afterRemove = await readReport();
    const hostsAfterRemove = await browser.execute(() => document.querySelectorAll('[data-host]').length);
    evidence['addonId'] = await installTestBuild();
    const afterInstall = await waitForReport((r) => r.startedAt !== before.startedAt && r.main !== undefined && settled(r), 'new instance injected into the open tab');
    evidence['reinstall'] = { before: { startedAt: before.startedAt }, afterRemove, hostsAfterRemove, afterInstall };
    // Removal: Firefox kills the old content script silently (no port event, no
    // report update) and leaves its DOM in place.
    expect(afterRemove?.startedAt).toBe(before.startedAt);
    expect(afterRemove?.runtime).toBeUndefined();
    expect(hostsAfterRemove).toBeGreaterThan(0);
    // Install: Firefox injects the manifest content scripts into the open tab,
    // late (document already complete); the new instance removes the stale hosts
    // and says the tab needs a reload (UP-009).
    expect(afterInstall.appError).toBeUndefined();
    expect(afterInstall.main?.readyStateAtStart).toBe('complete');
    expect(afterInstall.lifecycle).toEqual({ staleHosts: hostsAfterRemove, lateInjection: true });
    const roots = await composerRoots();
    expect(await dockPlacement()).toEqual({ hosts: 1, parentKey: roots.active[0], firstChild: true, visible: true });
    const reload = await dockOnFixture('the «reload the tab» banner', (r) => r.startedAt !== before.startedAt && r.dock?.status === 'reload-needed');
    expect(reload.dock).toMatchObject({ banner: 'CG-RUNTIME-RELOADED' });
  });
});
