// Fansly: temporary chat pins over Fansly's own list of chats (2026-11-12), on the stand in the showcase world (Sofia
// Lane's inbox). It walks the feature and measures what must never happen, writing the numbers (not a verdict alone) to
// `pins-measures.json` in the run's folder:
// - A9 a row's pin button: a click and a second click 100 ms later at the same point keep the route, the focus and the
//   unread count, and stay on the same row; a click on the centre of a hovered row's time or unread badge (a pinned row
//   and one that is not) opens its chat and pins or unpins nothing;
// - A2 the first pin and the last unpin: the strip's height waits while the pointer is over the list, then the scroller's
//   top moves by 44 px one way only, with no blank band, `scrollTop` and the spacers unchanged — at the list's top and
//   with the list scrolled (non-zero spacers);
// - A1 a pin and an unpin with another pin present (at the top and scrolled): the scroller, `scrollTop`, the spacers
//   identical;
// - A3 a scroll through some ninety chats and back: the strip's box constant, our host never put in again;
// - chips frozen: three pins, the first taken off by its row's button, the pointer on the second chip 150 ms later:
//   the second chip's x by every frame;
// - A4 fifteen seconds idle with three pins: no mutation of ours;
// - A5 a search: Fansly's spinner under the strip, the strip's box constant;
// - A6 a second tab takes off the first of three chips while the pointer is on this tab's strip: how soon this tab
//   hears it, and the other chips' x unchanged until the pointer leaves;
// - A7 the switch off: how soon the strip, the row buttons and the pin marks go, the dots staying;
// - A13 back to the list from another page: the scroller's top after the first frame with rows;
// - A8 a reload: when the strip came, against the first rows;
// and the pictures: a row's button with and without an unread badge, in both themes and beside FBuddy's stand-in,
// the strip with one to six pins, the header's button, the settings row. `stand` in the file says what the stand
// cannot show. No two pictures are the same (`duplicatePictures`).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser } from '@wdio/globals';

import { readLocalStorage, readReport, writeLocalStorage } from '../../support/extension';
import { setFanslyNeighbor } from '../../support/fansly-neighbor';
import { FANSLY_MAIN, callFansly, fanslyStandUrl, waitForFanslyStandReady } from '../../support/fansly-stand';
import { openOptions, waitForOptions } from '../../support/pages';
import { around, lap, scenario, type Box, type See } from '../kit';

const LIST = '.messages-list-wrapper';
const SLOT = '[data-host="inbox-slot"]';
const HEADER_PIN = '[data-host="header-slot"][data-header-order="5"]';
const rowOf = (group: string): string => `${LIST} a[href="/messages/${group}"]`;
const buttonOf = (group: string): string => `${rowOf(group)} [data-cg-inbox="row"]`;

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
  readonly counts: { readonly reads: number; readonly changes: number; readonly touches: number; readonly changedAt: number } | null;
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
  await browser
    .waitUntil(
      async () => {
        last = await pinsReport();
        return last !== null && test(last);
      },
      { timeout, interval: 100 },
    )
    .catch(() => {
      throw new Error(`${what}; last: ${JSON.stringify(last)}`);
    });
  return last as unknown as PinsReport;
}

/** The pointer to a point of the page, as a person moves it. */
async function pointTo(x: number, y: number): Promise<void> {
  await browser.action('pointer', { parameters: { pointerType: 'mouse' } }).move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).perform();
}

async function boxOf(selector: string): Promise<Box | null> {
  return browser.execute((sel: string) => {
    const node = document.querySelector(sel);
    if (node === null) return null;
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }, selector);
}

