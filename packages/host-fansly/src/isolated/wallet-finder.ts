// «Show on the site» on Fansly (hub package R, 2026-11-15; R-board §6): the sale's row in the creator's «Wallet
// history» (docs/research/fansly/wallet-history.md, seen live 2026-11-15).
//
// - The page: `/creator/wallet/history`, opened without a reload the way the site's own router reads it
//   (`history.pushState` and a `popstate` with `state: null`, as navigate.ts opens a chat). Nothing is requested of
//   Fansly by us: the page loads its own list as for a click.
// - The row: `app-creator-wallet-transaction-history .tx-row`; Fansly prints the transaction's own number in
//   `span.tx-id` («#981337562090745305»): the row is found by it. A sale without the number (Hub holds none) is found
//   by its minute, its amount and its fan together, and only when exactly one row of the page matches.
// - Pages: 10 rows a page, newest first. While the row is not there, «Next page» is pressed (the site's own button),
//   until the page's oldest row is older than the sale, the last page, or WALLET_PAGES_MAX pages.

import { fanIn, localMinute, millsOf, onlyOne, waitFor, type SaleToFind } from '@cg/host-kit/isolated/row-finder';

export const WALLET_HISTORY_PATH = '/creator/wallet/history';
/** How Wallet history shows a sale: Fansly's own words of each kind, and the transaction's number printed. */
export const FANSLY_SALE_LOOK = { words: { media: 'Media Sale to', message: 'Media Sale to', subscription: 'Subscription Sale to', tip: 'Tip from' }, number: true } as const;
const LIST = 'app-creator-wallet-transaction-history';
const ROW = `${LIST} .tx-row`;
/** How far back the finder pages at most (10 rows a page). */
export const WALLET_PAGES_MAX = 30;
/** How long the list may take to come (the site loads it as the page opens). */
const LIST_WAIT_MS = 12_000;
/** How long a page change may take. */
const PAGE_WAIT_MS = 8_000;

const MONTHS: Readonly<Record<string, number>> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** A row's printed time («Oct 10, 2026, 12:18», this browser's zone) as epoch ms; null — not that form. */
export function walletRowTime(text: string): number | null {
  const match = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})/.exec(text);
  const month = match === null ? undefined : MONTHS[match[1] ?? ''];
  if (match === null || month === undefined) return null;
  return new Date(Number(match[3]), month, Number(match[2]), Number(match[4]), Number(match[5])).getTime();
}

const idOfRow = (row: Element): string | null => row.querySelector('.tx-id')?.textContent?.trim().replace(/^#/, '') ?? null;
const timeOfRow = (row: Element): number | null => walletRowTime(row.querySelector('.tx-meta')?.textContent ?? '');

/** The sale's row on the page shown now; null — not on it. */
export function walletRowOf(doc: Document, sale: SaleToFind): Element | null {
  const rows = [...doc.querySelectorAll(ROW)];
  if (sale.platformRef !== null) return rows.find((row) => idOfRow(row) === sale.platformRef) ?? null;
  const minute = localMinute(sale.occurredAt);
  return onlyOne(rows, (row) => {
    const text = row.textContent ?? '';
    const at = timeOfRow(row);
    return minute !== null && at !== null && localMinute(new Date(at).toISOString()) === minute && millsOf(row.querySelector('.tx-amount')?.textContent ?? '') === sale.netMills && fanIn(text, sale);
  });
}

/** Opens Wallet history in this tab without a reload, if it is not shown. */
function openHistory(win: Window): void {
  if (win.location.pathname === WALLET_HISTORY_PATH) return;
  win.history.pushState(null, '', WALLET_HISTORY_PATH);
  win.dispatchEvent(new PopStateEvent('popstate', { state: null }));
}

/** Finds the sale's row in Wallet history, paging on while it is not there; null — not found (never a similar row). */
export async function findWalletRow(win: Window, sale: SaleToFind): Promise<Element | null> {
  const doc = win.document;
  openHistory(win);
  if ((await waitFor(win, () => (doc.querySelector(ROW) === null ? null : true), LIST_WAIT_MS)) === null) return null;
  // The first page: the site may still be on another page of its pager from earlier.
  const first = doc.querySelector<HTMLButtonElement>(`${LIST} .pager button.pager-num`);
  if (first !== null && first.getAttribute('aria-current') !== 'page' && first.textContent?.trim() === '1') {
    const before = idOfRow(doc.querySelector(ROW) as Element);
    first.click();
    await waitFor(win, () => (idOfRow(doc.querySelector(ROW) ?? doc.body) !== before ? true : null), PAGE_WAIT_MS);
  }
  const saleAt = Date.parse(sale.occurredAt);
  for (let page = 0; page < WALLET_PAGES_MAX; page += 1) {
    const row = walletRowOf(doc, sale);
    if (row !== null) return row;
    const rows = [...doc.querySelectorAll(ROW)];
    const oldest = rows.length === 0 ? null : timeOfRow(rows[rows.length - 1] as Element);
    // Newest first: a page that already ends before the sale (a minute's margin) has nothing older to show.
    if (oldest !== null && Number.isFinite(saleAt) && oldest < saleAt - 60_000) return null;
    const next = doc.querySelector<HTMLButtonElement>(`${LIST} .pager button[aria-label="Next page"]`);
    if (next === null || next.disabled) return null;
    const before = rows.length === 0 ? null : idOfRow(rows[0] as Element);
    next.click();
    if ((await waitFor(win, () => { const top = doc.querySelector(ROW); return top !== null && idOfRow(top) !== before ? true : null; }, PAGE_WAIT_MS)) === null) return null;
  }
  return null;
}
