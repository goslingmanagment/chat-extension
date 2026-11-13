// The filters above the chats (2026-11-13, contracts fansly-filters.ts): what the page's own answers say of its filter
// chips, kept in MAIN and said as one state, `fx.filters`.
//
// - Names: the creator's tiers with an active plan (`/account/me` `account.subscriptionTiers[]`, a plan of status 1),
//   and the pinned lists (`/settings?categoryIds=4000`: the entry 4000/100, `JSON.parse(metadata).pinnedLists[]`; also
//   the entry a write of the page answers with).
// - The unread as the page's group service counts it (main:27061-27131, 27880-27946, 28274-28308):
//   - every valid unread id of `/message/unread` (not deleted, `validMessage` not false; a first page — no `before` —
//     starts them over), in any chat: Fansly makes an empty group for a chat it has not loaded, and All counts it;
//   - a new message of anyone but the creator, but in the chat open now (read at once);
//   - the creator's own read marks (`4/2` of types 2 and 3), a deletion, and «unread again» (type 4) — only for a
//     message the page holds (its history, the socket, its sends), as Fansly applies them to its own messages;
//   - the chat opened (marked read at once).
//   Fansly's «Mark as read» of every chat is not followed (its address is not ours to name, gate `message-ack`): the
//   copy differs from the badges until the page reads its unread again, and the strips show dots meanwhile.
// - Each loaded chat's fan (`/messaging/groups`, `/group/<id>`) by what decides a filter: `subscriber`,
//   `subscriberSubscription.subscriptionTierId`, `containingLists` as every account of an answer sets them in the
//   page's cache (main:24389, 24471) — kept only for the fans of loaded chats.
// - What it costs: the facts are kept by every answer and frame, cheaply; the state is built at most every
//   FILTERS_EVERY_MS (trailing), and its unread only while a strip asks for it (`fx.filtersWanted`, «Четыре группы»).
// - Bounded: held messages are an LRU cap; loaded chats too, but only read ones go (Fansly never forgets a chat it
//   loaded, and its badges count every unread one): unread in a chat whose fan went, or in more loaded chats than the
//   cap, makes the unread not known (dots) rather than short. The unread ids have a cap past which the copy is not known
//   until the next first page; the state is at most FILTERS_MAX_BYTES of UTF-8 (past it the unread, then the names, are
//   not said). Everything resets with another creator.

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';

import { utf8Bytes } from './emitter';

/** The limits of `fx.filters` (contracts FANSLY_FILTER_LIMITS). */
const MAX_TIERS = 40;
const MAX_LISTS = 200;
const MAX_NAME = 200;
const MAX_ROWS = 600;
const MAX_ROW_LISTS = 64;
/** The state's own budget, well inside a batch (64 KiB with every other state). */
export const FILTERS_MAX_BYTES = 16 * 1024;
/** The state at most this often (trailing): a burst of answers and frames costs one build. */
export const FILTERS_EVERY_MS = 400;
/** As identity's (MAX_GROUPS): the chats whose fans are kept (read ones go past it; unread ones never do). */
export const MAX_LOADED = 600;
/** Messages the page holds, for its read marks and deletions. */
const MAX_HELD = 4000;
/** Unread ids over every chat: past it the copy is not known until the next first page. */
const MAX_UNREAD = 5000;
/** Chats whose fan went with the cap: unread in one of them is unread the rows cannot place. */
const MAX_EVICTED = MAX_UNREAD;
const GROUP_SETTINGS = '4000';
const PINNED_LISTS = '100';

interface Fan {
  readonly s: boolean;
  readonly t: string | null;
  readonly l: readonly string[];
}