async function centre(selector: string): Promise<{ x: number; y: number }> {
  const box = await boxOf(selector);
  if (box === null) throw new Error(`nothing at ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

/** A row's pin button: the pointer onto the row (two real moves), then the button once it has faded in; its centre. */
async function hoverRow(group: string, timeout = 5_000): Promise<{ x: number; y: number }> {
  // A row below the list's visible part is brought into it first, as a person scrolls to it.
  const moved = await browser.execute((sel: string) => {
    const row = document.querySelector(sel);
    const list = row?.closest('.message-list');
    if (row === null || row === undefined || list === null || list === undefined) return false;
    const r = row.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    if (r.top >= l.top && r.bottom <= Math.min(l.bottom, window.innerHeight - 160)) return false;
    list.scrollTop += r.top - l.top - 80;
    return true;
  }, rowOf(group));
  if (moved) await browser.pause(400);
  const at = await centre(rowOf(group));
  await pointTo(at.x - 90, at.y - 4);
  await pointTo(at.x - 80, at.y);
  await browser.waitUntil(async () => browser.execute((sel: string) => (document.querySelector(sel) as HTMLElement | null)?.style.opacity === '1', buttonOf(group)), { timeout, interval: 50, timeoutMsg: `no pin button on the row of ${group}` });
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

async function chipBox(group: string, part = ''): Promise<Box> {
  const element = await chip(group, part);
  await element.waitForExist({ timeout: 5_000 });
  return (await browser.execute((node: Element) => {
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height };
  }, element as unknown as Element)) as Box;
}

/** The pointer over a chip (WebDriver's own move refuses an element of a closed root). */
async function overChip(group: string, part = ''): Promise<{ x: number; y: number }> {
  const rect = await chipBox(group, part);
  const at = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await pointTo(at.x, at.y);
  return at;
}

/** Every frame from now until `ms` later, the x of these chips (the elements handed into the page by WebDriver). */
async function startChipFrames(groups: readonly string[], ms: number): Promise<void> {
  const elements = await Promise.all(groups.map(async (group) => (await chip(group)) as unknown as Element));
  await browser.execute(
    (limit: number, ...nodes: Element[]) => {
      const frames: number[][] = [];
      (window as unknown as Record<string, unknown>)['__cgChipFrames'] = frames;
      const t0 = performance.now();
      const tick = (): void => {
        frames.push(nodes.map((node) => Math.round(node.getBoundingClientRect().x * 10) / 10));
        if (performance.now() - t0 < limit) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    ms,
    ...elements,
  );
}

async function readChipFrames(): Promise<number[][]> {
  return browser.execute(() => ((window as unknown as Record<string, unknown>)['__cgChipFrames'] ?? []) as number[][]);
}

async function shootList(s: See, name: string, height = 300, from = 0): Promise<void> {
  const list = await s.rect('page', LIST);
  await s.shot(name, list === null ? {} : { clip: around([{ ...list, y: list.y + from, height: Math.min(list.height - from, height) }]) });
}

/** The strip with the chips over it and the first rows under it. */
async function shootStrip(s: See, name: string, under = 150): Promise<void> {
  const strip = await s.rect('page', SLOT);
  const list = await s.rect('page', LIST);
  if (strip === null || list === null) {
    await shootList(s, name);
    return;
  }
  await s.shot(name, { clip: around([{ x: list.x, y: strip.y - 70, width: list.width, height: strip.height + 70 + under }]) });
}

/** One row as it is now (hovered: with its button), with a little of its neighbours. */
async function shootRow(s: See, name: string, group: string): Promise<void> {
  const row = await boxOf(rowOf(group));
  if (row === null) throw new Error(`no row of ${group}`);
  await s.shot(name, { clip: around([row], [10, 8, 10, 8]) });
}

async function setSettings(s: See, patch: Record<string, unknown>): Promise<void> {
  const written = await s.rpc('fansly.settings.write', { patch: { hosts: { 'fansly-web': patch } } });
  if (!written.ok) throw new Error(`settings not written: ${written.error.code}`);
}

const same = (a: Geometry, b: Geometry): boolean => a.scTop === b.scTop && a.scHeight === b.scHeight && a.scrollTop === b.scrollTop && JSON.stringify(a.spacers) === JSON.stringify(b.spacers);

async function scrollList(top: number): Promise<void> {
  await browser.execute((value: number) => {
    const list = document.querySelector('.messages-list-wrapper .message-list');
    if (list !== null) list.scrollTop = value;
  }, top);
  await browser.pause(400);
}

/** Back to a chat by the stand's own router (no click of ours), its route and dock standing. */
async function backTo(group: string): Promise<void> {
  await callFansly('open', group);
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${group}`), { timeout: 8_000, timeoutMsg: `not back on ${group}` });
  await browser.pause(400);
}

/**
 * A person's click on the centre of a part of a hovered row (its time, its unread badge): the chat opens, nothing is
 * pinned or unpinned, and nothing of ours was under the pointer.
 */
