// The photos a page already shows, as the hub takes them (`liveImages`): drawn
// from an image the page's own media proxy lets the page read (ChatSpace's
// `*.ompcdn.com` answers `access-control-allow-origin: *`), so the canvas stays
// readable, and encoded as JPEG of at most `maxEdgePx` on the long edge. No
// request of ours beyond the image load the page itself makes for the same
// address (it is usually in the page's cache); nothing is kept.

import { type LiveImage, type LiveImageRef } from '@cg/contracts/host';
import { LIVE_IMAGE_LIMITS } from '@cg/contracts/limits';

type Timer = (callback: () => void, ms: number) => unknown;

/** One photo as JPEG base64; null — it did not load in time, the proxy did not let the page read it, or it is too big. */
export async function photoAsJpeg(doc: Document, url: string, waitMs: number, setTimer: Timer): Promise<string | null> {
  const image = doc.createElement('img');
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  const loaded = await new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    setTimer(() => resolve(false), waitMs);
    image.src = url;
  });
  try {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!loaded || width === 0 || height === 0) return null;
    const scale = Math.min(1, LIVE_IMAGE_LIMITS.maxEdgePx / Math.max(width, height));
    const canvas = doc.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // A tainted canvas (an image the page may not read) throws here.
    const url64 = canvas.toDataURL('image/jpeg', LIVE_IMAGE_LIMITS.jpegQuality);
    canvas.width = 0;
    const prefix = 'data:image/jpeg;base64,';
    const data = url64.startsWith(prefix) ? url64.slice(prefix.length) : '';
    return data.length >= 4 && data.length <= LIVE_IMAGE_LIMITS.dataMaxChars ? data : null;
  } catch {
    return null;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
  }
}

/** The photos asked for, each within `waitMs`, in the order asked; those that did not come are left out. Never rejects. */
export async function photosAsLiveImages(doc: Document, refs: readonly LiveImageRef[], waitMs: number, setTimer: Timer): Promise<readonly LiveImage[]> {
  const drawn = await Promise.all(
    refs.slice(0, LIVE_IMAGE_LIMITS.maxImages).map(async (ref) => {
      const data = await photoAsJpeg(doc, ref.url, waitMs, setTimer).catch(() => null);
      return data === null ? null : { platformMessageId: ref.platformMessageId, mediaId: ref.mediaId, sentAt: ref.sentAt, mediaType: 'image/jpeg' as const, data };
    }),
  );
  return drawn.filter((image): image is NonNullable<typeof image> => image !== null);
}
