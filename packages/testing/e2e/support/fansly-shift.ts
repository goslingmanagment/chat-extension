// A working shift on the Fansly stand (R20 P7i): the TEST build installed,
// pointed at the fake hub, a chatter signed in, the Fansly page's persona
// chosen and its own switches on (`*` never reaches a Fansly page, HF-2),
// Fansly switched on as a person does it — the stand's origins granted, the
// background's sync registering both scripts —, and a tab of the Fansly stand
// open in a chat next to the neighbour, beside an extension page. The same
// for ChatSpace is support/shift.ts; both in one browser:
// `openChatSpaceBeside`.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser } from '@wdio/globals';

import { fanslyPageFlags } from '../../src/fake-hub/config';
import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import type { NeighborConfig } from '../../src/fake-fansly/neighbor/protocol';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { assignPersona, installTestBuild, pageRpc, writeLocalStorage } from './extension';
import { fakeHubOrigin, QUIET_PAGE, testBuildPage } from './fake-hub';
import { openWithNeighbor } from './fansly-neighbor';
import { fakeFansly } from './fansly-stand';
import { switchFanslyOnForTheStand } from './fansly-site';
import { focusTab } from './focus';
import { SHIFT_PASSWORD } from './shift';
import { chatPath, openStand, STAND_IDS, waitForChatReady } from './stand';

export interface FanslyShiftOptions {
  /** Settings on top of the defaults (the hub address is the fake hub's). */
  readonly settings?: { readonly generation?: Partial<SettingsV1['generation']>; readonly ui?: Partial<SettingsV1['ui']> };
  /** The Fansly stand's path the tab opens with. */
  readonly path: string;
  /** The neighbour next to it (`off` by default). */
  readonly neighbor?: Partial<NeighborConfig>;
  readonly viewport?: { readonly width: number; readonly height: number };
  /** The hub's world is already set (a second browser of the same spec): only this browser's own shift is started. */
  readonly world?: false;
  /** Another chatter in a second browser, against the same hub and page. */
  readonly user?: { readonly username: string; readonly password: string };
}

export interface FanslyShift {
  readonly fanslyTab: string;
  readonly pagesTab: string;
  toFansly(): Promise<void>;
  toPages(): Promise<void>;
  /** A request of the page protocol from the extension page; the Fansly tab is in front again after it. */
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
}

export async function startFanslyShift(hub: FakeHubControlClient, options: FanslyShiftOptions): Promise<FanslyShift> {
  if (options.world !== false) await hub.command({ op: 'config', patch: fanslyPageFlags() });
  await installTestBuild();
  await browser.url(testBuildPage(QUIET_PAGE));
  const settings: SettingsV1 = {
    ...DEFAULT_SETTINGS,
    hub: { baseUrl: fakeHubOrigin() },
    ui: { ...DEFAULT_SETTINGS.ui, ...options.settings?.ui },
    generation: { ...DEFAULT_SETTINGS.generation, ...options.settings?.generation },
  };
  await writeLocalStorage({ [STORAGE_KEYS.settings]: settings, 'dev.fanslyApi.origin': fakeFansly().apiOrigin });
  await browser.waitUntil(
    async () => {
      const state = await pageRpc<{ settings: SettingsV1 }>('settings.get');
      return state.ok && state.payload.settings.hub.baseUrl === fakeHubOrigin();
    },
    { timeout: 15_000, timeoutMsg: 'the settings owner did not pick the hub address up' },
  );
  // The password is taken only from the settings page (the sender rule of `session.signIn`).
  await browser.url(testBuildPage('options.html'));
  const signedIn = await pageRpc('session.signIn', { login: options.user?.username ?? WORLD.user.username, password: options.user?.password ?? SHIFT_PASSWORD });
  if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.error.code}`);
  await assignPersona(WORLD.pages.fansly.pageLabel);
  // «Включить Fansly», as far as the stand goes: its origins and webRequest granted, the background registers both scripts.
  await switchFanslyOnForTheStand();
  await browser.url(testBuildPage(QUIET_PAGE));
  const pagesTab = await browser.getWindowHandle();
  const fanslyTab = (await browser.createWindow('tab')).handle;
  const toFansly = async (): Promise<void> => {
    await browser.switchToWindow(fanslyTab);
    await focusTab();
  };
  const toPages = (): Promise<void> => browser.switchToWindow(pagesTab);
  await browser.switchToWindow(fanslyTab);
  if (options.viewport !== undefined) await browser.browsingContextSetViewport({ context: fanslyTab, viewport: { ...options.viewport } });
  await openWithNeighbor(options.path, options.neighbor ?? { mode: 'off' });
  await focusTab();
  return {
    fanslyTab,
    pagesTab,
    toFansly,
    toPages,
    async rpc(type, payload = {}) {
      await toPages();
      try {
        return await pageRpc(type, payload);
      } finally {
        await toFansly();
      }
    },
  };
}

/**
 * A ChatSpace tab of the stand in the same browser, beside the Fansly one (the open chat of fan a1 of account a), the
 * hub's ChatSpace page with its persona. The page must be bound to the stand's account before the shift signed in
 * (`standWorld`, support/world.ts). Returns its window handle; it is in front.
 */
export async function openChatSpaceBeside(shift: FanslyShift): Promise<string> {
  await shift.toPages();
  await assignPersona(PAGE);
  const tab = (await browser.createWindow('tab')).handle;
  await browser.switchToWindow(tab);
  await openStand(chatPath(STAND_IDS.accounts.a, STAND_IDS.fans.a1));
  await waitForChatReady(STAND_IDS.accounts.a, STAND_IDS.fans.a1);
  await focusTab();
  return tab;
}
