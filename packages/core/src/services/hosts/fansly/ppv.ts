// Whether the fan bought the paid attachments of the open Fansly chat (X54 on Fansly, hub `live-ppv-fansly-v1`).
//
// The hub marks each paid attachment of its transcript from its own stores: «purchased» from the orders it captured,
// «not purchased» only after it walked the media's whole order history — and it never walks a PPV nobody bought. So
// without the client most marks read «unknown» (audit 2026-10-20 №3: 39.7 % against the old extension's 1.2 %). The
// old extension (2.13.0) read the chat and `/media/orderhistory` on every generation; this is that read, by the click,
// for the hub to lay over its own marks:
//
// - the chat's newest pages of history (`GET /message?groupId=`, 25 a page): the creator's messages, each attachment
//   paid by its PPV permission row (`flags & 1`; its price, else the one in `metadata`, else none) on the page's own
//   `accountMedia` / `accountMediaBundles`;
// - bought: the fan's order inline on those pages (`accountMediaOrders`), else the fan's own order in
//   `GET /media/orderhistory?accountMediaId|accountMediaBundleId=&accountIds=<fan>` — read for the newest unresolved
//   attachments only, a few at a time, while the next page loads;
// - not bought: ONLY that order history's answer with no order of the fan (never the absence of an inline order);
// - anything else (a read that failed or did not come back in time) is left out: the hub keeps its own mark.
//
// The answer waits at most `answerMs`; what is not known by then is left out, and the reads go on and fill the cache
// for the next click (Regenerate). A fan's «bought» is kept for the session (a purchase does not come undone), «not
// bought» only briefly: a purchase since then shows on the fresh page's inline orders first.
//
// The same newest page names the photos of the fan's latest turn (`latestFanPhotos`) for Reply, Fix and Coach: the tab
// draws them and they ride to the hub as images (`liveImages`). No request more: a start without the PPV state reads
// only that page.

import { FanslyPhotoUrlSchema, type LiveImageRef } from '@cg/contracts/host';
import { LIVE_IMAGE_LIMITS } from '@cg/contracts/limits';
import type { LivePpvAttachmentItem } from '@cg/contracts/ops';

export const PPV_READ = {
  /** Pages of history read from the fresh end, 25 messages each: the newest 50, as ChatSpace's read. */
  pages: 2,
  pageSize: 25,
  /** Attachments asked of `/media/orderhistory` at most, newest first (2.13.0: 10). */
  checks: 10,
  /** Order-history reads in flight at once (2.13.0: 3). */
  concurrency: 3,
  /** How long the answer waits for the reads; then it goes with what is known. */
  answerMs: 1300,
  boughtTtlMs: 30 * 60_000,
  notBoughtTtlMs: 60_000,
  cacheMax: 500,
  /** The hub's `AI_LIVE_PPV_MAX_ITEMS`. */
  maxItems: 100,
  /** The hub's `AI_LIVE_PPV_PRICE_MAX_USD`. */
  priceMaxUsd: 10_000,
} as const;

/** Fansly's answers as they came (the envelope's `response`); a failed request throws. */
export interface PpvReadPort {
  /** `GET /message?groupId=&limit=[&before=]`. */
  history(query: Readonly<Record<string, string>>): Promise<unknown>;
  /** `GET /media/orderhistory?accountMediaId=|accountMediaBundleId=&accountIds=&limit=`. */
  orders(query: Readonly<Record<string, string>>): Promise<unknown>;
}

export interface PpvChat {
  readonly creatorId: string;
  readonly fanId: string;
  readonly groupId: string;
}

/** A fan's order-history answer, kept: by `creator:fan:kind:id`. */
export type PpvCache = Map<string, { readonly bought: boolean; readonly at: number }>;

export interface PpvReadDeps {
  readonly now: () => number;
  readonly cache: PpvCache;
  /** Resolves after `ms` (the answer's deadline). */
  readonly wait: (ms: number) => Promise<void>;
}

type Kind = 'media' | 'bundle';

const ATTACHMENT_MEDIA = 1;
const ATTACHMENT_BUNDLE = 2;
const ORDER_SINGLE = 1;
const ORDER_BUNDLE = 2;
const PPV_FLAG = 1;
const ID = /^[1-9][0-9]{0,23}$/;

const recordOf = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const idOf = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null);
const arrayOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
const newestFirst = (left: string, right: string): number => (BigInt(left) > BigInt(right) ? -1 : BigInt(left) < BigInt(right) ? 1 : 0);

