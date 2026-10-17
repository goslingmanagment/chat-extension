// P16a: the P3d scenario, now an acceptance gate, with both neighbours. Not part
// of `pnpm e2e`: `pnpm perf` runs it beside the ChatSpace probe, and so does CI
// every night and on demand (.github/workflows/perf.yml).
// Fresh Firefox per subject, the same stand and clock as P3d, loopback only.
// Reports, raw about:memory and Firefox profiles: .cache/e2e/perf-fansly/gate/.
import { mkdirSync, writeFileSync } from 'node:fs';

import type { FanslyHealth, FanslyState } from '@cg/contracts/bridge-messages-fansly';
import type { FanslySnapshot } from '@cg/contracts/fansly';
import type { InsertReceipt } from '@cg/contracts/host';
import { browser, expect } from '@wdio/globals';

import { messageCreatedFrame, type WireMessage } from '../../fixture-fansly/src/wire';
import { budgetMs } from '../../src/e2e-timing';
import { FANSLY_PERF_LIMITS, FANSLY_PERF_NEIGHBORS, P3D, backgroundMB, ceiling, contentProfileMB, scenarioChecks, type PerfCheck } from '../../src/perf/fansly-gate';
import { fakeHub } from '../support/fake-hub';
import { openWithNeighbor, setFanslyNeighbor, waitForNeighborComposer } from '../support/fansly-neighbor';
import { callFansly, fakeFansly, fanslyIds, fanslyStandOrigin, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../support/fansly-stand';
import { installFanslyTapHarness, tap, waitForFanslyTap, waitForTap } from '../support/fansly-tap';
import { focusTab } from '../support/focus';
import { chatPath, openStand, STAND_IDS, standOrigin, standServer, waitForChatReady } from '../support/stand';
import { addonHost, dumpMemoryReport, readMemory, type MemoryReading } from './fansly/memory';
import { percentiles } from './fansly/input-latency';
import { startProfiler, stopProfiler, summarizeProfileFile } from './fansly/profiler';
import { DEFAULT_SCENARIO, FANSLY_PERF_EVIDENCE_DIR, runScenario, type NeighborSetting, type PerfSubject, type ScenarioReport } from './fansly/scenario';
import { newSubject } from './fansly/subject-new';
import { noneSubject } from './fansly/subject-none';

const ROOT = `${FANSLY_PERF_EVIDENCE_DIR}gate/`;
const CHATS = 325;
const TABS = 10;
const LARGE_ANSWERS = 4;
const ANSWER_BYTES = 115 * 1024;

function save(dir: string, name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
}
function assertChecks(dir: string, name: string, checks: PerfCheck[]): void {
  save(dir, name, { timingSlack: budgetMs(1), limits: FANSLY_PERF_LIMITS, checks });
  console.log(`Fansly perf ${name}, slack ${budgetMs(1)}x: ${JSON.stringify(checks)}`);
  expect(checks.filter((check) => !check.pass)).toEqual([]);
}

async function fresh(): Promise<void> {
  // Do not retain extension storage, compiled realms or a neighbour from a previous subject.
  await browser.reloadSession();
  await standServer.reset();
  await fakeFansly().command({ op: 'reset' });
  await fakeHub().command({ op: 'reset' });
  await setFanslyNeighbor(null);
}

/** Real groups exist on the server before any tab boots; not just 325 unknown ids. */
async function seedChats(): Promise<string[]> {
  const groups: string[] = [];
  for (let n = 0; n < CHATS; n += 1) {
    const created = await fakeFansly().command({ op: 'conversation', fanId: `9700000000${String(n).padStart(8, '0')}` });
    if (created.groupId === undefined) throw new Error(`conversation ${n} was not created`);
    groups.push(created.groupId);
  }
  return groups;
}

function frames(groups: readonly string[], creator: string, count = groups.length): string[] {
  return Array.from({ length: count }, (_, n) => {
    const message: WireMessage = { id: `9800000000${String(n).padStart(8, '0')}`, groupId: groups[n % groups.length] as string, senderId: creator, type: 2, dataVersion: 1,
      content: `synthetic perf ${n}`, createdAt: Math.floor(Date.now() / 1000), correlationId: null, inReplyTo: null, inReplyToRoot: null,
      attachments: [], embeds: [], interactions: [], likes: [], totalTipAmount: 0 };
    return messageCreatedFrame(message);
  });
}

interface MixedReport { readonly fansly: MemoryReading; readonly chatspace: MemoryReading; readonly tabs: number; readonly chats: number; readonly sockets: number }

/** One profile: TEN Fansly tabs AND ChatSpace; process memory is counted once,
 * not multiplied by the number of same-site tabs sharing that process. */
async function mixed(subject: PerfSubject, neighbor: NeighborSetting, groups: readonly string[], dir: string): Promise<MixedReport> {
  await subject.prepare();
  await setFanslyNeighbor(neighbor === 'off' ? null : { mode: neighbor });
  const all: string[] = [];
  for (let n = 0; n < TABS; n += 1) {
    if (n > 0) await browser.switchToWindow((await browser.createWindow('tab')).handle);
    await browser.url(fanslyStandUrl('/messages'));
    await waitForFanslyStandReady();
    const first = (await fanslyIds()).groups[0] as string;
    await callFansly('open', first);
    await browser.waitUntil(async () => (await callFansly('composers')).some((field) => field.place === 'main' && field.groupId === first), { timeout: 15_000 });
    if (neighbor !== 'off') await waitForNeighborComposer();
    await subject.ready(first);
    all.push(await browser.getWindowHandle());
  }
  if ('chatSpace' in subject && typeof subject.chatSpace === 'function') await (subject as ReturnType<typeof newSubject>).chatSpace();
  else {
    await browser.switchToWindow((await browser.createWindow('tab')).handle);
    await openStand(chatPath(STAND_IDS.accounts.a, STAND_IDS.fans.a1));
    await waitForChatReady(STAND_IDS.accounts.a, STAND_IDS.fans.a1);
  }
  const host = subject.addonId === null ? null : await addonHost(subject.addonId);
  // Every tab's MAIN sees these 325 chats; sockets and frame counters prove the load reached all tabs.
  const load = frames(groups, (await fakeFansly().status()).creatorId);
  for (let from = 0; from < load.length; from += 25) await fakeFansly().command({ op: 'frames', frames: load.slice(from, from + 25) });
  const sockets = (await fakeFansly().status()).sockets.filter((socket) => socket.caller === 'page' && socket.verified).length;
  expect(sockets).toBe(TABS);
  for (const tab of all) {
    await browser.switchToWindow(tab);
    await browser.waitUntil(async () => ((await callFansly('socket'))?.frames ?? 0) >= load.length, { timeout: 30_000, timeoutMsg: 'the mixed tab did not receive the 325-chat load' });
  }
  await focusTab();
  const fansly = await readMemory(new URL(fanslyStandOrigin()).host, host, 'mixed-ten-tabs', 0);
  const chatspace = await readMemory(new URL(standOrigin()).host, host, 'mixed-chatspace', 0);
  await dumpMemoryReport(`${dir}mixed-memory.json.gz`);
  await startProfiler();
  await browser.pause(10_000);
  const file = `${dir}mixed.json.gz`;
  await stopProfiler(file);
  save(dir, 'mixed-profile', summarizeProfileFile(file, { tab: fansly.tab?.pid ?? null, extension: fansly.extension?.pid ?? null }, host, 10_000));
  const report = { fansly, chatspace, tabs: all.length, chats: groups.length, sockets };
  save(dir, 'mixed', report);
  return report;
}

for (const neighbor of FANSLY_PERF_NEIGHBORS) {
  describe(`R20 P16a Fansly perf — FBuddy ${neighbor}`, function () {
    this.timeout(3_000_000);
    let base: ScenarioReport;
    let hubMark = 0;
    let apiMark = 0;
    let egressMark = 0;
    const dir = `${ROOT}${neighbor}/`;
    before(() => { mkdirSync(dir, { recursive: true }); });
    beforeEach(async () => {
      hubMark = await fakeHub().mark();
      apiMark = await fakeFansly().mark();
      egressMark = (await standServer.egress()).next;
    });
    afterEach(async () => {
      expect(await fakeHub().violations(hubMark)).toEqual([]);
      await fakeFansly().assertOursClean(apiMark);
      expect((await standServer.egress(egressMark)).attempts).toEqual([]);
    });

    it('the P3d scenario without the extension: a fresh base with the same neighbour', async () => {
      await fresh();
      base = await runScenario(noneSubject(), { ...DEFAULT_SCENARIO, neighbor, evidenceDir: `${dir}none/` });
      save(`${dir}none/`, 'report', base);
    });

    it('[FS-PERF-1] [FS-PERF-2] [FS-PERF-3] [FS-ACC-3] [EX-011] the wired extension: 10 min, typing and CPU against P3d, 3 × (100 switches + 20 overlays)', async () => {
      await fresh();
      const evidenceDir = `${dir}new/`;
      const current = await runScenario(newSubject(neighbor, evidenceDir), { ...DEFAULT_SCENARIO, neighbor, evidenceDir });
      save(evidenceDir, 'report', { ...current, historical: P3D[neighbor] });
      if (base === undefined) throw new Error('the fresh base did not complete; cannot claim a perf comparison');
      assertChecks(dir, 'budgets', scenarioChecks(base, current));
    });

    it('[FS-PERF-4] [FS-ACC-3] 10 Fansly tabs with ChatSpace, 325 chats: the profile and shared background stay within budget', async () => {
      await fresh();
      const baseGroups = await seedChats();
      mkdirSync(`${dir}mixed-none/`, { recursive: true });
      const alone = await mixed(noneSubject(), neighbor, baseGroups, `${dir}mixed-none/`);
      await fresh();
      const groups = await seedChats();
      mkdirSync(`${dir}mixed-new/`, { recursive: true });
      const ours = await mixed(newSubject(neighbor, `${dir}mixed-new/`), neighbor, groups, `${dir}mixed-new/`);
      // Same-origin tabs share a Firefox process; the single-tab gate above
      // enforces +15 individually, here the whole 10-tab allocation is bounded.
      assertChecks(dir, 'mixed-budgets', [
        ceiling('ten live Fansly tabs', ours.tabs === 10 && ours.sockets === 10 ? 0 : NaN, 0),
        ceiling('300+ chats', ours.chats >= 300 ? 0 : NaN, 0),
        ceiling('ten Fansly tabs: overhead MB', contentProfileMB([ours.fansly]) - contentProfileMB([alone.fansly]), TABS * FANSLY_PERF_LIMITS.tabMB),
        ceiling('whole content profile: overhead MB (10 Fansly + ChatSpace)', contentProfileMB([ours.fansly, ours.chatspace]) - contentProfileMB([alone.fansly, alone.chatspace]), (TABS + 1) * FANSLY_PERF_LIMITS.tabMB),
        ceiling('one shared background document MB', backgroundMB(ours.fansly), FANSLY_PERF_LIMITS.backgroundMB),
      ]);
    });

    it('[FS-PERF-1] 325 chats, four 115 KiB XHR answers before a generation snapshot, then a slow bridge consumer', async () => {
      await fresh();
      const groups = await seedChats();
      // Keep MAIN's native idle queue pending until the snapshot actually
      // drains it. Merely awaiting HTTP then making another WebDriver call
      // would usually measure an empty queue instead of the expensive case.
      const idleHold = await browser.scriptAddPreloadScript({ functionDeclaration: `() => {
        const native = window.requestIdleCallback.bind(window);
        let held = false;
        const waiting = [];
        window.__cgPerfIdle = {
          hold() { held = true; },
          resume() { held = false; for (const [callback, options] of waiting.splice(0)) native(callback, options); }
        };
        window.requestIdleCallback = (callback, options) => {
          if (!held) return native(callback, options);
          waiting.push([callback, options]);
          return -waiting.length;
        };
      }` });
      const harness = await installFanslyTapHarness({ main: 'start' });
      const evidenceDir = `${dir}bridge/`;
      mkdirSync(evidenceDir, { recursive: true });
      try {
        await openWithNeighbor('/messages', { mode: neighbor });
        await waitForFanslyTap();
        const ids = await fanslyIds();
        const group = groups[0] as string;
        await fakeFansly().command({ op: 'message', groupId: group, text: 'synthetic history', from: 'creator', type: 2, silent: true });
        await callFansly('open', group);
        await waitForFanslyStandIdle();
        await tap('focus', group, 1);
        const health = (): Promise<FanslyHealth> => tap('health');
        const start = await health();
        const load = frames(groups, ids.creator);
        for (let from = 0; from < load.length; from += 25) {
          await fakeFansly().command({ op: 'frames', frames: load.slice(from, from + 25) });
          await waitForTap(health, (h) => h.frames.seen >= start.frames.seen + Math.min(from + 25, load.length) && h.stream.unacked === 0, 'the normal consumer drained the 325-chat load');
        }
        await waitForFanslyStandIdle(30_000);
        await fakeFansly().command({ op: 'api', rules: [{ route: 'message.history', caller: 'page', times: LARGE_ANSWERS, paddingChars: ANSWER_BYTES, outcome: { kind: 'delay', ms: 0 } }] });
        const before = await health();
        await browser.execute(() => (window as unknown as { __cgPerfIdle: { hold(): void } }).__cgPerfIdle.hold());
        const { token } = await fakeFansly().status();
        const bytes = await browser.execute(async (origin: string, groupId: string, authorization: string, count: number) => {
          return Promise.all(Array.from({ length: count }, () => new Promise<number>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `${origin}/api/v1/message?groupId=${groupId}&limit=25`);
            xhr.setRequestHeader('authorization', authorization);
            xhr.setRequestHeader('ngsw-bypass', 'true');
            xhr.addEventListener('loadend', () => xhr.status === 200 ? resolve(new TextEncoder().encode(xhr.responseText).length) : reject(new Error(`history HTTP ${xhr.status}`)));
            xhr.send();
          })));
        }, fakeFansly().apiOrigin, group, token, LARGE_ANSWERS);
        expect(bytes).toHaveLength(LARGE_ANSWERS);
        expect(bytes.every((size) => size >= ANSWER_BYTES && size <= 128 * 1024)).toBe(true);
        const queued = await health();
        expect(queued.responses.deferred - before.responses.deferred).toBe(LARGE_ANSWERS);
        expect(queued.responses.parsed).toBe(before.responses.parsed);
        const snap = await tap<{ snapshot: FanslySnapshot | null; roundTripMs: number }>('snapshot', { groupId: group, feature: 'reply', window: 60, withText: true });
        expect(snap.snapshot?.identity.groupId).toBe(group);
        expect(snap.snapshot?.window.length).toBeGreaterThan(0);
        const atSnapshot = await health();
        if (atSnapshot.responses.parsed < before.responses.parsed + LARGE_ANSWERS) expect(snap.snapshot?.completeness).toBe('unknown');
        await browser.execute(() => (window as unknown as { __cgPerfIdle: { resume(): void } }).__cgPerfIdle.resume());
        const after = await waitForTap(health, (h) => h.responses.parsed >= before.responses.parsed + LARGE_ANSWERS, 'all four large answers parsed after the bounded snapshot');
        expect(after.responses.deferred - before.responses.deferred).toBe(LARGE_ANSWERS);
        expect(after.responses.parsed - before.responses.parsed).toBe(LARGE_ANSWERS);
        save(evidenceDir, 'large-answers', { bytes, before, queued, atSnapshot, after, snapshotRoundTripMs: snap.roundTripMs });
        await tap('setAcking', false);
        const blockedStart = await health();
        const burst = frames(groups, ids.creator, 3000);
        for (let from = 0; from < burst.length; from += 500) await fakeFansly().command({ op: 'frames', frames: burst.slice(from, from + 500) });
        const blocked = await waitForTap(health, (h) => h.frames.seen >= blockedStart.frames.seen + burst.length, 'the slow consumer saw every frame', 30_000);
        save(evidenceDir, 'blocked', blocked);
        expect(await tap('gaps')).toEqual([{ reason: 'overflow' }]);
        expect(blocked.stream).toMatchObject({ unacked: 8, queued: 0, gaps: 1 });
        expect(blocked.stream.heldBytes).toBeLessThanOrEqual(256 * 1024);
        await tap('setAcking', true);
        const batches = await tap<Array<{ n: number }>>('batches');
        const last = batches.at(-1)?.n ?? 0;
        await tap('ack', last);
        expect((await tap<FanslyState>('state')).lastBatch).toBe(last);
        await fakeFansly().command({ op: 'message', groupId: group, text: 'the stream resumed', from: 'creator', type: 2 });
        const resumed = await waitForTap(health, (h) => h.stream.batches > blocked.stream.batches && h.stream.unacked === 0, 'the bridge resumed');
        expect(resumed.stream.gaps).toBe(1);
        assertChecks(evidenceDir, 'budgets', [
          ceiling('frames exercised', resumed.perf.frameParseMs.count > 3000 ? 0 : NaN, 0),
          ceiling('frame parse mean ms', resumed.perf.frameParseMs.sum / resumed.perf.frameParseMs.count, budgetMs(0.1)),
          ceiling('frame parse max task ms', resumed.perf.frameParseMs.max, budgetMs(2)),
          ceiling('XHR parse max task ms', after.perf.xhrParseMs.max, budgetMs(2)),
          ceiling('snapshot MAIN max task ms', after.perf.snapshotMs.count > 0 ? after.perf.snapshotMs.max : NaN, budgetMs(5)),
          ceiling('snapshot round trip ms (separate from MAIN)', snap.roundTripMs, budgetMs(100)),
        ]);
        expect(await tap('stats')).toMatchObject({ rejected: {}, invalidEvents: 0, invalidAnswers: 0 });
      } finally {
        await harness.remove();
        await browser.scriptRemovePreloadScript({ script: idleHold.script });
      }
    });

    it('[FS-PERF-1] insert p95 stays within 100 ms with the neighbour off/on', async () => {
      await fresh();
      const harness = await installFanslyTapHarness({ main: 'start', consumer: 'port' });
      try {
        await openWithNeighbor('/messages', { mode: neighbor });
        await waitForFanslyTap();
        const group = (await fanslyIds()).groups[0] as string;
        await callFansly('open', group);
        await waitForFanslyStandIdle();
        if (neighbor !== 'off') await waitForNeighborComposer();
        const values: number[] = [];
        for (let n = 0; n < 20; n += 1) {
          const text = `synthetic insert ${n}`;
          const receipt = await tap<InsertReceipt>('insert', { text, confirm: true });
          expect(receipt.state).toBe('applied');
          if (receipt.state !== 'applied') throw new Error(`insert ${n} was ${receipt.state}`);
          values.push(receipt.ms);
          expect((await callFansly('composers')).find((field) => field.place === 'main')?.model).toBe(text);
        }
        save(dir, 'insert', values);
        assertChecks(dir, 'insert-budget', [ceiling('insert p95 ms', percentiles(values).p95, budgetMs(100))]);
        expect((await fakeFansly().calls('page', apiMark)).filter((call) => call.route === 'message.send')).toEqual([]);
      } finally { await harness.remove(); }
    });
  });
}
