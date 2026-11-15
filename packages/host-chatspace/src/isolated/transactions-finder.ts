// «Show on the site» on ChatSpace (hub package R, 2026-11-15; R-board §6): the sale's row in ChatSpace's window of an
// account's OnlyFans transactions. ChatSpace live is closed to agents (the owner's rule): this is built from the
// documents only (docs/research/onlymonster-chatspace/product-features.md §2.8: a window over ChatSpace with the columns
// Date & Time, Amount, Net, Description, Inbox; `data-testid="transactions-summary"` at its head since 0.172.0). So it
// looks for that window by its own marks and by its column words, never by a guess at a class:
//
// - The window: the element of `transactions-summary`'s dialog, or a dialog whose text has «Date & Time» and «Net».
//   Not open: a visible button of ChatSpace named «Transactions» (its text, title or aria-label) is pressed once.
// - The row: OnlyFans prints no transaction number there, so a row is the sale's only when its day and time (this
//   browser's zone, «Nov 12, 2026, 22:30»; a row whose date cannot be read, by the time alone), its amount (what the fan
//   paid or what is left) and its fan are all in it, and exactly one row of
//   the window has them. «Load more» / «Next» of the window is pressed while the row is not there, a few times.
// - Anything else — no window, no button, two rows alike — is «not found»: the bar says so; a similar row is never framed.

import { fanIn, localMinute, millsOf, onlyOne, waitFor, type SaleToFind } from '@cg/host-kit/isolated/row-finder';

/** How OnlyFans' statement shows a sale: its own words of each kind; no number, the time instead. */
export const ONLYFANS_SALE_LOOK = { words: { media: 'Payment for message from', message: 'Payment for message from', subscription: 'Subscription from', tip: 'Tip from' }, number: false } as const;

/** Pages of the window looked at, at most. */
export const TRANSACTIONS_PAGES_MAX = 10;
const OPEN_WAIT_MS = 8_000;
const PAGE_WAIT_MS = 6_000;

const visible = (node: Element): boolean => {
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** ChatSpace's open transactions window; null — not open. */
export function transactionsWindow(doc: Document): Element | null {
  const summary = doc.querySelector('[data-testid="transactions-summary"]');
  const byMark = summary?.closest('[role="dialog"], .p-dialog, dialog') ?? null;
  if (byMark !== null && visible(byMark)) return byMark;
  for (const dialog of doc.querySelectorAll('[role="dialog"], .p-dialog, dialog')) {
    const text = dialog.textContent ?? '';
    if (visible(dialog) && text.includes('Date & Time') && /\bNet\b/.test(text)) return dialog;
  }
  return null;
}

/** ChatSpace's own button that opens the window; null — none on this page. */
function opener(doc: Document): HTMLElement | null {
  for (const node of doc.querySelectorAll<HTMLElement>('button, [role="button"], a')) {
    const words = [node.textContent, node.getAttribute('title'), node.getAttribute('aria-label')].map((part) => part?.trim() ?? '');
    if (words.some((word) => /^transactions$/i.test(word)) && visible(node)) return node;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** The row's date as ChatSpace prints it («Nov 12, 2026, 22:12»), `YYYY-MM-DD`; null — none readable here. */
export function rowDate(text: string): string | null {
  const match = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(text);
  if (match === null) return null;
  const month = MONTHS.indexOf((match[1] ?? '').toLowerCase()) + 1;
  const day = Number(match[2]);
  if (month < 1 || day < 1 || day > 31) return null;
  return `${match[3] ?? ''}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** The sale's day in this browser's zone, as the row prints its time. */
function localDay(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${String(at.getFullYear())}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

const rowsOf = (window: Element): Element[] => [...window.querySelectorAll('tbody tr, [role="row"]')].filter((row) => !/Date & Time/.test(row.textContent ?? ''));

/**
 * The sale's row in the window: its day, its minute, its amount and its fan, exactly one (round 1, A8: a sale of 14 Nov
 * never lights a row of 15 Nov). A row whose date cannot be read here is compared as before, by the other three.
 */
export function transactionRowOf(window: Element, sale: SaleToFind): Element | null {
  const minute = localMinute(sale.occurredAt);
  if (minute === null) return null;
  const day = localDay(sale.occurredAt);
  return onlyOne(rowsOf(window), (row) => {
    const text = row.textContent ?? '';
    if (!text.includes(minute) || !fanIn(text, sale)) return false;
    const printed = rowDate(text);
    if (printed !== null && day !== null && printed !== day) return false;
    const cells = [...row.querySelectorAll('td, [role="cell"]')].map((cell) => millsOf(cell.textContent ?? ''));
    return cells.includes(sale.grossMills ?? Number.NaN) || cells.includes(sale.netMills);
  });
}

/** Finds the sale's row in ChatSpace's transactions window, opening it if its button is there; null — not found. */
export async function findTransactionRow(win: Window, sale: SaleToFind): Promise<Element | null> {
  const doc = win.document;
  let window = transactionsWindow(doc);
  if (window === null) {
    const button = opener(doc);
    if (button === null) return null;
    button.click();
    window = await waitFor(win, () => transactionsWindow(doc), OPEN_WAIT_MS);
    if (window === null) return null;
  }
  const shown = window;
  // The rows come a moment after the window.
  await waitFor(win, () => (rowsOf(shown).length > 0 ? true : null), OPEN_WAIT_MS);
  for (let page = 0; page < TRANSACTIONS_PAGES_MAX; page += 1) {
    const row = transactionRowOf(shown, sale);
    if (row !== null) return row;
    const more = [...shown.querySelectorAll<HTMLElement>('button')].find((button) => /^(load more|show more|next|next page)$/i.test((button.textContent ?? button.getAttribute('aria-label') ?? '').trim()) && !(button as HTMLButtonElement).disabled);
    if (more === undefined) return null;
    const count = rowsOf(shown).length;
    const first = rowsOf(shown)[0]?.textContent ?? '';
    more.click();
    if ((await waitFor(win, () => (rowsOf(shown).length !== count || (rowsOf(shown)[0]?.textContent ?? '') !== first ? true : null), PAGE_WAIT_MS)) === null) return null;
  }
  return null;
}
