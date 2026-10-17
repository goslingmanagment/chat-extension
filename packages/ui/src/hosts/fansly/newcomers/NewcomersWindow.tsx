// «Новые» on Fansly (R20 P10a; docs/project-unite/architecture.md §8.7, §8.17; ui-design §3.6, §3.12, §4.17;
// FS-NEW-1; NF-001…NF-011, NF-025…NF-027, FX-017): the window of new followers the background's pass checks — the
// period 1–720 hours, the tabs «К обработке / Все», the status filters with counts, the search, pages of 100 as the
// person scrolls, the stage of the pass, and the card of the selected fan: the profile, the verdict, «Уже писали»
// folded, the conversation as the pass read it (up to 750 messages, automation marked) and «Открыть в Fansly ↗», the
// chat in a new tab — the window stays (NF-011). A list that was not read says so, never «nobody new» (FX-017).
//
// It draws the shared `NewcomersVM` with its `pass` (the hub's list of ChatSpace is ui/newcomers): the layout, the
// header, the filters, the rows and the feed's bubbles of the family; the words are Fansly's own pack, laid over the
// tab's I18n by the surface (index.tsx). No remote picture: a fan's avatar is the initial (ui-design §1 п. 12).
// R20 P10c: the card's greeting at its foot (FS-NEW-3, FS-NEW-6; NF-012…NF-019, NF-028): the draft field, «Сгенерировать»
// (a line), «Открыть и вставить» (quiet) and «Отправить →» — the only blue: it is what reaches the fan —, the «AI» mark of
// an unchanged result and its verdict, where the click stands (sending, sent, refused with its code, unknown), and the
// hint that AI sends nothing on its own.
// Decision X55: Enter on the card's own row is its greeting — «Сгенерировать» while the field is empty and the
// button is on, the field otherwise; «Отправить →» stays a click.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { isCgAnyCode, type CgAnyCode } from '@cg/contracts/errors-fansly';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { isCgCode, type CgCode, type CgErrorView, type I18nKey } from '@cg/contracts/errors';
import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { type FanslyNewcomersTextKey } from '@cg/contracts/newcomers-fansly';
import { type StaleReason } from '@cg/contracts/ops';
import {
  type I18n,
  type I18nParams,
  type NewcomerCardVM,
  type NewcomerGreetingVM,
  type NewcomerCheck,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassRunVM,
  type NewcomersPassVM,
  type NewcomersTab,
  type NewcomersVM,
  type UiAction,
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
  Tabs,
  TextField,
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
  useNowFn,
  useCountdown,
  useTooltip,
  useView,
} from '../../../kit';
import { BatchBar, BatchCheck, BatchCheckAll, BatchLine, inBatch } from '../../../spenders/batch';
import { useOwnEchoes } from '../../../spenders/ownEchoes';
import { rowKeyOf, useCardFollow, useRowFocus } from '../../../spenders/rowFocus';
import { ChoiceMenu, DataFooter, InitialAvatar, WindowHeader, isPlainKey, isTextEntry } from '../../../spenders/window';

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 28;
const LOAD_MORE_MARGIN = 20;

const CLOSE_WINDOW: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: false } };
const RELOAD: UiAction = { type: 'ReloadView', selector: { of: 'newcomers' } };

/** Enter on the card's own row (X55): «Сгенерировать» when the field is empty and the button is on; null — the field takes the focus instead. */
export function greetingStart(card: NewcomerCardVM): UiAction | null {
  const greeting = card.greeting ?? null;
  if (greeting === null || !greeting.canGenerate || greeting.text.trim() !== '' || greeting.state.s === 'generating' || greeting.state.s === 'sending') return null;
  return { type: 'Generate', targetHandle: card.handle, feature: 'hi', options: {} };
}

/** A text of Fansly's own pack (`fansly.newcomers.*`), through the I18n the surface laid it over. */
export function fanslyText(i18n: I18n, key: FanslyNewcomersTextKey, params?: I18nParams): string {
  return i18n.t(key as unknown as I18nKey, params);
}

