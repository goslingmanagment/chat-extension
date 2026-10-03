// Spike M0 (architecture.md §3) on the loopback stand, in headless Firefox,
// with the TEST build installed as a temporary add-on. Measurements are
// appended to .cache/e2e/spike-m0.json for docs/spike-m0.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { TEST_GECKO_ID } from '../support/constants';
import { htmlAttribute, installTestBuild, readReport, standUrl, summarize, waitForReport, type SpikeReport } from '../support/extension';

const evidence: Record<string, unknown> = {};
const evidenceDir = fileURLToPath(new URL('../../../../.cache/e2e/', import.meta.url));

/** What our stylesheet gives the dock row (DOCK_CSS); unstyled it is a ~22 px block. */
const STYLED_DOCK = { display: 'flex', height: '36px', boxSizing: 'border-box' };
const DOCK_HEIGHT_PX = 36;

/** Loads of the stand for the timing series (§11 budgets are judged on the median and the max). */
const TIMING_LOADS = 12;
/** §11: early isolated bootstrap ≤ 3 ms on winpc; the Mac must stay inside it. */
const BOOTSTRAP_MEDIAN_MS = 3;
/** No single start may take a frame. */
const BOOTSTRAP_MAX_MS = 16;

async function dockHostHeight(): Promise<number> {
  return browser.execute(() => document.querySelector('[data-cg="dock"]')?.getBoundingClientRect().height ?? 0);
}

