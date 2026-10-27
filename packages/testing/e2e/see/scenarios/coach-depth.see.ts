// Coach's depth (2026-10-27, the owner: «по дефолту хотя бы 300», «оптимально догрузите ещё 300, в идеале все»): the
// chip by «Спросить» — how much of the chat the next question reads, how far back that reaches — and its menu; an
// answer whose ```more note says older messages would change it, with «Coach хочет дочитать» under it; «Ещё 300»
// asks the same question again, deeper, and the chip keeps the new depth for the chat. The fake hub's `coachDepth`
// knob stands for a long conversation (2431 messages since March) and for Coach's note while it read fewer than 600.

import { showcaseAiTexts, scenario } from '../kit';

const FIELD = '.cg-co__ask textarea, .cg-co__ask input';
const NOTE = 'Его покупки и реакции на цены были раньше: в последних 300 сообщениях нет ни одной покупки, а по ним лучше всего видно, что ему заходит.';
const FIRST =
  'По последним двум неделям: ему заходит, когда помнят детали его жизни (поездка, работа), и лёгкий флирт без давления. На прямые предложения отвечает медленнее, чем на вопросы о нём самом.';
const DEEPER =
  'Теперь видна история покупок. За полгода он взял четыре сета, все от $20 до $25, и ни разу не купил дороже $30: на $45 в августе промолчал два дня. Лучше всего заходят сеты «после поездки» и личные мелочи о вас. Предлагайте до $25 и после пары сообщений о нём.\n\n```draft\nwelcome back, traveler ☀️ I saved something for your first evening home… want a peek?\n```';

scenario(
  'coach-depth',
  async (s) => {
    await s.ready();
    await s.press(/^Coach/);
    await s.browser.waitUntil(() => s.has('panel', FIELD), { timeout: 10_000, timeoutMsg: 'the Coach window did not open' });
    // The span comes with the archive's depth, read when the window opens.
    await s.see('panel', 'недел', 15_000);
    await s.shot('depth-chip');
    await s.press(/^300 сообщений/, 'panel', '.cg-co__depth');
    await s.see('panel', 'Вся переписка');
    await s.shot('depth-menu');
    await s.keys(s.Key.Escape);

    await s.h.ours('panel', FIELD).click();
    await s.keys('Что этому фану реально заходит?');
    await s.keys(s.Key.Enter);
    await s.see('panel', 'Coach хочет дочитать', 30_000);
    // The card rises in, a ring goes out once and the lens reaches up: the picture waits for it to settle.
    await s.wait(2600);
    await s.shot('more');
    // Under the pointer a depth shows on the lens: the whole chat lit, its count under it.
    await (await s.h.ours('panel', '.cg-co__more-opt.is-ideal')).moveTo();
    await s.wait(600);
    await s.shot('more-hover');

    await s.press(/^Ещё 300/, 'panel', '.cg-co__more-opt');
    await s.see('panel', 'по 600 сообщениям', 30_000);
    await s.shot('deeper');
  },
  {
    sites: ['chatspace', 'fansly'],
    showcase: true,
    before: async ({ hub, site }) => {
      await hub.command({ op: 'config', patch: { aiTexts: { ...showcaseAiTexts(site), 'coach-chat': FIRST }, coachDepth: { stored: 2431, oldestDays: 227, moreBelow: 600, note: NOTE, deepText: DEEPER } } });
    },
  },
);