export interface FilterFacts {
  me(account: Plain): void;
  settings(response: unknown, parse: (text: string) => unknown): void;
  /** An account of an answer, as the page's cache takes it (kept for a fan of a loaded chat only). */
  account(value: unknown): void;
  /** A chat the page loaded, and its fan (null — not said). */
  loaded(groupId: string, fan: string | null): void;
  unread(response: Plain, first: boolean): void;
  /** A message the page holds (its history, the socket, its own send). */
  held(groupId: string, messageId: string): void;
  message(groupId: string, messageId: string, sender: string, creator: string | null, open: boolean): void;
  read(userId: string | null, ids: readonly string[], type: number | null, creator: string | null): void;
  deleted(messageId: string): void;
  opened(groupId: string): void;
  /** Whether a strip of the isolated side wants the unread (`fx.filtersWanted`). */
  want(unread: boolean): void;
  /**
   * The state to say now, with its payload's UTF-8 size; null — nothing new, or not yet (the throttle: `dueIn` is told
   * when to come back). `force` — after `fx.state`: now, whole.
   */
  take(now: number, force: boolean): { readonly payload: Plain; readonly bytes: number } | null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** A Map used as an LRU: a key touched goes to the end; past `max` the oldest go (`gone` hears each). */
function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number, gone?: (key: K, value: V) => void): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value as K;
    const was = map.get(oldest) as V;
    map.delete(oldest);
    gone?.(oldest, was);
  }
}