describe('spike M0 — test build on the loopback stand', () => {
  before(async () => {
    const capabilities = browser.capabilities as Record<string, unknown>;
    evidence['browser'] = `${String(capabilities['browserName'])} ${String(capabilities['browserVersion'])}`;
    evidence['addonId'] = await installTestBuild();
  });

  after(() => {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(`${evidenceDir}spike-m0.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it('d) the MAIN bridge runs at document_start and hands a port to the isolated script', async () => {
    await browser.url(standUrl());
    const report = await waitForReport((r) => r.main !== undefined || r.mainError !== undefined, 'MAIN probe');
    expect(report.mainError).toBeUndefined();
    expect(report.main?.readyStateAtStart).toBe('loading');
    expect(report['readyStateAtStart']).toBe('loading');
    evidence['main'] = report.main;
    const boot = await waitForReport((r) => r.bootstrap !== undefined, 'bootstrap timing');
    expect(boot.bootstrap?.bundleMs).not.toBeNull();
    evidence['isolated'] = { startedAt: boot.startedAt, bootstrap: boot.bootstrap };
  });

  it('d) the background registers the WS tap dynamically (world MAIN) and it runs at document_start', async () => {
    await waitForReport((r) => r.background?.wsTapRegistered === true, 'background status with wsTapRegistered');
    await browser.refresh();
    const report = await waitForReport((r) => r.main !== undefined, 'MAIN probe after reload');
    expect(await htmlAttribute('data-stand-ws-tap-at-head')).toBe('true');
    expect(await htmlAttribute('data-stand-ws-native')).toBe('true');
    expect(await htmlAttribute('data-stand-ws-tap-sockets')).toBe('1');
    expect(report.main?.wsTap).toBe(true);
    evidence['wsTap'] = { atHead: true, nativeSemantics: true, report: report.main };
  });

  it('c) the lazy ESM dock chunk loads from the isolated script; b) Preact renders it in a closed shadow root', async () => {
    const report = await waitForReport((r) => r.dock !== undefined || r.dockError !== undefined, 'dock mounted');
    expect(report.dockError).toBeUndefined();
    expect(report.dock?.inFlowFirstChild).toBe(true);
    const hostShape = await browser.execute(() => {
      const host = document.querySelector('[data-cg="dock"]');
      return {
        count: document.querySelectorAll('[data-cg="dock"]').length,
        shadowRootVisibleToPage: host?.shadowRoot !== null,
        parentIsComposerRoot: host?.parentElement?.id === 'composer-root',
        height: host?.getBoundingClientRect().height ?? 0,
      };
    });
    expect(hostShape.count).toBe(1);
    expect(hostShape.shadowRootVisibleToPage).toBe(false);
    expect(hostShape.parentIsComposerRoot).toBe(true);
    // Our stylesheet applies inside the closed root (adoptedStyleSheets).
    expect(report.dock?.styleMode).toBe('adopted');
    expect(report.dock?.style).toEqual(STYLED_DOCK);
    expect(hostShape.height).toBe(DOCK_HEIGHT_PX);
    evidence['dock'] = { ...report.dock, hostHeight: hostShape.height };
  });

  it('b) a plain 1000-row Preact list renders inside a closed shadow root', async () => {
    const report = await waitForReport((r) => r.list !== undefined || r.listError !== undefined, '1000-row list');
    expect(report.listError).toBeUndefined();
    expect(report.list?.domRows).toBe(1000);
    evidence['list'] = report.list;
  });

  it('b) focus moves into the closed root and typing reaches the input', async () => {
    const rect = await browser.execute(() => {
      const box = document.querySelector('[data-cg="dock"]')?.getBoundingClientRect();
      return box ? { right: box.right, top: box.top, height: box.height } : null;
    });
    if (!rect) throw new Error('dock host missing');
    // The input is the last item of the dock row: 160 px wide, 10 px padding.
    await browser
      .action('pointer')
      .move({ x: Math.round(rect.right - 10 - 80), y: Math.round(rect.top + rect.height / 2), origin: 'viewport' })
      .down()
      .up()
      .perform();
    await browser.keys(['h', 'i', ' ', 'П', 'р', 'и', 'в', 'е', 'т']);
    const report = await waitForReport((r) => r.focus?.value === 'hi Привет', 'typed text in the closed-root input');
    expect(report.focus).toEqual({ rootActive: 'INPUT', docActiveIsHost: true, value: 'hi Привет' });
    evidence['focus'] = report.focus;

    // Keyboard: from the ChatSpace-like editor below, Shift+Tab goes back into
    // the closed root (the dock precedes the composer frame in DOM order).
    await browser.execute(() => document.querySelector<HTMLElement>('.editor')?.focus());
    expect(await browser.execute(() => document.activeElement?.className)).toBe('editor');
    await browser.keys(['Shift', 'Tab']);
    // Tab focus selects the input's text; move to the end before typing.
    await browser.keys([Key.ArrowRight, '!']);
    const keyboard = await waitForReport((r) => r.focus?.value === 'hi Привет!', 'Shift+Tab back into the closed root');
    expect(keyboard.focus?.docActiveIsHost).toBe(true);
    evidence['keyboardFocus'] = keyboard.focus;
    // What it actually looks like (owner reads the picture in docs, not the DOM).
    mkdirSync(evidenceDir, { recursive: true });
    await browser.saveScreenshot(`${evidenceDir}stand-dock.png`);
  });

  it('c) a strict page CSP does not block the lazy chunk or our styles', async () => {
    await browser.url(standUrl('/spike.html?csp=strict'));
    const report = await waitForReport(
      (r) => (r.list !== undefined && r.dock !== undefined && r.main !== undefined) || r.dockError !== undefined || r.listError !== undefined,
      'dock + list + MAIN probe under strict CSP',
    );
    expect(report.dockError).toBeUndefined();
    expect(report.listError).toBeUndefined();
    expect(report.main?.readyStateAtStart).toBe('loading');
    // Styles, not just the mount: same computed style and height as without CSP.
    expect(report.dock?.styleMode).toBe('adopted');
    expect(report.dock?.style).toEqual(STYLED_DOCK);
    const hostHeight = await dockHostHeight();
    expect(hostHeight).toBe(DOCK_HEIGHT_PX);
    mkdirSync(evidenceDir, { recursive: true });
    await browser.saveScreenshot(`${evidenceDir}stand-dock-strict-csp.png`);
    evidence['strictCsp'] = { dock: report.dock, hostHeight, list: report.list, main: report.main };
  });

  it(`§11 timings over ${TIMING_LOADS} loads: the whole synchronous start of the isolated bundle, dock and list`, async () => {
    const series: Record<string, number[]> = { bundleMs: [], composeMs: [], dockLoadMs: [], dockRenderMs: [], listRenderMs: [], listUpdateMs: [], firstFrameMs: [], mainInstallMs: [] };
    const push = (key: string, value: number | null | undefined): void => {
      if (typeof value === 'number') series[key]?.push(value);
    };
    for (let load = 0; load < TIMING_LOADS; load += 1) {
      await browser.url(standUrl());
      const report = await waitForReport(
        (r) => r.bootstrap !== undefined && r.list !== undefined && r.main !== undefined,
        `timings, load ${load + 1}`,
      );
      push('bundleMs', report.bootstrap?.bundleMs);
      push('composeMs', report.bootstrap?.composeMs);
      push('dockLoadMs', report.dock?.loadMs);
      push('dockRenderMs', report.dock?.renderMs);
      push('listRenderMs', report.list?.renderMs);
      push('listUpdateMs', report.list?.updateMs);
      push('firstFrameMs', report.list?.firstFrameMs);
      push('mainInstallMs', report.main?.installMs);
    }
    const timings = Object.fromEntries(Object.entries(series).map(([key, values]) => [key, summarize(values)]));
    evidence['timings'] = { loads: TIMING_LOADS, ...timings };
    const bundle = summarize(series['bundleMs'] ?? []);
    expect(bundle.n).toBe(TIMING_LOADS);
    expect(bundle.median).toBeLessThanOrEqual(BOOTSTRAP_MEDIAN_MS);
    expect(bundle.max).toBeLessThanOrEqual(BOOTSTRAP_MAX_MS);
  });

  it("a page cannot switch our content script off with WXT's «script started» event", async () => {
    await browser.url(standUrl());
    await waitForReport((r) => r.dock !== undefined, 'dock before the spoof');
    // WXT invalidates its ContentScriptContext on this CustomEvent; the name is
    // public (gecko id + entry name), so any page can send it.
    await browser.execute((name) => {
      document.dispatchEvent(new CustomEvent(name, { detail: { contentScriptName: 'chatspace', messageId: 'spoof' } }));
    }, `${TEST_GECKO_ID}:chatspace:wxt:content-script-started`);
    const report = await waitForReport((r) => (r.ignoredInvalidations ?? 0) >= 1, 'spoofed invalidation reached WXT and was ignored');
    expect(report.runtime).toBeUndefined();
    expect(await browser.execute(() => document.querySelectorAll('[data-cg="dock"]').length)).toBe(1);
    expect(await dockHostHeight()).toBe(DOCK_HEIGHT_PX);
    evidence['spoofedInvalidation'] = { ignoredInvalidations: report.ignoredInvalidations, dockSurvived: true };
  });

  it('c) an already-open tab after the extension is removed and installed again behaves predictably', async () => {
    await browser.url(standUrl());
    const before: SpikeReport = await waitForReport((r) => r.dock !== undefined, 'dock before reinstall');
    // Classic `uninstallAddOn` is broken in WebdriverIO 9.32 on Node 26 (it sends a
    // GET with a body); the BiDi command does the same thing.
    await browser.webExtensionUninstall({ extension: String(evidence['addonId']) });
    // Removal has no page-visible event to wait for.
    await browser.pause(1000);
    const afterRemove = await readReport();
    const hostsAfterRemove = await browser.execute(() => document.querySelectorAll('[data-cg]').length);
    evidence['addonId'] = await installTestBuild();
    const afterInstall = await waitForReport(
      (r) => r.startedAt !== before.startedAt && r.main !== undefined && r.dock !== undefined,
      'new instance injected into the open tab',
    );
    const hostsAfterInstall = await browser.execute(() => document.querySelectorAll('[data-cg="dock"]').length);
    evidence['reinstall'] = { before: { startedAt: before.startedAt }, afterRemove, hostsAfterRemove, afterInstall, hostsAfterInstall };
    // Removal: Firefox kills the old content script silently (no port event, no
    // report update) and leaves its DOM in place.
    expect(afterRemove?.startedAt).toBe(before.startedAt);
    expect(afterRemove?.runtime).toBeUndefined();
    expect(hostsAfterRemove).toBeGreaterThan(0);
    // Install: Firefox injects the manifest content scripts into the open tab,
    // late (document already complete); the new instance removes the stale hosts.
    expect(afterInstall.main?.readyStateAtStart).toBe('complete');
    expect(afterInstall['lifecycle']).toEqual({ staleHosts: hostsAfterRemove, lateInjection: true });
    expect(hostsAfterInstall).toBe(1);
  });
});

