// fansly-video (--live only): a vault video plays on fansly.com, and VHS's probe of each track carries our Range
// (2026-11-27, host-fansly main/vhs-requests.ts). As a chatter's Firefox has it, Fansly's service worker on:
//
//   CG_SEE_LIVE_SW=1 CG_SEE_LIVE_PATH=/creator/vault pnpm see fansly-video --live
//
// 1. The HTTP cache cleared; with CG_SEE_LIVE_SW=1 the page under Fansly's worker (a profile that had it off only
//    registers it: the page is loaded once more then), or the run fails.
// 2. Our hook on the page's VHS (`videojs.Vhs.xhr._requestCallbackSet`, found by its fault site `vhsRequests`), then
//    the scenario's own after it: each probe VHS makes (the one request with a `beforeSend` and no `responseType`)
//    with the Range it goes with, its `ngsw-bypass` and the status it is answered with.
// 3. The first album, its first video tile (the first tiles are photos), Fansly's viewer, a click on the player's play
//    button; the DASH (blob) player's `currentTime` must grow by 1 s within 40 s.
// Passes only when probes were seen, each with exactly `bytes=0-65535` and answered 206, and the video played.
// `CG_SEE_VIDEO_HOOK=off` takes our hook off first (`offRequest`): the red check, its probes go whole, whatever the time.
// `video.json`: the worker, the start in ms, each probe, the player's manifest and tracks the tab itself asked for, the
// player's time line.
// Only the vault and its viewer: a chat is never opened (`--chat` is refused), nothing is sent, liked or uploaded.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser } from '@wdio/globals';

import { inChrome } from '../../support/background';
import { scenario } from '../kit';
import { LIVE } from '../live';

const LAUNCHER = 'div[data-host="overlay"][data-layer="launcher"]';
const PROBE_RANGE = 'bytes=0-65535';
const START_LIMIT_MS = 40_000;
const WITH_WORKER = process.env['CG_SEE_LIVE_SW'] === '1';
const HOOK_OFF = process.env['CG_SEE_VIDEO_HOOK'] === 'off';

/** A probe of VHS as the scenario's hook saw it, after ours. */
interface Probe {
  readonly at: number;
  readonly track: string;
  readonly range: string | null;
  readonly bypass: boolean;
  status: number | null;
}
type Hook = (options: unknown) => unknown;
interface PageVhs {
  readonly videojs?: { readonly Vhs?: { readonly xhr?: { _requestCallbackSet?: Set<Hook>; onRequest(hook: Hook): void; offRequest(hook: Hook): void } } };
  __cgSeeProbes?: Probe[];
}
interface Player {
  readonly time: number;
  readonly ready: number;
  readonly source: string;
  readonly paused: boolean;
  readonly height: number;
}

/** The viewer's video: the player of the open window, else the widest video with a source. */
const player = (): Promise<Player | null> =>
  browser.execute(() => {
    const video =
      document.querySelector<HTMLVideoElement>('.active-modal app-videojs-player video') ??
      [...document.querySelectorAll('video')].filter((each) => each.currentSrc !== '').sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    return video === undefined ? null : { time: video.currentTime, ready: video.readyState, source: video.currentSrc.slice(0, 5), paused: video.paused, height: video.videoHeight };
  });

