// Our own read of the open chat from OnlyMonster's API (decision X54; contracts
// TO_MAIN.openChatMessages): the one request MAIN makes, made the way
// ChatSpace makes its own — the page's `fetch`, its Clerk session token as the
// bearer, the API address the page itself requests. The address comes from the
// page's own requests (its resource timing): ChatSpace's API lives on another
// host than the page, and MAIN names no origin. The runtime refuses any chat
// but the one on the route before this file runs: loading a chat's history
// marks it read on OnlyFans (facts.md). Whether a fan read our newest message
// (`chatReadState`) is the one exception, for any chat: OnlyFans says it only
// in a history, so the chat list is asked first, and the history's newest
// message is read only when the list says it is ours and nothing in the chat
// is unread — then every fan message is read already and the read marks
// nothing new. Nothing is written, retried or kept; the isolated side checks
// the answer with its schema.

import { count, idOf, isPlain, type Plain } from '@cg/host-kit/main/check';
import { ERR_IDENTITY } from '@cg/host-kit/main/protocol';
import { iso, plain, utf8Bytes } from './page';
import { API_ACCOUNTS_PATH, API_PATH, CHAT_READ_HISTORY_LIMIT, CHAT_READ_SEARCH_LIMIT, FRAME_DATA_BUDGET, LIVE_IMAGE_PER_MESSAGE, LIVE_IMAGE_URL_MAX, LIVE_IMAGE_WINDOW, OPEN_CHAT_PRICE_MAX, OPEN_CHAT_REQUEST_MS, PHOTO_URL } from './protocol';

type PageWindow = Window & { readonly Clerk?: { readonly session?: { readonly getToken?: () => unknown } | null } };

const fail = (failure: string, status: number | null = null): Plain & { readonly ok: false } => ({ ok: false, failure, status });
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
/** A listed price in USD (a number or its text); anything else — none. */
const price = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return amount > 0 && amount <= OPEN_CHAT_PRICE_MAX ? amount : null;
};

/** A rendition's address: the string itself or its `{url}`. */
const fileUrl = (value: unknown): string | null => (typeof value === 'string' ? value : isPlain(value) && typeof value['url'] === 'string' ? value['url'] : null);

/**
 * A photo's address on OnlyMonster's media proxy, the mid-size rendition first, as the hub picks one for its describer
 * (`selectOfapiMediaVariantUrls`): preview, then the full file, then the thumb. null — none the page can read.
 */
const photoUrl = (media: Plain): string | null => {
  const files = isPlain(media['files']) ? media['files'] : {};
  const candidates = [files['preview'], media['preview'], files['full'], media['full'], media['src'], files['thumb'], files['squarePreview'], media['thumb']];
  for (const candidate of candidates) {
    const url = fileUrl(candidate);
    if (url !== null && url.length <= LIVE_IMAGE_URL_MAX && PHOTO_URL.test(url)) return url;
  }
  return null;
};

/** The photos of a message the viewer may see (`canView`), as contracts HostPhoto; empty — none. */
const photosOf = (meta: Plain): Plain[] => {
  const photos: Plain[] = [];
  for (const media of Array.isArray(meta['media']) ? meta['media'] : []) {
    if (photos.length >= LIVE_IMAGE_PER_MESSAGE) break;
    if (!isPlain(media) || media['type'] !== 'photo' || media['canView'] === false) continue;
    const mediaId = idOf(media['id']);
    const url = photoUrl(media);
    if (mediaId !== null && url !== null) photos.push({ mediaId, url });
  }
  return photos;
};

/**
 * One raw message (`{id, content, sent_at, is_from_fan, platform_metadata}`) as contracts OpenChatMessage; null —
 * unreadable. `withPhotos` — the page's newest messages name their photos (`LIVE_IMAGE_WINDOW`).
 */
