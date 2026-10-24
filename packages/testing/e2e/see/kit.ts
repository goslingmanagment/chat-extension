// `pnpm see` (tools/see/README.md): the kit of a «show me» scenario — the TEST build on the stand against the fake
// hub, a shift started, and a handful of verbs that press our buttons and photograph the tab. Not a test: nothing
// here asserts; a scenario fails only when a step cannot be done, and leaves its pictures and the extension's own
// reports in CG_SEE_OUT either way. The CI suite never runs these files (wdio.conf.ts names e2e/specs only).
//
//   import { scenario } from '../kit';
//   scenario('reply', async (s) => {
//     await s.ready();
//     await s.press(/^Reply/);
//     await s.done();
//     await s.shot('reply');
//   });

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { JOURNAL_KINDS, type SettingsV1 } from '@cg/contracts';
import { $, browser } from '@wdio/globals';
import { Key } from 'webdriverio';

import { fakeHubControl, type FakeHubControlClient } from '../../src/fake-hub/control-client';
import { describeCalls, journalViolations } from '../../src/fake-hub/journal';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { MOD, PANEL, typeDraft } from '../support/chat';
import { E2E_ADDON_UUID } from '../support/constants';
import { readReport, type DockReport, type SpikeReport } from '../support/extension';
import { fakeHubOrigin } from '../support/fake-hub';
import { setFanslyNeighbor } from '../support/fansly-neighbor';
import { startFanslyShift } from '../support/fansly-shift';
import { fakeFansly } from '../support/fansly-stand';
import { allOurs, ours, oursExists, oursText, pressOurs, readOurs, waitOursByText, waitOursText, type Where } from '../support/ours';
import { dockIs, startShift, type ShiftOptions } from '../support/shift';
import { callStand, STAND_IDS, standServer, waitForChatReady } from '../support/stand';
import { fanslyWrites, LIVE, netRecords, startLiveShift, type NetRecord } from './live';
import { makeSite, type SiteVerbs } from './site';

export type Site = 'chatspace' | 'fansly';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
/** Where this run's pictures and reports go (the CLI makes a folder per run). */
export const OUT = process.env['CG_SEE_OUT'] ?? join(REPO_ROOT, '.cache/see/manual');
const STARTED = Date.now();

/** A line the CLI shows: what happened, seconds since the run began. */
export function lap(label: string): void {
  console.log(`cg-see ${label} +${((Date.now() - STARTED) / 1000).toFixed(1)}s`);
}

/**
 * What the fake hub's model writes in a `see` run, so the pictures read like a real shift and a wait knows what to
 * wait for. The Review's section labels (ВЕРДИКТ, ДЕНЬГИ, ПЕРСОНА, ОШИБКИ, «Как надо было», ЧТО РАБОТАЕТ) are the hub's
 * output format that core/domain/output/review.ts parses, so they stay as the hub writes them.
 */
export const SEE_AI_TEXTS: Readonly<Record<string, string>> = {
  'fast-reply': 'good morning, my traveler ☀️ how was the flight? [NEXT] I just woke up and saw your messages… you made me smile before my coffee 🙈 [NEXT] the set is still waiting for you 😏 want me to send it now, or do you want to guess what’s inside first?',
  'hi-greeting': 'hey you 👋 so glad you’re here! tell me one thing about your day [VARIANT] welcome, handsome ☺️ I was hoping you’d come by — what brought you to me? [VARIANT] hi! I’m Lora 💛 I read every message myself, so say hi back',
  'improve-draft': 'I missed you so much today 🥺 tell me everything — how was the flight?',
  ping: 'still thinking about what you said yesterday… are you around? 😌',
  'fan-summary': '## Who he is\nHubert, 34, flies a lot for work. Answers in the evening, Warsaw time.\n\n## What he bought\n- the «Morning» set for $25, yesterday\n- two paid messages at $12 last week\n\n## What he answers to\n- questions about trips and coffee\n- short messages, no pressure\n\n## What to avoid\n- long texts and discounts in the first message',
  'chat-review':
    '<rating>7</rating><evaluation>ВЕРДИКТ: the conversation is alive, but the set was pitched too early.\n\nДЕНЬГИ: $25 yesterday, no second set offered.\n\nПЕРСОНА: warm tone, in character; one message is too long.\n\nОШИБКИ:\n1. Offered the set as the first message of the morning. Как надо было: ask about the flight first, then a teaser.\n2. Did not answer the question about coffee.\n\nЧТО РАБОТАЕТ: short questions about the trip, emoji in moderation.</evaluation><recommendations>1. Open with a question about the flight.\n2. The set teaser as the second message.\n3. Come back to the coffee joke.</recommendations>',
  'coach-chat':
    'Yes, but not as the first message. He brought up the set himself — use that: the flight first, then a teaser.\n\n```draft\nhow was the flight, my traveler? ☀️ [NEXT] you remembered the set 🙈 there is a second part… even cuter. want a little peek first?\n```',
};

