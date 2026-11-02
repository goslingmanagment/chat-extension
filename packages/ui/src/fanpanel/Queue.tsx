// «Очередь» of the fan panel (Chat Memory week 3): the page of the open tab, whatever chat is open, one component for
// both sites.
// - «Ждут»: the name (the team's alias with its 💵 / ❌), how long the fan waits, what he spent, «в разговоре: Никита».
// - «Передача»: whom the team wrote to in 12 hours (who, how many, who is still «в разговоре»), who waits, the open
//   promises — none known is «не знаю» — and the page's open customs (Chat Memory week 4).
// A row opens the fan's chat; the panel stays where it is.

import { type ComponentChildren, type JSX } from 'preact';

import { type I18nKey } from '@cg/contracts/errors';
import { type QueueFanVM, type QueueTab as QueueTabId, type QueueVM } from '@cg/contracts/vm';

import { chatClick, Button, Money, Segmented, TalkingMark, ViewState, useDispatch, useI18n, useMinuteClock } from '../kit';

const TAB_KEYS: Readonly<Record<QueueTabId, I18nKey>> = { waiting: 'queue.tab.waiting', handoff: 'queue.tab.handoff' };

/** A fan of the queue: a press opens his chat. `meta` — the line under the name; `talking` — the E2 mark by his chat. */
function FanRow({ fan, meta, talking = true, children }: { readonly fan: QueueFanVM; readonly meta: ComponentChildren; readonly talking?: boolean; readonly children?: ComponentChildren }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const open = fan.open;
  return (
    <div class="cg-q__row" data-cg-queue-fan={fan.key}>
      <button type="button" class="cg-q__open" disabled={open === null} title={i18n.t('common.openChat')} onClick={(event) => (open === null ? undefined : void dispatch(chatClick(open, event)))}>
        <span class="cg-q__name">{fan.name}</span>
        {fan.username === null ? null : <span class="cg-q__user">{fan.username}</span>}
        {fan.spent === null ? null : <Money mills={fan.spent} class="cg-q__money" />}
      </button>
      <div class="cg-q__meta">
        <span>{meta}</span>
        {talking ? <TalkingMark handle={fan.handle} /> : null}
      </div>
      {children}
    </div>
  );
}

function Waiting({ queue }: { readonly queue: QueueVM }): JSX.Element | null {
  const i18n = useI18n();
  const waiting = queue.waiting;
  if (waiting === null) return null;
  return (
    <div class="cg-fp__sec">
      <div class="cg-fp__cap">{i18n.t('queue.waiting.total', { count: waiting.total })}</div>
      {waiting.rows.map((row) => (
        <FanRow key={row.key} fan={row} meta={i18n.t('queue.waiting.since', { age: i18n.formatAge(row.since) })} />
      ))}
    </div>
  );
}

