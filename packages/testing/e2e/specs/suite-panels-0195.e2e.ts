// The side panels on ChatSpace 0.195's layout (third live check, 2026-10-08;
// ui-design §3.7, §4.18, §4.19). ChatSpace 0.195 shows its own ~320 px panel
// of the fan next to the chat and an icon rail at the far right; the
// conversation and its composer end left of that panel. Our fan panel and
// Coach stand at the right edge, over ChatSpace's panel. On the live check,
// with a full Recap open in the dock, both were cut to ~300 px at the dock's
// top — a cut that only protects a composer under the panel, and there was
// none: the Coach answer was out of sight and the fan panel's «Подписка» cut.
// At the owner's window (1728 × 930 CSS px):
// - ChatSpace's panel open: a panel of ours takes the whole height under the
//   top bar, nothing of the composer or our dock is under it, the Coach answer
//   is whole in view, the fan panel's sections are whole, and the wheel
//   scrolls a panel's body;
// - ChatSpace's panel closed (the composer reaches the rail, under our panel's
//   place): the panel still ends at the dock's top, the question field stays
//   on screen, the Coach answer opens at its start, and «Скрыть» on the dock's
//   result gives the panel its height back;
// - a toast never lies over an open panel: «Recap сохранён в хаб» lay on
//   Coach's header on the live check. Shown before a panel opens, the stack
//   moves once, left of it; shown while a panel is open, it comes there;
//   with the panel closed it is back at its own place — in the owner's window
//   and in a narrow one.
// Pictures in both themes go to .cache/e2e/.

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { EDITOR, SEND, twoFrames } from '../support/chat';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { allOurs, hostSelector, ours, oursBox, oursByText, oursExists, oursFocus, oursText, pressOurs, waitOursText, type Box, type Where } from '../support/ours';
import { dockIs, startShift } from '../support/shift';
import { callStand, foreignCalls, standServer } from '../support/stand';
import { saveStandSnapshots, setViewport } from '../support/visual';

const WINDOW = { width: 1728, height: 930 } as const;
/** A narrow window (the owner's smoke checklist: about 1100 px). */
const NARROW = { width: 1100, height: 800 } as const;
/** ui-design §3.9: the toasts' own place, 84 px off the window's right edge, and their gap to an open panel. */
const TOAST_RIGHT = 84;
const TOAST_GAP = 20;
/** A panel shorter than this share of the window is the live check's cramped panel. */
const TALL_SHARE = 0.8;

const RECAP = [
  '## Кто он',
  'Hubert, 34, часто летает по работе. Пишет вечером по Москве, отвечает коротко.',
  '',
  '## Что покупал',
  '- сет «Утро» за $25, вчера',
  '- два видео за $40 на прошлой неделе',
  '',
  '## Как с ним говорить',
  'Без давления: сначала разговор о дне, потом предложение. Любит, когда помнят детали о перелётах.',
  '',
  '## Чего избегать',
  'Не начинать с цены. Не слать подряд два платных сообщения.',
  '',
  '## Последние темы',
  'Командировка в Берлин, новая работа, спортзал по утрам, сериал про космос.',
].join('\n');

const COACH = [
  'Сегодня можно, но не первым сообщением.',
  '',
  'Сначала спроси про перелёт: он вчера писал, что летит в Берлин. Когда ответит, предложи сет «Вечер» — он похож на «Утро», который он купил.',
  '',
  'Если скажет «нет», не дави: оставь превью на завтра.',
  '',
  '```draft',
  'how was the flight, my traveler?',
  '```',
].join('\n');

/** The part of `a` that lies under `b`, in square pixels. */
const overlap = (a: Box | null, b: Box | null): number => {
  if (a === null || b === null) return 0;
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? Math.round(width * height) : 0;
};

