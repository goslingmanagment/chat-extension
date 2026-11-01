// The window of «Рассылка» (2026-10-25, the owner's pick: the twin of «Новые», one on both sites; view `outreach`). The
// frame, the list and the keys are «Новые»'s (ui/newcomers/frame.tsx); what the outreach adds: the offer in the head
// (what it sells, the way back to it) with «Свернуть», «Кому» — the tiers and conditions over the Spenders board —, the
// fans with their versions and their blue «Отправить», «Не войдут» with why, the batch's foot («Написать N версий» →
// how far it got → what went and came of it), and on the right the offer, the chosen fan's card or what the outreach
// did. Nothing here sends by itself: «Отправить» is a click on one fan, never a key.
//
// Keys (as «Новые», X55): J / K and ↑ ↓ along the rows, the card follows once the keys stop; Space or Enter opens the
// card; X ticks a fan before the versions are written; `/` is the search; Esc clears the search, then closes. After the
// card's «Отправить →» the next version that waits opens a second later (X59); with none left, what the outreach did.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type OutreachRowVM, type OutreachWindowVM, type UiAction } from '@cg/contracts/vm';

import { Button, SearchBox, Spinner, VirtualList, ViewState, isComposing, useDispatch, useI18n, useKit, useMinuteClock, useView } from '../kit';
import { NewcomersFrame, useNewcomerRows, useTextSize } from '../newcomers/frame';
import { rowKeyOf, useCardFollow } from '../spenders/rowFocus';
import { isPlainKey, isTextEntry } from '../spenders/window';
import { Audience } from './audience';
import { OutreachCard } from './card';
import { Foot } from './foot';
import { Offer, OfferPlate } from './offer';
import { OutreachRow, ROW_HEIGHTS, rowHeight, type ListItem } from './rows';
import { MediaSheet } from './sheet';
import { Saved } from './saved';
import { Summary } from './summary';
import { mediaShort } from './words';

export const CLOSE_OUTREACH: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'outreach', open: false } };
/** After the card's «Отправить →» the next version's card opens this much later: the person sees «Отправлено» first. */
export const NEXT_CARD_MS = 1_000;

const openCard = (handle: string): UiAction => ({ type: 'OpenPreview', targetHandle: handle });

/** The list as drawn: the fans, then «Не войдут · N» and the fans left out. */
function listItems(vm: OutreachWindowVM): ListItem[] {
  const items: ListItem[] = vm.rows.map((row) => ({ kind: 'fan', row }));
  if (vm.aside.length > 0) {
    items.push({ kind: 'group', count: vm.aside.length });
    for (const row of vm.aside) items.push({ kind: 'aside', row });
  }
  return items;
}

/** The fan rows of the list, for the keys: a fan of the outreach or one left out. */
const fanRows = (items: readonly ListItem[]): OutreachRowVM[] => items.flatMap((item) => (item.kind === 'group' ? [] : [item.row]));

