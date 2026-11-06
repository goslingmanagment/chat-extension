// «Очереди» in the chat (2026-11-02, the owner's «да»; contracts vm/queues QueueStripVM): the strip over the bar. In a fan's
// chat of the portion it says who he is in the queue and why, with «Карточка», «Пропустить ▾» and the next fan; once a
// message went from the chat it says so, and the next fan is the main button. In another chat it is one line back to the
// queue. Nothing moves by itself: the next chat opens only by a click, and the × ends the walk (who is not done goes
// back to the queue). The day's reminder stands in the same place: a queue has fans for the person and they have not
// started it today («Начать →», «Не сегодня»).

import { type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type I18n, type QueueGoneVM, type QueueNudgeVM, type QueueStripVM, type QueueWalkVM, type UiAction } from '@cg/contracts/vm';

import { Button, Icon, chatClick, useDispatch, useI18n } from '../kit';
import { QueueSkip } from '../queues/skip';

/**
 * A refusal in the strip's own words: the page's message of its code. It belongs to the strip's `subject` at the
 * click (the chat's state and fan): the strip stays mounted as the chat moves on, and a refusal of a step the chatter
 * has since passed gives the line back to what the strip says now. The refusal is dropped, not only hidden: one
 * subject comes back (every other chat is `elsewhere|`), and a refusal of an earlier visit must not return with it.
 */
function useRun(subject: string): { readonly error: string | null; readonly run: (action: UiAction) => void } {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const [error, setError] = useState<{ readonly of: string; readonly text: string } | null>(null);
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  useEffect(() => {
    setError((was) => (was !== null && was.of !== subject ? null : was));
  }, [subject]);
  return {
    error: error !== null && error.of === subject ? error.text : null,
    run(action) {
      setError(null);
      void dispatch(action).then((receipt) => {
        // A receipt that lands after the strip moved on belongs to a step that is no longer on screen.
        if (receipt !== null && !receipt.ok && subjectRef.current === subject) setError({ of: subject, text: i18n.t(CG_REGISTRY[receipt.code].title) });
      });
    },
  };
}

const goneWhy = (i18n: I18n, gone: QueueGoneVM): string => i18n.t(`queues.left.${gone.reason}`);

function Nudge({ vm }: { readonly vm: QueueNudgeVM }): JSX.Element {
  const i18n = useI18n();
  const { error, run } = useRun(String(vm.queueId));
  return (
    <div class="cg-qs is-nudge" data-cg-queue-strip="nudge">
      <span class="cg-qs__ic"><Icon name="queues" size={14} /></span>
      <div class="cg-qs__mid">
        <div class="cg-qs__top"><b>{i18n.t('queues.nudge.text', { name: vm.name, n: new Intl.NumberFormat(i18n.language).format(vm.waiting) })}</b></div>
        {error === null ? null : <div class="cg-qs__sub is-error">{error}</div>}
      </div>
      <div class="cg-qs__acts">
        <Button label={i18n.t('queues.nudge.later')} variant="quiet" size="sm" onClick={() => run({ type: 'DismissQueueNudge' })} />
        <Button label={i18n.t('queues.nudge.start')} variant="line" size="sm" onClick={() => run(vm.batch ? { type: 'SetQueues', open: true, queue: vm.queueId } : { type: 'SetQueues', walk: 'start', queue: vm.queueId })} />
      </div>
    </div>
  );
}