export function createFilterFacts(stringify: (value: unknown) => string, dueIn: (ms: number) => void): FilterFacts {
  let creator: string | null = null;
  let tiers: Plain[] | null = null;
  let lists: Plain[] | null = null;
  /** Unread message ids by chat: the page's own count of a chat is its size. */
  const unread = new Map<string, Set<string>>();
  let unreadIds = 0;
  let unreadKnown = false;
  /** The cap was passed: nothing is known until the next first page. */
  let overflowed = false;
  /** First pages of `/message/unread` read: a fresh full read the strip may trust again (contracts `fresh`). */
  let fresh = 0;
  /** The chats the page loaded, with their fan (LRU over the read ones). */
  const loaded = new Map<string, string | null>();
  /** Chats that went from `loaded` (LRU): the page still has them and their fans. */
  const evicted = new Map<string, true>();
  /** How many loaded chats each fan has: a fan's facts go with its last chat. */
  const partners = new Map<string, number>();
  const fans = new Map<string, Fan>();
  /** Messages the page holds: their chat (LRU). */
  const heldIds = new Map<string, string>();
  let wanted = false;
  let dirty = true;
  let said = '';
  let saidAt = Number.NEGATIVE_INFINITY;
  let asked = false;

  const reset = (): void => {
    tiers = null;
    lists = null;
    unread.clear();
    unreadIds = 0;
    unreadKnown = false;
    overflowed = false;
    loaded.clear();
    evicted.clear();
    partners.clear();
    fans.clear();
    heldIds.clear();
    dirty = true;
  };
  const addUnread = (groupId: string, messageId: string): void => {
    if (overflowed) return;
    let ids = unread.get(groupId);
    if (ids === undefined) unread.set(groupId, (ids = new Set()));
    if (ids.has(messageId)) return;
    ids.add(messageId);
    unreadIds += 1;
    // Past the cap the copy is not known: the next first page starts it over.
    if (unreadIds > MAX_UNREAD) {
      unread.clear();
      unreadIds = 0;
      overflowed = true;
    }
    dirty = true;
  };
  const dropUnread = (groupId: string, messageId: string): void => {
    if (unread.get(groupId)?.delete(messageId) === true) {
      unreadIds -= 1;
      dirty = true;
    }
  };
  const unpartner = (fan: string | null): void => {
    if (fan === null) return;
    const left = (partners.get(fan) ?? 1) - 1;
    if (left > 0) partners.set(fan, left);
    else {
      partners.delete(fan);
      fans.delete(fan);
    }
  };

  /** Past the cap the oldest read chats go, with their fans; a chat with unread never does (its row would go short). */
  const evict = (): void => {
    if (loaded.size <= MAX_LOADED) return;
    for (const [groupId, fan] of loaded) {
      if (loaded.size <= MAX_LOADED) return;
      if ((unread.get(groupId)?.size ?? 0) > 0) continue;
      loaded.delete(groupId);
      unpartner(fan);
      touch(evicted, groupId, true, MAX_EVICTED);
      dirty = true;
    }
  };

  /**
   * The unread as the strips count it: `all` over every chat (loaded or not), the rows only for loaded chats whose fan
   * is in a filter of the strip — a subscriber, a tier, a pinned list. A row is `[unread, subscriber 0/1, tier index or
   * -1, ...pinned list indexes]` into `tiers` and `ids` (the pinned lists only): a few bytes a chat. null — not known:
   * no full read yet, a pinned list not known, a limit passed, unread in a chat whose fan went or in more loaded chats
   * than the cap.
   */
  const unreadOf = (): Plain | null => {
    if (!unreadKnown || overflowed || lists === null) return null;
    const pinned = new Set(lists.map((list) => list['id'] as string));
    const index = new Map<string, number>();
    const tierIndex = new Map<string, number>();
    const rows: number[][] = [];
    let all = 0;
    let held = 0;
    for (const [groupId, messages] of unread) {
      if (messages.size === 0) continue;
      all += messages.size;
      if (!loaded.has(groupId)) {
        // Loaded once, its fan gone with the cap: the page counts it in its filters, the rows cannot.
        if (evicted.has(groupId)) return null;
        continue;
      }
      if ((held += 1) > MAX_LOADED) return null;
      const fanId = loaded.get(groupId) ?? null;
      const fan = fanId === null ? undefined : fans.get(fanId);
      if (fan === undefined) continue;
      const l: number[] = [];
      for (const list of fan.l) {
        if (!pinned.has(list)) continue;
        let at = index.get(list);
        if (at === undefined) index.set(list, (at = index.size));
        l.push(at);
      }
      if (!fan.s && fan.t === null && l.length === 0) continue;
      if (l.length > MAX_ROW_LISTS || rows.length >= MAX_ROWS) return null;
      let tier = -1;
      if (fan.t !== null) {
        tier = tierIndex.get(fan.t) ?? tierIndex.size;
        tierIndex.set(fan.t, tier);
      }
      rows.push([Math.min(messages.size, 100_000), fan.s ? 1 : 0, tier, ...l]);
    }
    if (tierIndex.size > MAX_TIERS) return null;
    return { all: Math.min(all, 1_000_000), fresh, ids: [...index.keys()], tiers: [...tierIndex.keys()], rows };
  };

  return {
    me(account) {
      const id = idOf(account['id']);
      // Another creator in the same document: nothing of the old one's says anything of this one.
      if (creator !== null && id !== creator) reset();
      creator = id;
      const list = account['subscriptionTiers'];
      if (!Array.isArray(list)) return;
      const next: Plain[] = [];
      for (const tier of list as unknown[]) {
        if (!isPlain(tier)) continue;
        const tierId = idOf(tier['id']);
        const name = text(tier['name'], MAX_NAME);
        const plans = Array.isArray(tier['plans']) ? (tier['plans'] as unknown[]) : [];
        if (tierId === null || name === null || !plans.some((plan) => isPlain(plan) && plan['status'] === 1)) continue;
        next.push({ id: tierId, name, color: text(tier['color'], 40) });
      }
      tiers = next.length > MAX_TIERS ? null : next;
      dirty = true;
    },
    settings(response, parse) {
      for (const entry of Array.isArray(response) ? (response as unknown[]) : [response]) {
        if (!isPlain(entry) || String(entry['categoryId']) !== GROUP_SETTINGS || String(entry['keyId']) !== PINNED_LISTS) continue;
        let metadata: unknown;
        try {
          metadata = typeof entry['metadata'] === 'string' ? parse(entry['metadata']) : null;
        } catch {
          metadata = null;
        }
        const pinned = isPlain(metadata) && Array.isArray(metadata['pinnedLists']) ? (metadata['pinnedLists'] as unknown[]) : null;
        if (pinned === null) continue;
        const next: Plain[] = [];
        for (const list of pinned) {
          // The page keeps an entry it cannot name too (its chip says «List»): the order is what matters.
          const id = isPlain(list) ? idOf(list['id']) : null;
          if (id === null) continue;
          next.push({ id, label: text((list as Plain)['label'], MAX_NAME) ?? 'List' });
        }
        lists = next.length > MAX_LISTS ? null : next;
        dirty = true;
      }
    },
    account(value) {
      if (!isPlain(value)) return;
      const id = idOf(value['id']);
      if (id === null || !partners.has(id)) return;
      const subscription = value['subscriberSubscription'];
      const contained = Array.isArray(value['containingLists']) ? (value['containingLists'] as unknown[]).flatMap((list) => idOf(list) ?? []) : [];
      fans.set(id, { s: value['subscriber'] === true, t: isPlain(subscription) ? idOf(subscription['subscriptionTierId']) : null, l: contained });
      dirty = true;
    },
    loaded(groupId, fan) {
      const known = loaded.get(groupId);
      const next = fan ?? known ?? null;
      if (known !== next) {
        unpartner(known ?? null);
        if (next !== null) partners.set(next, (partners.get(next) ?? 0) + 1);
        dirty = true;
      }
      loaded.delete(groupId);
      loaded.set(groupId, next);
      if (evicted.delete(groupId)) dirty = true;
      evict();
    },
    unread(response, first) {
      if (first) {
        unread.clear();
        unreadIds = 0;
        overflowed = false;
        fresh += 1;
      }
      unreadKnown = true;
      const items = Array.isArray(response['messageInteractions']) ? (response['messageInteractions'] as unknown[]) : [];
      for (const item of items) {
        // Fansly's own test (main:27904): not deleted, and a valid message.
        if (!isPlain(item) || (item['deletedAt'] !== null && item['deletedAt'] !== undefined && item['deletedAt'] !== 0) || item['validMessage'] === false) continue;
        const groupId = idOf(item['groupId']);
        const messageId = idOf(item['messageId']);
        if (groupId !== null && messageId !== null) addUnread(groupId, messageId);
      }
      dirty = true;
    },
    held(groupId, messageId) {
      touch(heldIds, messageId, groupId, MAX_HELD);
    },
    message(groupId, messageId, sender, by, open) {
      touch(heldIds, messageId, groupId, MAX_HELD);
      // The page's own: a message of anyone but the creator is unread, but in the chat open now (read at once).
      if (by === null || sender === by || open) return;
      addUnread(groupId, messageId);
    },
    read(userId, ids, type, by) {
      if (by === null || userId !== by) return;
      for (const id of ids) {
        // Fansly applies a mark to a message it holds only (main:28274-28308).
        const groupId = heldIds.get(id);
        if (groupId === undefined) continue;
        if (type === 2 || type === 3) dropUnread(groupId, id);
        else if (type === 4) addUnread(groupId, id);
      }
    },
    deleted(messageId) {
      const groupId = heldIds.get(messageId);
      if (groupId !== undefined) dropUnread(groupId, messageId);
    },
    opened(groupId) {
      const ids = unread.get(groupId);
      if (ids !== undefined && ids.size > 0) {
        unreadIds -= ids.size;
        ids.clear();
        dirty = true;
      }
    },
    want(on) {
      if (on === wanted) return;
      wanted = on;
      dirty = true;
    },
    take(now, force) {
      if (!dirty && !force) return null;
      if (!force && now - saidAt < FILTERS_EVERY_MS) {
        // Due later: one wake for the burst.
        if (!asked) {
          asked = true;
          dueIn(FILTERS_EVERY_MS - (now - saidAt));
        }
        return null;
      }
      asked = false;
      dirty = false;
      saidAt = now;
      const names = { tiers, lists };
      let payload: Plain = { ...names, unread: wanted ? unreadOf() : null };
      let json = stringify(payload);
      let bytes = utf8Bytes(json);
      if (bytes > FILTERS_MAX_BYTES && payload['unread'] !== null) {
        payload = { ...names, unread: null };
        json = stringify(payload);
        bytes = utf8Bytes(json);
      }
      if (bytes > FILTERS_MAX_BYTES) {
        payload = { tiers: null, lists: null, unread: null };
        json = stringify(payload);
        bytes = utf8Bytes(json);
      }
      if (json === said && !force) return null;
      said = json;
      return { payload, bytes };
    },
  };
}
