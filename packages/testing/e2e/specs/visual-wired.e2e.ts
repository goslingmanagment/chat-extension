// §12 п. 6 on the wired extension — the real UI on the stand, to be LOOKED
// at: the TEST build over the ChatSpace-like fixture against the fake hub,
// every surface brought to its state by hand (clicks and keys) and
// photographed in light and dark, in Russian and English, at 1440 × 900 —
// the window of the binding mockup (`final-*-light.png`, `final-*-dark.png`).
// The pictures go to `.cache/e2e/visual/<state>-<theme>-<lang>.png`, and
// what was measured next to them to `.cache/e2e/visual/facts.json`.
//
// The galleries (dock-gallery, boards-gallery, pages-gallery) draw the same
// components over synthetic view models; here the view models are the real
// controllers' and the place is ChatSpace's page: what is checked by machine
// is what a gallery cannot show — every surface is mounted where it belongs,
// inside the window, nothing of ours is clipped or pushes the page sideways,
// each follows the theme and the language. The rest is for the eyes.
//
// The main states are taken in all four looks, the secondary ones in light
// and dark Russian. Between two states the language is Russian: what a step
// presses is found by its Russian words.

import { mkdirSync, writeFileSync } from 'node:fs';

import { browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';

import { callsTo } from '../../src/fake-hub/journal';
import { PAGE } from '../../src/scenarios/hub';
import { meta } from '../../src/scenarios/hub/sse';
import { E2E_EVIDENCE_DIR } from '../../src/stand/paths';
import { clearDraft, composerText, MOD, PANEL, pressSend, SEND, twoFrames, typeDraft } from '../support/chat';
import { pageRpc } from '../support/extension';
import { QUIET_PAGE, testBuildPage, useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { ours, oursBox, oursExists, oursFocus, oursText, pressOurs, readOurs, waitOursText, type Box, type Where } from '../support/ours';
import { capturePage, openOptions, openPopup, signOutFromAccount, waitForOptions, waitForPopup } from '../support/pages';
import { dockIs, startShift, type Shift } from '../support/shift';
import { callStand, foreignCalls, STAND_IDS, standServer, waitForChatReady } from '../support/stand';

const ACC = STAND_IDS.accounts.a;
const ACC_B = STAND_IDS.accounts.b;
const { a1, a2, a3, a4, a5, a6, a7, a8, b1 } = STAND_IDS.fans;
/** Fans Iris, Juniper, Kestrel and Linden of the stand's account a (the dataset names its fans beyond a8 by the same pattern). */
const [a9, a10, a11, a12] = ['74001009', '74001010', '74001011', '74001012'] as const;
const VISUAL_DIR = `${E2E_EVIDENCE_DIR}visual/`;
const WINDOW = { width: 1440, height: 900 } as const;

type Theme = 'light' | 'dark';
type Lang = 'ru' | 'en';
interface Look {
  readonly theme: Theme;
  readonly lang: Lang;
}

/** What the fake hub's model writes here: the mockup's own lines, so the pictures can be laid next to it. */
const AI_TEXTS: Readonly<Record<string, string>> = {
  'fast-reply': 'good morning, my traveler ☀️ доброе утро! how was the flight? [NEXT] I just woke up and saw your messages… you made me smile before my coffee 🙈 [NEXT] the set is still waiting for you 😏 want me to send it now, or do you want to guess what’s inside first?',
  'hi-greeting': 'hey you 👋 so glad you’re here! tell me one thing about your day [VARIANT] welcome, handsome ☺️ I was hoping you’d come by — what brought you to me? [VARIANT] hi! I’m Lora 💛 I read every message myself, so say hi back',
  'improve-draft': 'I missed you so much today 🥺 tell me everything — how was the flight?',
  ping: 'still thinking about what you said yesterday… are you around? 😌',
  'fan-summary': '## Кто он\nHubert, 34, часто летает по работе. Отвечает вечером по Варшаве.\n\n## Что покупал\n- сет «Утро» за $25, вчера\n- два платных сообщения по $12 на прошлой неделе\n\n## На что отвечает\n- вопросы о поездках и о кофе\n- короткие сообщения, без давления\n\n## Чего избегать\n- длинных текстов и скидок в первом сообщении',
  'chat-review':
    '<rating>7</rating><evaluation>ВЕРДИКТ: разговор живой, но продажа сета прозвучала слишком рано.\n\nДЕНЬГИ: $25 за вчера, второй сет не предложен.\n\nПЕРСОНА: тон тёплый, в образе; одно сообщение слишком длинное.\n\nОШИБКИ:\n1. Предложили сет первым сообщением утра. Как надо было: сначала про полёт, потом тизер.\n2. Не ответили на вопрос про кофе.\n\nЧТО РАБОТАЕТ: короткие вопросы о поездке, смайлы без перебора.</evaluation><recommendations>1. Начать с вопроса про полёт.\n2. Тизер сета — вторым сообщением.\n3. Вернуться к шутке про кофе.</recommendations>',
  'coach-chat':
    'Сегодня можно, но не первым сообщением. Он сам вспомнил про сет — используйте это: сначала про полёт, потом тизер.\n\n```draft\nhow was the flight, my traveler? ☀️ [NEXT] you remembered the set 🙈 there is a second part… even cuter. want a little peek first?\n```',
};

interface Measure {
  /** The page scrolls sideways (something of ours pushed it). */
  readonly pageOverflowsX: boolean;
  /** Our hosts on the page, by kind. */
  readonly hosts: Readonly<Record<string, number>>;
}

describe('the real UI on the stand, photographed: light and dark, RU and EN, 1440 × 900', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let shift: Shift;
  let journalStart = 0;
  let current: Look = { theme: 'dark', lang: 'ru' };
  const taken: string[] = [];
  /** What was measured, for the reader of the pictures. */
  const facts: Record<string, unknown> = {};

  /** The look of ChatSpace and of ours together: the stand's own theme, and the extension's theme and language. */
  const setLook = async (look: Look): Promise<void> => {
    if (current.theme === look.theme && current.lang === look.lang) return;
    if (current.theme !== look.theme) await callStand('setTheme', look.theme);
    await shift.patch({ ui: { theme: look.theme, locale: look.lang } });
    current = { ...look };
    // The overlays follow the same settings as the dock; with no chat open there is no dock to ask.
    await dockIs((dock) => !dock.visible || (dock.language === look.lang && dock.scheme === look.theme), `the dock in ${look.theme}/${look.lang}`, 10_000);
    await twoFrames();
  };
  /** The looks of one state, from the look that stands now, each one step from the last, ending in Russian. */
  const looksOf = (all: boolean): readonly Look[] => {
    const here = current.theme;
    const there: Theme = here === 'light' ? 'dark' : 'light';
    return all
      ? [
          { theme: here, lang: 'ru' },
          { theme: here, lang: 'en' },
          { theme: there, lang: 'en' },
          { theme: there, lang: 'ru' },
        ]
      : [
          { theme: here, lang: 'ru' },
          { theme: there, lang: 'ru' },
        ];
  };
  /**
   * The picture of a state that stands: two shots in a row are the same. A window that fades in is not caught
   * half-way; what never stands still (a spinner, a countdown, the caret) is taken after a second.
   */
  const shoot = async (path: string, still: boolean): Promise<void> => {
    let last = await browser.takeScreenshot();
    const until = Date.now() + 1000;
    while (still && Date.now() < until) {
      await browser.pause(100);
      const next = await browser.takeScreenshot();
      if (next === last) break;
      last = next;
    }
    writeFileSync(path, Buffer.from(last, 'base64'));
  };
  /** Toasts of the state before are gone: each lives a few seconds, and a picture is of its own state. */
  const noToasts = (): Promise<void> =>
    browser
      .waitUntil(async () => !(await oursExists('toast', '.cg-toast')), { timeout: 9000, interval: 200 })
      .then(
        () => undefined,
        () => undefined,
      );
  const measure = (): Promise<Measure> =>
    browser.execute(() => {
      const hosts: Record<string, number> = {};
      for (const host of document.querySelectorAll('[data-host]')) {
        const kind = `${host.getAttribute('data-host') ?? ''}${host.hasAttribute('data-layer') ? `:${host.getAttribute('data-layer') ?? ''}` : ''}`;
        hosts[kind] = (hosts[kind] ?? 0) + 1;
      }
      return { pageOverflowsX: document.documentElement.scrollWidth > window.innerWidth + 1, hosts };
    });
  /** The box of something of ours lies inside the window. */
  const inWindow = async (where: Where, selector: string): Promise<Box | null> => {
    const box = await oursBox(where, selector);
    expect([where, selector, box !== null]).toEqual([where, selector, true]);
    if (box === null) return null;
    expect([selector, box.x >= -1, box.y >= -1, box.x + box.width <= WINDOW.width + 1, box.y + box.height <= WINDOW.height + 1]).toEqual([selector, true, true, true, true]);
    return box;
  };
  /**
   * One state in its looks. `fresh` puts the state back after a look changed it (an open menu closes when
   * its texts are said anew) and must not read words; `check` runs once per look.
   */
  const look = async (
    name: string,
    options: { readonly all?: boolean; readonly fresh?: () => Promise<void>; readonly check?: () => Promise<void>; readonly toasts?: true; readonly moving?: true } = {},
  ): Promise<void> => {
    if (options.toasts !== true) await noToasts();
    for (const each of looksOf(options.all ?? true)) {
      await setLook(each);
      await options.fresh?.();
      await twoFrames();
      const seen = await measure();
      // Nothing of ours pushes ChatSpace's page sideways; one dock, one host per overlay layer.
      expect([name, each.theme, each.lang, seen.pageOverflowsX]).toEqual([name, each.theme, each.lang, false]);
      for (const [kind, count] of Object.entries(seen.hosts)) expect([name, kind, count]).toEqual([name, kind, 1]);
      await options.check?.();
      const path = `${VISUAL_DIR}${name}-${each.theme}-${each.lang}.png`;
      await shoot(path, options.moving !== true);
      taken.push(path);
    }
  };
  /** A page of the extension itself in every look (its own document: a classic screenshot). */
  const lookAtPage = async (name: string, show: () => Promise<void>, all = true): Promise<void> => {
    for (const each of looksOf(all)) {
      await setLook(each);
      await shift.toPages();
      await show();
      await capturePage(`visual/${name}-${each.theme}-${each.lang}`);
      taken.push(`${VISUAL_DIR}${name}-${each.theme}-${each.lang}.png`);
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
    }
  };
  const open = async (fan: string, account = ACC, newTab = false): Promise<void> => {
    await callStand('openChat', account, fan, newTab ? { newTab: true } : {});
    await waitForChatReady(account, fan);
    await dockIs((d) => d.visible && d.target?.endsWith(`:${fan}`) === true, `the dock of chat ${fan}`);
  };
  const ready = (fan: string): Promise<unknown> => dockIs((d) => d.status === 'ready' && d.target?.endsWith(`:${fan}`) === true && d.actions['reply'] === true, `the dock of chat ${fan} is ready`);
  const generate = async (button: RegExp): Promise<void> => {
    const before = (await dockIs(() => true, 'the dock')).result?.opId ?? null;
    await pressOurs('dock', '.cg-strip button', button);
    await dockIs((d) => d.result !== null && d.result.opId !== before && d.result.state === 'done', 'the result', 20_000);
  };
  const closeAll = async (): Promise<void> => {
    for (let press = 0; press < 5 && ((await oursExists('modal', '.cg-root')) || (await oursExists('panel', '.cg-root'))); press += 1) {
      await browser.keys(Key.Escape);
      await browser.pause(200);
    }
  };
  const hideResult = async (): Promise<void> => {
    if (await oursExists('dock', '.cg-hide')) await ours('dock', '.cg-hide').click();
    await browser.waitUntil(async () => (await dockIs(() => true, 'the dock')).height <= 36, { timeout: 5000, timeoutMsg: 'the dock did not collapse' }).catch(() => undefined);
  };
  /** The keys of ours that are not typed into ChatSpace's field are pressed with the focus on the chat's header. */
  const leaveField = (): Promise<void> => browser.$('[data-stand-conversation-header]').click();
  /**
   * How much of ChatSpace's own Send button a side panel of ours covers, in square pixels, and what a pointer
   * finds in the middle of that button: the button itself, or something of ours over it.
   */
  const sendCovered = async (selector: string): Promise<{ readonly panel: Box | null; readonly send: Box | null; readonly coveredPx: number; readonly sendReached: boolean }> => {
    const panel = await oursBox('panel', selector);
    const { send, reached } = await browser.execute((sel: string) => {
      const node = document.querySelector(sel);
      const rect = node?.getBoundingClientRect();
      if (node === null || rect === undefined) return { send: null, reached: false };
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { send: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, reached: hit !== null && (hit === node || node.contains(hit)) };
    }, SEND);
    const across = panel === null || send === null ? 0 : Math.min(panel.x + panel.width, send.x + send.width) - Math.max(panel.x, send.x);
    const down = panel === null || send === null ? 0 : Math.min(panel.y + panel.height, send.y + send.height) - Math.max(panel.y, send.y);
    return { panel, send, coveredPx: across > 0 && down > 0 ? Math.round(across * down) : 0, sendReached: reached };
  };

  before(async () => {
    mkdirSync(VISUAL_DIR, { recursive: true });
    await standServer.reset();
    await standServer.traffic({ firstSummaryMs: 150 });
    journalStart = await standServer.mark();
    await hub().command({ op: 'config', patch: { aiTexts: AI_TEXTS } });
    await hub().command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a5 });
    await hub().command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a6, kind: 'returning' });
    await hub().command({ op: 'audienceEvent', pageLabel: PAGE, fanRef: a7 });
    await hub().command({ op: 'desktopGreeting', pageLabel: PAGE, fanRef: a7 });
    shift = await startShift(hub(), { previewSend: true, settings: { generation: { split: true } }, viewport: WINDOW });
    // The extension's own documents take no viewport override (a privileged scope): the window itself is sized for them.
    await browser.setWindowSize(WINDOW.width, WINDOW.height + 85);
    await ready(a1);
    current = { theme: 'dark', lang: 'ru' };
    await callStand('setTheme', 'dark');
    await shift.patch({ ui: { theme: 'dark', locale: 'ru' } });
  });

  after(async () => {
    await hub().command({ op: 'clearScripts' });
    await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
    writeFileSync(`${VISUAL_DIR}facts.json`, `${JSON.stringify({ window: WINDOW, pictures: taken.length, ...facts }, null, 2)}\n`);
    expect(foreignCalls((await standServer.journal(journalStart)).entries)).toEqual([]);
    // Every state was photographed in its looks.
    expect(taken.length).toBeGreaterThan(120);
  });

  describe('the dock', () => {
    it('ready; the capsule of Reply\'s options — the four tones and Split — and the two windows in the bar', async () => {
      await look('dock-01-ready', {
        check: async () => {
          await inWindow('dock', '.cg-strip');
          expect((await dockIs(() => true, 'the dock')).height).toBe(40);
        },
      });
      // The composer of this window is 853 px: every tone is one click (there is no menu to open), Split stands behind
      // the seam of the same capsule, and Spenders and «Новые» are chips of the bar (ui-design §3.3, X28).
      await look('dock-02-capsule', {
        all: false,
        check: async () => {
          await inWindow('dock', '.cg-tones');
          await inWindow('dock', '.cg-slot--boards');
          expect(await readOurs('dock', '.cg-tones__track', (node) => [...node.querySelectorAll('button .cg-act__t')].map((label) => label.textContent))).toEqual(['Casual', 'Flirt', 'Sell', 'Spice']);
          expect(await oursExists('dock', '.cg-tones .cg-split')).toBe(true);
        },
      });
    });

    it('a stream; a Split result; a part inserted; the question about the person’s own text', async function () {
      this.timeout(180_000);
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 2500 } });
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      await dockIs((d) => d.result?.state === 'streaming' || d.result?.state === 'requesting', 'the stream', 20_000);
      await look('dock-03-stream', { all: false, moving: true });
      await browser.keys([MOD, '.']);
      await dockIs((d) => d.result === null || d.result.state !== 'streaming', 'the stream is canceled', 20_000);
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
      await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 20_000, timeoutMsg: 'the canceled stream is still open at the hub' });
      await generate(/^Reply/);
      await look('dock-04-split', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await pressOurs('dock', '[data-cg-part="0"] button', /^Вставить/);
      await dockIs((d) => d.result?.inserted === 1, 'the first part is inserted');
      await look('dock-05-split-inserted', { all: false });
      // Б2 after decision X45: «Вставить» over the person's own words replaces them by the click, no question — the
      // question's own pictures (`final-6`, «Отмена» in focus) are the dock gallery's; here it no longer stands.
      await clearDraft();
      await typeDraft('привет, это мой текст');
      await pressOurs('dock', '[data-cg-part="1"] button', /^Вставить/);
      await dockIs((d) => d.result?.inserted === 2, 'the second part replaced the person’s words');
      expect(await oursExists('dock', '.cg-confirm')).toBe(false);
      await clearDraft();
      await hideResult();
    });

    it('Hi with three variants; Fix before and after the replacement', async function () {
      this.timeout(180_000);
      await open(a2, ACC, true);
      await generate(/^Hi/);
      await look('dock-07-hi', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hideResult();
      await open(a4, ACC, true);
      // One message: Fix shows the person's text next to the fixed one.
      await shift.patch({ generation: { split: false } });
      await typeDraft('i mised you so much today tell me evrything how was the flite');
      await dockIs((d) => d.actions['fix'] === true, 'Fix is on');
      await generate(/^Fix/);
      await look('dock-08-fix');
      await pressOurs('dock', '.cg-dock button', /^Заменить мой черновик/);
      await browser.waitUntil(() => oursExists('dock', '.cg-fix__acts .cg-done'), { timeout: 5000, timeoutMsg: 'the replacement was not made' });
      await look('dock-09-fix-replaced', { all: false });
      await shift.patch({ generation: { split: true } });
      await clearDraft();
      await hideResult();
    });

    it('Recap, empty and full; Review', async function () {
      this.timeout(180_000);
      await open(a1);
      await pressOurs('dock', '.cg-strip button', /^Recap/);
      await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
      await look('dock-10-recap-empty', { all: false });
      await pressOurs('dock', '.cg-dock button', /^Собрать полностью/);
      // X55: the full Recap opens in the «Развернуть ↗» window, as the old Fansly extension's overlay; the sheet keeps it.
      await waitOursText('modal', 'Hubert, 34', 'the full Recap in its window', { timeout: 20_000, selector: '.cg-xdlg' });
      await look('dock-11-recap-full', { check: async () => void (await inWindow('modal', '.cg-xdlg')) });
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'Esc did not fold the Recap window into the sheet' });
      expect((await dockIs(() => true, 'the dock')).analysis).toBe('recap');
      await waitOursText('dock', 'Hubert, 34', 'the full Recap in the sheet');
      await look('dock-11b-recap-full-sheet', { all: false, check: async () => void (await inWindow('dock', '.cg-dock')) });
      await browser.keys(Key.Escape);
      await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
      await pressOurs('dock', '.cg-strip button', /^Review/);
      await waitOursText('modal', 'разговор живой', 'the Review in its window', { timeout: 20_000, selector: '.cg-xdlg' });
      await look('dock-12-review', { check: async () => void (await inWindow('modal', '.cg-xdlg')) });
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'Esc did not fold the Review window into the sheet' });
      await browser.keys(Key.Escape);
      await dockIs((d) => d.analysis === null, 'the Review sheet is hidden');
    });

    it('AI overloaded; the limit of three generations; the debug block', async function () {
      this.timeout(240_000);
      // 7c: the provider refused — a card with the code, «Повторить» after the hub's own delay.
      await open(a6, ACC, true);
      await ready(a6);
      await hub().command({
        op: 'scriptSse',
        feature: 'fast-reply',
        responses: [
          {
            kind: 'stream',
            steps: [
              { kind: 'frame', frame: meta('fast-reply') },
              { kind: 'frame', frame: { type: 'content_delta', text: 'Partial' }, afterMs: 20 },
              { kind: 'frame', frame: { type: 'error', code: 'provider_rate_limited', message: 'AI provider rate limit reached', retryAfterMs: 30_000 } },
              { kind: 'eof' },
            ],
          },
        ],
      });
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      await dockIs((d) => d.result?.error === 'CG-PROVIDER-RATE-LIMIT', 'the provider’s refusal', 20_000);
      await look('dock-13-error-overloaded', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hub().command({ op: 'clearScripts' });
      await hideResult();

      // 8: three generations run in other chats of this tab; the fourth is refused with their list.
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 4000 } });
      for (const fan of [a7, a8, a9]) {
        await open(fan, ACC, true);
        await ready(fan);
        await pressOurs('dock', '.cg-strip button', /^Reply/);
        await dockIs((d) => d.target?.endsWith(`:${fan}`) === true && d.result !== null, `the Reply of chat ${fan} started`);
      }
      await open(a10, ACC, true);
      await ready(a10);
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      const refused = await dockIs((d) => d.refusal !== null, 'the fourth start is refused');
      expect(refused.refusal).toBe('CG-OP-TAB-LIMIT');
      expect(refused.refusalRunning).toHaveLength(3);
      await look('dock-14-limit', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      for (const opId of refused.refusalRunning) await shift.rpc('op.cancel', { opId });
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
      await browser.waitUntil(async () => (await hub().status()).openStreams === 0, { timeout: 20_000, timeoutMsg: 'the canceled streams are still open at the hub' });
      await dockIs((d) => d.runningElsewhere.length === 0, 'nothing runs any more');

      // 10: debug is switched on in the settings page (only it may): the result carries its «Отладка» block.
      await shift.toPages();
      await browser.url(testBuildPage('options.html'));
      expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: true } }, baseRevision: null })).toMatchObject({ ok: true });
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
      await generate(/^Reply/);
      // The open sheet of a draft carries its debug footer, as the mockup's `final-10` shows (DB-013); the collapsed strip none (DB-020).
      facts['debugFooterInDockSheet'] = await oursExists('dock', '.cg-debug');
      expect(facts['debugFooterInDockSheet']).toBe(true);
      await look('dock-15-debug', { all: false, check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hideResult();
      // The long chat's full Recap is made anew with debug on, then unfolded into its dialog.
      await open(a1);
      await ready(a1);
      await pressOurs('dock', '.cg-strip button', /^Recap/);
      await dockIs((d) => d.analysis === 'recap', 'the Recap sheet');
      // X55: the saved full Recap opens in its «Развернуть ↗» window; «Обновить» there makes it anew, in the window.
      await waitOursText('modal', 'Hubert, 34', 'the full Recap of the long chat in its window', { selector: '.cg-xdlg' });
      const remade = await hub().mark();
      await pressOurs('modal', '.cg-xdlg button', /^Обновить/);
      await browser.waitUntil(async () => callsTo((await hub().journal(remade)).entries, 'aiFeatureStream').some((call) => call.stream?.outcome === 'done'), { timeout: 20_000, timeoutMsg: 'the Recap was not made anew' });
      await waitOursText('modal', 'Hubert, 34', 'the Recap made anew', { selector: '.cg-xdlg' });
      facts['debugFooterInUnfoldedResult'] = await oursExists('modal', '.cg-debug');
      await look('modal-04-recap-unfolded-debug', { all: false, check: async () => void (await inWindow('modal', '.cg-xdlg')) });
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => !(await oursExists('modal', '.cg-xdlg')), { timeout: 5000, timeoutMsg: 'the unfolded result did not fold back' });
      await browser.keys(Key.Escape);
      await dockIs((d) => d.analysis === null, 'the Recap sheet is hidden');
      await shift.toPages();
      await browser.url(testBuildPage('options.html'));
      expect(await pageRpc('settings.patchRestricted', { patch: { debug: { enabled: false } }, baseRevision: null })).toMatchObject({ ok: true });
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
      await hideResult();
    });

    it('the statuses: a blocked fan (copy only), an account that is not bound', async function () {
      this.timeout(180_000);
      await callStand('openChat', ACC, a3);
      const blocked = await dockIs((d) => d.visible && d.target?.endsWith(`:${a3}`) === true && d.mode === 'copy-only', 'the copy-only row of the blocked fan');
      facts['blockedFan'] = { status: blocked.status, banner: blocked.banner, mode: blocked.mode };
      await look('dock-16-blocked-fan', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await callStand('openChat', ACC_B, b1);
      await waitForChatReady(ACC_B, b1);
      const unbound = await dockIs((d) => d.status === 'no-binding', 'the dock of the account that is not bound');
      facts['noBinding'] = { status: unbound.status, banner: unbound.banner };
      await look('dock-17-no-binding', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await callStand('openChat', ACC, a1);
      await waitForChatReady(ACC, a1);
      await ready(a1);
    });

    it('[RB-010] the port to the background is lost while the extension is the same instance: «Расширение не отвечает» with «Повторить»', async function () {
      this.timeout(180_000);
      /** The stand holds the tab's port down, or lets it through again (the TEST build's probe). */
      const holdPort = (down: boolean): Promise<void> =>
        browser.execute((isDown: boolean) => {
          if (isDown) document.documentElement.setAttribute('data-cg-spike-port', 'down');
          else document.documentElement.removeAttribute('data-cg-spike-port');
        }, down);
      // A change of the theme reaches the tab over the very port that is down: each look is set first, then the port is cut.
      for (const theme of ['dark', 'light'] as const) {
        await setLook({ theme, lang: 'ru' });
        await noToasts();
        await holdPort(true);
        const lost = await dockIs((d) => d.banner === 'CG-RUNTIME-UNREACHABLE', 'the dock says the extension does not answer', 20_000);
        facts['portLost'] = { status: lost.status, banner: lost.banner, view: lost.view };
        await twoFrames();
        await inWindow('dock', '.cg-dock');
        await inWindow('dock', '.cg-banner');
        const path = `${VISUAL_DIR}dock-24-port-lost-${theme}-ru.png`;
        await shoot(path, true);
        taken.push(path);
        await holdPort(false);
        await pressOurs('dock', '.cg-banner button', /^Повторить/);
        await ready(a1);
      }
    });
  });

  describe('the windows and the panels', () => {
    it('Spenders: the board, a preview with «Отправить», a part sent, the statistics unfolded', async function () {
      this.timeout(240_000);
      await leaveField();
      await browser.keys([...PANEL, 'm']);
      await waitOursText('modal', 'Fan Alder', 'the board lists the stand’s fans', { timeout: 20_000, selector: '.cg-sp' });
      await look('board-01-spenders', { check: async () => void (await inWindow('modal', '.cg-sp')) });
      await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Kestrel/);
      await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the preview says the chat stays unread', { selector: '.cg-pv' });
      await pressOurs('modal', '.cg-pv button', /^Reply/);
      await waitOursText('modal', 'the set is still waiting', 'the preview’s result', { timeout: 20_000, selector: '.cg-pv' });
      await browser.waitUntil(() => oursExists('modal', '.cg-pvs__send'), { timeout: 10_000, timeoutMsg: 'the preview shows no «Отправить»' });
      // The result is under the person's eyes: nothing is toasted over the preview's header.
      await browser.pause(400);
      expect(await oursExists('toast', '.cg-toast')).toBe(false);
      await look('board-02-preview-available', {
        check: async () => {
          await inWindow('modal', '.cg-sp');
          await inWindow('modal', '.cg-pv');
        },
      });
      await ours('modal', '[data-cg-part="0"] .cg-pvs__send').click();
      await browser.waitUntil(() => oursExists('modal', '[data-cg-part="0"][data-cg-send-state="sent"]'), { timeout: 20_000, timeoutMsg: 'the first part was not sent' });
      await look('board-03-preview-sent', { check: async () => void (await inWindow('modal', '.cg-pv')) });
      // The preview closes; the statistics column unfolds over the list.
      await browser.keys(Key.Escape);
      await browser.waitUntil(async () => !(await oursExists('modal', '.cg-pv')), { timeout: 5000, timeoutMsg: 'the preview did not close' });
      await pressOurs('modal', '.cg-sp button', /^Развернуть/);
      await browser.waitUntil(() => oursExists('modal', '.cg-stx'), { timeout: 10_000, timeoutMsg: 'the statistics did not unfold' });
      await look('board-04-stats', { check: async () => void (await inWindow('modal', '.cg-stx')) });
      await closeAll();
      expect(await oursExists('modal', '.cg-sp')).toBe(false);
    });

    it('[SP-029] [SP-047] «Ждут ответа» whose hub queue did not read: the error with its code and «Повторить» over the board’s own rows, named as the local filter; «Повторить» brings the hub’s queue', async function () {
      this.timeout(240_000);
      await leaveField();
      await browser.keys([...PANEL, 'm']);
      await browser.waitUntil(() => oursExists('modal', '.cg-sp'), { timeout: 20_000, timeoutMsg: 'the board did not open' });
      // The statistics column was left unfolded over the list: back to the list.
      if (await oursExists('modal', '.cg-stx')) await pressOurs('modal', '.cg-sp button', /^Свернуть к списку/);
      await waitOursText('modal', 'Fan Alder', 'the board lists the stand’s fans', { timeout: 20_000, selector: '.cg-sp' });
      // The hub does not answer the queue this once.
      await hub().command({ op: 'scriptHttp', match: 'route', exchanges: [{ route: 'clientSpenderAwaitingReply', request: {}, response: { status: 504, body: { error: 'gateway_timeout' } } }] });
      // X67: «Ждут ответа» waits in the old window's «Фильтр» menu.
      await pressOurs('modal', '.cg-sp__filters button', /^Фильтр/);
      await pressOurs('modal', '.cg-sp__filters [role="menuitemradio"]', /^Ждут ответа/);
      await browser.waitUntil(() => oursExists('modal', '[data-cg-waiting-fallback]'), { timeout: 15_000, timeoutMsg: 'the board did not say that the queue was not read' });
      const said = await oursText('modal', '[data-cg-waiting-fallback]');
      expect(said).toMatch(/ChatGoose · CG-/);
      expect(said).toContain('локальный фильтр');
      // The board's own rows are still on screen under the notice: the stand's fans who wrote last.
      expect(await oursExists('modal', '.cg-bd [data-cg-fan]')).toBe(true);
      facts['waitingFallback'] = { code: await ours('modal', '[data-cg-waiting-fallback]').getAttribute('data-cg-waiting-fallback') };
      await look('board-07-waiting-fallback', {
        check: async () => {
          await inWindow('modal', '.cg-sp');
          await inWindow('modal', '[data-cg-waiting-fallback]');
        },
      });
      // «Повторить»: the hub answers, the list is its queue, the notice is gone.
      await pressOurs('modal', '[data-cg-waiting-fallback] button', /^Повторить/);
      await browser.waitUntil(async () => !(await oursExists('modal', '[data-cg-waiting-fallback]')), { timeout: 15_000, timeoutMsg: 'the notice stayed after the queue was read' });
      await pressOurs('modal', '.cg-sp__filters button', /^Все/);
      await closeAll();
      expect(await oursExists('modal', '.cg-sp')).toBe(false);
    });

    it('[NEW-01] [NEW-05] a preview’s result in the dock of the chat «Открыть и вставить» opened: the question about the person’s own text, the rest of the result, a part the person sent', async function () {
      this.timeout(300_000);
      // The person left a draft in that fan's chat earlier.
      await open(a9, ACC, true);
      await ready(a9);
      await hideResult();
      await clearDraft();
      await typeDraft('привет, это мой текст');
      await open(a1);
      await ready(a1);
      await leaveField();
      await browser.keys([...PANEL, 'm']);
      await browser.waitUntil(() => oursExists('modal', '.cg-sp'), { timeout: 20_000, timeoutMsg: 'the board did not open' });
      // The statistics column was left unfolded over the list: back to the list.
      if (await oursExists('modal', '.cg-stx')) await pressOurs('modal', '.cg-sp button', /^Свернуть к списку/);
      await waitOursText('modal', 'Fan Iris', 'the board lists the stand’s fans', { timeout: 20_000, selector: '.cg-sp' });
      await pressOurs('modal', '[data-cg-key^="fan:"]', /^Fan Iris/);
      await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the preview says the chat stays unread', { selector: '.cg-pv' });
      await pressOurs('modal', '.cg-pv button', /^Reply/);
      await waitOursText('modal', 'the set is still waiting', 'the preview’s result', { timeout: 20_000, selector: '.cg-pv' });
      await pressOurs('modal', '.cg-pv button', /^Открыть и вставить/);
      await dockIs((d) => d.target?.endsWith(`:${a9}`) === true && d.result?.parts === 3 && d.status === 'ready', 'the dock of the fan’s chat took the preview’s result');
      // §6.5 п. 4: the chat holds the person's own text — the question stands in that chat's dock, nothing was written.
      await browser.waitUntil(() => oursExists('dock', '[data-cg-confirm="human-draft"]'), { timeout: 10_000, timeoutMsg: 'the question about the person’s own text did not appear in the dock' });
      expect(await composerText(ACC, a9)).toBe('привет, это мой текст');
      await look('dock-21-board-confirm', {
        check: async () => {
          await inWindow('dock', '.cg-dock');
          await inWindow('dock', '[data-cg-confirm="human-draft"]');
          // A board's result has no «Ещё раз» in the dock: a new answer is the strip's buttons.
          expect(await oursExists('dock', '.cg-sheet .cg-again')).toBe(false);
        },
      });
      await ours('dock', '[data-cg-confirm="human-draft"] button').click();
      await dockIs((d) => d.result?.inserted === 1, 'the first part replaced the person’s text by their own click');
      await look('dock-22-board-inserted', { all: false, check: async () => void (await inWindow('dock', '.cg-dock')) });
      // The person presses ChatSpace's own Send: the part reads «Отправлено», the next one leads.
      await pressSend();
      await browser.waitUntil(async () => (await oursText('dock', '[data-cg-part="0"]')).includes('Отправлено'), { timeout: 15_000, timeoutMsg: 'the dock did not show the sent part' });
      await look('dock-23-board-sent', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hideResult();
      await open(a1);
      await ready(a1);
    });

    it('«Новые»: the list, a card with its greeting', async function () {
      this.timeout(240_000);
      await leaveField();
      await browser.keys([MOD, 'k']);
      await pressOurs('modal', '.cg-pal__item', /^Новые(?:\s*(?:⌘⇧U|Ctrl\+Alt\+U))?$/, 'the «Новые» row of the palette (its key since X55)', 20_000);
      await waitOursText('modal', 'newfan_', 'the list of new subscribers', { timeout: 20_000, selector: '.cg-nw__side' });
      await look('board-05-newcomers', { check: async () => void (await inWindow('modal', '.cg-nw__side')) });
      await ours('modal', '.cg-nw__side [data-cg-key]').click();
      await browser.waitUntil(() => oursExists('modal', '.cg-pv'), { timeout: 10_000, timeoutMsg: 'the card did not open' });
      await pressOurs('modal', '.cg-pv button', /^Hi/);
      await waitOursText('modal', 'so glad you’re here', 'the greeting', { timeout: 20_000, selector: '.cg-pv' });
      await look('board-06-newcomers-card', {
        check: async () => {
          await inWindow('modal', '.cg-nw__side');
          await inWindow('modal', '.cg-pv');
        },
      });
      await closeAll();
      expect(await oursExists('modal', '.cg-nw__side')).toBe(false);
    });

    it('[X55] «Размер текста: Крупнее»: the dock with a result and «Новые» a step larger, still inside the window', async function () {
      this.timeout(240_000);
      await shift.patch({ ui: { textSize: 'large' } });
      await open(a1);
      await ready(a1);
      const rootSize = (where: Where, selector: string): Promise<string | null> => readOurs(where, selector, (node) => getComputedStyle(node).fontSize);
      await browser.waitUntil(async () => (await rootSize('dock', '.cg-root')) === '15px', { timeout: 5000, timeoutMsg: 'the dock did not take the larger text' });
      await generate(/^Reply/);
      // The token itself on the dock's root, and the text of a part not yet sent: a sent part is a muted line of its own
      // size (`is-done`, the md step: 15.5 px when larger), and the dock may still show one of the result before.
      expect(await readOurs('dock', '.cg-root', (node) => getComputedStyle(node).getPropertyValue('--cg-text-ai').trim())).toBe('16.5px');
      await browser.waitUntil(() => oursExists('dock', '.cg-part:not(.is-done) .cg-part__t'), { timeout: 10_000, timeoutMsg: 'no unsent part of the Reply' });
      expect(await readOurs('dock', '.cg-part:not(.is-done) .cg-part__t', (node) => getComputedStyle(node).fontSize)).toBe('16.5px');
      await look('dock-20-large-text', { all: false, check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hideResult();
      await leaveField();
      await browser.keys([...PANEL, 'u']);
      await waitOursText('modal', 'newfan_', 'the list of new subscribers', { timeout: 20_000, selector: '.cg-nw__side' });
      await browser.waitUntil(() => oursExists('modal', '.cg-pv'), { timeout: 10_000, timeoutMsg: 'the card did not open' });
      expect(await rootSize('modal', '.cg-root')).toBe('15px');
      await look('board-20-large-text-newcomers', {
        all: false,
        check: async () => {
          await inWindow('modal', '.cg-nw__side');
          await inWindow('modal', '.cg-pv');
        },
      });
      await closeAll();
      await shift.patch({ ui: { textSize: 'normal' } });
      await browser.waitUntil(async () => (await rootSize('dock', '.cg-root')) === '13px', { timeout: 5000, timeoutMsg: 'the dock did not go back to the normal text' });
    });

    it('the fan panel: the fan, its Recap', async function () {
      this.timeout(180_000);
      await leaveField();
      await browser.keys([']']);
      await waitOursText('panel', 'Fan Alder', 'the fan panel of the open chat');
      // §12 п. 6 «composer не перекрыт»: the panel ends above the dock, ChatSpace's Send is the pointer's.
      const overSend = await sendCovered('.cg-fp');
      facts['fanPanelOverSend'] = overSend;
      expect([overSend.coveredPx, overSend.sendReached]).toEqual([0, true]);
      await look('panel-01-fan', { check: async () => void (await inWindow('panel', '.cg-fp')) });
      await ours('panel', '.cg-fp__tabs [role="tab"]:last-child').click();
      await waitOursText('panel', 'Hubert, 34', 'the Recap of the fan panel', { timeout: 20_000 });
      // pilot-readiness §5 п. 12: the Recap tab and the footer speak of one archive in one voice — the hub's copy of
      // a Recap carries no coverage of its own, and that is not «неполный» over the footer's «архив полный».
      const footer = await oursText('panel', '.cg-fp__foot');
      const recapFacts = await oursText('panel', '.cg-fp__kv');
      facts['fanPanelArchive'] = { footer, recapFacts };
      expect(footer).toContain('архив полный');
      expect(recapFacts).toMatch(/Архив\s*полный/);
      expect(recapFacts).not.toContain('неполный');
      await look('panel-02-fan-recap', { all: false, check: async () => void (await inWindow('panel', '.cg-fp')) });
      await closeAll();
    });

    it('the palette, empty and searching; the cheatsheet', async function () {
      this.timeout(180_000);
      await leaveField();
      await browser.keys([MOD, 'k']);
      await browser.waitUntil(() => oursExists('modal', '.cg-pal__item'), { timeout: 10_000, timeoutMsg: 'the palette did not open' });
      await look('modal-01-palette', { check: async () => void (await inWindow('modal', '.cg-pal')) });
      await browser.keys('juni'.split(''));
      await waitOursText('modal', 'Fan Juniper', 'the palette found the fan', { selector: '.cg-pal' });
      await look('modal-02-palette-search', { all: false, check: async () => void (await inWindow('modal', '.cg-pal')) });
      await closeAll();
      await leaveField();
      await browser.keys(['?']);
      await waitOursText('modal', 'Клавиши ChatGoose', 'the cheatsheet');
      await look('modal-03-cheatsheet', { check: async () => void (await inWindow('modal', '.cg-cs')) });
      await closeAll();
    });

    it('the palette’s «Онлайн» and the preview window of an online fan (CS-030, X24)', async function () {
      this.timeout(180_000);
      // ChatSpace's own presence poll shows three fans online (rows near the top: it asks only about the rows on
      // screen); its next look is brought near for the picture.
      const dots = (): Promise<string[]> =>
        browser.execute(() => [...document.querySelectorAll<HTMLElement>('.chats-panel__list [data-chat-id]')].filter((row) => row.querySelector('.avatar--online') !== null).map((row) => row.dataset['chatId'] ?? ''));
      await standServer.presence(ACC, [a12, a11, a8]);
      await callStand('setFansOnlineTimings', { freshMs: 0, everyMs: 300 });
      await browser.waitUntil(
        async () => {
          const now = await dots();
          return [a12, a11, a8].every((fan) => now.includes(fan));
        },
        { timeout: 15_000, timeoutMsg: 'ChatSpace did not show the fans online' },
      );
      await leaveField();
      await browser.keys([MOD, 'k']);
      await waitOursText('modal', 'Сейчас онлайн, по данным ChatSpace', 'the palette’s «Онлайн» group', { selector: '.cg-pal', timeout: 10_000 });
      await waitOursText('modal', 'Fan Heath', 'Fan Heath in «Онлайн»', { selector: '.cg-pal' });
      // «Онлайн» stands below the actions of the open chat and «Ждут ответа»: the list is scrolled to it, as a person would.
      const toOnline = async (): Promise<void> => {
        await readOurs('modal', '.cg-pal__list', (node) => {
          node.scrollTop = node.scrollHeight;
          return node.scrollTop;
        });
        await waitOursText('modal', 'Fan Kestrel', 'the «Онлайн» rows on screen', { selector: '.cg-pal' });
      };
      await look('modal-05-palette-online', { all: false, fresh: toOnline, check: async () => void (await inWindow('modal', '.cg-pal')) });
      await pressOurs('modal', '.cg-pal__item', /^Fan Heath/, 'Fan Heath in «Онлайн»');
      await waitOursText('modal', 'Чат не открыт, останется непрочитанным', 'the preview window', { selector: '.cg-pvw', timeout: 10_000 });
      await waitOursText('modal', 'Fan Heath', 'the preview window of Fan Heath', { selector: '.cg-pvw .cg-pv__name' });
      const windowBox = await inWindow('modal', '.cg-pvw');
      facts['onlinePreviewWindow'] = windowBox;
      await look('modal-06-online-preview', { check: async () => void (await inWindow('modal', '.cg-pvw')) });
      await pressOurs('modal', '.cg-pvw .cg-pv button', /^Ping/);
      await waitOursText('modal', 'still thinking about what you said yesterday', 'the Ping in the window', { selector: '.cg-pvw .cg-pvr', timeout: 20_000 });
      await look('modal-07-online-preview-ping', { check: async () => void (await inWindow('modal', '.cg-pvw')) });
      await closeAll();
      expect(await oursExists('modal', '.cg-pvw')).toBe(false);
      // Nobody online for the pictures after this one (ChatSpace's next look takes the dots away), then its own timings again.
      await standServer.presence(ACC, []);
      await browser.waitUntil(async () => (await dots()).length === 0, { timeout: 15_000, timeoutMsg: 'ChatSpace still shows fans online' });
      await callStand('setFansOnlineTimings', { freshMs: 60_000, everyMs: 300_000 });
      // The chat that was open stayed open all along.
      expect((await callStand('route')).chatId).toBe(a1);
      await ready(a1);
    });

    it('Coach: an answer with a draft', async function () {
      this.timeout(180_000);
      await pressOurs('dock', '.cg-strip button', /^Coach/);
      await browser.waitUntil(async () => (await oursFocus('panel'))?.label === 'Вопрос Coach', { timeout: 10_000, timeoutMsg: 'the Coach field did not take the focus' });
      await look('panel-03-coach-empty', { all: false, check: async () => void (await inWindow('panel', '.cg-coach')) });
      await ours('panel', '.cg-co__ask textarea, .cg-co__ask input').click();
      await browser.keys('Стоит ли сейчас предлагать ему новый сет?'.split(''));
      await browser.keys(Key.Enter);
      await waitOursText('panel', 'Сегодня можно, но не первым сообщением', 'the Coach answer', { timeout: 20_000 });
      // X63: Coach is the old extension's window over the chat — Send waits under its scrim, and is free once it closes.
      const overSend = await sendCovered('.cg-coach');
      facts['coachOverSend'] = overSend;
      expect(overSend.sendReached).toBe(false);
      await look('panel-04-coach-answer', { check: async () => void (await inWindow('panel', '.cg-coach')) });
      await closeAll();
      expect((await sendCovered('.cg-coach')).sendReached).toBe(true);
    });

    it('[ER-014] toasts: a generation that ended in another chat is named by its fan; the one of the open chat is not toasted', async function () {
      this.timeout(180_000);
      // Chunks slow enough to leave the chat before the answer ends.
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 500 } });
      await open(a11, ACC, true);
      await ready(a11);
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      await dockIs((d) => d.target?.endsWith(`:${a11}`) === true && d.result !== null, 'the Reply of Fan Kestrel started');
      // The next chat's generation is refused twice by the hub (one transparent retry in between): it fails five seconds later.
      await callStand('openChat', ACC, a8);
      await ready(a8);
      await hub().command({ op: 'useSseScenario', scenario: 'unavailable-503-twice', match: 'route' });
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      await callStand('openChat', ACC, a1);
      await ready(a1);
      await waitOursText('toast', 'AI готово · Fan Kestrel', 'the toast of the generation that ended elsewhere', { timeout: 30_000 });
      // The pointer over a toast holds it.
      const done = await oursBox('toast', '.cg-toasts');
      if (done !== null) await browser.action('pointer').move({ x: Math.round(done.x + done.width / 2), y: Math.round(done.y + 20) }).perform();
      await look('toast-01-ready-elsewhere', { all: false, toasts: true, check: async () => void (await inWindow('toast', '.cg-toasts')) });
      await hub().command({ op: 'clearScripts' });
      await hub().command({ op: 'config', patch: { aiChunkDelayMs: 0 } });
      await browser.action('pointer').move({ x: 700, y: 300 }).perform();
      // Let go, a toast lives out its time and goes.
      await browser.waitUntil(async () => !(await oursExists('toast', '.cg-toast')), { timeout: 20_000, timeoutMsg: 'the toasts did not go' });
      // In the open chat the result is in the dock: nothing is toasted over it, however soon it ends.
      await pressOurs('dock', '.cg-strip button', /^Ping/);
      await dockIs((d) => d.result?.feature === 'ping' && d.result.state === 'done', 'the Ping of the open chat', 20_000);
      await browser.pause(600);
      expect(await oursExists('toast', '.cg-toast')).toBe(false);
      await hideResult();
    });
  });

  describe('the extension’s own pages', () => {
    it('the popup; the settings — «Статус», «Вид и звук», «Генерация»', async function () {
      this.timeout(240_000);
      await lookAtPage('page-popup', async () => {
        await openPopup();
        // The popup asks the ChatSpace tab what it shows: photographed once its buttons came on, not while they are still grey.
        await waitForPopup((state) => state.view === 'ready' && state.buttons['Spenders'] === true, 'the popup of a signed-in person, its buttons on');
      });
      await lookAtPage('page-options-status', async () => {
        await openOptions('status');
        // The page asks the ChatSpace tab what it sees: photographed once every row has its answer.
        await waitForOptions((state) => state.section === 'status' && !state.loading && Object.keys(state.rows).length > 0 && !/проверя|checking/i.test(Object.values(state.rows).map((row) => row.text).join(' ')), '«Статус» with its rows read');
      });
      await lookAtPage('page-options-appearance', async () => {
        await openOptions('appearance');
        await waitForOptions((state) => state.section === 'appearance' && !state.loading, '«Вид и звук»');
      });
      await lookAtPage(
        'page-options-generation',
        async () => {
          await openOptions('generation');
          await waitForOptions((state) => state.section === 'generation' && !state.loading, '«Генерация»');
        },
        false,
      );
    });
  });

  describe('the states that end the shift', () => {
    it('the daily quota is spent', async function () {
      this.timeout(180_000);
      await open(a2);
      await ready(a2);
      await hub().command({ op: 'useSseScenario', scenario: 'quota-429', match: 'route' });
      await pressOurs('dock', '.cg-strip button', /^Reply/);
      const spent = await dockIs((d) => d.result?.error === 'CG-QUOTA-DAILY' || d.banner === 'CG-QUOTA-DAILY', 'the quota card', 20_000);
      facts['quota'] = { status: spent.status, banner: spent.banner, error: spent.result?.error ?? null };
      await look('dock-18-quota', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await hub().command({ op: 'clearScripts' });
    });

    it('nobody is signed in: the dock, the popup, the sign-in screen', async function () {
      this.timeout(180_000);
      await shift.toPages();
      await signOutFromAccount();
      await waitForOptions((state) => state.gate, 'signed out: the sign-in screen');
      await browser.url(testBuildPage(QUIET_PAGE));
      await shift.toStand();
      await dockIs((d) => d.status === 'not-signed-in', 'the dock says nobody is signed in');
      await look('dock-19-not-signed-in', { check: async () => void (await inWindow('dock', '.cg-dock')) });
      await lookAtPage('page-popup-signed-out', async () => {
        await openPopup();
        await waitForPopup((state) => state.view === 'forbidden', 'the popup with nobody signed in');
      });
      await lookAtPage('page-options-sign-in', async () => {
        await openOptions();
        await waitForOptions((state) => state.gate, 'the sign-in screen');
      });
    });
  });
});
