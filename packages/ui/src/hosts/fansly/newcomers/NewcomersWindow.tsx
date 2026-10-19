// «Новые фоловеры» on Fansly (R20 P10a–P10c; X59; ui-design §3.12; FS-NEW-1; NF-001…NF-028, NF-038, FX-017): the window of
// the old Fansly extension, kept as the owner liked it — a compact window with the list of new followers on the left
// (the picture, the name, «@handle · 2 ч назад», the status in words) and the selected fan on the right (the profile,
// «Открыть в Fansly ↗», the conversation the pass read, the draft and «Отправить →») — over the shared `NewcomersVM`
// with its `pass`. What the old one lacked is here too: a batch — tick fans (or «Выбрать N»), «Сгенерировать N», read
// each draft right in the list under its fan and send it by the row's own small «Отправить» (X59: the card's send, one
// click per fan); after a card's own «Отправить →» the card moves on to the next draft of the batch.
//
// Speed: only the rows in view are in the DOM (VirtualList), and a row is drawn again only when what it shows changed
// (`sameRow`) — typing in the draft or a change of one fan's verdict redraws one row, not the list. Pictures load lazily,
// without a referrer, and fall back to the initial.
//
// Keys (X55): J / K and ↑ ↓ move along the rows, the card follows once the keys stop; Enter is the row's greeting
// («Сгенерировать» while the field is empty, the field otherwise); Space opens the card; X ticks the row for the batch;
// `/` is the search; Esc clears the search, then closes. «Отправить» is a click only, never a key.

import { Component, h, type ComponentChildren, type ComponentType, type FunctionComponent, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { isCgAnyCode, type CgAnyCode } from '@cg/contracts/errors-fansly';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { isCgCode, type CgCode, type CgErrorView, type I18nKey } from '@cg/contracts/errors';
import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { type FanslyNewcomersTextKey } from '@cg/contracts/newcomers-fansly';
import { type StaleReason } from '@cg/contracts/ops';
import { type UiTextSize } from '@cg/contracts/settings';
import {
  type I18n,
  type I18nParams,
  type NewcomerCardVM,
  type NewcomerCheck,
  type NewcomerGreetingVM,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassRunVM,
  type NewcomersPassVM,
  type NewcomersVM,
  type UiAction,
  type ValueSignal,
} from '@cg/contracts/vm';

import {
  Button,
  Dialog,
  Dot,
  ErrorCard,
  Icon,
  OverlayLayer,
  SearchBox,
  Spinner,
  TextField,
  VirtualList,
  ViewState,
  focusQuietly,
  isComposing,
  rovingIndex,
  useCountdown,
  useDispatch,
  useHints,
  useI18n,
  useKit,
  useMinuteClock,
  useNowFn,
  useTooltip,
  useValueSignal,
  useView,
} from '../../../kit';
import { useOwnEchoes } from '../../../spenders/ownEchoes';
import { rowKeyOf, useCardFollow, useRowFocus } from '../../../spenders/rowFocus';
import { ChoiceMenu, isPlainKey, isTextEntry } from '../../../spenders/window';

const CLOSE_WINDOW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } };
const RELOAD: UiAction = { type: 'ReloadView', selector: { of: 'newcomers' } };
const LOAD_MORE_MARGIN = 20;

/** Row heights by the text size (the virtual list needs them before it draws): a fan, and the draft of a batch under it. */
const ROW_HEIGHTS: Readonly<Record<UiTextSize, { readonly base: number; readonly draft: number }>> = {
  // 9 + 52 px of text + 9; the draft: 7 above, a box of two 17 px lines (4 + 34 + 4, the border 2).
  normal: { base: 70, draft: 51 },
  // 9 + 58 + 9; two 19 px lines.
  large: { base: 76, draft: 55 },
};
const NORMAL_TEXT: ValueSignal<UiTextSize> = { value: 'normal', subscribe: () => () => undefined };

// ── words ──

/** A text of Fansly's own pack (`fansly.newcomers.*`), through the I18n the surface laid it over. */
export function fanslyText(i18n: I18n, key: FanslyNewcomersTextKey, params?: I18nParams): string {
  return i18n.t(key as unknown as I18nKey, params);
}

/** «12 часов», «7 дней»: whole weeks and more read as days. */
export function periodText(i18n: I18n, hours: number): string {
  return hours >= 168 && hours % 24 === 0 ? i18n.plural('common.days', hours / 24) : i18n.plural('common.hours', hours);
}

/** A row's status in words (NF-005), from the pass's verdict. */
export function checkText(i18n: I18n, check: NewcomerCheck): string {
  return fanslyText(i18n, `fansly.newcomers.status.${check}`);
}

/** A failure as the error card shows it: the code's own texts, of the shared registry or of Fansly's (both in the tab's catalog). */
export function failureView(i18n: I18n, failure: NewcomersFailureVM): CgErrorView {
  const code: CgAnyCode = isCgAnyCode(failure.code) ? failure.code : 'CG-UNKNOWN';
  const shared = isCgCode(code) ? CG_REGISTRY[code] : null;
  const title = shared === null ? (cgTitleKey(code) as unknown as I18nKey) : shared.title;
  const body = shared === null ? (cgBodyKey(code) as unknown as I18nKey) : shared.body;
  // The card prints the code as it is: Fansly's own codes are not in the shared union, the text is.
  return { code: code as CgCode, title: i18n.t(title), body: i18n.t(body), ...(failure.retryAt === null ? {} : { retryAt: failure.retryAt }) };
}

const failureTitle = (i18n: I18n, code: string): string => failureView(i18n, { code, retryAt: null }).title;

