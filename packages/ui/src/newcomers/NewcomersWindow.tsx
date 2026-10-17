// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17, §10;
// NF-001…NF-012, NF-024, NF-025, NF-028): who subscribed, renewed or came back
// in the window — tabs, status filters with counts, search, rows with the
// greeting status and the lease — and the card on the right: the same pane as
// a Spenders preview, with only Hi in its strip. A colleague's lease shows no
// name and no countdown (ui-design §12 п. 5). Hi is one variant split into
// parts; each part goes out by its own click, and the progress «отправлено N
// из M» is the model's.
//
// The keyboard (decision X55, as the old Fansly extension's window): the
// window opens on the first fan who can be greeted now, with that fan's card;
// J / K and ↑ ↓ walk the rows and the card follows once the keys stop; Enter
// on a row is its greeting — Hi when the card has nothing yet, the result's
// first part when it has. «Отправить» stays a click: no key sends.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type GreetingStatusVM, type I18n, type NewcomerRowVM, type NewcomersTab, type NewcomersVM, type PreviewVM, type UiAction } from '@cg/contracts/vm';

import {
  Boundary,
  Dialog,
  Dot,
  Icon,
  OverlayLayer,
  SearchBox,
  Spinner,
  Tabs,
  ViewState,
  VirtualList,
  focusQuietly,
  isComposing,
  rovingIndex,
  useDispatch,
  useHints,
  useI18n,
  useKit,
  useMinuteClock,
  useTooltip,
  useView,
} from '../kit';
import { BatchBar, BatchCheck, BatchCheckAll, BatchLine, inBatch } from '../spenders/batch';
import { generateAction } from '../spenders/preview/MiniStrip';
import { Preview } from '../spenders/preview/Preview';
import { rowKeyOf, useCardFollow, useRowFocus } from '../spenders/rowFocus';
import { ChoiceMenu, DataFooter, InitialAvatar, WindowHeader, isPlainKey, isTextEntry } from '../spenders/window';

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 28;
const LOAD_MORE_MARGIN = 20;
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

/** «48 часов», «7 дней»: whole weeks of the window read as days. */
export function windowText(i18n: I18n, hours: number): string {
  return hours >= 168 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
}

function openCard(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

const CLOSE_CARD: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'preview', open: false } };
const CLOSE_WINDOW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } };

/** The «Приветствие» column (ui-design §4.17): the state in words; a lease never names its holder. */
function Greeting({ status }: { readonly status: GreetingStatusVM }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const tip = useTooltip(status.s === 'claim-other' && hints ? i18n.t('newcomers.status.claimOtherTooltip') : null);
  switch (status.s) {
    case 'none':
      return <span class="cg-nc__st">{i18n.t('newcomers.status.none')}</span>;
    case 'claim-mine':
      return <span class="cg-nc__st is-strong">{i18n.t('newcomers.status.claimMine')}</span>;
    case 'claim-other':
      return (
        <span class="cg-nc__st is-strong" {...tip.props}>
          {i18n.t('newcomers.status.claimOther')}
          {tip.description}
        </span>
      );
    case 'claim-elsewhere':
      return <span class="cg-nc__st is-strong">{i18n.t('newcomers.status.claimElsewhere')}</span>;
    case 'sending':
      return (
        <span class="cg-nc__st is-strong cg-num">
          <Spinner />
          {i18n.t('newcomers.status.sending', { sent: status.sent, total: status.total })}
        </span>
      );
    case 'stopped':
      return (
        <span class="cg-nc__st is-strong cg-num">
          <Dot kind="ink" />
          {i18n.t('newcomers.status.stopped', { sent: status.sent, total: status.total })}
        </span>
      );
    case 'greeted':
      return (
        <span class="cg-nc__st">
          <Icon name="check" size={14} />
          {i18n.t('newcomers.status.greeted')}
        </span>
      );
  }
}

