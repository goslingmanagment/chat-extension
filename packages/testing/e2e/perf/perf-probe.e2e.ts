// The §11 memory and idle budgets on the wired extension, measured on the
// stand (architecture.md §11 «память», «простой»). NOT part of `pnpm e2e`:
// `pnpm perf` runs this one file and writes `.cache/e2e/perf.json`.
//
// What is measured, with Firefox's own memory reporters after a forced GC
// (`minimizeMemoryUsage`, the «Minimize memory usage» of about:memory) and
// `ChromeUtils.requestProcInfo()` — both read in the browser's chrome
// context, which the e2e profile allows (geckodriver --allow-system-access):
// - the stand's tab without the extension, then with it: what the extension
//   adds to the tab («вкладка +≤ 15 МБ») — just opened, and after a round of
//   work on both sides — and what the event page takes («фон ≤ 30 МБ»: its
//   own document; the process around it is reported next to it);
// - three rounds of 100 chat switches and 20 openings of our windows: the
//   growth per round once the first one warmed everything up («рост ≤ 5 МБ
//   за 100 переключений и 20 циклов оверлея после GC»); nothing of ours is
//   left open after a round;
// - 60 s of an idle tab: the CPU of the tab's process and of the extension's,
//   the calls to the hub, the calls to ChatSpace («почти ноль CPU за 60 с»).
//
// The numbers are the stand's — a page far lighter than ChatSpace — in a
// headless Firefox with the TEST build: a regression trip-wire for our own
// code, not the field budget. The asserted limits are the budgets where the
// stand can hold them (growth, idle) and a loose ceiling where it cannot
// (the tab's absolute overhead sits at the budget itself; see
// docs/pilot-readiness.md «Замеры»).

import { mkdirSync, writeFileSync } from 'node:fs';

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { MOD, PANEL } from '../support/chat';
import { E2E_ADDON_UUID } from '../support/constants';
import { useFakeHub } from '../support/fake-hub';
import { oursExists, waitOursText } from '../support/ours';
import { dockIs, startShift } from '../support/shift';
import { callStand, chatPath, foreignCalls, openStand, STAND_IDS, standOrigin, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1, a2, a4 } = STAND_IDS.fans;
const FANS = [a1, a2, a4] as const;
const MB = 1024 * 1024;

const SWITCHES_PER_ROUND = 100;
const OVERLAYS_PER_ROUND = 20;
const ROUNDS = 3;
const IDLE_MS = 60_000;

/** §11 «память» and «простой», as limits a run on the stand is held to. */
const LIMITS = {
  /** Growth of the tab per round after the warm-up round (the budget itself). */
  growthPerRoundMB: 5,
  /** The event page's own document in the extension's process (the budget itself). */
  backgroundMB: 30,
  /** The tab's overhead: the budget is 15 MB and the stand sits at it — a loose ceiling that catches a doubling. */
  tabOverheadMB: 25,
  /** CPU of one process over the idle minute: «почти ноль». */
  idleCpuMs: 500,
  /** Calls to the hub over the idle minute (the slow «Новые» poll, a bootstrap refresh). */
  idleHubCalls: 3,
} as const;

interface ProcessNumbers {
  readonly name: string;
  readonly pid: number;
  /** about:memory's «explicit»: heap-allocated plus the non-heap explicit reports. */
  readonly explicit: number;
  /** Realms of content-script sandboxes (Expanded Principal) and of the extension's own documents. */
  readonly ours: number;
  /** Resident-unique memory of the process and its CPU time so far (ms). */
  readonly footprint: number;
  readonly cpuMs: number;
  /** The extension's process only: its documents (the event page, the open extension pages) and the largest parts of «explicit», in bytes. */
  readonly documents: Readonly<Record<string, number>>;
  readonly parts: Readonly<Record<string, number>>;
}

interface Snapshot {
  readonly tab: ProcessNumbers | null;
  readonly extension: ProcessNumbers | null;
}

interface Gecko {
  setMozContext(context: 'chrome' | 'content'): Promise<void>;
  executeAsyncScript(script: string, args: unknown[]): Promise<unknown>;
  setTimeout(timeouts: { script?: number }): Promise<void>;
}

