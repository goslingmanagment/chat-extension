// The tooltip bubble and the trigger hook (ui-design §4.1 «Подсказка», §3.4
// layer 970, §6.1 `aria-describedby`). A text of several lines is a hint: its
// first line is the control's name, in bold, the rest explain it (UI-004).
// The bubble is a manual popover: the
// top layer escapes the dock's `contain: layout` and ChatSpace's clipping
// containers; without popover support it falls back to `position: fixed`.

import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';
import { type JSX, type TargetedFocusEvent, type TargetedKeyboardEvent, type TargetedMouseEvent, type TargetedPointerEvent } from 'preact';

import { useKit } from '../context';

/** Gap between the trigger and the bubble, and the margin kept from the window edges. */
export const TOOLTIP_GAP_PX = 6;
const EDGE_PX = 4;

export interface TooltipTriggerProps {
  readonly 'aria-describedby'?: string;
  readonly onMouseEnter: (event: TargetedMouseEvent<HTMLElement>) => void;
  readonly onMouseLeave: (event: TargetedMouseEvent<HTMLElement>) => void;
  readonly onFocus: (event: TargetedFocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: TargetedFocusEvent<HTMLElement>) => void;
  readonly onPointerDown: (event: TargetedPointerEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: TargetedKeyboardEvent<HTMLElement>) => void;
}

export interface TooltipBinding {
  /** Spread on the trigger. */
  readonly props: TooltipTriggerProps;
  /** The hidden text the trigger is described by; render it next to the trigger. */
  readonly description: JSX.Element | null;
}

function focusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Tooltip behaviour for one trigger; `text` null or '' means no tooltip and no description. */
export function useTooltip(text: string | null): TooltipBinding {
  const { tooltips } = useKit();
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const value = text ?? '';

  useEffect(() => {
    if (anchorRef.current !== null) tooltips.update(anchorRef.current, value);
  }, [tooltips, value]);
  useEffect(
    () => () => {
      if (anchorRef.current !== null) tooltips.leave(anchorRef.current);
    },
    [tooltips],
  );

  const props: TooltipTriggerProps = {
    ...(value === '' ? {} : { 'aria-describedby': `cg-tip-${id}` }),
    onMouseEnter: (event) => {
      anchorRef.current = event.currentTarget;
      tooltips.hover(event.currentTarget, value);
    },
    onMouseLeave: (event) => tooltips.leave(event.currentTarget),
    onFocus: (event) => {
      anchorRef.current = event.currentTarget;
      tooltips.focus(event.currentTarget, value, focusVisible(event.currentTarget));
    },
    onBlur: (event) => tooltips.leave(event.currentTarget),
    onPointerDown: (event) => tooltips.leave(event.currentTarget),
    onKeyDown: (event) => {
      if (event.key === 'Escape') tooltips.close();
    },
  };
  const description =
    value === '' ? null : (
      <span id={`cg-tip-${id}`} hidden>
        {value}
      </span>
    );
  return { props, description };
}

type PopoverElement = HTMLElement & { showPopover?: () => void; hidePopover?: () => void };

/** The one bubble of a root; KitRoot renders it. */
export function TooltipLayer() {
  const { tooltips } = useKit();
  const state = tooltips.state.value;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bubble = ref.current as PopoverElement | null;
    if (state === null || bubble === null) return;
    try {
      if (!bubble.matches(':popover-open')) bubble.showPopover?.();
    } catch {
      // No popover support: the fixed bubble at layer 970 is the fallback.
    }
    const view = bubble.ownerDocument.defaultView;
    const anchor = state.anchor.getBoundingClientRect();
    const own = bubble.getBoundingClientRect();
    const width = view?.innerWidth ?? Number.POSITIVE_INFINITY;
    let top = anchor.top - TOOLTIP_GAP_PX - own.height;
    if (top < EDGE_PX) top = anchor.bottom + TOOLTIP_GAP_PX;
    const centred = anchor.left + anchor.width / 2 - own.width / 2;
    const left = Math.max(EDGE_PX, Math.min(centred, width - own.width - EDGE_PX));
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.visibility = 'visible';
  }, [state]);

  if (state === null) return null;
  return (
    <div ref={ref} class={state.text.includes('\n') ? 'cg-tip cg-tip--hint' : 'cg-tip'} role="tooltip" popover="manual" aria-hidden="true" style={{ visibility: 'hidden' }}>
      {state.text}
    </div>
  );
}

export const TOOLTIP_CSS = `
.cg-tip {
  position: fixed; z-index: 970; inset: auto; top: 0; left: 0; margin: 0; border: 0;
  max-width: 280px; padding: 6px 9px; border-radius: var(--cg-r-md);
  background: var(--cg-tip-bg); color: var(--cg-tip-ink); box-shadow: inset 0 0 0 1px var(--cg-rule-float), var(--cg-shadow-float);
  font-family: inherit; font-size: var(--cg-text-sm); line-height: 17px; font-weight: 500;
  white-space: pre-line; overflow-wrap: anywhere; pointer-events: none; overflow: visible;
}
.cg-tip--hint { color: var(--cg-ink-2); }
.cg-tip--hint::first-line { font-weight: 700; color: var(--cg-ink-strong); }
`;
