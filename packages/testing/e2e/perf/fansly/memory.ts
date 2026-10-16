// Memory and CPU of the processes a Fansly stand tab lives in (R20 P3d, for
// P16a too), read the way about:memory reads them: Firefox's memory reporters
// after «Minimize memory usage» (`minimizeMemoryUsage`: GC and CC in every
// process, three times) and `ChromeUtils.requestProcInfo()`, in the browser's
// chrome context (geckodriver --allow-system-access, wdio.conf.ts). The same
// reading as e2e/perf/perf-probe.e2e.ts (ChatSpace), generalised to any site
// and any add-on:
// - the TAB process: the one whose reports hold the stand page's top window
//   (`top(http://localhost:<port>/…)`); `explicit` is about:memory's
//   «explicit» of that whole process (heap-allocated plus the non-heap
//   reports), `ours` — the reports of the add-on's realms in it (its content
//   scripts' sandboxes, Expanded Principal; its frames);
// - the EXTENSION process: the one that holds the add-on's own documents
//   (`moz-extension://<uuid>/…`: the event page, the old extension's relay
//   frames, an open popup), with each document's own share; with no add-on
//   installed (the base), Firefox's own extension process — the same process
//   then carries its built-in add-ons only.

import { browser } from '@wdio/globals';

export interface ProcessReading {
  readonly name: string;
  readonly pid: number;
  /** about:memory «explicit» of the process, bytes. */
  readonly explicit: number;
  /** The reports of the add-on's realms in the process, bytes. */
  readonly ours: number;
  /** Resident-unique memory of the process (bytes) and its CPU time so far (ms). */
  readonly footprint: number;
  readonly cpuMs: number;
  /** The add-on's documents in this process (`background.html`, `fansly-relay.html`…) → bytes. */
  readonly documents: Readonly<Record<string, number>>;
  /** The eight largest second-level parts of «explicit» → bytes. */
  readonly parts: Readonly<Record<string, number>>;
}

export interface MemoryReading {
  /** What the reading marks in the scenario (`opened`, `worked`, `window`, `round-1`…). */
  readonly label: string;
  /** ms since the scenario opened the stand (the caller's clock). */
  readonly at: number;
  readonly tab: ProcessReading | null;
  /** All processes holding this site, for the 10-tab profile (older P3d reports omit this). */
  readonly siteProcesses?: readonly ProcessReading[];
  readonly extension: ProcessReading | null;
  /** Every content process's «explicit» and the parent's, bytes: the whole profile at a glance. */
  readonly processes: ReadonlyArray<{ readonly name: string; readonly explicit: number }>;
}

interface Gecko {
  setMozContext(context: 'chrome' | 'content'): Promise<void>;
  executeAsyncScript(script: string, args: unknown[]): Promise<unknown>;
  setTimeout(timeouts: { script?: number }): Promise<void>;
}

/** Runs `body` (an async function body; `args` holds the arguments) in the browser's chrome context. */
export async function inChrome<T>(body: string, ...args: unknown[]): Promise<T> {
  const gecko = browser as unknown as Gecko;
  await gecko.setTimeout({ script: 600_000 });
  await gecko.setMozContext('chrome');
  try {
    const answer = (await gecko.executeAsyncScript(
      `const done = arguments[arguments.length - 1]; const args = Array.prototype.slice.call(arguments, 0, -1);
       (async (...args) => { ${body} })(...args).then((value) => done({ ok: true, value }), (error) => done({ ok: false, error: String(error) + ' ' + (error && error.stack || '') }));`,
      args,
    )) as { ok: true; value: T } | { ok: false; error: string };
    if (!answer.ok) throw new Error(`chrome context: ${answer.error}`);
    return answer.value;
  } finally {
    await gecko.setMozContext('content');
  }
}

/** The moz-extension host (`<uuid>`) of an installed add-on, or null. */
export async function addonHost(addonId: string): Promise<string | null> {
  return inChrome<string | null>(`const policy = WebExtensionPolicy.getByID(args[0]); return policy ? policy.mozExtensionHostname : null;`, addonId);
}

/**
 * One reading after a forced GC everywhere. `siteHost` — the stand page's `host:port`; `extensionHost` — the add-on's
 * moz-extension host, or null when none is installed. `label` and `at` are the caller's.
 */
