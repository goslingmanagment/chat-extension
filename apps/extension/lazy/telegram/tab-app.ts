// The tab's application on a Telegram page (docs/specs/2026-10-27-telegram-site.md §6.4): the shared application with
// the application's half of the Telegram adapter, in Telegram's own lazy build. Loaded with the first place of the
// dock (a person's chat open) or the first key of ours, never before; no other site's page loads it.

import type { TelegramPort } from '@cg/host-telegram/isolated';

import { startTabApp as startApp, type TabApp, type TabAppEnv } from '../../src/composition/tab/app';
import { TELEGRAM_APP } from '../../src/composition/tab/hosts/telegram/app';

export type { TabApp, TabAppEnv };

/** The Telegram early bundle's runtime calls it with Telegram's own host port. */
export const startTabApp = (env: TabAppEnv<TelegramPort>): Promise<TabApp> => startApp(env, TELEGRAM_APP);
