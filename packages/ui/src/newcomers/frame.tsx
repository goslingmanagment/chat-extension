// The «Новые» window as every site draws it (X59, X60; ui-design §3.6): the old Fansly extension's window — the frame
// with the serif title, the toolbar's period, the list on the left with its tabs, the rows (the picture as the batch's
// tick, the name, a meta line, the status in words, the batch's draft under the fan), «Выбрать N» and the batch at the
// list's foot — over the shared `NewcomersVM`. A site's window (ChatSpace's in ./NewcomersWindow.tsx, Fansly's in
// ui/hosts/fansly/newcomers) puts its own words, its status line and its card into this frame; the look and the keys
// are one.
//
// Speed: only the rows in view are in the DOM (VirtualList), and a row is drawn again only when what it shows changed
// (`sameRow`) — typing in a card's field or a change of one fan redraws one row, not the list. A picture loads lazily,
// without a referrer, and falls back to the initial; a site that gives none (ChatSpace: no remote picture is ever
// loaded, ui-design §1 п. 12) keeps the initial.

import { type ComponentChildren, type ComponentType, type JSX, type Ref, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type UiTextSize } from '@cg/contracts/settings';
import { type BatchVM, type I18n, type NewcomerRowVM, type NewcomersVM, type UiAction, type ValueSignal } from '@cg/contracts/vm';

import { Button, Dialog, Icon, OverlayLayer, Spinner, isComposing, pure, rovingIndex, useDispatch, useI18n, useKit, useValueSignal } from '../kit';
import { useRowFocus } from '../spenders/rowFocus';
import { ChoiceMenu, isPlainKey, type ChoiceItem } from '../spenders/window';

export const CLOSE_NEWCOMERS: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } };

/** «12 часов», «7 дней»: whole weeks and more read as days. */
export function periodText(i18n: I18n, hours: number): string {
  return hours >= 168 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
}

// ── the frame ──

export interface NewcomersFrameProps {
  readonly title: string;
  /** Under the title: the creator, the page — joined by «·». */
  readonly sub: ComponentChildren;
  /** The site's own class on the window, for the rules of its own parts. */
  readonly class?: string;
  /** Esc: the window's own order (the search first). */
  readonly onEsc: () => void;
  readonly frameRef: Ref<HTMLDivElement>;
  readonly onKeyDown: (event: TargetedKeyboardEvent<HTMLDivElement>) => void;
  readonly children: ComponentChildren;
}

/** The text size the window is drawn in: «Крупнее» makes it and its rows larger (X55). */
const NORMAL_TEXT: ValueSignal<UiTextSize> = { value: 'normal', subscribe: () => () => undefined };
export function useTextSize(): UiTextSize {
  return useValueSignal(useKit().deps.textSize ?? NORMAL_TEXT).value;
}

/** The compact window over a scrim, its head — the serif title, the page under it, «×» — and what the site puts under it. */
export function NewcomersFrame({ title, sub, class: own, onEsc, frameRef, onKeyDown, children }: NewcomersFrameProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const large = useTextSize() === 'large';
  const frame = useRef<HTMLDivElement | null>(null);
  const setFrame = (node: HTMLDivElement | null): void => {
    frame.current = node;
    if (typeof frameRef === 'function') frameRef(node);
    else if (frameRef !== null && frameRef !== undefined) frameRef.current = node;
  };
  return (
    <OverlayLayer>
      <Dialog
        open
        label={title}
        size="wide"
        class={`cg-nw${own === undefined ? '' : ` ${own}`}${large ? ' is-large' : ''}`}
        onClose={onEsc}
        // One press outside closes the window at once, as the old Fansly extension's backdrop did; Esc still steps back.
        onScrim={() => void dispatch(CLOSE_NEWCOMERS)}
        initialFocus={() => frame.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}
      >
        <div ref={setFrame} class="cg-nw__frame" onKeyDown={onKeyDown}>
          <header class="cg-nw__head">
            <div class="cg-nw__titles">
              <h2 class="cg-nw__title">{title}</h2>
              <span class="cg-nw__sub">{sub}</span>
            </div>
            <Button label={i18n.t('common.close')} icon="x" iconOnly variant="quiet" class="cg-nw__close" onClick={() => void dispatch(CLOSE_NEWCOMERS)} />
          </header>
          {children}
        </div>
      </Dialog>
    </OverlayLayer>
  );
}