function Walk({ vm }: { readonly vm: QueueWalkVM }): JSX.Element {
  const i18n = useI18n();
  const here = vm.here;
  const stateKey = vm.end !== null ? 'end' : here === null ? 'elsewhere' : here.state;
  const { error, run } = useRun(`${stateKey}|${here?.handle ?? ''}`);
  const went = here?.state === 'written';
  const nextLabel = vm.next === null ? '' : vm.next.answered ? i18n.t('queues.strip.answeredName', { name: vm.next.name }) : went || here === null ? i18n.t('queues.strip.nextName', { name: vm.next.name }) : i18n.t('queues.strip.next');
  const counts = `${i18n.t('queues.strip.left', { n: vm.left })} · ${i18n.t('queues.strip.today', { n: vm.today })}`;

  let top: JSX.Element;
  let sub: string | null;
  if (vm.end !== null) {
    top = (
      <>
        <b>{i18n.t('queues.strip.end', { written: vm.end.written, skipped: vm.end.skipped })}</b> · {vm.name}
      </>
    );
    sub = vm.end.more ? null : i18n.t('queues.strip.endNone');
  } else if (here === null) {
    // Another chat: one line back to the queue.
    top = (
      <>
        <b>{vm.name}</b> · {counts}
      </>
    );
    sub = vm.gone === null ? null : i18n.t('queues.strip.gone', { name: vm.gone.name, why: goneWhy(i18n, vm.gone) });
  } else if (here.state === 'written' || here.state === 'skipped') {
    top = (
      <>
        <span class={here.state === 'written' ? 'cg-qs__ok' : 'cg-qs__done'}>{i18n.t(here.state === 'written' ? 'queues.strip.written' : 'queues.strip.skipped')}</span> · <b>{vm.name}</b> · {counts}
      </>
    );
    sub = here.state === 'written' ? i18n.t('queues.strip.writtenNote') : null;
  } else {
    top = (
      <>
        <b>{vm.name}</b> · {counts}
      </>
    );
    sub = here.state === 'answered' ? i18n.t('queues.strip.answered') : [here.why, vm.goal === null ? null : i18n.t('queues.why.goal', { goal: vm.goal })].filter((part): part is string => part !== null && part !== '').join('. ');
  }
  return (
    <div class={`cg-qs is-${stateKey}`} data-cg-queue-strip={stateKey}>
      <span class={`cg-qs__ic${went ? ' is-ok' : ''}`}><Icon name={went ? 'check' : 'queues'} size={14} /></span>
      <div class="cg-qs__mid">
        <div class="cg-qs__top">{top}</div>
        {error !== null ? <div class="cg-qs__sub is-error">{error}</div> : sub === null || sub === '' ? null : <div class="cg-qs__sub" title={sub}>{sub}</div>}
      </div>
      <div class="cg-qs__acts">
        {here === null || vm.end !== null || went || here.state === 'skipped' ? null : <Button label={i18n.t('queues.strip.card')} variant="quiet" size="sm" class="cg-qs__card" tooltip={i18n.t('queues.strip.cardTooltip')} onClick={() => run({ type: 'SetQueues', open: true })} />}
        {here === null || here.state !== 'todo' ? null : <QueueSkip handle={here.handle} skips={here.skips} />}
        {vm.next === null ? null : (
          <Button
            label={nextLabel}
            variant={went || here === null || here.state === 'skipped' ? 'line' : 'quiet'}
            size="sm"
            class="cg-qs__next"
            onClick={(event) => run(chatClick({ type: 'Navigate', to: { kind: 'chat', targetHandle: vm.next?.handle ?? '' } }, event))}
          />
        )}
        {vm.end?.more === true ? <Button label={i18n.t('queues.strip.more')} variant="line" size="sm" onClick={() => run({ type: 'SetQueues', more: true })} /> : null}
      </div>
      <button type="button" class="cg-qs__x" aria-label={i18n.t('queues.strip.stop')} title={i18n.t('queues.strip.stop')} onClick={() => run({ type: 'SetQueues', walk: 'stop' })}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

export function QueueStrip({ vm }: { readonly vm: QueueStripVM | null | undefined }): JSX.Element | null {
  if (vm === null || vm === undefined) return null;
  return vm.kind === 'nudge' ? <Nudge vm={vm} /> : <Walk vm={vm} />;
}

export const QUEUE_STRIP_CSS = `
${/* A raised card over the bar, of the bar's own making (2026-11-02): one or two lines of words, the buttons on the right. */ ''}
.cg-qs {
  display: flex; align-items: center; gap: 8px; min-width: 0; margin-bottom: 4px; padding: 5px 6px 5px 10px;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-2); border-radius: var(--cg-r-lg); box-shadow: var(--cg-shadow);
  font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink);
}
.cg-qs__ic { flex: none; display: inline-flex; color: var(--cg-clay); }
.cg-qs__ic.is-ok { color: var(--cg-money); }
.cg-qs__mid { flex: 1 1 auto; min-width: 0; }
.cg-qs__top, .cg-qs__sub { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cg-qs__top b { font-weight: 600; }
.cg-qs__sub { color: var(--cg-ink-muted); font-size: var(--cg-text-2xs); }
.cg-qs__sub.is-error { color: var(--cg-danger); }
.cg-qs__ok { color: var(--cg-money); font-weight: 600; }
.cg-qs__done { color: var(--cg-ink-muted); font-weight: 600; }
.cg-qs__acts { flex: none; display: flex; align-items: center; gap: 2px; }
.cg-qs__next { max-width: 220px; }
.cg-qs__next .cg-btn__t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-qs__x {
  all: unset; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px;
  color: var(--cg-ink-muted); cursor: pointer;
}
.cg-qs__x:hover { background: var(--cg-chip); color: var(--cg-ink-strong); }
.cg-qs__x:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: -2px; }
@container cg (max-width: 639px) {
  .cg-qs__card { display: none; }
  .cg-qs__next { max-width: 150px; }
}
`;
