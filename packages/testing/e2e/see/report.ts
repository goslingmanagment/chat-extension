// What the `report-*` scenarios share (hub package R, 2026-11-15): the board «Отчёт» over the site — the launcher's fifth
// row, the frame's layer and its bar, the highlight — and the stub board inside the frame (fake-hub/report-board.ts),
// or Hub's demo board when CG_SEE_FRAME_ORIGIN points the frames there.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser } from '@wdio/globals';

import { TEST_FRAME_ORIGIN_KEY } from '@cg/contracts/report-board';

import { writeLocalStorage } from '../support/extension';
import type { See } from './kit';

/** Our hosts: the frame's layer, its bar, the row's highlight. */
export const FRAME_LAYER = 'div[data-host="overlay"][data-layer="frame"]';
export const FRAME_BAR = 'div[data-host="overlay"][data-layer="frame-bar"]';
export const FRAME_MARK = 'div[data-host="overlay"][data-layer="frame-mark"]';
/** The pulse's board the fake hub answers in these scenarios: a draft that waits for the person (the launcher's dot). */
export const REPORT_PULSE = { shiftId: 41, phase: 'draft', needsMe: true } as const;

/** Hub's demo board instead of the stand's stub, when the coordinator gives its address (`CG_SEE_FRAME_ORIGIN`). */
export async function pointFrames(s: See): Promise<void> {
  const origin = process.env['CG_SEE_FRAME_ORIGIN'];
  if (origin === undefined || origin === '') return;
  await s.toPages();
  await browser.url(s.page('popup.html'));
  await writeLocalStorage({ [TEST_FRAME_ORIGIN_KEY]: origin });
  await s.toChat();
  console.log(`cg-see frames from ${origin}`);
}

/** The launcher's button of a target, in its closed root. */
export const launcherButton = (host: string, target: string) => $(host).shadow$(`button[data-launcher="${target}"]`);

/** Whether the launcher shows the fifth row and its dot. */
export async function reportRow(host: string): Promise<{ readonly shown: boolean; readonly dot: boolean; readonly rows: number }> {
  const buttons = await $(host).shadow$$('button[data-launcher]:not([hidden])').getElements();
  const report = launcherButton(host, 'report');
  const shown = (await report.isExisting()) && (await report.getAttribute('hidden')) === null;
  const dot = shown && (await report.$('.mark').isExisting());
  return { shown, dot, rows: buttons.length };
}

/** The layer shows (its host displayed). */
export async function layerShown(): Promise<boolean> {
  return browser.execute((selector: string) => {
    const host = document.querySelector<HTMLElement>(selector);
    return host !== null && host.style.display !== 'none' && host.getBoundingClientRect().height > 0;
  }, FRAME_LAYER);
}

/** The bar's words; '' — no bar. */
export async function barText(): Promise<string> {
  const bar = $(FRAME_BAR);
  if (!(await bar.isExisting())) return '';
  const shown = await browser.execute((selector: string) => document.querySelector<HTMLElement>(selector)?.style.display !== 'none', FRAME_BAR);
  if (!shown) return '';
  return (await bar.shadow$('.mini').getText().catch(() => '')).replace(/\s+/g, ' ').trim();
}

/** Runs `fn` inside the board's frame, then back in the site's page. */
export async function inFrame<T>(fn: () => Promise<T>): Promise<T> {
  const frame = await $(FRAME_LAYER).shadow$('iframe');
  await browser.switchFrame(frame);
  try {
    return await fn();
  } finally {
    await browser.switchFrame(null);
  }
}

