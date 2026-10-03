// Spike M0 only (architecture.md §3): a plain 1000-row list inside a closed
// shadow root to measure Preact 11 render cost. Real lists over 50 rows are
// virtualized (§10.1, R13); this file is removed once R13 lands its list.

import { render } from 'preact';

import { adoptStyles } from '../kit/styles';
import { BASE_TOKENS_CSS } from '../kit/tokens';

export interface SpikeRow {
  readonly id: number;
  readonly name: string;
  readonly total: string;
}

export function makeSpikeRows(count: number): SpikeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `Фан ${index + 1}`,
    total: `$${((index * 37) % 1000).toFixed(2)}`,
  }));
}

function SpikeList({ rows }: { rows: readonly SpikeRow[] }) {
  return (
    <ol class="cg-spike-list" data-cg-spike-list>
      {rows.map((row) => (
        <li key={row.id} class="cg-spike-row">
          <span>{row.name}</span>
          <span>{row.total}</span>
        </li>
      ))}
    </ol>
  );
}

const SPIKE_CSS = `
.cg-spike-list { margin: 0; padding: 0; list-style: none; max-height: 240px; overflow: auto; font-size: 12px; }
.cg-spike-row { display: flex; justify-content: space-between; padding: 2px 8px; border-bottom: 1px solid var(--cg-border); }
`;

export interface SpikeListResult {
  readonly rows: number;
  /** Synchronous render of all rows, ms. */
  readonly renderMs: number;
  /** Re-render with every row changed, ms. */
  readonly updateMs: number;
  readonly domRows: number;
}

export function mountSpikeList(root: ShadowRoot, count = 1000): SpikeListResult {
  adoptStyles(root, BASE_TOKENS_CSS + SPIKE_CSS);
  const container = root.ownerDocument.createElement('div');
  root.append(container);
  const rows = makeSpikeRows(count);
  const t0 = performance.now();
  render(<SpikeList rows={rows} />, container);
  const t1 = performance.now();
  render(<SpikeList rows={rows.map((row) => ({ ...row, total: `${row.total}*` }))} />, container);
  const t2 = performance.now();
  return { rows: count, renderMs: t1 - t0, updateMs: t2 - t1, domRows: container.querySelectorAll('li').length };
}
