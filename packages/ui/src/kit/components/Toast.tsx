// Toasts (ui-design §3.9, §4.22; architecture.md §9.5; ER-009…ER-015): four
// kinds — error (red dot), warning (ring), success (check), info («i») — at
// the top right, never over ChatSpace's Send. «ChatGoose · CG-…» above the
// title of our errors; under the explanation the error's technical line
// (monospace, ≤ 400 characters) and, while it runs, the countdown to its
// fixed retry deadline (ER-010); «Открыть чат», «Настройки» (deep link by
// code), «Скопировать код». Hover or focus inside holds the timer
// (HoldToast); Esc inside or × closes. The controller owns the queue: the
// same code and scope replace each other, 4.5 s and 6.5 s for errors; the
// stack never draws more than three, newest first.
//
// A greeting reminder (1.61.0, the owner: «с авой»): the fan as a card — their picture over the initial, «Ждёт
// приветствия» in the accent, the name, «@handle · 11 мин назад»; «Hi» filled in the accent, «Позже» beside it.
// 1.62.0: in a tab of another model the accent line names the fan's model — «Ждёт приветствия · {модель}».
// 2026-10-29 (the owner: «третий красный через 15»): the fan's last reminder is red — the frame, the accent line and «Hi».
// 2026-10-29 (the owner chose «Hi прямо в напоминании»): what «Hi» wrote stands in the card — «Пишу приветствие…», then the
// greeting as an AI draft (dashed, serif) with «Отправить» filled, «Ещё вариант» and «Открыть чат»; a line under it says
// «Отправляю…», «Отправлено», why it did not go, or that somebody greeted the fan already.
// 2026-10-31 (Grisha: «иногда hi в уведомлении переключает на вторую вкладку … есть какой то индикатор … я теряюсь»): a
// reminder about a fan of another page wears that page's hub label on an ear over its top left corner (the shape of a
// browser tab: «из другой вкладки»), and its «Hi» says where it goes, «Hi в lora-2 ↗», with «Переключу на вкладку lora-2»
// under the buttons. The tab that Hi brings forward shows the same card in the same corner, where the eye already is:
// «Вы во вкладке lora-2», how the Hi goes there, and «Назад в lora-1». No colour of its own: the shape and the words say it.

