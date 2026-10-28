// Helpers for the Telegram Web A-like stand in e2e and `pnpm see` (fixture-telegram, Telegram spec §6.10): its
// origin (its own loopback name, `telegram.localhost`), a page address, the wait for the page, and its test-control
// API (`window.__tgStand`). The page talks to nobody: everything a scenario changes on it goes through that API.

import { browser } from '@wdio/globals';

import { TELEGRAM_STAND_GLOBAL, TELEGRAM_STAND_IDS, TELEGRAM_STAND_PATH, TELEGRAM_STAND_READY_ATTRIBUTE, type TelegramStandControl } from '../../fixture-telegram/src/protocol';

export { TELEGRAM_STAND_IDS };

export function telegramStandOrigin(): string {
  const origin = process.env['CG_TELEGRAM_STAND_ORIGIN'];
  if (!origin) throw new Error('CG_TELEGRAM_STAND_ORIGIN not set (wdio onPrepare starts the stand)');
  return origin;
}

/** The page's address: `/a/` with an optional `?account=N` and the chat's hash (`#5550001001`). */
export function telegramStandUrl(options: { readonly chat?: string; readonly account?: number } = {}): string {
  const query = options.account === undefined ? '' : `?account=${options.account}`;
  const hash = options.chat === undefined ? '' : `#${options.chat}`;
  return `${telegramStandOrigin()}${TELEGRAM_STAND_PATH}${query}${hash}`;
}

export async function waitForTelegramStandReady(timeout = 15_000): Promise<void> {
  let state: string | null = null;
  try {
    await browser.waitUntil(
      async () => {
        state = await browser.execute((name: string) => document.documentElement.getAttribute(name), TELEGRAM_STAND_READY_ATTRIBUTE);
        return state === '1' || state === 'failed';
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`the Telegram stand is not ready in ${timeout} ms (${TELEGRAM_STAND_READY_ATTRIBUTE}=${String(state)})`);
  }
  if (state === 'failed') throw new Error('the Telegram stand failed to boot (see the page console)');
}

type Control = Omit<TelegramStandControl, 'sent'> & { readonly sent: () => TelegramStandControl['sent'] };
type Method = keyof Control;

/**
 * Calls the page's control API in the tab in front: `callTelegram('openChat', id)`, `callTelegram('sent')` (the
 * sends so far). A method that throws in the page throws here with its message.
 */
export async function callTelegram<M extends Method>(method: M, ...args: Parameters<Control[M]>): Promise<Awaited<ReturnType<Control[M]>>> {
  const answer = await browser.execute(
    (global: string, name: string, list: unknown[]) => {
      const control = (window as unknown as Record<string, Record<string, unknown> | undefined>)[global];
      if (control === undefined) return { error: 'the page has no window.__tgStand (not the Telegram stand, or not booted)' };
      try {
        if (name === 'sent') return { value: control['sent'] };
        const value = (control[name] as (...args: unknown[]) => unknown)(...list);
        return { value: value === undefined ? null : value };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    TELEGRAM_STAND_GLOBAL,
    method as string,
    args as unknown[],
  );
  const result = answer as { value?: unknown; error?: string };
  if (result.error !== undefined) throw new Error(`__tgStand.${String(method)}: ${result.error}`);
  return result.value as Awaited<ReturnType<Control[M]>>;
}

/** Opens the stand in the tab in front and waits for the page; the slot's storage is written by the page itself. */
export async function openTelegramStand(options: { readonly chat?: string; readonly account?: number } = {}): Promise<void> {
  await browser.url(telegramStandUrl(options));
  await waitForTelegramStandReady();
}
