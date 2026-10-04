// A second Firefox of the same e2e: another install of the extension, with
// its own profile, its own background and its own sign-in — a colleague's
// browser, or the same chatter's second device. The suite's own session is
// one browser per spec (wdio.conf.ts); this one is started by hand with the
// same capabilities (the headless profile, the egress sink as its proxy, the
// fixed extension UUID) and ended by the spec.
//
// Every helper of e2e/support drives «the» browser of @wdio/globals.
// `inBrowser` points those globals at another session for the length of one
// call, so the same helpers — startShift, callStand, ours — drive the second
// browser unchanged. Elements found there keep working outside the call:
// an element belongs to its session.

import { browser } from '@wdio/globals';
import { remote } from 'webdriverio';

/** The registry `@wdio/globals` reads `browser`, `$` and `$$` from. */
const registry = (): Map<string, unknown> => {
  const globals = (globalThis as unknown as { _wdioGlobals?: Map<string, unknown> })._wdioGlobals;
  if (globals === undefined) throw new Error('no @wdio/globals registry: not inside the WDIO test runner');
  return globals;
};

/**
 * Starts another Firefox with the capabilities of the suite's own session, plus `prefs` of its own (a browser
 * that says it runs on Windows, for one). End it with `deleteSession()`.
 */
export async function startSecondBrowser(prefs: Readonly<Record<string, string | number | boolean>> = {}): Promise<WebdriverIO.Browser> {
  const own = browser.requestedCapabilities as WebdriverIO.Capabilities;
  const firefox = own['moz:firefoxOptions'] ?? {};
  return remote({ capabilities: { ...own, 'moz:firefoxOptions': { ...firefox, prefs: { ...firefox.prefs, ...prefs } } }, logLevel: 'warn' });
}

/** Runs `run` with the helpers of e2e/support driving `instance`; the suite's own browser is back after it. */
export async function inBrowser<T>(instance: WebdriverIO.Browser, run: () => Promise<T>): Promise<T> {
  const globals = registry();
  const saved = new Map(globals);
  globals.set('browser', instance);
  globals.set('driver', instance);
  globals.set('$', (selector: string) => instance.$(selector));
  globals.set('$$', (selector: string) => instance.$$(selector));
  try {
    return await run();
  } finally {
    for (const key of ['browser', 'driver', '$', '$$']) globals.set(key, saved.get(key));
  }
}
