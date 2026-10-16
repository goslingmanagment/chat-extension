import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SCENARIO, type ScenarioReport } from '../../e2e/perf/fansly/scenario';
import type { MemoryReading } from '../../e2e/perf/fansly/memory';
import { FANSLY_PERF_SPEC, contentProfileMB, perfNeighbors, scenarioChecks, unexpectedTabTimers } from './fansly-gate';
import type { ThreadSummary } from './gecko-profile';

const MB = 1024 ** 2;
function reading(label: string, memoryMB: number, withUs: boolean): MemoryReading {
  const process = { name: 'web (pid 1)', pid: 1, explicit: memoryMB * MB, ours: 0, footprint: 0, cpuMs: 0, documents: {}, parts: {} };
  return { label, at: 600_000, tab: process, extension: { ...process, pid: 2, documents: withUs ? { 'background.html': 25 * MB } : {} }, processes: [] };
}
function thread(timers: Record<string, number> = {}, awake = 100): ThreadSummary {
  return { pid: 1, samples: 100, cpuMs: 0, addonCpuMs: 0, addonSamples: 0, addonWakeups: 0, neighborCpuMs: 0, addonTop: {}, markers: { Awake: awake }, addonMarkers: {}, addonTimers: timers };
}
function report(withUs = false): ScenarioReport {
  const latency = { p50: 3, p95: withUs ? 7 : 6, max: 8, mean: 4 };
  const typing = { keys: DEFAULT_SCENARIO.text.length, handled: latency, frame: latency };
  const tab = thread(withUs ? {
    'setInterval handler with interval 9999ms: keepalive (lazy/fansly/tab-app.js:1)': 6,
    'setTimeout handler with interval 199ms: presence (lazy/fansly/tab-app.js:2)': 6,
    'setInterval handler with interval 59999ms: health (lazy/fansly/tab-health.js:1)': 1,
  } : {});
  return {
    subject: withUs ? 'new' : 'none', addonHost: withUs ? 'test-addon' : null, neighbor: 'after', startedAt: '2026-10-16T00:00:00Z',
    options: { ...DEFAULT_SCENARIO, neighbor: 'after', textLength: DEFAULT_SCENARIO.text.length },
    readings: Object.fromEntries(['opened', 'worked', 'window'].map((label) => [label, reading(label, withUs ? 25 : 20, withUs)])),
    idleReadings: [], switchMs: { p50: 10, p95: 20, max: 30 }, typing: { plain: typing, profiled: typing }, typingProfile: null,
    idle: { ms: 60_000, tabCpuMs: withUs ? 150 : 100, extensionCpuMs: withUs ? 100 : 10, allCpuMs: 500, calls: { fansly: {}, fanslyViolations: 0, hub: {} }, profile: { file: 'profile.json.gz', durationMs: 60_000, tab, extension: thread({}, 20) }, traffic: { typing: 6, messages: 6, failed: 0 } },
    roundReadings: [0, 1, 2].map((n) => reading(`round-${n + 1}`, (withUs ? 27 : 20) + n * 6.5, withUs)),
    calls: { fansly: {}, fanslyViolations: 0, hub: {} }, egress: [],
    subjectStateWindow: { routeToDockMs: Array.from({ length: 20 }, () => 20) }, subjectState: {},
  };
}
const failures = (current: ScenarioReport, base = report()) => scenarioChecks(base, current).filter((check) => !check.pass).map((check) => check.name);

afterEach(() => vi.unstubAllEnvs());

