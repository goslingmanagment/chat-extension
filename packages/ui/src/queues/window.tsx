// The window of «Очереди» (2026-10-29, the owner's prototype; view `queues`): «Онлайн»'s twin. In the head the
// creator, the page and who works the queues («вы: Макс»); under it the page's queues as chips («Холодные живые ·
// 12/50» with «постоянная», «только моя», «пауза»), then the chosen queue's goal and who is in it, how it writes and
// who asked for it. On the left the fans who answered a message from a queue first («Ответили», across the queues),
// then the person's portion («Моя порция 6 из 10»); the foot counts the day and, for a template queue, holds
// «Отправить всем N». On the right the chosen fan's card («Онлайн»'s own), or what the portion came to.
//
// Keys (as «Онлайн»): J / K and ↑ ↓ along the fans, the card follows once the keys stop; Enter or Space opens it at
// once; ← → along the queues' chips; Esc closes. «Отправить →» is a click, never a key.

import { type JSX, type TargetedKeyboardEvent } from 'preact';
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';

import { type I18n, type OnlineRowVM, type QueueChipVM, type QueueEndVM, type QueueHowVM, type QueuesWindowVM, type UiAction } from '@cg/contracts/vm';

import { Button, Icon, Spinner, ViewState, isComposing, useDispatch, useI18n, useMinuteClock, useTooltip, useView } from '../kit';
import { NewcomersFrame } from '../newcomers/frame';
import { OnlineCard } from '../online/card';
import { OnlineRow } from '../online/rows';
import { isPlainKey, isTextEntry } from '../spenders/window';

export const CLOSE_QUEUES: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'queues', open: false } };

/** «1 948»: a count in the window's language. */
const count = (i18n: I18n, n: number): string => new Intl.NumberFormat(i18n.language).format(n);

/** How the queue writes, in one line: «Шаблон B с именем, пачкой по 10», «Ping по одному». */
export function howText(i18n: I18n, how: QueueHowVM): string {
  const what =
    how.action !== 'template'
      ? i18n.t(`queues.how.${how.action}`)
      : how.own
        ? i18n.t('queues.how.templateOwn')
        : how.group === null
          ? i18n.t('queues.how.templateAny')
          : i18n.t('queues.how.template', { group: how.group.toUpperCase() });
  return how.batch ? `${what}, ${i18n.t('queues.how.batch')}` : `${what} ${i18n.t('queues.how.one')}`;
}

/** Under the title: the creator, the page, the person. */
function Sub({ vm }: { readonly vm: QueuesWindowVM }): JSX.Element {
  const i18n = useI18n();
  return (
    <>
      {vm.creator === null ? null : <span class="cg-nw__creator">@{vm.creator}</span>}
      {vm.pageName === null ? null : <span class="cg-nw__page">{vm.pageName}</span>}
      {vm.me === null ? null : <span class="qu-me">{i18n.t('queues.me', { name: vm.me })}</span>}
    </>
  );
}

