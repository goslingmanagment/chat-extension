// A working shift on the Telegram stand (Telegram spec §6.10): the TEST build installed, pointed at the fake hub, the
// owner's Telegram world switched on there (`telegramWorld`: the page `lora-tg` granted and its own row on, its
// persona in the catalog), a chatter signed in, the page's persona chosen (the bootstrap names it; the extension
// assigns it itself, else the shift does), Telegram switched on as far as the stand goes — its origin granted, the
// background registering its script —, and a tab of the stand open in a chat beside an extension page. The same for
// Fansly is support/fansly-shift.ts.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser } from '@wdio/globals';

import { TELEGRAM_PAGE, TELEGRAM_PERSONA, telegramWorld } from '../../src/fake-hub/config';
import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import { WORLD } from '../../src/scenarios/hub';
import { installTestBuild, pageRpc, writeLocalStorage } from './extension';
import { fakeHubOrigin, QUIET_PAGE, testBuildPage } from './fake-hub';
import { focusTab } from './focus';
import { SHIFT_PASSWORD } from './shift';
import { OPTIONAL_STAND_SITES, switchSiteOnForTheStand } from './site-grant';
import { openTelegramStand, TELEGRAM_STAND_IDS, telegramStandOrigin } from './telegram-stand';

export interface TelegramShiftOptions {
  /** The chat the tab opens (its hash); default Jamie's. */
  readonly chat?: string;
  /** The Telegram account slot of the address (`?account=N`); default none (slot 1, Lora's account). */
  readonly account?: number;
  /** Settings on top of the defaults (the hub address is the fake hub's). */
  readonly settings?: { readonly generation?: Partial<SettingsV1['generation']>; readonly ui?: Partial<SettingsV1['ui']> };
  readonly viewport?: { readonly width: number; readonly height: number };
  /** The hub's world is already set: only this browser's own shift is started. */
  readonly world?: false;
}

export interface TelegramShift {
  readonly telegramTab: string;
  readonly pagesTab: string;
  toTelegram(): Promise<void>;
  toPages(): Promise<void>;
  /** A request of the page protocol from the extension page; the Telegram tab is in front again after it. */
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
}

/**
 * The page has its persona: the one the extension assigned (the bootstrap's `defaultPersonaKey`), else `key` of the
 * hub's catalog, assigned as «Персоны» of the settings would. Called from an extension page of a signed-in build.
 */
async function ensurePersona(pageLabel: string, key: string): Promise<void> {
  const bootstrap = await pageRpc<{ pages: ReadonlyArray<{ pageId: number; pageLabel: string }> }>('bootstrap.get');
  if (!bootstrap.ok) throw new Error(`bootstrap.get: ${bootstrap.error.code}`);
  const page = bootstrap.payload.pages.find((item) => item.pageLabel === pageLabel);
  if (page === undefined) throw new Error(`the bootstrap has no page «${pageLabel}» (does the extension skip a Telegram page?)`);
  const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
  if (state.ok && state.payload.settings.personas.byPageId[String(page.pageId)] !== undefined) return;
  const catalog = await pageRpc<{ personas: ReadonlyArray<{ key: string; definitionId: string; status: string }> }>('catalog.get');
  if (!catalog.ok) throw new Error(`catalog.get: ${catalog.error.code}`);
  const persona = catalog.payload.personas.find((item) => item.key === key && item.status === 'active');
  if (persona === undefined) throw new Error(`the catalog has no active persona «${key}»`);
  const saved = await pageRpc('persona.set', { pageId: page.pageId, key: persona.key, definitionId: persona.definitionId });
  if (!saved.ok) throw new Error(`persona.set: ${saved.error.code}`);
}

export async function startTelegramShift(hub: FakeHubControlClient, options: TelegramShiftOptions = {}): Promise<TelegramShift> {
  if (options.world !== false) for (const command of telegramWorld(WORLD.user.username)) await hub.command(command);
  await installTestBuild();
  await browser.url(testBuildPage(QUIET_PAGE));
  const settings: SettingsV1 = {
    ...DEFAULT_SETTINGS,
    hub: { baseUrl: fakeHubOrigin() },
    ui: { ...DEFAULT_SETTINGS.ui, ...options.settings?.ui },
    generation: { ...DEFAULT_SETTINGS.generation, ...options.settings?.generation },
  };
  await writeLocalStorage({ [STORAGE_KEYS.settings]: settings });
  await browser.waitUntil(
    async () => {
      const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
      return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
    },
    { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
  );
  // The password is taken only from the settings page (the sender rule of `session.signIn`).
  await browser.url(testBuildPage('options.html'));
  const signedIn = await pageRpc('session.signIn', { login: WORLD.user.username, password: SHIFT_PASSWORD });
  if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.error.code}`);
  await ensurePersona(TELEGRAM_PAGE.pageLabel, TELEGRAM_PERSONA.key);
  // «Включить Telegram», as far as the stand goes: its origin granted, the background registers its script.
  await switchSiteOnForTheStand(OPTIONAL_STAND_SITES.telegram);
  await browser.url(testBuildPage(QUIET_PAGE));
  const pagesTab = await browser.getWindowHandle();
  const telegramTab = (await browser.createWindow('tab')).handle;
  const toTelegram = async (): Promise<void> => {
    await browser.switchToWindow(telegramTab);
    await focusTab();
  };
  const toPages = (): Promise<void> => browser.switchToWindow(pagesTab);
  await browser.switchToWindow(telegramTab);
  if (options.viewport !== undefined) await browser.browsingContextSetViewport({ context: telegramTab, viewport: { ...options.viewport } });
  // Web A's sessions are in the page's storage before any script of a load runs: a first load writes the stand's
  // account slots (as a past sign-in left them), the next one is the load a person works in.
  await browser.url(`${telegramStandOrigin()}/a/?stand-seed=1`);
  await openTelegramStand({ chat: options.chat ?? TELEGRAM_STAND_IDS.chats.jamie, ...(options.account === undefined ? {} : { account: options.account }) });
  await focusTab();
  return {
    telegramTab,
    pagesTab,
    toTelegram,
    toPages,
    async rpc(type, payload = {}) {
      await toPages();
      try {
        return await pageRpc(type, payload);
      } finally {
        await toTelegram();
      }
    },
  };
}
