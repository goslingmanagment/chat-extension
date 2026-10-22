// The one request of Fansly's isolated world (eslint.config.ts allows `fetch` in this file alone): a fan's photo from
// Fansly's CDN for an AI start (`HostPort.loadImages`), by the click. The CDN lets only fansly.com read an image
// (`access-control-allow-origin: https://fansly.com`), and in Firefox MV3 a content script's `fetch` runs in the
// page's context, so it reads as the page would; the address is CloudFront-signed for this browser. Only a GET of an
// address on `cdn*.fansly.com`, without credentials: never Fansly's API, never anything else.

import { FanslyPhotoUrlSchema } from '@cg/contracts/host';
import type { PageFetch } from '@cg/host-kit/isolated/photos';

/** The page's `fetch` narrowed to a GET of a photo on Fansly's CDN; anything else is refused before it leaves. */
export function fanslyCdnFetch(win: Window): PageFetch {
  return (url, init) => {
    if (!FanslyPhotoUrlSchema.safeParse(url).success) return Promise.reject(new Error('not a photo on Fansly\'s CDN'));
    return win.fetch(url, { ...init, method: 'GET', credentials: 'omit', redirect: 'error' });
  };
}
