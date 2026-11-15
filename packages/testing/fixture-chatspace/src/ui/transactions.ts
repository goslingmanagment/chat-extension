// ChatSpace's window of an account's OnlyFans transactions on the stand (hub package R, 2026-11-15). ChatSpace live is
// closed to agents, so this is the documents' shape, not a capture (docs/research/onlymonster-chatspace/
// product-features.md §2.8: a window over ChatSpace — Date & Time, Amount, Net, Description, Inbox; a summary at its
// head with `data-testid="transactions-summary"` since 0.172.0). The extension's finder reads exactly those marks
// (host-chatspace isolated/transactions-finder.ts); the markup of the real window may differ.
//
// The rows are invented, at fixed moments; the fake hub's board stub names the same sales (fake-hub/report-board.ts).

import { defineComponent, h, ref, type VNode } from 'vue';
import { STAND_TRANSACTIONS } from '../transactions-data';

const PAGE = 10;
const usd = (mills: number): string => `$${(mills / 1000).toFixed(2)}`;
const printed = (at: number): string => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** «Transactions» in the chat tab bar and its window. */
export const TransactionsWindow = defineComponent({
  name: 'TransactionsWindow',
  setup() {
    const open = ref(false);
    const shown = ref(PAGE);
    return (): VNode =>
      h('span', { class: 'transactions' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'chat-tab transactions__open',
            title: 'Transactions',
            onClick: () => {
              open.value = true;
              shown.value = PAGE;
            },
          },
          'Transactions',
        ),
        open.value
          ? h('div', { class: 'p-dialog transactions__window', role: 'dialog', 'aria-label': 'Transactions' }, [
              h('div', { class: 'transactions__head' }, [
                h('div', { 'data-testid': 'transactions-summary', class: 'transactions__summary' }, 'Current balance $1,204.00 · Pending $312.00'),
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'transactions__close',
                    'aria-label': 'Close',
                    onClick: () => {
                      open.value = false;
                    },
                  },
                  '×',
                ),
              ]),
              h('table', { class: 'transactions__table' }, [
                h('thead', [h('tr', ['Date & Time', 'Amount', 'Net', 'Description', 'Inbox'].map((name) => h('th', name)))]),
                h(
                  'tbody',
                  STAND_TRANSACTIONS.slice(0, shown.value).map((row) =>
                    h('tr', { key: row.id }, [h('td', printed(row.at)), h('td', usd(row.grossMills)), h('td', usd(row.netMills)), h('td', row.description), h('td', [h('a', { href: '#' }, 'Open')])]),
                  ),
                ),
              ]),
              shown.value < STAND_TRANSACTIONS.length
                ? h(
                    'button',
                    {
                      type: 'button',
                      class: 'transactions__more',
                      onClick: () => {
                        shown.value += PAGE;
                      },
                    },
                    'Load more',
                  )
                : null,
            ])
          : null,
      ]);
  },
});
