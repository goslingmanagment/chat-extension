// Whether the fan bought the open Fansly chat's paid attachments (X54 on Fansly): money — a bought PPV must read
// «purchased», an unbought one «not purchased» only on the fan's own empty order history, and nothing unknown is sent.

import { describe, expect, it } from 'vitest';

import { PPV_READ, latestFanPhotos, readOpenChat, readPpvState, type PpvCache, type PpvReadPort } from '../../../src/services/hosts/fansly/ppv';

const CREATOR = '700000000000000017';
const FAN = '920000000000000003';
const GROUP = '810000000000000053';
const chat = { creatorId: CREATOR, fanId: FAN, groupId: GROUP };

const VIDEO = '770000000000000001';
const BUNDLE = '770000000000000002';
const UNBOUGHT = '770000000000000003';
const FREE = '770000000000000004';

const ppvRow = (price: number) => ({ permissionFlags: [{ flags: 1, price, metadata: '' }] });

/** The chat's newest page: the creator's paid video (bought inline), bundle (price in metadata) and unbought video; a free one; the fan's media. */
function page(): Record<string, unknown> {
  const message = (id: number, senderId: string, contentType: number, contentId: string) => ({ id: String(830000000000000000n + BigInt(id)), groupId: GROUP, senderId, attachments: [{ contentType, contentId }] });
  return {
    messages: [message(5, CREATOR, 1, VIDEO), message(4, CREATOR, 2, BUNDLE), message(3, CREATOR, 1, UNBOUGHT), message(2, CREATOR, 1, FREE), message(1, FAN, 1, '770000000000000009')],
    accountMedia: [
      { id: VIDEO, permissions: ppvRow(20_000) },
      { id: UNBOUGHT, permissions: ppvRow(15_000) },
      { id: FREE, permissions: { permissionFlags: [{ flags: 2, price: 0 }] } },
      { id: '770000000000000009', permissions: ppvRow(5_000) },
    ],
    accountMediaBundles: [{ id: BUNDLE, permissions: { permissionFlags: [{ flags: 1, price: 0, metadata: JSON.stringify({ 1: JSON.stringify({ price: 35_000 }) }) }] } }],
    // The fan's inline order of the video; another fan's of the bundle proves nothing.
    accountMediaOrders: [{ accountId: FAN, accountMediaId: VIDEO, type: 1 }, { accountId: '920000000000000099', accountMediaId: BUNDLE, type: 2 }],
  };
}

function port(orders: (query: Readonly<Record<string, string>>) => Promise<unknown>, calls: string[] = []): PpvReadPort {
  return {
    history: (query) => {
      calls.push(`history ${query['before'] ?? 'fresh'}`);
      return Promise.resolve(page());
    },
    orders: (query) => {
      calls.push(`orders ${query['accountMediaId'] ?? `bundle ${query['accountMediaBundleId']}`} ${query['accountIds']}`);
      return orders(query);
    },
  };
}

const deps = (cache: PpvCache = new Map(), wait: (ms: number) => Promise<void> = () => new Promise(() => undefined)) => ({ now: () => 1_000_000, cache, wait });
/** Fansly's answer: the fan's order of the bundle exists only when asked to (`boughtBundle`). */
const history = (boughtBundle: boolean) => (query: Readonly<Record<string, string>>) =>
  Promise.resolve({ accountMediaOrderHistory: boughtBundle && query['accountMediaBundleId'] === BUNDLE ? [{ accountId: FAN, accountMediaBundleId: BUNDLE, type: 2 }] : [] });

