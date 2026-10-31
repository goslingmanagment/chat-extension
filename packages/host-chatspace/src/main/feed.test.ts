// The OnlyFans feed in MAIN (hub #953): what the page received, read into records the contracts take — money with
// its exact amounts and ids, and nothing of ours on the wire: the page's fetch passes every call through as it is,
// only while the latch is on, and is its own again when it goes off.

import { FROM_MAIN } from '@cg/contracts/bridge-messages';
import { OnlyfansFeedRecordSchema } from '@cg/contracts/hub';
import { describe, expect, it, vi } from 'vitest';

import { guardWith } from '@cg/host-kit/main/guard';
import { createFeed, messageRecord, recordsOfRead, socketRecord } from './feed';
import { EVT_FEED, FEED_FLUSH_MS } from './protocol';

const AT = '2026-11-01T10:00:00.000Z';
const valid = (record: unknown): boolean => OnlyfansFeedRecordSchema.safeParse(record).success;

describe('records of what the page received', () => {
  it('a fan message of the socket: its text, price, media and the fan’s own facts', () => {
    const record = messageRecord(
      {
        id: 9001, content: '<p>hey 💕</p>', sentAt: '2026-11-01T09:59:58+00:00', chatId: '2003', is_from_fan: true,
        platformMetadata: {
          price: 0, isFree: true, isOpened: false, isTip: false, mediaCount: 1, isFromQueue: false, changedAt: '2026-11-01T09:59:58+00:00',
          media: [{ id: 51, type: 'photo', canView: true, duration: 0 }],
          fromUser: { id: 2003, name: 'Mike', username: 'u2003', subscribedOn: true, subscribedOnExpiredNow: false },
        },
      },
      null,
      'socket',
      AT,
    );
    expect(record).toMatchObject({ kind: 'message', messageRef: '9001', fanRef: '2003', fromFan: true, textHtml: '<p>hey 💕</p>', media: [{ ref: '51', type: 'photo' }], fan: { name: 'Mike', subscribedOn: true, spend: null } });
    expect(valid(record)).toBe(true);
  });

  it('a purchase and a tip with their exact amounts; a frame without its ids or a positive amount is no record', () => {
    const account = { account_id: '1001' };
    const ppv = socketRecord({ event: 'account_fan_ppv_purchased', account, fan_id: '2003', content_type: 'message', content_id: '9001', price_gross: 12.5 }, AT);
    const tip = socketRecord({ event: 'account_fan_tip_received', account, fan_id: 2003, tip_id: 77, amount_gross: '5' }, AT);
    expect(ppv).toEqual({ kind: 'ppv', fanRef: '2003', contentType: 'message', contentRef: '9001', priceGross: 12.5, observedAt: AT });
    expect(tip).toEqual({ kind: 'tip', fanRef: '2003', tipRef: '77', amountGross: 5, observedAt: AT });
    expect([ppv, tip].every(valid)).toBe(true);
    expect(socketRecord({ event: 'account_fan_tip_received', account, fan_id: '2003', tip_id: 78, amount_gross: 0 }, AT)).toBeNull();
    expect(socketRecord({ event: 'account_fan_ppv_purchased', account, content_type: 'message', content_id: '9001', price_gross: 10 }, AT)).toBeNull();
    expect(socketRecord({ event: 'account_message_deleted', account, message_id: '9002' }, AT)).toEqual({ kind: 'deleted', messageRef: '9002', observedAt: AT });
  });

  it('the four reads: history items, a fans batch with the platform’s sums, chat rows with their last message, ledger rows', () => {
    const history = recordsOfRead('history', '2003', { items: [{ id: '9003', content: 'hi', sent_at: AT, is_from_fan: false, platform_metadata: { price: 25, isFree: false, isOpened: false, mediaCount: 2 } }] }, AT);
    expect(history).toMatchObject([{ kind: 'message', via: 'history', fromFan: false, price: 25, isOpened: false, fan: null }]);
    const fans = recordsOfRead('fans', null, { items: [{ id: 2003, name: 'Mike', subscribedOn: true, subscribedOnData: { subscribeAt: AT, expiredAt: AT, status: 'Set to Expire', price: 3, tipsSumm: 40, messagesSumm: 125.5, totalSumm: 168.5 } }] }, AT);
    expect(fans).toMatchObject([{ kind: 'fan', fanRef: '2003', subscriptionStatus: 'Set to Expire', subscribePrice: 3, spend: { tips: 40, messages: 125.5, total: 168.5, posts: null } }]);
    const chats = recordsOfRead('chats', null, { items: [{ platform_fan_id: '2003', unread_messages_count: 2, last_message: { id: '9004', content: 'u there?', sent_at: AT, platform_metadata: { fromUser: { id: 2003 } } } }] }, AT);
    expect(chats).toMatchObject([{ kind: 'chat', fanRef: '2003', unreadCount: 2, lastMessageRef: '9004' }, { kind: 'message', messageRef: '9004', fromFan: true, via: 'chat_list' }]);
    const ledger = recordsOfRead('ledger', null, { items: [{ id: 'a1b2', created_at: AT, amount_gross: 25, amount_net: 20, description: 'Payment for message from <a href="/u2003">Mike</a>', platform_fan_id: '2003', status: 'undo' }] }, AT);
    expect(ledger).toEqual([{ kind: 'ledger', transactionRef: 'a1b2', fanRef: '2003', createdAt: AT, amountGross: 25, amountNet: 20, description: 'Payment for message from Mike', status: 'undo', observedAt: AT }]);
    expect([...history, ...fans, ...chats, ...ledger].every(valid)).toBe(true);
  });
});

