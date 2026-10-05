// The archive feed of a preview (architecture.md §8.5 «Лента», hub H-9;
// SP-050, SP-053, AI-038, DB-026). A preview shows only what the hub archive
// holds: nothing is loaded from ChatSpace, so the chat stays unread. Pages
// come newest → oldest behind a cursor bound to one snapshot; an older page
// is taken only when it answers the cursor we hold and belongs to the same
// snapshot. The Ping segment and the fan's silence come from the hub's
// summary of the first page — the client never derives them from the rows it
// happens to have. How far the archive is behind the chat is shown, not hidden.

import { type FeedItem, type FeedPage, type FeedSender, type PingSegment } from '@cg/contracts/hub';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';

import { coverageLevel } from './stats';

export interface FeedState {
  /** Newest first, as the hub sends them; no message twice. */
  readonly items: readonly FeedItem[];
  readonly nextOlderCursor: string | null;
  readonly snapshotRevision: string | null;
  readonly asOf: IsoTimestamp | null;
  readonly coverage: CoverageLevel;
  readonly head: { readonly messageRef: string; readonly at: IsoTimestamp | null; readonly sender: FeedSender } | null;
  readonly newestKnownAt: IsoTimestamp | null;
  /** Ping segment and fan silence of the first page's summary; null — the hub sent none. */
  readonly ping: { readonly segment: PingSegment; readonly fanSilenceDays: number | null } | null;
  /** The visible limit was reached with older messages still behind the cursor. */
  readonly truncated: boolean;
}

export const EMPTY_FEED: FeedState = {
  items: [],
  nextOlderCursor: null,
  snapshotRevision: null,
  asOf: null,
  coverage: 'unknown',
  head: null,
  newestKnownAt: null,
  ping: null,
  truncated: false,
};

/** FEED_SENDERS and PING_SEGMENTS of the contracts, repeated so this module loads no schema module (a test pins them equal). */
const SENDERS = ['fan', 'model', 'system', 'unknown'] as const satisfies readonly FeedSender[];
const SEGMENTS = ['active', 'segment-a', 'segment-b', 'unknown'] as const satisfies readonly PingSegment[];

export function feedSender(token: string): FeedSender {
  return (SENDERS as readonly string[]).includes(token) ? (token as FeedSender) : 'unknown';
}

export function pingSegment(token: string): PingSegment {
  return (SEGMENTS as readonly string[]).includes(token) ? (token as PingSegment) : 'unknown';
}

/** The first page of a pass (no cursor): a new snapshot replaces whatever was shown. */
export function firstFeedPage(page: FeedPage): FeedState {
  const seen = new Set<string>();
  const items = page.items.filter((item) => (seen.has(item.messageId) ? false : (seen.add(item.messageId), true)));
  return {
    items,
    nextOlderCursor: page.nextOlderCursor,
    snapshotRevision: page.snapshotRevision,
    asOf: page.asOf,
    coverage: coverageLevel(page.coverage),
    head: page.head === null ? null : { messageRef: page.head.messageRef, at: page.head.at, sender: feedSender(page.head.sender) },
    newestKnownAt: page.newestKnownAt,
    ping: page.summary === null ? null : { segment: pingSegment(page.summary.pingSegment), fanSilenceDays: page.summary.fanSilenceDays },
    truncated: false,
  };
}

export type OlderPageOutcome = { readonly kind: 'appended'; readonly state: FeedState } | { readonly kind: 'ignored'; readonly reason: 'cursor' | 'snapshot' };

/**
 * An older page behind `cursor`. It is appended only when `cursor` is the one
 * the feed is waiting on and the page is of the feed's own snapshot: a page
 * of another snapshot would splice two histories together.
 */
export function olderFeedPage(state: FeedState, cursor: string, page: FeedPage): OlderPageOutcome {
  if (state.nextOlderCursor === null || cursor !== state.nextOlderCursor) return { kind: 'ignored', reason: 'cursor' };
  if (page.snapshotRevision !== state.snapshotRevision) return { kind: 'ignored', reason: 'snapshot' };
  const seen = new Set(state.items.map((item) => item.messageId));
  const items = [...state.items];
  for (const item of page.items) {
    if (seen.has(item.messageId)) continue;
    seen.add(item.messageId);
    items.push(item);
  }
  const room = STORAGE_LIMITS.listVisibleRows;
  const cut = items.length >= room;
  return {
    kind: 'appended',
    state: {
      ...state,
      items: items.slice(0, room),
      nextOlderCursor: cut ? null : page.nextOlderCursor,
      truncated: cut && (page.nextOlderCursor !== null || items.length > room),
    },
  };
}

