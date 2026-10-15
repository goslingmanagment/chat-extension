// «Ждут ответа» (architecture.md §8.7; hub H-8c; SP-047): the fans whose last
// private message is later than ours, over the whole page on the server —
// not over the board's rows. The queue comes in cursor pages with its own
// `total`, `loaded` and `unknown`; pages are appended in order, a fan seen
// twice keeps its first place, and the walk restarts only from the first page.

import { type HubSpenderPeriod, type QueuePage } from '@cg/contracts/hub';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { type IsoTimestamp } from '@cg/contracts/primitives';

import { fanName, normalizeSearch, type SpenderRow } from './rows';

export type QueueItem = QueuePage['items'][number];

export interface QueueState {
  readonly items: readonly QueueItem[];
  /** The hub's count of waiting fans; null before the first page. */
  readonly total: number | null;
  /** Of them, with an unknown read state. */
  readonly unknown: number | null;
  readonly nextCursor: string | null;
  readonly asOf: IsoTimestamp | null;
  /** The visible limit was reached with more behind the cursor. */
  readonly truncated: boolean;
}

export const EMPTY_QUEUE: QueueState = { items: [], total: null, unknown: null, nextCursor: null, asOf: null, truncated: false };

/** Appends the page that answered `cursor`; a page for another cursor (a late answer of an older walk) changes nothing. */
export function appendQueuePage(state: QueueState, cursor: string | null, page: QueuePage): QueueState {
  if (cursor !== state.nextCursor && !(cursor === null && state.items.length === 0)) return state;
  const base = cursor === null ? [] : state.items;
  const seen = new Set(base.map((item) => item.fanRef));
  const items = [...base];
  for (const item of page.items) {
    if (seen.has(item.fanRef)) continue;
    seen.add(item.fanRef);
    items.push(item);
  }
  const room = STORAGE_LIMITS.listVisibleRows;
  const cut = items.length >= room;
  return {
    items: items.slice(0, room),
    total: page.total,
    unknown: page.unknown,
    nextCursor: cut ? null : page.nextCursor,
    asOf: page.asOf,
    truncated: cut && (page.nextCursor !== null || items.length > room),
  };
}

export function queueHasMore(state: QueueState): boolean {
  return state.nextCursor !== null;
}

/**
 * A queue fan as a board row. The board's own row is used when it has one
 * (it knows the period's spend and the last message); otherwise the row
 * holds what the queue knows — the period's spend stays unknown.
 */
export function queueRow(item: QueueItem, rank: number, boardRow: SpenderRow | undefined, boardPeriod: HubSpenderPeriod): SpenderRow {
  if (boardRow !== undefined) return { ...boardRow, fanWroteAt: item.lastFanMessageAt, weWroteAt: item.lastModelMessageAt ?? boardRow.weWroteAt, waiting: true, rank };
  const fan = { pageAlias: null, displayName: item.displayName, username: item.username, platformUserId: item.fanRef };
  const username = item.username?.trim() ?? '';
  return {
    fanRef: item.fanRef,
    // The queue's rows name no conversation: a fan of the board keeps the board's (above).
    conversationRef: null,
    name: fanName(fan),
    username: username.length > 0 ? username.replace(/^@/, '') : null,
    lifetime: item.lifetimeGrossMills,
    period: boardPeriod === 'lifetime' ? item.lifetimeGrossMills : null,
    isNew: false,
    deleted: false,
    weWroteAt: item.lastModelMessageAt,
    fanWroteAt: item.lastFanMessageAt,
    waiting: true,
    lastMessage: null,
    history: 'partial',
    storedMessages: 0,
    retention: null,
    rank,
    haystack: normalizeSearch([item.displayName, item.username, item.fanRef].filter((part) => part !== null).join('\n')),
  };
}
