// «Новые фоловеры» on Fansly (R20 P10a–P10c; X59, X60; ui-design §3.12; FS-NEW-1; NF-001…NF-028, NF-038, FX-017): the
// family's «Новые» window and card (ui/newcomers window.tsx, card.tsx — the same as on ChatSpace) with Fansly's adapter,
// over the shared `NewcomersVM` with its `pass`: Fansly's words, the pass (its stage, «Пауза», the dates, the pause
// Fansly asked for, why it stopped), each fan's verdict and the row's own «Отправить» of a batch's draft (X59: the
// card's send by one click in the list), and the card from what the pass read — the profile, «Открыть в Fansly ↗», the
// conversation, the verdict, the draft. The window, the rows, the card's look and the keys are the shared ones.

import { type JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { isCgAnyCode, type CgAnyCode } from '@cg/contracts/errors-fansly';
import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { isCgCode, type CgCode, type CgErrorView, type I18nKey } from '@cg/contracts/errors';
import { cgBodyKey, cgTitleKey } from '@cg/contracts/i18n/keys';
import { type FanslyNewcomersTextKey } from '@cg/contracts/newcomers-fansly';
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

import { Button, Dot, ErrorCard, Icon, Spinner, pure, useCountdown, useDispatch, useI18n, useNowFn } from '../../../kit';
import { CardOpen, GreetingEditor, GreetingState, NewcomerCard, NoCard, type GreetingModel } from '../../../newcomers/card';
import { RowSendButton, StatusMenu, periodText, type BatchWords, type RowParts } from '../../../newcomers/frame';
import { NewcomersWindowOf, RefreshButton, nextDraft, type NewcomersSite } from '../../../newcomers/window';

export { nextDraft };

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

/** The row's own «Отправить» of its batch draft (X59), in Fansly's words. */
function RowSend({ row }: { readonly row: NewcomerRowVM }): JSX.Element | null {
  const i18n = useI18n();
  return <RowSendButton row={row} label={fanslyText(i18n, 'fansly.newcomers.row.send')} tooltip={fanslyText(i18n, 'fansly.newcomers.row.sendTooltip')} blocked={fanslyText(i18n, 'fansly.newcomers.row.sendBlocked')} />;
}

/** What the rows of Fansly's list say: «@handle · 2 ч назад», the pass's verdict, the row's own «Отправить». */
const ROW_PARTS: RowParts = {
  Status: RowStatus,
  meta: (i18n: I18n, row: NewcomerRowVM) => `${row.username === null ? '' : `@${row.username} · `}${fanslyText(i18n, 'fansly.newcomers.ago', { age: i18n.formatAge(row.subscribedAt) })}`,
  End: RowSend,
};

// ── the toolbar and the lines under it ──

/** «Проверено 12 из 40», the phase of the fast part, the queue (NF-008); a spinner while the pass reads. */
function PassStage({ pass }: { readonly pass: NewcomersPassVM }): JSX.Element | null {
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

function Stage({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const pass = vm.pass ?? null;
  if (pass === null) return null;
  return (
    <>
      <PassStage pass={pass} />
      {pass.run === undefined || pass.stage === 'failed' ? null : <RunButton run={pass.run} />}
    </>
  );
}

/**
 * Why ↻ waits (the old window's `refresh.disabled` while it scanned): a running or paused pass is the same pass when
 * asked again, so ↻ would do nothing — «Пауза» / «Проверить оставшихся» are its buttons then. Null — ↻ checks anew.
 */
function refreshWait(i18n: I18n, pass: NewcomersPassVM | null): string | null {
  switch (pass?.stage) {
    case 'scanning':
    case 'queue':
    case 'cooldown':
      return fanslyText(i18n, 'fansly.newcomers.refreshRunning');
    case 'paused':
      return fanslyText(i18n, 'fansly.newcomers.refreshPaused');
    case 'connecting':
    case 'done':
    case 'stopped':
    case 'failed':
    case undefined:
      return null;
  }
}

function Refresh({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const pass = vm.pass ?? null;
  return <RefreshButton label={fanslyText(i18n, 'fansly.newcomers.refresh')} class="cg-nw__refresh cg-fnw__refresh" busy={pass?.stage === 'connecting'} wait={refreshWait(i18n, pass)} />;
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
function Lines({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const pass = vm.pass ?? null;
  if (pass === null) return null;
  const range = rangeText(i18n, pass);
  return (
    <>
      {range === null ? null : <div class="cg-nw__line cg-fnw__range">{range}</div>}
      {pass.stage === 'cooldown' && pass.cooldownUntil !== null ? <Cooldown until={pass.cooldownUntil} /> : null}
      {vm.incomplete === null ? null : (
        <div class="cg-nw__line cg-nw__incomplete" role="status">
          <b>{i18n.t('newcomers.incomplete')}</b> <span>{fanslyText(i18n, 'fansly.newcomers.incomplete')}</span>
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
function Failed({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  return (
    <div class="cg-fnw__failed" data-cg-list="failed">
      <ErrorCard error={failureView(i18n, vm.pass?.failure ?? { code: 'CG-DATA-UNAVAILABLE', retryAt: null })} tone="failure">
        <Button label={i18n.t('common.retry')} variant="line" onClick={() => void dispatch(RELOAD)} />
      </ErrorCard>
      <p class="cg-fnw__hint2">{fanslyText(i18n, 'fansly.newcomers.listFailedHint')}</p>
    </div>
  );
}

/** What the list says when it has no row to show: an empty period, a filter or a search with no match, an empty queue. */
function Empty({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const filterOn = (vm.pass?.filters.find((filter) => filter.pressed)?.id ?? 'any') !== 'any';
  if ((vm.pass?.total ?? 0) === 0) return <>{fanslyText(i18n, 'fansly.newcomers.empty.window', { window: periodText(i18n, vm.windowHours) })}</>;
  if (vm.query.trim() !== '') return <>{fanslyText(i18n, 'fansly.newcomers.empty.search')}</>;
  if (filterOn || vm.tab !== 'todo') return <>{fanslyText(i18n, 'fansly.newcomers.empty.filter')}</>;
  return <>{fanslyText(i18n, 'fansly.newcomers.empty.todo')}</>;
}

/** The pass's status filter (NF-004): the shared menu with Fansly's words for the verdicts. */
function Filter({ vm }: { readonly vm: NewcomersVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const pass = vm.pass ?? null;
  const on = pass?.filters.find((filter) => filter.pressed) ?? pass?.filters[0];
  if (pass === null || on === undefined) return null;
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

// ── the card: what the pass read, in the family's card ──

/** One message in the preview's bubbles; the pass's messages keep their identity between models, so a bubble is drawn once. */
const Bubble = pure(
  function BubbleView({ message, day }: { readonly message: NewcomerMessageVM; readonly day: string | null }): JSX.Element {
    const i18n = useI18n();
    return (
      <>
        {day === null ? null : <div class="cg-feed__day">{day}</div>}
        <div class={`cg-feed__msg${message.fromFan ? '' : ' is-own'}`} data-cg-msg={message.id}>
          <span class="cg-sr">{fanslyText(i18n, message.fromFan ? 'fansly.newcomers.fanPrefix' : 'fansly.newcomers.ownPrefix')} </span>
          {message.text}
          {message.attachments > 0 ? <span class="cg-feed__att">{fanslyText(i18n, 'fansly.newcomers.attachments', { n: message.attachments })}</span> : null}
          <small class="cg-num">
            {i18n.formatTime(message.at, 'time')}
            {message.automated ? ` · ${fanslyText(i18n, 'fansly.newcomers.automated')}` : ''}
          </small>
        </div>
      </>
    );
  },
  (a, b) => a.message === b.message && a.day === b.day,
);

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
    <div class="cg-feed__state" {...(busy ? { role: 'status' } : {})} data-cg-history={history.s}>
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
      <div class="cg-feed__fail" data-cg-history="failed">
        <p>{fanslyText(i18n, 'fansly.newcomers.history.failed')}</p>
        {history.failure === null ? null : (
          <ErrorCard error={failureView(i18n, history.failure)} tone="failure" inline alert={false}>
            {card.check === 'failed' ? null : retry}
          </ErrorCard>
        )}
      </div>
    );
  } else if (history.messages.length === 0) {
    // An empty chat of a fan the check found «Не писали» / «Ждёт ответа» is the finding itself, as the old window said it.
    body = state(card.check === 'ready' || card.check === 'reply' ? 'fansly.newcomers.history.none' : 'fansly.newcomers.history.empty');
  }
  let lastDay: string | null = null;
  return (
    <div
      ref={scroller}
      class="cg-feed"
      role="log"
      aria-label={fanslyText(i18n, 'fansly.newcomers.history.label')}
      tabIndex={0}
      onScroll={(event) => {
        const node = event.currentTarget;
        if (before.current !== null) before.current = { ...before.current, top: node.scrollTop, height: node.scrollHeight };
      }}
    >
      {history.capped ? <div class="cg-feed__sys">{fanslyText(i18n, 'fansly.newcomers.history.capped', { n: history.cap })}</div> : null}
      {history.s === 'ready' && history.failure !== null && history.messages.length > 0 ? (
        <div class="cg-feed__older">
          <ErrorCard error={failureView(i18n, history.failure)} tone="failure" inline alert={false}>
            {retry}
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
      {history.messages.map((message) => {
        // A day separator («22 окт») before the first message of each day, as the preview's feed has it.
        const day = i18n.formatTime(message.at, 'day');
        const shown = day === lastDay ? null : day;
        lastDay = day;
        return <Bubble key={message.id} message={message} day={shown} />;
      })}
      {body}
    </div>
  );
}

/**
 * What the pass has to say about the fan when it is not «Не писали» or «Ждёт ответа»: «Уже писали», why nobody can write to them and
 * «Исключить из очереди» (FS-NEW-2), why the check failed, that the chat is not checked yet and «Проверить чат» (NF-038). A check
 * under way says it once, in the conversation («Проверяем переписку…»), as the old window did: no verdict line of its own.
 */
function Verdict({ card }: { readonly card: NewcomerCardVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const hasPrice = card.dmClosed === 'paid' && card.dmPriceMills !== undefined && card.dmPriceMills !== null;
  const closed = card.dmClosed !== null && (card.check === 'dm-closed' || card.check === 'excluded');
  const checkNext = card.checkNext ?? null;
  const exclude = card.exclude ?? null;
  if (card.check === 'ready' || card.check === 'reply' || card.check === 'checking') return null;
  return (
    <div class="cg-nc__verdict" data-cg-check={card.check}>
      <div class="cg-nc__why">
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
        <span class="cg-nc__check">
          <Button
            label={fanslyText(i18n, checkNext === 'next' ? 'fansly.newcomers.checkNext' : 'fansly.newcomers.checkNow')}
            variant="line"
            size="sm"
            onClick={() => void dispatch({ type: 'CheckNewcomerNext', targetHandle: card.handle })}
          />
        </span>
      )}
      {exclude === null ? null : (
        <span class="cg-nc__check">
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
  return <CardOpen href={href} label={fanslyText(i18n, 'fansly.newcomers.open')} tooltip={fanslyText(i18n, 'fansly.newcomers.openTooltip')} />;
}

/** A code's title inside a sentence after a colon: «Хаб недоступен» → «хаб недоступен»; «AI…», «Fansly…» stay as they are. */
function inSentence(title: string): string {
  const first = title.charAt(0);
  const next = title.charAt(1);
  return /[А-ЯЁ]/.test(first) && next === next.toLowerCase() ? first.toLowerCase() + title.slice(1) : title;
}

/** A cooldown of Fansly's refused the send at once (as the old window): how long to wait, counted down; nothing once it is over. */
function RetryIn({ until }: { readonly until: number }): JSX.Element | null {
  const i18n = useI18n();
  const left = useCountdown(until, useNowFn());
  if (left <= 0) return null;
  return <span data-cg-retry-in="1"> · {fanslyText(i18n, 'fansly.newcomers.greeting.retryIn', { s: Math.ceil(left / 1000) })}</span>;
}

/**
 * Where the card's click stands: a spinner while it runs, «✓ Отправлено 09:21», a dot and the code's line otherwise. An
 * unknown outcome says what to do, as ChatSpace's card does: open the chat; if the message is not there, send again
 * («как раньше», the owner 2026-10-20) — never by itself.
 */
function StateLine({ greeting, openHref }: { readonly greeting: NewcomerGreetingVM; readonly openHref: string | null }): JSX.Element | null {
  const i18n = useI18n();
  const state = greeting.state;
  switch (state.s) {
    case 'idle':
      return null;
    case 'generating':
    case 'sending':
      return <GreetingState mark={<Spinner />} words={fanslyText(i18n, state.s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating')} />;
    case 'inserted':
      return <GreetingState strong={false} words={fanslyText(i18n, 'fansly.newcomers.greeting.inserted')} />;
    case 'sent':
      return <GreetingState class="is-sent" mark={<Icon name="check" />} strong={false} words={fanslyText(i18n, 'fansly.newcomers.greeting.sent', { time: state.at === null ? '' : i18n.formatTime(state.at, 'time') })} />;
    case 'refused':
      return (
        <GreetingState
          mark={<Dot kind="danger" />}
          words={fanslyText(i18n, 'fansly.newcomers.greeting.refused')}
          code={state.failure.code}
          tail={
            <>
              ChatGoose · {state.failure.code}: {failureView(i18n, state.failure).title}
              {state.failure.retryAt !== null ? <RetryIn until={state.failure.retryAt} /> : null}
            </>
          }
        />
      );
    case 'not-drafted':
      // «Сгенерировать» made no draft (the old window's words): nothing was sent, the field is the person's to retry or write.
      return (
        <GreetingState
          mark={<Dot kind="danger" />}
          words={fanslyText(i18n, 'fansly.newcomers.greeting.notDrafted', { reason: inSentence(failureView(i18n, state.failure).title) })}
          code={state.failure.code}
          attrs={{ 'data-cg-not-drafted': '1' }}
          tail={fanslyText(i18n, 'fansly.newcomers.errorFrom', { code: state.failure.code })}
        />
      );
    case 'uncertain':
      return (
        <GreetingState
          mark={<Dot kind="ink" />}
          words={fanslyText(i18n, 'fansly.newcomers.greeting.uncertain')}
          code={state.failure.code}
          attrs={{ 'data-cg-uncertain': '1' }}
          tail={
            <>
              {fanslyText(i18n, 'fansly.newcomers.greeting.uncertainTail')}
              {openHref === null ? null : (
                <>
                  {' '}
                  <OpenLink href={openHref} />
                </>
              )}
            </>
          }
        />
      );
  }
}

/** The card's greeting (R20 P10c): the draft, «AI» while it is the generation unchanged, «Сгенерировать», «Открыть и вставить», «Отправить →». */
function greetingOf(i18n: I18n, card: NewcomerCardVM, greeting: NewcomerGreetingVM): GreetingModel {
  const handle = card.handle;
  const s = greeting.state.s;
  const running = s === 'generating' || s === 'sending';
  const runningText = fanslyText(i18n, s === 'sending' ? 'fansly.newcomers.greeting.sending' : 'fansly.newcomers.greeting.generating');
  // Why a button is off, in the tooltip it always shows (ui-design §4): what runs, what the pass has not proven, how the click ended, an empty field.
  const why = (): string => {
    if (running) return runningText;
    if (greeting.waiting) return fanslyText(i18n, 'fansly.newcomers.greeting.waiting');
    if (s === 'sent') return fanslyText(i18n, 'fansly.newcomers.greeting.sent', { time: '' }).trim();
    return fanslyText(i18n, 'fansly.newcomers.greeting.placeholder');
  };
  const noAutoSend = fanslyText(i18n, 'fansly.newcomers.noAutoSend');
  return {
    scope: handle,
    text: greeting.text,
    label: fanslyText(i18n, 'fansly.newcomers.greeting.label'),
    // Not checked yet: the field itself says the draft may be typed and goes after the check (the old window's placeholder).
    placeholder: fanslyText(i18n, greeting.waiting ? 'fansly.newcomers.greeting.waiting' : 'fansly.newcomers.greeting.placeholder'),
    maxChars: greeting.maxChars,
    edit: running ? null : (text) => ({ type: 'SetPreviewDraft', targetHandle: handle, text }),
    locked: running ? runningText : null,
    ai: greeting.ai ? { label: fanslyText(i18n, 'fansly.newcomers.greeting.ai'), tooltip: fanslyText(i18n, 'fansly.newcomers.greeting.aiTooltip') } : null,
    note: greeting.stale ? fanslyText(i18n, 'fansly.newcomers.greeting.stale') : null,
    generate: {
      label: fanslyText(i18n, 'fansly.newcomers.greeting.generate'),
      tooltip: noAutoSend,
      action: { type: 'Generate', targetHandle: handle, feature: 'hi', options: {} },
      busy: s === 'generating',
      reason: greeting.canGenerate || s === 'generating' ? null : why(),
    },
    insert: {
      label: fanslyText(i18n, 'fansly.newcomers.greeting.insert'),
      tooltip: fanslyText(i18n, 'fansly.newcomers.greeting.insertTooltip'),
      action: { type: 'InsertNewcomerGreeting', targetHandle: handle },
      reason: greeting.canInsert ? null : why(),
    },
    send: {
      label: fanslyText(i18n, s === 'uncertain' ? 'fansly.newcomers.greeting.sendAgain' : 'fansly.newcomers.greeting.send'),
      tooltip: noAutoSend,
      action: { type: 'SendNewcomerGreeting', targetHandle: handle },
      busy: s === 'sending',
      reason: greeting.canSend || s === 'sending' ? null : greeting.sendBlocked !== null ? failureView(i18n, greeting.sendBlocked).title : why(),
      state: s,
      stamp: greeting,
      last: true,
    },
    state: <StateLine greeting={greeting} openHref={card.openHref} />,
    stage: s,
  };
}

/** Fansly's card in the window: what the pass read of the selected fan, in the family's card. */
function PassCard({ vm }: { readonly vm: NewcomersVM }): JSX.Element {
  const i18n = useI18n();
  const card = vm.pass?.card ?? null;
  const label = fanslyText(i18n, 'fansly.newcomers.cardLabel');
  if (card === null) return <NoCard label={label} loading={vm.view.s === 'loading' ? <Spinner label={i18n.t('common.loading')} /> : null} text={fanslyText(i18n, 'fansly.newcomers.empty.card')} />;
  const greeting = card.greeting ?? null;
  const meta = [
    card.username === null ? null : `@${card.username}`,
    fanslyText(i18n, 'fansly.newcomers.followedAgo', { age: i18n.formatAge(card.followedAt) }),
    card.checkedAt === null ? null : fanslyText(i18n, 'fansly.newcomers.checkedAt', { time: i18n.formatTime(card.checkedAt, 'time') }),
  ]
    .filter((piece) => piece !== null)
    .join(' · ');
  return (
    <NewcomerCard
      key={card.handle}
      handle={card.handle}
      label={label}
      name={card.name}
      custom={card.customName}
      avatarUrl={card.avatarUrl ?? null}
      meta={meta}
      metaTitle={fanslyText(i18n, 'fansly.newcomers.followedAt', { date: i18n.formatTime(card.followedAt, 'datetime') })}
      open={card.openHref === null ? null : <OpenLink href={card.openHref} />}
      notes={
        <>
          {card.moved === true ? (
            <div class="cg-nc__moved" role="status" data-cg-moved={card.check}>
              {fanslyText(i18n, card.check === 'greeted' ? 'fansly.newcomers.moved.greeted' : 'fansly.newcomers.moved.filter')}
            </div>
          ) : null}
          {card.bio === null || card.bio.trim() === '' ? null : <div class="cg-nc__bio">{card.bio}</div>}
          {card.proof === null ? null : (
            <details class="cg-nc__proof">
              <summary>{fanslyText(i18n, 'fansly.newcomers.proof', { date: i18n.formatTime(card.proof.at, 'datetime') })}</summary>
              <div class="cg-nc__proofNote">{fanslyText(i18n, 'fansly.newcomers.proofNote')}</div>
              <blockquote>{card.proof.text}</blockquote>
            </details>
          )}
        </>
      }
      verdict={<Verdict card={card} />}
      greeting={greeting === null ? null : <GreetingEditor model={greetingOf(i18n, card, greeting)} />}
    >
      <History key={card.handle} card={card} />
    </NewcomerCard>
  );
}

// ── the window ──

/** Fansly's adapter of the family's window. */
export const FANSLY_SITE: NewcomersSite = {
  class: 'cg-fnw',
  title: (i18n) => fanslyText(i18n, 'fansly.newcomers.title'),
  listLabel: (i18n) => fanslyText(i18n, 'fansly.newcomers.listLabel'),
  tabLabel: (i18n, tab) => fanslyText(i18n, tab.id === 'todo' ? 'fansly.newcomers.tab.todo' : 'fansly.newcomers.tab.all'),
  period: (i18n, vm) => ({
    lead: fanslyText(i18n, 'fansly.newcomers.period'),
    menuLabel: fanslyText(i18n, 'fansly.newcomers.window'),
    tooltip: rangeText(i18n, vm.pass ?? null) ?? fanslyText(i18n, 'fansly.newcomers.window'),
  }),
  Stage,
  Refresh,
  Lines,
  blocked: (vm) => {
    const pass = vm.pass ?? null;
    if (pass?.stage === 'failed') return 'failed';
    return vm.view.s === 'forbidden' || (pass === null && vm.view.s !== 'loading') ? 'forbidden' : null;
  },
  Failed,
  Filter,
  pickAll: { label: (i18n, n) => fanslyText(i18n, 'fansly.newcomers.pickAll', { n }), tooltip: (i18n, max) => fanslyText(i18n, 'fansly.newcomers.pickTooltip', { max }) },
  rows: ROW_PARTS,
  batchWords,
  Empty,
  Card: PassCard,
  // The window opens on the selected row: the pass's card is the selected fan's.
  opening: () => null,
};

export function FanslyNewcomersWindow(): JSX.Element {
  return <NewcomersWindowOf site={FANSLY_SITE} />;
}
