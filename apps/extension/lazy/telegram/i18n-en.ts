// The en texts of a Telegram tab: the shared catalog with the words of the marks only Telegram's verdict gives.

import { EN } from '@cg/core/domain/i18n/en';
import { TELEGRAM_MARK_TEXTS } from '@cg/core/domain/hosts/telegram/i18n';

export const CATALOG: Readonly<Record<string, unknown>> = { ...EN, ...TELEGRAM_MARK_TEXTS.en };