describe('Fansly perf acceptance (P16a)', () => {
  it('accepts the real budgets and subtracts the same neighbour’s growth (the stand itself grows > 5 MB)', () => {
    vi.stubEnv('CG_E2E_TIMING_SLACK', '1');
    expect(failures(report(true))).toEqual([]);
    const current = report(true);
    expect(failures({ ...current, neighbor: 'off' })).toContain('same neighbour as the base');
  });

  it('the 25 MB emergency ceiling is RED; memory and growth never get timing slack', () => {
    vi.stubEnv('CG_E2E_TIMING_SLACK', '3');
    const current = report(true);
    expect(failures({ ...current, readings: { ...current.readings, window: reading('window', 45, true) } })).toContain('window: tab overhead MB');
    const rounds = [...current.roundReadings];
    rounds[2] = reading('round-3', 60, true);
    expect(failures({ ...current, roundReadings: rounds })).toContain('round 3: growth over the same base MB');
    const hot = reading('window', 25, true);
    expect(failures({ ...current, readings: { ...current.readings, window: { ...hot, extension: hot.extension === null ? null : { ...hot.extension, documents: { 'background.html': 31 * MB } } } } })).toContain('window: background document MB');
  });

  it('missing memory, background, profile or timing samples cannot silently pass as zero', () => {
    const current = report(true);
    expect(failures({ ...current, readings: {} })).toContain('window: tab overhead MB');
    const noBackground = reading('window', 25, false);
    expect(failures({ ...current, readings: { ...current.readings, window: noBackground } })).toContain('window: background document MB');
    expect(failures({ ...current, idle: { ...current.idle, profile: null } })).toContain('idle tab: profiler main thread present');
    expect(failures({ ...current, subjectStateWindow: {} })).toContain('route to dock: p95 ms');
    expect(failures({ ...current, roundReadings: [] })).toContain('three complete growth rounds');
  });

  it('allows only documented observation timers, including the coalescer; a new poll or lazy-file poll fails', () => {
    const poll = 'setInterval handler with interval 499ms: poll (lazy/fansly/tab-app.js:3)';
    const hidden = 'setInterval handler with interval 9999ms: poll (lazy/fansly/spenders.js:1)';
    expect(unexpectedTabTimers(thread({ [poll]: 120, [hidden]: 6 }))).toEqual({ [poll]: 120, [hidden]: 6 });
    const current = report(true);
    expect(failures({ ...current, idle: { ...current.idle, profile: { file: 'x', durationMs: 60_000, tab: thread({ [poll]: 120 }), extension: thread() } } })).toContain('idle tab: undocumented observation timers');
  });

  it('counts the mixed profile once per process, includes extra site processes, and rejects absent readings', () => {
    const first = reading('mixed', 20, true);
    const second = reading('mixed', 20, true);
    expect(contentProfileMB([first, second])).toBe(20);
    if (second.tab === null) throw new Error('test fixture');
    expect(contentProfileMB([first, { ...second, siteProcesses: [second.tab, { ...second.tab, pid: 3, explicit: 10 * MB }] }])).toBe(30);
    expect(contentProfileMB([first, { ...second, tab: null }])).toBeNaN();
  });

  it('scales time assertions for CI, while still failing missing typing and unknown timers', () => {
    const current = report(true);
    const slower: ScenarioReport = { ...current, idle: { ...current.idle, tabCpuMs: 300, extensionCpuMs: 1000 }, typing: { ...current.typing, plain: { ...current.typing.plain, handled: { ...current.typing.plain.handled, p95: 13 } } } };
    vi.stubEnv('CG_E2E_TIMING_SLACK', '1');
    expect(failures(slower)).toEqual(expect.arrayContaining(['typing: p95 overhead ms vs P3d', 'idle: tab CPU overhead ms vs P3d', 'idle: background CPU ms (P3d was > 800)']));
    vi.stubEnv('CG_E2E_TIMING_SLACK', '3');
    expect(failures(slower)).toEqual([]);
    expect(failures({ ...current, typing: { ...current.typing, plain: { ...current.typing.plain, keys: 0 } } })).toContain('typing: every key measured');
  });

  it('runs each neighbour exactly once across every CI shard shape and exposes both through pnpm perf', () => {
    expect(perfNeighbors(null)).toEqual(['off', 'after']);
    for (const of of [1, 2, 5, 8]) {
      const parts = Array.from({ length: of }, (_, n) => perfNeighbors({ part: n + 1, of }));
      expect(parts.flat()).toEqual(['off', 'after']);
      expect(parts.filter((part) => part.length > 0)).toHaveLength(Math.min(of, 2));
    }
    const config = readFileSync(new URL('../../e2e/wdio.conf.ts', import.meta.url), 'utf8');
    expect(config).toContain('perfNeighbors(shard).length > 0 ? [FANSLY_PERF_SPEC]');
    expect(FANSLY_PERF_SPEC).toBe('./perf/fansly-perf-probe.e2e.ts');
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { scripts: { perf: string } };
    expect(pkg.scripts.perf).toContain("--spec 'e2e/perf/*perf-probe.e2e.ts'");
  });
});