describe('the page’s own fetch, observed', () => {
  function world() {
    const posted: Array<{ t: string; payload: Record<string, unknown> }> = [];
    const calls: unknown[][] = [];
    const answer = { items: [{ id: '9003', content: 'hi', sent_at: AT, is_from_fan: true, platform_metadata: {} }] };
    const native = function (this: unknown, ...args: unknown[]): Promise<Response> {
      calls.push(args);
      return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
    };
    const win = { fetch: native, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: number) => clearTimeout(id) } as unknown as Window & typeof globalThis;
    const feed = createFeed(win, { guard: guardWith(() => undefined), fail: () => undefined });
    feed.connect({ creator: (acc) => (acc === '1001' ? '433999001' : null), post: (t, payload) => posted.push({ t, payload }) });
    return { win, native, feed, posted, calls };
  }

  it('is in place only while the latch is on, passes every call through untouched, and posts what it read for the account', async () => {
    vi.useFakeTimers();
    try {
      const { win, native, feed, posted, calls } = world();
      expect(win.fetch).toBe(native);
      feed.latch(true);
      expect(win.fetch).not.toBe(native);
      const request = new Request('https://onlymonster.ai/api/v0/accounts/1001/chats/2003/messages?limit=10');
      const response = await win.fetch(request);
      // The page gets its own response, its body unread by us.
      expect(calls).toEqual([[request]]);
      expect(await response.json()).toMatchObject({ items: [{ id: '9003' }] });
      await vi.advanceTimersByTimeAsync(FEED_FLUSH_MS);
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({ t: EVT_FEED, payload: { acc: '1001', creator: '433999001', records: [{ kind: 'message', messageRef: '9003', via: 'history' }] } });
      expect(FROM_MAIN.ofFeed.safeParse(posted[0]?.payload).success).toBe(true);
      // A POST, another read, another platform's account: passed through, never read.
      await win.fetch('https://onlymonster.ai/api/v0/accounts/1001/chats/2003/messages', { method: 'POST', body: '{}' });
      await win.fetch('https://onlymonster.ai/api/v0/accounts/1001/notes');
      await vi.advanceTimersByTimeAsync(FEED_FLUSH_MS);
      expect(posted).toHaveLength(1);
      feed.latch(false);
      expect(win.fetch).toBe(native);
    } finally {
      vi.useRealTimers();
    }
  });
});