const pageBox = (selector: string): Promise<Box | null> =>
  browser.execute((sel: string) => {
    const rect = document.querySelector(sel)?.getBoundingClientRect();
    return rect === undefined ? null : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);

/**
 * An element of ours as a person sees it: how many square pixels of it lie outside the clipping ancestors of its
 * closed root and the window, and whether it is on top in its own middle. `null` — not in the document.
 */
async function reach(where: Where, selector: string): Promise<{ readonly clippedPx: number; readonly onTop: boolean } | null> {
  const element = ours(where, selector);
  if (!(await element.isExisting())) return null;
  return browser.execute(
    (node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      let left = Math.max(rect.left, 0);
      let top = Math.max(rect.top, 0);
      let right = Math.min(rect.right, window.innerWidth);
      let bottom = Math.min(rect.bottom, window.innerHeight);
      for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const box = parent.getBoundingClientRect();
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        right = Math.min(right, box.right);
        bottom = Math.min(bottom, box.bottom);
      }
      const shown = Math.max(0, right - left) * Math.max(0, bottom - top);
      const root = node.getRootNode() as ShadowRoot;
      const hit = root.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { clippedPx: Math.round(rect.width * rect.height - shown), onTop: hit !== null && (hit === node || node.contains(hit)) };
    },
    (await element.getElement()) as unknown as HTMLElement,
  );
}

/** The scroll position of an element of ours. */
async function scrollOf(where: Where, selector: string): Promise<{ readonly top: number; readonly room: number }> {
  return browser.execute(
    (node: HTMLElement) => ({ top: node.scrollTop, room: node.scrollHeight - node.clientHeight }),
    (await ours(where, selector).getElement()) as unknown as HTMLElement,
  );
}

