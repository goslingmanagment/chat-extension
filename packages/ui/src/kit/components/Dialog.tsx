// Windows and panels of the overlay host (architecture.md §6.3, §10.1;
// ui-design §3.4–§3.8, §6.3; CS-005): our own layer outside #app. A modal
// window (Spenders, «Новые», the palette, the cheatsheet, a confirmation)
// holds focus — Tab goes round — and gives it back to where it was when it
// closes: inside our root directly, outside it through the host's
// FocusReturn. While one is open our host carries `data-dismissible-open`.
// Side panels (fan panel, Coach) do not hold focus; Esc closes them.

import { type ComponentChildren, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';

import { type ConfirmDialogRequest } from '@cg/contracts/vm';

import { useDismissibleOpen, useI18n, useKit } from '../context';
import { activeIn, focusQuietly, tabbables, trapTab } from '../focus';
import { LAYERS } from '../layers';
import { Button } from './Button';

/** Where a window stands when ChatSpace's container is unknown (0.172.0: top bar 44 px, account rail 64 px). */
export const WINDOW_FALLBACK_INSETS = { top: 44, left: 64, right: 8, bottom: 8 } as const;

export type DialogSize = 'center' | 'wide' | 'window';

export interface DialogProps {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  /** `center` — the palette (620 px); `wide` — the cheatsheet, an expanded result (720 px); `window` — Spenders, «Новые». */
  readonly size?: DialogSize;
  /** The 940 scrim under centred dialogs; a press on it closes. */
  readonly scrim?: boolean;
  /** What gets focus on open; else the first tabbable, else the dialog itself. */
  readonly initialFocus?: () => HTMLElement | null;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Dialog(props: DialogProps): JSX.Element | null {
  const { root, deps } = useKit();
  const geometry = useKit().geometry.value;
  const boxRef = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const { open, onClose } = props;
  // Read at the moment of opening only: an inline function must not re-run the open effect.
  const initialFocus = useRef(props.initialFocus);
  initialFocus.current = props.initialFocus;
  useDismissibleOpen(open);

  useLayoutEffect(() => {
    if (!open) return undefined;
    previous.current = activeIn(root);
    const box = boxRef.current;
    if (box !== null) {
      const target = initialFocus.current?.() ?? tabbables(box)[0] ?? box;
      focusQuietly(target);
    }
    return () => {
      // Back to where focus was: inside our root directly, else the host side's FocusReturn.
      if (!focusQuietly(previous.current)) deps.focus.restore();
      previous.current = null;
    };
  }, [open, root, deps]);

  if (!open) return null;
  const size = props.size ?? 'center';
  const style: Record<string, string> = {};
  if (size === 'window') {
    // The area under ChatSpace's top bar and right of its account rail (MainLayout's container, §3.5).
    const box = geometry.container;
    if (box === null) {
      style['top'] = `${WINDOW_FALLBACK_INSETS.top}px`;
      style['left'] = `${WINDOW_FALLBACK_INSETS.left}px`;
      style['right'] = `${WINDOW_FALLBACK_INSETS.right}px`;
      style['bottom'] = `${WINDOW_FALLBACK_INSETS.bottom}px`;
    } else {
      style['top'] = `${box.top}px`;
      style['left'] = `${box.left}px`;
      style['width'] = `${Math.max(0, box.width - WINDOW_FALLBACK_INSETS.right)}px`;
      style['height'] = `${Math.max(0, box.height - WINDOW_FALLBACK_INSETS.bottom)}px`;
    }
  }
  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (boxRef.current !== null) trapTab(event, boxRef.current, root);
  };
  return (
    <>
      {props.scrim ?? size !== 'window' ? <div class="cg-scrim" aria-hidden="true" onPointerDown={onClose} /> : null}
      <div
        ref={boxRef}
        class={`cg-dialog cg-dialog--${size}${props.class === undefined ? '' : ` ${props.class}`}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </>
  );
}

export interface SidePanelProps {
  readonly label: string;
  readonly onClose: () => void;
  readonly children?: ComponentChildren;
  readonly class?: string;
}

/** A 320 px panel at the right edge of ChatSpace's container, layer 900; it does not hold focus. */
export function SidePanel(props: SidePanelProps): JSX.Element {
  const { geometry, deps } = useKit();
  const box = geometry.value.container;
  const style = box === null ? {} : { top: `${box.top}px`, height: `${box.height}px`, left: `${box.left + box.width - 320}px` };
  return (
    <aside
      class={`cg-side${props.class === undefined ? '' : ` ${props.class}`}`}
      role="complementary"
      aria-label={props.label}
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          props.onClose();
          deps.focus.restore();
        }
      }}
    >
      {props.children}
    </aside>
  );
}

/** The modal confirmation behind DialogPort.confirm («Очистить локальные данные», «Новый диалог»). */
export function ConfirmDialog({
  request,
  onAnswer,
}: {
  readonly request: ConfirmDialogRequest | null;
  readonly onAnswer: (answer: 'confirm' | 'cancel') => void;
}): JSX.Element | null {
  const i18n = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  if (request === null) return null;
  return (
    <Dialog open label={i18n.text(request.title)} onClose={() => onAnswer('cancel')} size="center" initialFocus={() => cancelRef.current}>
      <div class="cg-confirm-dlg">
        <h2 class="cg-confirm-dlg__title">{i18n.text(request.title)}</h2>
        {request.body === null ? null : <p class="cg-confirm-dlg__body">{i18n.text(request.body)}</p>}
        <div class="cg-confirm-dlg__acts">
          <Button label={i18n.text(request.cancel)} variant="quiet" buttonRef={cancelRef} onClick={() => onAnswer('cancel')} />
          <Button label={i18n.text(request.confirm)} variant="line" onClick={() => onAnswer('confirm')} />
        </div>
      </div>
    </Dialog>
  );
}

/** The layer container of the overlay host: it lets clicks through, its children catch them. */
export function OverlayLayer({ children }: { readonly children?: ComponentChildren }): JSX.Element {
  return <div class="cg-layer">{children}</div>;
}

export const DIALOG_CSS = `
.cg-layer { position: fixed; inset: 0; z-index: ${LAYERS.panel}; pointer-events: none; font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink); }
.cg-layer > * { pointer-events: auto; }
.cg-scrim { position: fixed; inset: 0; z-index: ${LAYERS.scrim}; background: var(--cg-scrim); }
.cg-dialog {
  position: fixed; z-index: ${LAYERS.window}; display: flex; flex-direction: column; overflow: hidden;
  background: var(--cg-surface); border: 1px solid var(--cg-rule-float); border-radius: var(--cg-r-xl);
  box-shadow: var(--cg-shadow-float); font-size: var(--cg-text-base); line-height: 18px; color: var(--cg-ink);
  animation: cg-open 120ms var(--cg-ease);
}
.cg-dialog:focus { outline: none; }
.cg-dialog--center, .cg-dialog--wide { left: 50%; top: 96px; translate: -50% 0; max-height: calc(100vh - 140px); width: min(620px, calc(100vw - 32px)); }
.cg-dialog--wide { width: min(720px, calc(100vw - 32px)); }
.cg-dialog--window { border-color: var(--cg-rule); border-radius: var(--cg-r-md); box-shadow: var(--cg-shadow); animation-duration: 140ms; }
.cg-side {
  position: fixed; z-index: ${LAYERS.panel}; top: 44px; right: 0; bottom: 0; width: 320px; max-width: 100vw;
  display: flex; flex-direction: column; overflow: hidden; background: var(--cg-surface); border-left: 1px solid var(--cg-rule);
}
.cg-confirm-dlg { padding: 16px 18px 14px; }
.cg-confirm-dlg__title { margin: 0 0 4px; font-size: var(--cg-text-xl); line-height: 22px; font-weight: 600; color: var(--cg-ink-strong); }
.cg-confirm-dlg__body { margin: 0; color: var(--cg-ink-2); }
.cg-confirm-dlg__acts { display: flex; justify-content: flex-end; gap: 6px; margin-top: 14px; }
@media (prefers-reduced-motion: reduce) { .cg-dialog { animation: none; } }
`;
