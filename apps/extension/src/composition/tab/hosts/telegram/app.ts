// The application's half of the Telegram adapter (docs/specs/2026-10-27-telegram-site.md §6.4–§6.6; tab/adapter.ts):
// what only Telegram's application does with Telegram's host port. It comes in Telegram's `tab-app` chunk
// (lazy/telegram/tab-app.ts) with the first surface of ours on a Telegram page, never in the early bundle.
//
// - No live configuration: nothing of Telegram's port is switched by the bootstrap.
// - Telegram's slice of the feature manifest (Reply and Fix) and what its contract report must name.
// - Its profile for our interface: the page's accent, live with its theme (host-telegram palette.ts), the dock's variant
//   `telegram` with its sheet, the phrases that name the site — «в Telegram».
// - Its AI policy (core application/hosts/telegram/ai.ts): every start carries the open chat as the page rendered it
//   (`clientContext`); the verdict warns of a window without the newest messages and of changed payment details.
// - Its tones: casual, flirty, spicy — no selling tone on Telegram (the hub refuses `upsell` there).
// - The dock only on an account bound to a page granted to the person: nothing of ours on any other account.

import type { Tone } from '@cg/contracts/features';
import { TELEGRAM_CONTRACT } from '@cg/contracts/telegram-host';
import type { HostUiProfile } from '@cg/contracts/vm';
import { createTelegramAi } from '@cg/core/application/hosts/telegram/ai';
import { TELEGRAM_PHRASES } from '@cg/core/domain/hosts/telegram/i18n';
import type { TelegramPort } from '@cg/host-telegram/isolated';
import { telegramPaletteSignal } from '@cg/host-telegram/isolated/palette';
import { TELEGRAM_DOCK_SHEET } from '@cg/ui/hosts/telegram';

import { TELEGRAM_FEATURE_SLICE } from '../../../features/telegram';
import type { HostAppAdapter, HostThemeSource } from '../../adapter';

/** The page our content script runs in: read only when a surface mounts or the page's theme switches. */
const page = (): Document => document;

/** Telegram's tones in the menu's order (spec §1, §6.6). */
export const TELEGRAM_TONES: readonly Tone[] = ['casual', 'flirty', 'spicy'];

export function telegramUi(theme: HostThemeSource, doc: () => Document = page): HostUiProfile {
  return {
    palette: telegramPaletteSignal(theme, doc),
    dock: { variant: 'telegram' },
    sheet: TELEGRAM_DOCK_SHEET,
    phrases: TELEGRAM_PHRASES,
  };
}

export function telegramApp(): HostAppAdapter<TelegramPort, null> {
  return {
    liveConfigOf: () => null,
    configure: () => Promise.resolve(),
    features: TELEGRAM_FEATURE_SLICE,
    contract: TELEGRAM_CONTRACT,
    ui: (theme) => telegramUi(theme),
    ai: () => createTelegramAi(),
    tones: TELEGRAM_TONES,
    dockOnlyWhenBound: true,
    // The dock's visibility goes back to the port: on an account it does not show on, our keys stay Telegram's.
    start: (env) => {
      const follow = (): void => env.host.setDockShown(env.deps.client.getSnapshot({ of: 'dock' }).visible);
      follow();
      return env.deps.client.subscribe({ of: 'dock' }, follow);
    },
  };
}

export const TELEGRAM_APP: HostAppAdapter<TelegramPort, null> = telegramApp();
