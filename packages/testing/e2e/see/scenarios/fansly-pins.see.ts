// Fansly: temporary chat pins over Fansly's own list of chats (2026-11-12). Sofia Lane's inbox in the showcase world:
// a row's pin button on hover, a pin from a row (its mark at once, the strip only once the pointer left the list), a
// second from the header, a scroll far down and back, a fan's message in a pinned chat (the dot), a new chat on top, a
// chip clicked, a search (Fansly's spinner under the strip), three pins idle, a second tab unpinning while the pointer
// is in the strip (the placeholder, then its place closes), the light theme, 1100 px wide, 768 px high, the marks and
// the pins each off on their own, the switch off and on, an expired pin, a reload, the last unpin.
//
// The measured checks of the plan (A1–A9, .cache/pins-arena/plan-final.md §4) go to `pins-measures.json` in the run's
// folder: the numbers, not a verdict alone. What the stand cannot show is said there too (`stand`).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser } from '@wdio/globals';

import { readLocalStorage, readReport, writeLocalStorage } from '../../support/extension';
import { FANSLY_MAIN, callFansly, fanslyStandUrl, waitForFanslyStandReady } from '../../support/fansly-stand';
import { openOptions, waitForOptions } from '../../support/pages';
import { around, lap, scenario, type Box, type See } from '../kit';

const LIST = '.messages-list-wrapper';
const SLOT = '[data-host="inbox-slot"]';
const HEADER_PIN = '[data-host="header-slot"][data-header-order="5"]';
const rowOf = (group: string): string => `${LIST} a[href="/messages/${group}"]`;
const buttonOf = (group: string): string => `${rowOf(group)} [data-cg-inbox="row"] button`;

interface Geometry {
  readonly scTop: number;
  readonly scHeight: number;
  readonly scrollTop: number;
  readonly spacers: readonly number[];
  readonly strip: Box | null;
  readonly rows: number;
  readonly blank: number;
  readonly path: string;
}

/** The scroller, its spacers, our strip's box, the blank band of the visible list (0 at the list's end). */
async function geometry(): Promise<Geometry> {
  return browser.execute(() => {
    const list = document.querySelector('.messages-list-wrapper .message-list') as HTMLElement | null;
    const host = document.querySelector('[data-host="inbox-slot"]');
    const box = (node: Element): { x: number; y: number; width: number; height: number } => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    };
    if (list === null) return { scTop: -1, scHeight: -1, scrollTop: -1, spacers: [], strip: host === null ? null : box(host), rows: 0, blank: 0, path: location.pathname };
    const r = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('a[href^="/messages/"]')].map((row) => row.getBoundingClientRect()).filter((rect) => rect.height > 0);
    const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
    const top = rows.length === 0 ? r.bottom : Math.min(...rows.map((rect) => rect.top));
    const bottom = rows.length === 0 ? r.top : Math.max(...rows.map((rect) => rect.bottom));
    const blank = Math.max(0, top - r.top) + (atEnd ? 0 : Math.max(0, r.top + list.clientHeight - bottom));
    return {
      scTop: r.top,
      scHeight: list.clientHeight,
      scrollTop: list.scrollTop,
      spacers: [...list.querySelectorAll(':scope > .spacer')].map((node) => Number.parseFloat((node as HTMLElement).style.height) || 0),
      strip: host === null ? null : box(host),
      rows: rows.length,
      blank,
      path: location.pathname,
    };
  });
}

