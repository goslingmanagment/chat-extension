// A board that answers (architecture.md §11 «открытие доски из кэша», «поиск по
// 1000 строк»): an AppClient over the fake one that plays the controller's
// part for the Spenders list — search, filters, the sort, the selected fan —
// over a dataset held in memory, so the stand can measure what the UI costs
// when a thousand rows change under it. Test-only; the real controller is
// core/application/spenders (R12).

import { type ActionReceipt, type AppClient, type SpendersBoardVM, type SpendersFilter, type UiAction, type ViewOf, type ViewSelector } from '@cg/contracts';

import { type FakeAppClient, type ScenarioCtx } from '../scenarios/app-client';
import { boardShelves, type BoardFan, type BoardSort } from './data';
import { boardOf } from './states';

export interface LiveBoardState {
  readonly query: string;
  readonly filter: SpendersFilter;
  readonly sort: BoardSort;
  readonly selected: string | null;
}

const matchesFilter = (fan: BoardFan, filter: SpendersFilter): boolean => {
  if (filter === 'waiting') return fan.lastFrom === 'fan';
  if (filter === 'new') return fan.isNew === true;
  return true;
};

export class LiveBoardClient implements AppClient {
  private state: LiveBoardState = { query: '', filter: 'all', sort: 'sum', selected: null };
  private board: SpendersBoardVM;
  private readonly listeners = new Set<(view: SpendersBoardVM) => void>();
  /** How long the last list rebuild took, ms (the controller's share of a search). */
  lastBuildMs = 0;

  constructor(
    private readonly inner: FakeAppClient,
    private readonly ctx: ScenarioCtx,
    private readonly fans: readonly BoardFan[],
  ) {
    this.board = this.build();
  }

  get dispatched(): readonly UiAction[] {
    return this.inner.dispatched;
  }

  private build(): SpendersBoardVM {
    const started = performance.now();
    const { query, filter, sort, selected } = this.state;
    const needle = query.trim().toLowerCase();
    const shown = this.fans.filter((fan) => matchesFilter(fan, filter) && (needle === '' || fan.name.toLowerCase().includes(needle) || fan.username.toLowerCase().includes(needle)));
    const base = boardOf(this.ctx, this.fans, { selected, sort });
    const narrowed = needle !== '' || filter !== 'all';
    const board: SpendersBoardVM = {
      ...base,
      view: shown.length === 0 ? { s: 'empty', why: { key: 'spenders.empty' } } : base.view,
      query,
      filters: base.filters.map((entry) => ({ ...entry, pressed: entry.id === filter })),
      shelves: narrowed ? boardShelves(this.ctx, shown, selected, sort) : base.shelves,
      footer: { ...base.footer, shown: narrowed ? shown.length : null },
    };
    this.lastBuildMs = performance.now() - started;
    return board;
  }

  private publish(patch: Partial<LiveBoardState>): void {
    this.state = { ...this.state, ...patch };
    this.board = this.build();
    for (const listener of [...this.listeners]) listener(this.board);
  }

  getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
    if (selector.of === 'spenders.board') return this.board as ViewOf<S>;
    return this.inner.getSnapshot(selector);
  }

  subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
    if (selector.of !== 'spenders.board') return this.inner.subscribe(selector, listener);
    const wrapped = (view: SpendersBoardVM): void => listener(view as ViewOf<S>);
    this.listeners.add(wrapped);
    return () => this.listeners.delete(wrapped);
  }

  async dispatch(action: UiAction): Promise<ActionReceipt> {
    // The fake validates the action against the contract and records it.
    const receipt = await this.inner.dispatch(action);
    if (action.type === 'Search' && action.list === 'spenders') this.publish({ query: action.query });
    else if (action.type === 'SetSpendersFilter') this.publish({ filter: action.filter });
    else if (action.type === 'SetSpendersSort') this.publish({ sort: action.sort });
    else if (action.type === 'ResetFilters' && action.list === 'spenders') this.publish({ query: '', filter: 'all' });
    else if (action.type === 'OpenPreview') this.publish({ selected: action.targetHandle.replace(/^spenders:/, '') });
    else if (action.type === 'Navigate' && action.to.kind === 'surface' && action.to.surface === 'preview' && !action.to.open) this.publish({ selected: null });
    return receipt;
  }
}
