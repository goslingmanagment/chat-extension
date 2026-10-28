// Telegram: Reply started in Jamie's chat, the chat switched to Саша's while it is written: nothing of it lands in
// Саша's field (pictures of both chats' fields).

import { callTelegram } from '../../support/telegram-stand';
import { lap, scenario } from '../kit';
import { composerShot, facts, pressIfShown } from '../telegram';

scenario(
  'telegram-switch',
  async (s) => {
    await s.ready();
    await s.press(/^Reply/);
    await s.wait(400);
    await callTelegram('openChat', s.tg.chats.sasha);
    await s.wait(4500);
    await s.shot('sasha-while-reply');
    // Whatever the dock offers now, «Вставить» included, must not write Jamie's reply into Саша's field.
    await pressIfShown(s, /^Вставить/, 'dock', '[data-cg-part="0"] button', 2000);
    await s.wait(800);
    await composerShot(s, 'sasha-field');
    await facts('Саша');
    await callTelegram('openChat', s.tg.chats.jamie);
    await s.wait(1200);
    await s.shot('back-in-jamie');
    await composerShot(s, 'jamie-field');
    await facts('Jamie');
    lap(`the dock: ${JSON.stringify((await s.dock())?.result ?? null)}`);
  },
  {
    sites: ['telegram'],
    // The model thinks a while: the switch comes during the generation.
    before: async (s) => {
      await s.hub.command({ op: 'config', patch: { aiThinkMs: 3000 } });
    },
  },
);