function Row({ row, index, active, onPick }: { readonly row: NewcomerRowVM; readonly index: number; readonly active: boolean; readonly onPick: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div
      class={`cg-nc__grid cg-nc__row${row.selected ? ' is-sel' : ''}`}
      role="row"
      aria-rowindex={index + 2}
      {...(row.selected ? { 'aria-current': 'true' as const } : {})}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-key={row.handle}
      data-cg-fan={row.handle}
      data-cg-greeting={row.greeting.s}
      onFocus={() => onPick(row.handle)}
      onClick={() => {
        onPick(row.handle);
        void dispatch(openCard(row.handle));
      }}
    >
      <span role="cell" class="cg-nc__who">
        {row.batch === undefined ? null : <BatchCheck list="newcomers" handle={row.handle} row={row.batch} name={row.name} />}
        <InitialAvatar name={row.name} />
        <span class="cg-nc__names">
          <span class="cg-nc__name">
            {row.name}
            {row.hasDraft ? <span class="cg-nc__tag">{i18n.t(row.draftStale ? 'newcomers.draftStale' : 'newcomers.draft')}</span> : null}
          </span>
          {/* In a batch the second line says how its Hi went, with the text that came out. */}
          {row.batch !== undefined && inBatch(row) ? (
            <BatchLine row={row.batch} />
          ) : (
            <span class="cg-nc__handle">
              {row.username === null ? '' : `@${row.username} · `}
              {i18n.t(KIND_KEYS[row.kind])}
            </span>
          )}
        </span>
      </span>
      <span role="cell" class="cg-nc__ago cg-num">
        {i18n.formatAge(row.subscribedAt)}
      </span>
      <span role="cell" class="cg-nc__status">
        <Greeting status={row.greeting} />
      </span>
    </div>
  );
}

