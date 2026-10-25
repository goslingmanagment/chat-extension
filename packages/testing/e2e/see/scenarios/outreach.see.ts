// «Рассылка» — its own window, one on both sites (2026-10-25): opened from Spenders with «Whale, Top и Prime»; «Кому»
// with its tiers and conditions; the common text; the media — ChatSpace's vault (a video behind $25 and its free
// preview), Fansly's bundles copied in posts; «Написать N версий» — each fan's own version, two at a time; the first
// fan's card with their conversation and their version where the next message would stand; «Отправить →» — the card
// goes on to the next version; a row's own «Отправить»; «Свернуть» into the chip; a version this window cannot send
// (the stand's open chat, its blocked fan) says why and offers «Открыть и вставить»; «Итог рассылки» with «Не ушло».

import { WORLD } from '../../../src/scenarios/hub';
import { fakeFansly } from '../../support/fansly-stand';
import { SEE_AI_TEXTS, scenario, type See } from '../kit';

const TEXT = 'ok this one is SPECIAL, first time with a DRAGON. 6 minutes, tell me when you get to the end';

/** Each fan's version, as the hub's Fix of the mass message would write it (the stand's hub writes no prose). */
const VERSIONS = [
  'had to show you this one first 🐉 first time with a dragon and it got SO intense 😳 6 minutes, it is right here with this message. tell me when you get to the end 😈',
  'sorry babe, I was filming 🙈 and honestly this is why. first time with a dragon, 6 minutes, you get it before anyone else. tell me when you finish 😈',
  'still missing you 🥺 so I made you something. first time with a dragon 🐉 6 minutes and it is all yours. tell me when you get to the end',
  'lol ok so I made something you will actually like 😏 dragon, 6 minutes, first time ever. all yours right here',
  'ok you were not up 😴 but you will want to be for this one. first time with a dragon 🐉 6 minutes, tell me when you get to the end 😈',
  'you always know what I am up to 😏 so here it is first: a dragon, 6 minutes, my first time. tell me what you think 🐉',
  'thinking of you since this morning ☀️ I made something new — first time with a dragon, 6 minutes. you are the first to see it 😈',
  'you asked for something different… well 🐉 first time with a dragon, 6 minutes, and it got intense. tell me when you are done 😳',
  'I saved this one for you 💛 first time with a dragon, 6 minutes. watch it to the end and tell me 😈',
];

const BUNDLES = ['700000000000000011', '700000000000000012'];

/** Key by key, as a person types (one action of many keys drops a letter pressed again while still down). */
async function typeIn(s: See, text: string): Promise<void> {
  for (const key of Array.from(text)) await s.browser.keys(key);
}

/** The pointer off our window before a picture: no tooltip of the last press stands in it. */
async function shot(s: See, name: string): Promise<void> {
  await s.browser.action('pointer').move({ x: 2, y: 2, origin: 'viewport' }).perform();
  await s.browser.pause(250);
  await s.shot(name);
}

