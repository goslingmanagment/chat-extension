// Search, filters and sorting of the Spenders board (SP-018…SP-020). The
// search looks in the alias, the display name, the @handle and the fan id,
// in one normalized form (an IME's full-width letters and any case match).
// Filters come in four groups with one pressed at a time in each: the main
// row (все / ждут ответа / новые), «Последнее сообщение» (мы / фан),
// «Доступная история» (есть / нет) and the fan's silence (8–21 days, more
// than 21; §8.7). The sorts are the table's headers (1.44.0): «Потратил» by
// the lifetime sum, «Ждёт ответа» the longest waiting first, «Мы писали» the
// longest since our message first, the period's sum; unknown last in each.

import { type SpendersFilter, type SpendersSort } from '@cg/contracts/vm';

import { normalizeSearch, type SpenderRow } from './rows';

export type MainFilter = 'all' | 'waiting' | 'new';
export type LastMessageFilter = 'we-wrote' | 'fan-wrote';
export type HistoryFilter = 'history' | 'no-history';
export type SilenceFilter = 'silent-8-21' | 'silent-over-21';

export interface BoardFilters {
  readonly main: MainFilter;
  readonly lastMessage: LastMessageFilter | null;
  readonly history: HistoryFilter | null;
  readonly silence: SilenceFilter | null;
}

export const NO_FILTERS: BoardFilters = { main: 'all', lastMessage: null, history: null, silence: null };

export function filtersActive(filters: BoardFilters): boolean {
  return filters.main !== 'all' || filters.lastMessage !== null || filters.history !== null || filters.silence !== null;
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
    case 'silent-8-21':
    case 'silent-over-21':
      return { ...filters, silence: filters.silence === pressed ? null : pressed };
  }
}

export function filterPressed(filters: BoardFilters, id: SpendersFilter): boolean {
  if (id === 'all') return !filtersActive(filters);
  return filters.main === id || filters.lastMessage === id || filters.history === id || filters.silence === id;
}

const DAY_MS = 86_400_000;

/**
 * §8.7 «Молчание»: whole days since the fan's last message; null — the fan never wrote, or when is unknown (the
 * statistics' «Нет переписки»). A message «from the future» (clocks apart) is zero days old.
 */
export function silentDays(row: Pick<SpenderRow, 'fanWroteAt'>, now: number): number | null {
  const at = timeOf(row.fanWroteAt);
  return at === null ? null : Math.floor(Math.max(0, now - at) / DAY_MS);
}

/** Whether one filter button alone takes the row; `now` — the clock the fan's silence is counted to. */
export function rowPasses(row: SpenderRow, id: SpendersFilter, now: number): boolean {
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
    case 'silent-8-21': {
      const days = silentDays(row, now);
      return days !== null && days >= 8 && days <= 21;
    }
    case 'silent-over-21': {
      const days = silentDays(row, now);
      return days !== null && days > 21;
    }
  }
}

export function rowMatches(row: SpenderRow, filters: BoardFilters, needle: string, now: number): boolean {
  if (needle.length > 0 && !row.haystack.includes(needle)) return false;
  if (filters.main !== 'all' && !rowPasses(row, filters.main, now)) return false;
  if (filters.lastMessage !== null && !rowPasses(row, filters.lastMessage, now)) return false;
  if (filters.history !== null && !rowPasses(row, filters.history, now)) return false;
  if (filters.silence !== null && !rowPasses(row, filters.silence, now)) return false;
  return true;
}

/** The search text as it is compared: normalized, without a leading «@». */
export function searchNeedle(query: string): string {
  return normalizeSearch(query).replace(/^@+/, '');
}

/** How many loaded rows each filter button would show on its own. */
export function filterCounts(rows: readonly SpenderRow[], ids: readonly SpendersFilter[], now: number): Record<SpendersFilter, number> {
  const counts = Object.fromEntries(ids.map((id) => [id, 0])) as Record<SpendersFilter, number>;
  for (const row of rows) {
    for (const id of ids) if (rowPasses(row, id, now)) counts[id] += 1;
  }
  return counts;
}

function timeOf(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Earlier first; unknown after every known one. */
function compareAscending(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** Richest first; an unknown sum after every known one; ties keep the hub's ranking. */
export function compareBySum(a: SpenderRow, b: SpenderRow): number {
  if (a.lifetime !== b.lifetime) {
    if (a.lifetime === null) return 1;
    if (b.lifetime === null) return -1;
    return b.lifetime - a.lifetime;
  }
  return a.rank - b.rank;
}

/** «Ждёт ответа»: the fan whose message is the oldest — who waits the longest — first; unknown last; ties by the sum. */
export function compareByWaiting(a: SpenderRow, b: SpenderRow): number {
  return compareAscending(timeOf(a.fanWroteAt), timeOf(b.fanWroteAt)) || compareBySum(a, b);
}

/** «Мы писали»: the longest since our last message first; never or unknown last; ties by the sum. */
export function compareByWeWrote(a: SpenderRow, b: SpenderRow): number {
  return compareAscending(timeOf(a.weWroteAt), timeOf(b.weWroteAt)) || compareBySum(a, b);
}

/** The period's column: the most spent in the period first; unknown last; ties by the sum. */
export function compareByPeriod(a: SpenderRow, b: SpenderRow): number {
  const pa = a.period === null ? null : -a.period;
  const pb = b.period === null ? null : -b.period;
  return compareAscending(pa, pb) || compareBySum(a, b);
}

const COMPARE: Readonly<Record<SpendersSort, (a: SpenderRow, b: SpenderRow) => number>> = {
  sum: compareBySum,
  waiting: compareBySum,
  'we-wrote': compareByWeWrote,
  period: compareByPeriod,
};

/**
 * The rows in the sort's order. `waiting` is two groups (`groupRows`); taken whole it is the fans who wait first, the
 * longest waiting on top, then the rest by the sum.
 */
export function sortRows(rows: readonly SpenderRow[], sort: SpendersSort): SpenderRow[] {
  if (sort !== 'waiting') return [...rows].sort(COMPARE[sort]);
  const { waiting, rest } = waitingGroups(rows);
  return [...waiting, ...rest];
}

/** «Ждёт ответа»'s two groups: the fans who wait, the longest waiting first; the rest by the sum. */
export function waitingGroups(rows: readonly SpenderRow[]): { readonly waiting: SpenderRow[]; readonly rest: SpenderRow[] } {
  const waiting: SpenderRow[] = [];
  const rest: SpenderRow[] = [];
  for (const row of rows) (row.waiting ? waiting : rest).push(row);
  return { waiting: waiting.sort(compareByWaiting), rest: rest.sort(compareBySum) };
}
