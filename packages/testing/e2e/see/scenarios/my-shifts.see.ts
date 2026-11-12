// my-shifts: the popup's «Мои смены» opens Workboard's «Мои смены» in a new tab, signed in by the hub's one-time link
// (`web-link-v1`, hub #1213); a hub without it, or a build whose SDK does not have the route yet, opens Workboard's
// plain address. The stand lets nothing out: the new tab's address is printed (the code hidden), `egress.json` holds
// the host it tried, `hub-calls.json` whether the fake hub was asked.

import { openPopup, press, waitForPopup } from '../../support/pages';
import { scenario } from '../kit';

scenario('my-shifts', async (s) => {
  await s.ready();
  await s.toPages();
  await openPopup();
  await waitForPopup((state) => state.view === 'ready', 'the popup of a signed-in person');
  await s.shot('popup');
  // The popup alone, as the browser draws it under its button (a note's picture with `--showcase`).
  const popupBox = await s.rect('page', '.pg-popup');
  if (popupBox !== null) await s.shot('popup-alone', { clip: popupBox });
  const popup = await s.browser.getWindowHandle();
  const before = await s.browser.getWindowHandles();
  await press('Мои смены');
  await s.browser.waitUntil(async () => (await s.browser.getWindowHandles()).length > before.length, { timeout: 20_000, timeoutMsg: '«Мои смены» opened no tab' });
  const opened = (await s.browser.getWindowHandles()).find((handle) => !before.includes(handle));
  if (opened !== undefined) {
    await s.browser.switchToWindow(opened);
    await s.browser.waitUntil(async () => (await s.browser.getUrl()) !== 'about:blank', { timeout: 10_000, timeoutMsg: 'the new tab has no address' });
    console.log(`cg-see opened: ${(await s.browser.getUrl()).replace(/code=[^&]+/, 'code=<code>')}`);
    await s.browser.closeWindow();
    await s.browser.switchToWindow(popup);
  }
  await s.toChat();
});
