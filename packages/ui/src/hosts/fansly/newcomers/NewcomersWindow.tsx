// «Новые фоловеры» on Fansly (R20 P10a–P10c; X59, X60; ui-design §3.12; FS-NEW-1; NF-001…NF-028, NF-038, FX-017): the
// window of the old Fansly extension, kept as the owner liked it, in the family's «Новые» frame every site shares
// (ui/newcomers frame.tsx): the list of new followers on the left (the picture, the name, «@handle · 2 ч назад», the
// status in words) and the selected fan on the right — Fansly's own card: the profile, «Открыть в Fansly ↗», the
// conversation the pass read, the draft and «Отправить →» — over the shared `NewcomersVM` with its `pass`. What the old
// one lacked is here too: a batch — tick fans (or «Выбрать N»), «Сгенерировать N», read each draft right in the list
// under its fan and send it by the row's own small «Отправить» (X59: the card's send, one click per fan); after a card's
// own «Отправить →» the card moves on to the next draft of the batch.
//
// What is Fansly's here: the pass (its stage, «Пауза», the dates, the pause Fansly asked for, why it stopped), each
// fan's verdict, the row's «Отправить», the card. The frame, the rows and the keys are the shared ones.
//
// Keys (X55): J / K and ↑ ↓ move along the rows, the card follows once the keys stop; Enter is the row's greeting
// («Сгенерировать» while the field is empty, the field otherwise); Space opens the card; X ticks the row for the batch;
// `/` is the search; Esc clears the search, then closes. «Отправить» is a click only, never a key.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useLayoutEffect, useRef } from 'preact/hooks';

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
  type NewcomerCheck,
  type NewcomerGreetingVM,
  type NewcomerMessageVM,
  type NewcomerRowVM,
  type NewcomersFailureVM,
  type NewcomersPassRunVM,
  type NewcomersPassVM,
  type NewcomersVM,
  type UiAction,
} from '@cg/contracts/vm';

import {
  Button,
  Dot,
  ErrorCard,
  Icon,
  SearchBox,
  Spinner,
  TextField,
  VirtualList,
  ViewState,
  focusQuietly,
  isComposing,
  pure,
  useCountdown,
  useDispatch,
  useHints,
  useI18n,
  useKit,
  useMinuteClock,
  useNowFn,
  useTooltip,
  useView,
} from '../../../kit';
import {
  BatchFoot,
  CLOSE_NEWCOMERS,
  ListTabs,
  NewcomerAvatar,
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
} from '../../../newcomers/frame';
import { useOwnEchoes } from '../../../spenders/ownEchoes';
import { rowKeyOf, useCardFollow } from '../../../spenders/rowFocus';
import { isPlainKey, isTextEntry } from '../../../spenders/window';

const RELOAD: UiAction = { type: 'ReloadView', selector: { of: 'newcomers' } };

// ── words ──

