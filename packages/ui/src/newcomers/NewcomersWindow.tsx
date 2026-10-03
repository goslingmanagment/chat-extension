// «Новые» (architecture.md §8.5, H-7, §6.7.9; ui-design §3.6, §4.17, §10;
// NF-001…NF-012, NF-024, NF-025, NF-028): who subscribed, renewed or came back
// in the window — tabs, status filters with counts, search, rows with the
// greeting status and the lease — and the card on the right: the same pane as
// a Spenders preview, with only Hi in its strip. A colleague's lease shows no
// name and no countdown (ui-design §12 п. 5). Hi is one variant split into
// parts; each part goes out by its own click, and the progress «отправлено N
// из M» is the model's.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { type I18nKey } from '@cg/contracts/errors';
import { type GreetingStatusVM, type I18n, type NewcomerRowVM, type NewcomersTab, type NewcomersVM, type UiAction } from '@cg/contracts/vm';

import {
  Boundary,
  Button,
  Dialog,
  Dot,
  Icon,
  Menu,
  MenuAnchor,
  OverlayLayer,
  SearchBox,
  Spinner,
  Tabs,
  ViewState,
  VirtualList,
  isComposing,
  menuTriggerKeys,
  rovingIndex,
  useDispatch,
  useHints,
  useI18n,
  useKit,
  useMinuteClock,
  useTooltip,
  useView,
  type MenuItem,
} from '../kit';
import { Preview } from '../spenders/preview/Preview';
import { useRowFocus } from '../spenders/rowFocus';
import { DataFooter, FilterChip, WindowHeader, coverageWord, isPlainKey, isTextEntry } from '../spenders/window';

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 28;
const LOAD_MORE_MARGIN = 20;

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

function Row({ row, index, active, onPick }: { readonly row: NewcomerRowVM; readonly index: number; readonly active: boolean; readonly onPick: (index: number) => void }): JSX.Element {
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
      data-cg-fan={row.handle}
      data-cg-greeting={row.greeting.s}
      onFocus={() => onPick(index)}
      onClick={() => {
        onPick(index);
        void dispatch(openCard(row.handle));
      }}
    >
      <span role="cell" class="cg-nc__who">
        <span class="cg-nc__name">
          {row.name}
          {row.hasDraft ? <span class="cg-nc__tag">{i18n.t(row.draftStale ? 'newcomers.draftStale' : 'newcomers.draft')}</span> : null}
        </span>
        {row.username === null ? null : <span class="cg-nc__handle">@{row.username}</span>}
      </span>
      <span role="cell" class="cg-nc__kind">
        {i18n.t(KIND_KEYS[row.kind])}
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
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const returnFocus = useCallback(() => buttonRef.current, []);
  if (vm.windowOptions.length < 2) return null;
  const items: MenuItem[] = vm.windowOptions.map((hours) => ({ id: String(hours), label: windowText(i18n, hours), checked: hours === vm.windowHours }));
  return (
    <MenuAnchor>
      <Button
        label={windowText(i18n, vm.windowHours)}
        variant="quiet"
        tooltip={hints ? i18n.t('newcomers.window.label') : null}
        haspopup="menu"
        expanded={open}
        buttonRef={buttonRef}
        trailing={<Icon name="chevronDown" size={14} />}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open) menuTriggerKeys(event, () => setOpen(true));
        }}
      />
      <Menu
        open={open}
        kind="radio"
        label={i18n.t('newcomers.window.label')}
        items={items}
        align="end"
        placement="bottom"
        onClose={close}
        returnFocusTo={returnFocus}
        onSelect={(id) => {
          const hours = vm.windowOptions.find((value) => String(value) === id);
          if (hours !== undefined && hours !== vm.windowHours) void dispatch({ type: 'SetNewcomersWindow', hours });
        }}
      />
    </MenuAnchor>
  );
}