/** «За [12 часов ▾]» (NF-003): the period the list covers; `lead` is the site's word before it, if its catalog has one. */
export function PeriodMenu({ vm, lead, menuLabel, tooltip }: { readonly vm: NewcomersVM; readonly lead: string | null; readonly menuLabel: string; readonly tooltip: string | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <span class="cg-nw__period-box">
      {lead === null ? null : <span class="cg-nw__label">{lead}</span>}
      <ChoiceMenu
        label={periodText(i18n, vm.windowHours)}
        menuLabel={menuLabel}
        tooltip={tooltip}
        class="cg-nw__period"
        items={vm.windowOptions.map((hours) => ({ id: String(hours), label: periodText(i18n, hours), checked: hours === vm.windowHours }))}
        onSelect={(id) => {
          const hours = Number(id);
          if (hours !== vm.windowHours) void dispatch({ type: 'SetNewcomersWindow', hours });
        }}
      />
    </span>
  );
}

/** The status filter (NF-004): one menu with counts, as the old window's select. */
export function StatusMenu({ label, menuLabel, pressed, items, onSelect }: { readonly label: string; readonly menuLabel: string; readonly pressed: boolean; readonly items: readonly ChoiceItem[]; readonly onSelect: (id: string) => void }): JSX.Element | null {
  return <ChoiceMenu label={label} menuLabel={menuLabel} pressed={pressed} class="cg-nw__filter" items={items} onSelect={onSelect} />;
}

// ── the list's head ──

export interface ListTab {
  readonly id: NewcomersVM['tab'];
  readonly label: string;
  readonly count: number | null;
}

/** «К обработке N / Все M», as the old window's tabs: underlined in terracotta. */
export function ListTabs({ tabs, value, label }: { readonly tabs: readonly ListTab[]; readonly value: NewcomersVM['tab']; readonly label: string }): JSX.Element | null {
  const dispatch = useDispatch();
  if (tabs.length < 2) return null;
  return (
    <div class="cg-nw__tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const on = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            class={`cg-nw__tab${on ? ' is-on' : ''}`}
            aria-selected={on ? 'true' : 'false'}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) void dispatch({ type: 'SetNewcomersTab', tab: tab.id });
            }}
          >
            {tab.label}
            {tab.count === null ? null : <span class="cg-nw__tabn cg-num"> {tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** «Выбрать N»: ticks the fans in view a batch could greet now (the batch keeps at most `max`). */
export function PickAll({ rows, batch, label, tooltip }: { readonly rows: readonly NewcomerRowVM[]; readonly batch: BatchVM | undefined; readonly label: (n: number) => string; readonly tooltip: (max: number) => string }): JSX.Element | null {
  const dispatch = useDispatch();
  if (batch === undefined || batch.picked > 0) return null;
  const free = rows.filter((row) => row.batch?.pickable === true && row.batch.state !== 'ready' && row.batch.state !== 'sent').map((row) => row.handle);
  if (free.length === 0) return null;
  const n = Math.min(free.length, batch.max);
  return (
    <Button
      label={label(n)}
      variant="quiet"
      size="sm"
      class="cg-nw__pickall"
      tooltip={tooltip(batch.max)}
      onClick={() => void dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: free.slice(0, batch.max), picked: true })}
    />
  );
}

// ── the picture ──

/** The fan's picture over their initial: the initial stays when there is none, or it does not load. */
export function NewcomerAvatar({ name, url, size }: { readonly name: string; readonly url: string | null | undefined; readonly size: 'row' | 'card' }): JSX.Element {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = ([...name.trim()][0] ?? '?').toLocaleUpperCase();
  const shown = url !== null && url !== undefined && url !== broken ? url : null;
  return (
    <span class={`cg-nw__ava is-${size}`} aria-hidden="true">
      {letter}
      {shown === null ? null : <img src={shown} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable={false} onError={() => setBroken(shown)} />}
    </span>
  );
}

