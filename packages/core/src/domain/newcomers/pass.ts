// «Новые» checked by a background pass, as pure rules (R20 P10a; docs/project-unite/architecture.md §8.7, §8.17;
// NF-005, NF-006, NF-010): which rows «К обработке» holds, what each status filter takes, the search, how rows the
// pass tells about are merged, and the conversation's cap. Neutral words of a pass (application/newcomers/
// source.ts): no site is named; the site's own words for the statuses come with its surface.

import { type IsoTimestamp } from '@cg/contracts/primitives';
import { type NewcomerCheck, type NewcomerCheckFilter, type NewcomerDmClosed, type NewcomerMessageVM, type NewcomersFailureVM, type NewcomersPassPhase, type NewcomersTab } from '@cg/contracts/vm';

// ── What a source of a pass says (the port: application/newcomers/source.ts) ──

/** The pass's own states (the stage the window shows adds `connecting` and `failed`, vm/newcomers.ts). */
export type PassRunState = 'scanning' | 'queue' | 'paused' | 'cooldown' | 'done' | 'stopped';

/** The background's pass as the window needs it. */
export interface PassState {
  readonly passId: string;
  /** The creator the pass runs for: a pass of another account is nobody's here (NF-026). */
  readonly hostAccountId: string;
  readonly windowHours: number;
  readonly state: PassRunState;
  readonly phase: NewcomersPassPhase | null;
  readonly startedAt: IsoTimestamp;
  /** Rows of the pass, all of them; the window reads them a page at a time. */
  readonly total: number;
  readonly checked: number;
  /** «Результат неполный» (NF-025). */
  readonly partial: boolean;
  readonly cooldownUntil: number | null;
  /** Why it stopped. */
  readonly failure: NewcomersFailureVM | null;
}

/** One new follower as the pass knows them. */
export interface PassRow {
  readonly fanRef: string;
  /** The conversation (the site's id of the chat), once known; never the fan's id. */
  readonly conversationRef: string | null;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly customName: string | null;
  readonly bio: string | null;
  readonly followedAt: IsoTimestamp;
  readonly check: NewcomerCheck;
  readonly dmClosed: NewcomerDmClosed | null;
  readonly dmPriceMills?: number | null;
  readonly checkedAt: IsoTimestamp | null;
  /** `greeted`: the creator's personal message the pass found. */
  readonly proof: NewcomerMessageVM | null;
  /** `failed`: why. */
  readonly failure: NewcomersFailureVM | null;
  /** R20 P10c: the revision of the history the pass checked in full (FS-NEW-6, FS-NEW-7); null — not checked in full. Absent — not said. */
  readonly historyRevision?: string | null;
  /** X59: the fan's picture as the site gives it; absent or null — none. */
  readonly avatarUrl?: string | null;
}

/** A source's answer: the value, or a failure as a code — never a guess, never an empty list in its place (FX-017). */
export type SourceAnswer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: NewcomersFailureVM };

/** Applied by the source over the whole pass, before pagination. */
export interface PassQuery {
  readonly search: string;
  readonly tab: NewcomersTab;
  readonly filter: NewcomerCheckFilter;
}

/** After search: tabs over the whole pass; status filters over the chosen tab, before the selected filter. */
export interface PassCounts {
  readonly tabs: Readonly<Record<NewcomersTab, number>>;
  readonly filters: Readonly<Record<NewcomerCheckFilter, number>>;
}

export interface PassPage {
  /** null — the background holds no such pass any more (it ended, the event page restarted). */
  readonly pass: PassState | null;
  readonly rows: readonly PassRow[];
  /** Matches of the query before pagination; `pass.total` still counts the whole pass. */
  readonly total: number;
  /** null only when no such pass remains. */
  readonly counts: PassCounts | null;
  /** The last change the page includes; changes up to it are in it already. Absent — the source does not say. */
  readonly seq: number | null;
}

/** Rows of an open pass changed (FS-NEW-4: the background tells, the window never polls); `seq` grows by one per change. */
export interface PassChange {
  readonly pass: PassState;
  readonly seq: number;
  readonly rows: readonly PassRow[];
}

export interface PassHistoryPage {
  /** Newest first, as the site gives them. */
  readonly messages: readonly NewcomerMessageVM[];
  /** Older messages are there. */
  readonly more: boolean;
}


