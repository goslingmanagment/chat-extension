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

/** How many times a suspension that an event canceled is tried again, and the pause before each try. */
const SUSPEND_TRIES = 5;
const SUSPEND_RETRY_MS = 300;

/**
 * Suspends the event page as an expired idle timer does — `runtime.onSuspend`, then the unload — without
 * waiting for the timer; whatever would reset the timer is ignored. Resolves with the state right after.
 *
 * An event that reaches the page while it is suspending cancels the suspension (Firefox: an idle reset in the
 * state `suspending` puts the page back to `running` and fires `runtime.onSuspendCanceled`) — what Firefox's own
 * idle timer meets too, and then it tries again later. The page's own work of a moment ago is such an event: a
 * request answered just now may still be writing, and the `storage.onChanged` of that write reaches the page's
 * own listeners a moment after the answer. So a canceled suspension is tried again, a few times; if every try is
 * canceled, the events that canceled them are named.
 */
export async function suspendBackground(id: string = TEST_GECKO_ID): Promise<BackgroundState> {
  const canceled: string[] = [];
  for (let attempt = 1; ; attempt += 1) {
    const answer = await inChrome((driver) =>
      driver.executeAsyncScript(
        `const [id, done] = arguments;
         const extension = WebExtensionPolicy.getByID(id).extension;
         const resets = [];
         let canceledBy = null;
         const onReset = (_, data) => resets.push(data?.eventName ?? data?.reason ?? '?');
         const onCanceled = () => { canceledBy = resets; };
         extension.on('background-script-reset-idle', onReset);
         extension.on('background-script-suspend-canceled', onCanceled);
         const end = (result) => {
           extension.off('background-script-reset-idle', onReset);
           extension.off('background-script-suspend-canceled', onCanceled);
           done(result);
         };
         extension.terminateBackground({ disableResetIdleForTest: true }).then(
           () => end({ state: extension.backgroundState, canceledBy }),
           (error) => end({ error: String(error) }),
         );`,
        [id],
      ),
    );
    const result = answer as { state?: BackgroundState; canceledBy?: string[] | null; error?: string };
    if (result.state === undefined) throw new Error(`the background was not suspended: ${result.error ?? 'no answer'}`);
    if (result.canceledBy === null || result.canceledBy === undefined) return result.state;
    // The idle reset that canceled it runs before the listener above: the names are of the events that came then.
    canceled.push(`try ${attempt}: ${[...new Set(result.canceledBy)].join(', ') || 'an event'}`);
    if (attempt >= SUSPEND_TRIES) throw new Error(`the background was not suspended: every try was canceled by an event reaching it (${canceled.join('; ')})`);
    await browser.pause(SUSPEND_RETRY_MS);
  }
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
