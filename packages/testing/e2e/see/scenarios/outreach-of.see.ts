// ChatSpace (OnlyFans): «Рассылка» of Spenders — the outreach text, «Подстроить под каждого» for two fans, then in the
// first fan's preview the vault media (a video and its free preview at $25) taken «Для всей рассылки», and the second
// fan's row «Отправить всё равно» (made with the chat closed): the card's own send (X8) of that fan's version with the
// outreach's media (X53).

import { SEE_AI_TEXTS, scenario } from '../kit';

/** What the hub's Fix of the mass message reads like for one fan (the mockup's: the stand's hub writes no prose). */
const ADAPTED = 'okay you get this one before anyone else 🐉 first time with a dragon and it got SO intense 😳 6 minutes, all yours right here. tell me when you get to the end 😈';

scenario(
  'outreach-of',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(...s.PANEL, 'm');
    await s.see('modal', 'Fan Birch', 20_000);
    await s.press(/^Рассылка/, 'modal', '.cg-or__toggle');
    await s.press(/^/, 'modal', '.cg-or textarea');
    // Key by key, as a person types (one action of many keys drops a letter pressed again while still down).
    for (const key of Array.from('ok this one is SPECIAL, first time with a DRAGON. 6 minutes, tell me when you get to the end')) await s.browser.keys(key);
    await s.press(/^/, 'modal', '.cg-sp__search input');
    for (const key of Array.from('Fan B')) await s.browser.keys(key);
    await s.browser.pause(400);
    await s.press(/^/, 'modal', '.cg-bd__head .cg-bt__check');
    await s.press(/^Подстроить под каждого/, 'modal');
    await s.see('modal', /Отправить/, 60_000);
    // The vault media in the first fan's card, taken for the whole outreach.
    await s.press(/^Fan B/, 'modal', '[data-cg-key^="fan:"]');
    await s.press(/Медиа/, 'modal', '.cg-pv [data-cg-strip="media"] button');
    await s.see('modal', 'Stand set & one', 15_000);
    await s.press(/^/, 'modal', '[data-cg-media="660000004"] .cg-pvm__pick');
    await s.press(/^/, 'modal', '[data-cg-media="660000001"] .cg-pvm__pick');
    await s.press(/^/, 'modal', '.cg-pvm__price input');
    for (const key of Array.from('25')) await s.browser.keys(key);
    await s.press(/^/, 'modal', '[data-cg-media="660000001"] .cg-pvm__free');
    await s.press(/^Для всей рассылки/, 'modal', '.cg-pvm__or');
    await s.see('modal', 'Медиа рассылки', 10_000);
    await s.shot('outreach-of-media');
    // The version was made with the chat closed: the first click finds the fan's newest messages cannot be checked, and the
    // row says so; its next click passes that, as the card's «Отправить всё равно».
    await s.press(/^Отправить$/, 'modal', '.cg-or__send');
    await s.browser.pause(1500);
    await s.shot('outreach-of-anyway');
    await s.press(/^Отправить всё равно/, 'modal', '.cg-or__send');
    await s.see('modal', 'Отправлено', 30_000);
    await s.shot('outreach-of-sent');
  },
  {
    sites: ['chatspace'],
    previewSend: true,
    before: async ({ hub }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...SEE_AI_TEXTS, 'improve-draft': ADAPTED } } });
    },
  },
);