const message = (raw: unknown, withPhotos = false): Plain | null => {
  const id = isPlain(raw) ? idOf(raw['id']) : null;
  const at = id === null ? null : iso((raw as Plain)['sent_at']);
  const fromFan = (raw as Plain | null)?.['is_from_fan'];
  if (at === null || typeof fromFan !== 'boolean') return null;
  const meta = isPlain((raw as Plain)['platform_metadata']) ? ((raw as Plain)['platform_metadata'] as Plain) : {};
  const media = meta['mediaCount'];
  const photos = withPhotos ? photosOf(meta) : [];
  return {
    platformMessageId: id,
    direction: fromFan ? 'fan' : 'model',
    sentAt: at,
    text: plain((raw as Plain)['content']),
    price: price(meta['price']),
    isFree: flag(meta['isFree']),
    isOpened: flag(meta['isOpened']),
    mediaCount: count(media) ? media : Array.isArray(meta['media']) ? meta['media'].length : 0,
    tip: meta['isTip'] === true,
    automatic: meta['isFromQueue'] === true,
    ...(photos.length > 0 ? { photos } : {}),
  };
};

/** OnlyFans' `isNew` of a raw message: false once its reader opened it; null — not said. */
const isNewOf = (raw: unknown): boolean | null => {
  const meta = isPlain(raw) && isPlain(raw['platform_metadata']) ? raw['platform_metadata'] : null;
  return typeof meta?.['isNew'] === 'boolean' ? meta['isNew'] : null;
};

/** The id of a raw message's sender (`platform_metadata.fromUser.id`); null — not said. */
const senderOf = (raw: unknown): string | null => {
  const meta = isPlain(raw) && isPlain(raw['platform_metadata']) ? raw['platform_metadata'] : null;
  const sender = meta?.['fromUser'];
  return isPlain(sender) ? idOf(sender['id']) : null;
};

/** A history's message as contracts ChatReadState (on the model's, whether the fan has seen it); null — unreadable. */
const historyMessage = (raw: unknown): Plain | null => {
  const id = isPlain(raw) ? idOf(raw['id']) : null;
  const fromFan = (raw as Plain | null)?.['is_from_fan'];
  if (id === null || typeof fromFan !== 'boolean') return null;
  const isNew = isNewOf(raw);
  return { messageId: id, direction: fromFan ? 'fan' : 'model', sentAt: iso((raw as Plain)['sent_at']), read: !fromFan && isNew !== null ? !isNew : null, readAt: null };
};

/** Whether message id `a` is newer than `b` (OnlyFans' ids grow); null — not numeric ids. */
const newer = (a: string, b: string): boolean | null => (/^\d{1,30}$/.test(a) && /^\d{1,30}$/.test(b) ? BigInt(a) > BigInt(b) : null);

/**
 * The fan's chat of a chat list's answer (`{items: [{platform_fan_id, unread_messages_count, last_message,
 * platform_metadata}]}`, the chats a username search found): its last message — the list's carries no `isNew` and no
 * `is_from_fan`; the sender is `fromUser` —, and whether the history may be read for it: the last message is the
 * account's own (`fromUser` is the creator `creator`) and nothing in the chat is unread (no unread message, no unread
 * tip). Matched by the exact fan id only; anything missing forbids the read.
 */
export const listedOf = (body: unknown, fan: string, creator: string | null): { readonly last: Plain | null; readonly mayRead: boolean } | Failed => {
  const items = isPlain(body) ? body['items'] : null;
  if (!Array.isArray(items)) return fail('invalid');
  const chat = items.find((item): item is Plain => isPlain(item) && idOf(item['platform_fan_id']) === fan);
  const raw = chat?.['last_message'];
  const id = isPlain(raw) ? idOf(raw['id']) : null;
  const from = senderOf(raw);
  if (chat === undefined || id === null || from === null) return { last: null, mayRead: false };
  const direction = from === fan ? 'fan' : from === creator ? 'model' : null;
  if (direction === null) return { last: null, mayRead: false };
  const meta = isPlain(chat['platform_metadata']) ? chat['platform_metadata'] : {};
  const last = { messageId: id, direction, sentAt: iso((raw as Plain)['sent_at']), read: null, readAt: null };
  return { last, mayRead: direction === 'model' && chat['unread_messages_count'] === 0 && meta['hasUnreadTips'] !== true };
};

