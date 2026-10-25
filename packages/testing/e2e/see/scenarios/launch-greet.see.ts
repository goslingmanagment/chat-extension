// launch-greet: the greeting reminder's pictures for 3.0's notes (changes/greet-toast-hi-into-chat.md,
// changes/greet-reminder-team.md) in the showcase world at 2×.
//
//   pnpm see launch-greet                — ChatSpace: Hi in «Ждёт приветствия» opens Liam's chat with the greeting in
//                                          the field, Send left to press;
//   pnpm see launch-greet --site fansly  — Fansly: the same for Matt; Hi on Jordan, whom a colleague greeted meanwhile
//                                          (his chat open, «Кто-то уже поприветствовал …»); the reminder as a tab of
//                                          another model shows it (the kit gallery's toast: the stand runs one creator).
//
// The flows are greet-reminder.see.ts, fansly-greet-reminder.see.ts and fansly-greet-already.see.ts; the pictures are
// `greet-*.png` in the run's folder.

import { WORLD } from '../../../src/scenarios/hub';
import { EDITOR } from '../../support/chat';
import { pageRpc, writeLocalStorage } from '../../support/extension';
import { QUIET_PAGE } from '../../support/fake-hub';
import { followFrame } from '../../../fixture-fansly/src/wire';
import { FANSLY_MAIN, fakeFansly } from '../../support/fansly-stand';
import { STAND_IDS, standOrigin } from '../../support/stand';
import { scenario, showcaseAiTexts, STAND_PAGE, type Box, type See } from '../kit';

const MIN = 60_000;
/** Followers of Sofia Lane the fake Fansly names (fixture-fansly/src/showcase.ts `showcasePerson`): Matt Riley, Jordan Graham. */
const MATT = '930000000000000781';
const JORDAN = '930000000000000783';
/** What Hi writes for a new follower. */
const GREETING = 'hey you 💛 so glad you followed — what caught your eye first?';
/** What a colleague wrote to Jordan from another browser while his reminder waited. */
const COLLEAGUE = ['hey Jordan 💕 so happy you followed!', 'what caught your eye first? 😊'];
const groups = new Map<string, string>();

const box = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

async function pageBox(s: See, selector: string): Promise<Box> {
  const found = await s.rect('page', selector);
  if (found === null) throw new Error(`no ${selector} on the page`);
  return found;
}

/** «Новые фоловеры» opened by the popup's command (Fansly has no palette), as during a shift. */
async function openNewcomers(s: See): Promise<void> {
  await s.toPages();
  await s.browser.url(s.page('popup.html'));
  await pageRpc('tab.command', { command: { kind: 'surface', surface: 'newcomers' } });
  await s.browser.url(s.page(QUIET_PAGE));
  await s.toChat();
  await s.browser.waitUntil(() => s.has('modal', '.cg-fnw'), { timeout: 20_000, timeoutMsg: 'the window did not open' });
}

/** The pointer off our buttons: no hint over what a picture shows. */
async function restPointer(s: See): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2 }).perform();
  await s.wait(300);
}

async function chatspace(s: See): Promise<void> {
  await s.ready();
  // The list of «Новые» read once (the palette row), so the reminder hears it at once.
  await s.leaveField();
  await s.keys(s.MOD, 'k');
  await s.press(/^Новые/, 'modal', '.cg-pal__item');
  await s.see('toast', 'Ждёт приветствия', 15_000);
  await s.closeAll();
  await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
  await s.browser.waitUntil(async () => (await s.browser.$(EDITOR).getText()).trim() !== '', { timeout: 30_000, timeoutMsg: 'the greeting did not land in the chat' });
  await restPointer(s);
  await s.wait(800);
  const list = await pageBox(s, 'aside.chats-panel');
  const panel = await pageBox(s, 'section.conversation-panel');
  await s.shot('hi-into-chat', { file: 'greet-toast-hi-into-chat-chatspace', clip: box(list.x, 0, panel.x + panel.width + 8 - list.x, 900) });
}

