// A row of the Spenders board (architecture.md §8.5; SP-006, SP-012,
// SP-014…SP-017): one fan of one hub page as `/api/v2/spenders` ranks it.
// Money stays integer mills (null — unknown, never 0); nothing here formats.
// The name is the page alias, then the display name, then the @handle; a fan
// the hub knows only by id is shown by that id.

import { type HubSpenderPeriod, type SpenderListItem } from '@cg/contracts/hub';
import { type IsoTimestamp, type MoneyMills } from '@cg/contracts/primitives';

/** A fan whose lifetime is within a dollar of the period's spend made the first purchase inside the period (SP-014). */
export const NEW_SPENDER_EPSILON_MILLS = 1000;

/** How much of the fan's thread the hub archive holds (SP-016, SP-020 «Доступная история»). */
export type RowHistory = 'complete' | 'partial' | 'none';

export interface SpenderRow {
  /** OnlyFans fan id = hub fanRef = ChatSpace chat id. */
  readonly fanRef: string;
  /**
   * The hub's conversation of the fan's chat (`conversation.platformConversationId`; R20 P8a): on Fansly the group,
   * where the hub's capture knows one; null — it knows none. Where a chat is its fan (OnlyFans) nothing reads it.
   */
  readonly conversationRef: string | null;
  readonly name: string;
  /** Without the «@»; null — unknown. */
  readonly username: string | null;
  readonly lifetime: MoneyMills | null;
  /** Spent in the board's period; for the lifetime board it is the lifetime itself. */
  readonly period: MoneyMills | null;
  readonly isNew: boolean;
  readonly deleted: boolean;
  readonly weWroteAt: IsoTimestamp | null;
  readonly fanWroteAt: IsoTimestamp | null;
  /** The fan wrote last. */
  readonly waiting: boolean;
  readonly lastMessage: { readonly fromUs: boolean; readonly text: string } | null;
  readonly history: RowHistory;
  readonly storedMessages: number;
  /** The hub's retention status of the row; null — the row did not come from the ranked board. */
  readonly retention: SpenderListItem['retentionStatus'] | null;
  /** Position in the hub's ranking of this period (0 — the top spender). */
  readonly rank: number;
  /** Lower-cased alias, display name, @handle and id: what the search looks in (SP-019). */
  readonly haystack: string;
}

const time = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** The later of two instants; null only when both are unknown. */
function later(a: string | null, b: string | null): string | null {
  const ta = time(a);
  const tb = time(b);
  if (ta === null) return tb === null ? null : b;
  if (tb === null) return a;
  return tb > ta ? b : a;
}

/** The text the search and the row show for a fan: alias → display name → @handle → id. */
export function fanName(fan: Pick<SpenderListItem['fan'], 'pageAlias' | 'displayName' | 'username' | 'platformUserId'>): string {
  for (const candidate of [fan.pageAlias, fan.displayName, fan.username]) {
    const text = candidate?.trim();
    if (text !== undefined && text.length > 0) return text;
  }
  return fan.platformUserId;
}

/** One search form for both sides: NFKC, lower case, no surrounding space (an IME's full-width letters match too). */
export function normalizeSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/**
 * SP-014: the first purchase fell inside the period — the lifetime is the
 * period's spend, give or take a dollar. A lifetime board cannot tell, an
 * unknown amount cannot prove it: both are «not new».
 */
export function isNewSpender(lifetime: MoneyMills | null, period: MoneyMills | null, boardPeriod: HubSpenderPeriod): boolean {
  if (boardPeriod === 'lifetime' || lifetime === null || period === null) return false;
  if (period <= 0 || period > lifetime) return false;
  return lifetime - period < NEW_SPENDER_EPSILON_MILLS;
}

function historyOf(conversation: SpenderListItem['conversation']): RowHistory {
  if (conversation.storedMessageCount <= 0) return 'none';
  return conversation.messageCoverageStatus === 'complete' && conversation.messageBackfillComplete ? 'complete' : 'partial';
}

export function spenderRow(item: SpenderListItem, rank: number, boardPeriod: HubSpenderPeriod): SpenderRow {
  const conversation = item.conversation;
  const fanWroteAt = later(item.lastFanMessageAt, conversation.lastFanMessageAt);
  const weWroteAt = conversation.lastModelMessageAt;
  const fanAt = time(fanWroteAt);
  const weAt = time(weWroteAt);
  const waiting = fanAt !== null && (weAt === null || fanAt > weAt);
  const lifetime = item.metrics.lifetime.scopeGrossAmountMills;
  const period = boardPeriod === 'lifetime' ? lifetime : (item.metrics.window?.grossAmountMills ?? null);
  const preview = conversation.lastMessagePreview?.trim() ?? '';
  const username = item.fan.username?.trim() ?? '';
  const name = fanName(item.fan);
  return {
    fanRef: item.fan.platformUserId,
    conversationRef: conversation.platformConversationId,
    name,
    username: username.length > 0 ? username.replace(/^@/, '') : null,
    lifetime,
    period,
    isNew: isNewSpender(lifetime, period, boardPeriod),
    // `/api/v2/spenders` carries no deletion mark for a fan (the old `pageTopSpenders` did): nothing to show yet.
    deleted: false,
    weWroteAt,
    fanWroteAt,
    waiting,
    // Who wrote last decides the «Мы: » prefix; an unknown order shows the text without it.
    lastMessage: preview.length === 0 ? null : { fromUs: weAt !== null && (fanAt === null || weAt >= fanAt), text: preview },
    history: historyOf(conversation),
    storedMessages: conversation.storedMessageCount,
    retention: item.retentionStatus,
    rank,
    haystack: normalizeSearch([item.fan.pageAlias, item.fan.displayName, item.fan.username, item.fan.platformUserId].filter((part) => part !== null).join('\n')),
  };
}

/** Rows of a board in the hub's ranking order; a fan listed twice keeps its first (higher) place. */
export function spenderRows(items: readonly SpenderListItem[], boardPeriod: HubSpenderPeriod): SpenderRow[] {
  const seen = new Set<string>();
  const rows: SpenderRow[] = [];
  for (const item of items) {
    const id = item.fan.platformUserId;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(spenderRow(item, rows.length, boardPeriod));
  }
  return rows;
}
