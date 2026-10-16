// Manual only. The ordinary suite/shards enumerate e2e/specs/, never this directory.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';

import { createWorld } from '../../fixture-fansly/src/data';
import { buildLongRunReport, CHAT_COUNT, longRunMinutes, longRunSummary, type Action, type IdleSample, type MemorySample, type SendEvidence } from '../../src/long-run/report';
import { WORLD } from '../../src/scenarios/hub';
import { mb, processCpu, readMemory, type MemoryReading } from '../perf/fansly/memory';
import { startProfiler, stopProfiler, summarizeProfileFile } from '../perf/fansly/profiler';
import { suspendBackground, waitForBackgroundState } from '../support/background';
import { E2E_ADDON_UUID } from '../support/constants';
import { fakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor } from '../support/fansly-neighbor';
import { openChatSpaceBeside, startFanslyShift, type FanslyShift } from '../support/fansly-shift';
import { callFansly, fakeFansly, fanslyStandOrigin, openFanslyStand, waitForFanslyStandReady } from '../support/fansly-stand';
import { pressOurs } from '../support/ours';
import { inBrowser, startSecondBrowser } from '../support/second';
import { dockIs } from '../support/shift';
import { callStand, chatPath, openStand, STAND_IDS, standOrigin, standServer, waitForChatReady } from '../support/stand';
import { standWorld } from '../support/world';
import { LongRunActions, type Chat } from './actions';
import { LongRunMonitor } from './monitor';

const minutes = longRunMinutes(process.env['CG_LONG_RUN_MINUTES']);
const durationMs = minutes * 60_000;
const dir = fileURLToPath(new URL('../../../../.cache/e2e/long-run', import.meta.url));
const page = WORLD.pages.fansly;
const first = WORLD.fansly.chats.a;
const neighbour = { mode: 'after' as const };