async function fansly(s: See): Promise<void> {
  await s.ready();
  // The checks of followers ask the stand's API (bg/fansly/api-probe.ts).
  await s.toPages();
  await s.browser.url(s.page('popup.html'));
  await writeLocalStorage({ 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
  await s.browser.url(s.page(QUIET_PAGE));
  await s.toChat();

  // Matt followed eleven minutes ago too; his follow's frame comes later (below): the window's pass lists him now, and
  // his reminder comes after Jordan's.
  const matt = (await fakeFansly().command({ op: 'follow', followerId: MATT, agoMs: 11 * MIN, silent: true })).follow;
  if (matt === undefined) throw new Error('no follow of Matt');

  // Jordan followed eleven minutes ago and his reminder came; meanwhile a colleague greeted him from another browser,
  // and the window, opened as during a shift, has him «Уже писали». Hi on his reminder writes nothing: his chat opens
  // with the colleague's greeting, and the toast says somebody was faster.
  await fakeFansly().command({ op: 'follow', followerId: JORDAN, agoMs: 11 * MIN });
  await s.see('toast', 'Ждёт приветствия', 30_000);
  for (const text of COLLEAGUE) await fakeFansly().command({ op: 'message', groupId: groups.get(JORDAN) ?? '', from: 'creator', text, silent: true });
  await openNewcomers(s);
  // Checked and «Уже писали»: he leaves «К обработке», which then counts one fewer than «Все».
  await s.browser.waitUntil(
    async () => {
      const text = await s.text('modal');
      const todo = /К обработке\s*(\d+)/.exec(text)?.[1];
      const all = /Все\s*(\d+)/.exec(text)?.[1];
      return text.includes('Проверено') && todo !== undefined && all !== undefined && Number(todo) < Number(all);
    },
    { timeout: 90_000, timeoutMsg: 'Jordan was not found greeted' },
  );
  await s.browser.keys('Escape');
  await s.wait(600);
  await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
  // The toast goes by itself in a few seconds: the picture is taken as soon as it is there.
  await s.see('toast', 'Кто-то уже поприветствовал', 30_000);
  await s.shot('already-greeted', { file: 'greet-reminder-team', clip: box(0, 0, 1440, 900) });

  // «Новые фоловеры» open on Matt's card (the pass checked him: nobody wrote) when his follow's frame comes and with it
  // his reminder. Hi writes the greeting, and his chat opens with it in Fansly's own field. (Hi from the toast on a fan
  // the pass checked before, with the window closed, meets the card's draft still loading — CG-DATA-NOT-READY.)
  await openNewcomers(s);
  const mattRow = `.cg-nw__row[data-cg-fan$=":${MATT}"]`;
  await s.browser.waitUntil(async () => (await s.h.readOurs('modal', mattRow, (node) => node.getAttribute('data-cg-check'))) === 'ready', { timeout: 60_000, timeoutMsg: 'Matt was not checked' });
  await s.h.ours('modal', mattRow).click();
  await s.browser.waitUntil(() => s.has('modal', '.cg-nc__greet'), { timeout: 10_000, timeoutMsg: 'Matt\'s card did not open' });
  await s.wait(800);
  await fakeFansly().command({ op: 'frames', frames: [followFrame(matt)] });
  await s.see('toast', 'Matt Riley', 30_000);
  await s.press(/^Hi$/, 'toast', '.cg-toast__acts button');
  await s.browser.waitUntil(async () => ((await s.browser.$(FANSLY_MAIN.field).getValue().catch(() => '')) as string).trim() !== '', { timeout: 90_000, timeoutMsg: 'the greeting did not land in the chat' });
  await restPointer(s);
  await s.wait(800);
  await s.shot('hi-into-chat', { file: 'greet-toast-hi-into-chat', clip: box(0, 0, 1440, 900) });

  // The reminder in a tab of another model names the fan's model above him. The stand's Fansly runs one creator, so
  // the toast is the kit gallery's (the same component, Fansly's palette): Matt, Sofia Lane's follower.
  await s.browser.url(`${standOrigin()}/kit-gallery/?host=fansly&theme=light&lang=ru&section=toasts`);
  const host = await s.browser.$('[data-host="gallery"]');
  await host.waitForExist({ timeout: 15_000 });
  await s.browser.waitUntil(async () => (await host.shadow$$('.cg-toast--greet').getElements()).length > 0, { timeout: 15_000, timeoutMsg: 'no reminder in the gallery' });
  // The gallery's other toasts out of the frame: this one alone, where the column starts.
  const toasts = (await host.shadow$$('.cg-toast').getElements()) as unknown as HTMLElement[];
  await s.browser.execute((...nodes: HTMLElement[]) => {
    for (const node of nodes) if (!node.innerText.includes('Sofia Lane')) node.style.display = 'none';
  }, ...toasts);
  const ours = (await host.shadow$$('.cg-toast--greet').getElements()) as unknown as HTMLElement[];
  const rectOf = (): Promise<Box | null> =>
    s.browser.execute((...nodes: HTMLElement[]) => {
      const node = nodes.find((each) => each.innerText.includes('Sofia Lane'));
      if (node === undefined) return null;
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }, ...ours);
  // Its slide in ended: the box stands still.
  let found: Box | null = null;
  await s.browser.waitUntil(
    async () => {
      const now = await rectOf();
      const still = now !== null && found !== null && Math.abs(now.y - found.y) < 0.5 && Math.abs(now.height - found.height) < 0.5;
      found = now;
      return still;
    },
    { timeout: 10_000, interval: 300, timeoutMsg: 'the reminder kept moving' },
  );
  const toast = found as Box | null;
  if (toast === null) throw new Error('no reminder of another model in the gallery');
  await restPointer(s);
  await s.shot('other-model', { file: 'greet-reminder-team-other-model', clip: box(toast.x - 12, toast.y - 12, toast.width + 24, toast.height + 24) });
}

scenario('launch-greet', (s) => (s.site === 'fansly' ? fansly(s) : chatspace(s)), {
  sites: ['chatspace', 'fansly'],
  showcase: true,
  previewSend: true,
  timeout: 300_000,
  before: async ({ hub, site, stand }) => {
    if (site === 'chatspace') {
      // Liam subscribed twelve minutes ago and nobody greeted him (the showcase's chat a5).
      await stand.traffic({ firstSummaryMs: 150 });
      await hub.command({ op: 'audienceEvent', pageLabel: STAND_PAGE, fanRef: STAND_IDS.fans.a5, agoMs: 12 * MIN, username: 'liamturner', displayName: 'Liam Turner' });
      return;
    }
    // Each follower's chat, empty, and the hub's capture of it.
    for (const fan of [MATT, JORDAN]) {
      const created = await fakeFansly().command({ op: 'conversation', fanId: fan });
      if (created.groupId === undefined) throw new Error('no greeting group');
      groups.set(fan, created.groupId);
      await hub.command({ op: 'thread', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, fanRef: fan });
      await hub.command({ op: 'archiveConversation', pageLabel: WORLD.pages.fansly.pageLabel, conversationRef: created.groupId, messages: [] });
    }
    await hub.command({ op: 'config', patch: { aiTexts: { ...showcaseAiTexts('fansly'), 'hi-greeting': GREETING } } });
  },
});