import { type JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { type GreetArrivedState, type GreetCardVM, type ToastVM } from '@cg/contracts/vm';

import { useDispatch, useI18n, useKit, useView } from '../context';
import { LAYERS } from '../layers';
import { ActionButton, Button } from './Button';
import { CodeLine, CopyCodeButton, technicalLine } from './ErrorCard';
import { Icon } from './Icon';
import { Dot, Spinner } from './Indicators';
import { Age, useCountdownText } from './Values';

/** At most three on screen (ui-design §3.9). */
export const TOAST_MAX = 3;

export interface ToastItemProps {
  readonly toast: ToastVM;
  readonly onDismiss: () => void;
  readonly onHold: (hold: boolean) => void;
}

function Mark({ kind }: { readonly kind: ToastVM['kind'] }): JSX.Element {
  switch (kind) {
    case 'error':
      return <Dot kind="danger" />;
    case 'warning':
      return <Dot kind="ring" />;
    case 'success':
      return <Icon name="check" size={14} class="cg-toast__ok" />;
    case 'info':
      return <Icon name="info" size={14} class="cg-toast__info" />;
  }
}

/** The fan's picture over their initial: the initial stays when there is none, or it does not load. */
function GreetAvatar({ name, url }: { readonly name: string; readonly url: string | null }): JSX.Element {
  const [broken, setBroken] = useState<string | null>(null);
  const letter = ([...name.trim()][0] ?? '?').toLocaleUpperCase();
  const shown = url !== null && url !== broken ? url : null;
  return (
    <span class="cg-toast__ava" aria-hidden="true">
      {letter}
      {shown === null ? null : <img src={shown} alt="" decoding="async" referrerpolicy="no-referrer" draggable={false} onError={() => setBroken(shown)} />}
    </span>
  );
}

/** «Открыть чат» of what «Hi» wrote: the fan's chat with it in the field, the chat to check, or the old «Hi». */
const opensChat = (action: ToastVM['actions'][number]['action']): boolean =>
  action.type === 'OpenAndInsertPart' || action.type === 'InsertNewcomerGreeting' || action.type === 'OpenChatToVerify' || (action.type === 'GreetNewcomer' && action.here !== true);

/** What «Hi» wrote in the reminder: the greeting and the line of its state. */
function GreetCard({ card }: { readonly card: GreetCardVM }): JSX.Element {
  const i18n = useI18n();
  if (card.s === 'writing') {
    return (
      <div class="cg-toast__state" data-cg-greet="writing">
        <Spinner />
        {i18n.t('toast.greetWriting')}
      </div>
    );
  }
  const line =
    card.s === 'sending'
      ? i18n.t('toast.greetSending')
      : card.s === 'sent'
        ? i18n.t('toast.greetSent')
        : card.s === 'greeted'
          ? i18n.t('toast.greetGreetedHere')
          : card.s === 'uncertain'
            ? i18n.t('toast.greetUncertain')
            : card.s === 'failed'
              ? card.why === null
                ? i18n.t('toast.greetFailed')
                : `${i18n.t('toast.greetFailed')}: ${card.why}`
              : card.why;
  return (
    <>
      {card.text === null ? null : (
        <div class="cg-toast__draft" data-cg-greet={card.s}>
          {card.text}
        </div>
      )}
      {line === null ? null : (
        <div class={`cg-toast__state is-${card.s}`}>
          {card.s === 'sending' ? <Spinner /> : card.s === 'sent' ? <Icon name="check" size={14} /> : null}
          {line}
        </div>
      )}
    </>
  );
}

/** How a «Hi» handed over from another page's tab goes here: the line under the fan's name; null — nothing to say. */
function ArrivedLine({ s }: { readonly s: GreetArrivedState | null }): JSX.Element | null {
  const i18n = useI18n();
  switch (s) {
    case null:
      return null;
    case 'writing':
      return (
        <div class="cg-toast__state" data-cg-greet="writing">
          <Spinner />
          {i18n.t('toast.greetWriting')}
        </div>
      );
    case 'inserted':
      return <div class="cg-toast__state">{i18n.t('toast.greetInField')}</div>;
    case 'sent':
      return (
        <div class="cg-toast__state is-sent">
          <Icon name="check" size={14} />
          {i18n.t('toast.greetSent')}
        </div>
      );
    case 'greeted':
      return <div class="cg-toast__state">{i18n.t('toast.greetGreetedHere')}</div>;
  }
}

export function ToastItem({ toast, onDismiss, onHold }: ToastItemProps): JSX.Element {
  const i18n = useI18n();
  const { root } = useKit();
  const box = useRef<HTMLDivElement>(null);
  // Held while the pointer is over it or focus is inside it (§4.22); one HoldToast per change.
  const state = useRef({ hovered: false, focused: false, held: false });
  const update = (patch: Partial<{ hovered: boolean; focused: boolean }>): void => {
    const next = { ...state.current, ...patch };
    const held = next.hovered || next.focused;
    state.current = { ...next, held };
    if (held !== next.held) onHold(held);
  };
  const stillInside = (related: EventTarget | null): boolean => related instanceof Node && box.current?.contains(related) === true;
  const tech = technicalLine(toast.detail);
  // «Повторить через 24 с» from the deadline fixed once (ER-007, ER-010); gone once it passed.
  const { remaining } = useCountdownText(toast.retryAt ?? null);
  const counting = toast.retryAt !== undefined && remaining > 0;
  const copyCode = toast.copyCode ? toast.code : null;
  const greet = toast.greet ?? null;
  // A fan of another page: the ear names the page, «Hi» leads there. The card that Hi brings wears the same ear.
  const away = greet?.away ?? null;
  const arrived = greet?.arrived ?? null;
  const ear = away ?? arrived?.page ?? null;
  return (
    <div
      ref={box}
      class={`cg-toast cg-toast--${toast.kind}${greet === null ? '' : ' cg-toast--greet'}${greet?.urgent === true && arrived === null ? ' cg-toast--urgent' : ''}${greet?.card === undefined ? '' : ' has-card'}${ear === null ? '' : ' cg-toast--away'}`}
      data-cg-toast={toast.id}
      {...(toast.kind === 'error' ? { role: 'alert' } : {})}
      onMouseEnter={() => update({ hovered: true })}
      onMouseLeave={() => update({ hovered: false, focused: stillInside(root.activeElement) })}
      onFocusIn={() => update({ focused: true })}
      onFocusOut={(event) => {
        if (!stillInside(event.relatedTarget)) update({ focused: false });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      {ear === null ? null : (
        <div class="cg-toast__ear" data-cg-greet-page={ear}>
          {ear}
        </div>
      )}
      <span class="cg-gut">{greet === null ? <Mark kind={toast.kind} /> : <GreetAvatar name={greet.name} url={greet.avatarUrl} />}</span>
      {greet === null ? (
        <div class="cg-toast__main">
          {toast.code === null ? null : <CodeLine code={toast.code} class="cg-toast__code" />}
          <div class="cg-toast__t">{toast.title}</div>
          {toast.body === null ? null : <div class="cg-toast__sub">{toast.body}</div>}
          {tech === null ? null : <div class="cg-toast__tech">{tech}</div>}
        </div>
      ) : (
        <div class="cg-toast__main" title={toast.title}>
          <div class="cg-toast__lead">{arrived === null ? i18n.t('toast.greetWaiting') : toast.title}</div>
          <div class="cg-toast__name">{greet.name}</div>
          {arrived !== null ? (
            <ArrivedLine s={arrived.s} />
          ) : greet.handle === null && greet.since === null ? null : (
            <div class="cg-toast__sub">
              {greet.handle === null ? null : `@${greet.handle}`}
              {greet.handle !== null && greet.since !== null ? ' · ' : null}
              {greet.since === null ? null : <Age from={greet.since} suffix />}
            </div>
          )}
        </div>
      )}
      <Button label={i18n.t('toast.closeAria')} icon="x" iconOnly variant="quiet" class="cg-toast__x" onClick={onDismiss} />
      {greet?.card === undefined ? null : (
        <div class="cg-toast__card">
          <GreetCard card={greet.card} />
        </div>
      )}
      {toast.actions.length > 0 || copyCode !== null || counting ? (
        <div class="cg-toast__acts">
          {toast.actions.map((vm, index) =>
            // The filled one: «Hi» (to another page's tab with its arrow), or «Отправить» of what it wrote.
            greet !== null && (greet.card === undefined ? vm.action.type === 'GreetNewcomer' : vm.action.type === 'SendNewcomerGreeting' || vm.action.type === 'SendPart') ? (
              <ActionButton key={index} vm={vm} class="cg-toast__hi" {...(away === null ? {} : { trailing: <Icon name="away" size={14} /> })} />
            ) : (
              <ActionButton
                key={index}
                vm={vm}
                variant={greet?.card !== undefined && opensChat(vm.action) ? 'quiet' : vm.action.type === 'Navigate' || greet !== null ? 'line' : 'plain'}
                {...(vm.action.type === 'GreetBack' ? { icon: 'back' as const } : {})}
              />
            ),
          )}
          {counting ? <span class="cg-count cg-toast__count">{`${i18n.t('common.retry')} ${i18n.t('cg.retryIn', { n: Math.ceil(remaining / 1000) })}`}</span> : null}
          {copyCode === null ? null : <CopyCodeButton code={copyCode} />}
        </div>
      ) : null}
      {away === null ? null : <div class="cg-toast__away">{i18n.t('toast.greetAway', { page: away })}</div>}
    </div>
  );
}

/** The stack of the overlay host: `toasts` view, newest first; `aria-live="polite"` (errors are alerts). */
export function ToastStack(): JSX.Element {
  const view = useView({ of: 'toasts' }).value;
  const dispatch = useDispatch();
  return (
    <div class="cg-toasts" aria-live="polite">
      {view.toasts.slice(0, TOAST_MAX).map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => void dispatch({ type: 'DismissToast', toastId: toast.id })}
          onHold={(hold) => void dispatch({ type: 'HoldToast', toastId: toast.id, hold })}
        />
      ))}
    </div>
  );
}