/** The picture is the row's box for the batch: a click on it ticks the fan, never opens the card. */
function PickAvatar({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const batch = row.batch;
  const busy = batch?.state === 'queued' || batch?.state === 'generating';
  const avatar = <NewcomerAvatar name={row.name} url={row.avatarUrl} size="row" />;
  if (batch === undefined || (!batch.pickable && !batch.picked && !busy)) return <span class="cg-nw__pick">{avatar}</span>;
  const on = batch.picked || busy;
  return (
    <button
      type="button"
      class={`cg-nw__pick is-box${on ? ' is-on' : ''}`}
      role="checkbox"
      aria-checked={on ? 'true' : 'false'}
      aria-label={`${i18n.t('batch.pick')}: ${row.name}`}
      tabIndex={-1}
      {...(busy ? { 'aria-disabled': 'true' } : {})}
      onClick={(event) => {
        event.stopPropagation();
        if (!busy) void dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [row.handle], picked: !batch.picked });
      }}
    >
      {avatar}
      <span class="cg-nw__tick">{on ? <Icon name="check" size={12} /> : null}</span>
    </button>
  );
}

// ── a row ──

/** What a site puts into the row: its status line, its line under the name, what stands at the row's end. */
export interface RowParts {
  readonly Status: ComponentType<{ readonly row: NewcomerRowVM }>;
  readonly meta: (i18n: I18n, row: NewcomerRowVM) => string;
  readonly End?: ComponentType<{ readonly row: NewcomerRowVM }>;
  /** A word after the name («черновик»), or null. */
  readonly tag?: (i18n: I18n, row: NewcomerRowVM) => string | null;
}

interface RowProps {
  readonly row: NewcomerRowVM;
  readonly index: number;
  /** Rows in the list: the row's place is said (only some rows are drawn). */
  readonly count: number;
  readonly active: boolean;
  /** The minute of the clock: «2 ч назад» is redrawn once a minute. */
  readonly minute: number;
  readonly parts: RowParts;
  readonly onPick: (handle: string) => void;
}

/** The batch's draft under a fan: `ready` and `sent` with their text. */
const draftOf = (row: NewcomerRowVM): string | null => (row.batch?.state === 'ready' || row.batch?.state === 'sent' ? (row.batch.text ?? null) : null);

function RowView({ row, index, count, active, parts, onPick }: RowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { Status, End } = parts;
  const custom = row.check?.customName ?? null;
  const tag = parts.tag?.(i18n, row) ?? null;
  const draft = draftOf(row);
  return (
    <div
      class={`cg-nw__row${row.selected ? ' is-sel' : ''}${draft === null ? '' : ' has-draft'}`}
      role="option"
      aria-selected={row.selected ? 'true' : 'false'}
      aria-posinset={index + 1}
      aria-setsize={count}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-key={row.handle}
      data-cg-fan={row.handle}
      data-cg-greeting={row.greeting.s}
      {...(row.check === undefined ? {} : { 'data-cg-check': row.check.status })}
      onFocus={() => onPick(row.handle)}
      onClick={() => {
        onPick(row.handle);
        void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
      }}
    >
      <PickAvatar row={row} />
      <span class="cg-nw__copy">
        <span class="cg-nw__name">
          {row.name}
          {custom === null ? null : <span class="cg-nw__custom"> ({custom})</span>}
          {tag === null ? null : <span class="cg-nw__tag">{tag}</span>}
        </span>
        <span class="cg-nw__meta cg-num">{parts.meta(i18n, row)}</span>
        <Status row={row} />
      </span>
      {End === undefined ? null : <End row={row} />}
      {draft === null ? null : (
        <span class={`cg-nw__draft${row.batch?.state === 'sent' ? ' is-sent' : ''}`}>
          <span class="cg-nw__dtext">{draft}</span>
        </span>
      )}
    </div>
  );
}

