// The perf scenario on the Fansly stand (R20 P3d; P16a measures the new
// extension through the same steps): the shape of architecture.md §11 —
// open, 20 chat switches, typing, idle — with the window of FS-PERF-1 (the
// tab's memory after GC, 10 minutes after opening, against the same base with
// no extension) and the growth rounds of plan.md §4 (100 switches and 20
// overlay cycles each). One run = one subject (none, the old extension, the
// new one) × one neighbour setting, in a fresh browser; the base is the same
// scenario with no subject.
//
// What a subject brings (`PerfSubject`): its install and settings, how to
// tell it is at work on the open chat, and its overlay (a window of its own
// opened and closed). Everything else — the stand, the switches, the typing,
// the readings — is the same for every subject.

import { mkdirSync } from 'node:fs';

import { browser } from '@wdio/globals';
import { Key } from 'webdriverio';

import { E2E_EVIDENCE_DIR } from '../../../src/stand/paths';
import { callFansly, FANSLY_MAIN, fakeFansly, fanslyIds, fanslyStandOrigin, fanslyStandUrl, waitForFanslyStandIdle, waitForFanslyStandReady } from '../../support/fansly-stand';
import { setFanslyNeighbor, waitForNeighborComposer } from '../../support/fansly-neighbor';
import { installInputProbe, summarizeLatency, takeLatencySamples, typeSlowly, type LatencySummary } from './input-latency';
import { addonHost, dumpMemoryReport, processCpu, readMemory, type MemoryReading } from './memory';
import { startProfiler, stopProfiler, summarizeProfileFile, type ProfileSummary } from './profiler';
import { startTraffic } from './traffic';

export type NeighborSetting = 'off' | 'after';

export interface PerfSubject {
  /** `none`, `old-2.12.0`, `new-<version>`… */
  readonly name: string;
  /** The add-on's id; null — no add-on (the base). */
  readonly addonId: string | null;
  /** In a fresh browser, before the stand opens: install, permissions, settings. */
  prepare(): Promise<void>;
  /** The subject is at work on the chat that is open now (for the base: nothing to wait for). */
  ready(groupId: string): Promise<void>;
  /** One overlay cycle: a window of the subject's opened and closed again (`cycle` counts from 0). */
  overlay(cycle: number): Promise<void>;
  /** What the subject itself reports at the end (its state, its settings as they stand). */
  describe(): Promise<Record<string, unknown>>;
}

export interface ScenarioOptions {
  readonly neighbor: NeighborSetting;
  /** Chat switches of the §11 part. */
  readonly switches: number;
  /** The window from opening to the FS-PERF-1 reading (ms). */
  readonly windowMs: number;
  /** Readings taken during the idle part, this far apart (ms); 0 — none (the reading itself forces GC). */
  readonly idleSampleMs: number;
  /** The idle minute: CPU and calls without the sampler, then the same span under the sampler (ms each). */
  readonly idleProbeMs: number;
  /** Growth rounds after the window, each `roundSwitches` switches and `roundOverlays` overlay cycles. */
  readonly rounds: number;
  readonly roundSwitches: number;
  readonly roundOverlays: number;
  /** What is typed into the composer (letters, spaces), and the pause between key presses (ms). */
  readonly text: string;
  readonly keyGapMs: number;
  /** Where the profiles go (a directory of the machine Firefox runs on: the same one as the test process here). */
  readonly evidenceDir: string;
}

export const DEFAULT_SCENARIO: Omit<ScenarioOptions, 'neighbor' | 'evidenceDir'> = {
  switches: 20,
  windowMs: 10 * 60_000,
  idleSampleMs: 0,
  idleProbeMs: 60_000,
  rounds: 3,
  roundSwitches: 100,
  roundOverlays: 20,
  text: 'hey there, thanks for the message, how was your day today? tell me more about it and what you are up to tonight, babe ',
  keyGapMs: 70,
};

export interface CallsSummary {
  /** The fake Fansly's journal by caller → route → calls (`page`, `ours` — an extension's, `neighbor`, `foreign`). */
  readonly fansly: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Calls of an extension to the fake Fansly that break FS-NET-1 (for the old extension: a fact, not a failure). */
  readonly fanslyViolations: number;
  /** The fake hub's journal: `<kind> <method> <path>` → calls. */
  readonly hub: Readonly<Record<string, number>>;
}