async function clickRowPart(group: string, part: string): Promise<Record<string, unknown>> {
  const before = (await pinsReport())?.pins ?? [];
  await hoverRow(group);
  const at = await centre(`${rowOf(group)} ${part}`);
  const there = await browser.execute((x: number, y: number) => {
    const node = document.elementFromPoint(x, y);
    return node === null ? null : node.closest('[data-cg-inbox]') !== null ? 'ours' : (node.className || node.localName);
  }, at.x, at.y);
  await clickAt(at.x, at.y);
  await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${group}`), { timeout: 8_000 }).catch(() => undefined);
  await browser.pause(300);
  const after = (await pinsReport())?.pins ?? [];
  return { part, at, elementThere: there, opened: (await browser.getUrl()).endsWith(`/messages/${group}`), pinsUnchanged: JSON.stringify(before) === JSON.stringify(after) };
}

scenario(
  'fansly-pins',
  async (s) => {
    const measures: Record<string, unknown> = {
      stand: 'the Fansly-like stand (packages/testing/fixture-fansly), not fansly.com: its rows, spinner and filters are our imitation, FBuddy is its stand-in (no gap under the chips, a line added to each row); the reload (A8) and the return to the list (A13) are the stand\'s timings, not the live site\'s',
    };
    const save = (): void => writeFileSync(join(s.out, 'pins-measures.json'), `${JSON.stringify(measures, null, 2)}\n`);
    await s.ready();
    await callFansly('setTheme', 'dark');
    const open = s.world.fansly.chats.a.group;
    await browser.waitUntil(async () => (await renderedRows()).length > 8, { timeout: 15_000, timeoutMsg: 'no rows in the list of chats' });
    await waitPins((report) => report.on === true, 'the pins were not read');
    const groups = await callFansly('groups');
    const unread = (group: string): number => groups.find((item) => item.id === group)?.unread ?? 0;
    // Rows high enough in the list to be seen whole (our floating launcher's menu stands over the column's bottom).
    const tops = await browser.execute(() => Object.fromEntries([...document.querySelectorAll('.messages-list-wrapper .message-list a[href^="/messages/"]')].map((link) => [link.getAttribute('href')?.split('/').pop() ?? '', link.getBoundingClientRect().top])));
    const pool = (await renderedRows()).filter((group) => group !== open).slice(0, 10);
    const high = (group: string): boolean => (tops[group] ?? 999) < 640;
    const take = (want: (group: string) => boolean): string => {
      const found = pool.find((group) => want(group) && high(group)) ?? pool.find(want) ?? pool[0];
      if (found === undefined) throw new Error('not enough rows');
      pool.splice(pool.indexOf(found), 1);
      return found;
    };
    const r1 = take((group) => unread(group) > 0);
    const rBadge = take((group) => unread(group) > 0);
    const rPlain = take((group) => unread(group) === 0);
    const r2 = take(() => true);
    const r3 = take(() => true);
    const r4 = take(() => true);
    const r5 = take(() => true);
    lap(`r1 ${r1}, badge ${rBadge}, plain ${rPlain}, r2 ${r2}, r3 ${r3}, open ${open}`);

    // ── A row's button: on the preview's line, left of the unread badge or at the right edge, never over the time ──
    await hoverRow(rPlain);
    await shootRow(s, 'row-hover', rPlain);
    await hoverRow(rBadge);
    await shootRow(s, 'row-hover-badge', rBadge);
    measures['row-button'] = await browser.execute((badge: string, plain: string) => {
      const look = (group: string): Record<string, unknown> => {
        const row = document.querySelector(`.messages-list-wrapper a[href="/messages/${group}"] app-messaging-group`);
        const button = row?.querySelector('[data-cg-inbox="row"]');
        const r = (sel: string): DOMRect | null => row?.querySelector(sel)?.getBoundingClientRect() ?? null;
        const b = button?.getBoundingClientRect() ?? null;
        const time = r('.message-time');
        const badgeBox = r('.badge-container');
        const overlaps = (a: DOMRect | null, c: DOMRect | null): boolean => a !== null && c !== null && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
        return { button: b === null ? null : { top: b.top - (row?.getBoundingClientRect().top ?? 0), right: (row?.getBoundingClientRect().right ?? 0) - b.right, size: b.width }, overTime: overlaps(b, time), overBadge: overlaps(b, badgeBox) };
      };
      return { withBadge: look(badge), withoutBadge: look(plain) };
    }, rBadge, rPlain);

    // ── A9: a click on a row's pin button and another 100 ms later at the same point ──
    await browser.$(FANSLY_MAIN.field).click();
    const focusBefore = await browser.execute(() => document.activeElement?.className ?? null);
    const unreadBefore = (await callFansly('groups')).find((group) => group.id === r2)?.unread ?? null;
    const at = await hoverRow(r2);
    const before9 = await geometry();
    await clickAt(at.x, at.y, 100);
    await browser.pause(400);
    const after9 = await geometry();
    const under = await browser.execute((x: number, y: number) => document.elementFromPoint(x, y)?.closest('a[href^="/messages/"]')?.getAttribute('href') ?? null, at.x, at.y);
    const focusAfter = await browser.execute(() => document.activeElement?.className ?? null);
    const unreadAfter = (await callFansly('groups')).find((group) => group.id === r2)?.unread ?? null;
    measures['A9'] = {
      clicks: 'pin, then the same point 100 ms later (unpins the same row)',
      route: { before: before9.path, after: after9.path, unchanged: before9.path === after9.path },
      focus: { before: focusBefore, after: focusAfter, unchanged: focusBefore === focusAfter },
      unread: { before: unreadBefore, after: unreadAfter, unchanged: unreadBefore === unreadAfter },
      rowUnderPointer: under,
      sameRow: under === `/messages/${r2}`,
      pinsAfter: (await pinsReport())?.pins ?? null,
    };
    // A row that is not pinned: the centre of its badge, the centre of another's time.
    const parts: Array<Record<string, unknown>> = [];
    parts.push({ row: 'not pinned', ...(await clickRowPart(rBadge, '.badge')) });
    await backTo(open);
    parts.push({ row: 'not pinned', ...(await clickRowPart(rPlain, '.message-time')) });
    await backTo(open);
    save();

    // ── The first pin, from a row (A2 at the list's top): its mark at once, the strip once the pointer left the list ──
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
    // A pinned row: the centre of its badge, then of its time.
    if (unread(r1) > 0) {
      parts.push({ row: 'pinned', ...(await clickRowPart(r1, '.badge')) });
      await backTo(open);
    }
    parts.push({ row: 'pinned', ...(await clickRowPart(r1, '.message-time')) });
    await backTo(open);
    measures['A9-row-parts'] = parts;
    save();

    // ── A second pin from the header (A1 at the list's top) ──
    await browser.waitUntil(async () => (await $(HEADER_PIN).isExisting()) && (await $(HEADER_PIN).shadow$('.cg-ph__button').isExisting()), { timeout: 10_000, timeoutMsg: 'no pin button in the header' });
    await leaveList();
    const before1 = await geometry();
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await waitPins((report) => report.pins.includes(open) && report.chips.length === 2 && report.chips.every((item) => item.state === 'shown'), 'the open chat was not pinned from the header');
    await browser.pause(400);
    const after1 = await geometry();
    const header = await s.rect('page', '.message-content-header');
    if (header !== null) await s.shot('header-pinned', { clip: around([{ ...header, width: Math.min(header.width, 560) }], 6) });
    await shootStrip(s, 'strip-two-pins');
    const a1: Record<string, unknown> = { top: { before: before1, after: after1, identical: same(before1, after1) && JSON.stringify(before1.strip) === JSON.stringify(after1.strip) } };

    // ── A chat that was not loaded writes: it comes on top; the loaded ones keep their places ──
    const all = await callFansly('groups');
    const loaded = (await callFansly('inbox')).loaded;
    const fresh = all[Math.max(loaded + 10, 60)]?.id ?? null;
    if (fresh !== null) {
      const before6 = await geometry();
      const order6 = await renderedRows();
      await callFansly('fanMessage', fresh, 'hey, found you on fansly 🙂');
      await browser.waitUntil(async () => (await renderedRows())[0] === fresh, { timeout: 8_000, interval: 100 }).catch(() => undefined);
      await browser.pause(300);
      const after6 = await geometry();
      const order = await renderedRows();
      measures['new-chat-on-top'] = { group: fresh, onTop: order[0] === fresh, othersInOrder: JSON.stringify(order.slice(1, 8)) === JSON.stringify(order6.slice(0, 7)), stripUnchanged: JSON.stringify(before6.strip) === JSON.stringify(after6.strip) };
      await shootStrip(s, 'new-chat-on-top', 230);
    }

    // ── A1 with the list scrolled (non-zero spacers): the header's unpin and pin again ──
    await scrollList(1200);
    const before1s = await geometry();
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await waitPins((report) => !report.pins.includes(open) && report.chips.length === 1, 'the header did not unpin');
    await browser.pause(500);
    const mid1s = await geometry();
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await waitPins((report) => report.pins.includes(open) && report.chips.length === 2 && report.chips.every((item) => item.state === 'shown'), 'the header did not pin again');
    await browser.pause(400);
    const after1s = await geometry();
    a1['scrolled'] = { before: before1s, afterUnpin: mid1s, afterPin: after1s, identical: same(before1s, mid1s) && same(mid1s, after1s), spacersNonZero: before1s.spacers.some((value) => value > 0) };
    measures['A1-pin-with-another'] = a1;
    await scrollList(0);
    save();

    // ── A3: far down the list (pages loading) and back: the strip stands, our host never put in again ──
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
      rowButtonsShownWhileScrolling: await browser.execute(() => [...document.querySelectorAll('.messages-list-wrapper [data-cg-inbox="row"]')].filter((node) => (node as HTMLElement).style.opacity === '1').length),
    };
    save();

    // ── A fan writes in a pinned chat: the dot on its chip, nothing moves ──
    const before5 = await geometry();
    await callFansly('fanMessage', r1, 'you up? 👀');
    await waitPins((report) => report.chips.some((item) => item.groupId === r1 && item.waiting), 'no dot on the chip of the fan who wrote');
    await browser.pause(400);
    const after5 = await geometry();
    await shootStrip(s, 'strip-dot', 230);
    measures['message-in-pinned-chat'] = { stripUnchanged: JSON.stringify(before5.strip) === JSON.stringify(after5.strip), scTopUnchanged: before5.scTop === after5.scTop };

    // ── A chip clicked: the chat opens through Fansly's router, its chip lit; back by the open chat's chip ──
    await chip(r1, ' .cg-pin__open').click();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${r1}`), { timeout: 8_000, timeoutMsg: 'the chip did not open its chat' });
    await waitPins((report) => report.chips.some((item) => item.groupId === r1 && item.open), 'the opened chat\'s chip is not lit');
    await leaveList();
    await browser.pause(300);
    await shootStrip(s, 'chip-opened', 80);
    await chip(open, ' .cg-pin__open').click();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${open}`), { timeout: 8_000, timeoutMsg: 'the chip did not open its chat' });
    measures['chip-click'] = { opened: true };

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

    // ── Three, four and five pins (names giving way, then cut with «…») ──
    const pinRow = async (group: string): Promise<void> => {
      const button = await hoverRow(group);
      await clickAt(button.x, button.y);
      await waitPins((report) => report.pins.includes(group), `${group} was not pinned`);
      await leaveList();
      await waitPins((report) => report.chips.some((item) => item.groupId === group) && report.chips.every((item) => item.state === 'shown'), 'the chips did not settle');
      await browser.pause(300);
    };
    await pinRow(r3);
    await shootStrip(s, 'strip-three-pins');
    // The note's picture: the strip over the list, a row's button under the pointer.
    const shownNow = await pinsReport();
    const near = (await renderedRows()).slice(0, 4).find((group) => !(shownNow?.pins ?? []).includes(group)) ?? r4;
    await hoverRow(near);
    const list = await s.rect('page', LIST);
    const strip = await s.rect('page', SLOT);
    if (list !== null && strip !== null) await s.shot('note', { file: 'note-pins', clip: around([{ x: list.x, y: strip.y - 100, width: list.width, height: strip.height + 100 + 300 }]) });
    await leaveList();
    await pinRow(r4);
    await shootStrip(s, 'strip-four-pins', 40);
    await pinRow(r5);
    await shootStrip(s, 'strip-five-pins', 40);
    for (const group of [r5, r4]) {
      await overChip(group);
      await browser.pause(150);
      const x = await overChip(group, ' .cg-pin__x');
      await clickAt(x.x, x.y);
      await browser.pause(150);
    }
    await leaveList();
    await waitPins((report) => report.chips.length === 3 && report.chips.every((item) => item.state === 'shown'), 'back to three pins');
    save();

    // ── Chips frozen: the first of three taken off by its row's button, the pointer on the second 150 ms later ──
    const three = (await pinsReport())?.pins ?? [];
    const [first, second, third] = three;
    if (first !== undefined && second !== undefined && third !== undefined) {
      const button = await hoverRow(first);
      await startChipFrames([second, third], 1_200);
      await clickAt(button.x, button.y);
      await browser.pause(150);
      await overChip(second);
      await browser.pause(1_100);
      const xs = await readChipFrames();
      const whileIn = await pinsReport();
      await leaveList();
      await waitPins((report) => !report.chips.some((item) => item.groupId === first), 'the first chip did not close');
      const distinct = new Set(xs.map((frame) => frame.join(',')));
      measures['chips-frozen'] = { frames: xs.length, positions: [...distinct], unchanged: distinct.size === 1, firstWhileIn: whileIn?.chips.find((item) => item.groupId === first)?.state ?? null };
      await pinRow(first);
    }
    save();

    // ── A chip at once: the strip stands, a row's button puts the chip there while the pointer stays on the row (the
    //    list does not move); taken off and pinned again from the same row, the chip is back in its own place ──
    const pinsOnce = (await pinsReport())?.pins ?? [];
    const rowOnce = (await renderedRows()).slice(0, 6).find((group) => !pinsOnce.includes(group));
    if (rowOnce !== undefined && pinsOnce.length > 0) {
      const stateOf = async (): Promise<string | null> => (await pinsReport())?.chips.find((item) => item.groupId === rowOnce)?.state ?? null;
      const others = pinsOnce.slice(0, 2);
      const button = await hoverRow(rowOnce);
      const beforeOnce = await geometry();
      await clickAt(button.x, button.y);
      await waitPins((report) => report.pins.includes(rowOnce), `${rowOnce} was not pinned`);
      await browser.pause(450);
      const pinnedIn = await pinsReport();
      const chipPinned = await stateOf();
      const boxPinned = chipPinned === null ? null : await chipBox(rowOnce);
      const afterOnce = await geometry();
      await shootList(s, 'row-pinned-chip-at-once', 300);
      // Off and on again from the row: no other chip moves at any frame (a fourth chip coming had made them give way).
      await startChipFrames(others, 1_800);
      await clickAt(button.x, button.y);
      await waitPins((report) => !report.pins.includes(rowOnce), `${rowOnce} was not taken off`);
      await browser.pause(450);
      const chipOff = await stateOf();
      await clickAt(button.x, button.y);
      await waitPins((report) => report.pins.includes(rowOnce), `${rowOnce} was not pinned again`);
      await browser.pause(450);
      const chipBack = await stateOf();
      const boxBack = chipBack === null ? null : await chipBox(rowOnce);
      const neighbours = new Set((await readChipFrames()).map((frame) => frame.join(',')));
      await leaveList();
      await browser.pause(900);
      const boxLeft = await chipBox(rowOnce);
      measures['chip-at-once'] = {
        listInside: pinnedIn?.listInside ?? null,
        chipWhilePointerOnRow: chipPinned,
        takenOff: chipOff,
        pinnedAgain: chipBack,
        samePlace: boxPinned !== null && boxBack !== null && boxPinned.x === boxBack.x && boxBack.x === boxLeft.x,
        neighboursUnmovedOffAndOn: neighbours.size === 1,
        list: { before: beforeOnce.scTop, after: afterOnce.scTop, scrollTop: [beforeOnce.scrollTop, afterOnce.scrollTop], unmoved: beforeOnce.scTop === afterOnce.scTop && beforeOnce.scrollTop === afterOnce.scrollTop },
      };
      // Back to the pins of before: the new chip is the last one, nothing stands after it.
      const x = await overChip(rowOnce, ' .cg-pin__x');
      await clickAt(x.x, x.y);
      await leaveList();
      await waitPins((report) => report.chips.length === pinsOnce.length && report.chips.every((item) => item.state === 'shown'), 'the pins of before did not come back');
    }
    save();

    // ── A4: 15 s idle with three pins: no mutation of ours ──
    await startMutations();
    await browser.pause(15_000);
    measures['A4-idle-15s'] = await readMutations();
    save();

    // ── A6: a second tab takes off the first of three chips while the pointer is on this tab's third chip ──
    const now6 = (await pinsReport())?.pins ?? [];
    const [c1, c2, c3] = now6;
    if (c1 !== undefined && c2 !== undefined && c3 !== undefined) {
      const firstTab = await browser.getWindowHandle();
      await overChip(c3);
      await waitPins((report) => report.held, 'the strip did not hold under the pointer');
      const before7 = await geometry();
      const xs7 = [(await chipBox(c2)).x, (await chipBox(c3)).x];
      const secondTab = (await browser.createWindow('window')).handle;
      await browser.switchToWindow(secondTab);
      // As wide as the first: at 1200 px and below Fansly hides the list with a chat open (the stand's rule is off here).
      await browser.browsingContextSetViewport({ context: secondTab, viewport: { width: 1440, height: 900 } });
      await browser.url(fanslyStandUrl(`/messages/${open}`));
      await waitForFanslyStandReady();
      await browser.waitUntil(async () => (await $(SLOT).isExisting()) && (await $(SLOT).shadow$(`.cg-pin[data-pin-group="${c1}"] .cg-pin__x`).isExisting()), { timeout: 20_000, timeoutMsg: 'no strip in the second tab' });
      await browser.pause(400);
      await overChip(c1);
      await browser.pause(200);
      const x1 = await overChip(c1, ' .cg-pin__x');
      const clickedAt = await browser.execute(() => Date.now());
      await clickAt(x1.x, x1.y);
      await browser.pause(1200);
      const secondPins = (await pinsReport())?.pins ?? null;
      await browser.closeWindow();
      await browser.switchToWindow(firstTab);
      const tomb = await waitPins((report) => !report.pins.includes(c1), 'the first tab did not hear the unpin', 5_000);
      const after7 = await geometry();
      const xs7after = [(await chipBox(c2)).x, (await chipBox(c3)).x];
      await shootStrip(s, 'strip-placeholder-held', 60);
      await leaveList();
      await waitPins((report) => !report.chips.some((item) => item.groupId === c1), 'the placeholder did not close', 5_000);
      await browser.pause(400);
      await shootStrip(s, 'strip-placeholder-closed', 60);
      const heard = tomb.counts === null ? null : tomb.counts.changedAt - clickedAt;
      measures['A6-second-tab'] = {
        heardMs: heard,
        withinOneSecond: heard !== null && heard <= 1000,
        firstChipWhileHeld: tomb.chips.find((item) => item.groupId === c1)?.state ?? null,
        othersX: { before: xs7, whileHeld: xs7after, unchanged: JSON.stringify(xs7) === JSON.stringify(xs7after) },
        stripUnchanged: JSON.stringify(before7.strip) === JSON.stringify(after7.strip) && before7.scTop === after7.scTop,
        secondTabPins: secondPins,
      };
    }
    save();

    // ── The light theme: the strip and a row's button, with and without a badge ──
    await callFansly('setTheme', 'bright');
    await browser.pause(300);
    await shootStrip(s, 'strip-light');
    const lightRows = (await renderedRows()).slice(0, 8);
    const freshGroups = await callFansly('groups');
    const unreadNow = (group: string): number => freshGroups.find((item) => item.id === group)?.unread ?? 0;
    const pinsNow = (await pinsReport())?.pins ?? [];
    const lightWith = lightRows.find((group) => group !== open && unreadNow(group) > 0 && !pinsNow.includes(group));
    const lightWithout = lightRows.find((group) => group !== open && unreadNow(group) === 0 && !pinsNow.includes(group));
    if (lightWith !== undefined) {
      await hoverRow(lightWith);
      await shootRow(s, 'row-hover-badge-light', lightWith);
    }
    if (lightWithout !== undefined) {
      await hoverRow(lightWithout);
      await shootRow(s, 'row-hover-light', lightWithout);
    }
    const pinnedRow = pinsNow.find((group) => group !== open && lightRows.includes(group));
    if (pinnedRow !== undefined) {
      await hoverRow(pinnedRow);
      await shootRow(s, 'row-hover-pinned-light', pinnedRow);
    }
    await leaveList();
    await callFansly('setTheme', 'dark');
    save();

    // ── FBuddy beside the list (its stand-in: no gap under the chips, a line added to each row) ──
    await setFanslyNeighbor({ mode: 'after' });
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitPins((report) => report.mounted && report.height === 44, 'no strip with FBuddy', 20_000);
    // The strip may slide in once the page shows rows: the rows stand still again before the pointer goes over them.
    await browser.pause(600);
    const fbGroups = await callFansly('groups');
    const fbPins = (await pinsReport())?.pins ?? [];
    const fbRows = (await renderedRows()).slice(0, 8).filter((group) => group !== open && !fbPins.includes(group));
    const fbWith = fbRows.find((group) => (fbGroups.find((item) => item.id === group)?.unread ?? 0) > 0);
    const fbWithout = fbRows.find((group) => (fbGroups.find((item) => item.id === group)?.unread ?? 0) === 0);
    if (fbWith !== undefined) {
      await hoverRow(fbWith);
      await shootRow(s, 'row-hover-badge-fbuddy', fbWith);
    }
    if (fbWithout !== undefined) {
      await hoverRow(fbWithout);
      await shootRow(s, 'row-hover-fbuddy', fbWithout);
    }
    const noButton: string[] = [];
    for (let tries = 0; tries < 14; tries += 1) {
      const nowPins = (await pinsReport())?.pins ?? [];
      if (nowPins.length >= 6) break;
      const next = (await renderedRows()).find((group) => !nowPins.includes(group) && !noButton.includes(group));
      if (next === undefined) break;
      const button = await hoverRow(next, 2_000).catch(() => null);
      if (button === null) {
        noButton.push(next);
        continue;
      }
      await clickAt(button.x, button.y);
      await waitPins((report) => report.pins.includes(next), `${next} was not pinned`);
    }
    await leaveList();
    await waitPins((report) => report.height === 44 && report.chips.every((item) => item.state === 'shown'), 'the six chips did not settle');
    await browser.pause(400);
    measures['fbuddy'] = { rowsWithoutButton: noButton, chips: (await pinsReport())?.chips.length ?? null, geometry: await geometry() };
    await shootStrip(s, 'strip-six-fbuddy');
    await overChip(((await pinsReport())?.pins ?? [])[2] ?? open);
    await browser.pause(250);
    await shootStrip(s, 'strip-six-fbuddy-hover', 40);
    await leaveList();
    await setFanslyNeighbor(null);
    await browser.refresh();
    await waitForFanslyStandReady();
    await waitPins((report) => report.mounted && report.height === 44, 'the strip did not come back without FBuddy', 20_000);
    await browser.pause(400);
    save();

    // ── 1100 px wide with Fansly's rule on (the list column hidden with a chat open), then 768 px high ──
    const context = await browser.getWindowHandle();
    await callFansly('setNarrowRule', true);
    await browser.browsingContextSetViewport({ context, viewport: { width: 1100, height: 900 } });
    await browser.pause(500);
    await s.shot('narrow-1100');
    measures['narrow-1100'] = { listShown: (await geometry()).scHeight > 0, headerButton: await $(HEADER_PIN).isExisting() };
    await callFansly('setNarrowRule', false);
    await browser.browsingContextSetViewport({ context, viewport: { width: 1440, height: 768 } });
    await browser.pause(500);
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
    if (row !== null) await s.shot('options-pins-row', { clip: around([{ x: row.x - 500, y: row.y - 150, width: 1000, height: row.height + 270 }]) });
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
    await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as Record<string, { at: number | null } | undefined>)['__cgOff']?.at ?? null)) !== null, { timeout: 5_000, interval: 50, timeoutMsg: 'the pins stayed after the switch went off' });
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
    await waitPins((report) => report.on === true && report.mounted && report.height === 44, 'the strip did not come back with the switch');
    await browser.pause(500);
    save();

    // ── A13: to another page of the site and back by its own link: the strip is there with the list's first frame ──
    await $('a.nav-bar-item[href="/home"]').click();
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith('/home'), { timeout: 8_000, timeoutMsg: 'not on /home' });
    await browser.pause(400);
    await browser.execute(() => {
      const frames: Array<{ t: number; scTop: number; rows: number; strip: number }> = [];
      (window as unknown as Record<string, unknown>)['__cgBack'] = frames;
      const t0 = performance.now();
      const tick = (): void => {
        const list = document.querySelector('.messages-list-wrapper .message-list');
        const host = document.querySelector('[data-host="inbox-slot"]');
        if (list !== null) frames.push({ t: Math.round(performance.now() - t0), scTop: list.getBoundingClientRect().top, rows: list.querySelectorAll('a[href^="/messages/"]').length, strip: host === null ? -1 : host.getBoundingClientRect().height });
        if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await $('a.nav-bar-item[href="/messages"]').click();
    await browser.pause(2_600);
    const back = await browser.execute(() => ((window as unknown as Record<string, unknown>)['__cgBack'] ?? []) as Array<{ t: number; scTop: number; rows: number; strip: number }>);
    const firstRows = back.find((frame) => frame.rows > 0) ?? null;
    const lastBack = back[back.length - 1] ?? null;
    measures['A13-back-to-list'] = { firstFrame: back[0] ?? null, firstRowFrame: firstRows, lastFrame: lastBack, scTopMoveAfterFirstRow: firstRows === null || lastBack === null ? null : lastBack.scTop - firstRows.scTop, distinctTops: [...new Set(back.filter((frame) => frame.rows > 0).map((frame) => frame.scTop))] };
    await shootStrip(s, 'back-to-list', 100);
    await callFansly('open', open);
    await browser.waitUntil(async () => (await browser.getUrl()).endsWith(`/messages/${open}`), { timeout: 8_000 });
    await browser.pause(500);
    save();

    // ── An expired pin: the stored pins with one quiet for six hours, read again with the reload (A8) ──
    await s.toPages();
    const stored = (await readLocalStorage(['fansly.pins']))['fansly.pins'] as { accounts: Record<string, Array<{ groupId: string; touchedAt: number }>> } | undefined;
    let expired: string | null = null;
    if (stored !== undefined) {
      for (const pinsOf of Object.values(stored.accounts)) {
        const victim = pinsOf.find((pin) => pin.groupId !== open) ?? pinsOf[0];
        if (victim !== undefined) {
          victim.touchedAt = Date.now() - 6 * 60 * 60 * 1000 - 60_000;
          expired = victim.groupId;
        }
      }
      await writeLocalStorage({ 'fansly.pins': stored });
    }
    await s.toChat();
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
      stripCameMs: reload.find((frame) => frame.strip > 0)?.t ?? null,
      stripFullMs: reload.find((frame) => frame.strip >= 44)?.t ?? null,
      expiredPinGone: expired === null ? null : !((await pinsReport())?.pins.includes(expired) ?? true),
    };
    save();

    // ── The last unpin and a first pin again, with the list scrolled (A2 with non-zero spacers) ──
    const left = (await pinsReport())?.pins ?? [];
    await leaveList();
    for (const group of left.filter((item) => item !== open)) {
      await overChip(group);
      await browser.pause(150);
      const x = await overChip(group, ' .cg-pin__x');
      await clickAt(x.x, x.y);
      await browser.pause(150);
      await leaveList();
      await browser.pause(450);
    }
    if (!((await pinsReport())?.pins ?? []).includes(open)) {
      await $(HEADER_PIN).shadow$('.cg-ph__button').click();
      await waitPins((report) => report.pins.includes(open), 'the open chat was not pinned again');
    }
    await waitPins((report) => report.pins.length === 1 && report.chips.length === 1 && report.chips.every((item) => item.state === 'shown'), 'one pin left');
    await scrollList(1200);
    await overChip(open);
    await browser.pause(250);
    await shootStrip(s, 'chip-hover-x', 40);
    const before8 = await geometry();
    const x8 = await overChip(open, ' .cg-pin__x');
    await clickAt(x8.x, x8.y);
    await browser.pause(300);
    const whileIn = await pinsReport();
    await startFrames(900);
    await leaveList();
    await browser.pause(950);
    const framesOut = await readFrames();
    const after8 = await geometry();
    const a2scrolled: Record<string, unknown> = {
      lastUnpin: {
        whilePointerInList: { height: whileIn?.height ?? null },
        before: before8,
        after: after8,
        spacersNonZero: before8.spacers.some((value) => value > 0),
        scrollTopUnchanged: before8.scrollTop === after8.scrollTop,
        spacersUnchanged: JSON.stringify(before8.spacers) === JSON.stringify(after8.spacers),
        scTopMove: after8.scTop - before8.scTop,
        frames: motion(framesOut),
        stripGone: after8.strip === null,
      },
    };
    // The first pin again from the header (the pointer is not over the list): it slides in at once.
    const before8b = await geometry();
    await startFrames(900);
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await browser.pause(950);
    const framesIn8 = await readFrames();
    const after8b = await geometry();
    a2scrolled['firstPinFromHeader'] = {
      before: before8b,
      after: after8b,
      scrollTopUnchanged: before8b.scrollTop === after8b.scrollTop,
      spacersUnchanged: JSON.stringify(before8b.spacers) === JSON.stringify(after8b.spacers),
      scTopMove: after8b.scTop - before8b.scTop,
      frames: motion(framesIn8),
    };
    measures['A2-scrolled'] = a2scrolled;
    await $(HEADER_PIN).shadow$('.cg-ph__button').click();
    await waitPins((report) => report.pins.length === 0, 'the last pin did not go');
    await browser.pause(600);
    await scrollList(0);
    const plainAgain = (await renderedRows()).find((group) => group !== open && (tops[group] ?? 999) < 640) ?? rPlain;
    await hoverRow(plainAgain);
    await shootList(s, 'no-pins', 420);

    // No two pictures the same.
    const byHash = new Map<string, string[]>();
    for (const file of readdirSync(s.out).filter((name) => name.endsWith('.png'))) {
      const hash = createHash('sha256').update(readFileSync(join(s.out, file))).digest('hex');
      byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
    }
    measures['duplicatePictures'] = [...byHash.values()].filter((files) => files.length > 1);
    save();
    lap(`measures: ${join(s.out, 'pins-measures.json')}`);
  },
  { sites: ['fansly'], showcase: true, timeout: 600_000 },
);