/** A row is drawn again only when what it shows changed: the list re-renders on every keystroke of a card's field. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.index !== b.index || a.count !== b.count || a.active !== b.active || a.minute !== b.minute || a.parts !== b.parts || a.onPick !== b.onPick) return false;
  const x = a.row;
  const y = b.row;
  if (x === y) return true;
  const greeting = (row: NewcomerRowVM): string => JSON.stringify(row.greeting);
  return (
    x.handle === y.handle &&
    x.name === y.name &&
    x.username === y.username &&
    x.kind === y.kind &&
    x.subscribedAt === y.subscribedAt &&
    x.selected === y.selected &&
    x.hasDraft === y.hasDraft &&
    x.draftStale === y.draftStale &&
    x.avatarUrl === y.avatarUrl &&
    greeting(x) === greeting(y) &&
    x.check?.status === y.check?.status &&
    x.check?.customName === y.check?.customName &&
    x.batch?.pickable === y.batch?.pickable &&
    x.batch?.picked === y.batch?.picked &&
    x.batch?.state === y.batch?.state &&
    x.batch?.text === y.batch?.text &&
    x.batch?.failure?.code === y.batch?.failure?.code &&
    x.send?.can === y.send?.can &&
    x.send?.paused === y.send?.paused &&
    x.send?.refused?.code === y.send?.refused?.code
  );
}

export const NewcomerRow = pure(RowView, sameRow);

/**
 * The row's own «Отправить» of its batch draft (X59): the card's send by one click in the list — it never opens the card,
 * no key presses it; off with `blocked` when the card's checks do not let the draft go as it is, and with its own words
 * for the second after a send (`paused`).
 */
export function RowSendButton({ row, label, tooltip, blocked }: { readonly row: NewcomerRowVM; readonly label: string; readonly tooltip: string; readonly blocked: string }): JSX.Element | null {
  const dispatch = useDispatch();
  const i18n = useI18n();
  const send = row.send;
  if (send === undefined || row.greeting.s === 'greeted') return null;
  const sending = row.greeting.s === 'sending';
  return (
    <Button
      label={label}
      variant="send"
      size="sm"
      class="cg-nw__end cg-nw__rsend"
      busy={sending}
      tabIndex={-1}
      tooltip={tooltip}
      reason={send.can || sending ? null : send.paused === true ? i18n.t('newcomers.row.sendPaused') : blocked}
      onClick={(event) => {
        event.stopPropagation();
        if (send.can && !sending) void dispatch({ type: 'SendNewcomerGreeting', targetHandle: row.handle });
      }}
    />
  );
}

/** Row heights by the text size (the virtual list needs them before it draws): a fan, and the batch's draft under it. */
export const ROW_HEIGHTS: Readonly<Record<UiTextSize, { readonly base: number; readonly draft: number }>> = {
  // 9 + 52 px of text + 9; the draft: 7 above, a box of two 17 px lines (4 + 34 + 4, the border 2).
  normal: { base: 70, draft: 51 },
  // 9 + 58 + 9; two 19 px lines.
  large: { base: 76, draft: 55 },
};

/** The height of a row in the window's text size: taller with the batch's draft under it. */
export function useRowHeight(): (row: NewcomerRowVM) => number {
  const heights = ROW_HEIGHTS[useTextSize()];
  return useCallback((row: NewcomerRowVM) => (draftOf(row) === null ? heights.base : heights.base + heights.draft), [heights]);
}

// ── the batch ──

/** What the batch's foot says, in the site's words. */
export interface BatchWords {
  readonly picked: (n: number) => string;
  readonly generate: (n: number) => string;
  readonly generating: (done: number, total: number) => string;
  readonly done: (ready: number, sent: number, failed: number) => string;
  /** Under the drafts, how to go on with them. */
  readonly review: string;
}

/**
 * The batch at the foot of the list: what is ticked and «Сгенерировать N»; while it runs, how far it got and
 * «Остановить»; once drafts are ready, how many and «Очистить», and how to go on with them (X59: one click per fan,
 * never all at once).
 */
export function BatchFoot({ batch, words }: { readonly batch: BatchVM | undefined; readonly words: BatchWords }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (batch === undefined) return null;
  const made = batch.queued + batch.generating + batch.ready + batch.sent + batch.failed;
  const generating = batch.queued + batch.generating > 0;
  if (batch.picked === 0 && made === 0) return null;
  return (
    <div class="cg-nw__batch" role="group" aria-label={i18n.t('batch.pickAll')} data-cg-batch={generating ? 'running' : batch.picked > 0 ? 'picked' : 'done'}>
      {batch.picked > 0 && !generating ? (
        <div class="cg-nw__bline">
          <span class="cg-nw__bn">{words.picked(batch.picked)}</span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('batch.unpick')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list: 'newcomers' })} />
          <Button
            label={words.generate(batch.picked)}
            variant="line"
            size="sm"
            class="cg-nw__go"
            reason={batch.reason === null ? null : i18n.text(batch.reason)}
            tooltip={i18n.t('batch.generateTooltip')}
            onClick={() => void dispatch({ type: 'GenerateBatch', list: 'newcomers' })}
          />
        </div>
      ) : null}
      {generating ? (
        <div class="cg-nw__bline">
          <span class="cg-nw__bst" role="status">
            <Spinner />
            {words.generating(batch.ready + batch.sent, made)}
          </span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatch', list: 'newcomers' })} />
        </div>
      ) : made > 0 ? (
        <div class="cg-nw__bline">
          <span class="cg-nw__bst" role="status">
            {words.done(batch.ready, batch.sent, batch.failed)}
          </span>
          <span class="cg-nw__grow" />
          <Button label={i18n.t('batch.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list: 'newcomers' })} />
        </div>
      ) : null}
      {!generating && batch.ready > 0 ? <div class="cg-nw__bline is-hint">{words.review}</div> : null}
    </div>
  );
}

