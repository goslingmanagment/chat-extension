// Firefox Profiler in the headless Firefox of the perf stand (R20 P3d, for
// P16a too): Gecko's own sampler, started and read in the chrome context, the
// profile saved as the gzipped Gecko JSON that profiler.firefox.com opens
// («Load a profile from file»). The run keeps the files; the report keeps a
// summary of the two processes that matter — the stand tab's and the
// extension's — over the profiled phase:
// CPU of each main thread and the add-on's share of it, its wake-ups, its
// functions most on the stack and the markers (src/perf/gecko-profile.ts).
// The sampler costs CPU itself: CPU numbers of a phase are read without it
// (memory.ts `processCpu`), the profile says where the time went.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

import { inChrome } from './memory';

export { summarizeProfileFile, type ProfileSummary, type ThreadSummary } from '../../../src/perf/gecko-profile';

/** 1 ms: what the Firefox Profiler's own presets use for a JS-heavy page. */
const INTERVAL_MS = 1;
/** 64 Mi entries (8 bytes each), per process: room for a minute of every main thread at 1 ms. */
const ENTRIES = 64 * 1024 * 1024;
const FEATURES = ['js', 'cpu'];
const THREADS = ['GeckoMain'];

export async function startProfiler(): Promise<void> {
  await inChrome<void>(
    `const [entries, interval, features, threads] = args;
     if (Services.profiler.IsActive()) Services.profiler.StopProfiler();
     await Services.profiler.StartProfiler(entries, interval, features, threads);`,
    ENTRIES,
    INTERVAL_MS,
    FEATURES,
    THREADS,
  );
}

/**
 * Stops the sampler and writes the profile of every process to `file` as gzipped Gecko JSON. Firefox writes the JSON
 * itself (`dumpProfileToFileAsync`) to the machine it runs on — the one the test process runs on too (the e2e
 * container, or the Mac) — and the test process gzips it in place.
 */
export async function stopProfiler(file: string): Promise<void> {
  const raw = file.replace(/\.gz$/, '');
  await inChrome<void>(
    `const [raw] = args;
     await Services.profiler.dumpProfileToFileAsync(raw);
     Services.profiler.StopProfiler();`,
    raw,
  );
  const text = readFileSync(raw);
  if (text.length === 0) throw new Error(`the profiler wrote nothing to ${raw}`);
  writeFileSync(file, gzipSync(text));
  rmSync(raw);
}
