// The words of the window check's marks (R20 P8b2; docs/project-unite/spec.md §3.5, FS-TAIL-8; ui-design §4.7): what
// the shared result writes over a Fansly generation whose verdict is not fresh — a title (bold) and its continuation,
// as «**Фан написал новое** после генерации. Ответ его не учитывает.» is written. Only Fansly's verdict gives these
// reasons, so only its tab's catalog carries them (apps/extension/lazy/fansly/i18n-*.ts): the keys are the contract's
// (`ResultMarkKey`), never the shared catalog's, and no ChatSpace bundle carries the words. Each says what the chatter
// can do about it: the mark has «Ещё раз» beside it; inserting stays allowed.

import type { Locale } from '@cg/contracts/i18n/keys';
import type { ResultMarkKey } from '@cg/contracts/vm';

export const FANSLY_MARK_TEXTS: { readonly [L in Locale]: Readonly<Record<ResultMarkKey, string>> } = {
  ru: {
    'result.stale.unverified.title': 'Свежесть не проверена:',
    'result.stale.unverified.body': 'неизвестно, учёл ли ответ последние сообщения чата.',
    'result.stale.windowMiss.title': 'Ответ мог не учесть',
    'result.stale.windowMiss.body': 'последние сообщения чата.',
    'result.stale.deletedServed.title': 'Контекст устарел:',
    'result.stale.deletedServed.body': 'ответ учитывает сообщение, удалённое из чата.',
  },
  en: {
    'result.stale.unverified.title': 'Freshness not verified:',
    'result.stale.unverified.body': 'it is unknown whether the answer saw the latest messages of the chat.',
    'result.stale.windowMiss.title': 'The answer may have missed',
    'result.stale.windowMiss.body': 'the latest messages of the chat.',
    'result.stale.deletedServed.title': 'Outdated context:',
    'result.stale.deletedServed.body': 'the answer reflects a message deleted from the chat.',
  },
};