function ColumnHeader(): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-nc__grid cg-nc__colhead" role="row" aria-rowindex={1}>
      <span role="columnheader">{i18n.t('newcomers.col.fan')}</span>
      <span role="columnheader">{i18n.t('newcomers.col.kind')}</span>
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
  // «14 мин», «2 ч» move with the clock.
  useMinuteClock(vm.rows.length > 0);
  const { wrapRef, listRef, focusRow, settle } = useRowFocus();
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askedMore = useRef(-1);
  const rows = vm.rows;
  const [active, setActive] = useState(() => Math.max(0, rows.findIndex((row) => row.selected)));
  const current = active < rows.length ? active : Math.max(0, rows.findIndex((row) => row.selected));
  useEffect(() => {
    if (current !== active) setActive(current);
  }, [current, active]);

  const close = useCallback((): void => {
    // Esc in turn: the search, the card, the window.
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else if (vm.cardOpen) void dispatch(CLOSE_CARD);
    else void dispatch(CLOSE_WINDOW);
  }, [vm.query, vm.cardOpen, dispatch]);

  // The card closed: focus goes back to the fan's row.
  const cardWasOpen = useRef(vm.cardOpen);
  useLayoutEffect(() => {
    if (cardWasOpen.current && !vm.cardOpen && rows.length > 0) focusRow(current);
    cardWasOpen.current = vm.cardOpen;
  }, [vm.cardOpen, rows.length, current, focusRow]);

  // The window opens on the selected row, or the first — also when the rows arrive later, unless the person
  // has moved focus meanwhile.
  const hasRows = rows.length > 0;
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const first = openedOn.current === undefined;
    const box = frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null;
    const focused = root.activeElement;
    if (hasRows && (first || focused === openedOn.current || focused === null || focused === box)) focusRow(current);
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

  const move = (to: number): void => {
    if (to < 0 || to >= rows.length || to === current) return;
    setActive(to);
    focusRow(to);
  };

  const onListKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    const target = event.target as HTMLElement | null;
    if (target === null || target.closest('[data-cg-item]') === null) return;
    // Letters by the physical key: J / K work on any layout.
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      move(current + step);
      return;
    }
    const edge = rovingIndex(event.key, current, rows.length, 'vertical', false);
    if ((event.key === 'Home' || event.key === 'End') && edge !== null) {
      event.preventDefault();
      move(edge);
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
      const row = rows[current];
      if (row === undefined) return;
      event.preventDefault();
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
  const footer = i18n.t('newcomers.footer', { n: vm.footer.count, window: windowText(i18n, vm.windowHours), coverage: coverageWord(i18n, vm.footer.stamp.coverage) });

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
            {vm.personaLabel === null ? null : <span class="cg-sp__note">{i18n.t('newcomers.personaNote', { persona: vm.personaLabel })}</span>}
          </WindowHeader>
          <div class={`cg-nc__cols${vm.cardOpen ? ' is-card' : ''}`}>
            <section class="cg-nc" aria-label={i18n.t('newcomers.listLabel')} data-cg-newcomers={vm.view.s}>
              <div class="cg-sp__tools" role="group" aria-label={i18n.t('newcomers.col.greeting')}>
                {vm.filters.map((filter) => (
                  <FilterChip key={filter.id} label={i18n.text(filter.label)} count={filter.count} pressed={filter.pressed} onPress={() => void dispatch({ type: 'SetNewcomersFilter', filter: filter.id })} />
                ))}
                <span class="cg-sp__grow" />
                <WindowMenu vm={vm} />
              </div>
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
                    header={<ColumnHeader />}
                    headerHeight={HEADER_HEIGHT}
                    listRef={listRef}
                    onRangeChange={onRange}
                    onKeyDown={onListKeyDown}
                    renderRow={(row, index) => <Row row={row} index={index} active={index === current} onPick={setActive} />}
                  />
                </div>
              ) : vm.view.s === 'offline' ? null : (
                <div class="cg-nc__state">
                  <ViewState view={vm.view} />
                </div>
              )}
              <div class="cg-nc__hint">
                <p>{i18n.text(vm.hint)}</p>
                <p>{i18n.text(vm.noAutoSend)}</p>
              </div>
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
.cg-nc > .cg-sp__tools { border-bottom: 1px solid var(--cg-rule); }
.cg-nc__list { flex: 0 1 auto; min-height: 0; }
.cg-nc__grid { display: grid; grid-template-columns: minmax(0, 1fr) 84px 72px minmax(148px, 0.6fr); align-items: center; padding: 0 16px 0 20px; }
.cg-nc__grid > * { min-width: 0; }
.cg-nc__colhead { height: 28px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); border-bottom: 1px solid var(--cg-rule); }
/* A column title longer than its 56 px («Subscription») keeps the numbers' right edge and grows to the left. */
.cg-nc__colhead .cg-nc__ago { display: flex; justify-content: flex-end; }
.cg-nc__row { height: 52px; border-bottom: 1px solid var(--cg-rule); cursor: default; }
.cg-nc__row:hover { background: var(--cg-sunk); }
.cg-nc__row:focus-visible { background: var(--cg-hover); outline-offset: -2px; }
.cg-nc__row.is-sel, .cg-nc__row.is-sel:hover, .cg-nc__row.is-sel:focus-visible { background: var(--cg-sel); }
.cg-nc__who { display: block; }
.cg-nc__name { display: block; font-weight: 500; color: var(--cg-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__tag { margin-left: 8px; font-size: var(--cg-text-sm); font-weight: 400; color: var(--cg-ink-2); }
.cg-nc__handle { display: block; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__kind { color: var(--cg-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__ago { color: var(--cg-ink-muted); text-align: right; padding-right: 16px; white-space: nowrap; }
.cg-nc__status { overflow: hidden; }
.cg-nc__st { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cg-nc__st.is-strong { color: var(--cg-ink-strong); font-weight: 500; }
.cg-nc__st > .cg-dot, .cg-nc__st > .cg-spin, .cg-nc__st > .cg-ico { flex: none; }
.cg-nc__hint { flex: none; padding: 14px 20px; font-size: var(--cg-text-sm2); line-height: 18px; color: var(--cg-ink-muted); max-width: 64ch; }
.cg-nc__hint p + p { margin-top: 6px; }
.cg-nc__state { flex: none; }
.cg-nc .cg-sp__foot { margin-top: auto; }
.cg-nc__incomplete b { font-weight: 600; color: var(--cg-ink-strong); white-space: nowrap; }
.cg-nc__scan { display: inline-flex; align-items: center; gap: 6px; color: var(--cg-ink-2); white-space: nowrap; font-size: var(--cg-text-sm); }
.cg-ncw .cg-menu { z-index: 6; }
@media (max-width: 1100px) { .cg-nc__cols.is-card { grid-template-columns: minmax(0, 1fr) 420px; } }
@media (max-width: 900px) {
  .cg-nc__cols.is-card { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }
  .cg-nc__cols > * + * { border-left: 0; border-top: 1px solid var(--cg-rule); }
}
`;
