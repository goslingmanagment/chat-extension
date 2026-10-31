// The OnlyFans feed (hub #953, `onlyfans-feed-v1`): from 2026-11-01 the hub
// has no OnlyFansAPI, so the tap script passes on to it what ChatSpace itself
// already received for the chatter. It ships in the tap script (ws-tap.ts) and
// lives as long as the tap.
//
// - What is taken: the frames of ChatSpace's own socket that the tap reads —
//   a new message in either direction (with its text, price, media and marks,
//   and the fan's own OnlyFans facts when the fan wrote it), a deletion, a fan's
//   purchase and tip — and the answers of four reads ChatSpace makes itself:
//   the open chat's history pages, its fans batches, its chat list pages and,
//   when a chatter opens its sales tab, the ledger. Our own read of the open
//   chat for the AI (om-api.ts) goes through the same `fetch` and is taken too.
// - How the answers are seen: while the latch is on, the page's `fetch` is
//   replaced by an observer that passes EVERY call through to the function it replaced with
//   the same `this` and arguments and returns its very result — it never calls
//   fetch on its own, never delays, repeats or changes a request or a response.
//   For a GET of one of the four reads of an OnlyFans account it keeps a copy
//   of the 2xx response (`clone`, taken when the response arrives, before the
//   page reads its own) and reads the copy. ChatSpace's HTTP client takes the
//   global `fetch` when it creates each request, so it calls the observer;
//   the receipt observer (receipt.ts) still puts itself in front of it for the
//   one stack of a followed send. What the page's fetch throws or resolves to
//   reaches the page unchanged; a failure of ours costs only a record.
// - NO REQUEST OF OURS IS EVER MADE FOR IT: no OnlyFans traffic is added. The
//   owner turned on OnlyMonster's kill switch to keep automated collection off
//   the models' accounts; this only passes on what the page already has.
// - Records are kept per account and leave MAIN as `ofFeed` events (never
//   coalesced), at most FEED_MAX_RECORDS and FEED_EVENT_BYTES each, every
//   FEED_FLUSH_MS. Only for an OnlyFans account the page has loaded (its creator
//   is known) and only while the latch is on: the owner's `ofFeed` on at least
//   one granted page (the background applies each page's own switch). Before
//   the isolated side says, at most FEED_BUFFER_RECORDS wait (the first loads of
//   the page come before the flags); off — they are dropped.
// - A record is cut and checked against the contracts' shape by hand
//   (OnlyfansFeedRecordSchema; the isolated side checks it again): a field it
//   cannot read is null, a record without its ids is not built.

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';
import { type Guard } from '@cg/host-kit/main/guard';
import { type Feed, type FeedHost } from './live';
import { iso } from './page';
import {
  EVT_FEED,
  FEED_BUFFER_RECORDS,
  FEED_EVENT_BYTES,
  FEED_FLUSH_MS,
  FEED_HOLD_MS,
  FEED_MAX_BODY,
  FEED_MAX_RECORDS,
  FEED_MEDIA_MAX,
  FEED_MONEY_MAX,
  FEED_TEXT_MAX,
  WS_MESSAGE_DELETED,
  WS_PPV_PURCHASED,
  WS_TIP_RECEIVED,
} from './protocol';

/** The four reads, by the path of the request (`api/v0/accounts/{acc}/…`). */
const READS: ReadonlyArray<readonly [RegExp, Read]> = [
  [/\/api\/v0\/accounts\/(\d+)\/chats\/(\d+)\/messages$/, 'history'],
  [/\/api\/v0\/accounts\/(\d+)\/chats$/, 'chats'],
  [/\/api\/v0\/accounts\/(\d+)\/platforms\/onlyfans\/fans$/, 'fans'],
  [/\/api\/v0\/accounts\/(\d+)\/platforms\/onlyfans\/transactions$/, 'ledger'],
  // 2026-11-01 (hub #955): the new-subscriber notifications — ChatSpace's own «Подписки» tab, and the poll's read.
  [/\/api\/v0\/accounts\/(\d+)\/notifications$/, 'subscribers'],
];
type Read = 'history' | 'chats' | 'fans' | 'ledger' | 'subscribers';
const REF = /^[A-Za-z0-9_-]{1,64}$/;

// ── Reading what ChatSpace received (the shapes: docs/research/onlymonster-chatspace) ──

const text = (value: unknown, max: number): string | null => (typeof value === 'string' ? cut(value, max) : null);
/** At most `max` UTF-16 units, never half of a pair. */
const cut = (value: string, max: number): string => (value.length <= max ? value : value.slice(0, /[\uD800-\uDBFF]/.test(value.charAt(max - 1)) ? max - 1 : max));
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const dollars = (value: unknown, signed = false): number | null => {
  const amount = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof amount === 'number' && Number.isFinite(amount) && amount <= FEED_MONEY_MAX && amount >= (signed ? -FEED_MONEY_MAX : 0) ? amount : null;
};
const ref = (value: unknown): string | null => {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof id === 'string' && REF.test(id) ? id : null;
};
const countOf = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1000 ? (value as number) : null);

