// The fake hub in e2e (architecture.md §12 п. 2, 4): wdio onPrepare starts it
// on a loopback port (src/fake-hub/server.ts) and exports its origin as
// CG_FAKE_HUB_ORIGIN; the network trap allows that origin. The TEST build
// reaches it through its loopback host permission; `pointTestBuildAtFakeHub`
// writes the hub address into the build's settings (settings v1, key
// `settings`, §5.6) so the background talks to the fake hub. Specs drive it
// with the control client and fail on any call the client must never make.

import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsV1 } from '@cg/contracts';
import { browser } from '@wdio/globals';

import { fakeHubControl, type FakeHubControlClient } from '../../src/fake-hub/control-client';
import { describeCalls } from '../../src/fake-hub/journal';
import { E2E_ADDON_UUID } from './constants';

export function fakeHubOrigin(): string {
  const origin = process.env['CG_FAKE_HUB_ORIGIN'];
  if (origin === undefined || origin === '') throw new Error('CG_FAKE_HUB_ORIGIN not set (wdio onPrepare starts the fake hub)');
  return origin;
}

/** The control API of the suite's fake hub (commands, status, journal). */
export function fakeHub(): FakeHubControlClient {
  return fakeHubControl(fakeHubOrigin());
}

/**
 * An extension page of the TEST build (its loopback host permission and
 * storage). The default is the journal page: with debug mode off it asks the
 * background only for the settings and the sign-in, never for a status. The
 * popup and the options page read the status when they open — for a
 * signed-in person the hub's health included — and the build's default hub
 * is the real one.
 */
export const QUIET_PAGE = 'debug-journal.html';
export const testBuildPage = (path = QUIET_PAGE): string => `moz-extension://${E2E_ADDON_UUID}/${path}`;

/**
 * Writes the fake hub's origin as the hub address of the installed TEST build
 * (settings v1 with defaults otherwise) from one of its own pages, and reads
 * it back. The background owns settings (§9.4): call this before the flow
 * that signs in, and reload the extension or its pages if they already read
 * the old address.
 */
export async function pointTestBuildAtFakeHub(origin = fakeHubOrigin()): Promise<SettingsV1> {
  await browser.url(testBuildPage());
  const settings: SettingsV1 = { ...DEFAULT_SETTINGS, hub: { baseUrl: origin } };
  const stored = await browser.execute(
    async (key: string, value: SettingsV1) => {
      const api = (globalThis as unknown as { browser?: { storage: { local: { set(items: Record<string, unknown>): Promise<void>; get(key: string): Promise<Record<string, unknown>> } } } }).browser;
      if (api === undefined) throw new Error('no extension API on this page');
      await api.storage.local.set({ [key]: value });
      return (await api.storage.local.get(key))[key] as SettingsV1;
    },
    STORAGE_KEYS.settings,
    settings,
  );
  if (stored.hub.baseUrl !== origin) throw new Error(`the test build kept hub ${stored.hub.baseUrl}, not ${origin}`);
  return stored;
}

/**
 * Mocha wiring: resets the fake hub before the suite and fails after any test
 * during which the client made a call it must never make (a forbidden or
 * unknown route, a request failing the contract schema, a call a strict
 * script did not expect). A test that makes one on purpose calls `accept()`.
 */
export function useFakeHub(): { readonly hub: () => FakeHubControlClient; readonly accept: () => Promise<void> } {
  const control = fakeHub();
  let since = 0;
  before(async () => {
    await control.command({ op: 'reset' });
    since = await control.mark();
  });
  afterEach(async function (this: Mocha.Context) {
    const found = await control.violations(since);
    since = await control.mark();
    if (found.length > 0) throw new Error(`fake hub: ${found.length} call(s) the client must never make during «${this.currentTest?.fullTitle() ?? '?'}»:\n${describeCalls(found)}`);
  });
  return {
    hub: () => control,
    accept: async () => {
      since = await control.mark();
    },
  };
}
