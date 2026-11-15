// `/creator/wallet/history` on the Fansly stand (hub package R, 2026-11-15): «Wallet & Payouts» → «Wallet history» as
// fansly.com drew it when seen live (docs/research/fansly/wallet-history.md): `app-creator-wallet-transaction-history`
// with `.tx-row`s — the label, the fan, the time, `span.tx-id` «#<transactionId>», the status, the amount after the
// fee — and `app-cursor-pager` (10 rows a page, «Previous page», the numbers, «Next page»). Over the fake Fansly the
// page asks `GET /account/wallets/earnings/transactions?before=&after=&limit=30&offset=…` as the site does, so the
// extension's observer hears it; the stand page answering itself renders the same rows from STAND_WALLET.
//
// The rows are invented, at fixed moments: the fake hub's board stub names the same sales (fake-hub/report-board.ts).

import { el, host, scope, type Scope } from './ng';
import { STAND_WALLET, STAND_WALLET_FANS, type StandWalletRow } from './protocol';

/** The API's answer for a page of the list, in Fansly's form (the parts the page and the extension read). */
export function standWalletAnswer(offset: number, limit: number): unknown {
  const rows = STAND_WALLET.slice(offset, offset + limit);
  return {
    total: STAND_WALLET.length,
    data: rows.map((row) => ({
      walletId: '940000000000000001',
      transactionId: row.transactionId,
      accountId: '940000000000000002',
      correlationId: String(BigInt(row.transactionId) - 1n),
      correlationAccountId: row.fanId,
      type: row.type,
      destination: 2,
      amount: row.amount,
      destinationTax: 2000,
      destinationAmount: row.amount,
      createdAt: row.createdAt,
      updatedAt: null,
      status: 2,
      senderId: null,
      receiverId: '940000000000000002',
    })),
    aggregationData: { accounts: STAND_WALLET_FANS.map(([id, displayName, username]) => ({ id, displayName, username })) },
  };
}

const LABELS: Readonly<Record<number, string>> = { 2110: 'Media Sale to', 7101: 'Tip from', 15001: 'Subscription Sale to' };
const ICONS: Readonly<Record<number, string>> = { 2110: 'fa-image', 7101: 'fa-dollar-sign', 15001: 'fa-star' };
const PAGE = 10;
const LOAD = 30;

/** «Nov 12, 2026, 22:30» in this browser's zone, as the site prints it. */
const printed = (at: number): string => new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

const CSS = `
app-creator-wallet-transaction-history { display: block; max-width: 1072px; margin: 24px auto; padding: 20px; border-radius: 8px; border: 1px solid var(--stand-line, #e3e6ea); font: 14px/20px system-ui, sans-serif; }
.wh-title { font-weight: 700; font-size: 16px; margin-bottom: 4px; }
.wh-sub { color: #6b7280; margin-bottom: 16px; }
.tx-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #e3e6ea; }
.tx-thumb { width: 56px; height: 56px; border-radius: 6px; background: #d9f7df; display: flex; align-items: center; justify-content: center; color: #16a34a; }
.tx-main { flex: 1; }
.tx-label { font-weight: 600; margin-right: 4px; }
.display-name { font-weight: 700; }
.user-name { color: #6b7280; margin-left: 4px; }
.tx-meta { color: #6b7280; font-size: 13px; display: flex; gap: 8px; margin-top: 4px; }
.fansly-status-pill { color: #16a34a; font-weight: 700; font-size: 11px; text-transform: uppercase; }
.tx-amount-value { color: #16a34a; font-weight: 700; font-size: 16px; }
.pager { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; }
.pager-range { display: flex; gap: 4px; color: #6b7280; }
.pager-buttons { display: flex; gap: 4px; }
.pager-btn { min-width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.pager-btn.active { background: #e3eefe; color: #1d72f3; font-weight: 700; }
.pager-btn:disabled { opacity: .4; cursor: default; }
`;

export interface WalletApi {
  /** `GET /account/wallets/earnings/transactions?…&limit=30&offset=…`; null — it failed. */
  walletTransactions(offset: number, done: (answer: { readonly total: number; readonly data: readonly unknown[] } | null) => void): void;
}

/** The wallet's history route. `api` null — the page answers itself from STAND_WALLET. */
export class WalletRoute {
  readonly host: HTMLElement;
  private readonly s: Scope = scope();
  private rows: StandWalletRow[] = [];
  private total = 0;
  private page = 0;
  private readonly list: HTMLElement;
  private readonly pager: HTMLElement;

