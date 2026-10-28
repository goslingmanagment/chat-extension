// Telegram: the dock in Jamie's chat, Reply and its result, «Вставить»: the reply stands in Telegram's own field.

import { scenario } from '../kit';
import { composerShot, facts, waitField } from '../telegram';

scenario(
  'telegram-reply',
  async (s) => {
    await s.ready();
    await s.shot('dock');
    await s.press(/^Reply/);
    await s.done();
    await s.shot('reply');
    await s.press(/^Вставить/, 'dock', '[data-cg-part="0"] button');
    await waitField((text) => text.trim() !== '', 'the inserted part reaches the field');
    await s.shot('inserted');
    await composerShot(s, 'field');
    await facts('after the insert (nothing sent)');
  },
  { sites: ['telegram'] },
);