/**
 * How far the archive is behind the chat: the hub knows of a message newer
 * than the archive's head. `minutes: null` — behind by an unknown amount (the
 * archive has no head yet). null — no lag known.
 */
export function archiveLag(state: FeedState): { readonly minutes: number | null } | null {
  if (state.newestKnownAt === null) return null;
  const newest = Date.parse(state.newestKnownAt);
  if (Number.isNaN(newest)) return null;
  if (state.head === null) return state.items.length === 0 ? { minutes: null } : null;
  if (state.head.at === null) return null;
  const head = Date.parse(state.head.at);
  if (Number.isNaN(head) || newest <= head) return null;
  return { minutes: Math.max(1, Math.ceil((newest - head) / 60_000)) };
}

export interface FeedRow {
  readonly id: string;
  readonly at: IsoTimestamp | null;
  readonly sender: FeedSender;
  readonly text: string;
  readonly deleted: boolean;
  readonly automatic: boolean | null;
  readonly tip: MoneyMills | null;
  /** A priced message; whether it was bought the archive does not say (null). */
  readonly price: { readonly mills: MoneyMills | null; readonly purchased: boolean | null } | null;
  readonly attachments: readonly string[];
  readonly dayBreak: boolean;
}

/**
 * Rows in reading order (oldest first) with day separators. `dayOf` gives the
 * person's calendar day of an instant (the I18n port's day label); a message
 * without a time never starts a day.
 *
 * The hub sends a deleted message as a tombstone: `deleted: true`, the text
 * empty. A bubble keeps its row and says «сообщение удалено» under itself
 * (the UI's caption); a SYSTEM line is nothing but its text, so a deleted one
 * gets `deletedLine` — those words — as its text, and a system line that has
 * nothing to say (no text, not deleted, or no words given) is not a row: the
 * feed never draws an empty block.
 */
export function feedRows(state: FeedState, dayOf: (at: IsoTimestamp) => string, deletedLine = ''): FeedRow[] {
  const rows: FeedRow[] = [];
  let lastDay: string | null = null;
  for (let i = state.items.length - 1; i >= 0; i -= 1) {
    const item = state.items[i] as FeedItem;
    const sender = feedSender(item.sender);
    const text = sender === 'system' && item.text === '' && item.deleted ? deletedLine : item.text;
    if (sender === 'system' && text === '') continue;
    const day = item.at === null ? null : dayOf(item.at);
    const dayBreak = day !== null && day !== lastDay;
    if (day !== null) lastDay = day;
    rows.push({
      id: item.messageId,
      at: item.at,
      sender,
      text,
      deleted: item.deleted,
      automatic: item.automatic,
      tip: item.tipMills !== null && item.tipMills > 0 ? item.tipMills : null,
      price: item.priceMills === null ? null : { mills: item.priceMills, purchased: null },
      attachments: item.attachmentLabels,
      dayBreak,
    });
  }
  return rows;
}

// ── Kept feeds (§9.4: ten feeds of a hundred messages, two MiB) ────────────

/** Rough bytes of a kept feed: its texts as UTF-16 plus a fixed share per row. */
export function feedBytes(state: FeedState): number {
  let bytes = 256;
  for (const item of state.items) {
    bytes += 160 + item.text.length * 2;
    for (const label of item.attachmentLabels) bytes += label.length * 2;
  }
  return bytes;
}

/**
 * What is kept of a feed once its preview closes: the newest page only, with
 * the cursor that continues exactly behind it. Older pages are read again
 * when the person scrolls up: a cut in the middle of a page has no cursor.
 */
export interface KeptFeed {
  readonly key: string;
  readonly first: FeedState;
  readonly keptAt: number;
}

/** Keeps `feed` as the most recent one and drops the oldest beyond the count and byte caps. */
export function keepFeed(kept: readonly KeptFeed[], feed: KeptFeed): KeptFeed[] {
  const first: FeedState = { ...feed.first, items: feed.first.items.slice(0, STORAGE_LIMITS.previewFeedMessages) };
  const cut = first.items.length < feed.first.items.length;
  // A page cut short has no cursor behind its last kept row: the next open reads the first page again.
  const entry: KeptFeed = { ...feed, first: cut ? { ...first, nextOlderCursor: null, truncated: false } : first };
  const next = [entry, ...kept.filter((other) => other.key !== feed.key)].slice(0, STORAGE_LIMITS.previewFeeds);
  let bytes = 0;
  const out: KeptFeed[] = [];
  for (const candidate of next) {
    bytes += feedBytes(candidate.first);
    if (bytes > STORAGE_LIMITS.previewFeedsTotalBytes && out.length > 0) break;
    out.push(candidate);
  }
  return out;
}
