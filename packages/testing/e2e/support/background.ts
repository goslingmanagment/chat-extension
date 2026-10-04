// The event page of the TEST build as Firefox itself sees it. The privileged
// side of the browser is reached through WebDriver's chrome context
// (geckodriver --allow-system-access, wdio.conf.ts): there the e2e reads the
// state of the background page, suspends it the way an idle timeout does
// (`runtime.onSuspend`, then the unload) and changes the idle timeout.
//
// Firefox unloads an event page after `extensions.background.idle.timeout`
// (30 s) without an event delivered to it; an open port does not hold it.

import { browser } from '@wdio/globals';

import { TEST_GECKO_ID } from './constants';

/** WebDriver Classic commands: wdio's `execute` goes through BiDi, which never runs in the chrome context. */
interface ClassicDriver {
  setMozContext(context: 'chrome' | 'content'): Promise<void>;
  executeScript(script: string, args: unknown[]): Promise<unknown>;
  executeAsyncScript(script: string, args: unknown[]): Promise<unknown>;
}

const IDLE_PREF = 'extensions.background.idle.timeout';

async function inChrome<T>(run: (driver: ClassicDriver) => Promise<T>): Promise<T> {
  const driver = browser as unknown as ClassicDriver;
  await driver.setMozContext('chrome');
  try {
    return await run(driver);
  } finally {
    await driver.setMozContext('content');
  }
}

export type BackgroundState = 'starting' | 'running' | 'suspending' | 'stopped';

/** `extension.backgroundState` of the add-on. */
export async function backgroundState(id: string = TEST_GECKO_ID): Promise<BackgroundState> {
  const state = await inChrome((driver) => driver.executeScript('return WebExtensionPolicy.getByID(arguments[0]).extension.backgroundState;', [id]));
  return state as BackgroundState;
}

/**
 * Suspends the event page as an expired idle timer does — `runtime.onSuspend`, then the unload — without
 * waiting for the timer. Whatever would reset the timer is ignored. Resolves with the state right after.
 */
export async function suspendBackground(id: string = TEST_GECKO_ID): Promise<BackgroundState> {
  const answer = await inChrome((driver) =>
    driver.executeAsyncScript(
      `const [id, done] = arguments;
       const extension = WebExtensionPolicy.getByID(id).extension;
       extension.terminateBackground({ disableResetIdleForTest: true }).then(() => done({ state: extension.backgroundState }), (error) => done({ error: String(error) }));`,
      [id],
    ),
  );
  const result = answer as { state?: BackgroundState; error?: string };
  if (result.state === undefined) throw new Error(`the background was not suspended: ${result.error ?? 'no answer'}`);
  return result.state;
}

/**
 * The idle timeout of event pages, ms; null — Firefox's default (30 s). A running page keeps the timer it
 * already started: suspend it once (suspendBackground) and its next instance counts with the new value.
 */
export async function setBackgroundIdleTimeout(ms: number | null): Promise<void> {
  await inChrome((driver) =>
    driver.executeScript(`const [name, ms] = arguments; if (ms === null) Services.prefs.clearUserPref(name); else Services.prefs.setIntPref(name, ms); return true;`, [IDLE_PREF, ms]),
  );
}

export async function waitForBackgroundState(wanted: BackgroundState, message: string, timeout: number): Promise<void> {
  let last: BackgroundState | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await backgroundState();
        return last === wanted;
      },
      { timeout, interval: 500 },
    );
  } catch {
    throw new Error(`${message}: the background is «${String(last)}», not «${wanted}», after ${timeout} ms`);
  }
}

const OPTIONAL_PROMPTS_PREF = 'extensions.webextOptionalPermissionPrompts';

/**
 * Whether `permissions.request` shows Firefox's own question. With `false` the browser grants what an add-on
 * asks for on a user gesture without showing it — the answer a person gives by pressing «Allow», for a
 * headless run that nobody can press in. The gesture check itself stays: a request outside a click is still
 * refused. null — Firefox's default (the question is shown).
 */
export async function setOptionalPermissionPrompts(shown: boolean | null): Promise<void> {
  await inChrome((driver) =>
    driver.executeScript(`const [name, shown] = arguments; if (shown === null) Services.prefs.clearUserPref(name); else Services.prefs.setBoolPref(name, shown); return true;`, [OPTIONAL_PROMPTS_PREF, shown]),
  );
}
