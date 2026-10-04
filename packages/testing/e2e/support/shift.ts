// A working shift on the stand: the TEST build installed, pointed at the fake
// hub, a chatter signed in, the page's persona chosen, and a ChatSpace tab of
// the stand open next to an extension page. Sign-in and persona go through the
// page protocol (the settings page's own flows have their specs:
// integration-m1, pages-wiring); everything the specs then do in the ChatSpace
// tab is done by hand — pointer and keys.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser } from '@wdio/globals';

import type { FakeHubControlClient } from '../../src/fake-hub/control-client';
import { PAGE, WORLD } from '../../src/scenarios/hub';
import { assignPersona, installTestBuild, pageRpc, waitForReport, writeLocalStorage, type DockReport, type SpikeReport } from './extension';
import { fakeHubOrigin, QUIET_PAGE, testBuildPage } from './fake-hub';
import { chatPath, openStand, STAND_IDS, waitForChatReady } from './stand';
import { standWorld, type WorldOptions } from './world';

export const SHIFT_PASSWORD = 'synthetic-password';

type DeepPartial<T> = { readonly [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface ShiftOptions extends WorldOptions {
  /** Settings on top of the defaults (the hub address is the fake hub's). */
  readonly settings?: DeepPartial<SettingsV1>;
  /** The chat the ChatSpace tab opens with; null — the account without a chat. Default: fan a1 of account a. */
  readonly chat?: readonly [accountId: string, fanId: string] | null;
  /** Leave the page without a persona (the dock asks for one). */
  readonly persona?: false;
  /** The window of the ChatSpace tab. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Who signs in; the hub's first chatter otherwise. */
  readonly user?: { readonly username: string; readonly password: string };
  /** The hub's world is already set (a second browser of the same spec): only this browser's own shift is started. */
  readonly world?: false;
}

export interface Shift {
  readonly standTab: string;
  readonly pagesTab: string;
  toStand(): Promise<void>;
  toPages(): Promise<void>;
  /** A request of the page protocol, sent from the extension page; the ChatSpace tab is in front again after it. */
  rpc<T = unknown>(type: string, payload?: unknown): Promise<{ readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } }>;
  /** A patch of the settings, as the settings page writes it. */
  patch(patch: Record<string, unknown>): Promise<void>;
}

function merged<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    out[key] = typeof value === 'object' && value !== null && !Array.isArray(value) && typeof current === 'object' && current !== null ? merged(current, value as never) : value;
  }
  return out as T;
}

/** What the dock shows (the test build's own report), once `predicate` holds. */
export function dockIs(predicate: (dock: DockReport, report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<DockReport> {
  return waitForReport((report) => report.appError !== undefined || (report.dock !== undefined && predicate(report.dock, report)), message, timeout).then((report) => {
    if (report.appError !== undefined || report.dock === undefined) throw new Error(`${message}: the tab application failed to start: ${report.appError ?? 'no dock'}`);
    return report.dock;
  });
}

export async function startShift(hub: FakeHubControlClient, options: ShiftOptions = {}): Promise<Shift> {
  if (options.world !== false) await standWorld(hub, options);
  await installTestBuild();
  await browser.url(testBuildPage(QUIET_PAGE));
  const settings = merged<SettingsV1>({ ...DEFAULT_SETTINGS, hub: { baseUrl: fakeHubOrigin() } }, options.settings);
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
  const signedIn = await pageRpc('session.signIn', { login: options.user?.username ?? WORLD.user.username, password: options.user?.password ?? SHIFT_PASSWORD });
  if (!signedIn.ok) throw new Error(`sign-in: ${signedIn.error.code}`);
  if (options.persona !== false) await assignPersona(PAGE);
  // A page that asks the background nothing by itself stays open for the spec's own requests.
  await browser.url(testBuildPage(QUIET_PAGE));
  const pagesTab = await browser.getWindowHandle();
  const standTab = (await browser.createWindow('tab')).handle;
  const toStand = (): Promise<void> => browser.switchToWindow(standTab);
  const toPages = (): Promise<void> => browser.switchToWindow(pagesTab);
  await toStand();
  if (options.viewport !== undefined) {
    await browser.browsingContextSetViewport({ context: standTab, viewport: { width: options.viewport.width, height: options.viewport.height } });
  }
  const chat = options.chat === undefined ? ([STAND_IDS.accounts.a, STAND_IDS.fans.a1] as const) : options.chat;
  if (chat === null) await openStand(chatPath(STAND_IDS.accounts.a));
  else {
    await openStand(chatPath(chat[0], chat[1]));
    await waitForChatReady(chat[0], chat[1]);
  }
  const rpc: Shift['rpc'] = async (type, payload = {}) => {
    await toPages();
    try {
      return await pageRpc(type, payload);
    } finally {
      await toStand();
    }
  };
  return {
    standTab,
    pagesTab,
    toStand,
    toPages,
    rpc,
    async patch(patch) {
      const answer = await rpc('settings.patch', { patch, baseRevision: null });
      if (!answer.ok) throw new Error(`settings.patch: ${answer.error.code}`);
    },
  };
}