/** A text of Fansly's own pack (`fansly.newcomers.*`), through the I18n the surface laid it over. */
export function fanslyText(i18n: I18n, key: FanslyNewcomersTextKey, params?: I18nParams): string {
  return i18n.t(key as unknown as I18nKey, params);
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

// ── a row: Fansly's status line and its «Отправить» in the shared row ──

/** The status line: how the fan's greeting goes when it goes, else the pass's verdict in words — strong where the person can act. */
function RowStatus({ row }: { readonly row: NewcomerRowVM }): JSX.Element {
  const i18n = useI18n();
  const check = row.check?.status ?? 'pending';
  const batch = row.batch?.state ?? null;
  const greeting = row.greeting.s;
  if (greeting === 'sending') return <span class="cg-nw__st is-busy"><Spinner />{fanslyText(i18n, 'fansly.newcomers.row.sending')}</span>;
  if (batch === 'sent' || (greeting === 'greeted' && check !== 'greeted')) return <span class="cg-nw__st is-done"><Icon name="check" size={13} />{fanslyText(i18n, 'fansly.newcomers.row.sent')}</span>;
  if (greeting === 'stopped') return <span class="cg-nw__st is-2"><Dot kind="ink" />{fanslyText(i18n, 'fansly.newcomers.greeting.uncertain')}</span>;
  const refused = row.send?.refused ?? null;
  if (refused !== null) return <span class="cg-nw__st is-2" data-cg-code={refused.code}><Dot kind="danger" />{fanslyText(i18n, 'fansly.newcomers.row.failed', { reason: failureTitle(i18n, refused.code) })}</span>;
  if (batch === 'generating') return <span class="cg-nw__st is-busy"><Spinner />{fanslyText(i18n, 'fansly.newcomers.row.generating')}</span>;
  if (batch === 'queued') return <span class="cg-nw__st">{fanslyText(i18n, 'fansly.newcomers.row.queued')}</span>;
  if (batch === 'failed') {
    const code = row.batch?.failure?.code ?? 'CG-UNKNOWN';
    return <span class="cg-nw__st is-2" data-cg-code={code}><Dot kind="ink" />{fanslyText(i18n, 'fansly.newcomers.row.failed', { reason: failureTitle(i18n, code) })}</span>;
  }
  if (check === 'checking') return <span class="cg-nw__st"><Spinner />{checkText(i18n, check)}</span>;
  if (check === 'greeted') return <span class="cg-nw__st"><Icon name="check" size={13} />{checkText(i18n, check)}</span>;
  if (check === 'failed') return <span class="cg-nw__st is-2"><Dot kind="ink" />{checkText(i18n, check)}</span>;
  const tone = check === 'ready' || check === 'reply' ? ' is-act' : check === 'dm-closed' || check === 'excluded' ? ' is-2' : '';
  return <span class={`cg-nw__st${tone}`}>{checkText(i18n, check)}</span>;
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
      class="cg-nw__end cg-fnw__rsend"
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

/** What the rows of Fansly's list say: «@handle · 2 ч назад», the pass's verdict, the row's own «Отправить». */
const ROW_PARTS: RowParts = {
  Status: RowStatus,
  meta: (i18n: I18n, row: NewcomerRowVM) => `${row.username === null ? '' : `@${row.username} · `}${fanslyText(i18n, 'fansly.newcomers.ago', { age: i18n.formatAge(row.subscribedAt) })}`,
  End: RowSend,
};

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
    <span class="cg-nw__stage cg-num" role="status" data-cg-stage={pass.stage}>
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
    <div class="cg-nw__line cg-fnw__cool" role="status">
      {fanslyText(i18n, 'fansly.newcomers.stage.cooldown', { s: Math.ceil(left / 1000) })}
    </div>
  );
}