/** Frames of the list in the page, from now until `ms` later: the scroller's top, the blank band, the strip's height. */
async function startFrames(ms: number): Promise<void> {
  await browser.execute((limit: number) => {
    const frames: Array<{ t: number; scTop: number; blank: number; strip: number }> = [];
    (window as unknown as Record<string, unknown>)['__cgFrames'] = frames;
    const t0 = performance.now();
    const tick = (): void => {
      const list = document.querySelector('.messages-list-wrapper .message-list') as HTMLElement | null;
      const host = document.querySelector('[data-host="inbox-slot"]');
      if (list !== null) {
        const r = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll('a[href^="/messages/"]')].map((row) => row.getBoundingClientRect()).filter((rect) => rect.height > 0);
        const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        const top = rows.length === 0 ? r.bottom : Math.min(...rows.map((rect) => rect.top));
        const bottom = rows.length === 0 ? r.top : Math.max(...rows.map((rect) => rect.bottom));
        frames.push({ t: Math.round(performance.now() - t0), scTop: r.top, blank: Math.max(0, top - r.top) + (atEnd ? 0 : Math.max(0, r.top + list.clientHeight - bottom)), strip: host?.getBoundingClientRect().height ?? 0 });
      }
      if (performance.now() - t0 < limit) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readFrames(): Promise<Array<{ t: number; scTop: number; blank: number; strip: number }>> {
  return browser.execute(() => ((window as unknown as Record<string, unknown>)['__cgFrames'] ?? []) as Array<{ t: number; scTop: number; blank: number; strip: number }>);
}

/** What a run of frames says: the top's whole move, whether it went one way only, the largest blank band, the moves after it settled. */
function motion(frames: ReadonlyArray<{ scTop: number; blank: number }>): { from: number; to: number; monotonic: boolean; maxBlank: number; steps: number } {
  const tops = frames.map((frame) => frame.scTop);
  const first = tops[0] ?? 0;
  const last = tops[tops.length - 1] ?? 0;
  const up = last >= first;
  let monotonic = true;
  let steps = 0;
  for (let i = 1; i < tops.length; i += 1) {
    const step = (tops[i] ?? 0) - (tops[i - 1] ?? 0);
    if (step !== 0) steps += 1;
    if ((up && step < -0.01) || (!up && step > 0.01)) monotonic = false;
  }
  return { from: first, to: last, monotonic, maxBlank: Math.max(0, ...frames.map((frame) => frame.blank)), steps };
}

/** Our mutations of the page under the list (nodes of ours added, removed or restyled) and our strip's host put in again. */
async function startMutations(): Promise<void> {
  await browser.execute(() => {
    const wrapper = document.querySelector('.messages-list-wrapper');
    const state = { ours: 0, hostPlaced: 0, observer: null as MutationObserver | null };
    const old = (window as unknown as Record<string, { observer: MutationObserver | null } | undefined>)['__cgMut'];
    old?.observer?.disconnect();
    (window as unknown as Record<string, unknown>)['__cgMut'] = state;
    if (wrapper === null) return;
    const ours = (node: Node): boolean => node.nodeType === 1 && ((node as Element).hasAttribute('data-cg-inbox') || (node as Element).getAttribute('data-host') === 'inbox-slot' || (node as Element).closest('[data-cg-inbox]') !== null);
    state.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' ? ours(record.target) : [...record.addedNodes, ...record.removedNodes].some(ours)) state.ours += 1;
        if (record.type === 'childList' && record.target === wrapper && [...record.addedNodes].some((node) => node.nodeType === 1 && (node as Element).getAttribute('data-host') === 'inbox-slot')) state.hostPlaced += 1;
      }
    });
    state.observer.observe(wrapper, { childList: true, subtree: true, attributes: true });
  });
}

async function readMutations(): Promise<{ ours: number; hostPlaced: number }> {
  return browser.execute(() => {
    const state = (window as unknown as Record<string, { ours: number; hostPlaced: number } | undefined>)['__cgMut'];
    return { ours: state?.ours ?? -1, hostPlaced: state?.hostPlaced ?? -1 };
  });
}

interface PinsReport {
  readonly on: boolean | null;
  readonly pins: readonly string[];
  readonly chips: ReadonlyArray<{ readonly groupId: string; readonly state: string; readonly waiting: boolean; readonly open: boolean }>;
  readonly height: number;
  readonly visible: boolean;
  readonly held: boolean;
  readonly listInside: boolean;
  readonly changedAt: number;
  readonly mounted: boolean;
  readonly header: boolean;
  readonly hostStats: { readonly replaced: number; readonly refused: number };
}

async function pinsReport(): Promise<PinsReport | null> {
  const report = (await readReport()) as unknown as { pins?: PinsReport } | null;
  return report?.pins ?? null;
}

async function waitPins(test: (report: PinsReport) => boolean, what: string, timeout = 10_000): Promise<PinsReport> {
  let last: PinsReport | null = null;
  await browser.waitUntil(
    async () => {
      last = await pinsReport();
      return last !== null && test(last);
    },
    { timeout, interval: 100 },
  ).catch(() => {
    throw new Error(`${what}; last: ${JSON.stringify(last)}`);
  });
  return last as unknown as PinsReport;
}

