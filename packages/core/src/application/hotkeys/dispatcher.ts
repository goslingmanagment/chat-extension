// The one early key dispatcher of a tab (architecture.md §9.1, D-18; HK-022…
// HK-029): `keydown`/`keyup` in capture on `window`, registered at
// document_start in the isolated world — before ChatSpace's own global
// listener (it registers when its layout mounts) and before the composer's
// listeners (they sit on descendants). For a key of ours it calls
// preventDefault and stopImmediatePropagation in the same synchronous step,
// so TipTap never toggles italic or inline code, the translator never
// flips, the browser never prints. A key that is not ours is not touched.
//
// core has no DOM: the window, the focus probe and the clock come in as
// ports with structural shapes (`window` and R09's shadow-root registry fit
// them as they are; `@cg/host-chatspace/isolated` `createKeyboardProbe` is
// the probe for ChatSpace).
//
// Until the lazy part of the tab is connected (`connect`), a claimed key is
// kept — the newest one only — and runs when the sink arrives, if the chat is
// still the same one and the key is not too old (HK-024, HK-025).

import {
  createKeyResolver,
  decideKey,
  decideUnmatched,
  isComboLike,
  isImeKey,
  isModifierKey,
  isPrimaryModifierKey,
  type DispatcherCommandId,
  type FocusKind,
  type HotkeyKeyEvent,
  type HotkeyPlatform,
  type KeyCommand,
  type KeyContext,
  type KeyRefusal,
  type KeyResolver,
  type OverlayKind,
  type RouteKind,
} from '../../domain/hotkeys';