  constructor(private readonly api: WalletApi | null) {
    const s = this.s;
    this.host = host(s, 'app-creator-wallet-route');
    const style = document.createElement('style');
    style.textContent = CSS;
    this.list = el(s, 'div', { class: 'tx-rows' });
    this.pager = el(s, 'div', { class: 'pager' });
    const history = host(s, 'app-creator-wallet-transaction-history');
    history.append(
      el(s, 'div', { class: 'wh-title' }, ['Wallet history']),
      el(s, 'div', { class: 'wh-sub' }, ['Sales, tips and everything else that reached your earnings wallet, newest first.']),
      this.list,
      host(s, 'app-cursor-pager'),
    );
    (history.lastElementChild as HTMLElement).append(this.pager);
    this.host.append(style, el(s, 'div', { class: 'wh-head' }, [el(s, 'h2', {}, ['Wallet & Payouts'])]), history);
    this.load(0);
  }

  private load(offset: number): void {
    const take = (total: number, data: readonly StandWalletRow[]): void => {
      this.total = total;
      this.rows.splice(offset, data.length, ...data);
      this.draw();
    };
    if (this.api === null) {
      take(STAND_WALLET.length, STAND_WALLET.slice(offset, offset + LOAD));
      return;
    }
    this.api.walletTransactions(offset, (answer) => {
      if (answer === null) return;
      const byId = new Map(STAND_WALLET.map((row) => [row.transactionId, row]));
      const data = answer.data.map((item) => byId.get(String((item as { transactionId?: unknown }).transactionId))).filter((row): row is StandWalletRow => row !== undefined);
      take(answer.total, data);
    });
  }

  private go(page: number): void {
    this.page = page;
    if (this.rows.length < Math.min(this.total, (page + 1) * PAGE)) this.load(this.rows.length);
    else this.draw();
  }

  private draw(): void {
    const s = this.s;
    const shown = this.rows.slice(this.page * PAGE, this.page * PAGE + PAGE);
    this.list.replaceChildren(
      ...shown.map((row) =>
        el(s, 'div', { class: 'tx-row' }, [
          el(s, 'div', { class: 'tx-thumb in' }, [el(s, 'i', { class: `${ICONS[row.type] ?? 'fa-star'} fasl` })]),
          el(s, 'div', { class: 'tx-main' }, [
            el(s, 'div', { class: 'tx-title' }, [
              el(s, 'span', { class: 'tx-label' }, [LABELS[row.type] ?? 'Sale']),
              el(s, 'app-account-username', { class: 'tx-account' }, [
                el(s, 'a', { class: 'username-wrapper', attrs: { href: `/${row.fanHandle}` } }, [el(s, 'span', { class: 'display-name' }, [row.fanName]), el(s, 'span', { class: 'user-name' }, [`@${row.fanHandle}`])]),
              ]),
            ]),
            el(s, 'div', { class: 'tx-meta' }, [el(s, 'span', {}, [printed(row.createdAt)]), el(s, 'span', { class: 'tx-id' }, [`#${row.transactionId}`]), el(s, 'span', { class: 'fansly-status-pill ok' }, ['Approved'])]),
          ]),
          el(s, 'div', { class: 'tx-amount' }, [el(s, 'div', { class: 'tx-amount-value' }, [el(s, 'span', { class: 'tx-sign' }, ['+']), el(s, 'app-balance-display', {}, [`$${String(row.amount / 1000)}`])])]),
        ]),
      ),
    );
    const pages = Math.max(1, Math.ceil(this.total / PAGE));
    const button = (label: string, page: number, options: { readonly aria?: string; readonly num?: boolean } = {}): HTMLElement => {
      const node = el(s, 'button', { class: `btn v2 text pager-btn${options.num === true ? ' pager-num' : ''}${page === this.page && options.num === true ? ' active' : ''}`, attrs: { type: 'button', ...(options.aria === undefined ? {} : { 'aria-label': options.aria, title: options.aria }) } }, [label]) as HTMLButtonElement;
      if (page === this.page && options.num === true) node.setAttribute('aria-current', 'page');
      if (page < 0 || page >= pages) node.disabled = true;
      node.addEventListener('click', () => this.go(page));
      return node;
    };
    const from = this.page * PAGE + 1;
    const to = Math.min(this.total, from + PAGE - 1);
    this.pager.replaceChildren(
      el(s, 'div', { class: 'pager-range' }, [el(s, 'span', {}, [`${String(from)}–${String(to)}`]), el(s, 'span', {}, ['of']), el(s, 'span', {}, [String(this.total)])]),
      el(s, 'div', { class: 'pager-buttons' }, [
        button('‹', this.page - 1, { aria: 'Previous page' }),
        ...Array.from({ length: pages }, (_, page) => button(String(page + 1), page, { num: true })),
        button('›', this.page + 1, { aria: 'Next page' }),
      ]),
    );
  }

  destroy(): void {
    this.host.remove();
  }
}