export interface SeeOptions {
  /** The sites it runs on; the first is the default, `--site` picks another of them. */
  readonly sites?: readonly Site[];
  /** The window of the chat tab (default 1440 × 900, the mockup's). */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Settings on top of the defaults (ChatSpace: any section; Fansly: `generation`). */
  readonly settings?: ShiftOptions['settings'];
  /** X8: the owner's `previewSend` switch on the fake hub (ChatSpace). */
  readonly previewSend?: boolean;
  /** The fake hub's own synthetic AI texts instead of the mockup's. */
  readonly hubTexts?: true;
  /** Before the shift starts: script the fake hub or the stand (`s.hub.command(...)`, `s.stand`). */
  readonly before?: (s: Pick<See, 'hub' | 'site' | 'stand'>) => Promise<void>;
  /** Fansly: the group the shift opens first (default the stand's first chat, 90 messages). */
  readonly fanslyGroup?: string;
  /** The scenario's own time limit (default 3 minutes). */
  readonly timeout?: number;
}

/** What a scenario (and a held session's `pnpm see:do`) works with. */
export interface See {
  readonly site: Site;
  readonly out: string;
  readonly browser: WebdriverIO.Browser;
  /** The fake hub's control API: `command({ op: 'config', patch: { aiTexts } })`, `journal()`, `status()`. */
  readonly hub: FakeHubControlClient;
  /** The ChatSpace stand server's control API (fan messages, socket frames, journal). */
  readonly stand: typeof standServer;
  /** Saves `NN-name.png` of what the tab in front shows (once it stands still); returns its path. */
  shot(name: string): Promise<string>;
  /** The dock of the open chat is ready: Reply is on. Its report; null with --live (the real site gets none). */
  ready(timeout?: number): Promise<DockReport | null>;
  /** Presses a button of ours by its text — the dock's strip by default (`s.press(/^Reply/, 'modal', '.cg-pv button')`); the extension's UI speaks Russian, so most labels are matched in Russian. */
  press(text: string | RegExp, where?: Where, selector?: string): Promise<void>;
  /** The generation started by the last press ended (done, failed, canceled); returns the dock. With --live: the dock stood still for 1.5 s; null. */
  done(timeout?: number): Promise<DockReport | null>;
  /** What the dock shows now (the test build's own report). */
  dock(): Promise<DockReport | null>;
  /** The test build's whole report of the tab (dock, timings, toasts, errors). */
  report(): Promise<SpikeReport | null>;
  /** Waits until a surface of ours shows the text; returns all it shows. */
  see(where: Where, text: string | RegExp, timeout?: number): Promise<string>;
  /** The text a surface of ours shows ('' — nothing there). */
  text(where?: Where, selector?: string): Promise<string>;
  /** Whether something of ours matches the selector now. */
  has(where: Where, selector: string): Promise<boolean>;
  /** Keys as a person presses them together: `s.keys(s.MOD, 'k')`; `s.keys('hello')` types. */
  keys(...keys: string[]): Promise<void>;
  /** ChatSpace: clicks into the open chat's message field and types. */
  type(text: string): Promise<void>;
  /** ChatSpace: the focus off the message field (on the chat's header), so our single-key hotkeys reach us. */
  leaveField(): Promise<void>;
  /** ChatSpace: opens another chat of account a (`s.ids.fans.a2`); `newTab` — in a new ChatSpace tab. */
  openChat(fanId: string, newTab?: boolean): Promise<void>;
  /** The extension's own pages tab (popup, settings: `s.browser.url(s.page('popup.html'))`) / back to the chat. */
  toPages(): Promise<void>;
  toChat(): Promise<void>;
  /** An extension page's address (`popup.html`, `options.html#status`). */
  page(path: string): string;
  /** A request of the page protocol from the extension page (`settings.patch`, `diagnostics.get`). */
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
  /** Escape until no window of ours is open. */
  closeAll(): Promise<void>;
  wait(ms: number): Promise<void>;
  /** The page's console so far. */
  readonly console: readonly ConsoleEntry[];
  /** --live: the page's requests and socket frames so far, with bodies (live.ts `NetRecord`); [] on the stand. */
  readonly net: readonly NetRecord[];
  /** The site itself, not our UI: clicks by text, fields, files, Fansly's API, the traffic cut and saved (site.ts). */
  readonly web: SiteVerbs;
  readonly MOD: string;
  readonly PANEL: readonly string[];
  readonly Key: typeof Key;
  readonly ids: typeof STAND_IDS;
  readonly world: typeof WORLD;
  /** The e2e helpers behind the verbs, for anything they do not cover (e2e/support/*). */
  readonly h: {
    readonly ours: typeof ours;
    readonly allOurs: typeof allOurs;
    readonly oursExists: typeof oursExists;
    readonly oursText: typeof oursText;
    readonly readOurs: typeof readOurs;
    readonly pressOurs: typeof pressOurs;
    readonly waitOursText: typeof waitOursText;
    readonly dockIs: typeof dockIs;
    readonly callStand: typeof callStand;
    readonly fakeFansly: typeof fakeFansly;
    readonly $: typeof $;
  };
}

