// The open chat as ChatSpace has it loaded, in the shape of our API read's page: the PPV state, the queue's mark and
// the photos of the newest messages, newest first, each message once.

import { OpenChatPageSchema } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { cachedOpenPage } from './cached-page';

const NOW = () => new Date('2026-10-22T15:00:00.000Z');
const PHOTO = 'https://pw365.ompcdn.com/files/photo-1.jpg';
const cached = (id: string, at: string, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  id,
  createdAt: at,
  isOutgoing: true,
  text: '<p>for <b>you</b></p>',
  platformMetadata: { price: 0, isFree: true, isOpened: false, mediaCount: 0, mediaItems: [], isTip: false, isFromQueue: false, ...meta },
  ...over,
});

describe('cachedOpenPage — the open chat from ChatSpace’s own cache', () => {
  it('newest first across pages, each id once, with the PPV state, the queue’s mark and the newest photos', () => {
    const value = {
      pages: [
        {
          items: [
            cached('9003', '2026-10-22T14:03:00Z', { isOutgoing: false, text: 'look' }, { mediaItems: [{ id: 701, type: 'photo', imageUrl: PHOTO }, { id: 702, type: 'video', imageUrl: PHOTO }, { id: 703, type: 'photo', imageUrl: 'https://elsewhere.test/p.jpg' }] }),
            cached('9002', '2026-10-22T14:02:00Z', {}, { price: '25', isFree: false, isOpened: true, mediaCount: 2, isFromQueue: true }),
          ],
          hasMore: true,
        },
        { items: [cached('9001', '2026-10-22T14:01:00Z', {}, { price: 15, isFree: false, isOpened: false }), cached('9002', '2026-10-22T14:02:00Z')], hasMore: false },
      ],
    };
    const page = OpenChatPageSchema.parse(cachedOpenPage(value, 50, NOW));
    expect(page.items.map((item) => item.platformMessageId)).toEqual(['9003', '9002', '9001']);
    expect(page.items[0]).toMatchObject({ direction: 'fan', text: 'look', photos: [{ mediaId: '701', url: PHOTO }] });
    expect(page.items[1]).toMatchObject({ direction: 'model', text: 'for you', price: 25, isFree: false, isOpened: true, mediaCount: 2, automatic: true });
    expect(page.items[2]).toMatchObject({ price: 15, isOpened: false, automatic: false });
    expect(page).toMatchObject({ capturedAt: '2026-10-22T15:00:00.000Z', hasMore: false, cursor: '9001' });
  });

  it('the newest `limit`, more left; nothing loaded — null', () => {
    const value = { pages: [{ items: [cached('9001', '2026-10-22T14:01:00Z'), cached('9002', '2026-10-22T14:02:00Z')], hasMore: false }] };
    expect(cachedOpenPage(value, 1, NOW)).toMatchObject({ items: [{ platformMessageId: '9002' }], hasMore: true, cursor: '9002' });
    expect(cachedOpenPage(undefined, 10, NOW)).toBeNull();
    expect(cachedOpenPage({ pages: [] }, 10, NOW)).toBeNull();
  });
});
