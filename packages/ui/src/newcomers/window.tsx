// The «Новые» window, one for every site (X59, X60; ui-design §3.6, §3.12): the old Fansly extension's window — the
// frame (./frame.tsx), the toolbar (the period, what runs, the search, ↻), the list on the left with its tabs, status
// menu, «Выбрать N», rows and the batch at its foot, and the card on the right (./card.tsx). A site gives its adapter
// (`NewcomersSite`): its words, what its toolbar says while its list is read, its rows' status line, and its card from
// its own model (ChatSpace: the preview of the hub's archive; Fansly: the card its pass reads). Never a copy of the
// window: what the person sees and the keys are this file's.
//
// Keys (X55): J / K and ↑ ↓ move along the rows, the card follows once the keys stop; Enter on a row opens its card,
// and on the card's own row is the greeting — «Сгенерировать» while the field is empty, the field otherwise; Space opens
// the card; X ticks the row for the batch; `/` is the search; Esc clears the search, then closes. «Отправить» is a
// click only, never a key. After a send of the card the next draft of the batch opens (X59).

import { type ComponentType, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'preact/hooks';

import { type I18n, type NewcomerRowVM, type NewcomersVM, type UiAction } from '@cg/contracts/vm';

import { Button, SearchBox, VirtualList, ViewState, isComposing, useDispatch, useI18n, useKit, useMinuteClock, useNowFn, useView } from '../kit';
import { rowKeyOf, useCardFollow } from '../spenders/rowFocus';
import { isPlainKey, isTextEntry } from '../spenders/window';
import { CardHoldContext, type CardHold } from './card';
import {
  BatchFoot,
  CLOSE_NEWCOMERS,
  ListTabs,
  NewcomerRow,
  NewcomersFrame,
  PeriodMenu,
  PickAll,
  rowKey,
  toggleBatchPick,
  useLoadMore,
  useNewcomerRows,
  useRowHeight,
  type BatchWords,
  type RowParts,
} from './frame';

/** What a site gives the window: its words and the parts only it has. */
export interface NewcomersSite {
  /** The site's class on the window, for the rules of its own parts. */
  readonly class?: string;
  readonly title: (i18n: I18n) => string;
  readonly listLabel: (i18n: I18n) => string;
  readonly tabLabel: (i18n: I18n, tab: NewcomersVM['tabs'][number]) => string;
  /** «За [12 часов ▾]»: the word before the period, the menu's name, the tooltip. */
  readonly period: (i18n: I18n, vm: NewcomersVM) => { readonly lead: string | null; readonly menuLabel: string; readonly tooltip: string | null };
  /** In the toolbar after the period: what runs while the list is read (and its buttons). */
  readonly Stage: ComponentType<{ readonly vm: NewcomersVM }>;
  /** ↻ after the search. */
  readonly Refresh: ComponentType<{ readonly vm: NewcomersVM }>;
  /** The quiet lines under the toolbar. */
  readonly Lines: ComponentType<{ readonly vm: NewcomersVM }>;
  /** The whole body instead of the list and the card: `failed` — the list was not read, `forbidden` — no access; null — the list. */
  readonly blocked: (vm: NewcomersVM) => 'failed' | 'forbidden' | null;
  /** The body of a list that was not read (`blocked` = `failed`). */
  readonly Failed: ComponentType<{ readonly vm: NewcomersVM }>;
  /** The status menu at the list's head. */
  readonly Filter: ComponentType<{ readonly vm: NewcomersVM }>;
  readonly pickAll: { readonly label: (i18n: I18n, n: number) => string; readonly tooltip: (i18n: I18n, max: number) => string };
  readonly rows: RowParts;
  readonly batchWords: (i18n: I18n) => BatchWords;
  /** What the list says with no row to show (`view.s` = `empty`). */
  readonly Empty: ComponentType<{ readonly vm: NewcomersVM }>;
  /** The card on the right, from the site's own model. */
  readonly Card: ComponentType<{ readonly vm: NewcomersVM }>;
  /** The fan whose card the window opens on when it opens; null — the selected row, its card as it is. */
  readonly opening: (vm: NewcomersVM) => NewcomerRowVM | null;
}

function openCard(handle: string): UiAction {
  return { type: 'OpenPreview', targetHandle: handle };
}

/** The next row after `handle` whose batch draft waits to be read and sent (round the list); null — none. */
export function nextDraft(rows: readonly NewcomerRowVM[], handle: string): string | null {
  const at = rows.findIndex((row) => row.handle === handle);
  for (let step = 1; step < rows.length; step += 1) {
    const row = rows[(at + step) % rows.length];
    if (row !== undefined && row.batch?.state === 'ready' && row.greeting.s === 'none') return row.handle;
  }
  return null;
}

/** Under the title: the creator a pass reads for, the page. */
function Sub({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const creator = vm.pass?.creator ?? null;
  return (
    <>
      {creator === null ? null : <span class="cg-nw__creator">@{creator}</span>}
      {vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>}
    </>
  );
}

export function NewcomersWindowOf({ site }: { readonly site: NewcomersSite }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  const rows = vm.rows;
  // «2 ч назад» moves with the clock.
  useMinuteClock(rows.length > 0);
  const minute = Math.floor(useNowFn()() / 60_000);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The keyboard's row: the one the person is on, else the selected one, else the one the window opens on.
  const { current, currentHandle, setActiveHandle, wrapRef, listRef, focusRow, settle } = useNewcomerRows(rows, () => site.opening(vm) ?? rows[0] ?? null);
  const focusCurrent = useCallback((): void => {
    if (currentHandle !== null) focusRow(current, currentHandle);
  }, [current, currentHandle, focusRow]);
  const filter = (vm.pass?.filters ?? vm.filters).find((item) => item.pressed)?.id ?? 'any';
  // Pages of 100 (NF-006): asked once per length of the list, again for another pass, tab, query or filter.
  const onRange = useLoadMore(vm, settle, `${vm.pass?.passId ?? ''} ${vm.tab} ${vm.query} ${filter}`);
  const rowHeight = useRowHeight();

  const latestRows = useRef(rows);
  latestRows.current = rows;

  // The card follows the keyboard's row once the keys stop (X55): a held J asks for no card per row.
  const cardFollow = useCardFollow((handle) => void dispatch(openCard(handle)));

  /** X59: after the card's own «Отправить →», the next draft of the batch, so the person reads and sends on. */
  const onSent = useCallback(
    (handle: string): void => {
      const next = nextDraft(latestRows.current, handle);
      if (next === null) return;
      const at = latestRows.current.findIndex((row) => row.handle === next);
      setActiveHandle(next);
      focusRow(at, next);
      void dispatch(openCard(next));
    },
    [dispatch, focusRow, setActiveHandle],
  );
  const sentRef = useRef(onSent);
  sentRef.current = onSent;
  const hold = useMemo<CardHold>(() => ({ current: null, sent: (handle) => sentRef.current(handle) }), []);

  // Esc in turn: the search, then the window.
  const close = useCallback((): void => {
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else void dispatch(CLOSE_NEWCOMERS);
  }, [vm.query, dispatch]);

  // The window opens on the fan the site names, with that fan's card — else on the selected row — also when the rows
  // arrive later, unless the person moved focus meanwhile.
  const hasRows = rows.length > 0;
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const first = openedOn.current === undefined;
    const box = frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null;
    const focused = root.activeElement;
    if (hasRows && (first || focused === openedOn.current || focused === null || focused === box)) {
      const pick = site.opening(vm);
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

  /** Enter on a row (X55): the fan's card first; on the card's own fan, its greeting. */
  const greet = (row: NewcomerRowVM): void => {
    cardFollow.stop();
    const card = hold.current;
    if (card === null || card.handle !== row.handle) {
      void dispatch(openCard(row.handle));
      return;
    }
    card.enter?.();
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
      cardFollow.follow(next.handle);
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

  const blocked = site.blocked(vm);
  const showList = hasRows && blocked === null && vm.view.s !== 'error' && vm.view.s !== 'forbidden' && vm.view.s !== 'empty';
  const title = site.title(i18n);
  const listLabel = site.listLabel(i18n);
  const period = site.period(i18n, vm);
  const { Stage, Refresh, Lines, Failed, Filter, Empty, Card } = site;

  let list: JSX.Element | null;
  if (showList) {
    list = (
      <div class="cg-nw__list" ref={wrapRef}>
        <VirtualList
          items={rows}
          rowHeight={rowHeight}
          getKey={(row) => row.handle}
          role="listbox"
          label={listLabel}
          listRef={listRef}
          onRangeChange={onRange}
          onKeyDown={onListKeyDown}
          renderRow={(row, index) => <NewcomerRow row={row} index={index} count={rows.length} active={index === current} minute={minute} parts={site.rows} onPick={setActiveHandle} />}
        />
      </div>
    );
  } else if (vm.view.s === 'empty') {
    list = (
      <div class="cg-nw__state" data-cg-empty="1">
        <Empty vm={vm} />
      </div>
    );
  } else if (vm.view.s === 'offline') {
    list = null;
  } else {
    list = (
      <div class="cg-nw__state">
        <ViewState view={vm.view} />
      </div>
    );
  }

  return (
    <NewcomersFrame title={title} sub={<Sub vm={vm} />} {...(site.class === undefined ? {} : { class: site.class })} onEsc={close} frameRef={frameRef} onKeyDown={onKeyDown}>
      {blocked === 'forbidden' ? null : (
        <div class="cg-nw__bar" data-cg-pass={vm.pass?.stage ?? 'none'}>
          <PeriodMenu vm={vm} lead={period.lead} menuLabel={period.menuLabel} tooltip={period.tooltip} />
          <Stage vm={vm} />
          <span class="cg-nw__grow" />
          <SearchBox
            value={vm.query}
            label={i18n.t('spenders.search.placeholder')}
            placeholder={i18n.t('spenders.search.placeholder')}
            class="cg-nw__search"
            inputRef={searchRef}
            onQuery={(query) => void dispatch({ type: 'Search', list: 'newcomers', query })}
          />
          <Refresh vm={vm} />
        </div>
      )}
      {blocked === null ? <Lines vm={vm} /> : null}
      {/* The port to the background is down: what is shown stays, the banner says so (its return reads it again). */}
      {vm.view.s === 'offline' && blocked === null ? <ViewState view={vm.view} /> : null}
      {blocked === 'failed' ? (
        <Failed vm={vm} />
      ) : blocked === 'forbidden' ? (
        <div class="cg-nw__state">
          <ViewState view={vm.view} />
        </div>
      ) : (
        <CardHoldContext.Provider value={hold}>
          <div class="cg-nw__main">
            <aside class="cg-nw__side" aria-label={listLabel} data-cg-newcomers={vm.view.s}>
              <ListTabs tabs={vm.tabs.map((tab) => ({ id: tab.id, label: site.tabLabel(i18n, tab), count: tab.count }))} value={vm.tab} label={listLabel} />
              <div class="cg-nw__tools" role="group" aria-label={listLabel}>
                <Filter vm={vm} />
                <span class="cg-nw__grow" />
                <PickAll rows={rows} batch={vm.batch} label={(n) => site.pickAll.label(i18n, n)} tooltip={(max) => site.pickAll.tooltip(i18n, max)} />
              </div>
              {list}
              <BatchFoot batch={vm.batch} words={site.batchWords(i18n)} />
            </aside>
            <Card vm={vm} />
          </div>
        </CardHoldContext.Provider>
      )}
    </NewcomersFrame>
  );
}

/** ↻: the list read again now (`ReloadView`); `wait` — why it waits (a pass that runs is the same pass when asked again). */
export function RefreshButton({ label, wait = null, busy = false, class: own = 'cg-nw__refresh' }: { readonly label: string; readonly wait?: string | null; readonly busy?: boolean; readonly class?: string }): JSX.Element {
  const dispatch = useDispatch();
  return <Button label={label} icon="refresh" iconOnly variant="quiet" class={own} busy={busy} reason={wait} onClick={() => void dispatch({ type: 'ReloadView', selector: { of: 'newcomers' } })} />;
}

