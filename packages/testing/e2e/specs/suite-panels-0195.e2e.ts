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
//   result gives the panel its height back.
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
  /** The dock's full Recap, as on the live check: its sheet is open above the composer. */
  const openFullRecap = async (): Promise<void> => {
    if ((await oursText('dock')).includes('Командировка в Берлин')) return;
    await pressOurs('dock', '.cg-strip button', /^Recap/);
    await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    // A full Recap saved earlier opens from its row; the first one is built.
    await browser.waitUntil(async () => (await oursByText('dock', '.cg-dock button', /^Собрать полностью/)) !== null, { timeout: 10_000, timeoutMsg: 'the Recap picker did not show' });
    if (await oursExists('dock', '[data-cg-slot="full"] button')) await ours('dock', '[data-cg-slot="full"] button').click();
    else await pressOurs('dock', '.cg-dock button', /^Собрать полностью/);
    await waitOursText('dock', 'Командировка в Берлин', 'the full Recap in the dock', { timeout: 20_000 });
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

  it('[CS-031] [AI-080] ChatSpace’s panel open, the full Recap open: Coach takes the whole height beside the chat and its answer is whole in view', async function () {
    this.timeout(180_000);
    await openFullRecap();
    // The composer ends left of ChatSpace's own panel — the place our panel takes.
    const composer = await pageBox(EDITOR);
    expect((composer?.x ?? 0) + (composer?.width ?? 0)).toBeLessThan(WINDOW.width - 320);
    await askCoach();

    const box = await composerFree('.cg-coach');
    expect(['Coach height', box.height >= TALL_SHARE * WINDOW.height]).toEqual(['Coach height', true]);
    expect(['Coach reaches the bottom', Math.round(box.y + box.height) >= WINDOW.height - 12]).toEqual(['Coach reaches the bottom', true]);
    // The answer: its text whole on screen, nothing over it; the freshness bar and the question field whole too.
    expect(await reach('panel', '.cg-co__turn[data-cg-answer] .cg-co__md')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__turn[data-cg-answer] [data-cg-part="0"]')).toMatchObject({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__bar .cg-btn')).toEqual({ clippedPx: 0, onTop: true });
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

  it('[CS-031] [AI-080] ChatSpace’s panel closed — the composer reaches under our panel’s place: the panel ends at the dock’s top, the question field stays on screen, the answer opens at its start; «Скрыть» gives the height back', async function () {
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

    const box = await composerFree('.cg-coach');
    const dock = await pageBox(hostSelector('dock'));
    // The panel ends where the dock begins — not short of it, not past it.
    expect(Math.abs(box.y + box.height - (dock?.y ?? 0)) <= 1).toBe(true);
    // The question field and «Спросить» stay on screen however short the panel is.
    expect(await reach('panel', '.cg-co__ask textarea')).toEqual({ clippedPx: 0, onTop: true });
    expect(await reach('panel', '.cg-co__send .cg-btn')).toEqual({ clippedPx: 0, onTop: true });
    // The answer is taller than what is left for the turns: it opens at its start, not at the ready questions under it.
    const turns = await oursBox('panel', '.cg-co__turns');
    // The newest answer: the earlier ones of this chat's dialog are above it.
    const answers = await allOurs('panel', '.cg-co__turn[data-cg-answer] .cg-co__md').getElements();
    const newest = answers.at(-1);
    if (newest === undefined) throw new Error('no Coach answer on screen');
    const answer = await browser.execute((node: HTMLElement) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    }, newest as unknown as HTMLElement);
    expect(['answer starts inside the turns', (answer?.y ?? -1) >= (turns?.y ?? 0) && (answer?.y ?? Infinity) + 20 <= (turns?.y ?? 0) + (turns?.height ?? 0)]).toEqual(['answer starts inside the turns', true]);
    await pictures('panels-0195-closed-coach');

    // «Скрыть» on the dock's result: the dock is the strip again, and the panel takes the height back.
    await pressOurs('dock', '.cg-dock button', /^Скрыть/);
    await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
    await twoFrames();
    const tall = await composerFree('.cg-coach');
    expect(['Coach after «Скрыть»', tall.height >= 0.7 * WINDOW.height]).toEqual(['Coach after «Скрыть»', true]);
    await closeAll();
    await callStand('setSidePanel', 'open');
  });
});