/** The pointer to a point of the page, as a person moves it. */
async function pointTo(x: number, y: number): Promise<void> {
  await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).perform();
}

async function centre(selector: string): Promise<{ x: number; y: number }> {
  const box = await browser.execute((sel: string) => {
    const node = document.querySelector(sel);
    if (node === null) return null;
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  }, selector);
  if (box === null) throw new Error(`nothing at ${selector}`);
  return box;
}

/** The pointer away from the list's column: on the open conversation. */
async function leaveList(): Promise<void> {
  const conversation = await browser.execute(() => {
    const node = document.querySelector('.messages-content-wrapper');
    const rect = node?.getBoundingClientRect();
    return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + 120 };
  });
  await pointTo(conversation?.x ?? 1000, conversation?.y ?? 200);
}

/** A row's pin button: the pointer over the row, then the button once it has faded in. */
async function hoverRow(group: string): Promise<{ x: number; y: number }> {
  const at = await centre(rowOf(group));
  await pointTo(at.x - 60, at.y);
  await browser.waitUntil(async () => browser.execute((sel: string) => {
    const box = document.querySelector(sel)?.parentElement;
    return box !== null && box !== undefined && box.style.opacity === '1';
  }, buttonOf(group)), { timeout: 5_000, interval: 50, timeoutMsg: `no pin button on the row of ${group}` });
  await browser.pause(150);
  return centre(buttonOf(group));
}

async function clickAt(x: number, y: number, again?: number): Promise<void> {
  let chain = browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).down({ button: 0 }).up({ button: 0 });
  if (again !== undefined) chain = chain.pause(again).down({ button: 0 }).up({ button: 0 });
  await chain.perform();
}

/** The rendered rows' groups, top first. */
async function renderedRows(): Promise<string[]> {
  return browser.execute(() => [...document.querySelectorAll('.messages-list-wrapper .message-list a[href^="/messages/"]')].map((link) => link.getAttribute('href')?.split('/').pop() ?? ''));
}

/** A chip of our strip (closed root: WebDriver reaches into it). */
const chip = (group: string, part = '') => $(SLOT).shadow$(`.cg-pin[data-pin-group="${group}"]${part}`);

/** The pointer over a chip (WebDriver's own move refuses an element of a closed root). */
async function overChip(group: string, part = ''): Promise<{ x: number; y: number }> {
  const element = await chip(group, part);
  await element.waitForExist({ timeout: 5_000 });
  const rect = (await browser.execute((node: Element) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }, element as unknown as Element)) as Box;
  const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await pointTo(at.x, at.y);
  return at;
}

async function shootList(s: See, name: string, height = 300): Promise<void> {
  const list = await s.rect('page', LIST);
  await s.shot(name, list === null ? {} : { clip: around([{ ...list, height: Math.min(list.height, height) }]) });
}

async function shootStrip(s: See, name: string): Promise<void> {
  const strip = await s.rect('page', SLOT);
  const list = await s.rect('page', LIST);
  if (strip === null || list === null) {
    await shootList(s, name);
    return;
  }
  await s.shot(name, { clip: around([{ x: list.x, y: strip.y - 70, width: list.width, height: strip.height + 70 + 150 }]) });
}

async function setSettings(s: See, patch: Record<string, unknown>): Promise<void> {
  const written = await s.rpc('fansly.settings.write', { patch: { hosts: { 'fansly-web': patch } } });
  if (!written.ok) throw new Error(`settings not written: ${written.error.code}`);
}

const same = (a: Geometry, b: Geometry): boolean => a.scTop === b.scTop && a.scHeight === b.scHeight && a.scrollTop === b.scrollTop && JSON.stringify(a.spacers) === JSON.stringify(b.spacers);

