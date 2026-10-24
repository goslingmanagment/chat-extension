// «Очередь» of the fan panel (Chat Memory week 3) on sample data: «Ждут» with the team's aliases and «в разговоре» (a
// row opens its chat, the panel stays), «Вернуть» with reasons and the owner's approaches (one pick: the fan leaves, «Подход выбран»), «Передача» with who
// wrote, who waits and the promises. ChatSpace by default; `--site fansly` — «Ждут» of the Fansly page, a row opening
// the other chat of the stand.

import { WORLD } from '../../../src/scenarios/hub';
import { STAND_IDS } from '../../support/stand';
import { STAND_PAGE, scenario } from '../kit';

const ago = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const { a1, a2, a3, a4, a5, a6 } = STAND_IDS.fans;
const waits = (fanRef: string, alias: string | null, username: string, mills: number, minutes: number) => ({
  fanRef,
  conversationRef: fanRef,
  alias,
  username,
  displayName: null,
  lifetimeGrossMills: mills,
  lastFanMessageAt: ago(minutes),
  lastModelMessageAt: null,
  unreadCount: 1,
  readState: 'unread',
});
const lost = (fanRef: string, alias: string | null, username: string, mills: number, reason: string, reasonAt: string) => ({ fanRef, conversationRef: fanRef, username, displayName: null, alias, lifetimeGrossMills: mills, reason, reasonAt });

scenario(
  'queue',
  async (s) => {
    await s.ready();
    if (s.site === 'fansly') await s.browser.execute(() => (document.activeElement as HTMLElement | null)?.blur());
    else await s.leaveField();
    await s.keys(']');
    await s.see('panel', 'Очередь');
    await s.press(/^Очередь/, 'panel');
    if (s.site === 'fansly') {
      await s.see('panel', 'Ждут ответа: 2', 30_000);
      await s.shot('queue-fansly');
      await s.press(/Bryce/, 'panel', '.cg-q__open');
      await s.see('panel', '@fansly_b', 20_000);
      await s.shot('queue-fansly-opened');
      return;
    }
    await s.see('panel', 'в разговоре: Nikita', 30_000);
    await s.shot('queue-waiting');
    // A row opens the fan's chat; the panel stays on «Очередь».
    await s.press(/Brook/, 'panel', '.cg-q__open');
    await s.see('panel', 'Fan Birch', 20_000);
    await s.see('panel', 'Ждут ответа: 4');
    await s.shot('queue-opened');
    await s.press(/^Вернуть/, 'panel');
    await s.see('panel', 'подписка кончается через 2 дн', 20_000);
    await s.shot('queue-winback');
    await s.press(/^Скучала/, 'panel');
    await s.see('panel', 'Подход выбран', 20_000);
    await s.shot('queue-picked');
    await s.press(/^Передача/, 'panel');
    await s.see('panel', 'Обещания', 20_000);
    await s.shot('queue-handoff');
  },
  {
    sites: ['chatspace', 'fansly'],
    viewport: { width: 1440, height: 1100 },
    before: async ({ hub, site }) => {
      if (site === 'fansly') {
        const { a, b } = WORLD.fansly.chats;
        const row = (chat: { readonly fan: string; readonly group: string }, alias: string, username: string, mills: number, minutes: number) => ({ ...waits(chat.fan, alias, username, mills, minutes), conversationRef: chat.group });
        await hub.command({ op: 'queue', pageLabel: WORLD.pages.fansly.pageLabel, waiting: [row(a, '💵Ash/Ohio', 'fansly_a', 520_000, 33), row(b, '💵Bryce/Utah/29', 'fansly_b', 96_000, 9)] });
        return;
      }
      await hub.command({
        op: 'queue',
        pageLabel: STAND_PAGE,
        waiting: [
          waits(a2, '💵Brook/Texas/41', 'stand_fan_1_2', 864_000, 47),
          waits(a3, null, 'stand_fan_1_3', 212_000, 26),
          waits(a4, '❌ПОКА НЕТ ДЕНЕГ❌ ray', 'stand_fan_1_4', 0, 12),
          waits(a5, null, 'stand_fan_1_5', 0, 3),
        ],
        winBack: {
          pageLabel: STAND_PAGE,
          approaches: [
            { id: 1, label: 'Скучала' },
            { id: 2, label: 'Новое видео' },
            { id: 3, label: 'Спросить про день' },
          ],
          items: [
            lost(a6, '💵Cole/Ohio', 'stand_fan_1_6', 1_480_000, 'expiring', new Date(Date.now() + 30 * 3_600_000).toISOString()),
            lost(a3, null, 'stand_fan_1_3', 212_000, 'silent', ago(16.5 * 24 * 60)),
            lost(a5, null, 'stand_fan_1_5', 0, 'new_unattended', ago(26 * 60)),
          ],
          serverNow: new Date().toISOString(),
        },
        handoff: {
          pageLabel: STAND_PAGE,
          recent: [
            { fanRef: a2, conversationRef: a2, username: 'stand_fan_1_2', alias: '💵Brook/Texas/41', lastSentAt: ago(4), messages: 9, chatters: ['Nikita'], inConversation: ['Nikita'] },
            { fanRef: a1, conversationRef: a1, username: 'stand_fan_1_1', alias: '💵Alder/Canada/38', lastSentAt: ago(140), messages: 14, chatters: ['Vanya', 'Nikita'], inConversation: [] },
          ],
          waiting: { total: 4, head: [{ fanRef: a3, conversationRef: a3, username: 'stand_fan_1_3', alias: null, lifetimeGrossMills: 212_000, lastFanMessageAt: ago(26) }] },
          promises: [{ fanRef: a1, conversationRef: a1, text: 'Видео в красном белье к пятнице', messageRef: '9003', messageAt: ago(300) }],
          serverNow: new Date().toISOString(),
        },
      });
      // Another chatter wrote to Brook four minutes ago: «в разговоре: Nikita» on his row of «Ждут».
      await hub.command({ op: 'talking', pageLabel: STAND_PAGE, fanRef: a2, name: 'Nikita', agoMs: 4 * 60_000 });
    },
  },
);
