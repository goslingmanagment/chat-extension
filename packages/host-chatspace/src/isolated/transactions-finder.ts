// «Show on the site» on ChatSpace (hub package R, 2026-11-15; R-board §6): the sale's row in ChatSpace's window of an
// account's OnlyFans transactions. ChatSpace live is closed to agents (the owner's rule): this is built from the
// documents only (docs/research/onlymonster-chatspace/product-features.md §2.8: a window over ChatSpace with the columns
// Date & Time, Amount, Net, Description, Inbox; `data-testid="transactions-summary"` at its head since 0.172.0). So it
// looks for that window by its own marks and by its column words, never by a guess at a class:
//
// - The window: the element of `transactions-summary`'s dialog, or a dialog whose text has «Date & Time» and «Net».
//   Not open: a visible button of ChatSpace named «Transactions» (its text, title or aria-label) is pressed once.
// - The row: OnlyFans prints no transaction number there, so a row is the sale's only when its time (this browser's
//   zone, «22:30»), its amount (what the fan paid or what is left) and its fan are all in it, and exactly one row of
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

const rowsOf = (window: Element): Element[] => [...window.querySelectorAll('tbody tr, [role="row"]')].filter((row) => !/Date & Time/.test(row.textContent ?? ''));

/** The sale's row in the window: its minute, its amount and its fan, exactly one. */
export function transactionRowOf(window: Element, sale: SaleToFind): Element | null {
  const minute = localMinute(sale.occurredAt);
  if (minute === null) return null;
  return onlyOne(rowsOf(window), (row) => {
    const text = row.textContent ?? '';
    if (!text.includes(minute) || !fanIn(text, sale)) return false;
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
