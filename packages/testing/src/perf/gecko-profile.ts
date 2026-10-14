// A Gecko profile (the gzipped JSON Firefox's profiler writes, e2e/perf/fansly/profiler.ts) read back for the perf
// reports (R20 P3d, P16a): for the main thread of a process — CPU over the profiled phase, the share with a frame of an
// add-on's own scripts on the stack (`moz-extension://<host>/`) and with a frame of the stand's neighbour
// (`/neighbor/neighbor.js`), how many separate times the add-on's code woke up (runs of samples with its frames — a
// timer or a poll shows as wake-ups in an idle phase), its functions most on the stack, and the markers by name.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export interface Table {
  readonly schema: Record<string, number>;
  readonly data: unknown[][];
}

export interface GeckoThread {
  readonly name: string;
  readonly pid: string | number;
  readonly processName?: string;
  readonly samples: Table;
  readonly markers: Table;
  readonly stackTable: Table;
  readonly frameTable: Table;
  readonly stringTable?: string[];
}

export interface GeckoProfile {
  readonly meta: { readonly interval: number; readonly startTime: number; readonly sampleUnits?: { readonly threadCPUDelta?: string } };
  readonly threads: GeckoThread[];
  readonly processes?: GeckoProfile[];
  readonly shared?: { readonly stringArray?: string[] };
}

export interface ThreadSummary {
  readonly pid: number;
  readonly samples: number;
  /** CPU of the thread over the phase (ms), from the samples' CPU deltas. */
  readonly cpuMs: number;
  /** …of it with a frame of the add-on on the stack. */
  readonly addonCpuMs: number;
  readonly addonSamples: number;
  /** Separate runs of the add-on's code. */
  readonly addonWakeups: number;
  /** …with a frame of the neighbour (the FBuddy-like page script) on the stack. */
  readonly neighborCpuMs: number;
  /** The add-on's functions most on the stack: `name (file)` → samples. */
  readonly addonTop: Readonly<Record<string, number>>;
  /** Markers by name → count (the 15 most frequent). */
  readonly markers: Readonly<Record<string, number>>;
  /** Markers whose payload names the add-on's scripts, by name → count (`setTimeout callback`: its timers that fired). */
  readonly addonMarkers: Readonly<Record<string, number>>;
  /**
   * The add-on's timers that fired, by handler (`setInterval handler with interval 499ms: pollPathname (content.js:112)`)
   * → times: Firefox names each `setTimeout`/`setInterval` callback it runs, with its script — a timer or a poll of the
   * add-on's shows here even when it runs too briefly for a sample to catch it.
   */
  readonly addonTimers: Readonly<Record<string, number>>;
}

export interface ProfileSummary {
  readonly file: string;
  readonly durationMs: number;
  readonly tab: ThreadSummary | null;
  readonly extension: ThreadSummary | null;
}

function allProfiles(profile: GeckoProfile): GeckoProfile[] {
  return [profile, ...(profile.processes ?? []).flatMap(allProfiles)];
}

