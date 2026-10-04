// The palette's search (architecture.md §6.9; HK-036, CS-006): over what is
// already in memory — ChatSpace's loaded lists, the hub rows the tab already
// read — never a request per keystroke. Every word of the query must be found
// in a row; a match at the start of a word outranks one inside it; the first
// field (the name) outranks the second (the @handle). The matched ranges of
// the label are returned for the underline.

export interface SearchRow<T> {
  readonly value: T;
  /** What the row prints. */
  readonly label: string;
  /** Searched too, never underlined: the @handle, an id. */
  readonly extra?: readonly string[];
}

export interface SearchHit<T> {
  readonly value: T;
  readonly score: number;
  /** [start, end) pairs over `label`, merged and ordered. */
  readonly match: readonly (readonly [number, number])[];
}

/** Lower case, one space between words, no leading «@». */
export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim().replace(/^@+/, '');
}

const words = (query: string): string[] => (query === '' ? [] : query.split(' ').map((word) => word.replace(/^@+/, '')).filter((word) => word !== ''));

const isWordStart = (text: string, at: number): boolean => at === 0 || /[\s@._\-/]/.test(text.charAt(at - 1));

/** Best place of `word` in `text`: a word start if there is one, else the first occurrence. */
function find(text: string, word: string): { readonly at: number; readonly start: boolean } | null {
  let from = 0;
  let first = -1;
  for (;;) {
    const at = text.indexOf(word, from);
    if (at === -1) break;
    if (first === -1) first = at;
    if (isWordStart(text, at)) return { at, start: true };
    from = at + 1;
  }
  return first === -1 ? null : { at: first, start: false };
}

function merge(ranges: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** One row against the normalized query; null — some word of the query is nowhere in the row. */
export function matchRow<T>(row: SearchRow<T>, query: string): SearchHit<T> | null {
  const label = row.label.toLocaleLowerCase();
  // Lower-casing may change the length of a few characters; ranges are only safe when it did not.
  const rangesSafe = label.length === row.label.length;
  const extras = (row.extra ?? []).map((text) => text.toLocaleLowerCase());
  let score = 0;
  const ranges: (readonly [number, number])[] = [];
  for (const word of words(query)) {
    const inLabel = find(label, word);
    if (inLabel !== null) {
      score += inLabel.start ? 4 : 2;
      if (inLabel.at === 0) score += 1;
      ranges.push([inLabel.at, inLabel.at + word.length]);
      continue;
    }
    const inExtra = extras.map((text) => find(text, word)).find((found) => found !== null) ?? null;
    if (inExtra === null) return null;
    score += inExtra.start ? 2 : 1;
  }
  return { value: row.value, score, match: rangesSafe ? merge(ranges) : [] };
}

/**
 * Rows that match, best first; rows of equal score keep their order (the
 * list order the person already knows). An empty query matches everything.
 */
export function searchRows<T>(rows: readonly SearchRow<T>[], rawQuery: string, limit: number): SearchHit<T>[] {
  const query = normalizeQuery(rawQuery);
  const hits: (SearchHit<T> & { readonly order: number })[] = [];
  rows.forEach((row, order) => {
    const hit = matchRow(row, query);
    if (hit !== null) hits.push({ ...hit, order });
  });
  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.slice(0, Math.max(0, limit)).map(({ value, score, match }) => ({ value, score, match }));
}
