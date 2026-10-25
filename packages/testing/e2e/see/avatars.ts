// The showcase world's fans' pictures on Fansly (`pnpm see --showcase`, src/showcase.ts). The fake Fansly gives every
// fan an avatar on Fansly's CDN (src/fake-fansly/data.ts `wireAvatar`), which the stand never reaches; in a showcase
// run the browser's own requests for it are answered here over BiDi with a drawn picture (src/showcase-avatar.ts), the
// same for the same fan. Nothing of a real person; a run without the showcase loads none.

import { browser } from '@wdio/globals';

import { FAKE_FANSLY_MEDIA_HOST } from '../../src/fake-fansly/data';
import { showcaseAvatar } from '../../src/showcase-avatar';

/** From now on the browser's requests for Fansly's CDN get a fan's drawn picture (by the account id in the path). */
export async function serveShowcaseAvatars(): Promise<void> {
  await browser.sessionSubscribe({ events: ['network.beforeRequestSent'] });
  await browser.networkAddIntercept({ phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: FAKE_FANSLY_MEDIA_HOST }] });
  browser.on('network.beforeRequestSent', (event) => {
    if (!event.isBlocked) return;
    let account = '';
    try {
      account = new URL(event.request.url).pathname.split('/')[1] ?? '';
    } catch {
      // not an address: the plain scene
    }
    void browser
      .networkProvideResponse({
        request: event.request.request,
        statusCode: 200,
        reasonPhrase: 'OK',
        headers: [
          { name: 'Content-Type', value: { type: 'string', value: 'image/svg+xml' } },
          { name: 'Cache-Control', value: { type: 'string', value: 'max-age=3600' } },
        ],
        body: { type: 'string', value: showcaseAvatar(account) },
      })
      .catch(() => undefined);
  });
}