export async function readMemory(siteHost: string, extensionHost: string | null, label: string, at: number, gc = true): Promise<MemoryReading> {
  const raw = await inChrome<Omit<MemoryReading, 'at' | 'label'>>(
    `
    const [siteHost, extensionHost, gc] = args;
    const manager = Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
    if (gc) await new Promise((resolve) => manager.minimizeMemoryUsage(resolve));
    const byProcess = new Map();
    const entryOf = (name) => {
      let entry = byProcess.get(name);
      if (!entry) byProcess.set(name, (entry = { name, heap: 0, nonHeap: 0, ours: 0, site: false, extension: false, documents: {}, parts: {} }));
      return entry;
    };
    await new Promise((resolve) =>
      manager.getReports(
        (process, path, kind, units, amount) => {
          if (units !== Ci.nsIMemoryReporter.UNITS_BYTES) return;
          const entry = entryOf(process);
          if (path === 'heap-allocated') entry.heap = amount;
          if (!path.startsWith('explicit/')) return;
          if (kind === Ci.nsIMemoryReporter.KIND_NONHEAP) entry.nonHeap += amount;
          // about:memory writes a URL's slashes as backslashes.
          const plain = path.replaceAll('\\\\', '/');
          if (plain.includes('top(http://' + siteHost + '/')) entry.site = true;
          if (extensionHost !== null) {
            const ownDocument = /top\\(moz-extension:\\/\\/([^/]+)\\/([^,?#)]*)/.exec(plain);
            if (ownDocument !== null && ownDocument[1] === extensionHost) {
              entry.extension = true;
              const page = ownDocument[2] || '/';
              entry.documents[page] = (entry.documents[page] ?? 0) + amount;
            }
            // A content script's sandbox is an Expanded Principal realm; one add-on is installed at a time here.
            if (plain.includes('moz-extension://' + extensionHost) || plain.includes('Expanded Principal')) entry.ours += amount;
          }
          const part = path.split('/').slice(0, 2).join('/');
          entry.parts[part] = (entry.parts[part] ?? 0) + amount;
        },
        null,
        resolve,
        null,
        false,
      ),
    );
    const info = await ChromeUtils.requestProcInfo();
    const procs = new Map([[info.pid, info], ...info.children.map((child) => [child.pid, child])]);
    const numbers = (entry) => {
      if (!entry) return null;
      const pid = Number(/\\(pid (\\d+)\\)/.exec(entry.name)?.[1] ?? info.pid);
      const proc = procs.get(pid);
      const largest = Object.fromEntries(Object.entries(entry.parts).sort((a, b) => b[1] - a[1]).slice(0, 8));
      return { name: entry.name, pid, explicit: entry.heap + entry.nonHeap, ours: entry.ours, footprint: proc ? Number(proc.memory) : 0, cpuMs: proc ? Number(proc.cpuTime) / 1e6 : 0, documents: entry.documents, parts: largest };
    };
    const all = [...byProcess.values()];
    return {
      tab: numbers(all.find((entry) => entry.site)),
      siteProcesses: all.filter((entry) => entry.site).map(numbers),
      // The process of the add-on's documents; with no add-on of ours, the process of Firefox's own (built-in) ones.
      extension: numbers(all.find((entry) => entry.extension && !entry.site) ?? all.find((entry) => entry.name.startsWith('extension'))),
      processes: all.map((entry) => ({ name: entry.name, explicit: entry.heap + entry.nonHeap })),
    };
    `,
    siteHost,
    extensionHost,
    gc,
  );
  return { label, at, ...raw };
}

/**
 * The full memory report as about:memory saves it («Save…»: gzipped JSON, opened again with its «Load…»), written to
 * `file` on the machine Firefox runs on — the evidence behind a reading. No GC of its own: take it right after one.
 */
export async function dumpMemoryReport(file: string): Promise<void> {
  await inChrome<void>(
    `const [file] = args;
     const dumper = Cc['@mozilla.org/memory-info-dumper;1'].getService(Ci.nsIMemoryInfoDumper);
     await new Promise((resolve) => dumper.dumpMemoryReportsToNamedFile(file, () => resolve(), null, false, false));`,
    file,
  );
}

/** CPU time (ms) of every process now, by pid. */
export async function processCpu(): Promise<Record<number, number>> {
  return inChrome<Record<number, number>>(
    `const info = await ChromeUtils.requestProcInfo(); return Object.fromEntries([[info.pid, Number(info.cpuTime) / 1e6], ...info.children.map((child) => [child.pid, Number(child.cpuTime) / 1e6])]);`,
  );
}

export const MB = 1024 * 1024;
export const mb = (bytes: number): number => Math.round((bytes / MB) * 100) / 100;
