import { describe, expect, it } from 'vitest';

import { walletRowOf, walletRowTime } from './wallet-finder';

/** Wallet history's rows as fansly.com drew them on 2026-11-15 (docs/research/fansly/wallet-history.md). */
function page(rows: readonly { id: string; at: string; amount: string; handle: string }[]): Document {
  document.body.innerHTML = `<app-creator-wallet-transaction-history><div class="tx-rows">${rows
    .map(
      (row) =>
        `<div class="tx-row"><div class="tx-main"><div class="tx-title"><span class="tx-label">Tip from</span><app-account-username><a><span class="display-name">${row.handle}</span><span class="user-name">@${row.handle}</span></a></app-account-username></div><div class="tx-meta"><span>${row.at}</span><span class="tx-id">#${row.id}</span></div></div><div class="tx-amount"><div class="tx-amount-value"><span class="tx-sign">+</span><app-balance-display>${row.amount}</app-balance-display></div></div></div>`,
    )
    .join('')}</div></app-creator-wallet-transaction-history>`;
  return document;
}

const at = (text: string): string => new Date(walletRowTime(text) ?? 0).toISOString();
const sale = { occurredAt: at('Nov 12, 2026, 22:30'), netMills: 48000, grossMills: null, fanName: 'Viggo', fanHandle: 'viggo' };

describe('walletRowOf: the sale\'s row in Wallet history, never a similar one', () => {
  it('finds the row by the transaction number the site prints', () => {
    const doc = page([
      { id: '981337562090745305', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'viggo' },
      { id: '981337562090745306', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'viggo' },
    ]);
    expect(walletRowOf(doc, { ...sale, platformRef: '981337562090745306' })?.querySelector('.tx-id')?.textContent).toBe('#981337562090745306');
    expect(walletRowOf(doc, { ...sale, platformRef: '981337562090740000' })).toBeNull();
  });

  it('without a number: time, amount and fan together, and only when exactly one row has them', () => {
    const one = page([
      { id: '1', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'viggo' },
      { id: '2', at: 'Nov 12, 2026, 22:30', amount: '24', handle: 'viggo' },
      { id: '3', at: 'Nov 12, 2026, 22:31', amount: '48', handle: 'viggo' },
    ]);
    expect(walletRowOf(one, { ...sale, platformRef: null })?.querySelector('.tx-id')?.textContent).toBe('#1');
    const two = page([
      { id: '1', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'viggo' },
      { id: '2', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'viggo' },
    ]);
    expect(walletRowOf(two, { ...sale, platformRef: null })).toBeNull();
    expect(walletRowOf(page([{ id: '1', at: 'Nov 12, 2026, 22:30', amount: '48', handle: 'juno' }]), { ...sale, platformRef: null })).toBeNull();
  });
});