/** 2.13.0 `findPpvPermission` + `extractPpvPriceMills`: the row with the PPV bit makes it paid; its price, else the one in `metadata`. */
export function ppvPriceOf(item: unknown): { readonly mills: number | null } | null {
  const rows = arrayOf(recordOf(recordOf(item)?.['permissions'])?.['permissionFlags']);
  const row = rows.map(recordOf).find((entry) => entry !== null && typeof entry['flags'] === 'number' && (entry['flags'] & PPV_FLAG) === PPV_FLAG);
  if (row === undefined || row === null) return null;
  const price = row['price'];
  if (typeof price === 'number' && Number.isSafeInteger(price) && price > 0) return { mills: price };
  if (typeof row['metadata'] !== 'string' || row['metadata'].length === 0) return { mills: null };
  try {
    const outer = recordOf(JSON.parse(row['metadata']));
    const inner = typeof outer?.['1'] === 'string' ? recordOf(JSON.parse(outer['1'])) : null;
    const fromMeta = inner?.['price'];
    return { mills: typeof fromMeta === 'number' && Number.isSafeInteger(fromMeta) && fromMeta > 0 ? fromMeta : null };
  } catch {
    return { mills: null };
  }
}

/** An order of the fan, as the history page or the order history serves it. */
interface Order {
  readonly accountId: string | null;
  readonly media: string | null;
  readonly bundle: string | null;
  readonly type: number | null;
}

const orderOf = (value: unknown): Order | null => {
  const row = recordOf(value);
  if (row === null) return null;
  return { accountId: idOf(row['accountId']), media: idOf(row['accountMediaId']), bundle: idOf(row['accountMediaBundleId']), type: typeof row['type'] === 'number' ? row['type'] : null };
};

/** 2.13.0 `buildPurchaseEvidence`: what an inline order of the fan proves bought (`kind:id`). */
function inlineBought(order: Order, fanId: string): string | null {
  if (order.accountId !== fanId) return null;
  if (order.bundle !== null && order.type !== ORDER_SINGLE) return `bundle:${order.bundle}`;
  if (order.type === ORDER_SINGLE && order.media !== null) return `media:${order.media}`;
  if (order.type === ORDER_BUNDLE && order.media !== null) return `bundle:${order.media}`;
  return null;
}

/** 2.13.0 `orderMatchesPurchaseRequest`: the fan's order of this media or bundle. */
export function orderMatches(value: unknown, kind: Kind, id: string, fanId: string): boolean {
  const order = orderOf(value);
  if (order === null || order.accountId !== fanId) return false;
  if (kind === 'media') return order.media === id && order.bundle === null && (order.type === null || order.type === ORDER_SINGLE);
  if (order.bundle !== null) return order.bundle === id && order.type !== ORDER_SINGLE;
  return order.type === ORDER_BUNDLE && order.media === id;
}

/** 2.13.0 `extractOrderHistoryRows`: the rows of an order-history answer; null — not one. */
export function orderHistoryRows(response: unknown): readonly unknown[] | null {
  const page = recordOf(response);
  const direct = page?.['accountMediaOrderHistory'];
  const aggregated = recordOf(page?.['aggregationData'])?.['accountMediaOrders'];
  if ((direct !== undefined && !Array.isArray(direct)) || (aggregated !== undefined && !Array.isArray(aggregated))) return null;
  if (direct === undefined && aggregated === undefined) return null;
  return [...arrayOf(direct), ...arrayOf(aggregated)];
}

/** Fansly's blurred copy of a medium (variant type 3): never what the fan sent. */
const BLURRED_VARIANT = 3;
/** CloudFront's signature, when a location carries it in `metadata` instead of its address. */
const SIGNATURE_KEYS = ['Key-Pair-Id', 'Policy', 'Signature', 'Expires'] as const;

const numberOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A node's first https location, signed, if it fits the CDN's address; null — none. */
function locationOf(node: Record<string, unknown>): string | null {
  for (const entry of arrayOf(node['locations']).map(recordOf)) {
    const raw = entry?.['location'];
    if (typeof raw !== 'string' || !raw.startsWith('https://')) continue;
    try {
      const url = new URL(raw);
      const metadata = recordOf(entry?.['metadata']);
      if (metadata !== null) for (const key of SIGNATURE_KEYS) if (typeof metadata[key] === 'string' && !url.searchParams.has(key)) url.searchParams.set(key, metadata[key]);
      if (FanslyPhotoUrlSchema.safeParse(url.href).success) return url.href;
    } catch {
      // A broken address: the next one.
    }
  }
  return null;
}

