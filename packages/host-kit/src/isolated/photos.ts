// The photos a page already shows, as the hub takes them (`liveImages`), encoded as JPEG of at most `maxEdgePx` on the
// long edge. Two ways to read one:
// - drawn from an image the page's own media proxy lets the page read (ChatSpace's `*.ompcdn.com` answers
//   `access-control-allow-origin: *`), so the canvas stays readable;
// - fetched as the page (`fetchAsPage`: in Firefox MV3 a content script's `fetch` runs in the page's context, its origin
//   and CORS) where the CDN lets only the site read it (Fansly's CDN answers `access-control-allow-origin:
//   https://fansly.com`), decoded from the bytes.
// No request of ours beyond the CDN's image the page itself loads; nothing is kept.

import { type DraftMedia, type DraftMediaType, type LiveImage, type LiveImageRef } from '@cg/contracts/host';
import { DRAFT_MEDIA_LIMITS, LIVE_IMAGE_LIMITS } from '@cg/contracts/limits';

type Timer = (callback: () => void, ms: number) => unknown;

/** The source drawn as JPEG base64 of at most `maxEdgePx`; null — empty, or too big. A tainted canvas throws. */
function drawJpeg(doc: Document, source: CanvasImageSource, width: number, height: number): string | null {
  if (width === 0 || height === 0) return null;
  const scale = Math.min(1, LIVE_IMAGE_LIMITS.maxEdgePx / Math.max(width, height));
  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  // A tainted canvas (an image the page may not read) throws here.
  const url64 = canvas.toDataURL('image/jpeg', LIVE_IMAGE_LIMITS.jpegQuality);
  canvas.width = 0;
  const prefix = 'data:image/jpeg;base64,';
  const data = url64.startsWith(prefix) ? url64.slice(prefix.length) : '';
  return data.length >= 4 && data.length <= LIVE_IMAGE_LIMITS.dataMaxChars ? data : null;
}

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
    return loaded ? drawJpeg(doc, image, image.naturalWidth, image.naturalHeight) : null;
  } catch {
    return null;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
  }
}

/** A request made as the page: its origin, so a CDN that lets only the site read an image lets this. */
export type PageFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Bytes of one image read as the page, at most this many (a fan's original photo is a few MB). */
const FETCH_MAX_BYTES = 20 * 1024 * 1024;

/** One photo fetched as the page and decoded from its bytes; null — it did not come in time, was refused, or does not decode. */
export async function fetchedPhotoAsJpeg(doc: Document, url: string, waitMs: number, setTimer: Timer, fetchAsPage: PageFetch): Promise<string | null> {
  const win = doc.defaultView;
  if (win === null) return null;
  const controller = new AbortController();
  let late = false;
  setTimer(() => {
    late = true;
    controller.abort();
  }, waitMs);
  let bitmap: ImageBitmap | null = null;
  try {
    const response = await fetchAsPage(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const blob = await response.blob();
    if (late || blob.size === 0 || blob.size > FETCH_MAX_BYTES) return null;
    bitmap = await win.createImageBitmap(blob);
    return late ? null : drawJpeg(doc, bitmap, bitmap.width, bitmap.height);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * The photos asked for, each within `waitMs`, in the order asked; those that did not come are left out. Never rejects.
 * With `fetchAsPage` each is fetched as the page first and drawn from the page's image only when that failed.
 */
export async function photosAsLiveImages(doc: Document, refs: readonly LiveImageRef[], waitMs: number, setTimer: Timer, fetchAsPage?: PageFetch): Promise<readonly LiveImage[]> {
  const one = async (url: string): Promise<string | null> => {
    if (fetchAsPage === undefined) return photoAsJpeg(doc, url, waitMs, setTimer).catch(() => null);
    const started = Date.now();
    const fetched = await fetchedPhotoAsJpeg(doc, url, waitMs, setTimer, fetchAsPage).catch(() => null);
    // The page's image within what is left of the same wait.
    const left = waitMs - (Date.now() - started);
    return fetched ?? (left > 0 ? await photoAsJpeg(doc, url, left, setTimer).catch(() => null) : null);
  };
  const drawn = await Promise.all(
    refs.slice(0, LIVE_IMAGE_LIMITS.maxImages).map(async (ref) => {
      const data = await one(ref.url);
      return data === null ? null : { platformMessageId: ref.platformMessageId, mediaId: ref.mediaId, sentAt: ref.sentAt, mediaType: 'image/jpeg' as const, data };
    }),
  );
  return drawn.filter((image): image is NonNullable<typeof image> => image !== null);
}

/** An image the page already shows, drawn as JPEG once it has loaded (within `waitMs`); null — not loaded, unreadable or too big. */
export async function shownImageAsJpeg(doc: Document, image: HTMLImageElement, waitMs: number, setTimer: Timer): Promise<string | null> {
  const loaded =
    image.complete && image.naturalWidth > 0
      ? true
      : await new Promise<boolean>((resolve) => {
          image.addEventListener('load', () => resolve(true), { once: true });
          image.addEventListener('error', () => resolve(false), { once: true });
          setTimer(() => resolve(image.complete && image.naturalWidth > 0), waitMs);
        });
  try {
    return loaded ? drawJpeg(doc, image, image.naturalWidth, image.naturalHeight) : null;
  } catch {
    return null;
  }
}

/** One medium of the composer as a host reads it: its picture is drawn only when asked (`draw`), null — it shows none. */
export interface ComposerMedium {
  readonly type: DraftMediaType;
  readonly durationSec?: number | undefined;
  readonly free?: boolean | undefined;
  readonly draw: (() => Promise<string | null>) | null;
}

/**
 * The composer's media as a start carries it (`HostPort.readDraftMedia`): every medium (at most
 * `DRAFT_MEDIA_LIMITS.itemsMax`), the pictures of the first `imagesMax` that show one drawn at once, each within the
 * caller's wait. null — nothing attached. Never rejects.
 */
export async function composerMedia(capturedAt: string, priceUsd: number | null | undefined, media: readonly ComposerMedium[]): Promise<DraftMedia | null> {
  const kept = media.slice(0, DRAFT_MEDIA_LIMITS.itemsMax);
  if (kept.length === 0) return null;
  let pictures = 0;
  const drawn = await Promise.all(
    kept.map(async (medium) => {
      if (medium.draw === null || pictures >= DRAFT_MEDIA_LIMITS.imagesMax) return null;
      pictures += 1;
      return medium.draw().catch(() => null);
    }),
  );
  const price = priceUsd === undefined || priceUsd === null ? priceUsd : Math.min(Math.max(0, Math.round(priceUsd * 100) / 100), DRAFT_MEDIA_LIMITS.priceMaxUsd);
  return {
    capturedAt,
    ...(price === undefined ? {} : { priceUsd: price }),
    items: kept.map((medium, index) => {
      const data = drawn[index] ?? null;
      const duration = medium.durationSec === undefined ? undefined : Math.min(Math.max(0, Math.round(medium.durationSec)), DRAFT_MEDIA_LIMITS.durationMaxSec);
      return {
        type: medium.type,
        ...(duration === undefined || duration === 0 ? {} : { durationSec: duration }),
        ...(medium.free === true ? { free: true } : {}),
        ...(data === null ? {} : { image: { mediaType: 'image/jpeg' as const, data } }),
      };
    }),
  };
}