scenario(
  'fansly-pins',
  async (s) => {
    const measures: Record<string, unknown> = {
      stand: 'the Fansly-like stand (packages/testing/fixture-fansly), not fansly.com: its rows, spinner and filters are our imitation; A8 is the reload case on the stand; FBuddy is not on the stand',
    };
    const save = (): void => writeFileSync(join(s.out, 'pins-measures.json'), `${JSON.stringify(measures, null, 2)}\n`);
    await s.ready();
    await callFansly('setTheme', 'dark');
    const open = s.world.fansly.chats.a.group;
    await browser.waitUntil(async () => (await renderedRows()).length > 6, { timeout: 15_000, timeoutMsg: 'no rows in the list of chats' });
    await waitPins((report) => report.on === true, 'the pins were not read');
    const rows = (await renderedRows()).filter((group) => group !== open);
    const [r1, r2, r3, r4] = rows;
    if (r1 === undefined || r2 === undefined || r3 === undefined || r4 === undefined) throw new Error('fewer than four other rows');
    lap(`rows ${[r1, r2, r3, r4].join(', ')}, open ${open}`);

    // ── A9: a row's pin button, a second click 100 ms later at the same point, then a click on the row's time ──
    await browser.$(FANSLY_MAIN.field).click();
    const focusBefore = await browser.execute(() => document.activeElement?.className ?? null);
    const unreadBefore = (await callFansly('groups')).find((group) => group.id === r2)?.unread ?? null;
    const at = await hoverRow(r2);
    await shootList(s, 'row-hover', 420);
    const before9 = await geometry();
    await clickAt(at.x, at.y, 100);
    await browser.pause(400);
    const after9 = await geometry();
    const under = await browser.execute((x: number, y: number) => document.elementFromPoint(x, y)?.closest('a[href^="/messages/"]')?.getAttribute('href') ?? null, at.x, at.y);
    const focusAfter = await browser.execute(() => document.activeElement?.className ?? null);
    const unreadAfter = (await callFansly('groups')).find((group) => group.id === r2)?.unread ?? null;
    const report9 = await pinsReport();
    measures['A9'] = {
      clicks: 'pin, then the same point 100 ms later (unpins the same row)',
      route: { before: before9.path, after: after9.path, unchanged: before9.path === after9.path },
      focus: { before: focusBefore, after: focusAfter, unchanged: focusBefore === focusAfter },
      unread: { before: unreadBefore, after: unreadAfter, unchanged: unreadBefore === unreadAfter },
      rowUnderPointer: under,
      sameRow: under === `/messages/${r2}`,
      pinsAfter: report9?.pins ?? null,
    };
    save();

    // ── A pin from a row: its mark at once, the strip only once the pointer left the list (A2: the first pin) ──
    const at1 = await hoverRow(r1);
    const before2 = await geometry();
    await clickAt(at1.x, at1.y);
    await browser.waitUntil(async () => browser.$(`${rowOf(r1)} [data-cg-inbox="pin"]`).isExisting(), { timeout: 3_000, timeoutMsg: 'no pin mark on the pinned row' });
    const held = await pinsReport();
    const stillThere = await geometry();
    await shootList(s, 'row-pinned-strip-waits', 420);
    await startFrames(900);
    await leaveList();
    await browser.pause(950);
    const framesIn = await readFrames();
    const after2 = await geometry();
    await shootStrip(s, 'strip-first-pin');
    measures['A2-first-pin'] = {
      whilePointerInList: { height: held?.height ?? null, scTopUnchanged: stillThere.scTop === before2.scTop },
      before: before2,
      after: after2,
      scrollTopUnchanged: before2.scrollTop === after2.scrollTop,
      spacersUnchanged: JSON.stringify(before2.spacers) === JSON.stringify(after2.spacers),
      scTopMove: after2.scTop - before2.scTop,
      frames: motion(framesIn),
    };
    save();

    // ── A second pin from the header (A1: with another pin present nothing of the list moves) ──
    await browser.waitUntil(async () => (await $(HEADER_PIN).isExisting()) && (await $(HEADER_PIN).shadow$('.cg-ph__button').isExisting()), { timeout: 10_000, timeoutMsg: 'no pin button in the header' });
    const before1 = await geometry();
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await waitPins((report) => report.pins.includes(open), 'the open chat was not pinned from the header');
    await browser.pause(500);
    const after1 = await geometry();
    const header = await s.rect('page', '.message-content-header');
    if (header !== null) await s.shot('header-pinned', { clip: around([{ ...header, width: Math.min(header.width, 520) }], 6) });
    await shootStrip(s, 'strip-two-pins');
    measures['A1-pin-with-another'] = { before: before1, after: after1, identical: same(before1, after1) && JSON.stringify(before1.strip) === JSON.stringify(after1.strip) };
    save();

    // ── A3: far down the list (80 chats and more, pages loading) and back: the strip stands, our host never put in again ──
    await startMutations();
    const strips: Array<Box | null> = [];
    const stats0 = (await pinsReport())?.hostStats ?? null;
    for (let step = 0; step < 14; step += 1) {
      await browser.execute(() => {
        const list = document.querySelector('.messages-list-wrapper .message-list');
        if (list !== null) list.scrollTop += 480;
      });
      await browser.pause(160);
      strips.push((await geometry()).strip);
    }
    const deep = await geometry();
    await shootStrip(s, 'strip-scrolled-deep');
    for (let step = 0; step < 16; step += 1) {
      await browser.execute(() => {
        const list = document.querySelector('.messages-list-wrapper .message-list');
        if (list !== null) list.scrollTop -= 480;
      });
      await browser.pause(100);
      strips.push((await geometry()).strip);
    }
    const mutations3 = await readMutations();
    const stats3 = (await pinsReport())?.hostStats ?? null;
    const rects = new Set(strips.map((box) => JSON.stringify(box)));
    measures['A3-scroll'] = {
      deepestScrollTop: deep.scrollTop,
      chatsPassed: Math.round(deep.scrollTop / 73),
      stripRects: [...rects].map((text) => JSON.parse(text) as unknown),
      stripConstant: rects.size === 1,
      hostPlacedByMutation: mutations3.hostPlaced,
      hostReplacedByPort: stats3 === null || stats0 === null ? null : stats3.replaced - stats0.replaced,
    };
    save();

    // ── A fan writes in a pinned chat: the dot on its chip, nothing moves ──
    const before5 = await geometry();
    await callFansly('fanMessage', r1, 'you up? 👀');
    await waitPins((report) => report.chips.some((item) => item.groupId === r1 && item.waiting), 'no dot on the chip of the fan who wrote');
    await browser.pause(400);
    const after5 = await geometry();
    await shootStrip(s, 'strip-dot');
    measures['message-in-pinned-chat'] = { stripUnchanged: JSON.stringify(before5.strip) === JSON.stringify(after5.strip), scTopUnchanged: before5.scTop === after5.scTop };

    // ── A new chat on top: a message from a chat the list had not loaded ──
    const groups = await callFansly('groups');
    const fresh = groups.map((group) => group.id).find((id) => !rows.includes(id) && id !== open && groups.findIndex((group) => group.id === id) > 60) ?? null;
    if (fresh !== null) {
      const before6 = await geometry();
      await callFansly('fanMessage', fresh, 'hey, found you on fansly 🙂');
      await browser.waitUntil(async () => (await renderedRows())[0] === fresh, { timeout: 8_000, interval: 100, timeoutMsg: 'the new chat did not come on top' }).catch(() => undefined);
      await browser.pause(300);
      const after6 = await geometry();
      measures['new-chat-on-top'] = { group: fresh, onTop: (await renderedRows())[0] === fresh, stripUnchanged: JSON.stringify(before6.strip) === JSON.stringify(after6.strip), scTopUnchanged: before6.scTop === after6.scTop };
      await shootStrip(s, 'new-chat-on-top');
    }
    save();

    // ── A chip clicked: the chat opens through Fansly's router, its chip lit ──
    await chip(r1, ' .cg-pin__open').click();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${r1}`), { timeout: 8_000, timeoutMsg: 'the chip did not open its chat' });
    await waitPins((report) => report.chips.some((item) => item.groupId === r1 && item.open), 'the open chat\'s chip is not lit');
    await leaveList();
    await browser.pause(300);
    await shootStrip(s, 'chip-opened');
    measures['chip-click'] = { opened: (await browser.getUrl()).endsWith(`/messages/${r1}`) };

    // ── A5: a search — Fansly's spinner under the strip, the strip in its place ──
    const strip5 = (await geometry()).strip;
    await browser.$(`${LIST} .search-input`).setValue('a');
    const spinner = await browser.execute(() => {
      const node = document.querySelector('.messages-list-wrapper > .flex-center.margin-top-2');
      const host = document.querySelector('[data-host="inbox-slot"]');
      const order = [...(document.querySelector('.messages-list-wrapper')?.childNodes ?? [])].map((child) => (child.nodeType === 8 ? '<!>' : child.nodeType === 1 ? ((child as Element).getAttribute('data-host') === 'inbox-slot' ? 'OURS' : (child as Element).className.split(' ')[0]) : '#'));
      return { spinner: node === null ? null : node.getBoundingClientRect().top, stripBottom: host === null ? null : host.getBoundingClientRect().bottom, order: order.join(' | ') };
    });
    // The spinner turns: a picture of that moment, not of a still tab.
    writeFileSync(join(s.out, 'search-spinner-moment.png'), Buffer.from(await browser.takeScreenshot(), 'base64'));
    await browser.pause(500);
    const strip5b = (await geometry()).strip;
    measures['A5-search'] = { ...spinner, spinnerUnderStrip: spinner.spinner !== null && spinner.stripBottom !== null && spinner.spinner >= spinner.stripBottom - 0.5, stripBefore: strip5, stripAfter: strip5b, stripConstant: JSON.stringify(strip5) === JSON.stringify(strip5b) };
    await browser.$(`${LIST} .search-input`).setValue('');
    await browser.execute(() => document.querySelector('.messages-list-wrapper .search-input')?.dispatchEvent(new Event('input')));
    await browser.pause(600);
    save();

    // ── A third pin; A4: 15 s idle with three pins — nothing of ours changes in the page ──
    const at3 = await hoverRow(r3);
    await clickAt(at3.x, at3.y);
    await waitPins((report) => report.pins.length === 3, 'three pins');
    await leaveList();
    await waitPins((report) => report.chips.every((item) => item.state === 'shown'), 'the chips did not settle');
    await shootStrip(s, 'strip-three-pins');
    // The note's picture: the strip with its chips over the list, a row's pin button under the pointer.
    const shown = await pinsReport();
    const near = (await renderedRows()).slice(0, 4).find((group) => !(shown?.pins ?? []).includes(group)) ?? r4;
    await hoverRow(near);
    const list = await s.rect('page', LIST);
    const strip = await s.rect('page', SLOT);
    if (list !== null && strip !== null) await s.shot('note', { file: 'note-pins', clip: around([{ x: list.x, y: strip.y - 100, width: list.width, height: strip.height + 100 + 300 }]) });
    await leaveList();
    await browser.pause(400);
    await startMutations();
    await browser.pause(15_000);
    measures['A4-idle-15s'] = await readMutations();
    save();

    // ── A6: a second tab of the creator unpins while the pointer is in this tab's strip ──
    const first = await browser.getWindowHandle();
    await overChip(r3);
    await waitPins((report) => report.held, 'the strip did not hold under the pointer');
    const before7 = await geometry();
    const second = (await browser.createWindow('window')).handle;
    await browser.switchToWindow(second);
    // As wide as the first: at 1200 px and below Fansly hides the list with a chat open.
    await browser.browsingContextSetViewport({ context: second, viewport: { width: 1440, height: 900 } });
    await browser.url(fanslyStandUrl(`/messages/${open}`));
    await waitForFanslyStandReady();
    await browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$(`.cg-pin[data-pin-group="${r3}"] .cg-pin__x`).isExisting()), { timeout: 20_000, timeoutMsg: 'no strip in the second tab' });
    await overChip(r3);
    await browser.pause(200);
    const x3 = await overChip(r3, ' .cg-pin__x');
    const clickedAt = await browser.execute(() => Date.now());
    await clickAt(x3.x, x3.y);
    await browser.pause(1200);
    const secondTab = await pinsReport();
    await browser.closeWindow();
    await browser.switchToWindow(first);
    const tomb = await waitPins((report) => !report.pins.includes(r3), 'the first tab did not hear the unpin', 5_000);
    const after7 = await geometry();
    await shootStrip(s, 'strip-placeholder-held');
    await leaveList();
    await waitPins((report) => !report.chips.some((item) => item.groupId === r3), 'the placeholder did not close', 5_000);
    await browser.pause(400);
    await shootStrip(s, 'strip-placeholder-closed');
    measures['A6-second-tab'] = {
      heardMs: tomb.changedAt - clickedAt,
      withinOneSecond: tomb.changedAt - clickedAt <= 1000,
      chipWhileHeld: tomb.chips.find((item) => item.groupId === r3)?.state ?? null,
      secondTabPins: secondTab?.pins ?? null,
      nothingMovedUnderPointer: JSON.stringify(before7.strip) === JSON.stringify(after7.strip) && before7.scTop === after7.scTop,
    };
    save();

    // ── The light theme ──
    await callFansly('setTheme', 'bright');
    await browser.pause(300);
    await shootStrip(s, 'strip-light');
    await hoverRow(r4);
    await shootList(s, 'row-hover-light', 420);
    await leaveList();
    await callFansly('setTheme', 'dark');

    // ── 1100 px wide (the list column hidden with a chat open), then 768 px high ──
    const context = await browser.getWindowHandle();
    await browser.browsingContextSetViewport({ context, viewport: { width: 1100, height: 900 } });
    await browser.pause(500);
    await s.shot('narrow-1100');
    measures['narrow-1100'] = { listShown: (await geometry()).scHeight > 0, headerButton: await $(HEADER_PIN).isExisting() };
    await browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 768 } });
    await browser.pause(500);
    // A recalculation with the strip standing (a fan's message), then the last pins taken off: the band at the list's end.
    await startFrames(1500);
    await callFansly('fanMessage', r4, 'hello?');
    await browser.pause(300);
    await s.shot('short-768');
    measures['short-768'] = { geometry: await geometry() };
    await browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 900 } });
    await browser.pause(400);
    save();

    // ── «Вид и звук»: «Закрепы чатов» beside «Кто ждёт ответа» on the settings page ──
    await s.toPages();
    await openOptions('appearance');
    await waitForOptions((state) => state.section === 'appearance' && !state.loading, 'the appearance section');
    await browser.execute(() => document.querySelector('[data-pg-fansly-pins]')?.scrollIntoView({ block: 'center' }));
    await browser.pause(300);
    const row = await s.rect('page', '[data-pg-fansly-pins]');
    await s.shot('options-pins');
    if (row !== null) await s.shot('options-pins-row', { clip: around([{ x: row.x - 500, y: row.y - 150, width: 1000, height: row.height + 220 }]) });
    await s.toChat();

    // ── The marks off and the pins on, then the pins off and the marks on (A7: the switch off) ──
    // `s.rpc` asks from the settings page and brings the Fansly tab to the front again.
    await setSettings(s, { inboxMark: 'off' });
    await browser.pause(800);
    const count = (kind: string): Promise<number> => browser.execute((k: string) => document.querySelectorAll(`.messages-list-wrapper [data-cg-inbox="${k}"]`).length, kind);
    measures['marks-off-pins-on'] = { dot: await count('dot'), pin: await count('pin'), strip: await $(SLOT).isExisting() };
    await shootList(s, 'marks-off-pins-on', 420);
    await browser.execute(() => {
      const state: { at: number | null } = { at: null };
      (window as unknown as Record<string, unknown>)['__cgOff'] = state;
      const left = (): number => document.querySelectorAll('[data-host="inbox-slot"], .messages-list-wrapper [data-cg-inbox="pin"], .messages-list-wrapper [data-cg-inbox="row"]').length;
      const observer = new MutationObserver(() => {
        if (state.at === null && left() === 0) {
          state.at = Date.now();
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
    const offAt = Date.now();
    await setSettings(s, { inboxMark: 'dot', pins: false });
    await browser.waitUntil(async () => (await browser.execute(() => ((window as unknown as Record<string, { at: number | null } | undefined>)['__cgOff']?.at ?? null))) !== null, { timeout: 5_000, interval: 50, timeoutMsg: 'the pins stayed after the switch went off' });
    const goneAt = await browser.execute(() => (window as unknown as Record<string, { at: number | null } | undefined>)['__cgOff']?.at ?? null);
    await browser.pause(800);
    measures['A7-switched-off'] = {
      goneAfterWriteMs: goneAt === null ? null : goneAt - offAt,
      slotHosts: await browser.execute(() => document.querySelectorAll('[data-host="inbox-slot"]').length),
      pinMarks: await count('pin'),
      rowButtons: await count('row'),
      dots: await count('dot'),
      we: await count('we'),
      header: await $(HEADER_PIN).isExisting(),
      note: 'measured from the settings write in the extension page (the Fansly tab is hidden meanwhile: no frames there)',
    };
    await shootList(s, 'pins-off-marks-on', 420);
    await setSettings(s, { pins: true });
    await waitPins((report) => report.on === true && report.mounted, 'the strip did not come back with the switch');
    await browser.pause(500);
    save();

    // ── An expired pin: the stored pins with one quiet for six hours, read again ──
    await s.toPages();
    const stored = (await readLocalStorage(['fansly.pins']))['fansly.pins'] as { accounts: Record<string, Array<{ groupId: string; touchedAt: number }>> } | undefined;
    let expired: string | null = null;
    if (stored !== undefined) {
      for (const list of Object.values(stored.accounts)) {
        const victim = list.find((pin) => pin.groupId === open);
        if (victim !== undefined) {
          victim.touchedAt = Date.now() - 6 * 60 * 60 * 1000 - 60_000;
          expired = victim.groupId;
        }
      }
      await writeLocalStorage({ 'fansly.pins': stored });
    }
    await s.toChat();
    // A8 on the stand: the reload, its frames from the page's first script on.
    const preload = await browser.scriptAddPreloadScript({
      functionDeclaration: `() => {
        const frames = [];
        window.__cgReload = frames;
        const t0 = performance.now();
        const tick = () => {
          const list = document.querySelector('.messages-list-wrapper .message-list');
          const host = document.querySelector('[data-host="inbox-slot"]');
          if (list) frames.push({ t: Math.round(performance.now() - t0), scTop: list.getBoundingClientRect().top, rows: list.querySelectorAll('a[href^="/messages/"]').length, strip: host ? host.getBoundingClientRect().height : -1 });
          if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }`,
    });
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitPins((report) => report.mounted && report.height === 44, 'the strip did not come back after the reload', 20_000);
    await browser.pause(1500);
    const reload = await browser.execute(() => ((window as unknown as Record<string, unknown>)['__cgReload'] ?? []) as Array<{ t: number; scTop: number; rows: number; strip: number }>);
    await browser.scriptRemovePreloadScript({ script: preload.script });
    const firstRow = reload.find((frame) => frame.rows > 0) ?? null;
    const settled = reload[reload.length - 1] ?? null;
    measures['A8-reload'] = {
      firstRowFrame: firstRow,
      lastFrame: settled,
      scTopMoveAfterFirstRow: firstRow === null || settled === null ? null : settled.scTop - firstRow.scTop,
      stripAtFirstRow: firstRow?.strip ?? null,
      expiredPinGone: expired === null ? null : !((await pinsReport())?.pins.includes(expired) ?? true),
    };
    await shootStrip(s, 'after-reload');
    save();

    // ── The last unpin (A2: the strip slides out once the pointer is away) ──
    const left = (await pinsReport())?.pins ?? [];
    await leaveList();
    for (const group of left.slice(0, -1)) {
      await overChip(group);
      await browser.pause(150);
      const x = await overChip(group, ' .cg-pin__x');
      await clickAt(x.x, x.y);
      await browser.pause(150);
      await leaveList();
      await browser.pause(450);
    }
    await leaveList();
    await waitPins((report) => report.pins.length === 1 && report.chips.length === 1, 'one pin left');
    const last = left[left.length - 1];
    if (last !== undefined) {
      await overChip(last);
      await browser.pause(250);
      await shootStrip(s, 'chip-hover-x');
      const before8 = await geometry();
      const x = await overChip(last, ' .cg-pin__x');
      await clickAt(x.x, x.y);
      await browser.pause(300);
      const whileIn = await pinsReport();
      await startFrames(900);
      await leaveList();
      await browser.pause(950);
      const framesOut = await readFrames();
      const after8 = await geometry();
      measures['A2-last-unpin'] = {
        whilePointerInList: { height: whileIn?.height ?? null },
        before: before8,
        after: after8,
        scrollTopUnchanged: before8.scrollTop === after8.scrollTop,
        spacersUnchanged: JSON.stringify(before8.spacers) === JSON.stringify(after8.spacers),
        scTopMove: after8.scTop - before8.scTop,
        frames: motion(framesOut),
        stripGone: after8.strip === null,
      };
    }
    await shootList(s, 'no-pins', 420);
    save();
    lap(`measures: ${join(s.out, 'pins-measures.json')}`);
  },
  { sites: ['fansly'], showcase: true, timeout: 420_000 },
);
