import { describe, expect, it } from 'vitest';

import { summarizeProfile, type GeckoProfile, type GeckoThread } from './gecko-profile';

const ADDON = 'b3f0c0de-0000-4000-8000-000000000001';

/** A main thread whose samples walk the stacks given as frame lists (root first), each with its CPU delta in µs. */
function thread(pid: number, samples: ReadonlyArray<readonly [readonly string[], number]>, markers: ReadonlyArray<readonly [string, { readonly type: string; readonly name: string }?]> = []): GeckoThread {
  const strings: string[] = [];
  const stringOf = (text: string): number => {
    const at = strings.indexOf(text);
    if (at >= 0) return at;
    strings.push(text);
    return strings.length - 1;
  };
  const frames: unknown[][] = [];
  const stacks: unknown[][] = [];
  const stackOf = (path: readonly string[]): number | null => {
    let prefix: number | null = null;
    for (const location of path) {
      frames.push([stringOf(location)]);
      stacks.push([prefix, frames.length - 1]);
      prefix = stacks.length - 1;
    }
    return prefix;
  };
  return {
    name: 'GeckoMain',
    pid: String(pid),
    samples: { schema: { stack: 0, time: 1, threadCPUDelta: 2 }, data: samples.map(([path, cpu], index) => [stackOf(path), index, cpu]) },
    // A text marker's details go into the thread's strings, as Gecko writes them (`unique-string`).
    markers: {
      schema: { name: 0, data: 1 },
      data: markers.map(([name, data]) => [stringOf(name), data === undefined ? null : { ...(data as Record<string, unknown>), name: stringOf(String((data as { name: string }).name)) }]),
    },
    stackTable: { schema: { prefix: 0, frame: 1 }, data: stacks },
    frameTable: { schema: { location: 0 }, data: frames },
    stringTable: strings,
  };
}

const page = 'onInput (http://localhost:47110/assets/index.js:1:20)';
const ours = `poll (moz-extension://${ADDON}/content.js:1:99)`;
const neighbour = 'hook (http://localhost:47110/neighbor/neighbor.js:1:5)';

describe('summarizeProfile', () => {
  it('splits a main thread’s CPU by the add-on’s and the neighbour’s frames and counts the add-on’s wake-ups', () => {
    const tab = thread(
      11,
      [
        [['(root)', page], 1000],
        [['(root)', ours], 2000],
        [['(root)', page, ours], 3000],
        [['(root)'], 0],
        [['(root)', ours], 500],
        [['(root)', neighbour], 4000],
      ],
      [
        ['DOMEvent'],
        ['DOMEvent'],
        ['Styles'],
        ['setTimeout callback', { type: 'TextStack', name: `setInterval handler with interval 499ms: poll (moz-extension://${ADDON}/content.js:112)` }],
        ['setTimeout callback', { type: 'TextStack', name: 'setTimeout handler with interval 0ms: onInput (http://localhost:47110/assets/index.js:1)' }],
      ],
    );
    const profile: GeckoProfile = {
      meta: { interval: 1, startTime: 0, sampleUnits: { threadCPUDelta: 'µs' } },
      threads: [],
      processes: [{ meta: { interval: 1, startTime: 0, sampleUnits: { threadCPUDelta: 'µs' } }, threads: [tab] }],
    };
    const summary = summarizeProfile(profile, 'x.json.gz', { tab: 11, extension: 12 }, ADDON, 60_000);
    expect(summary.extension).toBeNull();
    expect(summary.tab).toEqual({
      pid: 11,
      samples: 6,
      cpuMs: 10.5,
      addonCpuMs: 5.5,
      addonSamples: 3,
      // Samples 2–3 are one run, sample 5 another.
      addonWakeups: 2,
      neighborCpuMs: 4,
      addonTop: { 'poll (content.js:1:99)': 3 },
      markers: { DOMEvent: 2, 'setTimeout callback': 2, Styles: 1 },
      addonMarkers: { 'setTimeout callback': 1 },
      addonTimers: { 'setInterval handler with interval 499ms: poll (content.js:112)': 1 },
    });
  });

  it('reads nanosecond CPU deltas and finds a thread in a nested process profile', () => {
    const background = thread(12, [[['(root)', `tick (moz-extension://${ADDON}/background.js:1:1)`], 2_000_000]]);
    const profile: GeckoProfile = {
      meta: { interval: 1, startTime: 0 },
      threads: [],
      processes: [{ meta: { interval: 1, startTime: 0, sampleUnits: { threadCPUDelta: 'ns' } }, threads: [], processes: [{ meta: { interval: 1, startTime: 0, sampleUnits: { threadCPUDelta: 'ns' } }, threads: [background] }] }],
    };
    const summary = summarizeProfile(profile, 'x.json.gz', { tab: null, extension: 12 }, ADDON, 1000);
    expect(summary.extension).toMatchObject({ cpuMs: 2, addonCpuMs: 2, addonWakeups: 1, addonTop: { 'tick (background.js:1:1)': 1 } });
    expect(summary.tab).toBeNull();
  });
});
