// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17, §10;
// NF-001…NF-012, NF-024, NF-025, NF-028): who subscribed, renewed or came back
// in the window, in the family's «Новые» window (./frame.tsx; X59, X60 — the
// same window as on Fansly): tabs, the status filter with counts, the search,
// rows with the greeting status and the lease, the batch — and the card on the
// right: the same pane as a Spenders preview, with only Hi in its strip. A
// colleague's lease shows no name and no countdown (ui-design §12 п. 5). Hi is
// one variant split into parts; each part goes out by its own click, and the
// progress «отправлено N из M» is the model's.
//
// The keyboard (decision X55, as the old Fansly extension's window): the
// window opens on the first fan who can be greeted now, with that fan's card;
// J / K and ↑ ↓ walk the rows and the card follows once the keys stop; Enter
// on a row is its greeting — Hi when the card has nothing yet, the result's
// first part when it has; X ticks the row for the batch. «Отправить» stays a
// click: no key sends.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type GreetingStatusVM, type I18n, type NewcomerRowVM, type PreviewVM, type UiAction } from '@cg/contracts/vm';

import { Boundary, Dot, Icon, SearchBox, Spinner, ViewState, VirtualList, focusQuietly, isComposing, useDispatch, useHints, useI18n, useKit, useMinuteClock, useNowFn, useTooltip, useView } from '../kit';
import { generateAction } from '../spenders/preview/MiniStrip';
import { Preview } from '../spenders/preview/Preview';
import { rowKeyOf, useCardFollow } from '../spenders/rowFocus';
import { isPlainKey, isTextEntry } from '../spenders/window';
import {
  BatchFoot,
  CLOSE_NEWCOMERS,
  ListTabs,
  NewcomerRow,
  NewcomersFrame,
  PeriodMenu,
  PickAll,
  StatusMenu,
  periodText,
  rowKey,
  toggleBatchPick,
  useLoadMore,
  useNewcomerRows,
  useRowHeight,
  type BatchWords,
  type RowParts,
} from './frame';

/** A fan who can be greeted now: nobody has greeted or holds them, or the lease is ours. */
const ACTIONABLE: readonly GreetingStatusVM['s'][] = ['none', 'claim-mine'];

/** The row the window opens on (X55): the first fan who can be greeted now, else the first row. */
export function firstActionable(rows: readonly NewcomerRowVM[]): NewcomerRowVM | null {
  return rows.find((row) => ACTIONABLE.includes(row.greeting.s)) ?? rows[0] ?? null;
}

/**
 * Enter on a row of the card's fan (X55): Hi when the card has no result yet and Hi can run, nothing to start
 * otherwise (the result is there, or Hi is off with its reason). Never a send, never an insert.
 */
export function greetingStart(card: PreviewVM): UiAction | null {
  if (card.result !== null) return null;
  const hi = card.bar.actions.hi;
  return hi !== undefined && hi.enabled && !hi.busy ? generateAction(card, 'hi') : null;
}

const KIND_KEYS: Readonly<Record<NewcomerRowVM['kind'], I18nKey>> = {
  new: 'newcomers.kind.new',
  renewed: 'newcomers.kind.renewed',
  returning: 'newcomers.kind.returning',
};

const BATCH_KEYS = { queued: 'batch.state.queued', generating: 'batch.state.generating', failed: 'batch.state.failed' } as const;

function openCard(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

const CLOSE_CARD: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } };

/** A colleague holds the fan: the lease in words, without a name or a countdown (ui-design §12 п. 5). */
function ClaimOther(): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const tip = useTooltip(hints ? i18n.t('newcomers.status.claimOtherTooltip') : null);
  return (
    <span class="cg-nw__st is-2" {...tip.props}>
      {i18n.t('newcomers.status.claimOther')}
      {tip.description}
    </span>
  );
}

/**
 * The row's status line (ui-design §4.17): how the greeting goes when it goes, the batch's step while it runs, else
 * the greeting's state — terracotta where the person can greet now, as on Fansly.
 */
