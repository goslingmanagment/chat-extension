// The window of «Онлайн» (2026-10-26, the owner's demo; view `online`): the twin of «Новые» and «Рассылка». In the head
// the live dot, the creator and the page; under it «Зашли за [30 мин ▾]», how many are online and worth a message,
// the search and «Обновить», and one line of what the window does and where «who is online» comes from. On the left
// «К разбору» (the fans to write to, by why: who waits for an answer first) and «Все онлайн» (everyone, the set aside
// and the reasonless too); on the right the chosen fan's card, or what the pass did once nobody is left.
//
// Keys (as «Новые», X55): J / K and ↑ ↓ along the fans, the card follows once the keys stop; Enter or Space opens it
// at once; S skips the open fan; `/` is the search; Esc clears the search, then closes. «Отправить →» is a click,
// never a key.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';

import { type OnlineGroupId, type OnlineRowVM, type OnlineWindowVM, type UiAction } from '@cg/contracts/vm';

import { Button, SearchBox, ViewState, isComposing, useDispatch, useI18n, useMinuteClock, useView } from '../kit';
import { NewcomersFrame } from '../newcomers/frame';
import { ChoiceMenu, isPlainKey, isTextEntry } from '../spenders/window';
import { OnlineCard } from './card';
import { OnlineRow } from './rows';
import { firstName } from './words';

export const CLOSE_ONLINE: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'online', open: false } };

const GROUP_KEYS: Readonly<Record<OnlineGroupId, 'online.group.waiting' | 'online.group.new' | 'online.group.expiring' | 'online.group.silent' | 'online.group.quiet' | 'online.group.never' | 'online.group.none' | 'online.group.aside'>> = {
  waiting: 'online.group.waiting',
  new: 'online.group.new',
  expiring: 'online.group.expiring',
  silent: 'online.group.silent',
  quiet: 'online.group.quiet',
  never: 'online.group.never',
  none: 'online.group.none',
  aside: 'online.group.aside',
};

/** «10 мин», «30 мин», «2 часа». */
function periodWords(i18n: ReturnType<typeof useI18n>, minutes: number): string {
  return minutes >= 60 ? i18n.t('online.period.hours', { n: minutes / 60 }) : i18n.t('online.period.minutes', { n: minutes });
}

