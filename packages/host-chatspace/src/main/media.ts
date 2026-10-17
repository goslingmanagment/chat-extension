// The vault reads of a preview's media picker (decision X53; contracts
// TO_MAIN.media): the folders, one folder's media, what one fan got of them,
// and the release-form tags of the picks — from ChatSpace's own API with the
// page's own session (om-api.ts), the requests its own vault dialog makes.
// The vault is addressed by the account's OnlyFans id, which only the page's
// loaded `accounts` names: an account it has not loaded is refused before
// any request. None of these is a chat's history: an unread chat stays
// unread (checked live, X53). Answers are cut to the contract's shapes; the
// isolated side checks them with its schemas.

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';
import { type OmApi } from './om-api';
import { iso, plain } from './page';
import { MEDIA_FOLDERS_PAGE, MEDIA_ITEMS_PAGE } from './protocol';

const TYPES = ['photo', 'video', 'gif', 'audio'];
/** A medium's states for a fan, strongest first (`none` — not seen yet). */
const STATES = ['paid', 'unpaid', 'free', 'none'];
const KINDS = ['messages', 'posts', 'custom'];

const items = (body: unknown): unknown[] => (isPlain(body) && Array.isArray(body['items']) ? body['items'] : []);
/** A count or seconds as a whole number; anything else — 0. */
const num = (value: unknown): number => (typeof value === 'number' && value >= 0 && value < 1e9 ? Math.round(value) : 0);
/** A price in USD as cents; null — none. */
const cents = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return amount >= 0 && amount <= 100_000 ? Math.round(amount * 100) : null;
};

const folder = (raw: Plain): Plain | null => {
  const id = idOf(raw['id']);
  return id === null
    ? null
    : {
        id,
        name: plain(raw['name']).slice(0, 200),
        kind: KINDS.includes(raw['type'] as string) ? raw['type'] : 'other',
        photos: num(raw['photos_count']),
        videos: num(raw['videos_count']),
        other: num(raw['gifs_count']) + num(raw['audios_count']),
      };
};

const medium = (raw: Plain): Plain | null => {
  const id = idOf(raw['id']);
  const thumb = raw['thumbnail_url'];
  return id === null || !TYPES.includes(raw['type'] as string)
    ? null
    : {
        id,
        type: raw['type'],
        duration: num(raw['duration']),
        ready: raw['is_ready'] === true && raw['can_view'] !== false && raw['has_error'] !== true,
        thumb: typeof thumb === 'string' && thumb.length <= 4096 && /^https:\/\/[^\s"'<>]+$/.test(thumb) ? thumb : null,
        createdAt: iso(raw['created_at']),
      };
};

const state = (raw: Plain): Plain | null => {
  const id = idOf(raw['media_id']);
  const price = cents(raw['price']);
  return id === null ? null : { id, state: raw['purchased_at'] ? 'paid' : price ? 'unpaid' : 'free', priceCents: price || null };
};

const cut = (body: unknown, map: (raw: Plain) => Plain | null): Plain[] => {
  const out: Plain[] = [];
  for (const raw of items(body)) {
    const item = isPlain(raw) ? map(raw) : null;
    if (item) out.push(item);
  }
  return out;
};

/** One read of the media picker; `pacc` — the account's OnlyFans id as the page's `accounts` has it (null — not loaded). */
export async function mediaRead(om: OmApi, pacc: string | null, payload: Plain): Promise<Plain> {
  if (pacc === null) return { ok: false, failure: 'account', status: null };
  const { of, acc, fan, folder: inFolder, offset } = payload as { of: string; acc: string; fan?: string; folder?: string; offset?: number };
  const ids = (payload['ids'] ?? []) as string[];
  const vault = `platforms/onlyfans/accounts/${pacc}/`;
  const answer = await om.omRequest(
    of === 'folders'
      ? `${vault}vault/folders?offset=${offset ?? 0}&limit=${MEDIA_FOLDERS_PAGE}`
      : of === 'items'
        ? `${vault}vault/folders/${inFolder ?? ''}/medias?offset=${offset ?? 0}&limit=${MEDIA_ITEMS_PAGE}`
        : of === 'states'
          ? `${vault}fans/${fan ?? ''}/medias/stats?${ids.map((id) => `media_ids=${id}`).join('&')}`
          : `accounts/${acc}/platforms/onlyfans/vault/media/release-forms`,
    of === 'tags' ? { method: 'POST', json: { media_ids: ids.map(Number) } } : undefined,
  );
  if (!answer.ok) return answer;
  const body = answer.body;
  if (of === 'folders' || of === 'items') {
    const page = cut(body, of === 'folders' ? folder : medium);
    const size = of === 'folders' ? MEDIA_FOLDERS_PAGE : MEDIA_ITEMS_PAGE;
    // The media answer has no `has_more`: a full page says there may be more, as ChatSpace reads it.
    return { ok: true, value: { items: page.slice(0, size), hasMore: isPlain(body) && typeof body['has_more'] === 'boolean' ? body['has_more'] : items(body).length >= size } };
  }
  if (of === 'states') {
    // One row per message a medium went in: one state per medium, the strongest (bought, sent priced, sent free).
    const byId = new Map<unknown, Plain>();
    for (const row of cut(body, state)) if (STATES.indexOf(row['state'] as string) < STATES.indexOf((byId.get(row['id'])?.['state'] as string) ?? 'none')) byId.set(row['id'], row);
    return { ok: true, value: [...byId.values()] };
  }
  const users = new Set<string>();
  const guests = new Set<string>();
  for (const raw of items(body)) {
    if (!isPlain(raw)) continue;
    // ChatSpace tags only these two kinds of form (its `Mk`); a creator of two picks is tagged once.
    const id = idOf(raw['type'] === 'guest' ? raw['id'] : raw['type'] === 'user' && isPlain(raw['user']) ? raw['user']['id'] : null);
    if (id !== null) (raw['type'] === 'guest' ? guests : users).add(id);
  }
  return { ok: true, value: { users: [...users], guests: [...guests] } };
}
