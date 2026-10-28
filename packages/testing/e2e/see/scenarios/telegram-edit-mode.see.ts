// Telegram: the edit mode of a sent message (`.ComposerEmbeddedMessage` with the edit icon): the dock warns «Вы
// редактируете отправленное сообщение»; Reply still works.

import { callTelegram } from '../../support/telegram-stand';
import { scenario } from '../kit';
import { composerShot, facts, shown } from '../telegram';

scenario(
  'telegram-edit-mode',
  async (s) => {
    await s.ready();
    await callTelegram('editLast');
    await shown(s, 'dock', 'Вы редактируете отправленное сообщение');
    await s.shot('edit-mode');
    await composerShot(s, 'edit-mode-composer');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('reply-in-edit-mode');
    await facts('edit mode');
    await callTelegram('cancelEdit');
    await s.wait(500);
    await s.shot('edit-cancelled');
  },
  { sites: ['telegram'] },
);