describe('readPpvState', () => {
  it('bought inline, bought and not bought by the order history; the free and the fan\'s media are not asked', async () => {
    const calls: string[] = [];
    const items = await readPpvState(port(history(true), calls), chat, deps());
    expect(items).toEqual([
      { platformMessageId: '830000000000000005', contentKind: 'media', contentRef: VIDEO, priceUsd: 20, purchased: true },
      { platformMessageId: '830000000000000004', contentKind: 'bundle', contentRef: BUNDLE, priceUsd: 35, purchased: true },
      { platformMessageId: '830000000000000003', contentKind: 'media', contentRef: UNBOUGHT, priceUsd: 15, purchased: false },
    ]);
    // A short page is the start of the chat: one page; only the two attachments no inline order resolved are asked.
    expect(calls).toEqual(['history fresh', `orders bundle ${BUNDLE} ${FAN}`, `orders ${UNBOUGHT} ${FAN}`]);
  });

  it('a check that fails or does not answer in time is left out: the hub keeps its mark', async () => {
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => (release = resolve));
    const items = await readPpvState(
      port((query) => (query['accountMediaBundleId'] === BUNDLE ? Promise.reject(new Error('503')) : new Promise(() => undefined))),
      chat,
      deps(new Map(), (ms) => (ms === PPV_READ.answerMs ? (release(), late) : late)),
    );
    expect(items).toEqual([{ platformMessageId: '830000000000000005', contentKind: 'media', contentRef: VIDEO, priceUsd: 20, purchased: true }]);
  });

  it('an answer is kept for the next click: «not bought» briefly, then asked again', async () => {
    const cache: PpvCache = new Map();
    await readPpvState(port(history(false)), chat, deps(cache));
    const calls: string[] = [];
    const again = await readPpvState(port(history(true), calls), chat, deps(cache));
    expect(calls).toEqual(['history fresh']);
    expect(again.find((item) => item.contentRef === BUNDLE)?.purchased).toBe(false);
    const later = await readPpvState(port(history(true)), chat, { ...deps(cache), now: () => 1_000_000 + PPV_READ.notBoughtTtlMs });
    expect(later.find((item) => item.contentRef === BUNDLE)?.purchased).toBe(true);
  });

  it('a page of another chat, or a history that fails, tells nothing', async () => {
    const stranger: PpvReadPort = { history: () => Promise.resolve({ ...page(), messages: [{ id: '830000000000000001', groupId: '810000000000000099', senderId: CREATOR, attachments: [] }] }), orders: history(true) };
    expect(await readPpvState(stranger, chat, deps())).toEqual([]);
    expect(await readPpvState({ history: () => Promise.reject(new Error('429')), orders: history(true) }, chat, deps())).toEqual([]);
  });
});

