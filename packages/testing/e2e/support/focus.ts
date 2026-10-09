// The keyboard focus of the tab WebDriver works in. Keys a spec presses go
// where the browser window's focus is, and `:focus` matches only in a
// document that has it — so a spec that types, or asks what has the focus
// on the page, needs its tab to hold it, and the browser does not always
// give it:
// - a new tab opens blank, and Firefox gives a blank tab's focus to the
//   address bar. Under load that lands after WebDriver's switch to the tab,
//   and the page loaded into it later never gets the focus;
// - a switch back to a tab gives it back the focus it had there — the
//   address bar's too — racing WebDriver's own focus the same way; and the
//   page of a tab switched to hears of its focus a moment after the switch.
// Measured in the pinned image under CPU load (tools/ci/e2e-docker-local.sh
// with busy containers beside it): the address bar kept the focus of 3 % of
// new tabs with three such containers and of 9 % with six; with six, a
// switch away and back left it there in 2 of 15; and 3 % of switches back
// reached the page ~100 ms late. In the X18 spec of suite-dock it read as no
// focus on «Отмена», although the dock had put it there — and Enter pressed
// then never reached it (CI run 37938725051).

import { browser } from '@wdio/globals';

import { inChrome } from './background';

const pageHasFocus = (): Promise<boolean> => browser.execute(() => document.hasFocus());

/**
 * Makes the tab WebDriver works in hold the keyboard focus, as the tab a person works in does: a focus the browser
 * kept for itself (the address bar) is moved into the tab's own browser through the chrome context
 * (geckodriver --allow-system-access, wdio.conf.ts), and the page is waited for until it has it.
 */
export async function focusTab(): Promise<void> {
  if (await pageHasFocus()) return;
  await inChrome((driver) => driver.executeScript('gBrowser.selectedBrowser.focus();', []));
  await browser.waitUntil(pageHasFocus, { timeout: 5000, interval: 50, timeoutMsg: 'the tab did not get the keyboard focus: keys would not reach the page' });
}
