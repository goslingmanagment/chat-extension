// «Очереди» (2026-10-29), the owner's prototype on the stand (fake hub `fanQueues: stand`), on both sites: «Очереди 1 ↩»
// on the bar (someone answered a message from a queue); ⌘K with «Очереди» and the page's queues; the window opening on
// the fan who answered (Reply advised, written by the click, sent by «Отправить»); the cold batch queue with the
// guide's B text standing at once and «Отправить всем N»; the standing «Платили, молчат» with Ping advised, written by
// the click; «Пропустить ▾» with its reasons; the paused queue; a queue's own message («Сообщение очереди», its
// variants); the chatter's own queue skipped to its end, «Порция пройдена». Only the Reply to the fan who answered is
// sent (the stand's chat).

import { WORLD } from '../../../src/scenarios/hub';
import { around, scenario, type See } from '../kit';

/** The page the stand's tab is bound to. */
const pageOf = (site: string): string => (site === 'fansly' ? WORLD.pages.fansly.pageLabel : WORLD.pages.one.pageLabel);

/** The pointer off our window before a picture: no tooltip of the last press stands in it. */
async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(300);
  await s.shot(name);
}

/** A part of the tab, the world's pixels 1:1: a new control checked for its alignment. */
async function crop(s: See, name: string, where: 'dock' | 'modal', selector: string, pad = 8): Promise<void> {
  const box = await s.rect(where, selector);
  if (box === null) return;
  await s.shot(name, { clip: around([box], pad), file: `${name}-${s.site}` });
}

/** A chip of the window's queues, by its id (fan-queues.ts: 1 cold, 2 paid, 3 paused, 4 the chatter's own, 5 thanks). */
async function chooseQueue(s: See, queueId: number): Promise<void> {
  await s.h.ours('modal', `.qu-chip[data-cg-queue="${queueId}"]`).click();
  await s.browser.pause(1_200);
}

/** The first fan of the chosen queue's portion: his card. */
async function firstOfPortion(s: See): Promise<void> {
  await s.browser.waitUntil(() => s.has('modal', '[data-cg-queue-group="portion"] [data-cg-online-row]'), { timeout: 20_000, interval: 300, timeoutMsg: 'the queue handed out no portion' });
  await s.h.ours('modal', '[data-cg-queue-group="portion"] [data-cg-online-row]').click();
  await s.browser.waitUntil(() => s.has('modal', '.ol-why[data-cg-reason="queue"]'), { timeout: 20_000, interval: 300, timeoutMsg: 'the portion fan\'s card did not open' });
  await s.browser.pause(1_000);
}

/** «Пропустить ▾» of the open card, and one of its reasons. */
async function skip(s: See, reason: RegExp): Promise<void> {
  await s.h.ours('modal', '.ol-compose__row .cg-menu-anchor > .cg-btn').click();
  await s.browser.waitUntil(() => s.has('modal', '.cg-menu__item'), { timeout: 5_000, interval: 200, timeoutMsg: 'the skip menu did not open' });
  await s.press(reason, 'modal', '.cg-menu__item');
  await s.browser.pause(1_000);
}

