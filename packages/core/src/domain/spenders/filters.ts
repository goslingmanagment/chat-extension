// Search, filters and sorting of the Spenders board (SP-018…SP-020). The
// search looks in the alias, the display name, the @handle and the fan id,
// in one normalized form (an IME's full-width letters and any case match).
// Filters come in three groups with one pressed at a time in each: the main
// row (все / ждут ответа / новые), «Последнее сообщение» (мы / фан) and
// «Доступная история» (есть / нет). Inside a shelf rows go by the lifetime
// sum, or by how recently the fan wrote (unknown last).

import { type SpendersFilter, type SpendersSort } from '@cg/contracts/vm';

import { normalizeSearch, type SpenderRow } from './rows';

export type MainFilter = 'all' | 'waiting' | 'new';
export type LastMessageFilter = 'we-wrote' | 'fan-wrote';
export type HistoryFilter = 'history' | 'no-history';

export interface BoardFilters {
  readonly main: MainFilter;
  readonly lastMessage: LastMessageFilter | null;
  readonly history: HistoryFilter | null;
}

export const NO_FILTERS: BoardFilters = { main: 'all', lastMessage: null, history: null };

export function filtersActive(filters: BoardFilters): boolean {
  return filters.main !== 'all' || filters.lastMessage !== null || filters.history !== null;
}

/**
 * One press of a filter button: «Все» lifts every filter; a main filter
 * replaces the main one; a button of the other two groups presses itself and
 * releases its neighbour, and a second press releases it.
 */
export function pressFilter(filters: BoardFilters, pressed: SpendersFilter): BoardFilters {
  switch (pressed) {
    case 'all':
      return NO_FILTERS;
    case 'waiting':
    case 'new':
      return { ...filters, main: filters.main === pressed ? 'all' : pressed };
    case 'we-wrote':
    case 'fan-wrote':
      return { ...filters, lastMessage: filters.lastMessage === pressed ? null : pressed };
    case 'history':
    case 'no-history':
      return { ...filters, history: filters.history === pressed ? null : pressed };
  }
}

export function filterPressed(filters: BoardFilters, id: SpendersFilter): boolean {
  if (id === 'all') return !filtersActive(filters);
  return filters.main === id || filters.lastMessage === id || filters.history === id;
}

/** Whether one filter button alone takes the row. */
export function rowPasses(row: SpenderRow, id: SpendersFilter): boolean {
  switch (id) {
    case 'all':
      return true;
    case 'waiting':
      return row.waiting;
    case 'new':
      return row.isNew;
    case 'we-wrote':
      // We wrote last: there is a message of ours and the fan has not answered it.
      return row.weWroteAt !== null && !row.waiting;
    case 'fan-wrote':
      return row.waiting;
    case 'history':
      return row.history !== 'none';
    case 'no-history':
      return row.history === 'none';
  }
}

export function rowMatches(row: SpenderRow, filters: BoardFilters, needle: string): boolean {
  if (needle.length > 0 && !row.haystack.includes(needle)) return false;
  if (filters.main !== 'all' && !rowPasses(row, filters.main)) return false;
  if (filters.lastMessage !== null && !rowPasses(row, filters.lastMessage)) return false;
  if (filters.history !== null && !rowPasses(row, filters.history)) return false;
  return true;
}

/** The search text as it is compared: normalized, without a leading «@». */
export function searchNeedle(query: string): string {
  return normalizeSearch(query).replace(/^@+/, '');
}

/** How many loaded rows each filter button would show on its own. */
export function filterCounts(rows: readonly SpenderRow[], ids: readonly SpendersFilter[]): Record<SpendersFilter, number> {
  const counts = Object.fromEntries(ids.map((id) => [id, 0])) as Record<SpendersFilter, number>;
  for (const row of rows) {
    for (const id of ids) if (rowPasses(row, id)) counts[id] += 1;
  }
  return counts;
}

const timeOf = (iso: string | null): number | null => {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/** Richest first; an unknown sum after every known one; ties keep the hub's ranking. */
export function compareBySum(a: SpenderRow, b: SpenderRow): number {
  if (a.lifetime !== b.lifetime) {
    if (a.lifetime === null) return 1;
    if (b.lifetime === null) return -1;
    return b.lifetime - a.lifetime;
  }
  return a.rank - b.rank;
}

/** Who wrote most recently — higher; a fan who never wrote (or unknown) last (SP-018). */
export function compareByFanAge(a: SpenderRow, b: SpenderRow): number {
  const ta = timeOf(a.fanWroteAt);
  const tb = timeOf(b.fanWroteAt);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return compareBySum(a, b);
}

export function sortRows(rows: readonly SpenderRow[], sort: SpendersSort): SpenderRow[] {
  return [...rows].sort(sort === 'fan-age' ? compareByFanAge : compareBySum);
}
