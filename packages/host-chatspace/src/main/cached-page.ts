// The open chat's newest messages as ChatSpace itself has them loaded (its
// Colada cache `chatMessages`), in the shape of our API read's page
// (contracts OpenChatPage, TO_MAIN.cachedChatMessages). No request: what the
// page already holds — the text, the PPV state as ChatSpace loaded it
// (`price`, `isFree`, `isOpened`), the queue's mark and the photos on
// OnlyMonster's media proxy (`mediaItems[].imageUrl`). Our API read (om-api.ts)
// takes its time — seconds on a chat with much media —, so a start that cannot
// wait for it takes this page instead (live-verified 2026-10-22 on the owner's
// test chat: the cache carries these fields). A purchase made while the page
// is open is in it too: ChatSpace (0.233.0) marks that message `isOpened` in
// this cache when its socket says `account_fan_ppv_purchased`.

import { count, idOf, isPlain, type Plain } from '@cg/host-kit/main/check';

import { price } from './om-api';
import { iso, plain, utf8Bytes } from './page';
import { FRAME_DATA_BUDGET, LIVE_IMAGE_PER_MESSAGE, LIVE_IMAGE_URL_MAX, LIVE_IMAGE_WINDOW, PHOTO_URL } from './protocol';

const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/** The photos of a cached message on OnlyMonster's media proxy, as contracts HostPhoto; empty — none. */
const photosOf = (meta: Plain): Plain[] => {
  const photos: Plain[] = [];
  for (const media of list(meta['mediaItems'])) {
    if (photos.length >= LIVE_IMAGE_PER_MESSAGE) break;
    if (!isPlain(media) || media['type'] !== 'photo') continue;
    const mediaId = idOf(media['id']);
    const url = media['imageUrl'];
    if (mediaId !== null && typeof url === 'string' && url.length <= LIVE_IMAGE_URL_MAX && PHOTO_URL.test(url)) photos.push({ mediaId, url });
  }
  return photos;
};

/** One cached message (`{id, createdAt, isOutgoing, text, platformMetadata}`) as contracts OpenChatMessage; null — unreadable. */
const message = (raw: unknown, withPhotos: boolean): Plain | null => {
  if (!isPlain(raw)) return null;
  const id = idOf(raw['id']);
  const at = iso(raw['createdAt']);
  const outgoing = raw['isOutgoing'];
  if (id === null || at === null || typeof outgoing !== 'boolean') return null;
  const meta = isPlain(raw['platformMetadata']) ? raw['platformMetadata'] : {};
  const media = meta['mediaCount'];
  const photos = withPhotos ? photosOf(meta) : [];
  return {
    platformMessageId: id,
    direction: outgoing ? 'model' : 'fan',
    sentAt: at,
    text: plain(raw['text']),
    price: price(meta['price']),
    isFree: flag(meta['isFree']),
    isOpened: flag(meta['isOpened']),
    mediaCount: count(media) ? media : list(meta['mediaItems']).length,
    tip: meta['isTip'] === true,
    automatic: meta['isFromQueue'] === true,
    ...(photos.length > 0 ? { photos } : {}),
  };
};

/** Newest first: by the time, then a longer (later) numeric id first. */
const newer = (a: Plain, b: Plain): number => {
  const at = (a['sentAt'] as string).localeCompare(b['sentAt'] as string);
  if (at !== 0) return -at;
  const x = a['platformMessageId'] as string;
  const y = b['platformMessageId'] as string;
  return y.length - x.length || (x < y ? 1 : x > y ? -1 : 0);
};

/**
 * The newest `limit` messages of a `chatMessages` cache value (`{pages: [{items, hasMore}]}`), newest first, each id
 * once, within one frame's byte budget, as contracts OpenChatPage; null — ChatSpace holds nothing of the chat.
 */
export function cachedOpenPage(value: unknown, limit: number, now: () => Date = () => new Date()): Plain | null {
  const pages = isPlain(value) ? list(value['pages']) : [];
  if (pages.length === 0) return null;
  const seen = new Set<string>();
  const rows: { readonly raw: unknown; readonly item: Plain }[] = [];
  for (const page of pages) {
    for (const raw of isPlain(page) ? list(page['items']) : []) {
      const item = message(raw, false);
      if (item === null || seen.has(item['platformMessageId'] as string)) continue;
      seen.add(item['platformMessageId'] as string);
      rows.push({ raw, item });
    }
  }
  rows.sort((a, b) => newer(a.item, b.item));
  const items: Plain[] = [];
  let bytes = 0;
  let cut = false;
  for (const row of rows) {
    // Only the newest messages name their photos: what a start sends of them is the fan's latest turn.
    const item = items.length < LIVE_IMAGE_WINDOW ? (message(row.raw, true) ?? row.item) : row.item;
    bytes += utf8Bytes(JSON.stringify(item));
    if ((cut = bytes > FRAME_DATA_BUDGET || items.length >= limit)) break;
    items.push(item);
  }
  const last = pages.at(-1);
  return {
    capturedAt: now().toISOString(),
    items,
    hasMore: cut || (isPlain(last) ? flag(last['hasMore']) : null),
    cursor: items.at(-1)?.['platformMessageId'] ?? null,
  };
}