export interface ConsoleEntry {
  readonly level: string;
  readonly text: string | null;
  readonly source: string | null;
}

interface ShotNote {
  readonly file: string;
  readonly name: string;
  readonly seconds: number;
  readonly dock: string | null;
}

const ADDON_PAGE = 'moz-extension://';

/** Which site this run is on: `--site` (CG_SEE_SITE), else the scenario's first. */
function pickSite(options: SeeOptions): Site {
  const sites = options.sites ?? ['chatspace'];
  const wanted = process.env['CG_SEE_SITE'];
  if (wanted === undefined || wanted === '') return sites[0] ?? 'chatspace';
  if (wanted !== 'chatspace' && wanted !== 'fansly') throw new Error(`CG_SEE_SITE: «${wanted}» is neither chatspace nor fansly`);
  if (!sites.includes(wanted)) throw new Error(`this scenario runs on ${sites.join(', ')}, not on ${wanted}`);
  if (LIVE && wanted !== 'fansly') throw new Error('--live is Fansly\'s only (the test model on fansly.com)');
  return wanted;
}

/** One line about the dock, for a picture's caption. */
function dockLine(dock: DockReport | undefined): string | null {
  if (dock === undefined) return null;
  const parts = [`dock ${dock.status}`];
  if (dock.result !== null) parts.push(`${dock.result.feature} ${dock.result.state}${dock.result.error === null ? '' : ` (${dock.result.error})`}`);
  if (dock.analysis !== null) parts.push(`sheet ${dock.analysis}`);
  if (dock.banner !== null) parts.push(`banner ${dock.banner}`);
  if (dock.overlays.length > 0) parts.push(`over: ${dock.overlays.join(', ')}`);
  return parts.join(' · ');
}

