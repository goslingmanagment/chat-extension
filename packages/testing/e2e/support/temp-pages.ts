// The TEMPORARY options page and popup of integration step M1 in e2e
// (packages/ui/src/pages/TempPages.tsx; R16 replaces both, and this helper
// with them). The pages are plain documents of the extension, so WebDriver
// reads and drives them directly: the hub address under «Дополнительно», the
// sign-in form, sign-out, and the status rows.

import { browser, $ } from '@wdio/globals';

import { testBuildPage } from './fake-hub';

export interface TempRow {
  readonly name: string;
  readonly state: string;
  readonly value: string;
}

export interface TempPageState {
  readonly ready: boolean;
  readonly signedIn: boolean;
  readonly login: string | null;
  readonly rows: readonly TempRow[];
  /** Codes of the error cards the page shows (CG-…). */
  readonly errors: readonly string[];
}

const ROOT = '[data-cg-temp="options"], [data-cg-temp="popup"]';

export async function readTempPage(): Promise<TempPageState> {
  return browser.execute((rootSelector: string) => {
    const root = document.querySelector(rootSelector);
    return {
      ready: root?.getAttribute('data-cg-temp-ready') === 'yes',
      signedIn: root?.getAttribute('data-cg-temp-signed-in') === 'yes',
      login: root?.querySelector('[data-cg-temp="signed-in"]')?.getAttribute('data-cg-temp-login') ?? null,
      rows: [...(root?.querySelectorAll('[data-cg-temp-row]') ?? [])].map((row) => ({
        name: row.getAttribute('data-cg-temp-row') ?? '',
        state: row.getAttribute('data-cg-temp-state') ?? '',
        value: row.querySelector('.cg-temp__value')?.textContent ?? '',
      })),
      errors: [...(root?.querySelectorAll('[data-cg-code]') ?? [])].map((card) => card.getAttribute('data-cg-code') ?? ''),
    };
  }, ROOT);
}

export async function waitForTempPage(predicate: (state: TempPageState) => boolean, message: string, timeout = 15_000): Promise<TempPageState> {
  let last: TempPageState | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await readTempPage();
        return last.ready && predicate(last);
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: not reached in ${timeout} ms; the page shows ${JSON.stringify(last)}`);
  }
  return last as unknown as TempPageState;
}

export const rowsNamed = (state: TempPageState, name: string): TempRow[] => state.rows.filter((row) => row.name === name);
export const rowNamed = (state: TempPageState, name: string): TempRow | undefined => state.rows.find((row) => row.name === name);

/** Opens the options page (or the popup as a tab) of the TEST build and waits for its first status. */
export async function openTempPage(page: 'options' | 'popup' = 'options'): Promise<TempPageState> {
  await browser.url(testBuildPage(`${page}.html`));
  return waitForTempPage(() => true, `${page} page status`);
}

/** «Дополнительно» → the hub address → «Сохранить»: a real click, so the browser's host-permission check runs in a gesture. */
export async function saveHubAddress(origin: string): Promise<void> {
  const details = $('[data-cg-temp="advanced"]');
  if ((await details.getAttribute('open')) === null) await details.$('summary').click();
  const field = details.$('input');
  await field.click();
  await field.setValue(origin);
  await details.$('button').click();
}

/** Fills the sign-in form and submits it. The password is typed, never stored by the page. */
export async function submitSignIn(login: string, password: string): Promise<void> {
  const form = $('[data-cg-temp="sign-in"]');
  await form.waitForExist({ timeout: 10_000 });
  await form.$('input:not([type="password"])').setValue(login);
  await form.$('input[type="password"]').setValue(password);
  await form.$('button').click();
}

export async function clickSignOut(): Promise<void> {
  await $('[data-cg-temp="signed-in"] button').click();
}
