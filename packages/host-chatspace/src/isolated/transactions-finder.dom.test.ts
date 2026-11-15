import { describe, expect, it } from 'vitest';

import { transactionRowOf } from './transactions-finder';

const minute = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function window(rows: readonly (readonly [string, string, string, string])[]): Element {
  document.body.innerHTML = `<div role="dialog"><table><thead><tr><th>Date &amp; Time</th><th>Amount</th><th>Net</th><th>Description</th></tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
  return document.querySelector('[role="dialog"]') as Element;
}

const occurredAt = '2026-11-12T22:12:00.000Z';
/** The sale's day as ChatSpace prints it in this browser's zone. */
const printedDay = new Date(occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const sale = { platformRef: null, occurredAt, netMills: 14400, grossMills: 18000, fanName: 'Mason', fanHandle: null };

describe('transactionRowOf: the sale\'s row in ChatSpace\'s transactions window, never a similar one', () => {
  it('takes the one row with its minute, its amount and its fan', () => {
    const shown = window([
      [`${printedDay}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
      [`${printedDay}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Lucas'],
    ]);
    expect(transactionRowOf(shown, sale)?.textContent).toContain('Mason');
  });

  it('says nothing when two rows are alike or none has all three', () => {
    const twins = window([
      [`${printedDay}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
      [`${printedDay}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Tip from Mason'],
    ]);
    expect(transactionRowOf(twins, sale)).toBeNull();
    const other = window([[`${printedDay}, ${minute(occurredAt)}`, '$25.00', '$20.00', 'Tip from Mason']]);
    expect(transactionRowOf(other, sale)).toBeNull();
  });

  it('[A8] never takes a row of another day with the same fan, amount and minute; a row without a readable date as before', () => {
    const local = new Date(occurredAt);
    const day = (shift: number): string => new Date(local.getFullYear(), local.getMonth(), local.getDate() + shift).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const otherDay = window([[`${day(1)}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason']]);
    expect(transactionRowOf(otherDay, sale)).toBeNull();
    const sameDay = window([
      [`${day(1)}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
      [`${day(0)}, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
    ]);
    expect(transactionRowOf(sameDay, sale)?.textContent).toContain(day(0));
    const noDate = window([[`${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason']]);
    expect(transactionRowOf(noDate, sale)).not.toBeNull();
  });
});