/** Under the title: the creator, the page. */
function Sub({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element {
  return (
    <>
      {vm.creator === null ? null : <span class="cg-nw__creator">@{vm.creator}</span>}
      {vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>}
    </>
  );
}

/** «Сначала те, кто ждёт ответа · Reply, Hi и Ping пишут от имени Lora · шаблоны из гайда команды», the source and the time. */
function Line({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  if (vm.view.s === 'loading' || vm.view.s === 'error' || vm.view.s === 'forbidden') return null;
  const parts: (string | JSX.Element)[] = [<b key="first">{i18n.t('online.line.first')}</b>];
  if (vm.persona !== null) parts.push(i18n.t('online.line.persona', { persona: vm.persona }));
  parts.push(i18n.t('online.line.guide'));
  return (
    <div class="cg-nw__line cg-ow__line">
      <span>{parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}</span>
      <span class="cg-num">
        {i18n.t(vm.source === 'fansly' ? 'online.line.sourceFansly' : 'online.line.sourceOnlyFans')}
        {vm.stamp.asOf === null ? null : ` · ${i18n.t('common.dataAsOf', { time: { time: vm.stamp.asOf } })}`}
      </span>
    </div>
  );
}

/** «К разбору N / Все онлайн M». */
function Tabs({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const tabs = [
    { id: 'todo', label: i18n.t('online.tab.todo'), count: vm.tabs.todo },
    { id: 'all', label: i18n.t('online.tab.all'), count: vm.tabs.all },
  ] as const;
  return (
    <div class="cg-nw__tabs" role="tablist" aria-label={i18n.t('online.listLabel')}>
      {tabs.map((tab) => {
        const on = tab.id === vm.tab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            class={`cg-nw__tab${on ? ' is-on' : ''}`}
            aria-selected={on ? 'true' : 'false'}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) void dispatch({ type: 'SetOnline', tab: tab.id });
            }}
          >
            {tab.label}
            <span class="cg-nw__tabn cg-num"> {tab.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The list empty: nobody found, nobody left to write to, nobody online. */
function Empty({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element {
  const i18n = useI18n();
  const key = vm.query.trim() !== '' ? 'online.empty.search' : vm.tab === 'todo' && vm.tabs.all > 0 ? 'online.empty.todo' : 'online.empty.period';
  return <div class="ol-empty">{i18n.t(key)}</div>;
}

/** Under «К разбору»: the online fans the tab does not show — done in this pass, or with no reason or set aside. */
function Elsewhere({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const rest = vm.elsewhere;
  if (rest === null) return null;
  const parts = [rest.done > 0 ? i18n.t('online.elsewhere.done', { n: rest.done }) : null, rest.other > 0 ? i18n.t('online.elsewhere.other', { n: rest.other }) : null].filter((part): part is string => part !== null);
  return (
    <div class="ol-empty">
      <button type="button" class="cg-ow__link" onClick={() => void dispatch({ type: 'SetOnline', tab: 'all' })}>
        {i18n.t('online.elsewhere.lead', { parts: parts.join(', ') })}
      </button>
    </div>
  );
}

/** The foot: what the pass did, and the keys. */
function Foot({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-nw__batch">
      <div class="cg-nw__bline">
        <span class="cg-nw__bn">{i18n.t('online.foot.sent', { n: vm.totals.sent })}</span>
        <span>
          {' · '}
          {i18n.t('online.foot.skipped', { n: vm.totals.skipped })}
          {vm.totals.replied > 0 ? (
            <>
              {' · '}
              <span class="ol-good">{i18n.t('online.foot.replied', { n: vm.totals.replied })}</span>
            </>
          ) : null}
        </span>
      </div>
      <div class="cg-nw__bline is-hint">{i18n.t('online.foot.keys')}</div>
    </div>
  );
}

/** The right pane when no card is open: what the pass did once nobody is left, else a word on where to start. */
function EndPane({ vm }: { readonly vm: OnlineWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const end = vm.end;
  if (end === null) {
    return (
      <section class="cg-nc cg-ow__card">
        <div class="ol-end">
          <p>{i18n.t(vm.tabs.todo > 0 ? 'online.pane.pick' : 'online.pane.nobody')}</p>
        </div>
      </section>
    );
  }
  const names = (fans: readonly { readonly name: string }[]): string => fans.map((fan) => firstName(fan.name)).join(', ');
  return (
    <section class="cg-nc cg-ow__card" data-cg-online-end="1">
      <div class="ol-end">
        <h3>{i18n.t('online.end.title')}</h3>
        <ul>
          <li>
            <b>{i18n.t('online.end.sent', { n: end.sent.length })}</b>
            {end.sent.length === 0 ? null : ` ${names(end.sent)}`}
          </li>
          <li>{i18n.t('online.end.skipped', { n: end.skipped })}</li>
          <li>
            {end.replied.length === 0 ? (
              i18n.t('online.end.noReplies')
            ) : (
              <>
                <b>{i18n.t('online.end.replied', { n: end.replied.length })}</b> {names(end.replied)}
              </>
            )}
          </li>
        </ul>
        <p>{i18n.t('online.end.note')}</p>
        <Button label={i18n.t('online.end.showAll')} variant="line" onClick={() => void dispatch({ type: 'SetOnline', tab: 'all' })} />
      </div>
    </section>
  );
}

export function OnlineWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'online' }).value;
  const preview = useView({ of: 'preview', from: 'online' }).value;
  useMinuteClock(vm.groups.length > 0);
  const rows = useMemo(() => vm.groups.flatMap((group) => group.rows), [vm.groups]);
  const listRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = rows.find((row) => row.selected) ?? null;

  // The chosen fan's row stays in view as the keys move it.
  useEffect(() => {
    if (selected === null) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-cg-key="${CSS.escape(selected.handle)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected?.handle]);

  const choose = useCallback((handle: string): void => void dispatch({ type: 'SelectOnline', targetHandle: handle }), [dispatch]);

  // Esc in turn: the search, then the window.
  const close = useCallback((): void => {
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'online', query: '' });
    else void dispatch(CLOSE_ONLINE);
  }, [vm.query, dispatch]);

  const move = (row: OnlineRowVM | null, step: number): void => {
    const at = row === null ? -1 : rows.findIndex((one) => one.handle === row.handle);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + step))];
    if (next !== undefined && next.handle !== row?.handle) void dispatch({ type: 'SelectOnline', targetHandle: next.handle, keys: true });
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || isTextEntry(event.target) || !isPlainKey(event)) return;
    if (event.code === 'Slash' || event.key === '/') {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0 && rows.length > 0) {
      event.preventDefault();
      move(selected, step);
      return;
    }
    if ((event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') && selected !== null && (event.target as Element | null)?.closest?.('.cg-nw__list') !== null) {
      event.preventDefault();
      void dispatch({ type: 'SelectOnline', targetHandle: selected.handle });
      return;
    }
    if (event.code === 'KeyS' && vm.card !== null && !vm.card.skipped) {
      event.preventDefault();
      void dispatch({ type: 'SkipOnline', targetHandle: vm.card.handle, skip: true });
    }
  };

  const blocked = vm.view.s === 'error' || vm.view.s === 'forbidden' || vm.view.s === 'loading' || vm.view.s === 'empty';
  let list: JSX.Element;
  if (blocked) {
    list = (
      <div class="cg-nw__state">
        <ViewState view={vm.view} />
      </div>
    );
  } else if (rows.length === 0) {
    list = (
      <div class="cg-nw__list">
        <Empty vm={vm} />
        <Elsewhere vm={vm} />
      </div>
    );
  } else {
    list = (
      <div class="cg-nw__list" ref={listRef} role="listbox" aria-label={i18n.t('online.listLabel')}>
        {vm.groups.map((group) => (
          <div key={group.id} role="group" aria-label={i18n.t(GROUP_KEYS[group.id])} data-cg-online-group={group.id}>
            <div class={`cg-ow__group${group.id === 'none' || group.id === 'aside' ? ' is-quiet' : ''}`} role="presentation">
              {i18n.t(GROUP_KEYS[group.id])}
              <span class="cg-num">{group.left}</span>
              <i />
            </div>
            {group.rows.map((row) => (
              <OnlineRow key={row.handle} row={row} onSelect={choose} />
            ))}
          </div>
        ))}
        <Elsewhere vm={vm} />
      </div>
    );
  }

  const stage = vm.view.s === 'ready' || vm.view.s === 'partial' ? i18n.t('online.stage', { online: vm.totals.online, worth: vm.totals.worth }) : null;

  return (
    <NewcomersFrame
      title={i18n.t('online.title')}
      sub={<Sub vm={vm} />}
      class="cg-ow ol"
      onEsc={close}
      frameRef={frameRef}
      onKeyDown={onKeyDown}
      close={CLOSE_ONLINE}
    >
      <div class="cg-nw__bar">
        <span class="ol-period">
          <span class="cg-nw__label">{i18n.t('online.period.label')}</span>
          <ChoiceMenu
            label={periodWords(i18n, vm.minutes)}
            menuLabel={i18n.t('online.period.label')}
            class="cg-nw__period"
            items={vm.periods.map((period) => ({ id: String(period.minutes), label: periodWords(i18n, period.minutes), count: period.count, checked: period.minutes === vm.minutes }))}
            onSelect={(id) => {
              const minutes = Number(id);
              if ((minutes === 10 || minutes === 30 || minutes === 120) && minutes !== vm.minutes) void dispatch({ type: 'SetOnline', minutes });
            }}
          />
        </span>
        {stage === null ? null : <span class="cg-nw__stage cg-num">{stage}</span>}
        <span class="cg-nw__grow" />
        <SearchBox
          value={vm.query}
          label={i18n.t('online.search')}
          placeholder={i18n.t('online.search')}
          class="cg-nw__search"
          inputRef={searchRef}
          onQuery={(query) => void dispatch({ type: 'Search', list: 'online', query })}
        />
        <Button label={i18n.t('online.refresh')} icon="refresh" iconOnly variant="quiet" class="cg-nw__refresh" onClick={() => void dispatch({ type: 'SetOnline', refresh: true })} />
      </div>
      <Line vm={vm} />
      {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
      <div class="cg-nw__main">
        <aside class="cg-nw__side" aria-label={i18n.t('online.listLabel')} data-cg-online={vm.view.s}>
          <Tabs vm={vm} />
          {list}
          <Foot vm={vm} />
        </aside>
        {vm.card !== null ? <OnlineCard vm={vm} card={vm.card} preview={preview} /> : <EndPane vm={vm} />}
      </div>
    </NewcomersFrame>
  );
}
