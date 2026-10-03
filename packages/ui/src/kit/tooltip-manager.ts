// Our own tooltip, not the `title` attribute (ui-design §4.1 «Подсказка»,
// UI-004): one per root. It appears after 1 s of hover, after 250 ms when
// moving over from a neighbour whose tooltip closed less than 300 ms ago, and
// at once on keyboard focus. Esc, scrolling (the page's or one of our own
// lists inside the shadow root), the pointer leaving and focus leaving close it. The text is also each trigger's `aria-describedby`.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';

export const TOOLTIP_TIMING = {
  hoverDelayMs: 1000,
  neighbourDelayMs: 250,
  neighbourWindowMs: 300,
} as const;

export interface TooltipState {
  readonly text: string;
  readonly anchor: HTMLElement;
}

export class TooltipManager {
  private readonly current: Signal<TooltipState | null> = signal(null);
  private pending: ReturnType<typeof setTimeout> | null = null;
  private pendingAnchor: HTMLElement | null = null;
  private lastClosedAt = Number.NEGATIVE_INFINITY;
  private detach: (() => void) | null = null;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  get state(): ReadonlySignal<TooltipState | null> {
    return this.current;
  }

  /** The pointer entered a trigger. */
  hover(anchor: HTMLElement, text: string): void {
    if (text === '') return;
    const neighbour = this.current.value !== null || this.clock() - this.lastClosedAt < TOOLTIP_TIMING.neighbourWindowMs;
    if (this.current.value !== null) this.close();
    this.schedule(anchor, text, neighbour ? TOOLTIP_TIMING.neighbourDelayMs : TOOLTIP_TIMING.hoverDelayMs);
  }

  /** A trigger got focus; keyboard focus shows the tooltip at once. */
  focus(anchor: HTMLElement, text: string, keyboard: boolean): void {
    if (text === '' || !keyboard) return;
    this.cancel();
    this.open(anchor, text);
  }

  /** The text of the open (or pending) tooltip of `anchor` changed: follow it. */
  update(anchor: HTMLElement, text: string): void {
    const shown = this.current.value;
    if (shown?.anchor === anchor && shown.text !== text) {
      if (text === '') this.close();
      else this.current.value = { anchor, text };
    }
  }

  /** The pointer left, focus left, the trigger was pressed or unmounted. */
  leave(anchor: HTMLElement): void {
    if (this.pendingAnchor === anchor) this.cancel();
    if (this.current.value?.anchor === anchor) this.close();
  }

  /** Esc, a scroll or a resize: close whatever is shown. */
  close(): void {
    this.cancel();
    if (this.current.value === null) return;
    this.current.value = null;
    this.lastClosedAt = this.clock();
    this.detach?.();
    this.detach = null;
  }

  dispose(): void {
    this.close();
  }

  private schedule(anchor: HTMLElement, text: string, delay: number): void {
    this.cancel();
    this.pendingAnchor = anchor;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.pendingAnchor = null;
      if (anchor.isConnected) this.open(anchor, text);
    }, delay);
  }

  private cancel(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
    this.pendingAnchor = null;
  }

  private open(anchor: HTMLElement, text: string): void {
    this.current.value = { anchor, text };
    this.detach?.();
    const view = anchor.ownerDocument.defaultView;
    if (view === null) return;
    // Only while a tooltip is shown: a scroll or a resize anywhere closes it. A scroll event is not
    // composed, so one of our own lists scrolling inside our shadow root never reaches the window:
    // the root gets a listener of its own.
    const onMove = (): void => this.close();
    const rootNode = anchor.getRootNode();
    const shadow = rootNode !== anchor.ownerDocument && 'host' in rootNode ? rootNode : null;
    view.addEventListener('scroll', onMove, { capture: true, passive: true });
    view.addEventListener('resize', onMove, { passive: true });
    shadow?.addEventListener('scroll', onMove, { capture: true, passive: true });
    this.detach = () => {
      view.removeEventListener('scroll', onMove, { capture: true });
      view.removeEventListener('resize', onMove);
      shadow?.removeEventListener('scroll', onMove, { capture: true });
    };
  }
}