const mediaOf = (value: unknown): Plain[] =>
  (Array.isArray(value) ? (value as unknown[]) : []).flatMap((item) => {
    if (!isPlain(item)) return [];
    const id = ref(item['id']);
    if (id === null) return [];
    const duration = typeof item['duration'] === 'number' && Number.isFinite(item['duration']) && item['duration'] >= 0 && item['duration'] <= 86_400 ? item['duration'] : null;
    return [{ ref: id, type: text(item['type'], 64) || 'other', canView: bool(item['canView']), duration }];
  }).slice(0, FEED_MEDIA_MAX);

/** A fan's own OnlyFans facts as an OnlyFans user object carries them (the fans read, the socket's sender). */
export const fanFactsOf = (user: Plain): Plain => {
  const data = isPlain(user['subscribedOnData']) ? user['subscribedOnData'] : null;
  const sums = data === null ? null : { tips: dollars(data['tipsSumm']), subscriptions: dollars(data['subscribesSumm']), messages: dollars(data['messagesSumm']), posts: dollars(data['postsSumm']), streams: dollars(data['streamsSumm']), total: dollars(data['totalSumm']) };
  return {
    username: text(user['username'], 100),
    name: text(user['name'], 200),
    displayName: text(user['displayName'], 200),
    subscribedOn: bool(user['subscribedOn']),
    subscribedOnExpiredNow: bool(user['subscribedOnExpiredNow']),
    subscribeAt: iso(data?.['subscribeAt']),
    expiredAt: iso(data?.['expiredAt']),
    renewedAt: iso(data?.['renewedAt']),
    subscriptionStatus: text(data?.['status'], 64),
    subscribePrice: dollars(data?.['price']),
    regularPrice: dollars(data?.['regularPrice']),
    spend: sums !== null && Object.values(sums).some((sum) => sum !== null) ? sums : null,
  };
};

/**
 * A message as ChatSpace has it — a socket frame's `message` ({id, content, sentAt, chatId, is_from_fan,
 * platformMetadata}) or a history item ({id, content, sent_at, is_from_fan, platform_metadata}) — as a record; null
 * without its ids, direction or time.
 */
export const messageRecord = (raw: Plain, fan: string | null, via: 'socket' | 'history' | 'chat_list', observedAt: string, fromFan?: boolean): Plain | null => {
  const id = idOf(raw['id']);
  const chat = fan ?? idOf(raw['chatId']);
  const direction = fromFan ?? raw['is_from_fan'];
  const sentAt = iso(raw['sentAt'] ?? raw['sent_at']);
  if (id === null || chat === null || typeof direction !== 'boolean' || sentAt === null) return null;
  const meta: Plain = isPlain(raw['platformMetadata']) ? raw['platformMetadata'] : isPlain(raw['platform_metadata']) ? raw['platform_metadata'] : {};
  const sender = isPlain(meta['fromUser']) ? meta['fromUser'] : null;
  return {
    kind: 'message',
    messageRef: id,
    fanRef: chat,
    fromFan: direction,
    sentAt,
    observedAt,
    via,
    textHtml: typeof raw['content'] === 'string' ? cut(raw['content'], FEED_TEXT_MAX) : '',
    price: dollars(meta['price']),
    isFree: bool(meta['isFree']),
    isOpened: bool(meta['isOpened']),
    isNew: bool(meta['isNew']),
    isTip: meta['isTip'] === true,
    tipText: text(meta['tipText'], 2000),
    mediaCount: countOf(meta['mediaCount']),
    media: mediaOf(meta['media']),
    automatic: bool(meta['isFromQueue']),
    changedAt: iso(meta['changedAt']),
    // The fan's own facts ride on the socket's frame of a fan's message (OnlyFans' `fromUser`).
    fan: direction && sender !== null && idOf(sender['id']) === chat ? fanFactsOf(sender) : null,
  };
};

/**
 * A frame of ChatSpace's own socket that is a deletion, a fan's purchase or a fan's tip, as a record; null — another
 * frame, or one without its ids or amount.
 */
