// The media picker's reads in MAIN (decision X53): which request each kind
// makes — never a chat's history —, the account the page has not loaded
// refused before any request, and the answers cut to the contract's shapes.

import { MediaAnswerSchema } from '@cg/contracts/media';
import { describe, expect, it } from 'vitest';

import { mediaRead } from './media';
import { type OmApi } from './om-api';

const PACC = '830000101';

function fakeOm(body: unknown) {
  const calls: Array<{ path: string; init?: unknown }> = [];
  const om = {
    omRequest: (path: string, init?: unknown) => {
      calls.push(init === undefined ? { path } : { path, init });
      return Promise.resolve({ ok: true as const, body });
    },
    openChatMessages: () => Promise.reject(new Error('not a media read')),
  } as unknown as OmApi;
  return { om, calls };
}

const thumb = 'https://pw365.ompcdn.com/cdn/v1/of/m/thumbs/300x300_a.jpg?exp=1&sig=2';

describe('[X53] MAIN media reads', () => {
  it('an account the page has not loaded is refused before any request', async () => {
    const { om, calls } = fakeOm({});
    expect(await mediaRead(om, null, { of: 'folders', acc: '1001', offset: 0 })).toEqual({ ok: false, failure: 'account', status: null });
    expect(calls).toEqual([]);
  });

  it('asks the vault by the OnlyFans id, the fan statuses by fan, the release forms by POST — never a chat’s messages', async () => {
    const { om, calls } = fakeOm({ items: [] });
    await mediaRead(om, PACC, { of: 'folders', acc: '1001', offset: 10 });
    await mediaRead(om, PACC, { of: 'items', acc: '1001', folder: 'all', offset: 40 });
    await mediaRead(om, PACC, { of: 'states', acc: '1001', fan: '2002', ids: ['11', '12'] });
    await mediaRead(om, PACC, { of: 'tags', acc: '1001', ids: ['11', '12'] });
    expect(calls).toEqual([
      { path: `platforms/onlyfans/accounts/${PACC}/vault/folders?offset=10&limit=10` },
      { path: `platforms/onlyfans/accounts/${PACC}/vault/folders/all/medias?offset=40&limit=40` },
      { path: `platforms/onlyfans/accounts/${PACC}/fans/2002/medias/stats?media_ids=11&media_ids=12` },
      { path: 'accounts/1001/platforms/onlyfans/vault/media/release-forms', init: { method: 'POST', json: { media_ids: [11, 12] } } },
    ]);
    expect(calls.some((call) => /\/chats\//.test(call.path))).toBe(false);
  });

  it('cuts the answers to the contract: folders, media (no `has_more` — a full page may have more), statuses, tags', async () => {
    const folders = await mediaRead(
      fakeOm({
        items: [
          { id: '880001', type: 'messages', name: 'Messages', videos_count: 1067, photos_count: 6215, gifs_count: 0, audios_count: 2, preview_urls: ['https://x/y.jpg'] },
          { id: '880002', type: 'custom', name: 'Red &amp; black', videos_count: 0, photos_count: 14, gifs_count: 1, audios_count: 0 },
          { id: 'bad', type: 'custom', name: 'x' },
        ],
        has_more: true,
      }).om,
      PACC,
      { of: 'folders', acc: '1001', offset: 0 },
    );
    expect(folders).toEqual({
      ok: true,
      value: {
        items: [
          { id: '880001', name: 'Messages', kind: 'messages', photos: 6215, videos: 1067, other: 2 },
          { id: '880002', name: 'Red & black', kind: 'custom', photos: 14, videos: 0, other: 1 },
        ],
        hasMore: true,
      },
    });
    expect(MediaAnswerSchema.safeParse(folders).success).toBe(true);

    const raw = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: 'photo', can_view: true, has_error: false, is_ready: true, duration: 0, thumbnail_url: thumb, created_at: '2026-10-03T22:32:31+00:00', ...extra });
    const items = await mediaRead(
      fakeOm({ items: [raw('1'), raw('2', { type: 'video', duration: 75.4, thumbnail_url: 'http://insecure/x.jpg' }), raw('3', { is_ready: false }), raw('4', { type: 'document' })] }).om,
      PACC,
      { of: 'items', acc: '1001', folder: 'all', offset: 0 },
    );
    expect(items).toEqual({
      ok: true,
      value: {
        items: [
          { id: '1', type: 'photo', duration: 0, ready: true, thumb, createdAt: '2026-10-03T22:32:31.000Z' },
          { id: '2', type: 'video', duration: 75, ready: true, thumb: null, createdAt: '2026-10-03T22:32:31.000Z' },
          { id: '3', type: 'photo', duration: 0, ready: false, thumb, createdAt: '2026-10-03T22:32:31.000Z' },
        ],
        hasMore: false,
      },
    });
    expect(MediaAnswerSchema.safeParse(items).success).toBe(true);
    const full = await mediaRead(fakeOm({ items: Array.from({ length: 40 }, (_, i) => raw(String(i + 1))) }).om, PACC, { of: 'items', acc: '1001', folder: 'all', offset: 0 });
    expect((full as { value: { hasMore: boolean } }).value.hasMore).toBe(true);

    const states = await mediaRead(
      fakeOm({
        items: [
          { media_id: '1', message_id: '9', price: 15, sent_at: 'x', purchased_at: '2026-10-03T22:32:32.612Z' },
          { media_id: '2', message_id: '9', price: '24.99', sent_at: 'x', purchased_at: null },
          { media_id: '3', message_id: '9', price: null, sent_at: 'x', purchased_at: null },
          // The same medium in two more messages: one state per medium, the strongest.
          { media_id: '1', message_id: '8', price: null, sent_at: 'x', purchased_at: null },
          { media_id: '3', message_id: '7', price: 10, sent_at: 'x', purchased_at: null },
        ],
      }).om,
      PACC,
      { of: 'states', acc: '1001', fan: '2002', ids: ['1', '2', '3'] },
    );
    expect(states).toEqual({
      ok: true,
      value: [
        { id: '1', state: 'paid', priceCents: 1500 },
        { id: '2', state: 'unpaid', priceCents: 2499 },
        { id: '3', state: 'unpaid', priceCents: 1000 },
      ],
    });
    expect(MediaAnswerSchema.safeParse(states).success).toBe(true);

    const tags = await mediaRead(
      fakeOm({ items: [{ type: 'user', user: { id: 77, name: 'A' } }, { type: 'guest', id: '91', name: 'B' }, { type: 'other', id: '5' }, { type: 'user', user: { id: 77, name: 'A' } }] }).om,
      PACC,
      { of: 'tags', acc: '1001', ids: ['1'] },
    );
    expect(tags).toEqual({ ok: true, value: { users: ['77'], guests: ['91'] } });
  });

  it('a failed request is the answer, as the shared client gives it', async () => {
    const om = { omRequest: () => Promise.resolve({ ok: false, failure: 'http', status: 400 }) } as unknown as OmApi;
    expect(await mediaRead(om, PACC, { of: 'folders', acc: '1001', offset: 0 })).toEqual({ ok: false, failure: 'http', status: 400 });
  });

  it('asks the shared client with no route check — the picker reads no chat —, and a route refusal it could still give is an invalid answer', async () => {
    const asked: unknown[][] = [];
    const om = {
      omRequest: (...args: unknown[]) => {
        asked.push(args);
        return Promise.resolve('identity-mismatch');
      },
    } as unknown as OmApi;
    expect(await mediaRead(om, PACC, { of: 'folders', acc: '1001', offset: 0 })).toEqual({ ok: false, failure: 'invalid', status: null });
    expect(asked).toEqual([[`platforms/onlyfans/accounts/${PACC}/vault/folders?offset=0&limit=10`, undefined]]);
  });
});