/** Runs `body` (an async function body) in the browser's chrome context. */
async function inChrome<T>(body: string, ...args: unknown[]): Promise<T> {
  const gecko = browser as unknown as Gecko;
  await gecko.setMozContext('chrome');
  try {
    const answer = (await gecko.executeAsyncScript(
      `const done = arguments[arguments.length - 1]; const args = Array.prototype.slice.call(arguments, 0, -1);
       (async (...args) => { ${body} })(...args).then((value) => done({ ok: true, value }), (error) => done({ ok: false, error: String(error) }));`,
      args,
    )) as { ok: true; value: T } | { ok: false; error: string };
    if (!answer.ok) throw new Error(`chrome context: ${answer.error}`);
    return answer.value;
  } finally {
    await gecko.setMozContext('content');
  }
}

/** The tab's process (the one that holds the stand's page) and the extension's, after a forced GC everywhere. */
async function snapshot(): Promise<Snapshot> {
  const stand = new URL(standOrigin()).host;
  return inChrome<Snapshot>(
    `
    const [standHost, addonUuid] = args;
    const manager = Cc['@mozilla.org/memory-reporter-manager;1'].getService(Ci.nsIMemoryReporterManager);
    await new Promise((resolve) => manager.minimizeMemoryUsage(resolve));
    const byProcess = new Map();
    const entryOf = (name) => {
      let entry = byProcess.get(name);
      if (!entry) byProcess.set(name, (entry = { name, heap: 0, nonHeap: 0, ours: 0, stand: false, extension: false, documents: {}, parts: {} }));
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
          if (plain.includes('top(http://' + standHost + '/')) entry.stand = true;
          const ownDocument = /top\\(moz-extension:\\/\\/[^/]+\\/([^,?#)]*)/.exec(plain);
          if (ownDocument !== null && plain.includes('moz-extension://' + addonUuid + '/')) {
            entry.extension = true;
            const page = ownDocument[1] || '/';
            entry.documents[page] = (entry.documents[page] ?? 0) + amount;
          }
          if (plain.includes('Expanded Principal') || plain.includes('moz-extension://' + addonUuid)) entry.ours += amount;
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
    const procs = new Map(info.children.map((child) => [child.pid, child]));
    const numbers = (entry) => {
      if (!entry) return null;
      const pid = Number(/\\(pid (\\d+)\\)/.exec(entry.name)?.[1] ?? 0);
      const proc = procs.get(pid);
      const largest = Object.fromEntries(Object.entries(entry.parts).sort((a, b) => b[1] - a[1]).slice(0, 8));
      return { name: entry.name, pid, explicit: entry.heap + entry.nonHeap, ours: entry.ours, footprint: proc ? Number(proc.memory) : 0, cpuMs: proc ? Number(proc.cpuTime) / 1e6 : 0, documents: entry.documents, parts: largest };
    };
    const all = [...byProcess.values()];
    return { tab: numbers(all.find((entry) => entry.stand)), extension: numbers(all.find((entry) => entry.extension && !entry.stand)) };
    `,
    stand,
    E2E_ADDON_UUID,
  );
}

const mb = (bytes: number): number => Math.round((bytes / MB) * 100) / 100;