/** «48 часов», «7 дней»: whole weeks and more read as days. */
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

/** The status column: actionable verdicts strong, the rest in the list's ink; never a colour (ui-design §1 п. 5). */
function Status({ check }: { readonly check: NewcomerCheck }): JSX.Element {
  const i18n = useI18n();
  const text = checkText(i18n, check);
  if (check === 'checking') {
    return (
      <span class="cg-nc__st">
        <Spinner />
        {text}
      </span>
    );
  }
  if (check === 'greeted') {
    return (
      <span class="cg-nc__st">
        <Icon name="check" size={14} />
        {text}
      </span>
    );
  }
  if (check === 'failed') {
    return (
      <span class="cg-nc__st is-2">
        <Dot kind="ink" />
        {text}
      </span>
    );
  }
  return <span class={`cg-nc__st${check === 'ready' || check === 'reply' ? ' is-strong' : check === 'dm-closed' || check === 'excluded' ? ' is-2' : ''}`}>{text}</span>;
}

function Row({ row, index, active, onPick }: { readonly row: NewcomerRowVM; readonly index: number; readonly active: boolean; readonly onPick: (handle: string) => void }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const check = row.check?.status ?? 'pending';
  const custom = row.check?.customName ?? null;
  return (
    <div
      class={`cg-nc__grid cg-nc__row cg-fnw__row${row.selected ? ' is-sel' : ''}`}
      role="row"
      aria-rowindex={index + 2}
      {...(row.selected ? { 'aria-current': 'true' as const } : {})}
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
      <span role="cell" class="cg-nc__who">
        {row.batch === undefined ? null : <BatchCheck list="newcomers" handle={row.handle} row={row.batch} name={row.name} />}
        <InitialAvatar name={row.name} />
        <span class="cg-nc__names">
          <span class="cg-nc__name">
            {row.name}
            {custom === null ? null : <span class="cg-fnw__custom"> ({custom})</span>}
          </span>
          {/* In a batch the second line says how its Hi went, with the text that came out. */}
          {row.batch !== undefined && inBatch(row) ? (
            <BatchLine row={row.batch} failureTitle={(code) => failureView(i18n, { code, retryAt: null }).title} />
          ) : row.username === null ? null : (
            <span class="cg-nc__handle">@{row.username}</span>
          )}
        </span>
      </span>
      <span role="cell" class="cg-nc__ago cg-num">
        {i18n.formatAge(row.subscribedAt)}
      </span>
      <span role="cell" class="cg-nc__status">
        <Status check={check} />
      </span>
    </div>
  );
}

function ColumnHeader({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class="cg-nc__grid cg-nc__colhead" role="row" aria-rowindex={1}>
      <span role="columnheader" class="cg-nc__who">
        {vm.batch === undefined ? null : <BatchCheckAll list="newcomers" handles={vm.rows.map((row) => row.handle)} batch={vm.batch} />}
        {fanslyText(i18n, 'fansly.newcomers.col.fan')}
      </span>
      <span role="columnheader" class="cg-nc__ago">
        {fanslyText(i18n, 'fansly.newcomers.col.followed')}
      </span>
      <span role="columnheader">{fanslyText(i18n, 'fansly.newcomers.col.status')}</span>
    </div>
  );
}

/** The period of the window (NF-003): 1 hour to 30 days, 48 hours first; the dates it covers in the tooltip. */
function PeriodMenu({ vm, range }: { readonly vm: NewcomersVM; readonly range: string | null }): JSX.Element | null {
  const i18n = useI18n();
  const hints = useHints();
  const dispatch = useDispatch();
  return (
    <ChoiceMenu
      label={periodText(i18n, vm.windowHours)}
      menuLabel={fanslyText(i18n, 'fansly.newcomers.window')}
      tooltip={range ?? (hints ? fanslyText(i18n, 'fansly.newcomers.window') : null)}
      class="cg-fnw__period"
      align="end"
      items={vm.windowOptions.map((hours) => ({ id: String(hours), label: periodText(i18n, hours), checked: hours === vm.windowHours }))}
      onSelect={(id) => {
        const hours = vm.windowOptions.find((value) => String(value) === id);
        if (hours !== undefined && hours !== vm.windowHours) void dispatch({ type: 'SetNewcomersWindow', hours });
      }}
    />
  );
}

