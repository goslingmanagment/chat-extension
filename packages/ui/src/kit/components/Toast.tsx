// Toasts (ui-design §3.9, §4.22; architecture.md §9.5; ER-009…ER-015): four
// kinds — error (red dot), warning (ring), success (check), info («i») — at
// the top right, never over ChatSpace's Send. «ChatGoose · CG-…» above the
// title of our errors; «Открыть чат», «Настройки» (deep link by code),
// «Скопировать код». Hover or focus inside holds the timer (HoldToast); Esc
// inside or × closes. The controller owns the queue: at most three, the same
// code and scope replace each other, 4.5 s and 6.5 s for errors.

import { type JSX } from 'preact';
import { useRef } from 'preact/hooks';

import { type ToastVM } from '@cg/contracts/vm';

import { useDispatch, useI18n, useKit, useView } from '../context';
import { LAYERS } from '../layers';
import { ActionButton, Button } from './Button';
import { CodeLine, CopyCodeButton } from './ErrorCard';
import { Icon } from './Icon';
import { Dot } from './Indicators';

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
  return (
    <div
      ref={box}
      class={`cg-toast cg-toast--${toast.kind}`}
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
      <span class="cg-gut">
        <Mark kind={toast.kind} />
      </span>
      <div class="cg-toast__main">
        {toast.code === null ? null : <CodeLine code={toast.code} class="cg-toast__code" />}
        <div class="cg-toast__t">{toast.title}</div>
        {toast.body === null ? null : <div class="cg-toast__sub">{toast.body}</div>}
      </div>
      <Button label={i18n.t('toast.closeAria')} icon="x" iconOnly variant="quiet" class="cg-toast__x" onClick={onDismiss} />
      {toast.actions.length > 0 || (toast.copyCode && toast.code !== null) ? (
        <div class="cg-toast__acts">
          {toast.actions.map((vm, index) => (
            <ActionButton key={index} vm={vm} variant={vm.action.type === 'Navigate' ? 'line' : 'plain'} />
          ))}
          {toast.copyCode && toast.code !== null ? <CopyCodeButton code={toast.code} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The stack of the overlay host: `toasts` view, newest first; `aria-live="polite"` (errors are alerts). */
export function ToastStack(): JSX.Element {
  const view = useView({ of: 'toasts' }).value;
  const dispatch = useDispatch();
  return (
    <div class="cg-toasts" aria-live="polite">
      {view.toasts.map((toast) => (
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
}
.cg-toasts > * { pointer-events: auto; }
@media (max-width: 600px) { .cg-toasts { right: 16px; } }
.cg-toast {
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: start; padding: 10px 6px 10px 0;
  background: var(--cg-surface); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-lg);
  box-shadow: var(--cg-shadow-float); animation: cg-open 140ms var(--cg-ease);
}
.cg-toast > .cg-gut { width: 32px; height: 18px; }
.cg-toast__main { min-width: 0; }
.cg-toast__code { display: flex; font-size: var(--cg-text-sm); font-weight: 500; color: var(--cg-ink-muted); }
.cg-toast__t { color: var(--cg-ink); overflow-wrap: anywhere; }
.cg-toast__sub { font-size: var(--cg-text-sm); color: var(--cg-ink-muted); margin-top: 2px; overflow-wrap: anywhere; }
.cg-toast__acts { display: flex; flex-wrap: wrap; gap: 2px; margin: 6px 0 -2px -8px; grid-column: 2 / 4; }
.cg-btn.cg-toast__x { width: 24px; height: 24px; margin: -4px 0 0 4px; color: var(--cg-ink-muted); }
.cg-btn.cg-toast__x:hover { color: var(--cg-ink); }
.cg-toast__ok { color: var(--cg-ink-2); }
.cg-toast__info { color: var(--cg-ink-muted); }
@media (prefers-reduced-motion: reduce) { .cg-toast { animation: none; } }
`;