describe('§11 on the wired extension — memory and idle, measured on the stand', () => {
  const { hub } = useFakeHub();
  const report: Record<string, unknown> = {};

  const leaveField = (): Promise<void> => $('[data-stand-conversation-header]').click();
  const closeAll = async (): Promise<void> => {
    for (let press = 0; press < 5 && (await dockIs(() => true, 'the dock')).overlays.length > 0; press += 1) {
      await browser.keys(Key.Escape);
      await browser.pause(120);
    }
  };
  /** The switches of one round; `ours` — the dock is waited for along the way. */
  const switches = async (ours: boolean): Promise<void> => {
    for (let step = 0; step < SWITCHES_PER_ROUND; step += 1) {
      const fan = FANS[step % FANS.length] ?? a1;
      await callStand('openChat', ACC, fan);
      if (!ours) continue;
      if (step % 10 === 9) {
        try {
          await dockIs((d) => d.target?.endsWith(`:${fan}`) === true && d.status === 'ready', `the dock of chat ${fan}`, 5000);
        } catch (error) {
          // What the page itself says at that moment: a dock that stays «copy only» over a composer that is there is a finding of its own.
          throw new Error(
            `${String(error).slice(0, 400)} — step ${step}: composers ${JSON.stringify(await callStand('composers'))}, route ${JSON.stringify(await callStand('route'))}, the page is ${await browser.execute(() => document.visibilityState)}`,
            { cause: error },
          );
        }
      }
    }
    await callStand('openChat', ACC, a1);
    await waitForChatReady(ACC, a1);
    if (ours) await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'the dock after the switches');
  };
  /** One round of work: chat switches, then our windows opened and closed. */
  const round = async (): Promise<void> => {
    await switches(true);
    for (let cycle = 0; cycle < OVERLAYS_PER_ROUND; cycle += 1) {
      await leaveField();
      switch (cycle % 4) {
        case 0:
          await browser.keys([...PANEL, 'm']);
          await waitOursText('modal', 'Fan Alder', 'the board', { timeout: 20_000, selector: '.cg-sp' });
          break;
        case 1:
          await browser.keys([MOD, 'k']);
          await browser.waitUntil(() => oursExists('modal', '.cg-pal__item'), { timeout: 10_000, timeoutMsg: 'the palette did not open' });
          break;
        case 2:
          await browser.keys([']']);
          await waitOursText('panel', 'Fan Alder', 'the fan panel');
          break;
        default:
          await browser.keys(['?']);
          await browser.waitUntil(() => oursExists('modal', '.cg-cs'), { timeout: 10_000, timeoutMsg: 'the cheatsheet did not open' });
      }
      await closeAll();
    }
    expect((await dockIs(() => true, 'the dock')).overlays).toEqual([]);
  };

  before(async () => {
    await (browser as unknown as Gecko).setTimeout({ script: 120_000 });
    await standServer.reset();
  });

  after(() => {
    mkdirSync(E2E_EVIDENCE_DIR, { recursive: true });
    const text = `${JSON.stringify({ limits: LIMITS, ...report }, null, 2)}\n`;
    writeFileSync(`${E2E_EVIDENCE_DIR}perf.json`, text);
    process.stdout.write(`perf (.cache/e2e/perf.json):\n${text}`);
  });

  it('memory: what the extension adds to the tab, what its event page takes, and the growth per round of work', async function () {
    this.timeout(900_000);
    // The stand's tab alone: just opened, and after the switches of one round.
    await browser.browsingContextSetViewport({ context: await browser.getWindowHandle(), viewport: { width: 1440, height: 900 } });
    await openStand(chatPath(ACC, a1));
    await waitForChatReady(ACC, a1);
    for (const fan of [a2, a4, a1]) await callStand('openChat', ACC, fan);
    await waitForChatReady(ACC, a1);
    const alone = await snapshot();
    await switches(false);
    const aloneWorked = await snapshot();
    expect(alone.tab).not.toBeNull();
    expect(aloneWorked.tab).not.toBeNull();

    // The same tab with the extension at work. The first tab becomes the extension's quiet page; the stand opens in a second one.
    await startShift(hub(), { viewport: { width: 1440, height: 900 } });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
    for (const fan of [a2, a4, a1]) await callStand('openChat', ACC, fan);
    await waitForChatReady(ACC, a1);
    await dockIs((d) => d.target?.endsWith(`:${a1}`) === true && d.status === 'ready', 'the dock of chat a1');
    const withUs = await snapshot();
    expect(withUs.tab).not.toBeNull();
    expect(withUs.extension).not.toBeNull();

    const rounds: Snapshot[] = [];
    for (let index = 0; index < ROUNDS; index += 1) {
      await round();
      rounds.push(await snapshot());
    }
    const worked = rounds[0] ?? withUs;

    const explicitOf = (shot: Snapshot): number => shot.tab?.explicit ?? 0;
    // Just opened: the dock and its controllers. After a round: every window of ours has been open once, every lazy chunk is in.
    const overhead = { opened: mb(explicitOf(withUs) - explicitOf(alone)), worked: mb(explicitOf(worked) - explicitOf(aloneWorked)) };
    const growth = rounds.map((after, index) => {
      const before = index === 0 ? withUs : rounds[index - 1];
      return { tabExplicitMB: mb(explicitOf(after) - (before === undefined ? 0 : explicitOf(before))), oursMB: mb((after.tab?.ours ?? 0) - (before?.tab?.ours ?? 0)) };
    });
    const documents = Object.fromEntries(Object.entries(withUs.extension?.documents ?? {}).map(([page, bytes]) => [page, mb(bytes)]));
    const eventPage = Object.entries(rounds.at(-1)?.extension?.documents ?? {}).find(([page]) => page.includes('background'));
    const eventPageMB = mb(eventPage?.[1] ?? 0);
    report['memory'] = {
      tabAloneMB: { opened: mb(explicitOf(alone)), worked: mb(explicitOf(aloneWorked)), footprint: mb(aloneWorked.tab?.footprint ?? 0) },
      tabWithExtensionMB: { opened: mb(explicitOf(withUs)), worked: mb(explicitOf(worked)), footprint: mb(worked.tab?.footprint ?? 0), contentScripts: mb(worked.tab?.ours ?? 0) },
      tabOverheadMB: overhead,
      extensionProcessMB: {
        explicit: mb(withUs.extension?.explicit ?? 0),
        footprint: mb(withUs.extension?.footprint ?? 0),
        documents,
        parts: Object.fromEntries(Object.entries(withUs.extension?.parts ?? {}).map(([part, bytes]) => [part, mb(bytes)])),
        afterRounds: { explicit: mb(rounds.at(-1)?.extension?.explicit ?? 0), footprint: mb(rounds.at(-1)?.extension?.footprint ?? 0), eventPage: eventPageMB },
      },
      rounds: rounds.map((after, index) => ({ tabExplicitMB: mb(explicitOf(after)), contentScriptsMB: mb(after.tab?.ours ?? 0), footprintMB: mb(after.tab?.footprint ?? 0), growth: growth[index] })),
      perRound: { switches: SWITCHES_PER_ROUND, overlays: OVERLAYS_PER_ROUND },
    };

    expect(['tab overhead after a round, MB', overhead.worked <= LIMITS.tabOverheadMB]).toEqual(['tab overhead after a round, MB', true]);
    // «фон ≤ 30 МБ» is the event page's own document; the process around it carries Firefox's own tens of megabytes.
    expect(['the event page, MB', eventPage !== undefined && eventPageMB <= LIMITS.backgroundMB]).toEqual(['the event page, MB', true]);
    // The first round loads every lazy chunk and warms the caches; the growth that counts is what comes after it.
    for (const [index, each] of growth.entries()) {
      if (index === 0) continue;
      expect([`round ${index + 1}`, each.tabExplicitMB <= LIMITS.growthPerRoundMB, each.oursMB <= LIMITS.growthPerRoundMB]).toEqual([`round ${index + 1}`, true, true]);
    }
  });

  it('idle: a minute of an open chat nobody touches — CPU of the tab and of the extension, calls to the hub, calls to ChatSpace', async function () {
    this.timeout(300_000);
    await dockIs((d) => d.status === 'ready', 'the dock');
    // What the last actions started has ended.
    await browser.pause(3000);
    const standMark = await standServer.mark();
    const hubMark = await hub().mark();
    const before = await snapshot();
    await browser.pause(IDLE_MS);
    const procs = await inChrome<Array<{ pid: number; cpuMs: number }>>(
      `const info = await ChromeUtils.requestProcInfo(); return info.children.map((child) => ({ pid: child.pid, cpuMs: Number(child.cpuTime) / 1e6 }));`,
    );
    const cpuOf = (pid: number | undefined): number => procs.find((proc) => proc.pid === pid)?.cpuMs ?? 0;
    const tabCpu = Math.round(cpuOf(before.tab?.pid) - (before.tab?.cpuMs ?? 0));
    const extensionCpu = Math.round(cpuOf(before.extension?.pid) - (before.extension?.cpuMs ?? 0));
    const hubCalls = (await hub().journal(hubMark)).entries.map((call) => String(call.route));
    const foreign = foreignCalls((await standServer.journal(standMark)).entries);
    report['idle'] = { ms: IDLE_MS, tabCpuMs: tabCpu, extensionCpuMs: extensionCpu, hubCalls, foreignCallsToStand: foreign.length };

    expect(foreign).toEqual([]);
    expect(['hub calls', hubCalls.length <= LIMITS.idleHubCalls]).toEqual(['hub calls', true]);
    expect(['tab CPU, ms', tabCpu <= LIMITS.idleCpuMs]).toEqual(['tab CPU, ms', true]);
    expect(['extension CPU, ms', extensionCpu <= LIMITS.idleCpuMs]).toEqual(['extension CPU, ms', true]);
  });
});