function GreetingStatus({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const status = row.greeting;
  const batch = row.batch?.state ?? null;
  switch (status.s) {
    case 'sending':
      return (
        <span class="cg-nw__st is-busy cg-num">
          <Spinner />
          {i18n.t('newcomers.status.sending', { sent: status.sent, total: status.total })}
        </span>
      );
    case 'stopped':
      return (
        <span class="cg-nw__st is-2 cg-num">
          <Dot kind="ink" />
          {i18n.t('newcomers.status.stopped', { sent: status.sent, total: status.total })}
        </span>
      );
    case 'greeted':
      return (
        <span class="cg-nw__st">
          <Icon name="check" size={13} />
          {i18n.t('newcomers.status.greeted')}
        </span>
      );
    case 'replied':
      // A row to work with, as «Ждёт ответа» on Fansly (X59): terracotta, and the batch's step while it runs.
      if (batch !== 'generating' && batch !== 'queued' && batch !== 'failed') return <span class="cg-nw__st is-act">{i18n.t('newcomers.status.replied')}</span>;
      break;
    case 'claim-other':
      return <ClaimOther />;
    case 'claim-elsewhere':
      return <span class="cg-nw__st is-2">{i18n.t('newcomers.status.claimElsewhere')}</span>;
    case 'none':
    case 'claim-mine':
      break;
  }
  if (batch === 'generating' || batch === 'queued') {
    return (
      <span class="cg-nw__st is-busy">
        {batch === 'generating' ? <Spinner /> : null}
        {i18n.t(BATCH_KEYS[batch])}
      </span>
    );
  }
  if (batch === 'failed') {
    const failure = row.batch?.failure ?? null;
    const why = failure === null ? null : failure.title === null ? failure.code : i18n.text(failure.title);
    return (
      <span class="cg-nw__st is-2" {...(failure === null ? {} : { 'data-cg-code': failure.code })}>
        <Dot kind="ink" />
        {why === null ? i18n.t(BATCH_KEYS.failed) : `${i18n.t(BATCH_KEYS.failed)}: ${why}`}
      </span>
    );
  }
  return <span class="cg-nw__st is-act">{i18n.t(status.s === 'claim-mine' ? 'newcomers.status.claimMine' : 'newcomers.status.none')}</span>;
}

/** What the rows of ChatSpace's list say: «@handle · новый, подписка 14 мин назад», the greeting, a saved draft. */
const ROW_PARTS: RowParts = {
  Status: GreetingStatus,
  meta: (i18n: I18n, row: NewcomerRowVM) =>
    `${row.username === null ? '' : `@${row.username} · `}${i18n.t('newcomers.cardMeta', { kind: i18n.t(KIND_KEYS[row.kind]), age: i18n.formatAge(row.subscribedAt) })}`,
  tag: (i18n: I18n, row: NewcomerRowVM) => (row.hasDraft ? i18n.t(row.draftStale ? 'newcomers.draftStale' : 'newcomers.draft') : null),
};

/** The batch's foot in the shared words of a batch (contracts 1.32.0). */
function batchWords(i18n: I18n): BatchWords {
  return {
    picked: (n) => i18n.t('batch.picked', { n }),
    generate: (n) => i18n.t('batch.generate', { n }),
    generating: (done, total) => i18n.t('batch.progress', { done, total }),
    done: (ready, sent, failed) => `${i18n.t('batch.progress', { done: ready + sent, total: ready + sent + failed })}${failed === 0 ? '' : ` · ${i18n.t('batch.failedCount', { n: failed })}`}`,
    review: i18n.t('batch.hint'),
  };
}

export function NewcomersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  // The card's model, read only when Enter asks for it: the list does not render with every chunk of a greeting.
  const card = useView({ of: 'preview', from: 'newcomers' });
  // «14 мин назад» moves with the clock.
  useMinuteClock(vm.rows.length > 0);
  const minute = Math.floor(useNowFn()() / 60_000);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rows = vm.rows;
  const { current, currentHandle, setActiveHandle, wrapRef, listRef, focusRow, settle } = useNewcomerRows(rows, () => firstActionable(rows));
  const focusCurrent = useCallback((): void => {
    if (currentHandle !== null) focusRow(current, currentHandle);
  }, [current, currentHandle, focusRow]);
  const onRange = useLoadMore(vm, settle, `${vm.tab} ${vm.query}`);
  const rowHeight = useRowHeight();

  // The card that follows J / K, once the keys stop.
  const cardFollow = useCardFollow((handle) => void dispatch(openCard(handle)));

  const close = useCallback((): void => {
    // Esc in turn: the search, the card, the window.
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else if (vm.cardOpen) void dispatch(CLOSE_CARD);
    else void dispatch(CLOSE_NEWCOMERS);
  }, [vm.query, vm.cardOpen, dispatch]);

  // The card closed: focus goes back to the fan's row.
  const cardWasOpen = useRef(vm.cardOpen);
  useLayoutEffect(() => {
    if (cardWasOpen.current && !vm.cardOpen) focusCurrent();
    cardWasOpen.current = vm.cardOpen;
  }, [vm.cardOpen, focusCurrent]);

  // The window opens on the selected row; with no card open, on the first fan who can be greeted now, and with that
  // fan's card (X55: as the old Fansly extension's window) — also when the rows arrive later, unless the person has
  // moved focus meanwhile. Opening a card reads the hub only: no lease, no chat of the site.
  const hasRows = rows.length > 0;
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const first = openedOn.current === undefined;
    const box = frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null;
    const focused = root.activeElement;
    if (hasRows && (first || focused === openedOn.current || focused === null || focused === box)) {
      const pick = vm.cardOpen ? null : firstActionable(rows);
      if (pick === null) focusCurrent();
      else {
        setActiveHandle(pick.handle);
        focusRow(rows.indexOf(pick), pick.handle);
        void dispatch(openCard(pick.handle));
      }
    }
    if (first) openedOn.current = root.activeElement;
    // Only when rows first appear.
  }, [hasRows]);

  /** Enter on a row (X55): the fan's card first; on the card's own fan, Hi — or, with a result there, its first part. */
  const greet = (row: NewcomerRowVM): void => {
    cardFollow.stop();
    const shown = card.peek();
    if (!vm.cardOpen || shown.handle !== row.handle) {
      void dispatch(openCard(row.handle));
      return;
    }
    const start = greetingStart(shown);
    if (start !== null) {
      void dispatch(start);
      return;
    }
    // Nothing to start: the result's first part takes the focus (Enter there is «Открыть и вставить»), or Hi, whose
    // tooltip says why it is off. «Отправить» never does: it is a click.
    const pane = frameRef.current?.querySelector<HTMLElement>('.cg-pv') ?? null;
    focusQuietly(pane?.querySelector<HTMLElement>('[data-cg-part][tabindex="0"]') ?? pane?.querySelector<HTMLElement>('[data-cg-strip="hi"] button') ?? null);
  };

  const onListKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    const key = rowKey(event, rows, rowKeyOf);
    if (key === null) return;
    const { at, row, to } = key;
    if (to !== null) {
      event.preventDefault();
      const next = rows[to];
      if (next === undefined || to === at) return;
      setActiveHandle(next.handle);
      focusRow(to, next.handle);
      // An open card follows the keyboard's row, once the keys stop (X55).
      if (vm.cardOpen) cardFollow.follow(next.handle);
      return;
    }
    if (event.code === 'KeyX') {
      event.preventDefault();
      toggleBatchPick(row, dispatch);
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      greet(row);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      cardFollow.stop();
      void dispatch(openCard(row.handle));
    }
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || isTextEntry(event.target) || !isPlainKey(event)) return;
    if (event.code === 'Slash' || event.key === '/') {
      event.preventDefault();
      searchRef.current?.focus();
    }
  };

  const showList = hasRows && vm.view.s !== 'error' && vm.view.s !== 'forbidden' && vm.view.s !== 'empty';
  // What is in the list, and whose name Hi greets in: the quiet line under the toolbar.
  const summary = [
    i18n.t('newcomers.footer', { n: vm.footer.count, window: periodText(i18n, vm.windowHours) }),
    vm.personaLabel === null ? null : i18n.t('newcomers.personaNote', { persona: vm.personaLabel }),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const filter = vm.filters.find((item) => item.pressed) ?? vm.filters[0];
  const title = i18n.t('newcomers.title');

  return (
    <NewcomersFrame title={title} sub={vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>} onEsc={close} frameRef={frameRef} onKeyDown={onKeyDown}>
      <div class="cg-nw__bar">
        <PeriodMenu vm={vm} lead={null} menuLabel={i18n.t('newcomers.window.label')} tooltip={i18n.t('newcomers.window.label')} />
        {vm.scan === null ? null : (
          <span class="cg-nw__stage cg-num" role="status">
            <Spinner />
            {i18n.text(vm.scan.stage)}
            {vm.scan.done === null || vm.scan.total === null ? null : <span>{i18n.t('newcomers.scanProgress', { done: vm.scan.done, total: vm.scan.total })}</span>}
          </span>
        )}
        <span class="cg-nw__grow" />
        <SearchBox
          value={vm.query}
          label={i18n.t('spenders.search.placeholder')}
          placeholder={i18n.t('spenders.search.placeholder')}
          class="cg-nw__search"
          inputRef={searchRef}
          onQuery={(query) => void dispatch({ type: 'Search', list: 'newcomers', query })}
        />
      </div>
      <div class="cg-nw__line cg-nw__summary">
        <span>{summary}</span>
        {vm.footer.stamp.asOf === null ? null : <span>{i18n.t('common.dataAsOf', { time: { time: vm.footer.stamp.asOf } })}</span>}
      </div>
      {vm.incomplete === null ? null : (
        <div class="cg-nw__line cg-nw__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b>{' '}
          <span>{i18n.text(vm.incomplete)}</span>
        </div>
      )}
      {/* The port to the background is down: what is shown stays, the banner says so (its return reads it again). */}
      {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
      <div class="cg-nw__main">
        <aside class="cg-nw__side" aria-label={i18n.t('newcomers.listLabel')} data-cg-newcomers={vm.view.s}>
          <ListTabs tabs={vm.tabs.map((tab) => ({ id: tab.id, label: i18n.text(tab.label), count: tab.count }))} value={vm.tab} label={title} />
          <div class="cg-nw__tools" role="group" aria-label={i18n.t('newcomers.col.greeting')}>
            {filter === undefined ? null : (
              <StatusMenu
                label={filter.count === null ? i18n.text(filter.label) : `${i18n.text(filter.label)} ${filter.count}`}
                menuLabel={i18n.t('newcomers.col.greeting')}
                pressed={filter.id !== 'any'}
                items={vm.filters.map((item) => ({ id: item.id, label: i18n.text(item.label), count: item.count, checked: item.pressed }))}
                onSelect={(id) => {
                  const chosen = vm.filters.find((item) => item.id === id);
                  if (chosen !== undefined && !chosen.pressed) void dispatch({ type: 'SetNewcomersFilter', filter: chosen.id });
                }}
              />
            )}
            <span class="cg-nw__grow" />
            <PickAll rows={rows} batch={vm.batch} label={() => i18n.t('batch.pickAll')} tooltip={(max) => i18n.t('batch.max', { n: max })} />
          </div>
          {showList ? (
            <div class="cg-nw__list" ref={wrapRef}>
              <VirtualList
                items={rows}
                rowHeight={rowHeight}
                getKey={(row) => row.handle}
                role="listbox"
                label={i18n.t('newcomers.listLabel')}
                listRef={listRef}
                onRangeChange={onRange}
                onKeyDown={onListKeyDown}
                renderRow={(row, index) => <NewcomerRow row={row} index={index} count={rows.length} active={index === current} minute={minute} parts={ROW_PARTS} onPick={setActiveHandle} />}
              />
            </div>
          ) : vm.view.s === 'offline' ? null : (
            <div class="cg-nw__state">
              <ViewState view={vm.view} />
            </div>
          )}
          <BatchFoot batch={vm.batch} words={batchWords(i18n)} />
        </aside>
        {vm.cardOpen ? (
          <Boundary surface={null}>
            <Preview from="newcomers" closable={false} hiHint={i18n.text(vm.noAutoSend)} />
          </Boundary>
        ) : (
          <section class="cg-nw__none" aria-label={i18n.t('newcomers.cardLabel')}>
            {vm.view.s === 'loading' ? <Spinner label={i18n.t('common.loading')} /> : null}
          </section>
        )}
      </div>
    </NewcomersFrame>
  );
}

/** ChatSpace's own rules of the window: the preview pane as the card. */
export const NEWCOMERS_CSS = `
.cg-nw__main > .cg-pv { border-left: 0; }
@media (max-width: 760px) {
  .cg-nw__main > .cg-pv .cg-feed { flex: 0 0 160px; }
}
`;
