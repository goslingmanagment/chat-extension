// Telegram's text pack (docs/specs/2026-10-27-telegram-site.md §6.6): the phrases the shared texts take on Telegram
// («в Telegram»), and the words of the marks only Telegram's verdict gives over a result — the newest messages were
// not rendered, the draft's payment details changed. Telegram's tab catalogs (apps/extension/lazy/telegram/i18n-*.ts)
// and the extension pages read it; no other site's bundle carries it.

import type { Locale } from '@cg/contracts/i18n/keys';
import type { HostPhrases, ResultMarkKey } from '@cg/contracts/vm';

export const TELEGRAM_PHRASES: { readonly [L in Locale]: HostPhrases } = {
  ru: { site: 'Telegram', onSite: 'в Telegram', siteAccount: 'Telegram', sitePlatform: 'Telegram' },
  en: { site: 'Telegram', onSite: 'in Telegram', siteAccount: 'Telegram', sitePlatform: 'Telegram' },
};

/** The marks of Telegram's verdict (a title, then its continuation); inserting stays allowed. */
export const TELEGRAM_MARK_TEXTS: { readonly [L in Locale]: Readonly<Partial<Record<ResultMarkKey, string>>> } = {
  ru: {
    'result.stale.historyPartial.title': 'Прокрутите к последним сообщениям:',
    'result.stale.historyPartial.body': 'ответ видел не самые новые сообщения чата.',
    'result.stale.detailsChanged.title': 'Реквизиты изменились, сверьте:',
    'result.stale.detailsChanged.body': 'кошелёк, карта, ссылка или сумма в ответе не такие, как в черновике.',
  },
  en: {
    'result.stale.historyPartial.title': 'Scroll to the latest messages:',
    'result.stale.historyPartial.body': 'the answer did not see the newest messages of the chat.',
    'result.stale.detailsChanged.title': 'Payment details changed, check them:',
    'result.stale.detailsChanged.body': 'a wallet, card, link or amount in the answer differs from the draft.',
  },
};
