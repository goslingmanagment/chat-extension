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
const sale = { platformRef: null, occurredAt, netMills: 14400, grossMills: 18000, fanName: 'Mason', fanHandle: null };

describe('transactionRowOf: the sale\'s row in ChatSpace\'s transactions window, never a similar one', () => {
  it('takes the one row with its minute, its amount and its fan', () => {
    const shown = window([
      [`Nov 12, 2026, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
      [`Nov 12, 2026, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Lucas'],
    ]);
    expect(transactionRowOf(shown, sale)?.textContent).toContain('Mason');
  });

  it('says nothing when two rows are alike or none has all three', () => {
    const twins = window([
      [`Nov 12, 2026, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Payment for message from Mason'],
      [`Nov 12, 2026, ${minute(occurredAt)}`, '$18.00', '$14.40', 'Tip from Mason'],
    ]);
    expect(transactionRowOf(twins, sale)).toBeNull();
    const other = window([[`Nov 12, 2026, ${minute(occurredAt)}`, '$25.00', '$20.00', 'Tip from Mason']]);
    expect(transactionRowOf(other, sale)).toBeNull();
  });
});