/** The status filter (NF-004): one menu, as the old window's select, not seven chips. */
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
      class="cg-nc__filter"
      items={pass.filters.map((filter) => ({ id: filter.id, label: label(filter.id), count: filter.count, checked: filter.pressed }))}
      onSelect={(id) => {
        const filter = pass.filters.find((item) => item.id === id);
        if (filter !== undefined && !filter.pressed) void dispatch({ type: 'SetNewcomersCheckFilter', filter: filter.id });
      }}
    />
  );
}

/** «1 окт, 09:16 — 3 окт, 09:16 · местное время»: the dates the pass covers. */
function rangeText(i18n: I18n, pass: NewcomersPassVM | null): string | null {
  if (pass === null || pass.range === null) return null;
  return fanslyText(i18n, 'fansly.newcomers.range', { from: i18n.formatTime(pass.range.from, 'datetime'), to: i18n.formatTime(pass.range.to, 'datetime') });
}

/** «Проверено 12 из 40», the phase of the fast part, the queue (NF-008); a spinner while the pass reads. */
function Stage({ pass }: { readonly pass: NewcomersPassVM }): JSX.Element | null {
  const i18n = useI18n();
  const remaining = pass.total === null || pass.checked === null ? null : Math.max(0, pass.total - pass.checked);
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
      text = fanslyText(i18n, 'fansly.newcomers.stage.queue', { n: remaining ?? 0 });
      break;
    case 'paused':
      text = fanslyText(i18n, 'fansly.newcomers.stage.paused', { n: remaining ?? 0 });
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
      text = fanslyText(i18n, 'fansly.newcomers.stage.failed');
      break;
  }
  if (text === null) return null;
  return (
    <span class="cg-nc__scan cg-num" role="status" data-cg-stage={pass.stage}>
      {busy ? <Spinner /> : null}
      {text}
    </span>
  );
}

/** Fansly asked for a pause: how long, said once a second while it lasts (the pass goes on by itself). */
function Cooldown({ until }: { readonly until: number }): JSX.Element | null {
  const i18n = useI18n();
  const left = useCountdown(until, useNowFn());
  if (left <= 0) return null;
  return (
    <div class="cg-sp__line cg-fnw__cool" role="status">
      {fanslyText(i18n, 'fansly.newcomers.stage.cooldown', { s: Math.ceil(left / 1000) })}
    </div>
  );
}