/**
 * «К обработке» (NF-006): whom the person can still act on — not written to already, not taken out of the queue. A
 * fan nobody can write to stays here until the person excludes them (FS-NEW-2), as with the old window.
 */
export function inPassTab(check: NewcomerCheck, tab: NewcomersTab): boolean {
  return tab === 'all' || (check !== 'greeted' && check !== 'excluded');
}

const FILTERED: Readonly<Record<Exclude<NewcomerCheckFilter, 'any'>, readonly NewcomerCheck[]>> = {
  ready: ['ready'],
  pending: ['pending'],
  reply: ['reply'],
  // Nothing proved about the chat yet: in the queue, being checked, read short of its start, or the check failed.
  unchecked: ['checking', 'pending', 'unverified', 'failed'],
  'dm-closed': ['dm-closed', 'excluded'],
  contacted: ['greeted'],
};

export function passesCheckFilter(check: NewcomerCheck, filter: NewcomerCheckFilter): boolean {
  return filter === 'any' || FILTERED[filter].includes(check);
}

/** A filter that takes only rows «К обработке» does not hold: choosing it shows «Все» (the old window's rule). */
export function filterLeavesTodo(filter: NewcomerCheckFilter): boolean {
  return filter === 'contacted';
}

export interface PassSearchable {
  readonly fanRef: string;
  readonly username: string | null;
  readonly displayName: string | null;
  readonly customName: string | null;
}

const fold = (text: string): string => text.normalize('NFKC').toLowerCase();

/** The search (NF-006): by the name, @username, the person's own name for the fan, or the fan's id. */
export function matchesPassSearch(row: PassSearchable, query: string): boolean {
  const needle = fold(query).trim().replace(/^@+/, '');
  if (needle.length === 0) return true;
  return [row.displayName, row.username, row.customName, row.fanRef].some((value) => value !== null && fold(value).includes(needle));
}

/** Nothing personal in a chat read to its start: a greeting may be written. The first fan the card shows is one of these. */
export function writable(check: NewcomerCheck): boolean {
  return check === 'ready' || check === 'reply';
}

/**
 * Whether the card may read the fan's conversation: the pass found it and gave its verdict. A fan still in the
 * queue, being checked, read short of its start or whose check failed has nothing proved to show (the card says so,
 * it asks for nothing); a fan with no conversation has none to read.
 */
export function historyReadable(check: NewcomerCheck, conversationRef: string | null): boolean {
  return conversationRef !== null && (check === 'ready' || check === 'reply' || check === 'greeted' || check === 'dm-closed' || check === 'excluded');
}

/**
 * Rows of a change merged into the list by fan: a known row is replaced where it stands; a new one joins at the end
 * only when the list on screen is read to its end (otherwise it comes with its page).
 */
export function mergePassRows<R extends { readonly fanRef: string }>(rows: readonly R[], changed: readonly R[], appendNew: boolean): R[] {
  if (changed.length === 0) return [...rows];
  const fresh = new Map(changed.map((row) => [row.fanRef, row]));
  const merged = rows.map((row) => {
    const next = fresh.get(row.fanRef);
    if (next === undefined) return row;
    fresh.delete(row.fanRef);
    return next;
  });
  return appendNew ? [...merged, ...fresh.values()] : merged;
}

/** A page of rows read at `offset`: the rows shown before it stay, a fan already shown is not doubled, the rest is the page's. */
export function placePassPage<R extends { readonly fanRef: string }>(rows: readonly R[], offset: number, page: readonly R[]): R[] {
  const head = rows.slice(0, offset);
  const seen = new Set(head.map((row) => row.fanRef));
  return [...head, ...page.filter((row) => !seen.has(row.fanRef))];
}

/**
 * The card's conversation, oldest first, never longer than `cap` (NF-010: 750, as the old window): an older page
 * (newest first, as the site gives it) goes before what is shown; past the cap the oldest are left out and the rest
 * is in the chat itself.
 */
export function prependHistory(
  shown: readonly NewcomerMessageVM[],
  olderNewestFirst: readonly NewcomerMessageVM[],
  cap: number,
): { readonly messages: NewcomerMessageVM[]; readonly truncated: boolean } {
  const known = new Set(shown.map((message) => message.id));
  const older = [...olderNewestFirst].filter((message) => !known.has(message.id)).reverse();
  const all = [...older, ...shown];
  return all.length > cap ? { messages: all.slice(all.length - cap), truncated: true } : { messages: all, truncated: false };
}