export interface ScenarioReport {
  readonly subject: string;
  /** The add-on's moz-extension host in this run (its frames in the profiles); null — none. */
  readonly addonHost: string | null;
  readonly neighbor: NeighborSetting;
  readonly options: Omit<ScenarioOptions, 'evidenceDir' | 'text'> & { readonly textLength: number };
  readonly startedAt: string;
  readonly readings: Readonly<Record<string, MemoryReading>>;
  /** Readings of the idle part (`idleSampleMs`), oldest first. */
  readonly idleReadings: readonly MemoryReading[];
  readonly switchMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly typing: { readonly plain: LatencySummary; readonly profiled: LatencySummary };
  readonly typingProfile: ProfileSummary | null;
  readonly idle: {
    readonly ms: number;
    /** CPU (ms) of the tab's process and of the extension's over the idle span with no sampler. */
    readonly tabCpuMs: number;
    readonly extensionCpuMs: number;
    /** Every process of the browser together (the parent included). */
    readonly allCpuMs: number;
    readonly calls: CallsSummary;
    readonly profile: ProfileSummary | null;
    /** What the other chats' fans sent over the whole idle part (traffic.ts). */
    readonly traffic: { readonly typing: number; readonly messages: number; readonly failed: number };
  };
  readonly roundReadings: readonly MemoryReading[];
  readonly calls: CallsSummary;
  /** Non-loopback attempts the egress sink saw during the run (must be none). */
  readonly egress: readonly string[];
  /** What the subject reports at the window reading (before the growth rounds) and at the end. */
  readonly subjectStateWindow: Record<string, unknown>;
  readonly subjectState: Record<string, unknown>;
}

const now = (): number => performance.now();

function summarizeTimes(values: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
  return { p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted.at(-1) ?? 0) };
}

async function fanslyCalls(since: number): Promise<{ byCaller: Record<string, Record<string, number>>; violations: number }> {
  const page = await fakeFansly().journal(since);
  const byCaller: Record<string, Record<string, number>> = {};
  for (const entry of page.entries) {
    // HTTP calls by their route (or path, for one the fake does not serve); the socket by what happened on it.
    const route = entry.kind === 'http' ? `${entry.method ?? '?'} ${entry.route ?? entry.path?.split('?')[0] ?? '?'}` : entry.kind;
    const bucket = (byCaller[entry.caller] ??= {});
    bucket[route] = (bucket[route] ?? 0) + 1;
  }
  return { byCaller, violations: page.violations.length };
}

