// «Кастомы» of the fan panel as Workboard's (products package R5), on ChatSpace and Fansly: in «Память» the open orders
// first, each with its code, its step in Workboard's words, who has it now and the deadline (red when it passed); «Отдан»
// only on a shot order («Снят») the board lets this person give, asked once first (no way back; Hub lets every open
// order be given, the panel does as Workboard's card does); «В Workboard ↗» opens the order's card in a new tab by the one-time
// link. «Записать кастом» opens Workboard's own form over the site with the page and the fan filled in — what it records
// shows in the panel at once; «Спросить» opens Workboard's question window the same way. On the stand the windows are
// the fake hub's stub of Workboard's (fake-hub/workboard-forms.ts) speaking the same frame protocol; ChatSpace also shows
// the page's open customs in «Передача» of «Дела».

import { $, browser } from '@wdio/globals';

import { fanslyIds } from '../../support/fansly-stand';
import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario, type See } from '../kit';
import { FRAME_LAYER, inFrame, layerShown } from '../report';

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const day = (days: number): string => new Date(Date.now() + days * 86_400_000 + 3 * 3_600_000).toISOString().slice(0, 10);
const { a1, a2 } = STAND_IDS.fans;

/** An order of the card as Hub sends it since R5: its step in Workboard's words, who has it, the deadline, «Отдан». */
function order(pageLabel: string, id: number, description: string, priceMills: number, fields: { readonly label: string; readonly state: string; readonly hours: number; readonly deadline: string | null; readonly overdue?: number; readonly leader: { readonly name: string | null; readonly product: string } | null; readonly mayGive?: boolean; readonly given?: true }) {
  return {
    id,
    pageLabel,
    granted: true,
    description,
    priceMills,
    state: fields.given === true ? 'delivered' : fields.state === 'recorded' ? 'ordered' : 'paid',
    paymentMills: null,
    paidAt: null,
    deliveredMessageRef: null,
    deliveredAt: fields.given === true ? ago(fields.hours) : null,
    createdBy: 'Nikita',
    createdAt: ago(fields.hours + 30),
    deliveryCandidates: [],
    code: `K-${String(id)}`,
    stepLabel: fields.label,
    stepAt: ago(fields.hours),
    orderState: fields.state,
    deadlineOn: fields.deadline,
    overdueDays: fields.overdue ?? null,
    leader: fields.leader,
    mayGive: fields.mayGive ?? false,
  };
}

function customsOf(pageLabel: string) {
  return [
    order(pageLabel, 13, 'Фото в душе, 8 штук', 45_000, { label: 'Снят', state: 'shot', hours: 5, deadline: day(1), leader: { name: 'Nikita', product: 'workboard' }, mayGive: true }),
    order(pageLabel, 11, 'Видео 5 минут в красном белье, с его именем', 120_000, { label: 'У модели', state: 'at_model', hours: 46, deadline: day(-2), overdue: 2, leader: { name: 'Lora', product: 'contentops' }, mayGive: true }),
    order(pageLabel, 12, 'Фотосет в очках, 10 фото', 60_000, { label: 'Записан', state: 'recorded', hours: 22, deadline: day(4), leader: null, mayGive: true }),
    order(pageLabel, 10, 'Голосовое с днём рождения', 30_000, { label: 'Отдан', state: 'given', hours: 380, deadline: null, leader: null, given: true }),
  ];
}

function cardOf(pageLabel: string, fanRef: string, name: string, platform: string) {
  return {
    pageLabel,
    fanRef,
    known: true,
    accounts: [{ platform, fanRef, username: null, displayName: name, gone: false, linkedBy: null }],
    pages: [{ pageLabel, platform, modelName: 'Model One', fanRef, granted: true, alias: '💵Alder/Canada/38', subscribed: true, subscribedSince: null, subscriptionEndsAt: null, spentMills: 1_248_000, last30Mills: { tip: 320_000 }, lastPurchaseAt: null }],
    suggestions: [],
    facts: [],
    customs: customsOf(pageLabel),
    // Hub still sends the tips no custom took; the panel no longer shows them.
    customPayments: [],
    serverNow: new Date().toISOString(),
  };
}