const write = (name: string, value: unknown): void => {
  try {
    writeFileSync(join(OUT, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    console.log(`cg-see could not write ${name}: ${String(error)}`);
  }
};

/** A tab's picture once two in a row are the same (a window fading in is not caught half-way); at most `settleMs` of waiting. */
async function stillPicture(settleMs = 800): Promise<string> {
  let last = await browser.takeScreenshot();
  const until = Date.now() + settleMs;
  while (Date.now() < until) {
    await browser.pause(120);
    const next = await browser.takeScreenshot();
    if (next === last) break;
    last = next;
  }
  return last;
}

/**
 * Frames of the tab in front, taken over BiDi beside whatever the scenario does (for `--gif` and the session's live
 * view). A frame that cannot be taken (an extension page refuses BiDi's screenshot) is skipped.
 */
export function recordFrames(everyMs: number, onFrame: (png: Buffer) => void): { stop(): Promise<void>; follow(context: string): void } {
  let context: string | null = null;
  let stopped = false;
  let busy: Promise<void> = Promise.resolve();
  const tick = async (): Promise<void> => {
    if (context === null) return;
    try {
      const { data } = await browser.browsingContextCaptureScreenshot({ context });
      onFrame(Buffer.from(data, 'base64'));
    } catch {
      // a privileged page, or the tab went away under us
    }
  };
  const timer = setInterval(() => {
    if (stopped) return;
    busy = busy.then(tick);
  }, everyMs);
  return {
    follow(next) {
      context = next;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await busy;
    },
  };
}

/**
 * The mocha wiring of one run: the fake hub reset, the shift started on the site, the console recorded; at the end
 * the test build's report, its diagnostics and journals, the hub's calls and the shots' notes are written to OUT.
 * A call the fake hub says the client must never make is written down (violations.txt), not failed on.
 */
export function useSee(options: SeeOptions = {}): { readonly see: () => See } {
  const site = pickSite(options);
  const hub = fakeHubControl(fakeHubOrigin());
  const logs: ConsoleEntry[] = [];
  const notes: ShotNote[] = [];
  let made: See | null = null;
  let hubSince = 0;
  let count = 0;
  let frames: ReturnType<typeof recordFrames> | null = null;

  before(async function (this: Mocha.Context) {
    this.timeout(120_000);
    mkdirSync(OUT, { recursive: true });
    lap(`site ${site}, out ${OUT}`);
    await browser.sessionSubscribe({ events: ['log.entryAdded'] });
    browser.on('log.entryAdded', (entry) => logs.push({ level: entry.level, text: entry.text, source: entry.source?.context ?? null }));
    await hub.command({ op: 'reset' });
    hubSince = await hub.mark();
    if (!LIVE) await standServer.reset();
    if (site === 'fansly' && !LIVE) {
      await setFanslyNeighbor(null);
      await fakeFansly().command({ op: 'reset' });
    }
    if (options.hubTexts !== true) await hub.command({ op: 'config', patch: { aiTexts: SEE_AI_TEXTS } });
    await options.before?.({ hub, site, stand: standServer });
    const viewport = options.viewport ?? { width: 1440, height: 900 };
    let toChat: () => Promise<void>;
    let toPages: () => Promise<void>;
    let rpc: See['rpc'];
    if (LIVE) {
      const generation = options.settings?.generation as Partial<SettingsV1['generation']> | undefined;
      const group = process.env['CG_SEE_LIVE_GROUP'];
      const shift = await startLiveShift(hub, { viewport, bare: process.env['CG_SEE_LIVE_BARE'] === '1', ...(group === undefined || group === '' ? {} : { group }), ...(generation === undefined ? {} : { generation }) });
      toChat = () => shift.toFansly();
      toPages = () => shift.toPages();
      rpc = (type, payload) => shift.rpc(type, payload);
    } else if (site === 'fansly') {
      // Fansly's shift takes the generation section only, as whole sub-sections.
      const generation = options.settings?.generation as Partial<SettingsV1['generation']> | undefined;
      const shift = await startFanslyShift(hub, { path: `/messages/${options.fanslyGroup ?? WORLD.fansly.chats.a.group}`, viewport, ...(generation === undefined ? {} : { settings: { generation } }) });
      toChat = () => shift.toFansly();
      toPages = () => shift.toPages();
      rpc = (type, payload) => shift.rpc(type, payload);
    } else {
      const shift = await startShift(hub, { viewport, ...(options.settings === undefined ? {} : { settings: options.settings }), ...(options.previewSend === true ? { previewSend: true } : {}) });
      toChat = () => shift.toStand();
      toPages = () => shift.toPages();
      rpc = (type, payload) => shift.rpc(type, payload);
    }
    // The extension's own documents take no viewport override: the window itself is sized for them.
    await browser.setWindowSize(viewport.width, viewport.height + 85);
    lap('shift started');
    if (process.env['CG_SEE_GIF'] === '1') {
      mkdirSync(join(OUT, 'frames'), { recursive: true });
      // Named by the milliseconds since the run began: the GIF keeps their timing.
      frames = recordFrames(250, (png) => writeFileSync(join(OUT, 'frames', `f${String(Date.now() - STARTED).padStart(7, '0')}.png`), png));
      frames.follow(await browser.getWindowHandle());
    }
    made = makeSee({ site, hub, logs, toChat, toPages, rpc, frames, nextNumber: () => (count += 1), note: (entry) => notes.push(entry) });
  });

  afterEach(async function (this: Mocha.Context) {
    if (this.currentTest?.state !== 'failed') return;
    write('error.txt', `${this.currentTest.fullTitle()}\n\n${this.currentTest.err?.stack ?? String(this.currentTest.err)}\n`);
    try {
      writeFileSync(join(OUT, '99-failed.png'), Buffer.from(await browser.takeScreenshot(), 'base64'));
      notes.push({ file: '99-failed.png', name: 'failed', seconds: (Date.now() - STARTED) / 1000, dock: dockLine((await readReport())?.dock) });
    } catch {
      // the browser is gone
    }
  });

  after(async function (this: Mocha.Context) {
    this.timeout(60_000);
    await frames?.stop();
    write('shots.json', notes);
    write('console.json', logs);
    if (LIVE) write('writes.json', fanslyWrites);
    if (LIVE) write('net.json', netRecords);
    try {
      write('report.json', await readReport());
    } catch (error) {
      write('report.json', { error: String(error) });
    }
    try {
      const calls = (await hub.journal(hubSince)).entries;
      write('hub-calls.json', calls);
      const violations = journalViolations(calls);
      if (violations.length > 0) {
        write('violations.txt', describeCalls(violations));
        lap(`fake hub: ${violations.length} call(s) the client must never make — violations.txt`);
      }
    } catch (error) {
      write('hub-calls.json', { error: String(error) });
    }
    try {
      const egress = (await standServer.egress(0)).attempts;
      if (egress.length > 0) write('egress.json', egress);
    } catch {
      // no stand
    }
    if (made !== null) {
      const diagnostics = await made.rpc('diagnostics.get').catch((error: unknown) => ({ error: String(error) }));
      write('diagnostics.json', diagnostics);
      // The debug journals (records only while debug mode is on, or after a failure): written when there is something.
      const journals: Record<string, unknown> = {};
      for (const journal of JOURNAL_KINDS) {
        const read = await made.rpc<{ records: readonly unknown[] }>('journal.read', { journal, limit: 200 }).catch((error: unknown) => ({ ok: false as const, error: { code: String(error) } }));
        if (!read.ok || read.payload.records.length > 0) journals[journal] = read.ok ? read.payload.records : read.error;
      }
      if (Object.keys(journals).length > 0) write('journals.json', journals);
    }
    lap('saved');
  });

  return {
    see: () => {
      if (made === null) throw new Error('the shift did not start (see the error above)');
      return made;
    },
  };
}

interface Parts {
  readonly site: Site;
  readonly hub: FakeHubControlClient;
  readonly logs: readonly ConsoleEntry[];
  readonly toChat: () => Promise<void>;
  readonly toPages: () => Promise<void>;
  readonly rpc: See['rpc'];
  readonly frames: ReturnType<typeof recordFrames> | null;
  readonly nextNumber: () => number;
  readonly note: (entry: ShotNote) => void;
}

function makeSee(parts: Parts): See {
  const { site } = parts;
  let lastOp: string | null = null;
  const chatSpaceOnly = (what: string): void => {
    if (site !== 'chatspace') throw new Error(`s.${what}() is ChatSpace's (this run is on ${site})`);
  };
  const follow = async (): Promise<void> => parts.frames?.follow(await browser.getWindowHandle());
  const see: See = {
    site,
    out: OUT,
    browser,
    hub: parts.hub,
    stand: standServer,
    async shot(name) {
      const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'shot';
      const file = `${String(parts.nextNumber()).padStart(2, '0')}-${safe}.png`;
      const onPage = (await browser.getUrl()).startsWith(ADDON_PAGE);
      const png = await stillPicture();
      writeFileSync(join(OUT, file), Buffer.from(png, 'base64'));
      const dock = onPage ? null : dockLine((await readReport())?.dock);
      parts.note({ file, name, seconds: (Date.now() - STARTED) / 1000, dock });
      lap(`shot ${file}${dock === null ? '' : ` — ${dock}`}`);
      return join(OUT, file);
    },
    // The real site gets no report of ours (composition/tab/probe.ts): --live reads the dock as a person does.
    ready: async (timeout = 20_000) => {
      if (!LIVE) return dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock is ready (Reply on)', timeout);
      await waitOursByText('dock', '.cg-strip button', /^Reply/, 'the dock is ready (Reply)', timeout);
      return null;
    },
    async press(text, where = 'dock', selector) {
      if (where === 'dock' && selector === undefined) lastOp = (await readReport())?.dock?.result?.opId ?? null;
      await pressOurs(where, selector ?? (where === 'dock' ? '.cg-strip button' : 'button'), text);
    },
    async done(timeout = 30_000) {
      if (LIVE) {
        let last = '';
        let still = Date.now();
        await browser.waitUntil(
          async () => {
            const now = await oursText('dock');
            if (now !== last) [last, still] = [now, Date.now()];
            return Date.now() - still >= 1500;
          },
          { timeout, interval: 300, timeoutMsg: 'the dock did not stand still' },
        );
        lap('result: the dock stands still');
        return null;
      }
      const dock = await dockIs((d) => d.result !== null && d.result.opId !== lastOp && ['done', 'failed', 'canceled', 'interrupted'].includes(d.result.state), 'the generation ended', timeout);
      lastOp = dock.result?.opId ?? lastOp;
      lap(`result ${dock.result?.feature ?? '?'} ${dock.result?.state ?? '?'}${dock.result?.error ? ` (${dock.result.error})` : ''}`);
      return dock;
    },
    dock: async () => (await readReport())?.dock ?? null,
    report: () => readReport(),
    see: (where, text, timeout = 20_000) => waitOursText(where, text, `${where} shows «${String(text)}»`, { timeout }),
    text: (where = 'dock', selector) => oursText(where, selector),
    has: (where, selector) => oursExists(where, selector),
    async keys(...keys) {
      // One word that names no key (`Escape`, `Enter` do) is typed letter by letter.
      const [one] = keys;
      await browser.keys(keys.length === 1 && one !== undefined && one.length > 1 && !(one in Key) ? one.split('') : keys);
    },
    async type(text) {
      chatSpaceOnly('type');
      await typeDraft(text);
    },
    async leaveField() {
      chatSpaceOnly('leaveField');
      await $('[data-stand-conversation-header]').click();
    },
    async openChat(fanId, newTab = false) {
      chatSpaceOnly('openChat');
      await callStand('openChat', STAND_IDS.accounts.a, fanId, newTab ? { newTab: true } : {});
      await waitForChatReady(STAND_IDS.accounts.a, fanId);
      await dockIs((d) => d.visible && d.target?.endsWith(`:${fanId}`) === true, `the dock of chat ${fanId}`);
    },
    async toPages() {
      await parts.toPages();
      await follow();
    },
    async toChat() {
      await parts.toChat();
      await follow();
    },
    page: (path) => `moz-extension://${E2E_ADDON_UUID}/${path}`,
    rpc: (type, payload) => parts.rpc(type, payload),
    async closeAll() {
      for (let press = 0; press < 6 && ((await oursExists('modal', '.cg-root')) || (await oursExists('panel', '.cg-root'))); press += 1) {
        await browser.keys(Key.Escape);
        await browser.pause(200);
      }
    },
    wait: (ms) => browser.pause(ms),
    get console() {
      return parts.logs;
    },
    net: netRecords,
    web: makeSite(OUT),
    MOD,
    PANEL,
    Key,
    ids: STAND_IDS,
    world: WORLD,
    h: { ours, allOurs, oursExists, oursText, readOurs, pressOurs, waitOursText, dockIs, callStand, fakeFansly, $ },
  };
  return see;
}

/** One «show me» scenario: a shift on the stand, then `body` with the verbs of `See`. */
export function scenario(title: string, body: (s: See) => Promise<void>, options: SeeOptions = {}): void {
  describe(`see: ${title}`, () => {
    const run = useSee(options);
    it(title, async function (this: Mocha.Context) {
      this.timeout(options.timeout ?? 180_000);
      await body(run.see());
      lap('done');
    });
  });
}

/** The hub page the stand's ChatSpace account is bound to (for `s.hub.command({ op: 'audienceEvent', pageLabel: … })`). */
export const STAND_PAGE = PAGE;