/**
 * The still image of a fan's photo to draw (the hub describer's `pickFanslyImageLocation`): the smallest of its resizes
 * and the original that covers `maxEdgePx`, else the largest; never a blurred copy. Null — not a photo, or no address.
 */
export function photoLocationOf(media: unknown): string | null {
  const node = recordOf(media);
  const mime = node?.['mimetype'];
  if (node === null || typeof mime !== 'string' || !mime.startsWith('image/')) return null;
  const candidates = arrayOf(node['variants'])
    .map(recordOf)
    .filter((variant): variant is Record<string, unknown> => variant !== null && typeof variant['mimetype'] === 'string' && variant['mimetype'].startsWith('image/') && Number(variant['type']) !== BLURRED_VARIANT)
    .map((variant) => ({ edge: Math.max(numberOf(variant['width']), numberOf(variant['height'])), url: locationOf(variant) }));
  candidates.push({ edge: Math.max(numberOf(node['width']), numberOf(node['height'])), url: locationOf(node) });
  // Ties go to the resize (listed first), which is never larger in bytes.
  const sorted = candidates.filter((candidate): candidate is { edge: number; url: string } => candidate.url !== null).sort((left, right) => left.edge - right.edge);
  return (sorted.find((candidate) => candidate.edge >= LIVE_IMAGE_LIMITS.maxEdgePx) ?? sorted.at(-1))?.url ?? null;
}

/**
 * The photos of the fan's latest turn on the chat's newest page — the fan's messages after the creator's last one,
 * among the newest `LIVE_IMAGE_LIMITS.windowMessages` — newest first, each medium once, at most `maxImages`; a bundle's
 * photos in its order (a fan's several photos come as one); never a priced medium or bundle. Empty — none, or not this
 * chat's page.
 */
export function latestFanPhotos(response: unknown, chat: PpvChat): LiveImageRef[] {
  const page = recordOf(response);
  if (page === null || !Array.isArray(page['messages'])) return [];
  const media = new Map<string, unknown>();
  for (const item of arrayOf(page['accountMedia'])) {
    const id = idOf(recordOf(item)?.['id']);
    if (id !== null) media.set(id, item);
  }
  const bundles = new Map<string, Record<string, unknown>>();
  for (const item of arrayOf(page['accountMediaBundles']).map(recordOf)) {
    const id = idOf(item?.['id']);
    if (item !== null && id !== null) bundles.set(id, item);
  }
  /** An attachment's media ids: itself, or a bundle's members in its order; none — priced, or not on the page. */
  const membersOf = (attachment: Record<string, unknown> | null): string[] => {
    const id = idOf(attachment?.['contentId']);
    if (id === null) return [];
    if (attachment?.['contentType'] === ATTACHMENT_MEDIA) return [id];
    const bundle = attachment?.['contentType'] === ATTACHMENT_BUNDLE ? bundles.get(id) : undefined;
    if (bundle === undefined || ppvPriceOf(bundle) !== null) return [];
    const listed = arrayOf(bundle['accountMediaIds']).map(idOf);
    const content = arrayOf(bundle['bundleContent'])
      .map(recordOf)
      .sort((left, right) => numberOf(left?.['pos']) - numberOf(right?.['pos']))
      .map((entry) => idOf(entry?.['accountMediaId']));
    return (listed.length > 0 ? listed : content).filter((member): member is string => member !== null);
  };
  const messages = page['messages']
    .map(recordOf)
    .filter((message): message is Record<string, unknown> => message !== null && idOf(message['id']) !== null && message['groupId'] === chat.groupId)
    .sort((left, right) => newestFirst(left['id'] as string, right['id'] as string))
    .slice(0, LIVE_IMAGE_LIMITS.windowMessages);
  const refs: LiveImageRef[] = [];
  for (const message of messages) {
    if (message['senderId'] !== chat.fanId) break;
    const seconds = message['createdAt'];
    if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds <= 0) continue;
    const sentAt = new Date(seconds * 1000).toISOString();
    for (const mediaId of arrayOf(message['attachments']).map(recordOf).flatMap(membersOf)) {
      if (refs.some((ref) => ref.mediaId === mediaId)) continue;
      const item = media.get(mediaId);
      if (item === undefined || ppvPriceOf(item) !== null) continue;
      const url = photoLocationOf(recordOf(item)?.['media']);
      if (url === null) continue;
      refs.push({ platformMessageId: message['id'] as string, sentAt, mediaId, url });
      if (refs.length >= LIVE_IMAGE_LIMITS.maxImages) return refs;
    }
  }
  return refs;
}