describe('the side panels on ChatSpace 0.195’s layout — the owner’s 1728 × 930 window (third live check)', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;

  const leaveField = (): Promise<void> => $('[data-stand-conversation-header]').click();
  const closeAll = async (): Promise<void> => {
    for (let press = 0; press < 5 && (await dockIs(() => true, 'the dock')).overlays.length > 0; press += 1) {
      await browser.keys(Key.Escape);
      await browser.pause(150);
    }
    expect((await dockIs(() => true, 'the dock')).overlays).toEqual([]);
  };
  /** Nothing of ChatSpace's composer and of our dock lies under the panel; Send and the field take the pointer. */
  const composerFree = async (panel: string): Promise<Box> => {
    await twoFrames();
    const box = await oursBox('panel', panel);
    if (box === null) throw new Error(`${panel} is not on screen`);
    expect([panel, 'Send', overlap(box, await pageBox(SEND))]).toEqual([panel, 'Send', 0]);
    expect([panel, 'field', overlap(box, await pageBox(EDITOR))]).toEqual([panel, 'field', 0]);
    expect([panel, 'dock', overlap(box, await pageBox(hostSelector('dock')))]).toEqual([panel, 'dock', 0]);
    return box;
  };
  /** Coach (X63): the old extension's window over a scrim — whole inside the browser window, at most 720 px wide and 84 % high. */
  const coachWindow = async (): Promise<Box> => {
    await twoFrames();
    const box = await oursBox('panel', '.cg-coach');
    if (box === null) throw new Error('.cg-coach is not on screen');
    const view = await browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(['Coach inside the window', box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1]).toEqual(['Coach inside the window', true]);
    expect(['Coach size', box.width <= 721 && box.height <= Math.min(0.84 * view.height, 860) + 1]).toEqual(['Coach size', true]);
    return box;
  };
  /** The dock's full Recap, as on the live check: its sheet is open above the composer. */
  const openFullRecap = async (): Promise<void> => {
    if ((await oursText('dock')).includes('Командировка в Берлин')) return;
    await pressOurs('dock', '.cg-strip button', /^Recap/);
    await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    // X55: a full Recap saved earlier opens in its «Развернуть ↗» window at once; the first one is built from the picker.
    const shown = async (): Promise<boolean> => oursExists('modal', '.cg-xdlg');
    await browser.waitUntil(async () => (await shown()) || (await oursByText('dock', '.cg-dock button', /^Собрать полностью/)) !== null, { timeout: 10_000, timeoutMsg: 'neither the Recap window nor its picker showed' });
    if (!(await shown())) {
      if (await oursExists('dock', '[data-cg-slot="full"] button')) await ours('dock', '[data-cg-slot="full"] button').click();
      else await pressOurs('dock', '.cg-dock button', /^Собрать полностью/);
    }
    await waitOursText('modal', 'Командировка в Берлин', 'the full Recap in its window', { timeout: 20_000, selector: '.cg-xdlg' });
    // «Свернуть Esc» puts it into the dock's sheet, where these pictures want it — the tallest sheet next to the panels.
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await shown()), { timeout: 5000, timeoutMsg: 'Esc did not fold the Recap window into the sheet' });
    await waitOursText('dock', 'Командировка в Берлин', 'the full Recap in the dock', { timeout: 5000 });
  };
  /** Pictures in both themes at the owner's window, with the pointer off our controls (no hover) and colours settled. */
  const pictures = async (name: string): Promise<void> => {
    await browser.action('pointer').move({ origin: await $('[data-stand-conversation-header]').getElement(), x: 0, y: 0 }).perform();
    await saveStandSnapshots(name, { viewports: [WINDOW], settleMs: 300 });
    await setViewport(WINDOW);
  };
  const askCoach = async (): Promise<void> => {
    await pressOurs('dock', '.cg-strip button', /^Coach/);
    await browser.waitUntil(async () => (await oursFocus('panel'))?.label === 'Вопрос Coach', { timeout: 10_000, timeoutMsg: 'the Coach field did not take the focus' });
    await browser.keys('Стоит ли сейчас предлагать сет?'.split(''));
    await browser.keys(Key.Enter);
    await waitOursText('panel', 'не дави: оставь превью на завтра', 'the Coach answer', { timeout: 20_000 });
    await twoFrames();
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiTexts: { 'fan-summary': RECAP, 'coach-chat': COACH } } });
    await startShift(hub(), { viewport: WINDOW });
    await callStand('setSidePanel', 'open');
    await $('[data-stand-side-panel]').waitForExist({ timeout: 5000, timeoutMsg: 'the stand did not show ChatSpace 0.195’s panel' });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[CS-031] [AI-080] ChatSpace’s panel open, the full Recap open: Coach is the old window over the chat and its answer is whole in view', async function () {
    this.timeout(180_000);
    await openFullRecap();
    // The composer ends left of ChatSpace's own panel — the place our panel takes.
    const composer = await pageBox(EDITOR);
    expect((composer?.x ?? 0) + (composer?.width ?? 0)).toBeLessThan(WINDOW.width - 320);
    await askCoach();

    await coachWindow();
    // The answer: its text whole on screen, nothing over it; the topbar and the question field whole too.
    expect(await reach('panel', '[data-cg-answer] .cg-co__md')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '[data-cg-answer] [data-cg-part="0"]')).toMatchObject({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__top .cg-btn')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__ask textarea')).toEqual({ clippedPx: 0, onTop: true });

    await pictures('panels-0195-coach');
    await closeAll();
  });

  it('[CS-031] [CS-034] ChatSpace’s panel open: the fan panel takes the whole height, «Подписка» is whole, and the wheel scrolls the Recap tab', async function () {
    this.timeout(180_000);
    await closeAll();
    await openFullRecap();
    await leaveField();
    await browser.keys([']']);
    await waitOursText('panel', 'Fan Alder', 'the fan panel');
    const box = await composerFree('.cg-fp');
    expect(['fan panel height', box.height >= TALL_SHARE * WINDOW.height]).toEqual(['fan panel height', true]);
    // Every section of the «Фан» tab is whole in view; the footer is on its own line under them.
    expect(await reach('panel', '.cg-fp__body .cg-fp__sec:nth-child(2)')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-fp__foot')).toEqual({ clippedPx: 0, onTop: true });
    await pictures('panels-0195-fan');

    // The Recap tab is longer than the panel at a smaller window: the wheel over its body scrolls it.
    await setViewport({ width: WINDOW.width, height: 560 });
    await twoFrames();
    await ours('panel', '.cg-fp__tabs [role="tab"]:last-child').click();
    await waitOursText('panel', 'Последние темы', 'the saved Recap in the panel', { timeout: 15_000 });
    await twoFrames();
    const before = await scrollOf('panel', '.cg-fp__body');
    expect(['the Recap tab overflows its body', before.room > 0]).toEqual(['the Recap tab overflows its body', true]);
    await browser.action('wheel').scroll({ origin: await ours('panel', '.cg-fp__body').getElement(), deltaX: 0, deltaY: 300, duration: 50 }).perform();
    await browser.waitUntil(async () => (await scrollOf('panel', '.cg-fp__body')).top > before.top, { timeout: 5000, timeoutMsg: 'the wheel over the fan panel did not scroll it' });
    await setViewport(WINDOW);
    await closeAll();
  });

  it('[ER-009] [CS-031] a toast never lies over an open side panel: shown before the panel opens it moves once, left of it; shown while it is open it comes there; closed, it is back; the Coach window leaves it in its corner', async function () {
    this.timeout(240_000);
    await closeAll();
    await callStand('setSidePanel', 'open');
    await openFullRecap();
    const toastBox = (): Promise<Box | null> => oursBox('toast', '.cg-toast');
    const panelBox = (): Promise<Box | null> => oursBox('panel', '.cg-side');
    /** «Recap сохранён в хаб» — the live check's toast: the full Recap built again and saved to the hub. */
    const savedToast = async (): Promise<void> => {
      await waitOursText('toast', 'Recap сохранён в хаб', 'the toast before went by itself', { gone: true, timeout: 15_000 });
      await pressOurs('dock', '.cg-dock button', /^Обновить/);
      await waitOursText('toast', 'Recap сохранён в хаб', 'the «Recap сохранён в хаб» toast', { timeout: 20_000 });
      // Its 140 ms appearance (6 px up) is over: where it stands is measured, not where it rises from.
      await browser.pause(250);
    };
    /** The toast is whole left of the open panel, 20 px off — not one pixel of the panel's header or controls under it. */
    const besidePanel = async (width: number, message: string): Promise<Box> => {
      let toast: Box | null = null;
      let panel: Box | null = null;
      try {
        await browser.waitUntil(
          async () => {
            [toast, panel] = [await toastBox(), await panelBox()];
            return toast !== null && panel !== null && overlap(toast, panel) === 0 && Math.abs(panel.x - (toast.x + toast.width) - TOAST_GAP) <= 1;
          },
          { timeout: 2000, interval: 50 },
        );
      } catch {
        throw new Error(`${message}: the toast ${JSON.stringify(toast)} is not 20 px left of the panel ${JSON.stringify(panel)}`);
      }
      const shown = toast as unknown as Box;
      expect([message, shown.x >= 16, Math.round(shown.x + shown.width) <= width]).toEqual([message, true, true]);
      return shown;
    };
    /** Pictures in both themes while the pointer holds the toast on screen (hover stops its countdown). */
    const pictures = async (name: string, viewport: { readonly width: number; readonly height: number }): Promise<void> => {
      await browser.action('pointer').move({ origin: await ours('toast', '.cg-toast__t').getElement(), x: 0, y: 0 }).perform();
      await saveStandSnapshots(name, { viewports: [viewport], settleMs: 300 });
      await setViewport(WINDOW);
    };

    // The live check's order: the toast first, then the panel. Without a panel the toast stands where the panel will.
    await savedToast();
    const own = await toastBox();
    expect(own === null ? null : Math.round(WINDOW.width - (own.x + own.width))).toBe(TOAST_RIGHT);
    expect((own?.x ?? 0) + (own?.width ?? 0)).toBeGreaterThan(WINDOW.width - 320);
    // Coach is the old extension's window in the middle (X63), not a panel at the edge: the toast keeps its corner.
    await pressOurs('dock', '.cg-strip button', /^Coach/);
    await waitOursText('panel', 'Coach', 'the Coach window');
    await twoFrames();
    const kept = await toastBox();
    expect(kept === null ? null : Math.round(WINDOW.width - (kept.x + kept.width))).toBe(TOAST_RIGHT);
    await closeAll();
    // The fan panel opens under a toast: the toast moves once, sideways.
    await savedToast();
    const before = await toastBox();
    await leaveField();
    await browser.keys([']']);
    await waitOursText('panel', 'Fan Alder', 'the fan panel');
    const moved = await besidePanel(WINDOW.width, 'the fan panel opened under a toast');
    // One move, sideways: the top stays.
    expect(Math.round(moved.y)).toBe(Math.round(before?.y ?? -1));
    await closeAll();
    await browser.waitUntil(async () => {
      const back = await toastBox();
      return back === null || Math.round(WINDOW.width - (back.x + back.width)) === TOAST_RIGHT;
    }, { timeout: 2000, timeoutMsg: 'with the panel closed the toast did not come back to its own place' });

    // The panel first, then the toast: it comes beside the panel, at the owner's window and at a narrow one.
    await leaveField();
    await browser.keys([']']);
    await waitOursText('panel', 'Fan Alder', 'the fan panel');
    await savedToast();
    await besidePanel(WINDOW.width, 'a toast while the fan panel is open (1728 px)');
    await pictures('toast-beside-panel', WINDOW);
    await setViewport(NARROW);
    await twoFrames();
    await savedToast();
    await besidePanel(NARROW.width, 'a toast while the fan panel is open (1100 px)');
    await pictures('toast-beside-panel', NARROW);
    await setViewport(WINDOW);
    await closeAll();
  });

  it('[CS-031] [AI-080] ChatSpace’s panel closed — the composer reaches across the window: Coach stands the same, in the middle, the question field on screen, the answer opens at its start', async function () {
    this.timeout(180_000);
    await closeAll();
    await callStand('setSidePanel', 'closed');
    await browser.waitUntil(async () => !(await $('[data-stand-side-panel]').isExisting()), { timeout: 5000, timeoutMsg: 'ChatSpace’s panel did not close' });
    await openFullRecap();
    const composer = await pageBox(EDITOR);
    expect((composer?.x ?? 0) + (composer?.width ?? 0)).toBeGreaterThan(WINDOW.width - 320);
    const mark = await hub().mark();
    await askCoach();
    expect(callsTo((await hub().journal(mark)).entries, 'aiFeatureStream').length).toBe(1);

    // X63: the window does not end at the dock's top as the side panel did (X19) — the composer waits under its scrim.
    const box = await coachWindow();
    expect(['Coach height', box.height >= 0.7 * Math.min(0.84 * WINDOW.height, 860)]).toEqual(['Coach height', true]);
    // The question field and «Спросить» stay on screen.
    expect(await reach('panel', '.cg-co__ask textarea')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__send .cg-co__go')).toEqual({ clippedPx: 0, onTop: true });
    // An answer taller than what is left for the feed opens at its start, not at the ready questions under it.
    const turns = await oursBox('panel', '.cg-co__feed');
    // The newest answer: the earlier ones of this chat's dialog are above it.
    const answers = await allOurs('panel', '[data-cg-answer] .cg-co__md').getElements();
    const newest = answers.at(-1);
    if (newest === undefined) throw new Error('no Coach answer on screen');
    const answer = await browser.execute((node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }, newest as unknown as HTMLElement);
    expect(['answer starts inside the turns', (answer?.y ?? -1) >= (turns?.y ?? 0) && (answer?.y ?? Infinity) + 20 <= (turns?.y ?? 0) + (turns?.height ?? 0)]).toEqual(['answer starts inside the turns', true]);
    await pictures('panels-0195-closed-coach');
    await closeAll();
    await callStand('setSidePanel', 'open');
  });
});
