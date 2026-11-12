// my-shifts: the popup's «Мои смены» opens Workboard's «Мои смены» in a new tab, signed in by the hub's one-time link
// (`web-link-v1`, hub #1213); then the same click against a hub without it opens Workboard's plain address. The stand
// lets nothing out: each new tab's address is printed (the code hidden), `egress.json` holds the hosts it tried,
// `hub-calls.json` the fake hub's `authWebLink`.

import { PILOT_CAPABILITIES } from '../../../src/fake-hub/config';
import { openPopup, press, waitForPopup } from '../../support/pages';
import { scenario, type See } from '../kit';

/** Presses «Мои смены» in the popup; the address of the tab it opened, its code hidden. */
async function myShifts(s: See): Promise<string> {
  const popup = await s.browser.getWindowHandle();
  const before = await s.browser.getWindowHandles();
  await press('Мои смены');
  await s.browser.waitUntil(async () => (await s.browser.getWindowHandles()).length > before.length, { timeout: 20_000, timeoutMsg: '«Мои смены» opened no tab' });
  const opened = (await s.browser.getWindowHandles()).find((handle) => !before.includes(handle));
  if (opened === undefined) throw new Error('«Мои смены»: no new tab');
  await s.browser.switchToWindow(opened);
  await s.browser.waitUntil(async () => (await s.browser.getUrl()) !== 'about:blank', { timeout: 10_000, timeoutMsg: 'the new tab has no address' });
  const url = (await s.browser.getUrl()).replace(/code=[^&]+/, 'code=<code>');
  await s.browser.closeWindow();
  await s.browser.switchToWindow(popup);
  return url;
}

scenario('my-shifts', async (s) => {
  await s.ready();
  await s.toPages();
  await openPopup();
  await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
  await s.shot('popup');
  // The popup alone, as the browser draws it under its button (a note's picture with `--showcase`).
  const popupBox = await s.rect('page', '.pg-popup');
  if (popupBox !== null) await s.shot('popup-alone', { clip: popupBox });
  console.log(`cg-see opened (web-link-v1): ${await myShifts(s)}`);
  // A hub without the one-time link: the bootstrap read again says so, and the same click opens the plain address.
  await s.hub.command({ op: 'config', patch: { capabilities: PILOT_CAPABILITIES.filter((capability) => capability !== 'web-link-v1') } });
  await s.rpc('bootstrap.get', { force: true });
  await s.toPages();
  await openPopup();
  await waitForPopup((state) => state.view === 'ready', 'the popup again');
  console.log(`cg-see opened (no web-link-v1): ${await myShifts(s)}`);
  await s.toChat();
});