/**
 * A history's answer (`{items: [message]}`, newest first, as it stood before the read) after a list that named our
 * message `listed` as the chat's last, as contracts ChatReadAnswer:
 * - a fan message newer than it, still unread (`isNew: true`): it came between the two reads, and the history read has
 *   marked it read on OnlyFans — `raced`;
 * - a fan message newer than it, read already: someone opened the chat meanwhile — that message, no read state;
 * - else our newest message, and whether the fan has seen it: OnlyFans' `isNew` turns false once the fan opened it
 *   (ChatSpace's own «прочитано», composables:89277).
 * Our message gone from the history (deleted): `last` null.
 */
export const readStateOf = (body: unknown, listed: Plain): Plain => {
  const items = isPlain(body) ? body['items'] : null;
  if (!Array.isArray(items)) return fail('invalid');
  const ours = listed['messageId'] as string;
  let fanNewer: Plain | null = null;
  let raced = false;
  let model: Plain | null = null;
  for (const raw of items) {
    const message = historyMessage(raw);
    if (message === null) continue;
    const id = message['messageId'] as string;
    const after = id === ours ? false : newer(id, ours);
    if (after !== true) {
      if (id === ours) model ??= message;
      break;
    }
    if (message['direction'] === 'fan') {
      fanNewer ??= message;
      if (isNewOf(raw) === true) raced = true;
    } else model ??= message;
  }
  if (raced) return { ok: true, last: fanNewer, raced: true };
  return { ok: true, last: fanNewer ?? model };
};

type Timer = (callback: () => void, ms: number) => unknown;
/** A refusal shaped as contracts OpenChatAnswer's failure: `{ok: false, failure, status}`. */
type Failed = Plain & { readonly ok: false };

export type OmApi = ReturnType<typeof createOmApi>;

