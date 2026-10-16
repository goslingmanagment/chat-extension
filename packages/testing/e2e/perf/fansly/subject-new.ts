// The wired extension as a P3d PerfSubject. All input goes to the synthetic stand.
import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { idleChecks } from '../../../src/perf/fansly-gate';
import { PANEL } from '../../support/chat';
import { TEST_GECKO_ID } from '../../support/constants';
import { fakeHub } from '../../support/fake-hub';
import { startFanslyShift, openChatSpaceBeside, type FanslyShift } from '../../support/fansly-shift';
import { fanslyIds, fanslyStandOrigin } from '../../support/fansly-stand';
import { oursExists } from '../../support/ours';
import { dockIs } from '../../support/shift';
import { standWorld } from '../../support/world';
import { addonHost, readMemory } from './memory';
import { startProfiler, stopProfiler, summarizeProfileFile, type ProfileSummary } from './profiler';
import type { NeighborSetting, PerfSubject } from './scenario';

export function newSubject(neighbor: NeighborSetting, evidenceDir: string): PerfSubject & { chatSpace(): Promise<string> } {
  let shift: FanslyShift;
  let offRoute: ProfileSummary | null = null;
  let fans: Readonly<Record<string, string>> = {};
  let lazyChecked = false;
  const optionalChunks = /\/lazy\/fansly\/(?:dock-analysis|ai-analysis|ai-coach|boards|spenders|coach|newcomers|vault|fan-panel|registration|cheatsheet|result-expanded)\.js/;
  return {
    name: 'new',
    addonId: TEST_GECKO_ID,
    async prepare() {
      await standWorld(fakeHub());
      // Inbox click → dock's first paint is a conservative upper bound on
      // routeToDockMs (includes the host's navigation). No WebDriver round-trip.
      await browser.scriptAddPreloadScript({ functionDeclaration: `() => {
        const samples = window.__cgPerfRouteMs = [];
        let pending = null;
        addEventListener('click', (event) => {
          const link = event.target instanceof Element ? event.target.closest('.messages-list-wrapper a') : null;
          const group = link?.getAttribute('href')?.split('/').pop();
          const fan = window.__fanslyStand?.ids.fans[group];
          if (event.isTrusted && fan) pending = { fan, at: performance.now() };
        }, true);
        const observer = new MutationObserver(() => {
          if (!pending) return;
          const raw = document.documentElement.getAttribute('data-cg-spike');
          if (!raw) return;
          const dock = JSON.parse(raw).dock;
          if (dock?.status !== 'ready' || !dock.target?.endsWith(':' + pending.fan)) return;
          const at = pending.at;
          pending = null;
          requestAnimationFrame(() => samples.push(performance.now() - at));
        });
        addEventListener('DOMContentLoaded', () => observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cg-spike'] }), { once: true });
      }` });
      shift = await startFanslyShift(fakeHub(), { path: '/home', neighbor: { mode: neighbor } });
      expect(await browser.$('[data-host="dock"]').isExisting()).toBe(false);
      const resources = await browser.execute(() => performance.getEntriesByType('resource').map((entry) => entry.name));
      expect(resources.filter((name) => /\/lazy\/fansly\/(?:dock|tab-app|boards|spenders|coach|newcomers|vault)\.js/.test(name))).toEqual([]);
      expect(resources.filter((name) => optionalChunks.test(name))).toEqual([]);
      const shot = await readMemory(new URL(fanslyStandOrigin()).host, await addonHost(TEST_GECKO_ID), 'off-route', 0);
      await startProfiler();
      await browser.pause(60_000);
      const file = `${evidenceDir}off-route.json.gz`;
      await stopProfiler(file);
      offRoute = summarizeProfileFile(file, { tab: shot.tab?.pid ?? null, extension: shot.extension?.pid ?? null }, await addonHost(TEST_GECKO_ID), 60_000);
      expect(idleChecks(offRoute.tab, 'off route').filter((check) => !check.pass)).toEqual([]);
    },
    async ready(groupId) {
      if (fans[groupId] === undefined) fans = (await fanslyIds()).fans;
      await dockIs((dock) => dock.status === 'ready' && dock.target?.endsWith(`:${fans[groupId] ?? '?'}`) === true && dock.actions['reply'] === true, `the wired Fansly dock of ${groupId}`);
      if (!lazyChecked) {
        const resources = await browser.execute(() => performance.getEntriesByType('resource').map((entry) => entry.name));
        expect(resources.filter((name) => optionalChunks.test(name))).toEqual([]);
        lazyChecked = true;
      }
    },
    async overlay(cycle) {
      await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
      const [keys, where, selector] = [
        [[...PANEL, 'm'], 'modal', '.cg-sp'],
        [[']'], 'panel', '.cg-fp'],
        [['?'], 'modal', '.cg-cs'],
      ][cycle % 3] as [string[], 'modal' | 'panel', string];
      await browser.keys(keys);
      await browser.waitUntil(() => oursExists(where, selector), { timeout: 20_000, timeoutMsg: `${selector} did not open` });
      for (let press = 0; press < 5 && (await dockIs(() => true, 'the dock')).overlays.length > 0; press += 1) await browser.keys(Key.Escape);
      expect((await dockIs(() => true, 'the dock after the overlay')).overlays).toEqual([]);
    },
    async describe() {
      return { offRoute, routeToDockMs: await browser.execute(() => (window as unknown as { __cgPerfRouteMs: number[] }).__cgPerfRouteMs) };
    },
    async chatSpace() {
      const tab = await openChatSpaceBeside(shift);
      await dockIs((dock) => dock.status === 'ready' && dock.actions['reply'] === true, 'the wired ChatSpace dock in the mixed profile');
      return tab;
    },
  };
}