/** The part of a DOM KeyboardEvent the dispatcher reads and calls. */
export interface KeyEventLike extends HotkeyKeyEvent {
  readonly isTrusted: boolean;
  readonly keyCode?: number;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

type Listener = (event: unknown) => void;

/** `window` (or `document` for visibility), as far as the dispatcher needs it. */
export interface EventSourceLike {
  addEventListener(type: string, listener: Listener, options?: boolean | { readonly capture?: boolean }): void;
  removeEventListener(type: string, listener: Listener, options?: boolean | { readonly capture?: boolean }): void;
}

/**
 * Who owns the focus, read in one synchronous look (§9.1 «Кому принадлежит
 * клавиша»): `activeElement` of our closed roots through R09's registry; the
 * event's composed path only tells that it came through one of our hosts.
 */
export interface KeyOwnership {
  focus(event: unknown): FocusKind;
  /** A modal window of the host itself is open. */
  nativeModalOpen(): boolean;
  /**
   * Hands the key to the focused element inside our closed root and never
   * past it; true when our UI took it (called preventDefault).
   */
  deliver(event: unknown): boolean;
}

/** What the tab knows right now; every getter is synchronous and cheap. */
export interface DispatcherState {
  /** `epoch` changes with every route change: a kept key runs only in the chat it was pressed in. */
  route(): { readonly kind: RouteKind; readonly epoch: number | string };
  /** Our open overlays, bottom first. */
  overlays(): readonly OverlayKind[];
  /** A result, Recap or Review is open in the dock. */
  dockSheet(): boolean;
}

export interface DispatcherTimers {
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(handle: unknown): void;
}

/** Where commands go once the lazy part of the tab is loaded. */
export interface HotkeySink {
  run(command: KeyCommand): void;
  /** A claimed key that runs nothing, with the reason to show (HK-026, HK-027). */
  refuse(command: DispatcherCommandId, refusal: KeyRefusal): void;
  /** ⌘/Ctrl held alone for 400 ms: the quick-jump popup; false — the modifier went up. */
  quickJump(open: boolean): void;
}

export type EarlyNotice =
  /** The key is kept until the lazy part loads: show «загружается». */
  | { readonly kind: 'queued'; readonly command: DispatcherCommandId }
  /** The kept key was dropped: the chat changed or it waited too long. */
  | { readonly kind: 'dropped'; readonly command: DispatcherCommandId; readonly why: 'route-changed' | 'expired' | 'replaced' }
  /** A claimed key that runs nothing, pressed before the lazy part loaded: the reason to show once something can show it. */
  | { readonly kind: 'refused'; readonly command: DispatcherCommandId; readonly refusal: KeyRefusal };

export interface DispatcherStats {
  readonly keydowns: number;
  readonly claimed: number;
  readonly isolated: number;
  readonly untrusted: number;
  readonly queued: number;
  readonly dropped: number;
  /** The slowest synchronous handler seen, ms (§11: ≤ 2 ms). */
  readonly maxHandlerMs: number;
}

export interface EarlyKeyDispatcherOptions {
  readonly platform: HotkeyPlatform;
  /** `window`: keydown and keyup in capture, blur. */
  readonly window: EventSourceLike;
  /** `document`: visibilitychange; `hidden()` reads `document.hidden`. */
  readonly document?: { readonly source: EventSourceLike; hidden(): boolean };
  readonly ownership: KeyOwnership;
  readonly state: DispatcherState;
  readonly timers: DispatcherTimers;
  /** Epoch ms; for the age of a kept key. */
  readonly now: () => number;
  /** High-resolution clock for the handler budget (§11); omitted — not measured. */
  readonly perfNow?: () => number;
  /** One handler in `sampleEvery` is reported (§9.6: 1 of 20). */
  readonly onHandlerMs?: (ms: number) => void;
  readonly sampleEvery?: number;
  readonly onEarly?: (notice: EarlyNotice) => void;
  readonly resolver?: KeyResolver;
}

export interface EarlyKeyDispatcher {
  /** The lazy part arrived: commands run from now on, the kept key first. */
  connect(sink: HotkeySink): void;
  disconnect(): void;
  stats(): DispatcherStats;
  dispose(): void;
}

/** ⌘/Ctrl held alone this long opens the quick jump (§9.1). */
export const QUICK_JUMP_HOLD_MS = 400;
/** A key kept for the lazy part older than this is not run: the person has moved on. */
export const KEPT_KEY_TTL_MS = 5000;

function asKeyEvent(value: unknown): KeyEventLike | null {
  if (value === null || typeof value !== 'object') return null;
  const event = value as Partial<KeyEventLike>;
  return typeof event.code === 'string' && typeof event.key === 'string' && typeof event.preventDefault === 'function' ? (value as KeyEventLike) : null;
}

export function createEarlyKeyDispatcher(options: EarlyKeyDispatcherOptions): EarlyKeyDispatcher {
  const { platform, ownership, state, timers } = options;
  const resolver = options.resolver ?? createKeyResolver(platform);
  const sampleEvery = Math.max(1, options.sampleEvery ?? 20);
  let sink: HotkeySink | null = null;
  let kept: { readonly command: KeyCommand; readonly epoch: number | string; readonly at: number } | null = null;
  let holdTimer: unknown = null;
  let quickJumpOpen = false;
  let disposed = false;
  const counters = { keydowns: 0, claimed: 0, isolated: 0, untrusted: 0, queued: 0, dropped: 0, maxHandlerMs: 0 };

  const drop = (why: 'route-changed' | 'expired' | 'replaced'): void => {
    if (kept === null) return;
    counters.dropped += 1;
    options.onEarly?.({ kind: 'dropped', command: kept.command.id, why });
    kept = null;
  };

  const run = (command: KeyCommand): void => {
    if (sink !== null) {
      sink.run(command);
      return;
    }
    // HK-024: the newest key only — an older one is no longer what the person wants.
    drop('replaced');
    kept = { command, epoch: state.route().epoch, at: options.now() };
    counters.queued += 1;
    options.onEarly?.({ kind: 'queued', command: command.id });
  };

  const cancelHold = (): void => {
    if (holdTimer !== null) {
      timers.clearTimer(holdTimer);
      holdTimer = null;
    }
  };

  const closeQuickJump = (): void => {
    cancelHold();
    if (!quickJumpOpen) return;
    quickJumpOpen = false;
    sink?.quickJump(false);
  };

  const contextOf = (event: KeyEventLike, focus: FocusKind = ownership.focus(event)): KeyContext => ({
    composing: isImeKey(event),
    nativeModal: ownership.nativeModalOpen(),
    focus,
    route: state.route().kind,
    // The quick-jump popup is the dispatcher's own, alive only while ⌘/Ctrl is held: it never takes a key.
    overlays: state.overlays().filter((overlay) => overlay !== 'quick-jump'),
    dockSheet: state.dockSheet(),
    combo: isComboLike(event),
  });

  /** ⌘/Ctrl went down alone, outside any field, with the chat list on screen: the quick jump may open. */
  const armQuickJump = (event: KeyEventLike): void => {
    // Windows repeats a held Ctrl as keydowns (from 250 ms on, at its shortest delay): the hold goes on, nothing restarts.
    if (event.repeat === true) return;
    cancelHold();
    if (sink === null || quickJumpOpen || !resolver.primaryHeldAlone()) return;
    // Cheapest checks first: ⌘/Ctrl goes down in the composer with every ⌘V.
    const focus = ownership.focus(event);
    if (focus === 'composer' || focus === 'field' || focus === 'ours-field') return;
    if (state.route().kind === 'other' || state.overlays().length > 0 || ownership.nativeModalOpen()) return;
    holdTimer = timers.setTimer(QUICK_JUMP_HOLD_MS, () => {
      holdTimer = null;
      if (disposed || sink === null || !resolver.primaryHeldAlone()) return;
      quickJumpOpen = true;
      sink.quickJump(true);
    });
  };

  const handleKeydown = (event: KeyEventLike): void => {
    counters.keydowns += 1;
    // A synthetic event of the page never starts anything of ours and never moves the engine's state (§14).
    if (!event.isTrusted) {
      counters.untrusted += 1;
      return;
    }
    const verdict = resolver.keydown(event);
    if (isModifierKey(event)) {
      if (isPrimaryModifierKey(event, platform)) armQuickJump(event);
      else closeQuickJump();
      return;
    }
    const slotKey = verdict !== null && verdict.kind === 'command' && verdict.command === 'quick-jump';
    // Any other key ends the lone hold; a digit keeps the popup's own closing to the navigation.
    if (!slotKey) closeQuickJump();
    else cancelHold();

    if (isImeKey(event)) return;
    // Plain typing that matched nothing: no look at the page at all.
    if (verdict === null && !isComboLike(event)) return;
    const focus = ownership.focus(event);
    // A key of nobody's outside our UI (arrows, Backspace, ⌘C in the composer): one focus read, nothing else.
    const decision = verdict === null ? decideUnmatched({ composing: false, focus, combo: true }) : decideKey(verdict, contextOf(event, focus));
    if (decision.act === 'pass') return;

    if (decision.act === 'isolate') {
      counters.isolated += 1;
      event.stopImmediatePropagation();
      if (ownership.deliver(event)) {
        event.preventDefault();
        return;
      }
      if (decision.otherwise !== null) {
        event.preventDefault();
        run(decision.otherwise);
      }
      return;
    }

    counters.claimed += 1;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (decision.run !== null) {
      if (slotKey && quickJumpOpen) {
        quickJumpOpen = false;
        sink?.quickJump(false);
      }
      run(decision.run);
    } else if (decision.refusal !== null && decision.command !== null) {
      if (sink !== null) sink.refuse(decision.command, decision.refusal);
      else options.onEarly?.({ kind: 'refused', command: decision.command, refusal: decision.refusal });
    }
  };

  let handled = 0;
  const onKeydown: Listener = (raw) => {
    const event = asKeyEvent(raw);
    if (event === null || disposed) return;
    const started = options.perfNow?.();
    handleKeydown(event);
    if (started === undefined || options.perfNow === undefined) return;
    const ms = options.perfNow() - started;
    if (ms > counters.maxHandlerMs) counters.maxHandlerMs = ms;
    handled += 1;
    if (handled % sampleEvery === 0) options.onHandlerMs?.(ms);
  };

  const onKeyup: Listener = (raw) => {
    const event = asKeyEvent(raw);
    if (event === null || disposed || !event.isTrusted) return;
    resolver.keyup(event);
    if (isPrimaryModifierKey(event, platform)) closeQuickJump();
  };

  /** HK-022: a modifier held across a blur or a hidden tab is an unknown state. */
  const reset = (): void => {
    resolver.reset();
    closeQuickJump();
  };
  const onBlur: Listener = () => reset();
  const onVisibility: Listener = () => {
    if (options.document?.hidden() === true) reset();
  };

  options.window.addEventListener('keydown', onKeydown, { capture: true });
  options.window.addEventListener('keyup', onKeyup, { capture: true });
  options.window.addEventListener('blur', onBlur);
  options.document?.source.addEventListener('visibilitychange', onVisibility);

  return {
    connect(next) {
      sink = next;
      const pending = kept;
      kept = null;
      if (pending === null) return;
      // HK-025: only in the chat it was pressed in, and only while it is still fresh.
      if (state.route().epoch !== pending.epoch) {
        kept = pending;
        drop('route-changed');
        return;
      }
      if (options.now() - pending.at > KEPT_KEY_TTL_MS) {
        kept = pending;
        drop('expired');
        return;
      }
      next.run(pending.command);
    },
    disconnect() {
      closeQuickJump();
      sink = null;
    },
    stats: () => ({ ...counters }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelHold();
      sink = null;
      kept = null;
      options.window.removeEventListener('keydown', onKeydown, { capture: true });
      options.window.removeEventListener('keyup', onKeyup, { capture: true });
      options.window.removeEventListener('blur', onBlur);
      options.document?.source.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
