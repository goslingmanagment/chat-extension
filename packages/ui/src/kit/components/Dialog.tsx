// Windows and panels of the overlay host (architecture.md §6.3, §10.1;
// ui-design §3.4–§3.8, §6.3; CS-005): our own layer outside #app. A modal
// window (Spenders, «Новые», the palette, the cheatsheet, a confirmation)
// holds focus — Tab goes round — and gives it back to where it was when it
// closes: inside our root directly, outside it through the host's
// FocusReturn. While one is open our host carries `data-dismissible-open`.
// Side panels (fan panel, Coach) do not hold focus; Esc closes them.

import { type ComponentChildren, type JSX, type TargetedKeyboardEvent } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';

import { type ConfirmDialogRequest } from '@cg/contracts/vm';

import { useDismissibleOpen, useI18n, useKit } from '../context';
import { activeIn, focusQuietly, tabbables, trapTab } from '../focus';
import { Button } from './Button';

/** Where a window stands when ChatSpace's container is unknown (0.172.0: top bar 44 px, account rail 64 px). */
export const WINDOW_FALLBACK_INSETS = { top: 44, left: 64, right: 8, bottom: 8 } as const;

/** Between a column window and the top and bottom of ChatSpace's container. */
export const COLUMN_GAP = 8;

export type DialogSize = 'center' | 'wide' | 'window' | 'column';

export interface DialogProps {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  /**
   * `center` — the palette (620 px); `wide` — the cheatsheet, an expanded result (720 px); `window` — Spenders,
   * «Новые»; `column` — the preview's own window (420 px, the full height of ChatSpace's container, centred in it).
   */
  readonly size?: DialogSize;
  /** The 940 scrim under centred dialogs; a press on it closes. */
  readonly scrim?: boolean;
  /** What gets focus on open; else the first tabbable, else the dialog itself. */
  readonly initialFocus?: () => HTMLElement | null;
  /** `alertdialog`: a confirmation of something that cannot be undone, read out with its text at once. */
  readonly alert?: boolean;
  /** The id of the text that describes the dialog (`aria-describedby`). */
  readonly describedBy?: string;
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
  } else if (size === 'column') {
    // One column over the middle of ChatSpace's container (the CSS centres it on `left`), its full height.
    const box = geometry.container;
    if (box === null) {
      style['top'] = `${WINDOW_FALLBACK_INSETS.top + COLUMN_GAP}px`;
      style['bottom'] = `${COLUMN_GAP}px`;
      style['left'] = '50%';
    } else {
      style['top'] = `${box.top + COLUMN_GAP}px`;
      style['left'] = `${box.left + box.width / 2}px`;
      style['height'] = `${Math.max(0, box.height - 2 * COLUMN_GAP)}px`;
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
        role={props.alert === true ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={props.label}
        {...(props.describedBy === undefined ? {} : { 'aria-describedby': props.describedBy })}
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

/**
 * The modal confirmation behind DialogPort.confirm («Очистить локальные
 * данные», «Новый диалог»). `tone` without a new colour (ui-design §1 п. 4):
 * a normal one opens on its confirm button, so Enter goes on; a destructive
 * one is an `alertdialog` read out with its text, opens on «Отмена», and its
 * confirm button is set in `ink-strong` 600.
 */
export function ConfirmDialog({
  request,
  onAnswer,
}: {
  readonly request: ConfirmDialogRequest | null;
  readonly onAnswer: (answer: 'confirm' | 'cancel') => void;
}): JSX.Element | null {
  const i18n = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const bodyId = `cg-confirm-${useId()}`;
  if (request === null) return null;
  const destructive = request.tone === 'destructive';
  return (
    <Dialog
      open
      label={i18n.text(request.title)}
      onClose={() => onAnswer('cancel')}
      size="center"
      alert={destructive}
      {...(request.body === null ? {} : { describedBy: bodyId })}
      initialFocus={() => (destructive ? cancelRef.current : confirmRef.current)}
    >
      <div class="cg-confirm-dlg" data-cg-tone={request.tone}>
        <h2 class="cg-confirm-dlg__title">{i18n.text(request.title)}</h2>
        {request.body === null ? null : (
          <p class="cg-confirm-dlg__body" id={bodyId}>
            {i18n.text(request.body)}
          </p>
        )}
        <div class="cg-confirm-dlg__acts">
          <Button label={i18n.text(request.cancel)} variant="quiet" buttonRef={cancelRef} onClick={() => onAnswer('cancel')} />
          <Button
            label={i18n.text(request.confirm)}
            variant="line"
            class={destructive ? 'cg-confirm-dlg__go is-destructive' : 'cg-confirm-dlg__go'}
            buttonRef={confirmRef}
            onClick={() => onAnswer('confirm')}
          />
        </div>
      </div>
    </Dialog>
  );
}

/** The layer container of the overlay host: it lets clicks through, its children catch them. */
export function OverlayLayer({ children }: { readonly children?: ComponentChildren }): JSX.Element {
  return <div class="cg-layer">{children}</div>;
}

export { DIALOG_CSS } from './dialog.css';
