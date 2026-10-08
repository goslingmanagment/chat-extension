// §12 п. 4 on the wired extension, part 10 — the side panels, the debug
// block and the boards' small controls, by hand on the stand:
// - the fan panel and Coach end above the dock: ChatSpace's Send, its message
//   field and our strip stay in reach, and a message is typed and sent with
//   a panel open (architecture.md §12 п. 6 «composer не перекрыт»);
// - the fan panel's Recap tab of a tab that was just loaded reads the saved
//   Recap from the hub by itself (CS-031, REC-01);
// - with debug mode on, the open sheet of a Reply and a Coach answer carry
//   their «Отладка» block (ui-design §4.12; DB-013, DB-019), the collapsed
//   strip none (DB-020);
// - the «Тон» menu of a Spenders preview is whole on screen and a tone is
//   picked with the pointer (AI-005);
// - «Обновить» of the board reads it again (SP-024); S unfolds the statistics
//   and folds them back with the keys still ours (SP-049).

import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { EDITOR, PANEL, SEND, pressSend, twoFrames, typeDraft, waitForComposerText } from '../support/chat';
import { pageRpc } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { hostSelector, ours, oursBox, oursExists, oursFocus, pressOurs, waitOursText, type Box, type Where } from '../support/ours';
import { dockIs, startShift, type Shift } from '../support/shift';
import { foreignCalls, STAND_IDS, standServer, waitForChatReady, waitForStandReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const { a1 } = STAND_IDS.fans;
const WINDOW = { width: 1440, height: 900 } as const;

const AI_TEXTS: Readonly<Record<string, string>> = {
  'fan-summary': '## Кто он\nHubert, 34, часто летает по работе.\n\n## Что покупал\n- сет «Утро» за $25, вчера',
  'coach-chat': 'Сегодня можно, но не первым сообщением.\n\n```draft\nhow was the flight, my traveler?\n```',
};

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

/** What the page gives a pointer in the middle of ChatSpace's own element: the element itself, or what lies over it. */
const hitAt = (selector: string): Promise<string> =>
  browser.execute((sel: string) => {
    const node = document.querySelector(sel);
    if (node === null) return 'missing';
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (hit === null) return 'nothing';
    return hit === node || node.contains(hit) ? 'itself' : `${hit.tagName.toLowerCase()}[data-host=${hit.getAttribute('data-host') ?? ''}]`;
  }, selector);

/**
 * An element of ours as a pointer finds it: its box inside every clipping ancestor of its closed root and inside
 * the window, and the element on top in its own middle. `null` — not on screen.
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

describe('§12 п. 4 on the wired extension — the side panels, the debug block and the boards’ small controls', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;

  const leaveField = (): Promise<void> => $('[data-stand-conversation-header]').click();
  const closeAll = async (): Promise<void> => {
    for (let press = 0; press < 5 && (await dockIs(() => true, 'the dock')).overlays.length > 0; press += 1) {
      await browser.keys(Key.Escape);
      await browser.pause(150);
    }
    expect((await dockIs(() => true, 'the dock')).overlays).toEqual([]);
  };
  const setDebug = async (enabled: boolean): Promise<void> => {
    // Debug mode is switched in the settings page (only it may).
    await shift.toPages();
    await browser.url(testBuildPage('options.html'));
    expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled } }, baseRevision: null })).toMatchObject({ ok: true });
    await browser.url(testBuildPage(QUIET_PAGE));
    await shift.toStand();
  };
  /** A side panel of ours and ChatSpace's own controls: nothing of the composer is under the panel, and the pointer reaches each. */
  const composerInReach = async (panel: string): Promise<void> => {
    await twoFrames();
    const box = await oursBox('panel', panel);
    expect([panel, box !== null]).toEqual([panel, true]);
    const dock = await pageBox(hostSelector('dock'));
    expect([panel, 'Send', overlap(box, await pageBox(SEND))]).toEqual([panel, 'Send', 0]);
    expect([panel, 'field', overlap(box, await pageBox(EDITOR))]).toEqual([panel, 'field', 0]);
    expect([panel, 'dock', overlap(box, dock)]).toEqual([panel, 'dock', 0]);
    // The panel ends where the dock begins — not short of it, not past it.
    expect([panel, Math.abs((box?.y ?? 0) + (box?.height ?? 0) - (dock?.y ?? 0)) <= 1]).toEqual([panel, true]);
    expect([panel, await hitAt(SEND), await hitAt(EDITOR)]).toEqual([panel, 'itself', 'itself']);
  };

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiTexts: AI_TEXTS } });
    shift = await startShift(hub(), { viewport: WINDOW });
    await dockIs((d) => d.status === 'ready' && d.actions['reply'] === true, 'the dock of the open chat is ready');
  });

  after(async () => {
    await setDebug(false);
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
  });

  it('[CS-031] [REC-01] the fan panel’s Recap tab of a freshly loaded tab reads the Recap saved in the hub; nothing is generated for it', async function () {
    this.timeout(120_000);
    // The Recap is made once and saved to the hub…
    await pressOurs('dock', '.cg-strip button', /^Recap/);
    await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
    await pressOurs('dock', '.cg-dock button', /^Собрать полностью/);
    await waitOursText('dock', 'Hubert, 34', 'the full Recap', { timeout: 20_000 });
    await browser.waitUntil(async () => callsTo((await hub().journal(0)).entries, 'clientFanProfileFromGeneration').some((call) => call.status === 200), { timeout: 10_000, timeoutMsg: 'the Recap was not saved to the hub' });

    // …and the tab is loaded anew: it remembers nothing of it.
    await browser.refresh();
    await waitForStandReady();
    await waitForChatReady(ACC, a1);
    await dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${a1}`) === true && d.analysis === null, 'the dock of the reloaded tab');
    const mark = await hub().mark();
    await leaveField();
    await browser.keys([']']);
    await waitOursText('panel', 'Fan Alder', 'the fan panel of the open chat');
    await ours('panel', '.cg-fp__tabs [role="tab"]:last-child').click();
    await waitOursText('panel', 'Hubert, 34', 'the saved Recap in the panel of a fresh tab', { timeout: 15_000 });
    const calls = (await hub().journal(mark)).entries;
    expect(callsTo(calls, 'clientConversationRecaps').map((call) => call.status)).toEqual([200]);
    expect(callsTo(calls, 'aiFeatureStream')).toEqual([]);
    // The headings of the Recap are headings, not «##».
    expect(await waitOursText('panel', 'Кто он', 'the Recap’s first heading')).not.toContain('##');
    await closeAll();
  });

  it('[CS-031] the fan panel ends above the dock: Send, the message field and our strip are in reach — a message is typed and sent with the panel open', async function () {
    this.timeout(120_000);
    await leaveField();
    await browser.keys([']']);
    await waitOursText('panel', 'Fan Alder', 'the fan panel');
    await composerInReach('.cg-fp');

    // With a result open the dock is taller: the panel gives way to it.
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result', 20_000);
    expect(await oursExists('panel', '.cg-fp')).toBe(true);
    await composerInReach('.cg-fp');
    await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
    const inserted = await waitForComposerText(ACC, a1, /\S/, 'the part is in the field');
    const before = await standServer.mark();
    await pressSend();
    await waitForComposerText(ACC, a1, '', 'ChatSpace sent it and cleared its field');
    const sends = (await standServer.journal(before)).entries.filter((entry) => entry.kind === 'send');
    expect(sends.map((entry) => [entry.origin, entry.chatId, entry.detail?.['plain']])).toEqual([['native', a1, inserted]]);

    // The person's own line, typed under the open panel.
    await typeDraft('still here');
    await waitForComposerText(ACC, a1, 'still here', 'the person’s own line');
    expect(await oursExists('panel', '.cg-fp')).toBe(true);
    await browser.keys([Key.Control, 'a']);
    await browser.keys(Key.Backspace);
    await leaveField();
    await closeAll();
    if (await oursExists('dock', '.cg-hide')) await ours('dock', '.cg-hide').click();
  });

  it('[DB-013] [DB-019] [DB-020] Coach ends above the dock too; with debug mode on a Coach answer and a Reply carry their «Отладка» block, and without it they do not', async function () {
    this.timeout(180_000);
    await setDebug(true);
    await pressOurs('dock', '.cg-strip button', /^Coach/);
    await browser.waitUntil(async () => (await oursFocus('panel'))?.label === 'Вопрос Coach', { timeout: 10_000, timeoutMsg: 'the Coach field did not take the focus' });
    await browser.keys('Стоит ли сейчас предлагать сет?'.split(''));
    await browser.keys(Key.Enter);
    await waitOursText('panel', 'Сегодня можно, но не первым сообщением', 'the Coach answer', { timeout: 20_000 });
    await composerInReach('.cg-coach');
    await browser.waitUntil(() => oursExists('panel', '.cg-coach .cg-debug'), { timeout: 5000, timeoutMsg: 'the Coach answer has no «Отладка» block in debug mode' });
    await closeAll();

    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result', 20_000);
    await browser.waitUntil(() => oursExists('dock', '.cg-debug'), { timeout: 5000, timeoutMsg: 'the open Reply sheet has no «Отладка» block in debug mode' });
    // The block is the sheet's footer: inside the dock, inside the window.
    expect(await reach('dock', '.cg-debug')).toMatchObject({ clippedPx: 0 });
    // The collapsed strip shows none (DB-020).
    await ours('dock', '.cg-hide').click();
    await browser.waitUntil(async () => !(await oursExists('dock', '.cg-debug')), { timeout: 5000, timeoutMsg: 'the collapsed dock still shows the debug block' });

    await setDebug(false);
    await pressOurs('dock', '.cg-strip button', /^Reply/);
    await dockIs((d) => d.result?.state === 'done', 'the Reply result without debug', 20_000);
    await browser.pause(300);
    expect(await oursExists('dock', '.cg-debug')).toBe(false);
    await ours('dock', '.cg-hide').click();
  });

  it('[AI-005] [SP-024] [SP-049] Spenders: the «Тон» menu of a preview is whole on screen and a tone is picked with the pointer; «Обновить» reads the board again; S unfolds the statistics and folds them back', async function () {
    this.timeout(180_000);
    await leaveField();
    await browser.keys([...PANEL, 'm']);
    await waitOursText('modal', 'Fan Alder', 'the board lists the stand’s fans', { timeout: 20_000, selector: '.cg-sp' });

    // SP-024: one press, one more read of the board.
    const board = await hub().mark();
    await browser.waitUntil(() => oursExists('modal', '.cg-sp__refresh button'), { timeout: 5000, timeoutMsg: 'the board has no «Обновить»' });
    expect(await reach('modal', '.cg-sp__refresh button')).toMatchObject({ clippedPx: 0, onTop: true });
    await pressOurs('modal', '.cg-sp__refresh button', /^Обновить/);
    await browser.waitUntil(async () => (await hub().journal(board)).entries.some((call) => /spender/i.test(String(call.route)) && call.status === 200), { timeout: 10_000, timeoutMsg: '«Обновить» read nothing from the hub' });
    await waitOursText('modal', 'Fan Alder', 'the board after «Обновить»', { selector: '.cg-sp' });

    // SP-049: S, and S again; the keys stay in our window.
    await ours('modal', '[data-cg-key^="fan:"]').click();
    await browser.waitUntil(() => oursExists('modal', '.cg-pv'), { timeout: 10_000, timeoutMsg: 'the preview did not open' });
    await browser.keys(Key.Escape);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pv')), { timeout: 5000, timeoutMsg: 'the preview did not close' });
    await browser.keys(['s']);
    await browser.waitUntil(() => oursExists('modal', '.cg-stx'), { timeout: 10_000, timeoutMsg: 'S did not unfold the statistics' });
    expect(await oursFocus('modal')).not.toBeNull();
    await browser.keys(['s']);
    await browser.waitUntil(async () => !(await oursExists('modal', '.cg-stx')), { timeout: 5000, timeoutMsg: 'S did not fold the statistics back' });
    expect(await oursFocus('modal')).not.toBeNull();
    expect(await oursExists('modal', '.cg-sp')).toBe(true);

    // AI-005: the tone menu of the preview's own strip.
    await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Kestrel/);
    await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the preview says the chat stays unread', { selector: '.cg-pv' });
    await ours('modal', '.cg-pv [data-cg-strip="tone"] button').click();
    await browser.waitUntil(() => oursExists('modal', '.cg-pv [role="menu"]'), { timeout: 5000, timeoutMsg: 'the tone menu did not open' });
    await twoFrames();
    expect(await reach('modal', '.cg-pv [role="menu"]')).toMatchObject({ clippedPx: 0 });
    const items = await ours('modal', '.cg-pv [role="menu"]').$$('[role="menuitemradio"]').getElements();
    expect(items.length).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < items.length; index += 1) {
      expect([index, await reach('modal', `.cg-pv [role="menu"] [role="menuitemradio"]:nth-of-type(${index + 1})`)]).toEqual([index, { clippedPx: 0, onTop: true }]);
    }
    const tone = await hub().mark();
    await pressOurs('modal', '.cg-pv [role="menuitemradio"]', /^Flirt/);
    // A tone starts Reply in it.
    await browser.waitUntil(async () => callsTo((await hub().journal(tone)).entries, 'aiFeatureStream').length === 1, { timeout: 10_000, timeoutMsg: 'the tone did not start a Reply' });
    const [started] = callsTo((await hub().journal(tone)).entries, 'aiFeatureStream');
    expect((started?.request as { body?: { replyTone?: string } }).body?.replyTone).toBe('flirty');
    await browser.waitUntil(() => oursExists('modal', '.cg-pv [data-cg-part="0"]'), { timeout: 20_000, timeoutMsg: 'the preview shows no result' });
    await closeAll();
  });
});