function Handoff({ queue }: { readonly queue: QueueVM }): JSX.Element | null {
  const i18n = useI18n();
  const dispatch = useDispatch();
  const handoff = queue.handoff;
  if (handoff === null) return null;
  return (
    <>
      <div class="cg-fp__sec">
        <div class="cg-fp__cap">{i18n.t('queue.handoff.recent')}</div>
        {handoff.recent.length === 0 ? <div class="cg-fp__none">{i18n.t('queue.handoff.recentNone')}</div> : null}
        {handoff.recent.map((row) => (
          // «в разговоре» of the handoff is the hub's: whoever is still talking to the fan, me included.
          <FanRow key={row.key} fan={row} talking={false} meta={`${i18n.t('queue.handoff.wrote', { names: row.chatters.join(', '), count: row.messages })} · ${i18n.formatAge(row.lastSentAt)}`}>
            {row.inConversation.length === 0 ? null : <div class="cg-q__talk">{i18n.t('talking.mark', { names: row.inConversation.join(', ') })}</div>}
          </FanRow>
        ))}
      </div>
      <div class="cg-fp__sec">
        <div class="cg-fp__cap">{i18n.t('queue.handoff.waiting', { count: handoff.waitingTotal })}</div>
        {handoff.waiting.map((row) => (
          <FanRow key={row.key} fan={row} meta={i18n.t('queue.waiting.since', { age: i18n.formatAge(row.since) })} />
        ))}
      </div>
      {handoff.customs === undefined ? null : (
        <div class="cg-fp__sec" data-cg-queue-customs="1">
          <div class="cg-fp__cap">{i18n.t('queue.handoff.customs')}</div>
          {handoff.customs.length === 0 ? <div class="cg-fp__none">{i18n.t('fanPanel.memory.custom.none')}</div> : null}
          {handoff.customs.map((custom) => (
            <div key={custom.key} class="cg-q__promise">
              <div class="cg-q__text">{custom.description}</div>
              <div class="cg-q__meta">
                <span>
                  {[
                    custom.name,
                    custom.state === 'paid' && custom.paidAt !== null
                      ? i18n.t('fanPanel.memory.custom.paid', { age: i18n.formatAge(custom.paidAt) })
                      : custom.state === 'ordered'
                        ? i18n.t('fanPanel.memory.custom.ordered', { age: i18n.formatAge(custom.createdAt) })
                        : i18n.t('fanPanel.memory.custom.unknown'),
                  ]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
                {custom.open === null ? null : <Button label={i18n.t('common.openChat')} variant="quiet" size="sm" onClick={(event) => void dispatch(chatClick(custom.open!, event))} />}
              </div>
            </div>
          ))}
        </div>
      )}
      <div class="cg-fp__sec">
        <div class="cg-fp__cap">{i18n.t('queue.handoff.promises')}</div>
        {handoff.promises.length === 0 ? <div class="cg-fp__none">{i18n.t('fanPanel.memory.unknown')}</div> : null}
        {handoff.promises.map((promise) => (
          <div key={promise.key} class="cg-q__promise" data-cg-queue-promise={promise.key}>
            <div class="cg-q__text">{promise.text}</div>
            <div class="cg-q__meta">
              <span>{[promise.name, promise.at === null ? null : i18n.formatTime(promise.at, 'date')].filter((part) => part !== null).join(' · ')}</span>
              {promise.open === null ? null : <Button label={i18n.t('common.openChat')} variant="quiet" size="sm" onClick={(event) => void dispatch(chatClick(promise.open!, event))} />}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function QueueTab({ queue }: { readonly queue: QueueVM }): JSX.Element {
  const i18n = useI18n();
  const dispatch = useDispatch();
  // «ждёт 12 мин» moves with the clock.
  useMinuteClock(true);
  const ready = queue.view.s === 'ready' || queue.view.s === 'partial';
  return (
    <div class="cg-q" data-cg-queue={queue.tab}>
      {queue.tabs.length < 2 ? null : (
        <div class="cg-fp__sec cg-q__tabs">
          <Segmented<QueueTabId> label={i18n.t('fanPanel.tab.queue')} value={queue.tab} options={queue.tabs.map((tab) => ({ value: tab, label: i18n.t(TAB_KEYS[tab]) }))} onChange={(tab) => void dispatch({ type: 'SetQueueTab', tab })} />
        </div>
      )}
      {!ready ? (
        <div class="cg-fp__sec">
          <ViewState view={queue.view} />
        </div>
      ) : queue.tab === 'waiting' ? (
        <Waiting queue={queue} />
      ) : (
        <Handoff queue={queue} />
      )}
    </div>
  );
}

export const QUEUE_CSS = `
.cg-q__tabs { padding-top: 8px; padding-bottom: 8px; }
.cg-q__row { padding: 6px 0; }
.cg-q__row + .cg-q__row { border-top: 1px dashed var(--cg-rule); }
.cg-q__open {
  all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: baseline; gap: 6px; cursor: pointer; border-radius: var(--cg-r-sm);
}
.cg-q__open:hover .cg-q__name { text-decoration: underline; }
.cg-q__open:focus-visible { outline: 2px solid var(--cg-focus); outline-offset: 2px; }
.cg-q__open:disabled { cursor: default; }
.cg-q__name { font-weight: 600; color: var(--cg-ink-strong); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-q__user { flex: 1 1 0; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.cg-q__money { margin-left: auto; font-weight: 500; color: var(--cg-ink); white-space: nowrap; }
.cg-q__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; font-size: var(--cg-text-sm); color: var(--cg-ink-muted); }
.cg-q__talk { font-size: var(--cg-text-sm); color: var(--cg-ink-2); }
.cg-q__promise { padding: 6px 0; }
.cg-q__promise + .cg-q__promise { border-top: 1px dashed var(--cg-rule); }
.cg-q__promise .cg-q__meta { column-gap: 14px; }
.cg-q__promise .cg-q__meta > .cg-btn { margin-left: -6px; }
.cg-q__text { font-size: var(--cg-text-md); line-height: 20px; color: var(--cg-ink); overflow-wrap: anywhere; }
`;
