// Our own read of the open chat from OnlyMonster's API (decision X51; contracts
// TO_MAIN.openChatMessages): the one request MAIN makes, made the way
// ChatSpace makes its own — the page's `fetch`, its Clerk session token as the
// bearer, the API address the page itself requests. The address comes from the
// page's own requests (its resource timing): ChatSpace's API lives on another
// host than the page, and MAIN names no origin. The runtime refuses any chat
// but the one on the route before this file runs: loading a chat's history
// marks it read on OnlyFans (facts.md). Nothing is written, retried or kept;
// the isolated side checks the answer with its schema.

import { count, idOf, isPlain, type Plain } from '@cg/host-kit/main/check';
import { ERR_IDENTITY } from '@cg/host-kit/main/protocol';
import { iso, plain, utf8Bytes } from './page';
import { API_ACCOUNTS_PATH, API_PATH, FRAME_DATA_BUDGET, OPEN_CHAT_PRICE_MAX, OPEN_CHAT_REQUEST_MS } from './protocol';

type PageWindow = Window & { readonly Clerk?: { readonly session?: { readonly getToken?: () => unknown } | null } };

const fail = (failure: string, status: number | null = null): Plain & { readonly ok: false } => ({ ok: false, failure, status });
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
/** A listed price in USD (a number or its text); anything else — none. */
const price = (value: unknown): number | null => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return amount > 0 && amount <= OPEN_CHAT_PRICE_MAX ? amount : null;
};

/** One raw message (`{id, content, sent_at, is_from_fan, platform_metadata}`) as contracts OpenChatMessage; null — unreadable. */
const message = (raw: unknown): Plain | null => {
  const id = isPlain(raw) ? idOf(raw['id']) : null;
  const at = id === null ? null : iso((raw as Plain)['sent_at']);
  const fromFan = (raw as Plain | null)?.['is_from_fan'];
  if (at === null || typeof fromFan !== 'boolean') return null;
  const meta = isPlain((raw as Plain)['platform_metadata']) ? ((raw as Plain)['platform_metadata'] as Plain) : {};
  const media = meta['mediaCount'];
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
  };
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
   * and whether it may be anything but a read (X51: reads only, unless a decision says otherwise). `still` is asked once
   * more right before the request, after the token's wait: false — `identity-mismatch`, and nothing is requested.
   */
  const omRequest = async (
    path: string,
    init?: { readonly method: 'GET' | 'POST'; readonly json?: unknown },
    still?: () => boolean,
  ): Promise<{ readonly ok: true; readonly body: unknown } | Failed | typeof ERR_IDENTITY> => {
    const root = apiBase();
    if (root === null) return fail('endpoint');
    let token: unknown;
    try {
      token = await (win as PageWindow).Clerk?.session?.getToken?.();
    } catch {
      token = null;
    }
    if (typeof token !== 'string' || token === '') return fail('session');
    if (still !== undefined && !still()) return ERR_IDENTITY;
    const abort = new AbortController();
    setTimer(() => abort.abort(), OPEN_CHAT_REQUEST_MS);
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
        const item = message(raw);
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
