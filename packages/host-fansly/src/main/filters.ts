// The filters above the chats (2026-11-13, contracts fansly-filters.ts): what the page's own answers say of its filter
// chips, kept in MAIN and said as one state, `fx.filters`.
//
// - Names: the creator's tiers with an active plan (`/account/me` `account.subscriptionTiers[]`, a plan of status 1),
//   and the pinned lists (`/settings?categoryIds=4000`: the entry 4000/100, `JSON.parse(metadata).pinnedLists[]`).
// - The unread of the loaded chats, as the page's group service counts them (main:27061-27131): the unread message ids
//   of `/message/unread` (a first page — no `before` — starts them over), a new message of anyone but the creator, the
//   creator's own read marks (`4/2` of types 2 and 3), a deleted message, and the chat opened (marked read at once).
//   Only the chats the page loaded count (`/messaging/groups`, `/group/<id>`). Fansly's «Mark as read» of every chat
//   is not followed (its address is not ours to name, gate `message-ack`): the copy differs from the badges until the
//   page reads its unread again (its refresh), and the strips show dots meanwhile.
// - Each chat's fan by what decides a filter: `subscriber`, `subscriberSubscription.subscriptionTierId`,
//   `containingLists` — as every account of an answer sets them in the page's cache (main:24389, 24471).
// Any limit passed and the part is null: the strips show Fansly's numbers only, never a guess.

import { idOf, isPlain, type Plain } from '@cg/host-kit/main/check';

/** The limits of `fx.filters` (contracts FANSLY_FILTER_LIMITS); past one, the part is not said. */
const MAX_TIERS = 40;
const MAX_LISTS = 200;
const MAX_NAME = 200;
const MAX_ROWS = 600;
const MAX_ROW_LISTS = 64;
const MAX_IDS = 2000;
/** The names of a state stay well within a batch (non-ASCII names count up to three bytes each). */
const MAX_NAME_CHARS = 12_000;
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
  /** An account of an answer, as the page's cache takes it. */
  account(value: unknown): void;
  /** A chat the page loaded, and its fan (null — not said). */
  loaded(groupId: string, fan: string | null): void;
  unread(response: Plain, first: boolean): void;
  message(groupId: string, messageId: string, sender: string, creator: string | null, open: boolean): void;
  read(userId: string | null, ids: readonly string[], type: number | null, creator: string | null): void;
  deleted(messageId: string): void;
  opened(groupId: string): void;
  /** The payload when anything said changed since the last call; null — nothing new. */
  take(force: boolean): Plain | null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
};

export function createFilterFacts(stringify: (value: unknown) => string): FilterFacts {
  let tiers: Plain[] | null = null;
  let lists: Plain[] | null = null;
  /** Unread message ids by chat: the page's own count of a chat is its size. */
  const unread = new Map<string, Set<string>>();
  let unreadKnown = false;
  /** The chats the page loaded, with their fan. */
  const loaded = new Map<string, string | null>();
  const fans = new Map<string, Fan>();
  let dirty = true;
  let said = '';

  const forget = (messageId: string): void => {
    for (const ids of unread.values()) if (ids.delete(messageId)) dirty = true;
  };

  return {
    me(account) {
      const list = account['subscriptionTiers'];
      if (!Array.isArray(list)) return;
      const next: Plain[] = [];
      for (const tier of list as unknown[]) {
        if (!isPlain(tier)) continue;
        const id = idOf(tier['id']);
        const name = text(tier['name'], MAX_NAME);
        const plans = Array.isArray(tier['plans']) ? (tier['plans'] as unknown[]) : [];
        if (id === null || name === null || !plans.some((plan) => isPlain(plan) && plan['status'] === 1)) continue;
        next.push({ id, name, color: text(tier['color'], 40) });
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
      if (id === null) return;
      const subscription = value['subscriberSubscription'];
      const contained = Array.isArray(value['containingLists']) ? (value['containingLists'] as unknown[]).flatMap((list) => idOf(list) ?? []) : [];
      fans.set(id, { s: value['subscriber'] === true, t: isPlain(subscription) ? idOf(subscription['subscriptionTierId']) : null, l: contained });
      dirty = true;
    },
    loaded(groupId, fan) {
      const known = loaded.get(groupId);
      if (known !== undefined && (fan === null || known === fan)) return;
      loaded.set(groupId, fan ?? known ?? null);
      dirty = true;
    },
    unread(response, first) {
      if (first) unread.clear();
      unreadKnown = true;
      const items = Array.isArray(response['messageInteractions']) ? (response['messageInteractions'] as unknown[]) : [];
      for (const item of items) {
        if (!isPlain(item) || (item['deletedAt'] !== null && item['deletedAt'] !== undefined && item['deletedAt'] !== 0)) continue;
        const groupId = idOf(item['groupId']);
        const messageId = idOf(item['messageId']);
        if (groupId === null || messageId === null) continue;
        let ids = unread.get(groupId);
        if (ids === undefined) unread.set(groupId, (ids = new Set()));
        ids.add(messageId);
      }
      dirty = true;
    },
    message(groupId, messageId, sender, creator, open) {
      // The page's own: a message of anyone but the creator is unread, but in the chat open now (read at once).
      if (creator === null || sender === creator || open) return;
      let ids = unread.get(groupId);
      if (ids === undefined) unread.set(groupId, (ids = new Set()));
      if (!ids.has(messageId)) {
        ids.add(messageId);
        dirty = true;
      }
    },
    read(userId, ids, type, creator) {
      if (creator === null || userId !== creator || (type !== 2 && type !== 3)) return;
      for (const id of ids) forget(id);
    },
    deleted: forget,
    opened(groupId) {
      const ids = unread.get(groupId);
      if (ids !== undefined && ids.size > 0) {
        ids.clear();
        dirty = true;
      }
    },
    take(force) {
      if (!dirty && !force) return null;
      dirty = false;
      let rows: Plain[] | null = null;
      let ids: string[] = [];
      if (unreadKnown) {
        const index = new Map<string, number>();
        rows = [];
        for (const [groupId, messages] of unread) {
          if (messages.size === 0 || !loaded.has(groupId)) continue;
          const fanId = loaded.get(groupId) ?? null;
          const fan = fanId === null ? undefined : fans.get(fanId);
          const l: number[] = [];
          for (const list of (fan?.l ?? []).slice(0, MAX_ROW_LISTS)) {
            let at = index.get(list);
            if (at === undefined) index.set(list, (at = index.size));
            l.push(at);
          }
          rows.push({ u: Math.min(messages.size, 100_000), s: fan?.s ?? false, t: fan?.t ?? null, l });
        }
        ids = [...index.keys()];
        if (rows.length > MAX_ROWS || ids.length > MAX_IDS) rows = null;
      }
      const names = stringify([tiers, lists]).length > MAX_NAME_CHARS;
      const payload: Plain = { tiers: names ? null : tiers, lists: names ? null : lists, unread: rows === null ? null : { ids, rows } };
      const next = stringify(payload);
      if (next === said && !force) return null;
      said = next;
      return payload;
    },
  };
}
