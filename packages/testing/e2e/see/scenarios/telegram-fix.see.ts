// Telegram: Fix of a draft with a wallet in it writes its text into the field by itself; a Fix that changes the wallet
// does not: the dock warns «Реквизиты изменились, сверьте» and the text goes in only by «Заменить мой черновик».

import { callTelegram } from '../../support/telegram-stand';
import { lap, scenario, TELEGRAM_AI_TEXTS } from '../kit';
import { composerShot, facts, pressIfShown, shown, waitField } from '../telegram';

const WALLET = 'TQ7xR3d9Wk2eYvN8mLp4sHc6JfB1aZuGtV';
const DRAFT = `ok so how about this weekend? 😘 my wallet ${WALLET} for the custom`;
/** The same Fix with one character of the wallet changed (the model «fixed» it). */
const CHANGED = (TELEGRAM_AI_TEXTS['improve-draft'] ?? '').replace(WALLET, `${WALLET.slice(0, -1)}W`);

scenario(
  'telegram-fix',
  async (s) => {
    await s.ready();
    await s.type(DRAFT);
    await s.h.dockIs((d) => d.actions['fix'] === true, 'Fix is on');
    await composerShot(s, 'draft');
    await s.press(/^Fix/);
    // Fix writes its text in place of the draft by itself (decision X68) when the wallet is kept.
    await waitField((text) => text !== DRAFT && text.includes(WALLET), 'the fixed text with the same wallet reaches the field', 15_000);
    await s.shot('fix');
    await composerShot(s, 'fixed');
    await facts('after Fix');

    // The model changes the wallet: the chatter is warned before the insert.
    await s.hub.command({ op: 'config', patch: { aiTexts: { ...TELEGRAM_AI_TEXTS, 'improve-draft': CHANGED } } });
    await callTelegram('clearField');
    await s.type(DRAFT);
    await s.h.dockIs((d) => d.actions['fix'] === true, 'Fix is on');
    await s.press(/^Fix/);
    await s.done();
    await shown(s, 'dock', 'Реквизиты изменились, сверьте');
    await s.shot('wallet-changed-warning');
    await composerShot(s, 'wallet-changed-field');
    lap(`the field before passing the warning: ${JSON.stringify(await callTelegram('fieldText'))}`);
    if (await pressIfShown(s, /^Заменить мой черновик/)) await composerShot(s, 'wallet-changed-replaced');
    await facts('after the changed Fix');
  },
  { sites: ['telegram'] },
);