export const socketRecord = (frame: Plain, observedAt: string): Plain | null => {
  const event = frame['event'];
  if (event === WS_MESSAGE_DELETED) {
    const id = idOf(frame['message_id']);
    return id === null ? null : { kind: 'deleted', messageRef: id, observedAt };
  }
  const fan = idOf(frame['fan_id']);
  if (fan === null) return null;
  if (event === WS_PPV_PURCHASED) {
    const contentType = text(frame['content_type'], 64);
    const content = idOf(frame['content_id']);
    const price = dollars(frame['price_gross']);
    return contentType && content !== null && price !== null && price > 0 ? { kind: 'ppv', fanRef: fan, contentType, contentRef: content, priceGross: price, observedAt } : null;
  }
  if (event === WS_TIP_RECEIVED) {
    const tip = ref(frame['tip_id']);
    const amount = dollars(frame['amount_gross']);
    return tip !== null && amount !== null && amount > 0 ? { kind: 'tip', fanRef: fan, tipRef: tip, amountGross: amount, observedAt } : null;
  }
  return null;
};

/** A ledger description is HTML («Tip from <a …>name</a>»): its text, never markup. */
const plainText = (html: unknown): string => (typeof html === 'string' ? cut(html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), 500) : '');

/** The records an answer of one of the four reads carries. */
export const recordsOfRead = (read: Read, fan: string | null, body: unknown, observedAt: string): Plain[] => {
  const items: unknown[] = isPlain(body) && Array.isArray(body['items']) ? (body['items'] as unknown[]) : [];
  const out: Plain[] = [];
  for (const item of items) {
    if (!isPlain(item)) continue;
    if (read === 'history') {
      const record = messageRecord(item, fan, 'history', observedAt);
      if (record !== null) out.push(record);
    } else if (read === 'fans') {
      const id = idOf(item['id']);
      if (id !== null) out.push({ kind: 'fan', fanRef: id, observedAt, ...fanFactsOf(item) });
    } else if (read === 'chats') {
      const chat = idOf(item['platform_fan_id']);
      if (chat === null) continue;
      const last = isPlain(item['last_message']) ? item['last_message'] : null;
      const unread = item['unread_messages_count'];
      out.push({
        kind: 'chat',
        fanRef: chat,
        unreadCount: Number.isSafeInteger(unread) && (unread as number) >= 0 && (unread as number) <= 1_000_000 ? unread : null,
        lastMessageRef: idOf(last?.['id']),
        observedAt,
      });
      // The chat list names who wrote the last message only by its sender's id.
      const meta: Plain = isPlain(last?.['platform_metadata']) ? last['platform_metadata'] : {};
      const sender = isPlain(meta['fromUser']) ? idOf(meta['fromUser']['id']) : null;
      const record = last !== null && sender !== null ? messageRecord(last, chat, 'chat_list', observedAt, sender === chat) : null;
      if (record !== null) out.push(record);
    } else if (read === 'subscribers') {
      const id = ref(item['id']);
      const fan = idOf(item['platform_fan_id']);
      const createdAt = iso(item['created_at']);
      if (id !== null && fan !== null && createdAt !== null) out.push({ kind: 'subscriber', notificationRef: id, fanRef: fan, subType: text(item['sub_type'], 64) || null, createdAt, observedAt });
    } else {
      const id = ref(item['id']);
      const createdAt = iso(item['created_at']);
      const gross = dollars(item['amount_gross'], true);
      const net = dollars(item['amount_net'], true);
      if (id === null || createdAt === null || gross === null || net === null) continue;
      out.push({ kind: 'ledger', transactionRef: id, fanRef: idOf(item['platform_fan_id']), createdAt, amountGross: gross, amountNet: net, description: plainText(item['description']), status: text(item['status'], 64), observedAt });
    }
  }
  return out;
};

