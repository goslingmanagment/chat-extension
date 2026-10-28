// Telegram: Fix writes its text in place of the draft by itself, exactly as on Fansly (decision X68); the wallet in the
// draft comes back character for character (the hub's Telegram Fix rule).

import { scenario } from '../kit';
import { composerShot, facts, waitField } from '../telegram';

const WALLET = 'TQ7xR3d9Wk2eYvN8mLp4sHc6JfB1aZuGtV';
const DRAFT = `ok so how about this weekend? 😘 my wallet ${WALLET} for the custom`;

scenario(
  'telegram-fix',
  async (s) => {
    await s.ready();
    await s.type(DRAFT);
    await s.h.dockIs((d) => d.actions['fix'] === true, 'Fix is on');
    await composerShot(s, 'draft');
    await s.press(/^Fix/);
    await waitField((text) => text !== DRAFT && text.includes(WALLET), 'the fixed text with the same wallet reaches the field', 15_000);
    await s.shot('fix');
    await composerShot(s, 'fixed');
    await facts('after Fix');
  },
  { sites: ['telegram'] },
);
