// Telegram: the list scrolled away from the newest messages: the dock says «Прокрутите к последним сообщениям»;
// Reply still works on what is rendered.

import { callTelegram } from '../../support/telegram-stand';
import { scenario } from '../kit';
import { facts, shown } from '../telegram';

scenario(
  'telegram-scrolled',
  async (s) => {
    await s.ready();
    await callTelegram('scrollUp');
    await shown(s, 'dock', 'Прокрутите к последним сообщениям');
    await s.shot('scrolled-up');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('reply-scrolled-up');
    await callTelegram('scrollDown');
    await s.wait(800);
    await s.shot('back-at-newest');
    await facts('scrolled');
  },
  { sites: ['telegram'] },
);