/** Types into a field of the stub window (a dispatched input where Firefox's test keys refuse a frame). */
async function fill(selector: string, text: string): Promise<void> {
  await inFrame(async () => {
    await browser.$(selector).waitForExist({ timeout: 15_000 });
    await browser.execute(
      (wanted: string, value: string) => {
        const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(wanted);
        if (field === null) return;
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      selector,
      text,
    );
  });
}

/** Presses a button of the stub window by its id, then waits for the window to go. */
async function pressAndClose(id: string): Promise<void> {
  await inFrame(async () => {
    await browser.$(`#${id}`).click();
  });
  await browser.waitUntil(async () => !(await layerShown()), { timeout: 20_000, interval: 200, timeoutMsg: 'the window stayed over the site' });
}

/** Waits for the window over the site and its port (the stub says nothing once the port is there). */
async function windowUp(s: See, shot: string): Promise<string> {
  await browser.waitUntil(layerShown, { timeout: 30_000, interval: 200, timeoutMsg: 'no window over the site' });
  const src = await $(FRAME_LAYER).shadow$('iframe').getAttribute('src');
  await inFrame(async () => {
    await browser.waitUntil(async () => ((await browser.$('#log').getText().catch(() => 'x')) as string).trim() === '', { timeout: 20_000, interval: 200, timeoutMsg: 'the window got no port' });
  });
  await s.wait(300);
  await s.shot(shot);
  return (src ?? '').replace(/#.*$/, '');
}

scenario(
  'customs',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') {
      // Fansly's open chat: its fan by the stand's own ids; the card is set before the panel reads it.
      const ids = await fanslyIds();
      const group = ids.groups[0] ?? '';
      const fanRef = ids.fans[group] ?? '';
      const pageLabel = s.world.pages.fansly.pageLabel;
      await s.hub.command({ op: 'fanCard', pageLabel, fanRef, card: cardOf(pageLabel, fanRef, 'Fan Fansly', 'fansly') });
    }
    if (s.site === 'chatspace') await s.leaveField();
    else await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await s.keys(']');
    await s.press(/^Память/, 'panel');
    await s.see('panel', 'у кого сейчас', 20_000);
    await s.shot('customs');

    // «Записать кастом»: Workboard's form over the site, for this page and fan.
    await s.press(/^Записать кастом/, 'panel');
    console.log(`cg-see form: ${await windowUp(s, 'custom-form')}`);
    await fill('#task', 'Видео 3 минуты, в чёрном, с его именем');
    await fill('#price', '80$');
    await s.shot('custom-form-filled');
    await pressAndClose('go');
    await s.see('panel', 'Видео 3 минуты, в чёрном', 20_000);
    await s.shot('custom-recorded');

    // «Отдан»: only on the shot order, asked once first; then Workboard's own step.
    await s.press(/^Отдан$/, 'panel');
    await s.see('panel', 'Это шаг без возврата', 10_000);
    await s.shot('custom-give-ask');
    await s.press(/^Отдать$/, 'panel');
    await s.wait(1500);
    await s.shot('custom-given');

    // «Спросить»: Workboard's question window over the site.
    await s.press(/^Спросить/, 'panel');
    console.log(`cg-see ask: ${await windowUp(s, 'ask')}`);
    await fill('#text', 'Можно ему скидку 60% на набор?');
    await s.shot('ask-filled');
    await pressAndClose('go');
    await s.shot('ask-sent');

    // «В Workboard ↗»: the order's card in a new tab by the one-time link.
    const before = await browser.getWindowHandles();
    const here = await browser.getWindowHandle();
    await s.press(/^В Workboard/, 'panel');
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > before.length, { timeout: 20_000, timeoutMsg: '«В Workboard» opened no tab' });
    const opened = (await browser.getWindowHandles()).find((handle) => !before.includes(handle));
    if (opened !== undefined) {
      await browser.switchToWindow(opened);
      await browser.waitUntil(async () => (await browser.getUrl()) !== 'about:blank', { timeout: 10_000, timeoutMsg: 'the new tab has no address' });
      console.log(`cg-see card: ${(await browser.getUrl()).replace(/code=[^&]+/, 'code=<code>')}`);
      await browser.closeWindow();
      await browser.switchToWindow(here);
    }

    if (s.site === 'chatspace') {
      await s.press(/^Дела/, 'panel');
      await s.press(/^Передача/, 'panel');
      await s.see('panel', 'Открытые кастомы', 20_000);
      await s.shot('customs-handoff');
    }
  },
  {
    sites: ['chatspace', 'fansly'],
    viewport: { width: 1440, height: 1200 },
    before: async ({ hub, site }) => {
      if (site !== 'chatspace') return;
      await hub.command({ op: 'fanCard', pageLabel: STAND_PAGE, fanRef: a1, card: cardOf(STAND_PAGE, a1, 'Fan Alder', 'onlyfans') });
      await hub.command({
        op: 'queue',
        pageLabel: STAND_PAGE,
        handoff: {
          pageLabel: STAND_PAGE,
          recent: [{ fanRef: a1, conversationRef: a1, username: 'stand_fan_1_1', alias: '💵Alder/Canada/38', lastSentAt: ago(1), messages: 6, chatters: ['Nikita'], inConversation: [] }],
          waiting: { total: 0, head: [] },
          promises: [],
          customs: [
            { fanRef: a1, conversationRef: a1, description: 'Видео 5 минут в красном белье, с его именем', state: 'paid', paidAt: null, createdAt: ago(52), code: 'K-11', stepLabel: 'У модели', stepAt: ago(46) },
            { fanRef: a2, conversationRef: a2, description: 'Кастом-видео в душе', state: 'ordered', paidAt: null, createdAt: ago(8), code: 'K-14', stepLabel: 'Записан', stepAt: ago(8) },
          ],
          serverNow: new Date().toISOString(),
        },
      });
    },
  },
);
