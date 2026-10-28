// The ru texts of a Telegram tab: the shared catalog with the words of the marks only Telegram's verdict gives (the
// newest messages not rendered, the draft's payment details changed). One chunk of Telegram's build.

import { RU } from '@cg/core/domain/i18n/ru';
import { TELEGRAM_MARK_TEXTS } from '@cg/core/domain/hosts/telegram/i18n';

export const CATALOG: Readonly<Record<string, unknown>> = { ...RU, ...TELEGRAM_MARK_TEXTS.ru };