/** The window of «Новые» (NF-003): 24 / 48 / 72 hours, a week. */
function WindowMenu({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  return (
    <ChoiceMenu
      label={windowText(i18n, vm.windowHours)}
      menuLabel={i18n.t('newcomers.window.label')}
      tooltip={hints ? i18n.t('newcomers.window.label') : null}
      align="end"
      items={vm.windowOptions.map((hours) => ({ id: String(hours), label: windowText(i18n, hours), checked: hours === vm.windowHours }))}
      onSelect={(id) => {
        const hours = vm.windowOptions.find((value) => String(value) === id);
        if (hours !== undefined && hours !== vm.windowHours) void dispatch({ type: 'SetNewcomersWindow', hours });
      }}
    />
  );
}

/** The greeting's status filter (NF-004): one menu, as the old Fansly window's select, not a row of chips. */
function StatusMenu({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const on = vm.filters.find((filter) => filter.pressed) ?? vm.filters[0];
  if (on === undefined) return null;
  return (
    <ChoiceMenu
      label={on.count === null ? i18n.text(on.label) : `${i18n.text(on.label)} ${on.count}`}
      menuLabel={i18n.t('newcomers.col.greeting')}
      pressed={on.id !== 'any'}
      class="cg-nc__filter"
      items={vm.filters.map((filter) => ({ id: filter.id, label: i18n.text(filter.label), count: filter.count, checked: filter.pressed }))}
      onSelect={(id) => {
        const filter = vm.filters.find((item) => item.id === id);
        if (filter !== undefined && !filter.pressed) void dispatch({ type: 'SetNewcomersFilter', filter: filter.id });
      }}
    />
  );
}

function ColumnHeader({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-nc__grid cg-nc__colhead" role="row" aria-rowindex={1}>
      <span role="columnheader" class="cg-nc__who">
        {vm.batch === undefined ? null : <BatchCheckAll list="newcomers" handles={vm.rows.map((row) => row.handle)} batch={vm.batch} />}
        {i18n.t('newcomers.col.fan')}
      </span>
      <span role="columnheader" class="cg-nc__ago">
        {i18n.t('newcomers.col.subscription')}
      </span>
      <span role="columnheader">{i18n.t('newcomers.col.greeting')}</span>
    </div>
  );
}

export function NewcomersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  // The card's model, read only when Enter asks for it: the list does not render with every chunk of a greeting.
  const card = useView({ of: 'preview', from: 'newcomers' });
  // «14 мин», «2 ч» move with the clock.
  useMinuteClock(vm.rows.length > 0);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askedMore = useRef(-1);
  const rows = vm.rows;
  // The keyboard's row is a fan, remembered by its handle and never by its place: the list changes under the
  // person (a new subscriber on top, a fan greeted and gone from «К обработке») and the row stays on its fan.
  const [activeHandle, setActiveHandle] = useState<string | null>(() => (rows.find((row) => row.selected) ?? firstActionable(rows))?.handle ?? null);
  const current = useMemo(() => {
    const at = activeHandle === null ? -1 : rows.findIndex((row) => row.handle === activeHandle);
    // Its fan left the list: back to the selected row, else the first.
    return at >= 0 ? at : Math.max(0, rows.findIndex((row) => row.selected));
  }, [rows, activeHandle]);
  const currentHandle = rows[current]?.handle ?? null;
  useEffect(() => {
    if (currentHandle !== activeHandle) setActiveHandle(currentHandle);
  }, [currentHandle, activeHandle]);
  const { wrapRef, listRef, focusRow, settle } = useRowFocus(currentHandle);
  const focusCurrent = useCallback((): void => {
    if (currentHandle !== null) focusRow(current, currentHandle);
  }, [current, currentHandle, focusRow]);

  // The card that follows J / K, once the keys stop.
  const cardFollow = useCardFollow((handle) => void dispatch(openCard(handle)));

  const close = useCallback((): void => {
    // Esc in turn: the search, the card, the window.
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else if (vm.cardOpen) void dispatch(CLOSE_CARD);
    else void dispatch(CLOSE_WINDOW);
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

  const onRange = useCallback(
    (_start: number, end: number): void => {
      settle();
      if (vm.canLoadMore && end >= rows.length - LOAD_MORE_MARGIN && askedMore.current !== rows.length) {
        askedMore.current = rows.length;
        void dispatch({ type: 'LoadMore', list: 'newcomers' });
      }
    },
    [vm.canLoadMore, rows.length, dispatch, settle],
  );

  const move = (from: number, to: number): void => {
    const row = rows[to];
    if (row === undefined || to === from) return;
    setActiveHandle(row.handle);
    focusRow(to, row.handle);
    // An open card follows the keyboard's row, once the keys stop (X55).
    if (vm.cardOpen) cardFollow.follow(row.handle);
  };

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
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    // The keys act on the row that HAS focus, found by its fan in the list as it is now — never on a
    // remembered place, which may hold another fan after the list changed.
    const handle = rowKeyOf(event.target);
    if (handle === null) return;
    const at = rows.findIndex((entry) => entry.handle === handle);
    const row = rows[at];
    if (row === undefined) return;
    // Letters by the physical key: J / K work on any layout.
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      move(at, at + step);
      return;
    }
    const edge = rovingIndex(event.key, at, rows.length, 'vertical', false);
    if ((event.key === 'Home' || event.key === 'End') && edge !== null) {
      event.preventDefault();
      move(at, edge);
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
  // What is in the list, and whose name Hi greets in: the footer, not a line of the header.
  const footer = [
    i18n.t('newcomers.footer', { n: vm.footer.count, window: windowText(i18n, vm.windowHours) }),
    vm.personaLabel === null ? null : i18n.t('newcomers.personaNote', { persona: vm.personaLabel }),
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <OverlayLayer>
      <Dialog open label={i18n.t('newcomers.title')} size="window" scrim={false} class="cg-sp cg-ncw" onClose={close} initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}>
        <div ref={frameRef} class="cg-sp__frame" onKeyDown={onKeyDown}>
          <WindowHeader title={i18n.t('newcomers.title')} pageName={vm.pageName} onClose={() => void dispatch(CLOSE_WINDOW)}>
            {vm.tabs.length < 2 ? null : (
              <Tabs<NewcomersTab>
                label={i18n.t('newcomers.title')}
                tabs={vm.tabs.map((tab) => ({ value: tab.id, label: tab.count === null ? i18n.text(tab.label) : `${i18n.text(tab.label)} ${tab.count}` }))}
                value={vm.tab}
                onChange={(tab) => void dispatch({ type: 'SetNewcomersTab', tab })}
              />
            )}
            {vm.scan === null ? null : (
              <span class="cg-nc__scan cg-num" role="status">
                <Spinner />
                {i18n.text(vm.scan.stage)}
                {vm.scan.done === null || vm.scan.total === null ? null : <span>{i18n.t('newcomers.scanProgress', { done: vm.scan.done, total: vm.scan.total })}</span>}
              </span>
            )}
            <span class="cg-sp__grow" />
            <SearchBox
              value={vm.query}
              label={i18n.t('spenders.search.placeholder')}
              placeholder={i18n.t('spenders.search.placeholder')}
              class="cg-sp__search"
              inputRef={searchRef}
              onQuery={(query) => void dispatch({ type: 'Search', list: 'newcomers', query })}
            />
          </WindowHeader>
          <div class={`cg-nc__cols${vm.cardOpen ? ' is-card' : ''}`}>
            <section class="cg-nc" aria-label={i18n.t('newcomers.listLabel')} data-cg-newcomers={vm.view.s}>
              <div class="cg-sp__tools" role="group" aria-label={i18n.t('newcomers.col.greeting')}>
                <StatusMenu vm={vm} />
                <span class="cg-sp__grow" />
                <WindowMenu vm={vm} />
              </div>
              {vm.batch === undefined ? null : <BatchBar list="newcomers" batch={vm.batch} />}
              {vm.incomplete === null ? null : (
                <div class="cg-sp__line cg-nc__incomplete" role="status">
                  <b>{i18n.t('newcomers.incomplete')}</b>
                  <span>{i18n.text(vm.incomplete)}</span>
                </div>
              )}
              {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
              {showList ? (
                <div class="cg-nc__list" ref={wrapRef} style={{ height: `${HEADER_HEIGHT + rows.length * ROW_HEIGHT}px` }}>
                  <VirtualList
                    items={rows}
                    rowHeight={ROW_HEIGHT}
                    getKey={(row) => row.handle}
                    role="table"
                    label={i18n.t('newcomers.listLabel')}
                    header={<ColumnHeader vm={vm} />}
                    headerHeight={HEADER_HEIGHT}
                    listRef={listRef}
                    onRangeChange={onRange}
                    onKeyDown={onListKeyDown}
                    renderRow={(row, index) => <Row row={row} index={index} active={index === current} onPick={setActiveHandle} />}
                  />
                </div>
              ) : vm.view.s === 'offline' ? null : (
                <div class="cg-nc__state">
                  <ViewState view={vm.view} />
                </div>
              )}
              <DataFooter left={footer} stamp={vm.footer.stamp} />
            </section>
            {vm.cardOpen ? (
              <Boundary surface={null}>
                <Preview from="newcomers" closable={false} hiHint={i18n.text(vm.noAutoSend)} />
              </Boundary>
            ) : null}
          </div>
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

export const NEWCOMERS_CSS = `
.cg-nc__cols { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.cg-nc__cols.is-card { grid-template-columns: minmax(0, 1fr) 480px; }
.cg-nc__cols > * { min-height: 0; min-width: 0; }
.cg-nc__cols > * + * { border-left: 1px solid var(--cg-rule); }
.cg-nc { display: flex; flex-direction: column; min-height: 0; }
.cg-nc > .cg-sp__tools { border-bottom: 1px solid var(--cg-rule); flex-wrap: wrap; align-content: center; height: auto; min-height: 44px; padding-top: 4px; padding-bottom: 4px; gap: 4px 8px; }
.cg-nc__list { flex: 0 1 auto; min-height: 0; }
.cg-nc__grid { display: grid; grid-template-columns: minmax(0, 1fr) 84px minmax(148px, 0.6fr); align-items: center; padding: 0 16px 0 20px; }
.cg-nc__grid > * { min-width: 0; }
.cg-nc__colhead { height: 28px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-bottom: 1px solid var(--cg-rule); }
/* A column title longer than its 56 px («Subscription») keeps the numbers' right edge and grows to the left. */
.cg-nc__colhead .cg-nc__ago { display: flex; justify-content: flex-end; }
.cg-nc__row { height: 52px; border-bottom: 1px solid var(--cg-rule); cursor: default; }
.cg-nc__row:hover { background: var(--cg-sunk); }
.cg-nc__row:focus-visible { background: var(--cg-hover); outline-offset: -2px; }
.cg-nc__row.is-sel, .cg-nc__row.is-sel:hover, .cg-nc__row.is-sel:focus-visible { background: var(--cg-sel); }
.cg-nc__who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.cg-nc__names { display: block; min-width: 0; }
.cg-nc__names .cg-bt__line { padding-left: 0; }
.cg-nc__who .cg-bt__check { margin-right: -2px; }
.cg-nc__name { display: block; font-weight: 500; color: var(--cg-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__tag { margin-left: 8px; font-size: var(--cg-text-sm); font-weight: 400; color: var(--cg-ink-2); }
.cg-nc__handle { display: block; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__ago { color: var(--cg-ink-muted); text-align: right; padding-right: 16px; white-space: nowrap; }
.cg-nc__status { overflow: hidden; }
.cg-nc__st { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__st.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__st > .cg-dot, .cg-nc__st > .cg-spin, .cg-nc__st > .cg-ico { flex: none; }
.cg-nc__state { flex: none; }
.cg-nc .cg-sp__foot { margin-top: auto; }
.cg-nc__incomplete b { font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-nc__scan { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); white-space: nowrap; font-size: var(--cg-text-sm); }
@media (max-width: 1100px) { .cg-nc__cols.is-card { grid-template-columns: minmax(0, 1fr) 420px; } }
/* A narrow window (the browser's zoom of 200 %, ui-design §11): one column — the list in a window of its own, the card under it. */
@media (max-width: 900px) {
  .cg-nc__cols.is-card { display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: thin; }
  .cg-nc__cols.is-card > * { flex: none; }
  .cg-nc__cols.is-card > * + * { border-left: 0; border-top: 1px solid var(--cg-rule); }
  .cg-nc__cols.is-card .cg-nc__list { flex: none; max-height: 236px; }
  .cg-nc__cols.is-card > .cg-pv .cg-feed { flex: 0 0 160px; }
  .cg-nc__cols.is-card .cg-vlist, .cg-nc__cols.is-card .cg-feed, .cg-nc__cols.is-card .cg-pv__work { overscroll-behavior: auto; }
}
`;