/** Under the title: the creator, the page — joined by «·». */
function Sub({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  return (
    <>
      {vm.creator === null ? null : <span class="cg-nw__creator">@{vm.creator}</span>}
      {vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>}
    </>
  );
}

/** «7 в рассылке · вместе потратили $28,195 · только текст · Alex не войдёт — уже купил · Fix пишет от имени Lora», «данные на 19:12». */
function Line({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  if (vm.view.s === 'loading' || vm.view.s === 'error' || vm.view.s === 'forbidden') return null;
  const parts: (string | JSX.Element)[] = [<b key="n">{i18n.t('outreach.line.count', { n: vm.audience.count })}</b>];
  if (vm.audience.spent !== null && vm.audience.spent > 0) parts.push(i18n.t('outreach.line.spent', { money: i18n.formatMoneyMills(vm.audience.spent) }));
  if (vm.media === null) parts.push(i18n.t('outreach.textOnly'));
  const bought = vm.aside.filter((row) => row.aside?.[0]?.kind === 'bought');
  if (bought.length > 0) parts.push(i18n.plural('outreach.line.bought', bought.length, { names: bought.slice(0, 2).map((row) => row.name).join(', '), what: mediaShort(i18n, vm.media).toLowerCase() }));
  const other = vm.aside.length - bought.length;
  if (other > 0) parts.push(i18n.plural('outreach.line.aside', other));
  if (vm.persona !== null) parts.push(i18n.t('outreach.line.persona', { persona: vm.persona }));
  return (
    <div class="cg-nw__line cg-ow__line">
      <span>
        {parts.flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
      </span>
      {vm.stamp.asOf === null ? null : <span class="cg-num">{i18n.t('common.dataAsOf', { time: { time: vm.stamp.asOf } })}</span>}
    </div>
  );
}

/** «К отправке N / Все M». */
function Tabs({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const tabs = [
    { id: 'todo', label: i18n.t('outreach.tab.todo'), count: vm.tabs.todo },
    { id: 'all', label: i18n.t('outreach.tab.all'), count: vm.tabs.all },
  ] as const;
  return (
    <div class="cg-nw__tabs" role="tablist" aria-label={i18n.t('outreach.listLabel')}>
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
              if (!on) void dispatch({ type: 'SetOutreach', tab: tab.id });
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

/** The list empty: nobody found, nothing left to send, or «Кому» takes nobody. */
function Empty({ vm }: { readonly vm: OutreachWindowVM }): JSX.Element {
  const i18n = useI18n();
  const key = vm.query.trim() !== '' ? 'outreach.empty.search' : vm.tab === 'todo' ? 'outreach.empty.todo' : 'outreach.empty.audience';
  return <div class="cg-ow__empty">{i18n.t(key)}</div>;
}

export function OutreachWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const vm = useView({ of: 'outreach' }).value;
  const preview = useView({ of: 'preview', from: 'outreach' }).value;
  useMinuteClock(vm.rows.length > 0);
  const large = useTextSize() === 'large';
  const items = useMemo(() => listItems(vm), [vm.rows, vm.aside]);
  const rows = useMemo(() => fanRows(items), [items]);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The keyboard's row: a fan, remembered by their handle (the list changes under the person).
  const { current, currentHandle, setActiveHandle, wrapRef, listRef, focusRow, settle } = useNewcomerRows(rows, () => rows[0] ?? null);
  const cardFollow = useCardFollow((handle) => void dispatch(openCard(handle)));
  const indexOf = useCallback((handle: string): number => items.findIndex((item) => item.kind !== 'group' && item.row.handle === handle), [items]);

  // After the card's own «Отправить →»: the next version that waits, a second later; none — what the outreach did.
  const latest = useRef(vm);
  latest.current = vm;
  const [sentFrom, setSentFrom] = useState<string | null>(null);
  useEffect(() => {
    if (sentFrom === null) return undefined;
    const timer = setTimeout(() => {
      setSentFrom(null);
      const now = latest.current;
      // The person moved to another fan meanwhile: the card stays theirs.
      if (now.card?.handle !== sentFrom || now.card.state !== 'sent') return;
      const next = now.card.next;
      if (next !== null) {
        setActiveHandle(next.handle);
        focusRow(indexOf(next.handle), next.handle);
        void dispatch(openCard(next.handle));
      } else void dispatch({ type: 'SetOutreach', pane: 'summary' });
    }, NEXT_CARD_MS);
    return () => clearTimeout(timer);
  }, [sentFrom]);

  // The first version this window can send opens its card, as «Новые» opens on its first draft — once, while no card
  // is open (a version held — the open chat, a fan who takes no messages — waits in the list with why).
  const opened = useRef(false);
  const firstReady = vm.rows.find((row) => row.state === 'ready' && row.send !== null && (row.send.can || row.send.paused))?.handle ?? null;
  useEffect(() => {
    if (opened.current || firstReady === null || vm.card !== null || vm.pane !== 'offer' || vm.sheet !== null) return;
    opened.current = true;
    setActiveHandle(firstReady);
    void dispatch(openCard(firstReady));
  }, [firstReady]);
  useEffect(() => {
    if (!vm.audience.locked) opened.current = false;
  }, [vm.audience.locked]);

  // Esc in turn: the search, then the window.
  const close = useCallback((): void => {
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'outreach', query: '' });
    else void dispatch(CLOSE_OUTREACH);
  }, [vm.query, dispatch]);

  // The window opens with the focus on its first row once rows are there (or keeps where the person put it).
  const hasRows = rows.length > 0;
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const first = openedOn.current === undefined;
    const box = frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null;
    const focused = root.activeElement;
    if (hasRows && currentHandle !== null && (first || focused === openedOn.current || focused === null || focused === box)) focusRow(current, currentHandle);
    if (first) openedOn.current = root.activeElement;
  }, [hasRows]);

  const onListKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    const handle = rowKeyOf(event.target);
    const at = handle === null ? -1 : rows.findIndex((row) => row.handle === handle);
    const row = rows[at];
    if (row === undefined) return;
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      const next = rows[at + step];
      if (next === undefined) return;
      setActiveHandle(next.handle);
      focusRow(indexOf(next.handle), next.handle);
      cardFollow.follow(next.handle);
      return;
    }
    if (event.code === 'KeyX' && !vm.audience.locked && row.aside === undefined) {
      event.preventDefault();
      void dispatch({ type: 'SetOutreach', tick: { targetHandle: row.handle, on: !row.ticked } });
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
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

  const blocked = vm.view.s === 'error' || vm.view.s === 'forbidden' || vm.view.s === 'loading';
  const heights = ROW_HEIGHTS[large ? 'large' : 'normal'];
  const measure = useCallback((item: ListItem): number => rowHeight(item, heights), [heights]);

  let list: JSX.Element;
  if (blocked) {
    list = (
      <div class="cg-nw__state">
        <ViewState view={vm.view} />
      </div>
    );
  } else if (items.length === 0) {
    list = <Empty vm={vm} />;
  } else {
    list = (
      <div class="cg-nw__list" ref={wrapRef}>
        <VirtualList
          items={items}
          rowHeight={measure}
          getKey={(item) => (item.kind === 'group' ? 'group' : item.row.handle)}
          role="listbox"
          label={i18n.t('outreach.listLabel')}
          listRef={listRef}
          onRangeChange={() => settle()}
          onKeyDown={onListKeyDown}
          renderRow={(item, index) =>
            item.kind === 'group' ? (
              <div class="cg-ow__group" role="presentation">
                <span>{i18n.t('outreach.asideGroup')} · </span>
                <span class="cg-num">{item.count}</span>
                <i />
              </div>
            ) : (
              <OutreachRow item={item} index={index} active={item.row.handle === currentHandle} locked={vm.audience.locked} media={vm.media} onPick={setActiveHandle} />
            )
          }
        />
      </div>
    );
  }

  let pane: JSX.Element;
  if (vm.card !== null) pane = <OutreachCard vm={vm} card={vm.card} preview={preview} onSent={setSentFrom} />;
  else if (vm.pane === 'summary' && vm.summary !== null) pane = <Summary vm={vm} summary={vm.summary} />;
  else pane = <Offer vm={vm} />;

  return (
    <NewcomersFrame
      title={i18n.t('outreach.title')}
      sub={<Sub vm={vm} />}
      class="cg-ow"
      onEsc={close}
      frameRef={frameRef}
      onKeyDown={onKeyDown}
      close={CLOSE_OUTREACH}
      actions={
        <>
          {/* The offer: what this outreach sells, and the way back to it — while it is not on the right already. */}
          {vm.card !== null || vm.pane === 'summary' ? <OfferPlate vm={vm} /> : null}
          <Saved vm={vm} />
          <Button label={i18n.t('outreach.minimize')} variant="quiet" size="sm" class="cg-ow__min" tooltip={i18n.t('outreach.minimizeTooltip')} onClick={() => void dispatch({ type: 'SetOutreach', minimized: true })} />
        </>
      }
    >
      <div class="cg-nw__bar">
        <Audience vm={vm} />
        <span class="cg-nw__grow" />
        {vm.batch.generating + vm.batch.queued > 0 ? (
          <span class="cg-nw__stage cg-num" role="status">
            <Spinner />
            {i18n.t('outreach.writing', { done: vm.batch.ready + vm.batch.sent, total: vm.tabs.all })}
          </span>
        ) : null}
        <SearchBox
          value={vm.query}
          label={i18n.t('spenders.search.placeholder')}
          placeholder={i18n.t('spenders.search.placeholder')}
          class="cg-nw__search"
          inputRef={searchRef}
          onQuery={(query) => void dispatch({ type: 'Search', list: 'outreach', query })}
        />
        <Button label={i18n.t('outreach.refresh')} icon="refresh" iconOnly variant="quiet" class="cg-nw__refresh" onClick={() => void dispatch({ type: 'SetOutreach', refresh: true })} />
      </div>
      <Line vm={vm} />
      {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
      <div class="cg-nw__main">
        <aside class="cg-nw__side" aria-label={i18n.t('outreach.listLabel')} data-cg-outreach={vm.view.s}>
          <Tabs vm={vm} />
          {list}
          <Foot vm={vm} />
        </aside>
        {pane}
      </div>
      {vm.sheet !== null || preview.media?.open === true ? <MediaSheet vm={vm} preview={preview} /> : null}
    </NewcomersFrame>
  );
}
