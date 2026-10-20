// Fix: a draft with typos in ChatSpace's field, then the fixed text put in its place.

import { scenario } from '../kit';

const DRAFT = 'i mised you so much today tell me evrything how was the flite';

scenario('fix', async (s) => {
  await s.ready();
  await s.type(DRAFT);
  await s.h.dockIs((d) => d.actions['fix'] === true, 'Fix is on');
  await s.shot('draft');
  await s.press(/^Fix/);
  const field = (): Promise<string | null> => s.h.callStand('composerState', s.ids.accounts.a, s.ids.fans.a1).then((state) => state?.text ?? null);
  await s.browser.waitUntil(async () => ![null, '', DRAFT].includes(await field()), { timeout: 30_000, timeoutMsg: 'Fix did not replace the draft' });
  await s.shot('fixed');
});