/** Under the filters, only when there is something to say: the pause Fansly asked for, «Результат неполный» (NF-025), why the pass stopped. */
function PassLines({ vm, pass }: { readonly vm: NewcomersVM; readonly pass: NewcomersPassVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      {pass.stage === 'cooldown' && pass.cooldownUntil !== null ? <Cooldown until={pass.cooldownUntil} /> : null}
      {vm.incomplete === null ? null : (
        <div class="cg-sp__line cg-nc__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b>
          <span>{fanslyText(i18n, 'fansly.newcomers.incomplete')}</span>
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

/** NF-038: «Пауза» while the queue runs, «Проверить оставшихся: N» while it stands with fans left (R20 P10b1). */
function RunButton({ run }: { readonly run: NewcomersPassRunVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const label = run.pause ? fanslyText(i18n, 'fansly.newcomers.run.pause') : fanslyText(i18n, 'fansly.newcomers.run.resume', { n: run.remaining });
  return (
    <Button
      label={label}
      variant="line"
      size="sm"
      busy={run.busy}
      class="cg-fnw__run"
      onClick={() => void dispatch({ type: 'SetNewcomersPassRunning', running: !run.pause })}
    />
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
  if (filterOn) return fanslyText(i18n, 'fansly.newcomers.empty.filter');
  if (vm.tab === 'todo') return fanslyText(i18n, 'fansly.newcomers.empty.todo');
  return fanslyText(i18n, 'fansly.newcomers.empty.filter');
}

// ── the card ──

function Bubble({ message }: { readonly message: NewcomerMessageVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <div class={`cg-feed__msg${message.fromFan ? '' : ' is-own'}${message.automated ? ' is-auto' : ''}`} data-cg-msg={message.id}>
      <span class="cg-sr">{fanslyText(i18n, message.fromFan ? 'fansly.newcomers.fanPrefix' : 'fansly.newcomers.ownPrefix')} </span>
      {message.automated ? <span class="cg-fnc__auto">{fanslyText(i18n, 'fansly.newcomers.automated')}</span> : null}
      {message.text}
      {message.attachments > 0 ? <span class="cg-feed__att">{fanslyText(i18n, 'fansly.newcomers.attachments', { n: message.attachments })}</span> : null}
      <small class="cg-num">{i18n.formatTime(message.at, 'datetime')}</small>
    </div>
  );
}

/** The conversation as the pass read it (NF-010): oldest first, «Более ранние сообщения», the cap of 750 said. */
function History({ card }: { readonly card: NewcomerCardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const history = card.history;
  const scroller = useRef<HTMLDivElement>(null);
  const before = useRef<{ readonly handle: string; readonly first: string | null; readonly height: number; readonly top: number } | null>(null);
  const first = history.messages[0]?.id ?? null;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node === null) return;
    const previous = before.current;
    if (previous === null || previous.handle !== card.handle) node.scrollTop = node.scrollHeight;
    // An older page arrived above: what the person was reading does not jump.
    else if (previous.first !== first) node.scrollTop = previous.top + (node.scrollHeight - previous.height);
    before.current = { handle: card.handle, first, height: node.scrollHeight, top: node.scrollTop };
  }, [card.handle, first, history.messages.length, history.s]);
  const state = (key: FanslyNewcomersTextKey, busy = false): JSX.Element => (
    <div class="cg-feed__empty" {...(busy ? { role: 'status' } : {})} data-cg-history={history.s}>
      {busy ? <Spinner /> : null}
      {fanslyText(i18n, key)}
    </div>
  );
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
            {card.check === 'failed' ? null : <Button label={fanslyText(i18n, 'fansly.newcomers.history.retry')} variant="line" onClick={() => void dispatch({ type: 'RefreshArchive', targetHandle: card.handle })} />}
          </ErrorCard>
        )}
      </div>
    );
  } else if (history.messages.length === 0) body = state('fansly.newcomers.history.empty');
  return (
    <div
      ref={scroller}
      class="cg-feed cg-fnc__feed"
      role="log"
      aria-label={fanslyText(i18n, 'fansly.newcomers.history.label')}
      tabIndex={0}
      onScroll={(event) => {
        const node = event.currentTarget;
        const state = before.current;
        if (state !== null) before.current = { ...state, top: node.scrollTop, height: node.scrollHeight };
      }}
    >
      {history.capped ? <div class="cg-feed__sys">{fanslyText(i18n, 'fansly.newcomers.history.capped', { n: history.cap })}</div> : null}
      {history.s === 'ready' && history.failure !== null && history.messages.length > 0 ? (
        <div class="cg-feed__older">
          <ErrorCard error={failureView(i18n, history.failure)} tone="failure" inline alert={false}>
            <Button label={fanslyText(i18n, 'fansly.newcomers.history.retry')} variant="line" onClick={() => void dispatch({ type: 'RefreshArchive', targetHandle: card.handle })} />
          </ErrorCard>
        </div>
      ) : history.loadingMore ? (
        <div class="cg-feed__older" role="status">
          <Spinner label={i18n.t('common.loading')} />
        </div>
      ) : history.more ? (
        <div class="cg-feed__older">
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
 * Why nobody can write to the fan, or why the check failed: words, no colour; the code's own line for a failure. A fan
 * nobody can write to leaves «К обработке» by the person's «Исключить из очереди» and comes back (R20 P10b2, FS-NEW-2).
 */
function Verdict({ card }: { readonly card: NewcomerCardVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const strong = card.check === 'ready' || card.check === 'reply';
  const hasPrice = card.dmClosed === 'paid' && card.dmPriceMills !== undefined && card.dmPriceMills !== null;
  return (
    <div class="cg-fnc__verdict" data-cg-check={card.check}>
      <span class={strong ? 'is-strong' : ''}>{checkText(i18n, card.check)}</span>
      {card.dmClosed === null || (card.check !== 'dm-closed' && card.check !== 'excluded') ? null : (
        <span class="cg-fnc__why">
          {hasPrice ? fanslyText(i18n, 'fansly.newcomers.dmClosed.paidPrice', { price: i18n.formatMoneyMills(card.dmPriceMills ?? null, { cents: true, zero: 'show' }) }) : fanslyText(i18n, `fansly.newcomers.dmClosed.${card.dmClosed}`)}
        </span>
      )}
      {card.check === 'failed' && card.failure !== null ? (
        <span class="cg-fnc__why">
          {fanslyText(i18n, 'fansly.newcomers.errorFrom', { code: card.failure.code })} · {failureView(i18n, card.failure).title}
        </span>
      ) : null}
      {card.checkNext === undefined || card.checkNext === null ? null : (
        <span class="cg-fnc__check">
          <Button
            label={fanslyText(i18n, card.checkNext === 'next' ? 'fansly.newcomers.checkNext' : 'fansly.newcomers.checkNow')}
            variant="line"
            size="sm"
            onClick={() => void dispatch({ type: 'CheckNewcomerNext', targetHandle: card.handle })}
          />
        </span>
      )}
      {card.exclude === undefined || card.exclude === null ? null : (
        <span class="cg-fnc__check">
          <Button
            label={fanslyText(i18n, card.exclude === 'exclude' ? 'fansly.newcomers.exclude' : 'fansly.newcomers.restore')}
            tooltip={card.exclude === 'exclude' ? fanslyText(i18n, 'fansly.newcomers.excludeTooltip') : null}
            variant="line"
            size="sm"
            onClick={() => void dispatch({ type: 'ExcludeNewcomer', targetHandle: card.handle, excluded: card.exclude === 'exclude' })}
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
      <a class="cg-btn cg-btn--line cg-fnc__open" href={href} target="_blank" rel="noopener noreferrer" {...tip.props}>
        <span class="cg-btn__t">{fanslyText(i18n, 'fansly.newcomers.open')}</span>
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
    case 'uncertain': {
      const error = failureView(i18n, state.failure);
      return (
        <div class="cg-fnc__gst" role="status" data-cg-code={state.failure.code}>
          <Dot kind={state.s === 'refused' ? 'danger' : 'ink'} />
          <b>{fanslyText(i18n, state.s === 'refused' ? 'fansly.newcomers.greeting.refused' : 'fansly.newcomers.greeting.uncertain')}</b>
          <span class="cg-fnc__gcode">
            <b>ChatGoose · {state.failure.code}:</b> {error.title}
          </span>
        </div>
      );
    }
  }
}

/** The greeting of the card (R20 P10c): the field, its marks, the three buttons, where the click stands, the hint (NF-028). */
function Greeting({ handle, greeting }: { readonly handle: string; readonly greeting: NewcomerGreetingVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const draft = useOwnEchoes(greeting.text, handle);
  const running = greeting.state.s === 'generating' || greeting.state.s === 'sending';
  const words = (reason: StaleReason, part: 'title' | 'body'): string => i18n.t(`result.stale${MARK_WORDS[reason]}.${part}` as I18nKey);
  // Why a button is off, in the tooltip it always shows (ui-design §4): what runs, what the pass has not proven, how the click ended, an empty field.
  const why = (): string => {
    const s = greeting.state.s;
    if (s === 'generating' || s === 'sending') return fanslyText(i18n, s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating');
    if (greeting.waiting) return fanslyText(i18n, 'fansly.newcomers.greeting.waiting');
    if (s === 'sent' || s === 'uncertain') return fanslyText(i18n, s === 'sent' ? 'fansly.newcomers.greeting.sent' : 'fansly.newcomers.greeting.uncertain', { time: '' }).trim();
    return fanslyText(i18n, 'fansly.newcomers.greeting.placeholder');
  };
  const sendReason = greeting.canSend || greeting.state.s === 'sending' ? null : greeting.sendBlocked !== null ? failureView(i18n, greeting.sendBlocked).title : why();
  return (
    <div class="cg-fnc__greet" data-cg-greeting={greeting.state.s}>
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
      <div class="cg-fnc__field">
        <TextField
          value={draft.shown}
          label={fanslyText(i18n, 'fansly.newcomers.greeting.label')}
          placeholder={fanslyText(i18n, 'fansly.newcomers.greeting.placeholder')}
          multiline
          minHeight={56}
          maxHeight={140}
          maxLength={greeting.maxChars}
          reason={running ? fanslyText(i18n, greeting.state.s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating') : null}
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
      {greeting.waiting ? <div class="cg-fnc__gnote">{fanslyText(i18n, 'fansly.newcomers.greeting.waiting')}</div> : null}
      <div class="cg-fnc__gbar">
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.generate')}
          variant="line"
          size="sm"
          busy={greeting.state.s === 'generating'}
          reason={greeting.canGenerate || greeting.state.s === 'generating' ? null : why()}
          onClick={() => void dispatch({ type: 'Generate', targetHandle: handle, feature: 'hi', options: {} })}
        />
        <span class="cg-fnc__count">{fanslyText(i18n, 'fansly.newcomers.greeting.count', { n: draft.shown.length, max: greeting.maxChars })}</span>
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.insert')}
          variant="quiet"
          size="sm"
          tooltip={fanslyText(i18n, 'fansly.newcomers.greeting.insertTooltip')}
          reason={greeting.canInsert ? null : why()}
          onClick={() => void dispatch({ type: 'InsertNewcomerGreeting', targetHandle: handle })}
        />
        <Button
          label={fanslyText(i18n, 'fansly.newcomers.greeting.send')}
          variant="send"
          size="sm"
          busy={greeting.state.s === 'sending'}
          reason={sendReason}
          onClick={() => void dispatch({ type: 'SendNewcomerGreeting', targetHandle: handle })}
        />
      </div>
      <GreetingState greeting={greeting} />
      <div class="cg-fnc__noauto">{fanslyText(i18n, 'fansly.newcomers.noAutoSend')}</div>
    </div>
  );
}

function Card({ card }: { readonly card: NewcomerCardVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <section class="cg-pv cg-fnc" aria-label={fanslyText(i18n, 'fansly.newcomers.cardLabel')} data-cg-card={card.handle}>
      <header class="cg-fnc__head">
        <InitialAvatar name={card.name} large />
        <div class="cg-fnc__who">
          <h3 class="cg-fnc__name">
            {card.name}
            {card.customName === null ? null : <span class="cg-fnw__custom"> ({card.customName})</span>}
            {card.username === null ? null : <span class="cg-fnc__user">@{card.username}</span>}
          </h3>
          <div class="cg-fnc__meta" title={fanslyText(i18n, 'fansly.newcomers.followedAt', { date: i18n.formatTime(card.followedAt, 'datetime') })}>
            {fanslyText(i18n, 'fansly.newcomers.followedAgo', { age: i18n.formatAge(card.followedAt) })}
            {card.checkedAt === null ? null : ` · ${fanslyText(i18n, 'fansly.newcomers.checkedAt', { time: i18n.formatTime(card.checkedAt, 'time') })}`}
          </div>
        </div>
        {card.openHref === null ? null : <OpenLink href={card.openHref} />}
      </header>
      <Verdict card={card} />
      {card.bio === null || card.bio.trim() === '' ? null : <div class="cg-fnc__bio">{card.bio}</div>}
      {card.proof === null ? null : (
        <details class="cg-fnc__proof">
          <summary>{fanslyText(i18n, 'fansly.newcomers.proof', { date: i18n.formatTime(card.proof.at, 'datetime') })}</summary>
          <div class="cg-fnc__proofNote">{fanslyText(i18n, 'fansly.newcomers.proofNote')}</div>
          <blockquote>{card.proof.text}</blockquote>
        </details>
      )}
      <History card={card} />
      {card.greeting === undefined || card.greeting === null ? null : <Greeting handle={card.handle} greeting={card.greeting} />}
    </section>
  );
}

// ── the window ──

export function FanslyNewcomersWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const { root } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  const pass = vm.pass ?? null;
  useMinuteClock(vm.rows.length > 0);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askedMore = useRef(-1);
  const passId = pass?.passId ?? null;
  const filter = pass?.filters.find((item) => item.pressed)?.id ?? 'any';
  useLayoutEffect(() => {
    askedMore.current = -1;
  }, [passId, vm.tab, vm.query, filter]);
  const rows = vm.rows;
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
  const focusCurrent = useCallback((): void => {
    if (currentHandle !== null) focusRow(current, currentHandle);
  }, [current, currentHandle, focusRow]);

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
    if (hasRows && (firstTime || focused === openedOn.current || focused === null || focused === box)) focusCurrent();
    if (firstTime) openedOn.current = root.activeElement;
  }, [hasRows]);

  // Pages of 100 (NF-006): the next one as the person scrolls near the end.
  const onRange = useCallback(
    (_start: number, end: number): void => {
      settle();
      if (vm.canLoadMore && end >= rows.length - LOAD_MORE_MARGIN && askedMore.current !== rows.length) {
        askedMore.current = rows.length;
        void dispatch({ type: 'LoadMore', list: 'newcomers' });
      }
    },
    [passId, vm.canLoadMore, rows.length, dispatch, settle],
  );

  // The card follows the keyboard's row once the keys stop (X55): a held J asks the pass for no card per row.
  const cardFollow = useCardFollow((handle) => void dispatch({ type: 'OpenPreview', targetHandle: handle }));
  const move = (from: number, to: number): void => {
    const row = rows[to];
    if (row === undefined || to === from) return;
    setActiveHandle(row.handle);
    focusRow(to, row.handle);
    cardFollow.follow(row.handle);
  };

  const onListKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || !isPlainKey(event)) return;
    // The keys act on the row that HAS focus, found by its fan in the list as it is now.
    const handle = rowKeyOf(event.target);
    if (handle === null) return;
    const at = rows.findIndex((entry) => entry.handle === handle);
    const row = rows[at];
    if (row === undefined) return;
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
      cardFollow.stop();
      const shown = pass?.card ?? null;
      if (shown === null || shown.handle !== row.handle) {
        void dispatch({ type: 'OpenPreview', targetHandle: row.handle });
        return;
      }
      const start = greetingStart(shown);
      if (start !== null) void dispatch(start);
      // The draft is there (or Generate is off): the field takes the focus — what goes to the fan is read there, and
      // «Отправить →» is a click.
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

  const failed = pass?.stage === 'failed';
  const filterOn = pass?.filters.some((filter) => filter.pressed && filter.id !== 'any') ?? false;
  const showList = hasRows && !failed && vm.view.s !== 'error' && vm.view.s !== 'forbidden' && vm.view.s !== 'empty';
  const forbidden = vm.view.s === 'forbidden' || (pass === null && vm.view.s !== 'loading');
  const range = rangeText(i18n, pass);
  const footer = [fanslyText(i18n, 'fansly.newcomers.footer', { n: vm.footer.count, window: periodText(i18n, vm.windowHours) }), range].filter((part) => part !== null).join(' · ');
  const card = pass?.card ?? null;
  // The card's column: once there is something to show in it (not while the first page is on its way).
  const cardColumn = !forbidden && !failed && (card !== null || vm.view.s !== 'loading');

  return (
    <OverlayLayer>
      <Dialog open label={i18n.t('newcomers.title')} size="window" scrim={false} class="cg-sp cg-ncw cg-fnw" onClose={close} initialFocus={() => frameRef.current?.querySelector<HTMLElement>('[data-cg-item][tabindex="0"]') ?? null}>
        <div ref={frameRef} class="cg-sp__frame" onKeyDown={onKeyDown}>
          <WindowHeader title={i18n.t('newcomers.title')} pageName={vm.pageName} onClose={() => void dispatch(CLOSE_WINDOW)}>
            <Tabs<NewcomersTab>
              label={fanslyText(i18n, 'fansly.newcomers.listLabel')}
              tabs={vm.tabs.map((tab) => {
                const label = fanslyText(i18n, tab.id === 'todo' ? 'fansly.newcomers.tab.todo' : 'fansly.newcomers.tab.all');
                return { value: tab.id, label: tab.count === null ? label : `${label} ${tab.count}` };
              })}
              value={vm.tab}
              onChange={(tab) => void dispatch({ type: 'SetNewcomersTab', tab })}
            />
            {pass === null || failed ? null : <Stage pass={pass} />}
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
          <div class={`cg-nc__cols${cardColumn ? ' is-card' : ''}`}>
            <section class="cg-nc" aria-label={fanslyText(i18n, 'fansly.newcomers.listLabel')} data-cg-newcomers={vm.view.s} data-cg-pass={pass?.stage ?? 'none'}>
              {pass === null || forbidden || failed ? null : (
                <div class="cg-sp__tools" role="group" aria-label={fanslyText(i18n, 'fansly.newcomers.filter.label')}>
                  <StatusMenu pass={pass} />
                  {pass.run !== undefined && (pass.run.pause || pass.run.resume) ? <RunButton run={pass.run} /> : null}
                  <span class="cg-sp__grow" />
                  <PeriodMenu vm={vm} range={range} />
                </div>
              )}
              {pass === null || forbidden || failed || vm.batch === undefined ? null : <BatchBar list="newcomers" batch={vm.batch} />}
              {pass === null || forbidden ? null : <PassLines vm={vm} pass={pass} />}
              {/* The port to the background is down: what is shown stays, the banner says so (its return reads it again). */}
              {vm.view.s === 'offline' && !failed && hasRows ? <ViewState view={vm.view} /> : null}
              {failed ? (
                <ListFailed failure={pass?.failure ?? null} />
              ) : showList ? (
                <div class="cg-nc__list" ref={wrapRef} style={{ height: `${HEADER_HEIGHT + rows.length * ROW_HEIGHT}px` }}>
                  <VirtualList
                    items={rows}
                    rowHeight={ROW_HEIGHT}
                    getKey={(row) => row.handle}
                    role="table"
                    label={fanslyText(i18n, 'fansly.newcomers.listLabel')}
                    header={<ColumnHeader vm={vm} />}
                    headerHeight={HEADER_HEIGHT}
                    listRef={listRef}
                    onRangeChange={onRange}
                    onKeyDown={onListKeyDown}
                    renderRow={(row, index) => <Row row={row} index={index} active={index === current} onPick={setActiveHandle} />}
                  />
                </div>
              ) : vm.view.s === 'empty' ? (
                <div class="cg-nc__state cg-fnw__empty" data-cg-empty="1">
                  {emptyText(i18n, vm, filterOn)}
                </div>
              ) : (
                <div class="cg-nc__state">
                  <ViewState view={vm.view} />
                </div>
              )}
              {forbidden || failed || vm.view.s === 'loading' ? null : <DataFooter left={footer} stamp={{ asOf: null, coverage: vm.footer.stamp.coverage }} />}
            </section>
            {!cardColumn ? null : card === null ? (
              <section class="cg-pv cg-fnc cg-fnc--none" aria-label={fanslyText(i18n, 'fansly.newcomers.cardLabel')}>
                <div class="cg-feed__empty">{fanslyText(i18n, 'fansly.newcomers.empty.card')}</div>
              </section>
            ) : (
              <Card key={card.handle} card={card} />
            )}
          </div>
        </div>
      </Dialog>
    </OverlayLayer>
  );
}