/** One paid attachment of a creator's message on the pages read. */
interface Paid {
  readonly messageId: string;
  readonly kind: Kind;
  readonly id: string;
  readonly mills: number | null;
}

interface HistoryPage {
  readonly messageIds: readonly string[];
  readonly paid: readonly Paid[];
  readonly bought: readonly string[];
}

/** A page of this chat's history, read; null — not one (another chat, another shape). */
function readHistoryPage(response: unknown, chat: PpvChat): HistoryPage | null {
  const page = recordOf(response);
  if (page === null || !Array.isArray(page['messages'])) return null;
  const media = new Map<string, unknown>();
  const bundles = new Map<string, unknown>();
  for (const item of arrayOf(page['accountMedia'])) {
    const id = idOf(recordOf(item)?.['id']);
    if (id !== null) media.set(id, item);
  }
  for (const item of arrayOf(page['accountMediaBundles'])) {
    const id = idOf(recordOf(item)?.['id']);
    if (id !== null) bundles.set(id, item);
  }
  const messageIds: string[] = [];
  const paid: Paid[] = [];
  for (const value of page['messages']) {
    const message = recordOf(value);
    const id = idOf(message?.['id']);
    if (message === null || id === null || message['groupId'] !== chat.groupId) return null;
    messageIds.push(id);
    if (message['senderId'] !== chat.creatorId) continue;
    for (const attachment of arrayOf(message['attachments']).map(recordOf)) {
      const contentId = idOf(attachment?.['contentId']);
      if (contentId === null) continue;
      const type = attachment?.['contentType'];
      // 2.13.0: a media or a bundle by its content type; without one, the bundle first.
      const kind: Kind | null =
        type === ATTACHMENT_MEDIA ? 'media' : type === ATTACHMENT_BUNDLE ? 'bundle' : type === undefined ? (bundles.has(contentId) ? 'bundle' : media.has(contentId) ? 'media' : null) : null;
      if (kind === null) continue;
      const price = ppvPriceOf((kind === 'media' ? media : bundles).get(contentId));
      if (price !== null) paid.push({ messageId: id, kind, id: contentId, mills: price.mills });
    }
  }
  const bought = arrayOf(page['accountMediaOrders'])
    .map(orderOf)
    .flatMap((order) => (order === null ? [] : [inlineBought(order, chat.fanId)]))
    .filter((key): key is string => key !== null);
  return { messageIds, paid, bought };
}

const cacheKey = (chat: PpvChat, kind: Kind, id: string): string => `${chat.creatorId}:${chat.fanId}:${kind}:${id}`;

function cached(deps: PpvReadDeps, key: string): boolean | undefined {
  const entry = deps.cache.get(key);
  if (entry === undefined) return undefined;
  if (deps.now() - entry.at < (entry.bought ? PPV_READ.boughtTtlMs : PPV_READ.notBoughtTtlMs)) return entry.bought;
  deps.cache.delete(key);
  return undefined;
}

function remember(deps: PpvReadDeps, key: string, bought: boolean): void {
  deps.cache.delete(key);
  deps.cache.set(key, { bought, at: deps.now() });
  // The oldest go first (a Map keeps its order of insertion).
  for (const old of deps.cache.keys()) {
    if (deps.cache.size <= PPV_READ.cacheMax) break;
    deps.cache.delete(old);
  }
}

/**
 * The open chat's paid attachments with the fan's purchase, as far as Fansly told by the deadline, newest first. A
 * failed first page is an empty answer; a failed check leaves its attachment out.
 */
export async function readPpvState(port: PpvReadPort, chat: PpvChat, deps: PpvReadDeps): Promise<LivePpvAttachmentItem[]> {
  return (await readOpenChat(port, chat, deps, { ppv: true, photos: false })).items;
}

/** What one read of the open chat answers: the PPV state (`ppv`) and the photos of the fan's latest turn (`photos`). */
export interface OpenChatRead {
  readonly items: LivePpvAttachmentItem[];
  readonly photos: LiveImageRef[];
}