describe('the photos of the fan\'s latest turn', () => {
  const cdn = (name: string, signed = true) => `https://cdn3.fansly.com/${FAN}/${name}.jpeg?ngsw-bypass=true${signed ? '&Policy=P&Key-Pair-Id=K&Signature=S' : ''}`;
  /** A fan's photo: a 2048 original, its 1080 and 720 resizes and a blurred copy. */
  const photo = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    ...extra,
    media: {
      mimetype: 'image/jpeg',
      width: 2048,
      height: 1536,
      locations: [{ location: cdn(`${id}-original`) }],
      variants: [
        { type: 1, mimetype: 'image/jpeg', width: 720, height: 540, locations: [{ location: cdn(`${id}-720`) }] },
        { type: 3, mimetype: 'image/jpeg', width: 1080, height: 810, locations: [{ location: cdn(`${id}-blur`) }] },
        // The signature in `metadata`, as an avatar's may carry it.
        { type: 1, mimetype: 'image/jpeg', width: 1080, height: 810, locations: [{ location: cdn(`${id}-1080`, false), metadata: { Policy: 'P', 'Key-Pair-Id': 'K', Signature: 'S' } }] },
      ],
    },
  });
  const message = (n: number, senderId: string, ...contentIds: string[]) => ({
    id: String(830000000000000000n + BigInt(n)),
    groupId: GROUP,
    senderId,
    createdAt: 1_790_000_000 + n,
    attachments: contentIds.map((contentId) => ({ contentType: 1, contentId })),
  });
  const A = '770000000000000101';
  const B = '770000000000000102';
  const OLD = '770000000000000103';
  const PRICED = '770000000000000104';
  const VIDEO_FAN = '770000000000000105';
  const fanPage = () => ({
    // Fansly's order: newest first. The fan's two messages after the creator's last one; an older photo before it.
    messages: [message(9, FAN, A, PRICED), message(8, FAN), message(7, FAN, B, A), message(6, CREATOR), message(5, FAN, OLD)],
    accountMedia: [
      photo(A),
      photo(B),
      photo(OLD),
      photo(PRICED, { permissions: ppvRow(5_000) }),
      { id: VIDEO_FAN, media: { mimetype: 'video/mp4', width: 1920, height: 1080, locations: [{ location: cdn('video') }] } },
    ],
  });

  it('only after the creator\'s last message, newest first, each once, the resize that covers 1024 px, never a priced one', () => {
    expect(latestFanPhotos(fanPage(), chat)).toEqual([
      { platformMessageId: '830000000000000009', sentAt: new Date((1_790_000_000 + 9) * 1000).toISOString(), mediaId: A, url: `https://cdn3.fansly.com/${FAN}/${A}-1080.jpeg?ngsw-bypass=true&Key-Pair-Id=K&Policy=P&Signature=S` },
      { platformMessageId: '830000000000000007', sentAt: new Date((1_790_000_000 + 7) * 1000).toISOString(), mediaId: B, url: `https://cdn3.fansly.com/${FAN}/${B}-1080.jpeg?ngsw-bypass=true&Key-Pair-Id=K&Policy=P&Signature=S` },
    ]);
  });

  it('none when the creator wrote last, for a video, or off Fansly\'s CDN', () => {
    expect(latestFanPhotos({ ...fanPage(), messages: [message(10, CREATOR), ...fanPage().messages] }, chat)).toEqual([]);
    expect(latestFanPhotos({ ...fanPage(), messages: [message(10, FAN, VIDEO_FAN)] }, chat)).toEqual([]);
    const elsewhere = { id: A, media: { mimetype: 'image/jpeg', width: 800, height: 600, locations: [{ location: 'https://evil.example/a.jpeg' }] } };
    expect(latestFanPhotos({ messages: [message(10, FAN, A)], accountMedia: [elsewhere] }, chat)).toEqual([]);
  });

  it('a bundle of the fan\'s photos gives its members in its order; a priced bundle gives none', () => {
    const bundle = (id: string, members: readonly string[], extra: Record<string, unknown> = {}) => ({ id, ...extra, bundleContent: members.map((accountMediaId, pos) => ({ pos, accountMediaId })).reverse() });
    const withBundle = (contentId: string) => ({
      messages: [{ ...message(10, FAN), attachments: [{ contentType: 2, contentId }] }],
      accountMedia: [photo(A), photo(B)],
      accountMediaBundles: [bundle('770000000000000201', [B, A]), bundle('770000000000000202', [A, B], { permissions: ppvRow(9_000) })],
    });
    expect(latestFanPhotos(withBundle('770000000000000201'), chat).map((ref) => ref.mediaId)).toEqual([B, A]);
    expect(latestFanPhotos(withBundle('770000000000000202'), chat)).toEqual([]);
  });

  it('a start without the PPV state reads one page and asks no order', async () => {
    const calls: string[] = [];
    const read = await readOpenChat(
      { history: (query) => (calls.push(`history ${query['before'] ?? 'fresh'}`), Promise.resolve({ ...fanPage(), messages: [...fanPage().messages, ...page()['messages'] as unknown[]] })), orders: () => (calls.push('orders'), Promise.resolve({})) },
      chat,
      deps(),
      { ppv: false, photos: true },
    );
    expect(calls).toEqual(['history fresh']);
    expect(read.items).toEqual([]);
    expect(read.photos.map((ref) => ref.mediaId)).toEqual([A, B]);
  });
});
