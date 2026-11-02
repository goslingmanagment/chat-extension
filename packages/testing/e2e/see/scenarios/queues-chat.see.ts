// «Очереди» in the chat (2026-11-02), on both sites over the fake hub's prototype set: the day's reminder over the bar;
// «Начать →» opens the first fan's chat with the strip (why he is in the queue, «Карточка», «Пропустить ▾», «Следующий →»);
// a message sent from the chat itself: «Написано», counted, the next fan's name the main button; «Следующий» opens his chat;
// another chat: one line back to the queue; a reload: the strip is back (the hub holds the portion); the window's
// results line; the × ends the walk. The messages go only to the stand's chats.

import { WORLD } from '../../../src/scenarios/hub';
import { SEND } from '../../support/chat';
import { FANSLY_MAIN } from '../../support/fansly-stand';
import { around, scenario, type See } from '../kit';

const pageOf = (site: string): string => (site === 'fansly' ? WORLD.pages.fansly.pageLabel : WORLD.pages.one.pageLabel);

async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(400);
  await s.shot(name);
}

/** The strip, the world's pixels 1:1: a new control checked for its alignment. */
async function crop(s: See, name: string): Promise<void> {
  const box = await s.rect('dock', '.cg-qs');
  if (box === null) return;
  await s.shot(name, { clip: around([box], 10), file: `${name}-${s.site}` });
}

const strip = (s: See, state: string): Promise<boolean> => s.has('dock', `[data-cg-queue-strip="${state}"]`);
const waitStrip = (s: See, state: string, timeout = 30_000): Promise<unknown> =>
  s.browser.waitUntil(() => strip(s, state), { timeout, interval: 250, timeoutMsg: `no strip «${state}»` });

/** A message sent from the chat itself, by the site's own Send: the person's own text. */
async function sendFromChat(s: See, text: string): Promise<void> {
  if (s.site === 'fansly') {
    await s.h.$(FANSLY_MAIN.field).click();
    await s.browser.keys(text);
    await s.browser.pause(200);
    await s.h.$(FANSLY_MAIN.send).click();
    return;
  }
  await s.type(text);
  await s.browser.pause(200);
  await s.h.$(SEND).click();
}

scenario(
  'queues-chat',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    else await s.leaveField();

    // The day's reminder: a queue has fans for the person, they have not started it today.
    await waitStrip(s, 'nudge', 45_000);
    await shot(s, 'qc-nudge');
    await crop(s, 'qc-nudge-strip');

    // «Начать →»: the portion is taken, the first fan's chat opens by this click.
    await s.press(/^Начать/, 'dock', '.cg-qs button');
    // Whoever answered a message from a queue comes first: a Reply from the chat answers him.
    await waitStrip(s, 'answered');
    await s.browser.pause(1_200);
    await shot(s, 'qc-answered');
    await sendFromChat(s, 'there you are, tell me everything');
    await waitStrip(s, 'written');
    await s.browser.pause(600);
    await s.press(/^Следующий/, 'dock', '.cg-qs button');
    await waitStrip(s, 'todo');
    await s.browser.pause(1_200);
    await shot(s, 'qc-todo');
    await crop(s, 'qc-todo-strip');
    // A narrow chat: «Карточка» gives its place, the words give way first.
    const wide = await s.browser.getWindowSize();
    await s.browser.setWindowSize(1000, 800);
    await s.browser.pause(800);
    await crop(s, 'qc-todo-narrow');
    await s.browser.setWindowSize(wide.width, wide.height);
    await s.browser.pause(500);

    // «Пропустить ▾» stands over the strip, its reasons with what each does.
    await s.press(/^Пропустить/, 'dock', '.cg-qs button');
    await s.browser.waitUntil(() => s.has('dock', '.cg-menu__item'), { timeout: 5_000, interval: 200, timeoutMsg: 'the skip menu did not open' });
    await s.browser.pause(300);
    await shot(s, 'qc-skip');
    await s.keys(s.Key.Escape);
    await s.browser.pause(300);

    // A message from the chat itself: the strip says it went, the next fan is the main button.
    await sendFromChat(s, 'hey you, been thinking about that trip you told me about');
    await waitStrip(s, 'written');
    await s.browser.pause(800);
    await shot(s, 'qc-written');
    await crop(s, 'qc-written-strip');
    // The hub hears it from the send's own report: the day's count is its own by then.
    await s.browser.pause(6_500);
    await crop(s, 'qc-written-counted');

    // «Следующий: …»: his chat opens by the click.
    await s.press(/^Следующий/, 'dock', '.cg-qs button');
    await waitStrip(s, 'todo');
    await s.browser.pause(1_200);
    await shot(s, 'qc-next');

    // A reload: the hub holds the portion, the strip comes back.
    await s.browser.refresh();
    await s.ready();
    await waitStrip(s, 'todo', 45_000);
    await s.browser.pause(800);
    await shot(s, 'qc-reloaded');

    // «Карточка»: the window opens on this fan; what the work came to under the list.
    await s.press(/^Карточка/, 'dock', '.cg-qs button');
    await s.browser.waitUntil(() => s.has('modal', '.ol-why[data-cg-reason="queue"]'), { timeout: 20_000, interval: 300, timeoutMsg: 'the fan\'s card did not open' });
    await s.browser.pause(1_000);
    await shot(s, 'qc-card');
    const foot = await s.rect('modal', '.cg-nw__batch');
    if (foot !== null) await s.shot('qc-foot', { clip: around([foot], 0), file: `qc-foot-${s.site}` });
    await s.keys(s.Key.Escape);
    await s.browser.pause(600);

    // The window closed: the walk goes on.
    await waitStrip(s, 'todo');

    // Another chat: one line back to the queue (ChatSpace's stand has one to go to).
    if (s.site === 'chatspace') {
      await s.openChat(s.ids.fans.a2);
      await waitStrip(s, 'elsewhere');
      await s.browser.pause(800);
      await shot(s, 'qc-elsewhere');
      await crop(s, 'qc-elsewhere-strip');
    }

    // The ×: the walk is over.
    await s.h.ours('dock', '.cg-qs__x').click();
    await s.browser.waitUntil(async () => !(await s.has('dock', '.cg-qs')), { timeout: 10_000, interval: 250, timeoutMsg: 'the strip did not go' });
    await shot(s, 'qc-stopped');
  },
  {
    sites: ['chatspace', 'fansly'],
    previewSend: true,
    showcase: true,
    before: async (s) => {
      await s.hub.command({ op: 'fanQueues', pageLabel: pageOf(s.site), set: 'stand' });
    },
  },
);
