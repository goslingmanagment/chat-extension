// «Память» of the fan panel (Chat Memory week 2) on sample data: the fan's pages with the team's aliases and money,
// a «тот же человек» suggestion, facts by kind (an empty kind says «не знаю»).

import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario } from '../kit';

const at = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const page = (pageLabel: string, granted: boolean, alias: string, spentMills: number, last30: number, fanRef: string = STAND_IDS.fans.a1) => ({
  pageLabel,
  platform: 'onlyfans',
  modelName: 'Model One',
  fanRef,
  granted,
  alias,
  subscribed: granted,
  subscribedSince: null,
  subscriptionEndsAt: null,
  spentMills,
  last30Mills: { tip: last30 },
  lastPurchaseAt: null,
});

scenario(
  'memory',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(']');
    await s.see('panel', 'Fan Alder');
    await s.press(/^Память/, 'panel');
    await s.see('panel', 'Похоже, это тот же человек', 20_000);
    // A fact's own message, folded under it: «из чата» opens it.
    await s.press(/^из чата/, 'panel', '.cg-mem__quote summary');
    await s.see('panel', 'work nights at the hospital');
    await s.shot('memory');
  },
  {
    sites: ['chatspace'],
    // Tall enough for the facts under the pages and the suggestion.
    viewport: { width: 1440, height: 1300 },
    before: async ({ hub }) => {
      await hub.command({
        op: 'fanCard',
        pageLabel: STAND_PAGE,
        fanRef: STAND_IDS.fans.a1,
        card: {
          pageLabel: STAND_PAGE,
          fanRef: STAND_IDS.fans.a1,
          known: true,
          accounts: [{ platform: 'onlyfans', fanRef: STAND_IDS.fans.a1, username: 'stand_fan_1_1', displayName: 'Fan Alder', gone: false, linkedBy: null }],
          pages: [page('lora-1', false, '❌ПОКА НЕТ ДЕНЕГ❌ alder/canada', 384_000, 0), page(STAND_PAGE, true, '💵Alder/Canada/38', 1_248_000, 32_000)],
          suggestions: [
            {
              platform: 'onlyfans',
              fanRef: STAND_IDS.fans.a2,
              username: 'alder_new',
              displayName: 'Alder',
              gone: false,
              reason: 'same_alias',
              shared: 'Alder/Canada/38',
              sharedOn: 'lora-2',
              pages: [page('lora-2', false, '💵Alder/Canada/38', 96_000, 12_000, STAND_IDS.fans.a2)],
            },
          ],
          facts: [
            { id: 1, kind: 'about', text: 'Живёт в Торонто, работает по ночам', pageLabel: STAND_PAGE, granted: true, conversationRef: STAND_IDS.fans.a1, messageRef: '9001', messageAt: at(30), source: 'ai', author: null, createdAt: at(29), quote: { text: 'toronto 🇨🇦 i work nights at the hospital so i text late lol', from: 'fan', at: at(30), media: false } },
            { id: 2, kind: 'about', text: 'Любит кошек, у него рыжий кот', pageLabel: 'lora-1', granted: false, conversationRef: STAND_IDS.fans.a1, messageRef: '9002', messageAt: at(200), source: 'ai', author: null, createdAt: at(199) },
            { id: 3, kind: 'promise', text: 'Видео в красном белье к пятнице', pageLabel: STAND_PAGE, granted: true, conversationRef: STAND_IDS.fans.a1, messageRef: '9003', messageAt: at(5), source: 'chatter', author: 'Nikita', createdAt: at(4), quote: { text: 'the red set is for you, i will send it on friday 😘', from: 'model', at: at(5), media: false } },
          ],
          customs: [],
          customPayments: [],
          serverNow: new Date().toISOString(),
        },
      });
    },
  },
);