function summarizeThread(profile: GeckoProfile, thread: GeckoThread, addonHost: string | null): ThreadSummary {
  const strings = thread.stringTable ?? profile.shared?.stringArray ?? [];
  const sampleSchema = thread.samples.schema;
  const stackSchema = thread.stackTable.schema;
  const frameSchema = thread.frameTable.schema;
  const unit = profile.meta.sampleUnits?.threadCPUDelta ?? 'ns';
  const toMs = unit === 'µs' ? 1e-3 : unit === 'ns' ? 1e-6 : 0;
  const stackIndex = sampleSchema['stack'] ?? 0;
  const cpuIndex = sampleSchema['threadCPUDelta'];
  const prefixIndex = stackSchema['prefix'] ?? 0;
  const frameIndex = stackSchema['frame'] ?? 1;
  const locationIndex = frameSchema['location'] ?? 0;

  const frameLocation = (frame: number): string => strings[Number(thread.frameTable.data[frame]?.[locationIndex])] ?? '';
  const addonMark = addonHost === null ? null : `moz-extension://${addonHost}/`;
  // Per stack: the add-on's deepest frame on it (or null), whether the neighbour is on it. Memoised along prefixes.
  const stackFacts = new Map<number, { addon: string | null; neighbor: boolean }>();
  const factsOf = (stack: number | null): { addon: string | null; neighbor: boolean } => {
    if (stack === null) return { addon: null, neighbor: false };
    const known = stackFacts.get(stack);
    if (known !== undefined) return known;
    const row = thread.stackTable.data[stack] ?? [];
    const prefix = row[prefixIndex] as number | null;
    const parent = factsOf(prefix);
    const location = frameLocation(Number(row[frameIndex]));
    const facts = {
      addon: addonMark !== null && location.includes(addonMark) ? location.replace(addonMark, '') : parent.addon,
      neighbor: parent.neighbor || location.includes('/neighbor/neighbor.js'),
    };
    stackFacts.set(stack, facts);
    return facts;
  };

  let cpuMs = 0;
  let addonCpuMs = 0;
  let addonSamples = 0;
  let addonWakeups = 0;
  let neighborCpuMs = 0;
  let previousAddon = false;
  const top = new Map<string, number>();
  for (const sample of thread.samples.data) {
    const cpu = cpuIndex === undefined ? 0 : Number(sample[cpuIndex] ?? 0) * toMs;
    cpuMs += cpu;
    const facts = factsOf((sample[stackIndex] as number | null) ?? null);
    if (facts.addon !== null) {
      addonCpuMs += cpu;
      addonSamples += 1;
      if (!previousAddon) addonWakeups += 1;
      top.set(facts.addon, (top.get(facts.addon) ?? 0) + 1);
    }
    if (facts.neighbor) neighborCpuMs += cpu;
    previousAddon = facts.addon !== null;
  }
  const markerName = thread.markers.schema['name'] ?? 0;
  const markerData = thread.markers.schema['data'];
  const markers = new Map<string, number>();
  const addonMarkers = new Map<string, number>();
  const addonTimers = new Map<string, number>();
  for (const marker of thread.markers.data) {
    const name = strings[Number(marker[markerName])] ?? '?';
    markers.set(name, (markers.get(name) ?? 0) + 1);
    const data = (markerData === undefined ? null : marker[markerData]) as { name?: unknown } | null | undefined;
    if (addonMark === null || data === null || data === undefined) continue;
    // A text marker's details are an index into the thread's strings (`unique-string`).
    const detail = typeof data.name === 'number' ? (strings[data.name] ?? '') : typeof data.name === 'string' ? data.name : '';
    if (!detail.includes(addonMark) && !JSON.stringify(data).includes(addonMark)) continue;
    addonMarkers.set(name, (addonMarkers.get(name) ?? 0) + 1);
    if (name === 'setTimeout callback') {
      const handler = detail.replaceAll(addonMark, '');
      addonTimers.set(handler, (addonTimers.get(handler) ?? 0) + 1);
    }
  }
  const round = (value: number): number => Math.round(value * 10) / 10;
  return {
    pid: Number(thread.pid),
    samples: thread.samples.data.length,
    cpuMs: round(cpuMs),
    addonCpuMs: round(addonCpuMs),
    addonSamples,
    addonWakeups,
    neighborCpuMs: round(neighborCpuMs),
    addonTop: Object.fromEntries([...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
    markers: Object.fromEntries([...markers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
    addonMarkers: Object.fromEntries([...addonMarkers.entries()].sort((a, b) => b[1] - a[1])),
    addonTimers: Object.fromEntries([...addonTimers.entries()].sort((a, b) => b[1] - a[1])),
  };
}

/** Reads a saved profile and summarises the main threads of the two processes (by pid) for the add-on (by its moz-extension host). */
export function summarizeProfileFile(file: string, pids: { readonly tab: number | null; readonly extension: number | null }, addonHost: string | null, durationMs: number): ProfileSummary {
  return summarizeProfile(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as GeckoProfile, file, pids, addonHost, durationMs);
}

/** The same for a profile already read. */
export function summarizeProfile(profile: GeckoProfile, file: string, pids: { readonly tab: number | null; readonly extension: number | null }, addonHost: string | null, durationMs: number): ProfileSummary {
  const profiles = allProfiles(profile);
  const mainOf = (pid: number | null): ThreadSummary | null => {
    if (pid === null) return null;
    for (const each of profiles) {
      const thread = each.threads.find((candidate) => candidate.name === 'GeckoMain' && Number(candidate.pid) === pid);
      if (thread !== undefined) return summarizeThread(each, thread, addonHost);
    }
    return null;
  };
  return { file, durationMs, tab: mainOf(pids.tab), extension: mainOf(pids.extension) };
}
