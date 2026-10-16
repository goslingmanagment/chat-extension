// The Fansly site on its stand (R20 P7a0; docs/project-unite/architecture.md
// §1.3, §3.1, §4, §6, §7.1): the first spec with our extension on the Fansly
// stand, and from here on the owner of every Fansly feature's e2e (plan.md §0).
// - Fansly's two scripts are registered as the background will register them
//   after «Включить Fansly» (P9a): one call, MAIN first, at document_start —
//   and reach no page before the stand's origins are granted, as a person
//   would grant them (the stand is optional, never granted at install: P6a);
// - granted, both run at document_start: MAIN (the shared boot of host-kit
//   with Fansly's taps, P7a) hands its port to the isolated script, which
//   assembles Fansly's adapter and checks MAIN's probe with Fansly's own
//   schemas — the first chunk of Fansly's own lazy build,
//   `lazy/fansly/bridge-validation.js` — next to the FBuddy-like neighbour
//   in `off` and `after` (X34): the page and the neighbour see what they
//   see without us, and nothing of ours asks Fansly;
// - Fansly's lazy build is a web resource of its own pages alone; ChatSpace's
//   is not one of them (EX-010);
// - the whole synchronous start of either script stays in its budget: MAIN
//   ≤ 1 ms, the isolated one ≤ 3 ms (§3.1), printed on every run.
// P9a accepts the handshake and starts the site module; Fansly's host port
// (P7c) comes up too, and our dock has its place by Fansly's composer (P7d):
// the application of Fansly's own lazy build starts with it — the dock's
// place, overlays and theme on the stand are suite-fansly-dock's; the port's
// route, anchors and identity, suite-fansly-tap's.

import { browser, expect } from '@wdio/globals';