describe('R20 P16b — manual long run on the PC, Fansly and ChatSpace beside it', function () {
  this.timeout(durationMs + 30 * 60_000);

  it('keeps 320+ chats live, survives lifecycle changes and accounts for every operation and send', async () => {
    mkdirSync(dir, { recursive: true });
    const hub = fakeHub();
    const errors: string[] = [];
    const warnings: string[] = [];
    const memory: MemorySample[] = [];
    const idle: IdleSample[] = [];
    const sends: SendEvidence[] = [];
    const actions: Partial<Record<Action, number>> = {};
    const coverage = new Set<string>();
    let expectedSends = 0;
    let stuckOps = 0;
    let leakedSlots = 0;
    let messages = 0;
    let typing = 0;
    let epoch = 0;
    let started: number | null = null;
    let finished = false;
    let baseline: WebdriverIO.Browser | null = null;
    let shift: FanslyShift | null = null;
    let chatspace = '';
    let baselineFansly = '';
    let baselineChatspace = '';
    let trafficTimer: ReturnType<typeof setInterval> | null = null;
    let pendingTraffic: Promise<void> = Promise.resolve();
    let trafficStep = 0;
    let chats: Chat[] = [];
    let work: LongRunActions;
    const monitor = new LongRunMonitor(dir, errors, warnings, sends);
    const elapsed = (): number => started === null ? 0 : performance.now() - started;
    const count = (action: Action): void => { actions[action] = (actions[action] ?? 0) + 1; monitor.record('action', { action, atMs: elapsed() }); };
    const evidence = () => ({ minutes, elapsedMs: elapsed(), finished,
      metadata: { sha: process.env['CG_LONG_RUN_SHA'] ?? null, requestedRef: process.env['CG_LONG_RUN_REF'] ?? null,
        runId: process.env['GITHUB_RUN_ID'] ?? null, image: process.env['CG_E2E_IMAGE'] ?? null, platform: process.platform,
        firefox: browser.capabilities.browserVersion, neighbour, baseline: 'simultaneous separate Firefox, no extension',
        notes: 'native CRUD via TEST API probe; notes-fill via real scheduler', greetings: 'dock Hi + TEST send probe (P10c UI not yet on this base)' },
      chatsWithEvents: coverage.size, messages, typing, actions, memory, idle, expectedSends, sends, stuckOps, leakedSlots, errors, warnings });
    const save = (): void => {
      const report = buildLongRunReport(evidence());
      for (const [name, text] of [['report.json', `${JSON.stringify(report, null, 2)}\n`], ['summary.md', longRunSummary(report)]]) {
        writeFileSync(`${dir}/${name}.tmp`, text ?? ''); renameSync(`${dir}/${name}.tmp`, `${dir}/${name}`);
      }
    };
    const inBaseline = async <T>(run: () => Promise<T>): Promise<T> => {
      if (baseline === null) throw new Error('baseline not started');
      return inBrowser(baseline, run);
    };
    const seed = async (): Promise<void> => {
      chats = createWorld().groups.map((group) => ({ group: group.id, fan: group.fan.id }));
      for (let index = chats.length; index < CHAT_COUNT; index += 1) {
        const fan = String(940_000_000_000_000_000n + BigInt(index));
        const created = await fakeFansly().command({ op: 'conversation', fanId: fan });
        if (created.groupId === undefined) throw new Error('stand failed to create a chat');
        chats.push({ group: created.groupId, fan });
      }
      for (const chat of chats.slice(0, 4)) await hub.command({ op: 'thread', pageLabel: page.pageLabel, conversationRef: chat.group, fanRef: chat.fan });
    };
    const openBaseline = async (chat: Chat = first): Promise<void> => inBaseline(async () => {
      await browser.switchToWindow(baselineFansly);
      await openWithNeighbor(`/messages/${chat.group}`, neighbour);
    });
    const sendEvent = async (chat: Chat, measured: boolean): Promise<void> => {
      const typed = await fakeFansly().command({ op: 'typing', groupId: chat.group });
      const message = await fakeFansly().command({ op: 'message', groupId: chat.group, text: 'Synthetic long-run traffic' });
      if ((typed.sent ?? 0) < 2 || (message.sent ?? 0) < 2) throw new Error('traffic did not reach both browsers');
      if (measured) { typing += 1; messages += 1; coverage.add(chat.group); }
    };
    const stopTraffic = async (): Promise<void> => { if (trafficTimer !== null) clearInterval(trafficTimer); trafficTimer = null; await pendingTraffic; };
    const startTraffic = (): void => {
      trafficTimer = setInterval(() => {
        const chat = chats[trafficStep++ % chats.length];
        if (chat === undefined) return;
        pendingTraffic = pendingTraffic.then(() => sendEvent(chat, true)).catch((error: unknown) => { errors.push(`traffic: ${String(error)}`); });
      }, 10_000);
    };
    const ready = async (): Promise<void> => {
      if (shift === null) throw new Error('shift not started');
      await shift.toFansly();
      await dockIs((dock) => dock.status === 'ready' && dock.target?.includes(page.platformAccountId) === true && dock.actions['reply'] === true, 'Fansly after lifecycle change', 20_000);
      await browser.waitUntil(async () => (await callFansly('socket'))?.state === 'connected', { timeout: 15_000 });
      await inBaseline(async () => {
        await browser.switchToWindow(baselineFansly);
        await browser.waitUntil(async () => (await callFansly('socket'))?.state === 'connected', { timeout: 15_000 });
      });
    };
    const health = async (): Promise<void> => {
      if (shift === null) throw new Error('shift not started');
      const diagnostic = await monitor.diagnostics(shift);
      if (diagnostic.ops.active !== 0 || diagnostic.sends.open !== 0 || diagnostic.sends.uncertain !== 0 || (await hub.status()).openStreams !== 0) {
        stuckOps += 1;
        throw new Error(`work did not drain: ${JSON.stringify({ ops: diagnostic.ops, sends: diagnostic.sends })}`);
      }
      if (diagnostic.hostModules?.some((module) => module.state === 'failed')) throw new Error('host background module failed');
      await monitor.drain(hub);
      if (errors.length > 0) throw new Error(`long-run observer: ${errors[0] ?? '?'}`);
    };

    async function readings(label: string) {
      // Wake deliberately, then measure the background document rather than the whole extension process.
      if (shift === null) throw new Error('shift not started');
      const awake = await shift.rpc('bootstrap.get');
      if (!awake.ok) throw new Error(`wake for memory: ${awake.error.code}`);
      const fs = await readMemory(new URL(fanslyStandOrigin()).host, E2E_ADDON_UUID, label, elapsed());
      const cs = await readMemory(new URL(standOrigin()).host, E2E_ADDON_UUID, label, elapsed(), false);
      const base = await inBaseline(async () => ({
        fs: await readMemory(new URL(fanslyStandOrigin()).host, null, label, elapsed()),
        cs: await readMemory(new URL(standOrigin()).host, null, label, elapsed(), false),
      }));
      monitor.record('raw-memory', { fs, cs, baseline: base });
      return { fs, cs, base };
    }
    const takeMemory = async (initial = false): Promise<Awaited<ReturnType<typeof readings>>> => {
      const shots = await readings(`sample-${memory.length}`);
      const overhead = (own: MemoryReading, base: MemoryReading): number | null => own.tab === null || base.tab === null ? null : mb(own.tab.explicit - base.tab.explicit);
      const background = Object.entries(shots.fs.extension?.documents ?? {}).find(([path]) => path.includes('background'));
      memory.push({ atMs: initial ? 0 : elapsed(), epoch, fanslyOverheadMB: overhead(shots.fs, shots.base.fs),
        chatspaceOverheadMB: overhead(shots.cs, shots.base.cs), backgroundMB: background === undefined ? null : mb(background[1]) });
      save();
      return shots;
    };
    const idleWindow = async (): Promise<void> => {
      const shots = await readings(`idle-${idle.length}`);
      await browser.$('.message-content-header').click();
      const before = await processCpu();
      const baseBefore = await inBaseline(() => processCpu());
      const cpuStart = performance.now();
      await browser.pause(30_000);
      const after = await processCpu();
      const baseAfter = await inBaseline(() => processCpu());
      const cpuWindowMs = performance.now() - cpuStart;
      const delta = (pid: number | undefined, from: Record<number, number>, to: Record<number, number>): number | null =>
        pid === undefined || from[pid] === undefined || to[pid] === undefined ? null : to[pid] - from[pid];
      const file = `${dir}/idle-${idle.length}.json.gz`;
      await startProfiler();
      const profileStart = performance.now();
      await browser.pause(30_000);
      const profileWindowMs = performance.now() - profileStart;
      await stopProfiler(file);
      const profile = summarizeProfileFile(file, { tab: shots.fs.tab?.pid ?? null, extension: shots.fs.extension?.pid ?? null }, E2E_ADDON_UUID, profileWindowMs);
      monitor.record('profile', profile);
      const sum = (values: Readonly<Record<string, number>> | undefined): number | null => values === undefined ? null : Object.values(values).reduce((a, b) => a + b, 0);
      idle.push({ atMs: elapsed(), cpuWindowMs, profileWindowMs,
        tabCpuMs: delta(shots.fs.tab?.pid, before, after), baselineTabCpuMs: delta(shots.base.fs.tab?.pid, baseBefore, baseAfter),
        backgroundCpuMs: delta(shots.fs.extension?.pid, before, after), baselineBackgroundCpuMs: delta(shots.base.fs.extension?.pid, baseBefore, baseAfter),
        tabTimers: sum(profile.tab?.addonTimers), backgroundTimers: sum(profile.extension?.addonTimers), backgroundWakeups: profile.extension?.markers['Awake'] ?? null });
      save();
    };
    const reload = async (): Promise<void> => {
      if (shift === null) throw new Error('shift not started');
      await shift.toFansly(); await browser.refresh(); await waitForFanslyStandReady();
      await inBaseline(async () => { await browser.switchToWindow(baselineFansly); await browser.refresh(); await waitForFanslyStandReady(); });
      await browser.switchToWindow(chatspace); await browser.refresh(); await waitForChatReady(STAND_IDS.accounts.a, STAND_IDS.fans.a1);
      await inBaseline(async () => { await browser.switchToWindow(baselineChatspace); await browser.refresh(); await waitForChatReady(STAND_IDS.accounts.a, STAND_IDS.fans.a1); });
      await ready(); epoch += 1; count('reload');
    };

    save();
    try {
      await hub.command({ op: 'reset' }); await standServer.reset(); await fakeFansly().command({ op: 'reset' });
      // Exercise the client for eight hours, not the fake hub's 120-request demo quota.
      await hub.command({ op: 'config', patch: { quotaRequestsToday: null } });
      await setFanslyNeighbor(neighbour); await standWorld(hub);
      shift = await startFanslyShift(hub, { path: `/messages/${first.group}`, neighbor: neighbour, viewport: { width: 1728, height: 936 } });
      await monitor.observeBrowser('subject');
      chatspace = await openChatSpaceBeside(shift);
      await dockIs((dock) => dock.status === 'ready', 'ChatSpace beside Fansly');
      baseline = await startSecondBrowser();
      await inBaseline(async () => {
        await monitor.observeBrowser('baseline');
        baselineFansly = await browser.getWindowHandle();
        await browser.browsingContextSetViewport({ context: baselineFansly, viewport: { width: 1728, height: 936 } });
        await openWithNeighbor(`/messages/${first.group}`, neighbour);
        baselineChatspace = (await browser.createWindow('tab')).handle;
        await browser.switchToWindow(baselineChatspace);
        await openStand(chatPath(STAND_IDS.accounts.a, STAND_IDS.fans.a1));
      });
      await monitor.mark(hub);
      work = new LongRunActions(shift, hub, dir, count, () => { leakedSlots += 1; }, () => { expectedSends += 1; });

      // Change the actual synthetic creator/session, observe the new identity, then return. No browser spoofing.
      for (const creatorId of [WORLD.fansly.oldCreator, page.platformAccountId]) {
        await shift.toFansly(); await browser.url('about:blank');
        await inBaseline(async () => { await browser.switchToWindow(baselineFansly); await browser.url('about:blank'); });
        await fakeFansly().command({ op: 'account', creatorId });
        await hub.command({ op: 'pageAccount', pageLabel: page.pageLabel, platformAccountId: creatorId });
        expect(await shift.rpc('bootstrap.get', { force: true })).toMatchObject({ ok: true });
        await openFanslyStand(`/messages/${first.group}`);
        await openBaseline();
        await dockIs((dock) => dock.status === 'ready' && dock.target?.includes(creatorId) === true && dock.actions['reply'] === true, `switched creator ${creatorId}`, 20_000);
        monitor.record('account', { creatorId, target: (await dockIs(() => true, 'switched target')).target });
      }
      count('accountSwitch');
      await seed(); await ready();
      // Warm the page's own group/profile caches in BOTH browsers before setting the zero point.
      for (const chat of chats) await sendEvent(chat, false);
      await browser.pause(5000);
      await work.admission(chats);
      await work.newcomers();
      await work.greeting();
      await work.open(first); await work.notes(first);
      await work.vault(); await openFanslyStand(`/messages/${first.group}`); await openBaseline();
      await reload();
      // Exercise suspension/recovery once before the window and repeatedly while it runs.
      expect(await suspendBackground()).toBe('stopped');
      expect(await shift.rpc('bootstrap.get')).toMatchObject({ ok: true });
      await waitForBackgroundState('running', 'background woke', 15_000); await ready(); count('backgroundWake');
      await health();

      started = performance.now();
      await takeMemory(true);
      for (const chat of chats) await sendEvent(chat, true);
      startTraffic();
      await idleWindow();
      let nextMemory = Math.min(300_000, durationMs / 5);
      let nextWork = elapsed() + 30 * 60_000;
      let nextWake = elapsed() + 15 * 60_000;
      let tick = 0;
      while (elapsed() < durationMs - 75_000) {
        for (let index = 0; index < 4; index += 1) {
          const chat = chats[(tick++ % chats.length)];
          if (chat !== undefined) { await work.open(chat); await inBaseline(() => callFansly('open', chat.group, 'router')); }
        }
        await browser.switchToWindow(chatspace);
        const fan = Math.floor(tick / 4) % 2 === 0 ? STAND_IDS.fans.a1 : STAND_IDS.fans.a2;
        await standServer.fanMessage(STAND_IDS.accounts.a, fan, 'Synthetic ChatSpace traffic beside Fansly');
        await callStand('openChat', STAND_IDS.accounts.a, fan); await waitForChatReady(STAND_IDS.accounts.a, fan);
        await dockIs((dock) => dock.status === 'ready', 'ChatSpace continues working');
        await pressOurs('dock', '.cg-strip button', /^Reply/);
        await dockIs((dock) => dock.result?.feature === 'reply' && dock.result.state === 'done', 'ChatSpace Reply', 30_000);
        await inBaseline(async () => { await browser.switchToWindow(baselineChatspace); await callStand('openChat', STAND_IDS.accounts.a, fan); await waitForChatReady(STAND_IDS.accounts.a, fan); await browser.switchToWindow(baselineFansly); });
        await shift.toFansly();
        if (elapsed() >= nextWake) {
          expect(await suspendBackground()).toBe('stopped');
          expect(await shift.rpc('bootstrap.get')).toMatchObject({ ok: true });
          await ready(); count('backgroundWake'); nextWake = elapsed() + 15 * 60_000;
        }
        if (elapsed() >= nextWork && elapsed() < durationMs - 5 * 60_000) {
          await takeMemory();
          await work.admission(chats); await work.newcomers(); await work.greeting();
          await work.open(first); await work.notes(first); await work.vault();
          await openFanslyStand(`/messages/${first.group}`); await openBaseline(); await reload();
          await takeMemory();
          nextMemory = elapsed() + 300_000;
          nextWork = elapsed() + 30 * 60_000;
        }
        await health();
        if (elapsed() >= nextMemory) { await takeMemory(); nextMemory = elapsed() + Math.min(300_000, durationMs / 5); }
        save();
        process.stdout.write(`long-run: ${(elapsed() / 60_000).toFixed(1)}/${minutes} min, ${coverage.size} chats, ${messages} messages, ${sends.length} sends\n`);
        await browser.pause(Math.min(15_000, Math.max(0, durationMs - 75_000 - elapsed())));
      }
      await work.open(first); await inBaseline(() => callFansly('open', first.group, 'router'));
      await idleWindow();
      while (elapsed() < durationMs) await browser.pause(Math.min(10_000, durationMs - elapsed()));
      await stopTraffic();
      await health(); await takeMemory();
      finished = true;
    } catch (error) {
      errors.push(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
      monitor.record('failure', errors.at(-1));
    } finally {
      await stopTraffic();
      try { await monitor.drain(hub); } catch (error) { errors.push(`final journal: ${String(error)}`); }
      if (shift !== null) {
        try { await monitor.diagnostics(shift); } catch (error) { errors.push(`final diagnostics: ${String(error)}`); }
      }
      if (baseline !== null) { try { await baseline.deleteSession(); } catch (error) { errors.push(`baseline teardown: ${String(error)}`); } }
      save();
    }
    const report = buildLongRunReport(evidence());
    process.stdout.write(longRunSummary(report));
    expect(report.status).toBe(minutes === 480 ? 'passed' : 'smoke-passed');
  });
});