scenario(
  'outreach',
  async (s) => {
    const fansly = s.site === 'fansly';
    await s.ready();
    if (fansly) {
      await fakeFansly().command({ op: 'bundles', ids: BUNDLES });
      await s.browser.execute((ids: string[]) => localStorage.setItem('media_service_copied_media', JSON.stringify({ copiedAccountMediaIds: ids, copiedAccountMediaBundleIds: [] })), BUNDLES);
      await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    } else await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', fansly ? 'Hub Whale' : 'Fan Birch', 20_000);
    await s.press(/^Рассылка/, 'modal', '.cg-sp__outreach');
    await s.see('modal', 'Предложение', 20_000);
    await s.browser.pause(400);
    await shot(s, 'outreach-start');

    // «Кому»: the tiers with their fans and the conditions over them.
    await s.press(/./, 'modal', '.cg-ow__komb');
    await s.see('modal', 'Условия');
    await shot(s, 'outreach-audience');
    await s.browser.keys('Escape');

    // The common text, then the media every fan's version takes.
    await s.press(/^/, 'modal', '.cg-ow__text');
    await typeIn(s, TEXT);
    if (fansly) {
      // The bundles copied in the posts are the offer's already: «Изменить» shows them.
      await s.press(/^Изменить/, 'modal', '.cg-ow__mchange');
      await s.see('modal', 'Бандл из поста', 20_000);
      await shot(s, 'outreach-media');
      await s.press(/^Готово/, 'modal', '.cg-ow__sheet .cg-ow__main');
    } else {
      await s.press(/Добавить медиа/, 'modal', '.cg-ow__addmedia');
      await s.see('modal', 'Stand set & one', 15_000);
      // «Платное»: the video behind the price; the price; «Превью»: a photo, free and first.
      await s.press(/^/, 'modal', '.cg-ow__sheet [data-cg-media="660000006"] .cg-pvm__pick');
      await s.press(/^/, 'modal', '.cg-ow__sheet .cg-pvm__price input');
      await typeIn(s, '25');
      await s.press(/Добавить/, 'modal', '.cg-ow__sheet [data-cg-slot="preview"] .cg-pvm__add');
      await s.press(/^/, 'modal', '.cg-ow__sheet [data-cg-media="660000001"] .cg-pvm__pick');
      await s.browser.pause(500);
      await shot(s, 'outreach-media');
      await s.press(/^Готово/, 'modal', '.cg-ow__sheet .cg-ow__main');
    }
    await s.browser.pause(300);
    await shot(s, 'outreach-offer');

    // One click: Fix writes each fan's version, two at a time; the first one written opens its card.
    await s.press(/^Написать/, 'modal', '.cg-ow__foot .cg-ow__main');
    await s.see('modal', 'Версия для', 60_000);
    await s.browser.waitUntil(async () => !(await s.has('modal', '.cg-ow__foot [data-cg-batch="running"]')) && (await s.text('modal', '.cg-ow__foot')).includes('Готово'), { timeout: 90_000, interval: 300, timeoutMsg: 'the versions were not written' });
    await s.browser.pause(400);
    await shot(s, 'outreach-review');

    // The card's «Отправить →»: one message to this fan; a second later the next version's card.
    await s.press(/^Отправить/, 'modal', '.cg-ow__csend');
    await s.see('modal', /Отправлено/, 30_000);
    await shot(s, 'outreach-sent');
    await s.browser.pause(1_400);
    // A row's own «Отправить»: the next fan, by one click in the list.
    if (await s.has('modal', '.cg-ow__rsend')) {
      await s.press(/^Отправить/, 'modal', '.cg-ow__rsend');
      await s.browser.pause(1_500);
    }
    await shot(s, 'outreach-sending');

    // «Свернуть»: the window folds into its chip; a click brings it back where it was.
    await s.press(/^Свернуть/, 'modal', '.cg-ow__min');
    await s.browser.pause(800);
    await shot(s, 'outreach-chip');
    await s.press(/Рассылка/, 'panel', '.cg-ow-chip');
    await s.see('modal', 'Версия для', 20_000);

    // Every version this window can send, one click each (half a second apart).
    for (let i = 0; i < 12; i += 1) {
      if (!(await s.has('modal', '.cg-ow__rsend'))) break;
      await s.press(/^Отправить/, 'modal', '.cg-ow__rsend');
      await s.browser.pause(1_300);
    }
    // A version held where this window cannot send it: why, and «Открыть и вставить» (never pressed here).
    if (await s.has('modal', '[data-cg-outreach-row="ready"] [data-cg-blocked]')) {
      await s.press(/./, 'modal', '[data-cg-outreach-row="ready"] [data-cg-blocked]');
      await s.see('modal', 'Отсюда не отправить', 20_000);
      await s.browser.pause(600);
      await shot(s, 'outreach-held');
    }
    // «Итог»: what went, what came of it, what did not go and why.
    await s.press(/^Итог/, 'modal', '.cg-ow__foot .cg-btn');
    await s.see('modal', 'Итог рассылки', 20_000);
    await s.browser.pause(500);
    await shot(s, 'outreach-summary');
    if (fansly) {
      const sends = (await fakeFansly().journal()).entries.filter((entry) => entry.route === 'message.send');
      console.log('see: message.send', JSON.stringify(sends.map((entry) => entry.detail)));
    }
  },
  {
    sites: ['chatspace', 'fansly'],
    previewSend: true,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'improve-draft:outreach': VERSIONS.join(' [FAN] ') } } });
      if (site !== 'fansly') return;
      const { a, b } = WORLD.fansly.chats;
      await hub.command({
        op: 'spenderFans',
        fans: [
          { fanRef: a.fan, displayName: 'Hub Whale', lifetimeUsd: 1200, windowUsd: 300 },
          { fanRef: b.fan, displayName: 'Hub Birch', lifetimeUsd: 650, windowUsd: 40, awaiting: true, fanWroteAgoSec: 7_200 },
        ],
      });
      await hub.command({ op: 'config', patch: { spendersTotal: 2 } });
    },
  },
);