/** Under the toolbar: the dates, and only when there is something to say — the pause Fansly asked for, «Результат неполный», why the pass stopped. */
function PassLines({ vm, pass, range }: { readonly vm: NewcomersVM; readonly pass: NewcomersPassVM; readonly range: string | null }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      {range === null ? null : <div class="cg-nw__line cg-fnw__range">{range}</div>}
      {pass.stage === 'cooldown' && pass.cooldownUntil !== null ? <Cooldown until={pass.cooldownUntil} /> : null}
      {vm.incomplete === null ? null : (
        <div class="cg-nw__line cg-nw__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b>{' '}
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

/** The pass's status filter (NF-004): the shared menu with Fansly's words for the verdicts. */
function PassStatusMenu({ pass }: { readonly pass: NewcomersPassVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const on = pass.filters.find((filter) => filter.pressed) ?? pass.filters[0];
  if (on === undefined) return null;
  const label = (id: (typeof pass.filters)[number]['id']): string => fanslyText(i18n, `fansly.newcomers.filter.${id}`);
  return (
    <StatusMenu
      label={on.count === null ? label(on.id) : `${label(on.id)} ${on.count}`}
      menuLabel={fanslyText(i18n, 'fansly.newcomers.filter.label')}
      pressed={on.id !== 'any'}
      items={pass.filters.map((filter) => ({ id: filter.id, label: label(filter.id), count: filter.count, checked: filter.pressed }))}
      onSelect={(id) => {
        const filter = pass.filters.find((item) => item.id === id);
        if (filter !== undefined && !filter.pressed) void dispatch({ type: 'SetNewcomersCheckFilter', filter: filter.id });
      }}
    />
  );
}

/** The batch's foot in Fansly's words: «Выбрано N · Сгенерировать N», «Готово N · отправлено M», read and send each in its row. */
function batchWords(i18n: I18n): BatchWords {
  return {
    picked: (n) => fanslyText(i18n, 'fansly.newcomers.batch.picked', { n }),
    generate: (n) => fanslyText(i18n, 'fansly.newcomers.batch.generate', { n }),
    generating: (done, total) => fanslyText(i18n, 'fansly.newcomers.batch.generating', { done, total }),
    done: (ready, sent, failed) =>
      [
        fanslyText(i18n, 'fansly.newcomers.batch.ready', { n: ready }),
        sent === 0 ? null : fanslyText(i18n, 'fansly.newcomers.batch.sent', { n: sent }),
        failed === 0 ? null : fanslyText(i18n, 'fansly.newcomers.batch.failed', { n: failed }),
      ]
        .filter((part) => part !== null)
        .join(' · '),
    review: fanslyText(i18n, 'fansly.newcomers.batch.review'),
  };
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
        <span class="cg-nw__grow" />
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
        <NewcomerAvatar name={card.name} url={card.avatarUrl} size="card" />
        <div class="cg-fnc__who">
          <h3 class="cg-fnc__name">
            {card.name}
            {card.customName === null ? null : <span class="cg-nw__custom"> ({card.customName})</span>}
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
  const { root } = useKit();
  const vm = useView({ of: 'newcomers' }).value;
  const pass = vm.pass ?? null;
  const rows = vm.rows;
  useMinuteClock(rows.length > 0);
  const minute = Math.floor(useNowFn()() / 60_000);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // The keyboard's row: the one the person is on, else the selected one.
  const { current, currentHandle, setActiveHandle, wrapRef, listRef, focusRow, settle } = useNewcomerRows(rows, () => rows[0] ?? null);
  const filter = pass?.filters.find((item) => item.pressed)?.id ?? 'any';
  // Pages of 100 (NF-006): asked once per length of the list, again for another pass, tab, query or filter.
  const onRange = useLoadMore(vm, settle, `${pass?.passId ?? ''} ${vm.tab} ${vm.query} ${filter}`);
  const rowHeight = useRowHeight();

  const latestRows = useRef(rows);
  latestRows.current = rows;

  // Esc in turn: the search, then the window.
  const close = useCallback((): void => {
    if (vm.query !== '') void dispatch({ type: 'Search', list: 'newcomers', query: '' });
    else void dispatch(CLOSE_NEWCOMERS);
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

  // The card follows the keyboard's row once the keys stop (X55): a held J asks the pass for no card per row.
  const cardFollow = useCardFollow((handle) => void dispatch({ type: 'OpenPreview', targetHandle: handle }));

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
    [dispatch, focusRow, setActiveHandle],
  );

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

  const failed = pass?.stage === 'failed';
  const forbidden = vm.view.s === 'forbidden' || (pass === null && vm.view.s !== 'loading');
  const showList = hasRows && !failed && vm.view.s !== 'error' && vm.view.s !== 'forbidden' && vm.view.s !== 'empty';
  const range = rangeText(i18n, pass);
  const card = pass?.card ?? null;
  const title = fanslyText(i18n, 'fansly.newcomers.title');

  let list: JSX.Element;
  if (showList) {
    list = (
      <div class="cg-nw__list" ref={wrapRef}>
        <VirtualList
          items={rows}
          rowHeight={rowHeight}
          getKey={(row) => row.handle}
          role="listbox"
          label={fanslyText(i18n, 'fansly.newcomers.listLabel')}
          listRef={listRef}
          onRangeChange={onRange}
          onKeyDown={onListKeyDown}
          renderRow={(row, index) => <NewcomerRow row={row} index={index} count={rows.length} active={index === current} minute={minute} parts={ROW_PARTS} onPick={setActiveHandle} />}
        />
      </div>
    );
  } else if (vm.view.s === 'empty') {
    list = (
      <div class="cg-nw__state" data-cg-empty="1">
        {emptyText(i18n, vm, filter !== 'any')}
      </div>
    );
  } else {
    list = (
      <div class="cg-nw__state">
        <ViewState view={vm.view} />
      </div>
    );
  }

  // Fansly's account may carry its id alone: the bound page names it then.
  const sub = (
    <>
      {pass?.creator === null || pass?.creator === undefined ? null : <span class="cg-nw__creator">@{pass.creator}</span>}
      {vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>}
    </>
  );

  return (
    <NewcomersFrame title={title} sub={sub} class="cg-fnw" onEsc={close} frameRef={frameRef} onKeyDown={onKeyDown}>
      {forbidden ? null : (
        <div class="cg-nw__bar" data-cg-pass={pass?.stage ?? 'none'}>
          <PeriodMenu vm={vm} lead={fanslyText(i18n, 'fansly.newcomers.period')} menuLabel={fanslyText(i18n, 'fansly.newcomers.window')} tooltip={range ?? fanslyText(i18n, 'fansly.newcomers.window')} />
          {pass === null ? null : <Stage pass={pass} />}
          {pass?.run === undefined || failed ? null : <RunButton run={pass.run} />}
          <span class="cg-nw__grow" />
          <SearchBox
            value={vm.query}
            label={i18n.t('spenders.search.placeholder')}
            placeholder={i18n.t('spenders.search.placeholder')}
            class="cg-nw__search"
            inputRef={searchRef}
            onQuery={(query) => void dispatch({ type: 'Search', list: 'newcomers', query })}
          />
          <Button label={fanslyText(i18n, 'fansly.newcomers.refresh')} icon="refresh" iconOnly variant="quiet" class="cg-fnw__refresh" busy={pass?.stage === 'connecting'} onClick={() => void dispatch(RELOAD)} />
        </div>
      )}
      {pass === null || forbidden || failed ? null : <PassLines vm={vm} pass={pass} range={range} />}
      {/* The port to the background is down: what is shown stays, the banner says so (its return reads it again). */}
      {vm.view.s === 'offline' && !failed && hasRows ? <ViewState view={vm.view} /> : null}
      {failed ? (
        <ListFailed failure={pass?.failure ?? null} />
      ) : forbidden ? (
        <div class="cg-nw__state">
          <ViewState view={vm.view} />
        </div>
      ) : (
        <div class="cg-nw__main">
          <aside class="cg-nw__side" aria-label={fanslyText(i18n, 'fansly.newcomers.listLabel')} data-cg-newcomers={vm.view.s}>
            <ListTabs
              tabs={vm.tabs.map((tab) => ({ id: tab.id, label: fanslyText(i18n, tab.id === 'todo' ? 'fansly.newcomers.tab.todo' : 'fansly.newcomers.tab.all'), count: tab.count }))}
              value={vm.tab}
              label={fanslyText(i18n, 'fansly.newcomers.listLabel')}
            />
            {pass === null ? null : (
              <div class="cg-nw__tools" role="group" aria-label={fanslyText(i18n, 'fansly.newcomers.filter.label')}>
                <PassStatusMenu pass={pass} />
                <span class="cg-nw__grow" />
                <PickAll rows={rows} batch={vm.batch} label={(n) => fanslyText(i18n, 'fansly.newcomers.pickAll', { n })} tooltip={(max) => fanslyText(i18n, 'fansly.newcomers.pickTooltip', { max })} />
              </div>
            )}
            {list}
            <BatchFoot batch={vm.batch} words={batchWords(i18n)} />
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
    </NewcomersFrame>
  );
}