// ── the list's keyboard and its pages ──

/**
 * The keyboard's row (X55): a fan, remembered by their handle and never by the place — the list changes under the
 * person (a new follower on top, a fan done and gone from «К обработке») and the row stays on its fan. `initial` names
 * the row the window opens on.
 */
export function useNewcomerRows(rows: readonly NewcomerRowVM[], initial: () => NewcomerRowVM | null): {
  readonly current: number;
  readonly currentHandle: string | null;
  readonly setActiveHandle: (handle: string | null) => void;
} & ReturnType<typeof useRowFocus> {
  const [activeHandle, setActiveHandle] = useState<string | null>(() => (rows.find((row) => row.selected) ?? initial())?.handle ?? null);
  const current = useMemo(() => {
    const at = activeHandle === null ? -1 : rows.findIndex((row) => row.handle === activeHandle);
    // Its fan left the list: back to the selected row, else the first.
    return at >= 0 ? at : Math.max(0, rows.findIndex((row) => row.selected));
  }, [rows, activeHandle]);
  const currentHandle = rows[current]?.handle ?? null;
  useEffect(() => {
    if (currentHandle !== activeHandle) setActiveHandle(currentHandle);
  }, [currentHandle, activeHandle]);
  return { current, currentHandle, setActiveHandle, ...useRowFocus(currentHandle) };
}

/** Pages of 100 (NF-006) as the list scrolls near its end: asked once per length, again when `reset` changes. */
export function useLoadMore(vm: NewcomersVM, settle: () => void, reset: string): (start: number, end: number) => void {
  const dispatch = useDispatch();
  const asked = useRef(-1);
  useLayoutEffect(() => {
    asked.current = -1;
  }, [reset]);
  const length = vm.rows.length;
  return useCallback(
    (_start: number, end: number): void => {
      settle();
      if (vm.canLoadMore && end >= length - 20 && asked.current !== length) {
        asked.current = length;
        void dispatch({ type: 'LoadMore', list: 'newcomers' });
      }
    },
    [vm.canLoadMore, length, dispatch, settle],
  );
}

/** A key on a row of the list, as the window reads it; null — not a plain key of a row. */
export interface RowKey {
  readonly at: number;
  readonly row: NewcomerRowVM;
  /** J / K and ↑ ↓ by the physical key (any layout), Home / End: the row to go to; null — not a move. */
  readonly to: number | null;
}

export function rowKey(event: TargetedKeyboardEvent<HTMLElement>, rows: readonly NewcomerRowVM[], rowOf: (target: EventTarget | null) => string | null): RowKey | null {
  if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return null;
  // The keys act on the row that HAS focus, found by its fan in the list as it is now — never on a remembered place.
  const handle = rowOf(event.target);
  const at = handle === null ? -1 : rows.findIndex((entry) => entry.handle === handle);
  const row = rows[at];
  if (row === undefined) return null;
  const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
  const to = step !== 0 ? at + step : event.key === 'Home' || event.key === 'End' ? rovingIndex(event.key, at, rows.length, 'vertical', false) : null;
  return { at, row, to };
}

/** X: the row's fan ticked for the batch, or unticked (X59). True — the key was the batch's. */
export function toggleBatchPick(row: NewcomerRowVM, dispatch: ReturnType<typeof useDispatch>): boolean {
  const batch = row.batch;
  if (batch === undefined || !(batch.pickable || batch.picked)) return false;
  void dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [row.handle], picked: !batch.picked });
  return true;
}