async function hubCalls(since: number): Promise<Record<string, number>> {
  const { fakeHub } = await import('../../support/fake-hub');
  const page = await fakeHub().journal(since);
  const counts: Record<string, number> = {};
  for (const entry of page.entries) {
    const key = `${entry.kind} ${entry.method} ${entry.route ?? entry.path}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function callsSince(marks: { fansly: number; hub: number }): Promise<CallsSummary> {
  const fansly = await fanslyCalls(marks.fansly);
  return { fansly: fansly.byCaller, fanslyViolations: fansly.violations, hub: await hubCalls(marks.hub) };
}

async function marksNow(): Promise<{ fansly: number; hub: number }> {
  const { fakeHub } = await import('../../support/fake-hub');
  return { fansly: await fakeFansly().mark(), hub: await fakeHub().mark() };
}

/** Runs the scenario for one subject in the current (fresh) browser; returns the report. */
export async function runScenario(subject: PerfSubject, options: ScenarioOptions): Promise<ScenarioReport> {
  mkdirSync(options.evidenceDir, { recursive: true });
  const { standServer } = await import('../../support/stand');
  const egressFrom = (await standServer.egress()).next;
  const startMarks = await marksNow();
  const siteHost = new URL(fanslyStandOrigin()).host;

  await browser.browsingContextSetViewport({ context: await browser.getWindowHandle(), viewport: LIVE_VIEWPORT });
  await subject.prepare();
  const host = subject.addonId === null ? null : await addonHost(subject.addonId);
  if (subject.addonId !== null && host === null) throw new Error(`${subject.name}: the add-on ${subject.addonId} is not installed`);
  await setFanslyNeighbor(options.neighbor === 'off' ? null : { mode: options.neighbor });

  // Open the stand on its first chat.
  const t0 = now();
  const startedAt = new Date().toISOString();
  await browser.url(fanslyStandUrl('/messages'));
  await waitForFanslyStandReady();
  // fansly.com caps its content at `--maxContentWidth: 70em` (the live snapshot: `app-messages-route` 1120 px wide in
  // a 1728-px window, docs/research/fansly/chat-dom-2026-10-13.json); the stand's route takes the whole width. The
  // column it leaves on the right is where the old extension docks «Всегда справа» (fansly-chat placement.ts).
  await browser.execute((css: string) => {
    const style = document.createElement('style');
    style.dataset['perfStand'] = 'max-content-width';
    style.textContent = css;
    document.head.append(style);
  }, LIVE_CONTENT_CSS);
  // The first chats of the inbox: their rows are rendered, a person clicks them.
  const groups = (await fanslyIds()).groups.slice(0, 6);
  if (groups.length < 4) throw new Error(`the stand's inbox has ${String(groups.length)} groups loaded`);
  let openGroup = '';
  /** `settle` — and wait until the page's own requests and read marks for the chat are done (a person's pace). */
  const openChat = async (groupId: string, settle = true): Promise<number> => {
    const start = now();
    openGroup = groupId;
    await browser.$(`.messages-list-wrapper a[href="/messages/${groupId}"]`).click();
    await browser.waitUntil(async () => (await callFansly('route')).groupId === groupId && (await browser.$(FANSLY_MAIN.field).isExisting()), {
      timeout: 10_000,
      interval: 25,
      timeoutMsg: `chat ${groupId} did not open`,
    });
    if (options.neighbor !== 'off') await waitForNeighborComposer();
    await subject.ready(groupId);
    const opened = now() - start;
    if (settle) await waitForFanslyStandIdle(15_000, 200);
    return opened;
  };
  await openChat(groups[0] as string);
  const reading = (label: string): Promise<MemoryReading> => readMemory(siteHost, host, label, Math.round(now() - t0));
  const readings: Record<string, MemoryReading> = {};
  readings['opened'] = await reading('opened');

  // §11: chat switches, a person's pace (the next chat once the open one is done), over the first chats of the inbox.
  const switchTimes: number[] = [];
  for (let step = 1; step <= options.switches; step += 1) {
    switchTimes.push(await openChat(groups[step % groups.length] as string));
    await browser.pause(250);
  }

  // §11: typing into the composer, as separate key presses; once plain, once under the sampler.
  const field = browser.$(FANSLY_MAIN.field);
  const typeOnce = async (): Promise<LatencySummary> => {
    await field.click();
    await installInputProbe();
    await takeLatencySamples();
    await typeSlowly(options.text, options.keyGapMs);
    await browser.pause(300);
    const samples = await takeLatencySamples();
    // Empty the field again (select all, delete), as after a sent message.
    await browser.keys([Key.Ctrl, 'a']);
    await browser.keys([Key.Backspace]);
    await browser.pause(300);
    return summarizeLatency(samples);
  };
  const plain = await typeOnce();
  const typingFile = `${options.evidenceDir}typing.json.gz`;
  await startProfiler();
  const profiled = await typeOnce();
  await stopProfiler(typingFile);
  const worked = await reading('worked');
  readings['worked'] = worked;
  const pidsOf = (value: MemoryReading): { tab: number | null; extension: number | null } => ({ tab: value.tab?.pid ?? null, extension: value.extension?.pid ?? null });
  const typingProfile = summarizeProfileFile(typingFile, pidsOf(worked), host, 0);
  // Nothing focused while the tab idles (a person looked away).
  await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());

  // Idle until the window closes, the other chats' fans typing and writing meanwhile; the last two idle spans are the
  // CPU minute and the profiled minute.
  const traffic = startTraffic(groups, () => openGroup);
  const idleReadings: MemoryReading[] = [];
  const probeAt = t0 + options.windowMs - 2 * options.idleProbeMs;
  while (now() < probeAt) {
    const next = options.idleSampleMs > 0 ? Math.min(probeAt, now() + options.idleSampleMs) : probeAt;
    await browser.pause(Math.max(0, next - now()));
    if (options.idleSampleMs > 0 && now() < probeAt - 1000) idleReadings.push(await reading(`idle-${String(idleReadings.length + 1)}`));
  }
  const idleMarks = await marksNow();
  const cpuBefore = await processCpu();
  await browser.pause(options.idleProbeMs);
  const cpuAfter = await processCpu();
  const idleCalls = await callsSince(idleMarks);
  const cpuOf = (pid: number | undefined): number => (pid === undefined ? 0 : Math.round((cpuAfter[pid] ?? 0) - (cpuBefore[pid] ?? 0)));
  const idleFile = `${options.evidenceDir}idle.json.gz`;
  await startProfiler();
  await browser.pause(options.idleProbeMs);
  await stopProfiler(idleFile);
  const trafficSent = await traffic.stop();
  const windowReading = await reading('window');
  readings['window'] = windowReading;
  await dumpMemoryReport(`${options.evidenceDir}memory-report-window.json.gz`);
  const subjectStateWindow = await subject.describe();
  const idleProfile = summarizeProfileFile(idleFile, pidsOf(windowReading), host, options.idleProbeMs);
  const allCpu = Math.round(Object.keys(cpuAfter).reduce((sum, pid) => sum + (cpuAfter[Number(pid)] ?? 0) - (cpuBefore[Number(pid)] ?? 0), 0));

  // plan.md §4: growth over rounds of 100 switches and 20 overlay cycles, after GC.
  const roundReadings: MemoryReading[] = [];
  for (let round = 1; round <= options.rounds; round += 1) {
    // Brisk switching (the next chat as soon as this one is up), the page left to settle at the end of the run.
    for (let step = 1; step <= options.roundSwitches; step += 1) await openChat(groups[step % groups.length] as string, false);
    await waitForFanslyStandIdle(30_000, 200);
    for (let cycle = 0; cycle < options.roundOverlays; cycle += 1) await subject.overlay(cycle);
    roundReadings.push(await reading(`round-${String(round)}`));
  }

  const egress = (await standServer.egress(egressFrom)).attempts.map((attempt) => attempt.line);
  return {
    subject: subject.name,
    addonHost: host,
    neighbor: options.neighbor,
    options: {
      neighbor: options.neighbor,
      switches: options.switches,
      windowMs: options.windowMs,
      idleSampleMs: options.idleSampleMs,
      idleProbeMs: options.idleProbeMs,
      rounds: options.rounds,
      roundSwitches: options.roundSwitches,
      roundOverlays: options.roundOverlays,
      keyGapMs: options.keyGapMs,
      textLength: options.text.length,
    },
    startedAt,
    readings,
    idleReadings,
    switchMs: summarizeTimes(switchTimes),
    typing: { plain, profiled },
    typingProfile,
    idle: {
      ms: options.idleProbeMs,
      tabCpuMs: cpuOf(windowReading.tab?.pid),
      extensionCpuMs: cpuOf(windowReading.extension?.pid),
      allCpuMs: allCpu,
      calls: idleCalls,
      profile: idleProfile,
      traffic: trafficSent,
    },
    roundReadings,
    calls: await callsSince(startMarks),
    egress,
    subjectStateWindow,
    subjectState: await subject.describe(),
  };
}

/** The window of the live snapshot (docs/research/fansly/chat-dom-2026-10-13.json: 1728 × 936). */
export const LIVE_VIEWPORT = { width: 1728, height: 936 } as const;
/**
 * Fansly's content width cap, centred: the live snapshot's `app-messages-route` is 1120 px (`70em` of the site's 16 px);
 * in pixels, as the stand's elements do not all sit at 16 px.
 */
export const LIVE_CONTENT_CSS = 'app-messages-route { max-width: 1120px; margin: 0 auto; }';

export const FANSLY_PERF_EVIDENCE_DIR = `${E2E_EVIDENCE_DIR}perf-fansly/`;