/** The worker that controls the page, once it is ready (15 s at most); null — none. */
const worker = async (): Promise<string | null> =>
  await browser.execute(async () => {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (container === undefined) return null;
    if (container.controller === null) await Promise.race([container.ready, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    return container.controller?.scriptURL ?? null;
  });

scenario(
  'fansly-video',
  async (s) => {
    if (!LIVE) throw new Error('fansly-video is --live only, the stand has no Fansly player: CG_SEE_LIVE_SW=1 CG_SEE_LIVE_PATH=/creator/vault pnpm see fansly-video --live');
    const facts: Record<string, unknown> = { serviceWorkers: WITH_WORKER ? 'on' : 'off', ourHook: HOOK_OFF ? 'taken off (CG_SEE_VIDEO_HOOK=off)' : 'on' };
    let played = false;
    const probes: Probe[] = [];
    try {
      // Cold: nothing of an earlier run from the HTTP cache.
      await inChrome((driver) => driver.executeScript('Services.cache2.clear(); return true;', []));
      await $(LAUNCHER).waitForExist({ timeout: 60_000, timeoutMsg: 'no corner card on the vault page: not our tab' });
      if (WITH_WORKER) {
        let controller = await worker();
        if (controller === null) {
          // Registered just now: a new document of the same address is the worker's (a reload may pass it by).
          await browser.url(await browser.getUrl());
          await $(LAUNCHER).waitForExist({ timeout: 60_000, timeoutMsg: 'no corner card on the vault page after its second load' });
          controller = await worker();
        }
        facts['worker'] = controller;
        if (controller === null) throw new Error('CG_SEE_LIVE_SW=1, and no service worker controls the page (video.json)');
      }

      // Our hook first in VHS's chain, then the scenario's: it sees each probe as ours left it.
      await browser.waitUntil(
        () => browser.execute(() => [...((window as unknown as PageVhs).videojs?.Vhs?.xhr?._requestCallbackSet ?? [])].some((hook) => String(hook).includes('vhsRequests'))),
        { timeout: 20_000, interval: 250, timeoutMsg: 'our hook is not on the page’s VHS (videojs.Vhs.xhr._requestCallbackSet): the fix does not stand' },
      );
      facts['hooks'] = await browser.execute((off: boolean) => {
        const page = window as unknown as PageVhs;
        const xhr = page.videojs?.Vhs?.xhr;
        if (xhr === undefined) return { before: 0, after: 0 };
        const before = xhr._requestCallbackSet?.size ?? 0;
        const ours = [...(xhr._requestCallbackSet ?? [])].find((hook) => String(hook).includes('vhsRequests'));
        if (off && ours !== undefined) xhr.offRequest(ours);
        const seen: Probe[] = [];
        page.__cgSeeProbes = seen;
        xhr.onRequest((options) => {
          try {
            const o = options as { uri?: unknown; url?: unknown; beforeSend?: unknown; responseType?: unknown; headers?: Record<string, unknown> };
            const address = String(o.uri || o.url || '');
            const path = address.split(/[?#]/)[0] ?? '';
            const type = o.responseType;
            if (typeof o.beforeSend !== 'function' || (type !== undefined && type !== '' && type !== 'text') || !/^(?:https?:)?\/\/cdn\d*\.fansly\.com\/.+\.m(?:p4|4[sav])$/i.test(path)) return options;
            const name = Object.keys(o.headers ?? {}).find((key) => key.toLowerCase() === 'range');
            const probe: Probe = { at: Date.now(), track: path.slice(path.lastIndexOf('/') + 1), range: name === undefined ? null : String(o.headers?.[name]), bypass: /[?&]ngsw-bypass=/.test(address), status: null };
            seen.push(probe);
            const send = o.beforeSend as (request: XMLHttpRequest) => unknown;
            // The answer's status as the page gets it: VHS aborts the probe once it knows the container, and never calls back.
            return {
              ...o,
              beforeSend(this: unknown, request: XMLHttpRequest) {
                request.addEventListener('readystatechange', () => {
                  if (probe.status === null && request.readyState >= 2) probe.status = request.status;
                });
                return send.call(this, request);
              },
            };
          } catch {
            return options;
          }
        });
        return { before, after: xhr._requestCallbackSet?.size ?? 0 };
      }, HOOK_OFF);
      const tabFrom = s.web.headers.length;

      // The first album (unless the landing is an album already), its first video tile.
      await $('.vault-album, .fansly-media-tile').waitForExist({ timeout: 30_000, timeoutMsg: 'neither an album nor its tiles on the vault page' });
      const album = await $('.vault-album');
      if (await album.isExisting()) {
        await album.waitForClickable({ timeout: 15_000 });
        await album.click();
      }
      await $('.fansly-media-tile').waitForExist({ timeout: 30_000, timeoutMsg: 'no tile of an album on the page' });
      let tile: string | null = null;
      for (let i = 0; i < 15 && tile === null; i += 1) {
        await s.wait(1000);
        tile = await browser.execute(() => {
          const tiles = [...document.querySelectorAll<HTMLElement>('.fansly-media-tile')];
          const video = tiles.find((each) => each.querySelector('.fansly-media-tile-badges i.fa-play') !== null || /\.(?:mp4|mov|m4v|webm)\b/i.test(each.textContent ?? ''));
          if (video === undefined) {
            tiles[tiles.length - 1]?.scrollIntoView({ block: 'end' });
            return null;
          }
          video.scrollIntoView({ block: 'center' });
          video.setAttribute('data-cg-see-video', '');
          return /[\w.-]+\.(?:mp4|mov|m4v|webm)\b/i.exec(video.textContent ?? '')?.[0] ?? 'a video tile';
        });
      }
      if (tile === null) throw new Error('no video tile in the first album');
      facts['video'] = tile;
      await s.wait(800);
      await $('[data-cg-see-video]').click();
      await browser.waitUntil(() => browser.execute(() => document.body.classList.contains('modal-opened')), { timeout: 15_000, interval: 200, timeoutMsg: 'Fansly’s viewer did not open' });
      await $('.active-modal app-videojs-player video').waitForExist({ timeout: 15_000, timeoutMsg: 'no player in Fansly’s viewer' });
      await s.wait(1000);
      await s.shot('viewer');

      // A person's click on the player's play button (a video that plays already is left as it is).
      const before = await player();
      if (before === null || before.paused) {
        const big = await $('.active-modal app-videojs-player .play-button');
        const small = await $('.active-modal app-videojs-player .play-button-small');
        if (await big.isDisplayed()) await big.click();
        else if (await small.isDisplayed()) await small.click();
        else await $('.active-modal app-videojs-player video').click();
      }
      const startedAt = Date.now();
      const from = before?.time ?? 0;
      const timeline: Array<{ readonly ms: number } & Player> = [];
      let state: Player | null = null;
      while (Date.now() - startedAt < START_LIMIT_MS) {
        state = await player();
        const last = timeline[timeline.length - 1];
        if (state !== null && (last === undefined || last.ready !== state.ready || last.paused !== state.paused || last.source !== state.source || Math.floor(last.time) !== Math.floor(state.time))) {
          timeline.push({ ms: Date.now() - startedAt, ...state });
        }
        if (state !== null && state.source === 'blob:' && state.time - from >= 1) {
          played = true;
          break;
        }
        await s.wait(250);
      }
      facts['played'] = played;
      facts['startMs'] = played ? Date.now() - startedAt : null;
      facts['currentTime'] = { atClick: from, atEnd: state?.time ?? null };
      facts['source'] = state?.source ?? null;
      facts['height'] = state?.height ?? null;
      await s.shot('playing');

      probes.push(...(await browser.execute(() => (window as unknown as PageVhs).__cgSeeProbes ?? [])));
      facts['probes'] = probes.map((probe) => ({ ...probe, at: probe.at - startedAt }));
      facts['probesWithRange'] = probes.filter((probe) => probe.range === PROBE_RANGE).length;
      facts['probesWithoutRange'] = probes.filter((probe) => probe.range === null).length;
      // The player's manifest and tracks the tab itself asked for (BiDi sees no request of the worker's): the bypass at work.
      const tab = s.web.headers.slice(tabFrom).filter((record) => record.phase === 'request' && /^https:\/\/cdn\d*\.fansly\.com\/new\/.+\.(?:mpd|mp4|m4[sav])$/i.test(record.url));
      facts['tabDashRequests'] = tab.length;
      facts['timeline'] = timeline;
      console.log(
        `cg-see video: ${played ? `plays after ${String(facts['startMs'])} ms` : `NOT playing after ${START_LIMIT_MS / 1000} s`}; worker ${WITH_WORKER ? 'on' : 'off'}; our hook ${HOOK_OFF ? 'off' : 'on'}; probes ${probes.length}: with our Range ${String(facts['probesWithRange'])}, without ${String(facts['probesWithoutRange'])}, statuses ${probes.map((probe) => String(probe.status)).join(' ') || '-'}; the player's requests by the tab itself ${tab.length}`,
      );

      // Nothing keeps loading after the run: the players stop, the viewer closes.
      await browser.execute(() => {
        for (const video of document.querySelectorAll('video')) video.pause();
      });
      await browser.keys(s.Key.Escape);
    } finally {
      writeFileSync(join(s.out, 'video.json'), `${JSON.stringify(facts, null, 2)}\n`);
    }
    if (probes.length === 0) throw new Error('VHS made no probe the scenario saw: nothing to check (video.json)');
    const whole = probes.filter((probe) => probe.range !== PROBE_RANGE);
    if (whole.length > 0) throw new Error(`${whole.length} of ${probes.length} probes went without our Range (${whole.map((probe) => `${probe.track}: ${probe.range ?? 'none'}`).join(', ')}): the hook does not stand (video.json)`);
    const unanswered = probes.filter((probe) => probe.status !== 206);
    if (unanswered.length > 0) throw new Error(`probes answered ${unanswered.map((probe) => String(probe.status)).join(', ')}, not 206 (video.json)`);
    if (!played) throw new Error(`the video did not play 1 s within ${START_LIMIT_MS / 1000} s of the click (video.json)`);
  },
  {
    sites: ['fansly'],
    timeout: 240_000,
    // Before the shift opens anything: the vault is the landing, never a chat.
    before: () => {
      if (!LIVE) return Promise.resolve();
      if ((process.env['CG_SEE_LIVE_GROUP'] ?? '') !== '') return Promise.reject(new Error('fansly-video stays on the vault: no --chat'));
      if (!(process.env['CG_SEE_LIVE_PATH'] ?? '').startsWith('/creator/vault')) return Promise.reject(new Error('fansly-video needs CG_SEE_LIVE_PATH=/creator/vault (or an album of it)'));
      return Promise.resolve();
    },
  },
);