/** Esc pressed in the board (a click on its title first: the keys go where the focus is). */
export async function escapeInFrame(): Promise<'keys' | 'event'> {
  return inFrame(async () => {
    const title = browser.$('header b');
    if (await title.isExisting()) await title.click();
    else await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    try {
      await browser.keys('Escape');
      return 'keys';
    } catch {
      // Firefox's test input sometimes refuses a key in a frame (nsITextInputProcessor): the board's own keydown then.
      await browser.execute(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      return 'event';
    }
  });
}

/** The stub's protocol line (what the frame heard last). */
export async function frameLog(): Promise<string> {
  return inFrame(async () => ((await browser.$('#log').getText().catch(() => '')) as string).trim());
}

/** Waits until the stub's line says `pattern`. */
export async function waitFrameLog(pattern: RegExp, timeout = 20_000): Promise<string> {
  let last = '';
  await browser.waitUntil(
    async () => {
      last = await frameLog().catch(() => '');
      return pattern.test(last);
    },
    { timeout, interval: 300, timeoutMsg: `the frame did not say ${String(pattern)} (last: «${last}»)` },
  );
  return last;
}

/** Presses a button of the stub board by its text. */
export async function pressInFrame(text: string): Promise<void> {
  await inFrame(async () => {
    const button = await browser.$(`//button[normalize-space()="${text}"]`);
    await button.click();
  });
}

/** Presses «show on the site» of a stub row by the mark it shows (`#…5305`, `22:12`). */
export async function findInFrame(mark: string): Promise<void> {
  await inFrame(async () => {
    const link = await browser.$(`//div[contains(@class,"r2")]/a[normalize-space()="${mark}"]`);
    await link.click();
  });
}

/** The bar shows and says `pattern`. */
export async function waitBar(pattern: RegExp, timeout = 30_000): Promise<string> {
  let last = '';
  await browser.waitUntil(
    async () => {
      last = await barText();
      return pattern.test(last);
    },
    { timeout, interval: 300, timeoutMsg: `the bar did not say ${String(pattern)} (last: «${last}»)` },
  );
  return last;
}

/** The highlight's box over the site, or null. */
export async function markBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (!(await $(FRAME_MARK).isExisting())) return null;
  const box = await $(FRAME_MARK).shadow$('.hl');
  if (!(await box.isExisting())) return null;
  const { x, y, width, height } = await box.getLocation().then(async (at) => ({ ...at, ...(await box.getSize()) }));
  return { x, y, width, height };
}

/**
 * Whether anything of ours that is shown overlaps the site's message field, our dock or our launcher: the bar, the
 * highlight, the board's layer. Each name → the boxes it crosses; {} — nothing covers anything.
 */
export async function overlaps(composer: string, launcher: string): Promise<Record<string, string[]>> {
  return browser.execute(
    (field: string, launch: string, ours: readonly string[]) => {
      const box = (node: Element | null): DOMRect | null => {
        if (node === null) return null;
        const style = node instanceof HTMLElement ? node.style : null;
        if (style !== null && style.display === 'none') return null;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? rect : null;
      };
      const cross = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const targets: Record<string, DOMRect | null> = { composer: box(document.querySelector(field)), dock: box(document.querySelector('div[data-host="dock"]')), launcher: box(document.querySelector(launch)) };
      const out: Record<string, string[]> = {};
      for (const selector of ours) {
        const mine = box(document.querySelector(selector));
        if (mine === null) continue;
        const hit = Object.entries(targets).filter(([, target]) => target !== null && cross(mine, target)).map(([name]) => name);
        if (hit.length > 0) out[selector] = hit;
      }
      return out;
    },
    composer,
    launcher,
    [FRAME_BAR, FRAME_MARK, FRAME_LAYER],
  );
}

/** What the site's page itself can see of the frame (closed root): the number of iframes in its DOM. */
export async function pageSeesFrames(): Promise<number> {
  return browser.execute(() => document.querySelectorAll('iframe').length);
}

/** A page script imitating the frame: a hello of v1 and a `ready` of v2 posted to the site's window (ignored). */
export async function forgeHello(): Promise<void> {
  await browser.execute(() => {
    window.postMessage({ cg: 'report-board/hello', v: 1 }, '*');
    window.postMessage({ cg: 'report-board/hello', v: 2 }, '*');
    window.postMessage({ t: 'ready', v: 2 }, '*');
  });
}

/** The run's facts in `report.json` beside its pictures. */
export function writeFacts(s: See, facts: Record<string, unknown>): void {
  writeFileSync(join(s.out, 'report-facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  console.log(`cg-see report facts: ${JSON.stringify(facts)}`);
}