import { budgetMs } from '../../src/e2e-timing';
import { testBuildPage } from '../support/fake-hub';
import { E2E_ADDON_UUID } from '../support/constants';
import { installTestBuild, mainBundleMs, readReport, summarize, waitForReport, type SpikeReport } from '../support/extension';
import { callNeighbor, openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { FANSLY_SCRIPTS, FANSLY_STAND_PATTERN, registeredScripts } from '../support/fansly-site';
import { callFansly, fakeFansly, fanslyIds, fanslyStandServer, fanslyStandUrl, openFanslyStand, waitForFanslyStandIdle } from '../support/fansly-stand';
import { useNetworkTrap } from '../support/network-trap';
import { grantedState, grantOptional } from '../support/permissions';

type Ids = Awaited<ReturnType<typeof fanslyIds>>;

/** Loads of the page for the timing series (§3.1 budgets are judged on the median and the max). */
const TIMING_LOADS = 8;
/** §3.1: everything Fansly's MAIN does at document_start ≤ 1 ms. */
const MAIN_MEDIAN_MS = 1;
/** §3.1: the early isolated start ≤ 3 ms. */
const BOOTSTRAP_MEDIAN_MS = 3;
/** No single start may take a frame. */
const START_MAX_MS = 16;

/** A call as the server answered it and as the neighbour's hook reported it: `METHOD path → status`. */
const line = (method: string, address: string, status: number): string => `${method} ${address.replace(/before=\d+/, 'before=*')} → ${status}`;

/** Both scripts reported: MAIN's probe through the bridge, and the isolated start's own timing. */
const started = (report: SpikeReport): boolean => (report.main !== undefined || report.mainError !== undefined) && report.bootstrap !== undefined;

describe('the Fansly site on its stand: both scripts at document_start, the bridge of host-kit through Fansly’s own schemas, next to the neighbour', () => {
  useNetworkTrap();
  let ids: Ids;
  let journalStart = 0;

  before(async () => {
    await setFanslyNeighbor(null);
    await fakeFansly().command({ op: 'reset' });
    journalStart = await fanslyStandServer.mark();
    await installTestBuild();
    await browser.url(testBuildPage());
  });

  after(async () => {
    // Nothing of the extension asked the Fansly stand for anything: only the page's own loads.
    const entries = await fanslyStandServer.journal(journalStart);
    expect(entries.filter((entry) => entry.origin !== 'asset')).toEqual([]);
    await setFanslyNeighbor(null);
    await browser.url('about:blank');
    await fakeFansly().command({ op: 'reset' });
  });

  it('the background registers nothing before the optional stand grant', async () => {
    const registered = await registeredScripts();
    expect(registered.filter((script) => FANSLY_SCRIPTS.some((own) => own.id === script.id))).toEqual([]);
    expect(await grantedState(fanslyStandUrl('/messages'))).toMatchObject({ reaches: false });
    await openFanslyStand('/messages');
    ids = await fanslyIds();
    await browser.pause(700);
    expect(await readReport()).toBeNull();
    expect(await mainBundleMs()).toBeNull();
  });

  for (const mode of ['off', 'after'] as const) {
    it(`[EX-009] granted, the neighbour ${mode}: MAIN hands its port to the isolated script at document_start, and its probe passes Fansly’s schemas from lazy/fansly; the page and the neighbour are as without us`, async () => {
      if (mode === 'off') {
        await grantOptional({ origins: [FANSLY_STAND_PATTERN], permissions: ['webRequest'] });
        await browser.url(testBuildPage());
        await browser.waitUntil(async () => (await registeredScripts()).some((script) => script.id === 'fansly'), { timeout: 15_000 });
      }
      const fake = fakeFansly();
      const since = await fake.mark();
      const [first, second] = ids.groups as [string, string];
      await openWithNeighbor(`/messages/${first}`, { mode });

      const report = await waitForReport(started, `both scripts on the stand (neighbour ${mode})`);
      expect(report.mainError).toBeUndefined();
      // MAIN's probe came back through the bridge: the isolated side loaded Fansly's schema chunk to check it.
      expect(report.main).toEqual({ v: 1, readyStateAtStart: 'loading', installMs: expect.any(Number) as unknown, wsTap: false });
      expect(report.readyStateAtStart).toBe('loading');
      expect(report.lifecycle).toEqual({ staleHosts: 0, lateInjection: false });
      expect(report.bootstrap?.bundleMs).not.toBeNull();
      expect(await mainBundleMs()).not.toBeNull();
      // P9a accepts the tab; the dock has its place (P7d): the application of Fansly's build starts.
      const later = await waitForReport((r) => r.rpc?.registered === true && r.app !== undefined, 'the tab registered, the application started', 20_000);
      expect([later.appError, later.runtimeError]).toEqual([undefined, undefined]);
      // Loading the app is not the end of the page's initial route: its group answer can replace the composer.
      await waitForFanslyStandIdle();
      await browser.waitUntil(async () => browser.execute(() => document.querySelector('[data-host="dock"]')?.nextElementSibling?.localName === 'app-group-message-input'), { timeout: 10_000, timeoutMsg: 'the dock is placed by the settled composer' });
      // Exactly one dock host of ours, in flow right before Fansly's composer.
      expect(await browser.execute(() => [...document.querySelectorAll('[data-host="dock"]')].map((host) => host.nextElementSibling?.localName ?? null))).toEqual(['app-group-message-input']);

      // The page goes on as its own: it settles, opens a chat, and only the page — never we — asked Fansly.
      const mark = await fake.mark();
      const logMark = mode === 'off' ? 0 : ((await callNeighbor('log')).at(-1)?.seq ?? 0);
      await callFansly('open', second);
      await browser.waitUntil(async () => (await callFansly('list'))?.groupId === second && ((await callFansly('list'))?.messages ?? 0) > 0, { timeout: 10_000, timeoutMsg: 'the second chat' });
      await waitForFanslyStandIdle();
      expect(await fake.calls('ours', since)).toEqual([]);
      await fake.assertOursClean(since, `our scripts next to the neighbour ${mode}`);
      const page = (await fake.calls('page', mark)).map((entry) => line(entry.method ?? '', entry.path ?? '', entry.status ?? 0)).sort();
      expect(page.length).toBeGreaterThan(0);
      if (mode === 'after') {
        // Its hook on the XHR prototype saw every request of the page, as it does without us (fansly-stand-neighbor).
        const seen = (await callNeighbor('log', logMark)).map((entry) => line(entry.method, `${new URL(entry.url).pathname}${new URL(entry.url).search}`, entry.status)).sort();
        expect(seen).toEqual(page);
      }
    });
  }

  it('[EX-010] Fansly’s lazy build is a web resource of its own pages: the stand loads its schema chunk, never a chunk of ChatSpace’s build', async () => {
    await setFanslyNeighbor(null);
    await openFanslyStand('/messages');
    const base = `moz-extension://${E2E_ADDON_UUID}/`;
    const answers = await browser.execute(async (origin: string) => {
      const load = async (path: string): Promise<string> => {
        try {
          const response = await fetch(`${origin}${path}`);
          return `${response.status}`;
        } catch {
          return 'refused';
        }
      };
      return { fansly: await load('lazy/fansly/bridge-validation.js'), chatspace: await load('lazy/chatspace/bridge-validation.js') };
    }, base);
    expect(answers).toEqual({ fansly: '200', chatspace: 'refused' });
  });

  it(`§3.1 timings over ${TIMING_LOADS} loads: the whole synchronous start of Fansly’s MAIN (≤ 1 ms) and of its isolated script (≤ 3 ms)`, async () => {
    const series: Record<string, number[]> = { mainBundleMs: [], mainInstallMs: [], bundleMs: [], evalMs: [], composeMs: [] };
    const push = (key: string, value: number | null | undefined): void => {
      if (typeof value === 'number') series[key]?.push(value);
    };
    for (let load = 0; load < TIMING_LOADS; load += 1) {
      await browser.url(fanslyStandUrl('/messages'));
      const report = await waitForReport((r) => r.bootstrap !== undefined && r.main !== undefined, `timings, load ${load + 1}`);
      push('mainBundleMs', await mainBundleMs());
      push('mainInstallMs', report.main?.installMs);
      push('bundleMs', report.bootstrap?.bundleMs);
      push('evalMs', report.bootstrap?.evalMs);
      push('composeMs', report.bootstrap?.composeMs);
    }
    const stat = (key: string): string => {
      const { median, max } = summarize(series[key] ?? []);
      return `${key} ${median.toFixed(2)}/${max.toFixed(2)}`;
    };
    // The measurement itself, in the CI log of every run.
    console.log(`suite-fansly-site §3.1, ms, median/max of ${TIMING_LOADS} loads (assertion limits, ×${budgetMs(1)}): MAIN ${stat('mainBundleMs')} (median ≤ ${budgetMs(MAIN_MEDIAN_MS)}; install ${stat('mainInstallMs')}); isolated ${stat('bundleMs')} (median ≤ ${budgetMs(BOOTSTRAP_MEDIAN_MS)}; of it ${stat('evalMs')}, ${stat('composeMs')}); any start ≤ ${budgetMs(START_MAX_MS)}`);
    const main = summarize(series['mainBundleMs'] ?? []);
    expect(main.n).toBe(TIMING_LOADS);
    expect(main.median).toBeLessThanOrEqual(budgetMs(MAIN_MEDIAN_MS));
    expect(main.max).toBeLessThanOrEqual(budgetMs(START_MAX_MS));
    const bundle = summarize(series['bundleMs'] ?? []);
    expect(bundle.n).toBe(TIMING_LOADS);
    expect(bundle.median).toBeLessThanOrEqual(budgetMs(BOOTSTRAP_MEDIAN_MS));
    expect(bundle.max).toBeLessThanOrEqual(budgetMs(START_MAX_MS));
  });
});