export const TOAST_CSS = `
.cg-toasts {
  position: fixed; z-index: ${LAYERS.toast}; top: 56px; right: 84px; width: min(360px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 8px; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
  pointer-events: none;
  ${/* To an open side panel and back (ui-design §3.9): one slide, as long as a toast's own appearance (§2.9). */ ''}
  transition: right 140ms var(--cg-ease), width 140ms var(--cg-ease);
}
.cg-toasts > * { pointer-events: auto; }
@media (max-width: 600px) { .cg-toasts { right: 16px; } }
@media (prefers-reduced-motion: reduce) { .cg-toasts { transition: none; } }
.cg-toast {
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: start; padding: 10px 6px 10px 0;
  background: var(--cg-raised); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg);
  box-shadow: var(--cg-shadow-float); animation: cg-open 140ms var(--cg-ease);
}
.cg-toast > .cg-gut { width: 32px; height: 18px; }
.cg-toast__main { min-width: 0; }
.cg-toast__code { display: flex; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-muted); }
.cg-toast__t { color: var(--cg-ink-strong); font-weight: 600; overflow-wrap: anywhere; }
.cg-toast__sub { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-top: 2px; overflow-wrap: anywhere; }
.cg-toast__tech { margin-top: 4px; font-family: var(--cg-mono); font-size: var(--cg-text-xs); line-height: 16px; color: var(--cg-ink-muted); overflow-wrap: anywhere; }
.cg-toast__count { font-size: var(--cg-text-sm); }
.cg-toast__acts { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 0; grid-column: 2 / 4; }
.cg-btn.cg-toast__x { width: 24px; height: 24px; margin: -4px 0 0 4px; color: var(--cg-ink-muted); }
.cg-btn.cg-toast__x:hover { color: var(--cg-ink); }
.cg-toast__ok { color: var(--cg-ink-2); }
.cg-toast__info { color: var(--cg-ink-muted); }
@media (prefers-reduced-motion: reduce) { .cg-toast { animation: none; } }
.cg-toast--greet { grid-template-columns: 58px minmax(0, 1fr) auto; padding: 12px 6px 12px 0; }
.cg-toast--greet > .cg-gut { width: 58px; height: auto; display: flex; justify-content: center; }
.cg-toast__ava {
  position: relative; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; width: 40px; height: 40px;
  border-radius: 50%; background: var(--cg-clay-bg); color: var(--cg-clay-ink); font-weight: 600; font-size: var(--cg-text-xl);
  box-shadow: inset 0 0 0 1px var(--cg-clay-line);
}
.cg-toast__ava img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cg-toast__lead { font-size: var(--cg-text-sm); line-height: 16px; font-weight: 500; color: var(--cg-clay-ink); }
.cg-toast__name { font-size: var(--cg-text-xl); line-height: 20px; font-weight: 600; color: var(--cg-ink-strong); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cg-toast--greet .cg-toast__acts { gap: 8px; margin-top: 10px; grid-column: 2 / 4; }
.cg-btn.cg-toast__hi { background: var(--cg-clay); color: #fff; padding: 0 16px; }
.cg-btn.cg-toast__hi:hover { background: var(--cg-clay-ink); color: #fff; }
.cg-toast__card { grid-column: 1 / 4; min-width: 0; margin: 2px 8px 0 12px; }
.cg-toast--greet.has-card .cg-toast__acts { grid-column: 1 / 4; margin-left: 12px; gap: 6px; }
.cg-toast--greet.has-card .cg-btn.cg-toast__hi { padding: 0 14px; }
.cg-toast--greet.has-card .cg-btn--quiet { margin-left: auto; }
.cg-toast__draft {
  margin: 8px 0 0; padding: 6px 9px; border: 1px dashed var(--cg-clay-line); border-radius: var(--cg-r-md); background: var(--cg-draft);
  font-family: var(--cg-serif); font-size: var(--cg-text-md); line-height: 19px; color: var(--cg-ink-strong); overflow-wrap: anywhere; white-space: pre-wrap;
}
.cg-toast__state { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); }
.cg-toast__state.is-sent { color: var(--cg-money); }
.cg-toast__state.is-failed, .cg-toast__state.is-uncertain { color: var(--cg-danger); }
.cg-toast__state.is-ready { color: var(--cg-warn-ink); }
.cg-btn.cg-toast__hi:disabled { opacity: 0.5; }
.cg-toast--urgent { border-color: var(--cg-danger); box-shadow: inset 0 0 0 1px var(--cg-danger), var(--cg-shadow-float); background: color-mix(in srgb, var(--cg-danger) 6%, var(--cg-raised)); }
.cg-toast--urgent .cg-toast__lead { color: var(--cg-danger); }
.cg-toast--urgent .cg-btn.cg-toast__hi { background: var(--cg-danger); }
.cg-toast--urgent .cg-btn.cg-toast__hi:hover { background: color-mix(in srgb, var(--cg-danger) 82%, #000); }
${/* A fan of another page (2026-10-31): the ear over the top left corner, the card's corner square under it; it covers the
   card's top line (and the red card's inner one) where they meet, so the two read as one shape. */ ''}
.cg-toast--away { position: relative; margin-top: 23px; border-top-left-radius: 0; }
.cg-toast__ear {
  position: absolute; left: -1px; bottom: calc(100% - 1px); display: inline-flex; align-items: center; height: 24px; max-width: 70%;
  padding: 0 12px; background: var(--cg-raised); border: 1px solid var(--cg-rule-float); border-bottom: 0;
  border-radius: var(--cg-r-md) var(--cg-r-md) 0 0; box-shadow: 0 -4px 8px -6px rgb(38 36 32 / 0.18);
  font-size: var(--cg-text-sm); line-height: 16px; font-weight: 600; color: var(--cg-ink-strong);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cg-toast--urgent .cg-toast__ear {
  border-color: var(--cg-danger); color: var(--cg-danger); background: color-mix(in srgb, var(--cg-danger) 6%, var(--cg-raised));
  box-shadow: inset 1px 1px 0 var(--cg-danger), inset -1px 0 0 var(--cg-danger);
}
.cg-toast__away { grid-column: 2 / 4; margin-top: 7px; font-size: var(--cg-text-sm); line-height: 16px; color: var(--cg-ink-muted); }
`;