/** The read a call of the page's `fetch` is, with its account and chat; null — not one of the four, or not a GET. */
const readOf = (input: unknown, init: unknown): { readonly read: Read; readonly acc: string; readonly fan: string | null } | null => {
  const request = input as { url?: unknown; method?: unknown } | undefined;
  const method = (init as { method?: unknown } | undefined)?.method ?? request?.method ?? 'GET';
  if (typeof method !== 'string' || !/^get$/i.test(method)) return null;
  const url = String(request?.url ?? input);
  const path = url.split(/[?#]/)[0] as string;
  for (const [pattern, read] of READS) {
    const match = pattern.exec(path);
    // The notifications are read only for the new subscribers: never another type, never `all`.
    if (match && read === 'subscribers' && !/[?&]type=subscribed(?:&|#|$)/.test(url)) return null;
    if (match) return { read, acc: match[1] as string, fan: read === 'history' ? (match[2] as string) : null };
  }
  return null;
};

export function createFeed(win: Window & typeof globalThis, { guard, fail }: { readonly guard: Guard; readonly fail: (site: string) => void }): Feed {
  /** Unknown until the isolated side says (null): records wait, at most FEED_BUFFER_RECORDS of them. */
  let latched: boolean | null = null;
  let host: FeedHost | null = null;
  let live = true;
  let timer: number | null = null;
  const kept = new Map<string, Plain[]>();
  /** When an account's oldest kept record came: one whose creator stays unknown that long is not an OnlyFans account of the page. */
  const since = new Map<string, number>();
  let size = 0;
  const drop = (acc: string): void => {
    size -= kept.get(acc)?.length ?? 0;
    kept.delete(acc);
    since.delete(acc);
  };
  const encoder = new TextEncoder();

  const flush = guard('feedFlush', () => {
    timer = null;
    if (host === null || latched !== true) return;
    for (const [acc, records] of kept) {
      const creator = host.creator(acc);
      // Not an OnlyFans account the page has loaded (another platform's, or its accounts still loading): it waits
      // FEED_HOLD_MS, bounded by the buffer, and goes once the creator is known.
      if (creator === null) {
        if (Date.now() - (since.get(acc) ?? 0) > FEED_HOLD_MS) drop(acc);
        else schedule();
        continue;
      }
      drop(acc);
      let batch: Plain[] = [];
      let bytes = 0;
      const send = (): void => {
        if (batch.length > 0) host?.post(EVT_FEED, { acc, creator, records: batch });
        batch = [];
        bytes = 0;
      };
      for (const record of records) {
        const length = encoder.encode(JSON.stringify(record)).length;
        if (length > FEED_EVENT_BYTES) continue;
        if (batch.length >= FEED_MAX_RECORDS || bytes + length > FEED_EVENT_BYTES) send();
        batch.push(record);
        bytes += length;
      }
      send();
    }
  });
  const schedule = (): void => {
    if (timer === null && live) timer = win.setTimeout(flush, FEED_FLUSH_MS);
  };

  const push = (acc: string, record: Plain): void => {
    if (!live || latched === false) return;
    // Before the isolated side says, and while an account's creator is unknown, only so much waits; the oldest go.
    if (size >= FEED_BUFFER_RECORDS) {
      let largest: Plain[] | undefined;
      for (const list of kept.values()) if (largest === undefined || list.length > largest.length) largest = list;
      largest?.shift();
      size -= 1;
    }
    let list = kept.get(acc);
    if (!list) {
      kept.set(acc, (list = []));
      since.set(acc, Date.now());
    }
    list.push(record);
    size += 1;
    if (latched === true) schedule();
  };

  /** Reads the kept copy of one answer; the page's own response is never read. */
  const read = async (target: { readonly read: Read; readonly acc: string; readonly fan: string | null }, copy: Response): Promise<void> => {
    const body = await copy.text();
    if (body.length > FEED_MAX_BODY) return;
    const observedAt = new Date().toISOString();
    for (const record of recordsOfRead(target.read, target.fan, JSON.parse(body), observedAt)) push(target.acc, record);
  };

  /** The page's fetch the observer passes every call to; null — the observer is not in place. */
  let previous: typeof win.fetch | null = null;
  const observer = function (this: unknown, ...args: unknown[]): unknown {
    // ChatSpace's own call: what the previous fetch throws, or the promise it returns, is ChatSpace's, as it is. The
    // observer is in the page's chain only while `previous` is set (install/uninstall below).
    const result: unknown = Reflect.apply(previous as typeof win.fetch, this, args);
    try {
      const target = live && latched !== false ? readOf(args[0], args[1]) : null;
      if (target !== null && result instanceof Promise) {
        // Our reaction comes before the page's own (it awaits the result we return): the copy is taken before the page
        // reads its body. A failure of ours, or a refused fetch, costs only these records.
        result.then(
          guard('feedAnswer', (response: unknown) => {
            if (response instanceof Response && response.ok) read(target, response.clone()).catch(() => fail('feedRead'));
          }),
          () => undefined,
        );
      }
    } catch {
      fail('feedObserve');
    }
    return result;
  };
  /** The observer goes in front of the page's fetch only while the latch is on: off, the page's fetch is its own. */
  const install = (): void => {
    if (previous !== null || typeof win.fetch !== 'function') return;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the page's function, only ever called with its caller's own `this`
    const current = win.fetch;
    try {
      win.fetch = observer as typeof win.fetch;
      previous = current;
    } catch {
      // A page whose fetch takes no assignment shows us no answer: the socket's records still go.
      fail('feedInstall');
    }
  };
  /** Put back if the global is still ours; else the observer stays where it is and only passes calls on. */
  const uninstall = (): void => {
    if (previous === null || win.fetch !== observer) return;
    win.fetch = previous;
    previous = null;
  };

  return {
    push,
    latch(on) {
      latched = on && live;
      if (latched) {
        install();
        if (size > 0) schedule();
        return;
      }
      uninstall();
      kept.clear();
      since.clear();
      size = 0;
    },
    on: () => live && latched === true,
    pending: () => live && latched === null,
    connect(next) {
      host = next;
      if (size > 0 && latched === true) schedule();
    },
    off() {
      live = false;
      kept.clear();
      since.clear();
      size = 0;
      if (timer !== null) win.clearTimeout(timer);
      uninstall();
    },
  };
}