function Chip({ chip }: { readonly chip: QueueChipVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const tag = chip.paused ? { kind: ' is-paused', key: 'queues.chip.paused' as const } : chip.standing ? { kind: '', key: 'queues.chip.standing' as const } : chip.mine ? { kind: ' is-mine', key: 'queues.chip.mine' as const } : null;
  const shown = chip.paused ? null : chip.perPerson === null ? String(chip.today) : i18n.t('queues.chip.count', { today: chip.today, per: chip.perPerson });
  const tip = useTooltip(chip.paused || chip.perPerson === null ? null : i18n.t('queues.chip.tooltip', { today: chip.today, per: chip.perPerson }));
  return (
    <button
      type="button"
      role="tab"
      class={`qu-chip${chip.selected ? ' is-on' : ''}${chip.paused ? ' is-paused' : ''}`}
      aria-selected={chip.selected ? 'true' : 'false'}
      tabIndex={chip.selected ? 0 : -1}
      data-cg-queue={chip.queueId}
      onClick={() => {
        if (!chip.selected) void dispatch({ type: 'SetQueues', queue: chip.queueId });
      }}
      {...tip.props}
    >
      <span class="qu-chip__name">{chip.name}</span>
      {tag === null ? null : <span class={`qu-chip__tag${tag.kind}`}>{i18n.t(tag.key)}</span>}
      {shown === null ? null : <span class={`qu-chip__n cg-num${chip.done ? ' is-done' : ''}`}>{shown}</span>}
      {tip.description}
    </button>
  );
}

/** The page's queues; ← → move along them (a chip is chosen by Enter, Space or a click). */
function Chips({ vm }: { readonly vm: QueuesWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  if (vm.chips.length === 0) return null;
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const chips = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.qu-chip')];
    const at = chips.indexOf(event.target as HTMLButtonElement);
    const next = chips[Math.min(chips.length - 1, Math.max(0, at + (event.key === 'ArrowRight' ? 1 : -1)))];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div class="qu-chips" role="tablist" aria-label={i18n.t('queues.title')} onKeyDown={onKeyDown}>
      {vm.chips.map((chip) => (
        <Chip key={chip.queueId} chip={chip} />
      ))}
    </div>
  );
}

/** «Цель: …», «Кто: …» on the left; how it writes, for whom and who asked on the right. */
function Line({ vm }: { readonly vm: QueuesWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  const line = vm.line;
  if (line === null) return null;
  const mine = vm.chips.find((chip) => chip.selected)?.mine === true;
  const whom = mine ? i18n.t('queues.line.mine') : line.people ? i18n.t('queues.line.people') : i18n.t('queues.line.pool');
  return (
    <div class="qu-line" data-cg-queue-line="1">
      <div class="qu-line__l">
        {line.goal === null ? null : (
          <div class="qu-line__goal">
            <b>{i18n.t('queues.line.goal')}</b> {line.goal}
          </div>
        )}
        {line.rule === null || line.rule.length === 0 ? null : (
          <div class="qu-line__who">
            <b>{i18n.t('queues.line.who')}</b> {line.rule.join(' · ')}
          </div>
        )}
      </div>
      <div class="qu-line__r">
        <div>{howText(i18n, line.how)}</div>
        <div>
          {whom} · {i18n.t('queues.line.by', { name: line.requestedBy })}
        </div>
      </div>
    </div>
  );
}

/** The foot: the day of the chosen queue, and «Отправить всем» of a template queue (or the keys). */
function Foot({ vm }: { readonly vm: QueuesWindowVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const day = vm.day;
  if (day === null) return null;
  const batch = vm.batch;
  let action: JSX.Element;
  if (batch === null) action = <div class="cg-nw__bline is-hint">{i18n.t('queues.foot.keys')}</div>;
  else if (batch.running !== null) {
    action = (
      <div class="cg-nw__bline" data-cg-send="running">
        <span class="cg-nw__bst" role="status">
          <Spinner />
          {batch.running.held ? i18n.t('queues.batch.held') : i18n.t('queues.batch.running', { done: batch.running.done, total: batch.running.total })}
        </span>
        <span class="cg-nw__grow" />
        <Button label={i18n.t('queues.batch.stop')} variant="quiet" size="sm" onClick={() => void dispatch({ type: 'StopBatchSend', list: 'queue' })} />
      </div>
    );
  } else if (batch.ready > 0) {
    action = (
      <div class="cg-nw__bline" data-cg-send="ready">
        <span class="qu-hint">{i18n.t('queues.batch.ready', { n: batch.ready })}</span>
        <Button
          label={`${i18n.t('queues.batch.send', { n: batch.ready })} →`}
          variant="send"
          size="sm"
          class="qu-all"
          tooltip={i18n.t('queues.batch.sendTooltip')}
          reason={batch.reason === null ? null : i18n.text(batch.reason)}
          onClick={() => void dispatch({ type: 'SendBatch', list: 'queue' })}
        />
      </div>
    );
  } else action = <div class="cg-nw__bline is-hint">{i18n.t('queues.batch.went')}</div>;
  return (
    <div class="cg-nw__batch">
      <div class="cg-nw__bline qu-day">
        <span class="cg-nw__bn">{day.perPerson === null ? i18n.t('queues.foot.todayOpen', { mine: day.mine }) : i18n.t('queues.foot.today', { mine: day.mine, per: day.perPerson })}</span>
        <span class="qu-day__rest">
          {' · '}
          {day.dailyLimit === null ? i18n.t('queues.foot.pageOpen', { page: day.page }) : i18n.t('queues.foot.page', { page: day.page, limit: day.dailyLimit })}
          {' · '}
          {i18n.t('queues.foot.pending', { n: count(i18n, day.pending) })}
        </span>
      </div>
      {action}
    </div>
  );
}

/** The right pane with no fan's card: what the portion came to, the day's end, a pause, the page's limit, nobody left. */
function EndPane({ end }: { readonly end: QueueEndVM | null }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const more = (label: string): JSX.Element => <Button label={label} variant="line" onClick={() => void dispatch({ type: 'SetQueues', more: true })} />;
  let body: JSX.Element;
  switch (end?.kind) {
    case 'portion': {
      const one = end;
      body = (
        <>
          <h3>{i18n.t('queues.end.portion.title')}</h3>
          <ul>
            <li>
              <b>{i18n.t('queues.end.portion.sent', { sent: one.sent, skipped: one.skipped })}</b>
            </li>
            <li>
              {one.perPerson === null ? i18n.t('queues.end.portion.dayOpen', { mine: one.today }) : i18n.t('queues.end.portion.day', { mine: one.today, per: one.perPerson })}
              {one.dailyLimit === null ? null : ` · ${i18n.t('queues.end.portion.page', { page: one.page, limit: one.dailyLimit })}`}
            </li>
            <li>{i18n.t('queues.end.portion.left', { n: count(i18n, one.pending) })}</li>
          </ul>
          <p>{i18n.t('queues.end.portion.note')}</p>
          {one.pending > 0 ? more(i18n.t('queues.end.portion.more')) : null}
        </>
      );
      break;
    }
    case 'day': {
      const one = end;
      body = (
        <>
          <h3>{i18n.t('queues.end.day.title', { mine: one.today, per: one.perPerson })}</h3>
          <p>{one.dailyLimit === null || one.room === null ? i18n.t('queues.end.day.noteOpen') : i18n.t('queues.end.day.note', { limit: one.dailyLimit, room: one.room })}</p>
          <p>{i18n.t('queues.end.day.audit', { mine: one.today, per: one.perPerson })}</p>
          {one.room === 0 ? (
            <p>
              <b>{i18n.t('queues.end.day.full')}</b>
            </p>
          ) : (
            more(i18n.t('queues.end.day.more'))
          )}
        </>
      );
      break;
    }
    case 'paused': {
      const one = end;
      const n = count(i18n, one.pending);
      body = (
        <>
          <h3>{i18n.t('queues.end.paused.title')}</h3>
          <p>{one.by === null || one.at === null ? i18n.t('queues.end.paused.noteNoTime', { n }) : i18n.t('queues.end.paused.note', { by: one.by, time: { time: one.at }, n })}</p>
          <p>{i18n.t('queues.end.paused.others')}</p>
        </>
      );
      break;
    }
    case 'limit':
      body = (
        <>
          <h3>{i18n.t('queues.end.limit.title')}</h3>
          <p>{i18n.t('queues.end.limit.note')}</p>
        </>
      );
      break;
    case 'empty':
      body = (
        <>
          <h3>{i18n.t('queues.end.empty.title')}</h3>
          <p>{i18n.t('queues.end.empty.note')}</p>
        </>
      );
      break;
    default:
      body = <p>{i18n.t('queues.end.pick')}</p>;
  }
  return (
    <section class="cg-nc cg-ow__card" data-cg-queue-end={end?.kind ?? 'pick'}>
      <div class="ol-end">{body}</div>
    </section>
  );
}

export function QueuesWindow(): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const vm = useView({ of: 'queues' }).value;
  const preview = useView({ of: 'preview', from: 'queue' }).value;
  const rows = useMemo(() => [...vm.answered, ...vm.portion], [vm.answered, vm.portion]);
  useMinuteClock(rows.length > 0);
  const listRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const selected = rows.find((row) => row.selected) ?? null;
  const chip = vm.chips.find((one) => one.selected) ?? null;

  // The chosen fan's row stays in view as the keys move it.
  useEffect(() => {
    if (selected === null) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-cg-key="${CSS.escape(selected.handle)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected?.handle]);

  const choose = useCallback((handle: string): void => void dispatch({ type: 'SelectOnline', targetHandle: handle }), [dispatch]);
  const close = useCallback((): void => void dispatch(CLOSE_QUEUES), [dispatch]);

  const move = (row: OnlineRowVM | null, step: number): void => {
    const at = row === null ? -1 : rows.findIndex((one) => one.handle === row.handle);
    const next = rows[Math.min(rows.length - 1, Math.max(0, at + step))];
    if (next !== undefined && next.handle !== row?.handle) void dispatch({ type: 'SelectOnline', targetHandle: next.handle, keys: true });
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || isComposing(event) || isTextEntry(event.target) || !isPlainKey(event)) return;
    const step = event.code === 'ArrowDown' || event.code === 'KeyJ' ? 1 : event.code === 'ArrowUp' || event.code === 'KeyK' ? -1 : 0;
    if (step !== 0 && rows.length > 0) {
      event.preventDefault();
      move(selected, step);
      return;
    }
    if ((event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') && selected !== null && (event.target as Element | null)?.closest?.('.cg-nw__list') !== null) {
      event.preventDefault();
      void dispatch({ type: 'SelectOnline', targetHandle: selected.handle });
    }
  };

  const blocked = vm.view.s === 'error' || vm.view.s === 'forbidden' || vm.view.s === 'loading' || vm.view.s === 'empty';
  let portion: JSX.Element | null;
  if (chip?.paused === true) {
    portion = (
      <div class="ol-empty" data-cg-queue-paused="1">
        <Icon name="pause" size={14} />
        {i18n.t('queues.paused.list')}
      </div>
    );
  } else if (vm.portion.length === 0) {
    portion = vm.taking ? (
      <div class="ol-empty qu-taking">
        <Spinner />
        {i18n.t('queues.taking')}
      </div>
    ) : vm.end?.kind === 'day' ? (
      <div class="ol-empty">{i18n.t('queues.dayDone.list')}</div>
    ) : null;
  } else {
    portion = (
      <div role="group" aria-label={i18n.t('queues.section.portion')} data-cg-queue-group="portion">
        <div class="cg-ow__group" role="presentation">
          {i18n.t('queues.section.portion')}
          <span class="cg-num">{i18n.t('queues.section.portionCount', { left: vm.left, all: vm.portion.length })}</span>
          <i />
        </div>
        {vm.portion.map((row) => (
          <OnlineRow key={row.handle} row={row} onSelect={choose} />
        ))}
      </div>
    );
  }
  const list = blocked ? (
    <div class="cg-nw__state">
      <ViewState view={vm.view} />
    </div>
  ) : (
    <div class="cg-nw__list" ref={listRef} role="listbox" aria-label={i18n.t('queues.listLabel')}>
      {vm.answered.length === 0 ? null : (
        <div role="group" aria-label={i18n.t('queues.section.answered')} data-cg-queue-group="answered">
          <div class="cg-ow__group" role="presentation">
            {i18n.t('queues.section.answered')}
            <span class="cg-num">{vm.answered.length}</span>
            <i />
          </div>
          {vm.answered.map((row) => (
            <OnlineRow key={row.handle} row={row} onSelect={choose} />
          ))}
        </div>
      )}
      {portion}
    </div>
  );

  return (
    <NewcomersFrame title={i18n.t('queues.title')} sub={<Sub vm={vm} />} class="cg-ow ol qu" onEsc={close} frameRef={frameRef} onKeyDown={onKeyDown} close={CLOSE_QUEUES}>
      <Chips vm={vm} />
      <Line vm={vm} />
      {vm.view.s === 'offline' ? <ViewState view={vm.view} /> : null}
      <div class="cg-nw__main">
        <aside class="cg-nw__side" aria-label={i18n.t('queues.listLabel')} data-cg-queues={vm.view.s}>
          {list}
          {blocked ? null : <Foot vm={vm} />}
        </aside>
        {vm.card !== null ? <OnlineCard card={vm.card} preview={preview} /> : <EndPane end={blocked ? null : vm.end} />}
      </div>
    </NewcomersFrame>
  );
}