/** Our requests to ChatSpace's API in one document. */
export function createOmApi(win: Window, setTimer: Timer) {
  /**
   * `<origin>/api/v0/` of the page's first request to its accounts (`/api/v0/accounts…`, what ChatSpace asks first),
   * once seen; the page's API host is not the page's own. Only that path names it: the session token goes nowhere else.
   */
  let base: string | null = null;
  const apiBase = (): string | null => {
    if (base === null) {
      for (const entry of win.performance.getEntriesByType('resource')) {
        const at = entry.name.indexOf(API_ACCOUNTS_PATH);
        if (at > 0 && /^https?:\/\/[^/]+$/.test(entry.name.slice(0, at))) return (base = entry.name.slice(0, at + API_PATH.length));
      }
    }
    return base;
  };

  /**
   * A request to ChatSpace's API at `path` (under `…/api/v0/`) with the page's own session, as the page makes it: a GET,
   * or with `init` the method and the JSON body the page itself sends there. Resolves with the parsed JSON body or a
   * refusal, never rejects. Every request of ours goes through here; the caller chooses which path may be asked, when,
   * and whether it may be anything but a read (X54: reads only, unless a decision says otherwise). `still` is asked once
   * more right before the request, after the token's wait: false — `identity-mismatch`, and nothing is requested.
   */
  const omRequest = async (
    path: string,
    init?: { readonly method: 'GET' | 'POST'; readonly json?: unknown },
    still?: () => boolean,
  ): Promise<{ readonly ok: true; readonly body: unknown } | Failed | typeof ERR_IDENTITY> => {
    const root = apiBase();
    if (root === null) return fail('endpoint');
    // One deadline for the session token and the request: a token that never comes ends the read as late, not never.
    const abort = new AbortController();
    setTimer(() => abort.abort(), OPEN_CHAT_REQUEST_MS);
    const late = new Promise<null>((resolve) => abort.signal.addEventListener('abort', () => resolve(null), { once: true }));
    let token: unknown;
    try {
      token = await Promise.race([(win as PageWindow).Clerk?.session?.getToken?.(), late]);
    } catch {
      token = null;
    }
    if (abort.signal.aborted) return fail('timeout');
    if (typeof token !== 'string' || token === '') return fail('session');
    if (still !== undefined && !still()) return ERR_IDENTITY;
    try {
      const response = await win.fetch(root + path, {
        method: init?.method ?? 'GET',
        headers: init?.json === undefined ? { authorization: `Bearer ${token}` } : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(init?.json === undefined ? {} : { body: JSON.stringify(init.json) }),
        signal: abort.signal,
      });
      return response.ok ? { ok: true, body: await response.json() } : fail('http', response.status);
    } catch (error) {
      return fail(abort.signal.aborted ? 'timeout' : error instanceof SyntaxError ? 'invalid' : 'network');
    }
  };

  return {
    omRequest,
    /**
     * Whether the fan read the chat's newest message. First the account's chat list searched by the fan's username,
     * past OnlyMonster's own cache (`force=true`: a reading changes no message the socket would bring); a list read
     * marks nothing read. Only when that live list says the last message is the account's own (`creator`, its
     * OnlyFans id) and nothing in the chat is unread, the history's newest messages (live): every fan message is read
     * already, so the read marks nothing new — but a fan message that came between the two reads it does mark read
     * (`raced`). A page of `CHAT_READ_HISTORY_LIMIT`, not one: OnlyFans marks the whole chat read either way, and the
     * page shows what came between. Anything else answers the list's last message, with no read state.
     */
    async chatReadState(acc: string, fan: string, username: string, creator: string | null): Promise<Plain | typeof ERR_IDENTITY> {
      const list = await omRequest(`accounts/${acc}/chats?limit=${CHAT_READ_SEARCH_LIMIT}&query=${encodeURIComponent(username)}&force=true`);
      if (typeof list === 'string' || !list.ok) return list;
      const listed = listedOf(list.body, fan, creator);
      if ('ok' in listed) return listed;
      if (listed.last === null || !listed.mayRead) return { ok: true, last: listed.last };
      const history = await omRequest(`accounts/${acc}/chats/${fan}/messages?limit=${CHAT_READ_HISTORY_LIMIT}&force=true`);
      return typeof history === 'string' || !history.ok ? history : readStateOf(history.body, listed.last);
    },
    /**
     * The open chat's newest `limit` messages (before `cursor`), newest first, within one frame's byte budget — read
     * past OnlyMonster's own cache (`force=true`, its Refresh): a purchase changes a message, and only a fresh read
     * says it. `open` — the chat is still the one on the route; asked again right before the request.
     */
    async openChatMessages(acc: string, fan: string, limit: number, cursor: string | undefined, open: () => boolean): Promise<Plain | typeof ERR_IDENTITY> {
      const read = await omRequest(`accounts/${acc}/chats/${fan}/messages?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}&force=true`, undefined, open);
      if (typeof read === 'string' || !read.ok) return read;
      const raws = isPlain(read.body) ? read.body['items'] : null;
      if (!Array.isArray(raws)) return fail('invalid');
      const items: Plain[] = [];
      let bytes = 0;
      let cut = false;
      for (const raw of raws) {
        // Only the newest page names photos: what a start sends of them is the fan's latest turn.
        const item = message(raw, cursor === undefined && items.length < LIVE_IMAGE_WINDOW);
        if (item === null) continue;
        bytes += utf8Bytes(JSON.stringify(item));
        if ((cut = bytes > FRAME_DATA_BUDGET || items.length >= limit)) break;
        items.push(item);
      }
      return {
        ok: true,
        page: {
          capturedAt: new Date().toISOString(),
          items,
          hasMore: cut || flag((read.body as Plain)['has_more']),
          cursor: (items.at(-1)?.['platformMessageId'] as string | undefined) ?? null,
        },
      };
    },
  };
}