/** Enter on the card's own row (X55): «Сгенерировать» when the field is empty and the button is on; null — the field takes the focus instead. */
export function greetingStart(card: NewcomerCardVM): UiAction | null {
  const greeting = card.greeting ?? null;
  if (greeting === null || !greeting.canGenerate || greeting.text.trim() !== '' || greeting.state.s === 'generating' || greeting.state.s === 'sending') return null;
  return { type: 'Generate', targetHandle: card.handle, feature: 'hi', options: {} };
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

/**
 * A function component drawn again only when `same` says its props changed — `memo` without preact/compat (D-05). A
 * context it reads (the I18n) still reaches it: Preact tells context consumers themselves.
 */
function pure<P extends object>(view: FunctionComponent<P>, same: (a: Readonly<P>, b: Readonly<P>) => boolean): ComponentType<P> {
  return class Pure extends Component<P> {
    override shouldComponentUpdate(next: Readonly<P>): boolean {
      return !same(this.props, next);
    }
    override render(): ComponentChildren {
      return h(view, this.props);
    }
  };
}

// ── the picture ──

/** The fan's picture over their initial: the initial stays when there is none, or it does not load. */
function Avatar({ name, url, size }: { readonly name: string; readonly url: string | null | undefined; readonly size: 'row' | 'card' }): JSX.Element {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = ([...name.trim()][0] ?? '?').toLocaleUpperCase();
  const shown = url !== null && url !== undefined && url !== broken ? url : null;
  return (
    <span class={`cg-fnw__ava is-${size}`} aria-hidden="true">
      {letter}
      {shown === null ? null : <img src={shown} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable={false} onError={() => setBroken(shown)} />}
    </span>
  );
}

// ── a row ──

interface RowProps {
  readonly row: NewcomerRowVM;
  readonly index: number;
  /** Rows in the list: the row's place is said (only some rows are drawn). */
  readonly count: number;
  readonly active: boolean;
  /** The minute of the clock: «2 ч назад» is redrawn once a minute. */
  readonly minute: number;
  readonly onPick: (handle: string) => void;
}

/** The status line: how the fan's greeting goes when it goes, else the pass's verdict in words — strong where the person can act. */
function RowStatus({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const check = row.check?.status ?? 'pending';
  const batch = row.batch?.state ?? null;
  const greeting = row.greeting.s;
  if (greeting === 'sending') return <span class="cg-fnw__st is-busy"><Spinner />{fanslyText(i18n, 'fansly.newcomers.row.sending')}</span>;
  if (batch === 'sent' || (greeting === 'greeted' && check !== 'greeted')) return <span class="cg-fnw__st is-done"><Icon name="check" size={13} />{fanslyText(i18n, 'fansly.newcomers.row.sent')}</span>;
  if (greeting === 'stopped') return <span class="cg-fnw__st is-2"><Dot kind="ink" />{fanslyText(i18n, 'fansly.newcomers.greeting.uncertain')}</span>;
  const refused = row.send?.refused ?? null;
  if (refused !== null) return <span class="cg-fnw__st is-2" data-cg-code={refused.code}><Dot kind="danger" />{fanslyText(i18n, 'fansly.newcomers.row.failed', { reason: failureTitle(i18n, refused.code) })}</span>;
  if (batch === 'generating') return <span class="cg-fnw__st is-busy"><Spinner />{fanslyText(i18n, 'fansly.newcomers.row.generating')}</span>;
  if (batch === 'queued') return <span class="cg-fnw__st">{fanslyText(i18n, 'fansly.newcomers.row.queued')}</span>;
  if (batch === 'failed') {
    const code = row.batch?.failure?.code ?? 'CG-UNKNOWN';
    return <span class="cg-fnw__st is-2" data-cg-code={code}><Dot kind="ink" />{fanslyText(i18n, 'fansly.newcomers.row.failed', { reason: failureTitle(i18n, code) })}</span>;
  }
  if (check === 'checking') return <span class="cg-fnw__st"><Spinner />{checkText(i18n, check)}</span>;
  if (check === 'greeted') return <span class="cg-fnw__st"><Icon name="check" size={13} />{checkText(i18n, check)}</span>;
  if (check === 'failed') return <span class="cg-fnw__st is-2"><Dot kind="ink" />{checkText(i18n, check)}</span>;
  const tone = check === 'ready' || check === 'reply' ? ' is-act' : check === 'dm-closed' || check === 'excluded' ? ' is-2' : '';
  return <span class={`cg-fnw__st${tone}`}>{checkText(i18n, check)}</span>;
}

/** The picture is the row's box for the batch: a click on it ticks the fan, never opens the card. */
function PickAvatar({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const batch = row.batch;
  const busy = batch?.state === 'queued' || batch?.state === 'generating';
  const avatar = <Avatar name={row.name} url={row.avatarUrl} size="row" />;
  if (batch === undefined || (!batch.pickable && !batch.picked && !busy)) return <span class="cg-fnw__pick">{avatar}</span>;
  const on = batch.picked || busy;
  return (
    <button
      type="button"
      class={`cg-fnw__pick is-box${on ? ' is-on' : ''}`}
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
      <span class="cg-fnw__tick">{on ? <Icon name="check" size={12} /> : null}</span>
    </button>
  );
}

/**
 * The row's own «Отправить» of its batch draft (X59): the card's send by one click in the list — it never opens the card;
 * off with the reason when the card's checks do not let the draft go as it is.
 */
function RowSend({ row }: { readonly row: NewcomerRowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const send = row.send;
  if (send === undefined || row.greeting.s === 'greeted') return null;
  const sending = row.greeting.s === 'sending';
  return (
    <Button
      label={fanslyText(i18n, 'fansly.newcomers.row.send')}
      variant="send"
      size="sm"
      class="cg-fnw__rsend"
      busy={sending}
      tabIndex={-1}
      tooltip={fanslyText(i18n, 'fansly.newcomers.row.sendTooltip')}
      reason={send.can || sending ? null : fanslyText(i18n, 'fansly.newcomers.row.sendBlocked')}
      onClick={(event) => {
        event.stopPropagation();
        if (send.can && !sending) void dispatch({ type: 'SendNewcomerGreeting', targetHandle: row.handle });
      }}
    />
  );
}

function RowView({ row, index, count, active, onPick }: RowProps): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const check = row.check?.status ?? 'pending';
  const custom = row.check?.customName ?? null;
  const draft = row.batch?.state === 'ready' || row.batch?.state === 'sent' ? (row.batch.text ?? null) : null;
  return (
    <div
      class={`cg-fnw__row${row.selected ? ' is-sel' : ''}${draft === null ? '' : ' has-draft'}`}
      role="option"
      aria-selected={row.selected ? 'true' : 'false'}
      aria-posinset={index + 1}
      aria-setsize={count}
      tabIndex={active ? 0 : -1}
      data-cg-item={index}
      data-cg-key={row.handle}
      data-cg-fan={row.handle}
      data-cg-check={check}
      onFocus={() => onPick(row.handle)}
      onClick={() => {
        onPick(row.handle);
        void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
      }}
    >
      <PickAvatar row={row} />
      <span class="cg-fnw__copy">
        <span class="cg-fnw__name">
          {row.name}
          {custom === null ? null : <span class="cg-fnw__custom"> ({custom})</span>}
        </span>
        <span class="cg-fnw__meta cg-num">
          {row.username === null ? null : `@${row.username} · `}
          {fanslyText(i18n, 'fansly.newcomers.ago', { age: i18n.formatAge(row.subscribedAt) })}
        </span>
        <RowStatus row={row} />
      </span>
      <RowSend row={row} />
      {draft === null ? null : (
        <span class={`cg-fnw__draft${row.batch?.state === 'sent' ? ' is-sent' : ''}`}>
          <span class="cg-fnw__dtext">{draft}</span>
        </span>
      )}
    </div>
  );
}

/** A row is drawn again only when what it shows changed: the list re-renders on every keystroke of the draft. */
function sameRow(a: RowProps, b: RowProps): boolean {
  if (a.index !== b.index || a.count !== b.count || a.active !== b.active || a.minute !== b.minute || a.onPick !== b.onPick) return false;
  const x = a.row;
  const y = b.row;
  if (x === y) return true;
  return (
    x.handle === y.handle &&
    x.name === y.name &&
    x.username === y.username &&
    x.subscribedAt === y.subscribedAt &&
    x.selected === y.selected &&
    x.avatarUrl === y.avatarUrl &&
    x.greeting.s === y.greeting.s &&
    x.check?.status === y.check?.status &&
    x.check?.customName === y.check?.customName &&
    x.batch?.pickable === y.batch?.pickable &&
    x.batch?.picked === y.batch?.picked &&
    x.batch?.state === y.batch?.state &&
    x.batch?.text === y.batch?.text &&
    x.batch?.failure?.code === y.batch?.failure?.code &&
    x.send?.can === y.send?.can &&
    x.send?.refused?.code === y.send?.refused?.code
  );
}

const Row = pure(RowView, sameRow);

// ── the header and the toolbar ──

/** «Проверено 12 из 40», the phase of the fast part, the queue (NF-008); a spinner while the pass reads. */
function Stage({ pass }: { readonly pass: NewcomersPassVM }): JSX.Element | null {
  const i18n = useI18n();
  const remaining = pass.total === null || pass.checked === null ? 0 : Math.max(0, pass.total - pass.checked);
  let text: string | null = null;
  let busy = false;
  switch (pass.stage) {
    case 'connecting':
      text = fanslyText(i18n, 'fansly.newcomers.stage.connecting');
      busy = true;
      break;
    case 'scanning':
      busy = true;
      text =
        pass.phase === 'welcome' || pass.phase === 'followers' || pass.phase === 'profiles'
          ? fanslyText(i18n, `fansly.newcomers.stage.${pass.phase}`)
          : fanslyText(i18n, 'fansly.newcomers.stage.checked', { done: pass.checked ?? 0, total: pass.total ?? 0 });
      break;
    case 'queue':
      busy = true;
      text = fanslyText(i18n, 'fansly.newcomers.stage.queue', { n: remaining });
      break;
    case 'paused':
      text = fanslyText(i18n, 'fansly.newcomers.stage.paused', { n: remaining });
      break;
    case 'cooldown':
    case 'done':
      // An empty period says so in the list itself, not as «Проверено 0 из 0».
      text = pass.total === null || pass.total === 0 ? null : fanslyText(i18n, 'fansly.newcomers.stage.checked', { done: pass.checked ?? 0, total: pass.total });
      break;
    case 'stopped':
      text = fanslyText(i18n, 'fansly.newcomers.stage.stopped');
      break;
    case 'failed':
      return null;
  }
  if (text === null) return null;
  return (
    <span class="cg-fnw__stage cg-num" role="status" data-cg-stage={pass.stage}>
      {busy ? <Spinner /> : null}
      {text}
    </span>
  );
}

/** NF-038: «Пауза» while the queue runs, «Проверить оставшихся: N» while it stands with fans left. */
function RunButton({ run }: { readonly run: NewcomersPassRunVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  if (!run.pause && !run.resume) return null;
  const label = run.pause ? fanslyText(i18n, 'fansly.newcomers.run.pause') : fanslyText(i18n, 'fansly.newcomers.run.resume', { n: run.remaining });
  return <Button label={label} variant="line" size="sm" busy={run.busy} class="cg-fnw__run" onClick={() => void dispatch({ type: 'SetNewcomersPassRunning', running: !run.pause })} />;
}

/** The period (NF-003): 1 hour to 30 days; the choice is remembered for the next window (X59). */
function PeriodMenu({ vm, range }: { readonly vm: NewcomersVM; readonly range: string | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <span class="cg-fnw__period-box">
      <span class="cg-fnw__label">{fanslyText(i18n, 'fansly.newcomers.period')}</span>
      <ChoiceMenu
        label={periodText(i18n, vm.windowHours)}
        menuLabel={fanslyText(i18n, 'fansly.newcomers.window')}
        tooltip={range ?? fanslyText(i18n, 'fansly.newcomers.window')}
        class="cg-fnw__period"
        items={vm.windowOptions.map((hours) => ({ id: String(hours), label: periodText(i18n, hours), checked: hours === vm.windowHours }))}
        onSelect={(id) => {
          const hours = Number(id);
          if (hours !== vm.windowHours) void dispatch({ type: 'SetNewcomersWindow', hours });
        }}
      />
    </span>
  );
}

/** «1 окт, 09:16 — 3 окт, 09:16 · местное время»: the dates the pass covers. */
function rangeText(i18n: I18n, pass: NewcomersPassVM | null): string | null {
  if (pass === null || pass.range === null) return null;
  return fanslyText(i18n, 'fansly.newcomers.range', { from: i18n.formatTime(pass.range.from, 'datetime'), to: i18n.formatTime(pass.range.to, 'datetime') });
}

/** Fansly asked for a pause: how long, said once a second while it lasts (the pass goes on by itself). */
function Cooldown({ until }: { readonly until: number }): JSX.Element | null {
  const i18n = useI18n();
  const left = useCountdown(until, useNowFn());
  if (left <= 0) return null;
  return (
    <div class="cg-fnw__line cg-fnw__cool" role="status">
      {fanslyText(i18n, 'fansly.newcomers.stage.cooldown', { s: Math.ceil(left / 1000) })}
    </div>
  );
}

/** Under the toolbar: the dates, and only when there is something to say — the pause Fansly asked for, «Результат неполный», why the pass stopped. */
function PassLines({ vm, pass, range }: { readonly vm: NewcomersVM; readonly pass: NewcomersPassVM; readonly range: string | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      {range === null ? null : <div class="cg-fnw__line cg-fnw__range">{range}</div>}
      {pass.stage === 'cooldown' && pass.cooldownUntil !== null ? <Cooldown until={pass.cooldownUntil} /> : null}
      {vm.incomplete === null ? null : (
        <div class="cg-fnw__line cg-nc__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b> {fanslyText(i18n, 'fansly.newcomers.incomplete')}
        </div>
      )}
      {pass.stage === 'stopped' && pass.failure !== null ? (
        <div class="cg-fnw__stopped">
          <ErrorCard error={failureView(i18n, pass.failure)} tone="failure" inline />
        </div>
      ) : null}
    </>
  );
}

/** FX-017: the list was not read — a failure with its reason and the way to «Fansly через вкладку», never «nobody new». */
function ListFailed({ failure }: { readonly failure: NewcomersFailureVM | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div class="cg-fnw__failed" data-cg-list="failed">
      <ErrorCard error={failureView(i18n, failure ?? { code: 'CG-DATA-UNAVAILABLE', retryAt: null })} tone="failure">
        <Button label={i18n.t('common.retry')} variant="line" onClick={() => void dispatch(RELOAD)} />
      </ErrorCard>
      <p class="cg-fnw__hint2">{fanslyText(i18n, 'fansly.newcomers.listFailedHint')}</p>
    </div>
  );
}

/** What the list says when it has no row to show: an empty period, a filter or a search with no match, an empty queue. */
function emptyText(i18n: I18n, vm: NewcomersVM, filterOn: boolean): string {
  if ((vm.pass?.total ?? 0) === 0) return fanslyText(i18n, 'fansly.newcomers.empty.window', { window: periodText(i18n, vm.windowHours) });
  if (vm.query.trim() !== '') return fanslyText(i18n, 'fansly.newcomers.empty.search');
  if (filterOn || vm.tab !== 'todo') return fanslyText(i18n, 'fansly.newcomers.empty.filter');
  return fanslyText(i18n, 'fansly.newcomers.empty.todo');
}

// ── the list's own controls ──

/** «К обработке N / Все M», as the old window's tabs. */
function ListTabs({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div class="cg-fnw__tabs" role="tablist" aria-label={fanslyText(i18n, 'fansly.newcomers.listLabel')}>
      {vm.tabs.map((tab) => {
        const on = tab.id === vm.tab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            class={`cg-fnw__tab${on ? ' is-on' : ''}`}
            aria-selected={on ? 'true' : 'false'}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!on) void dispatch({ type: 'SetNewcomersTab', tab: tab.id });
            }}
          >
            {fanslyText(i18n, tab.id === 'todo' ? 'fansly.newcomers.tab.todo' : 'fansly.newcomers.tab.all')}
            {tab.count === null ? null : <span class="cg-fnw__tabn cg-num"> {tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The status filter (NF-004): one menu with counts, as the old window's select. */
function StatusMenu({ pass }: { readonly pass: NewcomersPassVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const on = pass.filters.find((filter) => filter.pressed) ?? pass.filters[0];
  if (on === undefined) return null;
  const label = (id: (typeof pass.filters)[number]['id']): string => fanslyText(i18n, `fansly.newcomers.filter.${id}`);
  return (
    <ChoiceMenu
      label={on.count === null ? label(on.id) : `${label(on.id)} ${on.count}`}
      menuLabel={fanslyText(i18n, 'fansly.newcomers.filter.label')}
      pressed={on.id !== 'any'}
      class="cg-fnw__filter"
      items={pass.filters.map((filter) => ({ id: filter.id, label: label(filter.id), count: filter.count, checked: filter.pressed }))}
      onSelect={(id) => {
        const filter = pass.filters.find((item) => item.id === id);
        if (filter !== undefined && !filter.pressed) void dispatch({ type: 'SetNewcomersCheckFilter', filter: filter.id });
      }}
    />
  );
}

/** «Выбрать N»: ticks the fans in view that can be written to (the batch keeps at most `max`). */
function PickAll({ rows, vm }: { readonly rows: readonly NewcomerRowVM[]; readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const batch = vm.batch;
  if (batch === undefined || batch.picked > 0) return null;
  const free = rows.filter((row) => row.batch?.pickable === true && row.batch.state !== 'ready' && row.batch.state !== 'sent').map((row) => row.handle);
  if (free.length === 0) return null;
  const n = Math.min(free.length, batch.max);
  return (
    <Button
      label={fanslyText(i18n, 'fansly.newcomers.pickAll', { n })}
      variant="quiet"
      size="sm"
      class="cg-fnw__pickall"
      tooltip={fanslyText(i18n, 'fansly.newcomers.pickTooltip', { max: batch.max })}
      onClick={() => void dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: free.slice(0, batch.max), picked: true })}
    />
  );
}

/**
 * The batch at the foot of the list: what is ticked and «Сгенерировать N»; while it runs, how far it got and
 * «Остановить»; once drafts are ready, how many and «Очистить», and the hint to read each draft in its row and send it
 * there (X59: one click per fan, never all at once).
 */
function BatchBar({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const batch = vm.batch;
  if (batch === undefined) return null;
  const made = batch.queued + batch.generating + batch.ready + batch.sent + batch.failed;
  const generating = batch.queued + batch.generating > 0;
  if (batch.picked === 0 && made === 0) return null;
  return (
    <div class="cg-fnw__batch" role="group" aria-label={i18n.t('batch.pickAll')} data-cg-batch={generating ? 'running' : batch.picked > 0 ? 'picked' : 'done'}>
      {batch.picked > 0 && !generating ? (
        <div class="cg-fnw__bline">
          <span class="cg-fnw__bn">{fanslyText(i18n, 'fansly.newcomers.batch.picked', { n: batch.picked })}</span>
          <span class="cg-fnw__grow" />
          <Button label={i18n.t('batch.unpick')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list: 'newcomers' })} />
          <Button
            label={fanslyText(i18n, 'fansly.newcomers.batch.generate', { n: batch.picked })}
            variant="line"
            size="sm"
            class="cg-fnw__go"
            reason={batch.reason === null ? null : i18n.text(batch.reason)}
            tooltip={i18n.t('batch.generateTooltip')}
            onClick={() => void dispatch({ type: 'GenerateBatch', list: 'newcomers' })}
          />
        </div>
      ) : null}
      {generating ? (
        <div class="cg-fnw__bline">
          <span class="cg-fnw__bst" role="status">
            <Spinner />
            {fanslyText(i18n, 'fansly.newcomers.batch.generating', { done: batch.ready + batch.sent, total: made })}
          </span>
          <span class="cg-fnw__grow" />
          <Button label={i18n.t('batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatch', list: 'newcomers' })} />
        </div>
      ) : made > 0 ? (
        <div class="cg-fnw__bline">
          <span class="cg-fnw__bst" role="status">
            {fanslyText(i18n, 'fansly.newcomers.batch.ready', { n: batch.ready })}
            {batch.sent === 0 ? null : ` · ${fanslyText(i18n, 'fansly.newcomers.batch.sent', { n: batch.sent })}`}
            {batch.failed === 0 ? null : ` · ${fanslyText(i18n, 'fansly.newcomers.batch.failed', { n: batch.failed })}`}
          </span>
          <span class="cg-fnw__grow" />
          <Button label={i18n.t('batch.clear')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'ClearBatch', list: 'newcomers' })} />
        </div>
      ) : null}
      {!generating && batch.ready > 0 ? <div class="cg-fnw__bline is-hint">{fanslyText(i18n, 'fansly.newcomers.batch.review')}</div> : null}
    </div>
  );
}

// ── the card ──

/** One message; the pass's messages keep their identity between models, so a bubble is drawn once. */
const Bubble = pure(function BubbleView({ message }: { readonly message: NewcomerMessageVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class={`cg-fnc__msg${message.fromFan ? '' : ' is-own'}`} data-cg-msg={message.id}>
      <span class="cg-sr">{fanslyText(i18n, message.fromFan ? 'fansly.newcomers.fanPrefix' : 'fansly.newcomers.ownPrefix')} </span>
      {message.automated ? <span class="cg-fnc__auto">{fanslyText(i18n, 'fansly.newcomers.automated')}</span> : null}
      {message.text}
      {message.attachments > 0 ? <span class="cg-fnc__att">{fanslyText(i18n, 'fansly.newcomers.attachments', { n: message.attachments })}</span> : null}
      <time class="cg-fnc__time cg-num">{i18n.formatTime(message.at, 'datetime')}</time>
    </div>
  );
}, (a, b) => a.message === b.message);

/** The conversation as the pass read it (NF-010): oldest first, «Более ранние сообщения», the cap of 750 said. */
function History({ card }: { readonly card: NewcomerCardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const history = card.history;
  const scroller = useRef<HTMLDivElement>(null);
  const before = useRef<{ readonly first: string | null; readonly height: number; readonly top: number } | null>(null);
  const first = history.messages[0]?.id ?? null;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const previous = before.current;
    if (previous === null) node.scrollTop = node.scrollHeight;
    // An older page arrived above: what the person was reading does not jump.
    else if (previous.first !== first) node.scrollTop = previous.top + (node.scrollHeight - previous.height);
    before.current = { first, height: node.scrollHeight, top: node.scrollTop };
  }, [first, history.messages.length, history.s]);
  const state = (key: FanslyNewcomersTextKey, busy = false): JSX.Element => (
    <div class="cg-fnc__empty" {...(busy ? { role: 'status' } : {})} data-cg-history={history.s}>
      {busy ? <Spinner /> : null}
      {fanslyText(i18n, key)}
    </div>
  );
  const retry = <Button label={fanslyText(i18n, 'fansly.newcomers.history.retry')} variant="line" size="sm" onClick={() => void dispatch({ type: 'RefreshArchive', targetHandle: card.handle })} />;
  let body: JSX.Element | null = null;
  if (history.s === 'unchecked') body = card.check === 'checking' ? state('fansly.newcomers.history.checking', true) : state('fansly.newcomers.history.unchecked');
  else if (history.s === 'none') body = card.proof === null ? state('fansly.newcomers.history.none') : null;
  else if (history.s === 'loading') body = state('fansly.newcomers.history.loading', true);
  else if (history.s === 'failed') {
    body = (
      <div class="cg-fnc__fail" data-cg-history="failed">
        <p>{fanslyText(i18n, 'fansly.newcomers.history.failed')}</p>
        {history.failure === null ? null : (
          <ErrorCard error={failureView(i18n, history.failure)} tone="failure" inline alert={false}>
            {card.check === 'failed' ? null : retry}
          </ErrorCard>
        )}
      </div>
    );
  } else if (history.messages.length === 0) body = state('fansly.newcomers.history.empty');
  return (
    <div
      ref={scroller}
      class="cg-fnc__feed"
      role="log"
      aria-label={fanslyText(i18n, 'fansly.newcomers.history.label')}
      tabIndex={0}
      onScroll={(event) => {
        const node = event.currentTarget;
        if (before.current !== null) before.current = { ...before.current, top: node.scrollTop, height: node.scrollHeight };
      }}
    >
      {history.capped ? <div class="cg-fnc__sys">{fanslyText(i18n, 'fansly.newcomers.history.capped', { n: history.cap })}</div> : null}
      {history.s === 'ready' && history.failure !== null && history.messages.length > 0 ? (
        <div class="cg-fnc__older">
          <ErrorCard error={failureView(i18n, history.failure)} tone="failure" inline alert={false}>
            {retry}
          </ErrorCard>
        </div>
      ) : history.loadingMore ? (
        <div class="cg-fnc__older" role="status">
          <Spinner label={i18n.t('common.loading')} />
        </div>
      ) : history.more ? (
        <div class="cg-fnc__older">
          <Button label={fanslyText(i18n, 'fansly.newcomers.history.older')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'LoadOlder', targetHandle: card.handle })} />
        </div>
      ) : null}
      {history.messages.map((message) => (
        <Bubble key={message.id} message={message} />
      ))}
      {body}
    </div>
  );
}

/**
 * What the pass has to say about the fan when it is not «Не писали» or «Ждёт ответа»: «Уже писали», why nobody can write to them and
 * «Исключить из очереди» (FS-NEW-2), why the check failed, that the chat is not checked yet and «Проверить чат» (NF-038).
 */
function Verdict({ card }: { readonly card: NewcomerCardVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const hasPrice = card.dmClosed === 'paid' && card.dmPriceMills !== undefined && card.dmPriceMills !== null;
  const closed = card.dmClosed !== null && (card.check === 'dm-closed' || card.check === 'excluded');
  const checkNext = card.checkNext ?? null;
  const exclude = card.exclude ?? null;
  if (card.check === 'ready' || card.check === 'reply') return null;
  return (
    <div class="cg-fnc__verdict" data-cg-check={card.check}>
      <div class="cg-fnc__why">
        <b>{checkText(i18n, card.check)}</b>
        {closed ? (
          <span>
            {hasPrice
              ? fanslyText(i18n, 'fansly.newcomers.dmClosed.paidPrice', { price: i18n.formatMoneyMills(card.dmPriceMills ?? null, { cents: true, zero: 'show' }) })
              : fanslyText(i18n, `fansly.newcomers.dmClosed.${card.dmClosed ?? 'permissions'}`)}
          </span>
        ) : null}
        {card.check === 'failed' && card.failure !== null ? (
          <span>
            {fanslyText(i18n, 'fansly.newcomers.errorFrom', { code: card.failure.code })} · {failureView(i18n, card.failure).title}
          </span>
        ) : null}
      </div>
      {checkNext === null ? null : (
        <span class="cg-fnc__check">
          <Button
            label={fanslyText(i18n, checkNext === 'next' ? 'fansly.newcomers.checkNext' : 'fansly.newcomers.checkNow')}
            variant="line"
            size="sm"
            onClick={() => void dispatch({ type: 'CheckNewcomerNext', targetHandle: card.handle })}
          />
        </span>
      )}
      {exclude === null ? null : (
        <span class="cg-fnc__check">
          <Button
            label={fanslyText(i18n, exclude === 'exclude' ? 'fansly.newcomers.exclude' : 'fansly.newcomers.restore')}
            tooltip={exclude === 'exclude' ? fanslyText(i18n, 'fansly.newcomers.excludeTooltip') : null}
            variant="line"
            size="sm"
            onClick={() => void dispatch({ type: 'ExcludeNewcomer', targetHandle: card.handle, excluded: exclude === 'exclude' })}
          />
        </span>
      )}
    </div>
  );
}

/** «Открыть в Fansly ↗» (NF-011): the person's own link to the chat, in a new tab; the window stays. */
function OpenLink({ href }: { readonly href: string }): JSX.Element {
  const i18n = useI18n();
  const hints = useHints();
  const tip = useTooltip(hints ? fanslyText(i18n, 'fansly.newcomers.openTooltip') : null);
  return (
    <>
      <a class="cg-fnc__open" href={href} target="_blank" rel="noopener noreferrer" {...tip.props}>
        {fanslyText(i18n, 'fansly.newcomers.open')}
      </a>
      {tip.description}
    </>
  );
}

/** The words of a mark over an unchanged AI text, by its reason (ui-design §4.7; Fansly's catalog has the window check's). */
const MARK_WORDS = { 'fan-wrote': '', 'archive-moved': '', unverified: '.unverified', 'window-miss': '.windowMiss', 'deleted-served': '.deletedServed' } as const satisfies Record<StaleReason, string>;

/** Where the card's click stands: a spinner while it runs, «✓ Отправлено 09:21», a dot and the code's line otherwise. */
function GreetingState({ greeting }: { readonly greeting: NewcomerGreetingVM }): JSX.Element | null {
  const i18n = useI18n();
  const state = greeting.state;
  switch (state.s) {
    case 'idle':
      return null;
    case 'generating':
    case 'sending':
      return (
        <div class="cg-fnc__gst" role="status">
          <Spinner />
          <b>{fanslyText(i18n, state.s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating')}</b>
        </div>
      );
    case 'inserted':
      return (
        <div class="cg-fnc__gst" role="status">
          {fanslyText(i18n, 'fansly.newcomers.greeting.inserted')}
        </div>
      );
    case 'sent':
      return (
        <div class="cg-fnc__gst is-sent" role="status">
          <Icon name="check" />
          <span>{fanslyText(i18n, 'fansly.newcomers.greeting.sent', { time: state.at === null ? '' : i18n.formatTime(state.at, 'time') })}</span>
        </div>
      );
    case 'refused':
    case 'uncertain':
      return (
        <div class="cg-fnc__gst" role="status" data-cg-code={state.failure.code}>
          <Dot kind={state.s === 'refused' ? 'danger' : 'ink'} />
          <b>{fanslyText(i18n, state.s === 'refused' ? 'fansly.newcomers.greeting.refused' : 'fansly.newcomers.greeting.uncertain')}</b>
          <span class="cg-fnc__gcode">
            ChatGoose · {state.failure.code}: {failureView(i18n, state.failure).title}
          </span>
        </div>
      );
  }
}

/** The card's greeting (R20 P10c): the draft, «AI» while it is the generation unchanged, «Сгенерировать», «Открыть и вставить», «Отправить →». */
function Greeting({ handle, greeting, onSent }: { readonly handle: string; readonly greeting: NewcomerGreetingVM; readonly onSent: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const draft = useOwnEchoes(greeting.text, handle);
  const s = greeting.state.s;
  const running = s === 'generating' || s === 'sending';
  const words = (reason: StaleReason, part: 'title' | 'body'): string => i18n.t(`result.stale${MARK_WORDS[reason]}.${part}` as I18nKey);
  const runningText = (): string => fanslyText(i18n, s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating');
  // Why a button is off, in the tooltip it always shows (ui-design §4): what runs, what the pass has not proven, how the click ended, an empty field.
  const why = (): string => {
    if (running) return runningText();
    if (greeting.waiting) return fanslyText(i18n, 'fansly.newcomers.greeting.waiting');
    if (s === 'sent' || s === 'uncertain') return fanslyText(i18n, s === 'sent' ? 'fansly.newcomers.greeting.sent' : 'fansly.newcomers.greeting.uncertain', { time: '' }).trim();
    return fanslyText(i18n, 'fansly.newcomers.greeting.placeholder');
  };
  const sendReason = greeting.canSend || s === 'sending' ? null : greeting.sendBlocked !== null ? failureView(i18n, greeting.sendBlocked).title : why();
  return (
    <div class="cg-fnc__greet" data-cg-greeting={s}>
      {greeting.mark === null ? null : (
        <div class="cg-stale cg-fnc__mark" role="status">
          <span class="cg-gut">
            <Dot kind="accent" use="result-stale" />
          </span>
          <span class="cg-stale__t">
            <b>{words(greeting.mark, 'title')}</b> {words(greeting.mark, 'body')}
          </span>
        </div>
      )}
      {greeting.stale ? <div class="cg-fnc__gnote is-strong">{fanslyText(i18n, 'fansly.newcomers.greeting.stale')}</div> : null}
      {greeting.waiting ? <div class="cg-fnc__gnote">{fanslyText(i18n, 'fansly.newcomers.greeting.waiting')}</div> : null}
      <div class="cg-fnc__field">
        <TextField
          value={draft.shown}
          label={fanslyText(i18n, 'fansly.newcomers.greeting.label')}
          placeholder={fanslyText(i18n, 'fansly.newcomers.greeting.placeholder')}
          multiline
          minHeight={72}
          maxHeight={180}
          maxLength={greeting.maxChars}
          reason={running ? runningText() : null}
          onValue={(typed) => {
            const text = typed.slice(0, greeting.maxChars);
            draft.sent(text);
            void dispatch({ type: 'SetPreviewDraft', targetHandle: handle, text });
          }}
        />
        {greeting.ai ? (
          <span class="cg-fnc__ai" title={fanslyText(i18n, 'fansly.newcomers.greeting.aiTooltip')}>
            {fanslyText(i18n, 'fansly.newcomers.greeting.ai')}
          </span>
        ) : null}
      </div>
      <div class="cg-fnc__gbar">
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.generate')}
          variant="line"
          size="sm"
          busy={s === 'generating'}
          tooltip={fanslyText(i18n, 'fansly.newcomers.noAutoSend')}
          reason={greeting.canGenerate || s === 'generating' ? null : why()}
          onClick={() => void dispatch({ type: 'Generate', targetHandle: handle, feature: 'hi', options: {} })}
        />
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.insert')}
          variant="quiet"
          size="sm"
          tooltip={fanslyText(i18n, 'fansly.newcomers.greeting.insertTooltip')}
          reason={greeting.canInsert ? null : why()}
          onClick={() => void dispatch({ type: 'InsertNewcomerGreeting', targetHandle: handle })}
        />
        <span class="cg-fnw__grow" />
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.send')}
          variant="send"
          busy={s === 'sending'}
          tooltip={fanslyText(i18n, 'fansly.newcomers.noAutoSend')}
          reason={sendReason}
          onClick={() =>
            void dispatch({ type: 'SendNewcomerGreeting', targetHandle: handle }).then((receipt) => {
              if (receipt?.ok === true) onSent(handle);
            })
          }
        />
      </div>
      <GreetingState greeting={greeting} />
    </div>
  );
}

function Card({ card, onSent }: { readonly card: NewcomerCardVM; readonly onSent: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const greeting = card.greeting ?? null;
  return (
    <section class="cg-fnc" aria-label={fanslyText(i18n, 'fansly.newcomers.cardLabel')} data-cg-card={card.handle}>
      <header class="cg-fnc__head">
        <Avatar name={card.name} url={card.avatarUrl} size="card" />
        <div class="cg-fnc__who">
          <h3 class="cg-fnc__name">
            {card.name}
            {card.customName === null ? null : <span class="cg-fnw__custom"> ({card.customName})</span>}
          </h3>
          <div class="cg-fnc__meta" title={fanslyText(i18n, 'fansly.newcomers.followedAt', { date: i18n.formatTime(card.followedAt, 'datetime') })}>
            {card.username === null ? null : `@${card.username} · `}
            {fanslyText(i18n, 'fansly.newcomers.followedAgo', { age: i18n.formatAge(card.followedAt) })}
            {card.checkedAt === null ? null : ` · ${fanslyText(i18n, 'fansly.newcomers.checkedAt', { time: i18n.formatTime(card.checkedAt, 'time') })}`}
          </div>
        </div>
        {card.openHref === null ? null : <OpenLink href={card.openHref} />}
      </header>
      {card.bio === null || card.bio.trim() === '' ? null : <div class="cg-fnc__bio">{card.bio}</div>}
      {card.proof === null ? null : (
        <details class="cg-fnc__proof">
          <summary>{fanslyText(i18n, 'fansly.newcomers.proof', { date: i18n.formatTime(card.proof.at, 'datetime') })}</summary>
          <div class="cg-fnc__proofNote">{fanslyText(i18n, 'fansly.newcomers.proofNote')}</div>
          <blockquote>{card.proof.text}</blockquote>
        </details>
      )}
      <History key={card.handle} card={card} />
      <Verdict card={card} />
      {greeting === null ? null : <Greeting handle={card.handle} greeting={greeting} onSent={onSent} />}
    </section>
  );
}

// ── the window ──

export function FanslyNewcomersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root, deps } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  const pass = vm.pass ?? null;
  const rows = vm.rows;
  const textSize = useValueSignal(deps.textSize ?? NORMAL_TEXT).value;
  useMinuteClock(rows.length > 0);
  const minute = Math.floor(useNowFn()() / 60_000);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Pages of 100 (NF-006): asked once per length of the list, again for another query or pass.
  const askedMore = useRef(-1);
  const passId = pass?.passId ?? null;
  const filter = pass?.filters.find((item) => item.pressed)?.id ?? 'any';
  useLayoutEffect(() => {
    askedMore.current = -1;
  }, [passId, vm.tab, vm.query, filter]);

  // The keyboard's row: the one the person is on, else the selected one.
  const [activeHandle, setActiveHandle] = useState<string | null>(() => (rows.find((row) => row.selected) ?? rows[0])?.handle ?? null);
  const current = useMemo(() => {
    const at = activeHandle === null ? -1 : rows.findIndex((row) => row.handle === activeHandle);
    return at >= 0 ? at : Math.max(0, rows.findIndex((row) => row.selected));
  }, [rows, activeHandle]);
  const currentHandle = rows[current]?.handle ?? null;
  useEffect(() => {
    if (currentHandle !== activeHandle) setActiveHandle(currentHandle);
  }, [currentHandle, activeHandle]);
  const { wrapRef, listRef, focusRow, settle } = useRowFocus(currentHandle);

  const latestRows = useRef(rows);
  latestRows.current = rows;

  // Esc in turn: the search, then the window.
  const close = useCallback((): void => {
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else void dispatch(CLOSE_WINDOW);
  }, [vm.query, dispatch]);

  // The window opens on the selected row — also when the rows arrive later, unless the person moved focus meanwhile.
  const hasRows = rows.length > 0;
  const openedOn = useRef<Element | null | undefined>(undefined);
  useLayoutEffect(() => {
    const firstTime = openedOn.current === undefined;
    const box = frameRef.current?.closest<HTMLElement>('.cg-dialog') ?? null;
    const focused = root.activeElement;
    if (hasRows && currentHandle !== null && (firstTime || focused === openedOn.current || focused === null || focused === box)) focusRow(current, currentHandle);
    if (firstTime) openedOn.current = root.activeElement;
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

  // The card follows the keyboard's row once the keys stop (X55): a held J asks the pass for no card per row.
  const cardFollow = useCardFollow((handle) => void dispatch({ type: 'OpenPreview', targetHandle: handle }));
  const move = (to: number): void => {
    const row = rows[to];
    if (row === undefined) return;
    setActiveHandle(row.handle);
    focusRow(to, row.handle);
    cardFollow.follow(row.handle);
  };

  /** X59: after the card's own «Отправить →», the next draft of the batch, so the person reads and sends on. */
  const onSent = useCallback(
    (handle: string): void => {
      const next = nextDraft(latestRows.current, handle);
      if (next === null) return;
      const at = latestRows.current.findIndex((row) => row.handle === next);
      setActiveHandle(next);
      focusRow(at, next);
      void dispatch({ type: 'OpenPreview', targetHandle: next });
    },
    [dispatch, focusRow],
  );

  const onListKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    // The keys act on the row that HAS focus, found by its fan in the list as it is now.
    const handle = rowKeyOf(event.target);
    const at = handle === null ? -1 : rows.findIndex((entry) => entry.handle === handle);
    const row = rows[at];
    if (row === undefined) return;
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0 || event.key === 'Home' || event.key === 'End') {
      const to = step !== 0 ? at + step : rovingIndex(event.key, at, rows.length, 'vertical', false);
      event.preventDefault();
      if (to !== null && to !== at) move(to);
      return;
    }
    if (event.code === 'KeyX') {
      event.preventDefault();
      const batch = row.batch;
      if (batch !== undefined && (batch.pickable || batch.picked)) void dispatch({ type: 'SetBatchPick', list: 'newcomers', targetHandles: [row.handle], picked: !batch.picked });
      return;
    }
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      cardFollow.stop();
      const shown = pass?.card ?? null;
      if (shown === null || shown.handle !== row.handle) {
        void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
        return;
      }
      const start = greetingStart(shown);
      // The draft is there (or Generate is off): the field takes the focus — what goes to the fan is read there, and
      // «Отправить →» is a click.
      if (start !== null) void dispatch(start);
      else focusQuietly(frameRef.current?.querySelector<HTMLElement>('.cg-fnc__field textarea') ?? null);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      cardFollow.stop();
      void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
    }
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || isTextEntry(event.target) || !isPlainKey(event)) return;
    if (event.code === 'Slash' || event.key === '/') {
      event.preventDefault();
      searchRef.current?.focus();
    }
  };

  const heights = ROW_HEIGHTS[textSize];
  const rowHeight = useCallback((row: NewcomerRowVM): number => {
    const draft = (row.batch?.state === 'ready' || row.batch?.state === 'sent') && row.batch.text !== null;
    return draft ? heights.base + heights.draft : heights.base;
  }, [heights]);

  const failed = pass?.stage === 'failed';
  const forbidden = vm.view.s === 'forbidden' || (pass === null && vm.view.s !== 'loading');
  const filterOn = pass?.filters.some((item) => item.pressed && item.id !== 'any') ?? false;
  const showList = hasRows && !failed && vm.view.s !== 'error' && vm.view.s !== 'forbidden' && vm.view.s !== 'empty';
  const range = rangeText(i18n, pass);
  const card = pass?.card ?? null;
  const title = fanslyText(i18n, 'fansly.newcomers.title');

  let list: JSX.Element;
  if (showList) {
    list = (
      <div class="cg-fnw__list" ref={wrapRef}>
        <VirtualList
          items={rows}
          rowHeight={rowHeight}
          getKey={(row) => row.handle}
          role="listbox"
          label={fanslyText(i18n, 'fansly.newcomers.listLabel')}
          listRef={listRef}
          onRangeChange={onRange}
          onKeyDown={onListKeyDown}
          renderRow={(row, index) => <Row row={row} index={index} count={rows.length} active={index === current} minute={minute} onPick={setActiveHandle} />}
        />
      </div>
    );
  } else if (vm.view.s === 'empty') {
    list = (
      <div class="cg-fnw__state" data-cg-empty="1">
        {emptyText(i18n, vm, filterOn)}
      </div>
    );
  } else {
    list = (
      <div class="cg-fnw__state">
        <ViewState view={vm.view} />
      </div>
    );
  }

  return (
    <OverlayLayer>
      <Dialog
        open
        label={title}
        size="wide"
        class={`cg-fnw${textSize === 'large' ? ' is-large' : ''}`}
        onClose={close}
        initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}
      >
        <div ref={frameRef} class="cg-fnw__frame" onKeyDown={onKeyDown}>
          <header class="cg-fnw__head">
            <div class="cg-fnw__titles">
              <h2 class="cg-fnw__title">{title}</h2>
              {/* Fansly's account may carry its id alone: the bound page names it then. */}
              <span class="cg-fnw__sub">
                {pass?.creator === null || pass?.creator === undefined ? null : <span class="cg-fnw__creator">@{pass.creator}</span>}
                {vm.pageName === null ? null : <span class="cg-fnw__page">{vm.pageName}</span>}
              </span>
            </div>
            <Button label={i18n.t('common.close')} icon="x" iconOnly variant="quiet" class="cg-fnw__close" onClick={() => void dispatch(CLOSE_WINDOW)} />
          </header>
          {forbidden ? null : (
            <div class="cg-fnw__bar" data-cg-pass={pass?.stage ?? 'none'}>
              <PeriodMenu vm={vm} range={range} />
              {pass === null ? null : <Stage pass={pass} />}
              {pass?.run === undefined || failed ? null : <RunButton run={pass.run} />}
              <span class="cg-fnw__grow" />
              <SearchBox
                value={vm.query}
                label={i18n.t('spenders.search.placeholder')}
                placeholder={i18n.t('spenders.search.placeholder')}
                class="cg-sp__search cg-fnw__search"
                inputRef={searchRef}
                onQuery={(query) => void dispatch({ type: 'Search', list: 'newcomers', query })}
              />
              <Button label={fanslyText(i18n, 'fansly.newcomers.refresh')} icon="refresh" iconOnly variant="quiet" class="cg-fnw__refresh" busy={pass?.stage === 'connecting'} onClick={() => void dispatch(RELOAD)} />
            </div>
          )}
          {pass === null || forbidden || failed ? null : <PassLines vm={vm} pass={pass} range={range} />}
          {/* The port to the background is down: what is shown stays, the banner says so (its return reads it again). */}
          {vm.view.s === 'offline' && !failed && hasRows ? <ViewState view={vm.view} /> : null}
          {failed || forbidden ? (
            failed ? (
              <ListFailed failure={pass?.failure ?? null} />
            ) : (
              <div class="cg-fnw__state">
                <ViewState view={vm.view} />
              </div>
            )
          ) : (
            <div class="cg-fnw__main">
              <aside class="cg-fnw__side" aria-label={fanslyText(i18n, 'fansly.newcomers.listLabel')} data-cg-newcomers={vm.view.s}>
                <ListTabs vm={vm} />
                {pass === null ? null : (
                  <div class="cg-fnw__tools" role="group" aria-label={fanslyText(i18n, 'fansly.newcomers.filter.label')}>
                    <StatusMenu pass={pass} />
                    <span class="cg-fnw__grow" />
                    <PickAll rows={rows} vm={vm} />
                  </div>
                )}
                {list}
                <BatchBar vm={vm} />
              </aside>
              {card === null ? (
                <section class="cg-fnc cg-fnc--none" aria-label={fanslyText(i18n, 'fansly.newcomers.cardLabel')}>
                  <div class="cg-fnc__empty">{vm.view.s === 'loading' ? <Spinner label={i18n.t('common.loading')} /> : fanslyText(i18n, 'fansly.newcomers.empty.card')}</div>
                </section>
              ) : (
                <Card key={card.handle} card={card} onSent={onSent} />
              )}
            </div>
          )}
        </div>
      </Dialog>
    </OverlayLayer>
  );
}