/**
 * The PPV state (`readPpvState`) and, from the same newest page, the photos of the fan's latest turn. Without `ppv`
 * only that page is read and no order is asked.
 */
export async function readOpenChat(port: PpvReadPort, chat: PpvChat, deps: PpvReadDeps, want: { readonly ppv: boolean; readonly photos: boolean }): Promise<OpenChatRead> {
  let photos: LiveImageRef[] = [];
  const paid: Paid[] = [];
  const seen = new Set<string>();
  /** `kind:id` → the fan bought it (inline, an order history, the cache). */
  const state = new Map<string, boolean>();
  const queue: Array<{ kind: Kind; id: string }> = [];
  let asked = 0;
  let running = 0;
  const idle: Array<() => void> = [];

  const check = async (kind: Kind, id: string): Promise<void> => {
    const query = { [kind === 'media' ? 'accountMediaId' : 'accountMediaBundleId']: id, accountIds: chat.fanId, limit: '100' };
    try {
      const rows = orderHistoryRows(await port.orders(query));
      if (rows === null) return;
      const bought = rows.some((row) => orderMatches(row, kind, id, chat.fanId));
      remember(deps, cacheKey(chat, kind, id), bought);
      // An inline order seen meanwhile stands.
      if (state.get(`${kind}:${id}`) !== true) state.set(`${kind}:${id}`, bought);
    } catch {
      // Not known: the hub keeps its mark.
    }
  };
  const pump = (): void => {
    while (running < PPV_READ.concurrency && queue.length > 0) {
      const next = queue.shift()!;
      running += 1;
      void check(next.kind, next.id).finally(() => {
        running -= 1;
        pump();
        if (running === 0 && queue.length === 0) for (const resolve of idle.splice(0)) resolve();
      });
    }
  };
  const settled = (): Promise<void> => (running === 0 && queue.length === 0 ? Promise.resolve() : new Promise((resolve) => idle.push(resolve)));

  const work = (async () => {
    let before: string | null = null;
    for (let page = 0; page < (want.ppv ? PPV_READ.pages : 1); page += 1) {
      const query: Record<string, string> = { groupId: chat.groupId, limit: String(PPV_READ.pageSize) };
      if (before !== null) query['before'] = before;
      let read: HistoryPage | null;
      try {
        const response = await port.history(query);
        read = readHistoryPage(response, chat);
        if (page === 0 && want.photos && read !== null) photos = latestFanPhotos(response, chat);
      } catch {
        read = null;
      }
      if (read === null || !want.ppv) break;
      for (const key of read.bought) state.set(key, true);
      const fresh = read.paid
        .filter((item) => !seen.has(`${item.messageId}/${item.kind}:${item.id}`))
        .sort((left, right) => newestFirst(left.messageId, right.messageId));
      for (const item of fresh) {
        seen.add(`${item.messageId}/${item.kind}:${item.id}`);
        paid.push(item);
        const key = `${item.kind}:${item.id}`;
        if (state.has(key)) continue;
        const known = cached(deps, cacheKey(chat, item.kind, item.id));
        if (known !== undefined) {
          state.set(key, known);
          continue;
        }
        if (asked >= PPV_READ.checks || queue.some((queued) => queued.kind === item.kind && queued.id === item.id)) continue;
        asked += 1;
        queue.push({ kind: item.kind, id: item.id });
      }
      // The checks of this page go while the next page loads.
      pump();
      if (read.messageIds.length < PPV_READ.pageSize) break;
      const oldest = [...read.messageIds].sort(newestFirst).at(-1) ?? null;
      if (oldest === null || oldest === before) break;
      before = oldest;
    }
    await settled();
  })();

  await Promise.race([work, deps.wait(PPV_READ.answerMs)]);
  const items: LivePpvAttachmentItem[] = [];
  for (const item of paid) {
    const bought = state.get(`${item.kind}:${item.id}`);
    if (bought === undefined) continue;
    const usd = item.mills === null ? null : item.mills / 1000;
    items.push({
      platformMessageId: item.messageId,
      contentKind: item.kind,
      contentRef: item.id,
      ...(usd !== null && usd > 0 && usd <= PPV_READ.priceMaxUsd ? { priceUsd: usd } : {}),
      purchased: bought,
    });
    if (items.length >= PPV_READ.maxItems) break;
  }
  return { items, photos };
}