scenario(
  'queues',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    else await s.leaveField();

    // The bar: «Очереди 1 ↩», a fan answered a message from a queue.
    await s.browser.waitUntil(() => s.has('dock', '.cg-act__n.is-answered'), { timeout: 30_000, interval: 300, timeoutMsg: 'no «Очереди N ↩» on the bar' });
    await shot(s, 'queues-bar');
    await crop(s, 'queues-chip', 'dock', '.cg-act__n.is-answered', 40);

    // ⌘K: «Очереди» among the windows and the page's queues as a group of their own.
    await s.keys(s.MOD, 'k');
    await s.see('modal', 'Очереди страницы', 15_000);
    // The end of the list: the page's queues under the windows.
    await s.keys(s.Key.End);
    await s.browser.pause(400);
    const palette = await s.rect('modal', '.cg-pal');
    await s.shot('queues-palette', { clip: around([palette], 24), file: `queues-palette-${s.site}` });
    await s.keys(s.Key.Escape);
    await s.browser.pause(400);

    // The window opens on the fan who answered: Reply advised, his answer in the conversation.
    await s.press(/Очереди/, 'dock', '.cg-strip button');
    await s.see('modal', 'Ответили', 20_000);
    await s.browser.waitUntil(() => s.has('modal', '.ol-why[data-cg-reason="answered"]'), { timeout: 30_000, interval: 300, timeoutMsg: 'the answered fan\'s card did not open' });
    await s.browser.pause(1_500);
    await shot(s, 'queues-answered');

    // The cold batch queue: the first fan of the portion, the guide's B with his name at once, «Отправить всем N».
    await firstOfPortion(s);
    await s.browser.pause(500);
    await shot(s, 'queues-window');
    await crop(s, 'queues-chips', 'modal', '.qu-chips', 0);
    await crop(s, 'queues-line', 'modal', '.qu-line', 0);
    await crop(s, 'queues-foot', 'modal', '.cg-nw__batch', 0);

    // Back to the fan who answered: Reply by the click, then «Отправить» (the stand's chat).
    await s.h.ours('modal', '[data-cg-queue-group="answered"] [data-cg-online-row]').click();
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="idle"] [data-cg-online-pick]'), { timeout: 20_000, interval: 300, timeoutMsg: 'the answered fan offers nothing to write' });
    await s.h.ours('modal', '[data-cg-online-pick] .cg-pvb__slot > .cg-act.cg-act--main').click();
    await s.browser.waitUntil(() => s.has('modal', '.cg-ow__csend:not([aria-disabled="true"])'), { timeout: 60_000, interval: 300, timeoutMsg: 'the Reply cannot be sent' });
    await s.browser.pause(600);
    await shot(s, 'queues-answered-reply');
    await s.press(/^Отправить/, 'modal', '.cg-ow__csend');
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="sent"]'), { timeout: 30_000, interval: 200, timeoutMsg: 'the Reply did not go' });
    await shot(s, 'queues-answered-sent');
    await s.browser.pause(1_500);

    // «Платили, молчат»: Ping advised; the click writes it.
    await chooseQueue(s, 2);
    await firstOfPortion(s);
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="idle"] [data-cg-online-pick]'), { timeout: 30_000, interval: 300, timeoutMsg: 'the Ping card offers no choice' });
    await shot(s, 'queues-ping');
    await s.h.ours('modal', '[data-cg-online-pick] .cg-pvb__slot > .cg-act.cg-act--main').click();
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-zone="draft"], [data-cg-zone="unwritten"]'), { timeout: 60_000, interval: 300, timeoutMsg: 'the Ping was not written' });
    await s.browser.pause(800);
    await shot(s, 'queues-ping-text');

    // «Пропустить ▾»: its four reasons with what each does.
    await s.h.ours('modal', '.ol-compose__row .cg-menu-anchor > .cg-btn').click();
    await s.browser.waitUntil(() => s.has('modal', '.cg-menu__item'), { timeout: 5_000, interval: 200, timeoutMsg: 'the skip menu did not open' });
    await s.browser.pause(300);
    await shot(s, 'queues-skip');
    await crop(s, 'queues-skip-menu', 'modal', '.cg-menu', 8);
    await s.keys(s.Key.Escape);
    await s.browser.pause(300);

    // «Холодные остальные» on pause: who paused it and when; its fans stay with it.
    await chooseQueue(s, 3);
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-queue-end="paused"]'), { timeout: 15_000, interval: 300, timeoutMsg: 'the paused queue says nothing' });
    await s.browser.pause(600);
    await shot(s, 'queues-paused');

    // «Спасибо за месяц»: the queue's own message with the fan's name, «вариант 1 из 2», «Другой вариант».
    await chooseQueue(s, 5);
    await firstOfPortion(s);
    await s.browser.pause(600);
    await shot(s, 'queues-own');
    await s.press(/^Другой вариант/, 'modal', '.cg-ow__link');
    await s.browser.pause(900);
    await crop(s, 'queues-own-next', 'modal', '.ol-text', 8);

    // The chatter's own queue: both fans skipped («Не подходит»), its portion done.
    await chooseQueue(s, 4);
    await firstOfPortion(s);
    for (let left = 0; left < 4 && !(await s.has('modal', '[data-cg-queue-end="portion"]')); left += 1) {
      await s.browser.waitUntil(() => s.has('modal', '.ol-compose__row .cg-menu-anchor > .cg-btn, [data-cg-queue-end="portion"]'), { timeout: 20_000, interval: 300, timeoutMsg: 'no card to skip' });
      if (await s.has('modal', '[data-cg-queue-end="portion"]')) break;
      await skip(s, /^Не подходит/);
    }
    await s.browser.waitUntil(() => s.has('modal', '[data-cg-queue-end="portion"]'), { timeout: 15_000, interval: 300, timeoutMsg: 'the portion did not end' });
    await s.browser.pause(600);
    await shot(s, 'queues-portion-done');
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
