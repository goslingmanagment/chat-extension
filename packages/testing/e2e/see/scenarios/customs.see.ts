// «Кастомы» (Chat Memory week 4) on sample data: in «Память» the open customs first — paid two days ago with «Отдали —
// это он?», ordered with «Это оплата?» — then a delivered one; «Записать кастом» with a suggested tip; and the page's
// open customs in «Передача» of «Очередь».

import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario } from '../kit';

const ago = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const { a1, a2 } = STAND_IDS.fans;
const custom = (id: number, description: string, state: string, priceMills: number, paidHours: number | null, candidates: readonly { readonly ref: string; readonly hours: number; readonly media: number }[], extra: Record<string, unknown> = {}) => ({
  id,
  pageLabel: STAND_PAGE,
  granted: true,
  description,
  priceMills,
  state,
  paymentMills: paidHours === null ? null : priceMills,
  paidAt: paidHours === null ? null : ago(paidHours),
  deliveredMessageRef: null,
  deliveredAt: null,
  createdBy: 'Nikita',
  createdAt: ago((paidHours ?? 20) + 2),
  deliveryCandidates: candidates.map((candidate) => ({ messageRef: candidate.ref, at: ago(candidate.hours), mediaCount: candidate.media, priceMills: null })),
  ...extra,
});

scenario(
  'customs',
  async (s) => {
    await s.ready();
    await s.leaveField();
    await s.keys(']');
    await s.see('panel', 'Fan Alder');
    await s.press(/^Память/, 'panel');
    await s.see('panel', 'Отдали — это он?', 20_000);
    await s.shot('customs');
    await s.press(/^Записать кастом/, 'panel');
    await s.see('panel', 'Это оплата кастома?');
    await s.shot('customs-record');
    await s.press(/^Отмена|^Cancel/, 'panel');
    await s.press(/^Очередь/, 'panel');
    await s.press(/^Передача/, 'panel');
    await s.see('panel', 'Открытые кастомы', 20_000);
    await s.shot('customs-handoff');
  },
  {
    sites: ['chatspace'],
    viewport: { width: 1440, height: 1200 },
    before: async ({ hub }) => {
      await hub.command({
        op: 'fanCard',
        pageLabel: STAND_PAGE,
        fanRef: a1,
        card: {
          pageLabel: STAND_PAGE,
          fanRef: a1,
          known: true,
          accounts: [{ platform: 'onlyfans', fanRef: a1, username: 'stand_fan_1_1', displayName: 'Fan Alder', gone: false, linkedBy: null }],
          pages: [{ pageLabel: STAND_PAGE, platform: 'onlyfans', modelName: 'Model One', fanRef: a1, granted: true, alias: '💵Alder/Canada/38', subscribed: true, subscribedSince: null, subscriptionEndsAt: null, spentMills: 1_248_000, last30Mills: { tip: 320_000 }, lastPurchaseAt: null }],
          suggestions: [],
          facts: [],
          customs: [
            custom(11, 'Видео 5 минут в красном белье, с его именем', 'paid', 120_000, 50, [{ ref: '9301', hours: 20, media: 1 }]),
            custom(12, 'Фотосет в очках, 10 фото', 'ordered', 60_000, null, []),
            custom(10, 'Голосовое с днём рождения', 'delivered', 30_000, 400, [], { deliveredMessageRef: '9201', deliveredAt: ago(380) }),
          ],
          customPayments: [
            { paymentRef: '8101', amountMills: 60_000, at: ago(5), note: 'for the glasses set' },
            { paymentRef: '8102', amountMills: 15_000, at: ago(30), note: null },
          ],
          serverNow: new Date().toISOString(),
        },
      });
      await hub.command({
        op: 'queue',
        pageLabel: STAND_PAGE,
        handoff: {
          pageLabel: STAND_PAGE,
          recent: [{ fanRef: a1, conversationRef: a1, username: 'stand_fan_1_1', alias: '💵Alder/Canada/38', lastSentAt: ago(1), messages: 6, chatters: ['Nikita'], inConversation: [] }],
          waiting: { total: 0, head: [] },
          promises: [],
          customs: [
            { fanRef: a1, conversationRef: a1, description: 'Видео 5 минут в красном белье, с его именем', state: 'paid', paidAt: ago(50), createdAt: ago(52) },
            { fanRef: a2, conversationRef: a2, description: 'Кастом-видео в душе', state: 'ordered', paidAt: null, createdAt: ago(8) },
          ],
          serverNow: new Date().toISOString(),
        },
      });
    },
  },
);
