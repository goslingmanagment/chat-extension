// The «Новые» window and its cursor pass (architecture.md §8.5 «Новые», hub
// H-7c; NF-003, NF-006, NF-025): 48 hours by default, the quick 24 / 48 / 72 /
// 168, any whole number of hours from 1 to 720 inside the hub's
// `limits.audienceWindowHours`. The window is fixed for a whole pass: a
// cursor is never continued with another window (the hub refuses it), a new
// window starts a new pass from the first page.

import { type AudienceNewItem, type AudienceNewPage } from '@cg/contracts/hub';
import { STORAGE_LIMITS } from '@cg/contracts/limits';
import { type CoverageLevel } from '@cg/contracts/ops';
import { type IsoTimestamp } from '@cg/contracts/primitives';

/** NEWCOMERS_WINDOW_HOURS of the contracts, repeated so this module loads no schema module (a test pins them equal). */
export const WINDOW_HOURS = { min: 1, max: 720, quick: [24, 48, 72, 168], default: 48 } as const;

/** Rows per page of the list (NF-006 «страницы по 100», the hub's cap). */
export const AUDIENCE_PAGE_SIZE = 100;

/** The widest window this hub allows; a missing or absurd limit falls back to the contract's bound. */
export function windowLimit(audienceWindowHours: number | null | undefined): number {
  if (audienceWindowHours === null || audienceWindowHours === undefined || !Number.isFinite(audienceWindowHours)) return WINDOW_HOURS.max;
  return Math.max(WINDOW_HOURS.min, Math.min(WINDOW_HOURS.max, Math.floor(audienceWindowHours)));
}

/** A window the hub will take: a whole number of hours inside 1…limit. */
export function clampWindow(hours: number, limitHours: number): number {
  if (!Number.isFinite(hours)) return Math.min(WINDOW_HOURS.default, limitHours);
  return Math.max(WINDOW_HOURS.min, Math.min(limitHours, Math.round(hours)));
}

/** The quick choices that fit the hub's limit. */
export function windowOptions(limitHours: number): number[] {
  return WINDOW_HOURS.quick.filter((hours) => hours <= limitHours);
}

const LEVELS = ['complete', 'partial', 'unknown'] as const satisfies readonly CoverageLevel[];
const level = (token: string): CoverageLevel => ((LEVELS as readonly string[]).includes(token) ? (token as CoverageLevel) : 'unknown');

/** One pass over the list: a fixed window, pages appended in cursor order. */
export interface AudienceWalk {
  readonly windowHours: number;
  /** One row per fan, newest subscription first. */
  readonly items: readonly AudienceNewItem[];
  /** Pages taken so far. */
  readonly pages: number;
  readonly nextCursor: string | null;
  /** The first page has answered. */
  readonly started: boolean;
  readonly snapshotAt: IsoTimestamp | null;
  readonly serverNow: IsoTimestamp | null;
  readonly coverage: CoverageLevel;
  /** The hub's reasons of an incomplete list (open tokens, for the debug journal only). */
  readonly reasons: readonly string[];
  /** Events the hub left out or could not classify: counted, not listed. */
  readonly unknownCount: number;
  /** The visible limit was reached with more behind the cursor. */
  readonly truncated: boolean;
}

export function startWalk(windowHours: number): AudienceWalk {
  return { windowHours, items: [], pages: 0, nextCursor: null, started: false, snapshotAt: null, serverNow: null, coverage: 'unknown', reasons: [], unknownCount: 0, truncated: false };
}

export type WalkStep = { readonly kind: 'appended'; readonly walk: AudienceWalk } | { readonly kind: 'ignored'; readonly reason: 'window' | 'cursor' };

/**
 * The page that answered `cursor`. A page of another window, or one that does
 * not answer the cursor the pass waits on (a late answer of an older pass),
 * changes nothing.
 */
export function appendAudiencePage(walk: AudienceWalk, cursor: string | null, page: AudienceNewPage): WalkStep {
  if (page.window.hours !== walk.windowHours) return { kind: 'ignored', reason: 'window' };
  if (walk.started ? cursor === null || cursor !== walk.nextCursor : cursor !== null) return { kind: 'ignored', reason: 'cursor' };
  const seen = new Set(walk.items.map((item) => item.fanRef));
  const items = [...walk.items];
  for (const item of page.items) {
    if (seen.has(item.fanRef)) continue;
    seen.add(item.fanRef);
    items.push(item);
  }
  const room = STORAGE_LIMITS.listVisibleRows;
  const cut = items.length >= room;
  return {
    kind: 'appended',
    walk: {
      windowHours: walk.windowHours,
      items: items.slice(0, room),
      pages: walk.pages + 1,
      nextCursor: cut ? null : page.nextCursor,
      started: true,
      snapshotAt: walk.started ? walk.snapshotAt : page.window.snapshotAt,
      serverNow: page.serverNow,
      coverage: walk.started && walk.coverage !== 'complete' ? walk.coverage : level(page.coverage.state),
      reasons: [...new Set([...walk.reasons, ...page.coverage.reasons])],
      unknownCount: Math.max(walk.unknownCount, page.unknownCount),
      truncated: cut && (page.nextCursor !== null || items.length > room),
    },
  };
}

export function walkHasMore(walk: AudienceWalk): boolean {
  return walk.started && walk.nextCursor !== null;
}

/** NF-025 «Результат неполный»: the list is cut, the coverage is not complete, or some events were left out. */
export function walkIncomplete(walk: AudienceWalk): boolean {
  return walk.started && (walk.truncated || walk.coverage !== 'complete' || walk.unknownCount > 0);
}
