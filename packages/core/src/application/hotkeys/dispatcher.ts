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
// Until the lazy part of the tab is connected (`connect`) and has the first
// authoritative state of the chat (`HotkeySink.ready`), a claimed key is kept
// — the newest one only — and runs once both are there, if the chat is still
// the same one and the key is not too old (HK-024, HK-025). A cold-start ⌘E
// becomes Reply, not a «чат ещё загружается» toast.
//
// What is known of a held modifier is only what the keyboard said while the
// page had the focus (HK-022). A keyup is lost whenever the focus is
// elsewhere when the key goes up — ⌘-Tab, a click into another app, the
// browser's own panels, the system taking the key. So the state is dropped
// on every way the focus can leave AND when it comes back (window blur and
// focus, a hidden tab, pagehide): nothing that was «held» before counts
// after, only a fresh trusted keydown does. The quick-jump popup, which is
// alive only while Alt (⌥) is held (decision X45: its digits are Alt+1–9;
// ⌘/Ctrl+1–9 are Firefox's tab keys), is never armed or opened in a document
// that is hidden or has no focus, and while it is armed or open the pointer
// is listened to: a trusted mouse move that says the modifier is up ends it
// (the keyup went to the system, not to the page). The keyup of Alt that
// closes an open popup is the page's: Firefox on Windows would otherwise take
// a lone Alt press for its menu bar and move the focus there.

import {
  createKeyResolver,
  decideKey,
  decideUnmatched,
  isComboLike,
  isImeKey,
  isJumpModifierKey,
  isModifierKey,
  type DispatcherCommandId,
  type FocusKind,
  type HotkeyClient,
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
  /** The focus is inside the dock's own root (decision X44: J, K and `]` do nothing there). Absent — never. */
  focusInDock?(): boolean;
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
  /** Alt (⌥) held alone for 400 ms: the quick-jump popup; false — the modifier went up. */
  quickJump(open: boolean): void;
  /**
   * HK-025: false while the tab's first authoritative state for this command
   * has not arrived (the dock of a chat that is still loading). The key is
   * then kept and runs when `onReady` fires. Omitted — always ready.
   */
  ready?(command: KeyCommand): boolean;
  /** Calls `listener` whenever `ready` may have turned true; returns the unsubscribe. */
  onReady?(listener: () => void): () => void;
}

export type KeptKeyDrop = 'route-changed' | 'expired' | 'replaced' | 'superseded';

export type EarlyNotice =
  /** The key is kept until the lazy part loads and has the chat's first state: show «загружается». */
  | { readonly kind: 'queued'; readonly command: DispatcherCommandId }
  /** The kept key went to the lazy part: nothing waits any more. */
  | { readonly kind: 'ran'; readonly command: DispatcherCommandId }
  /**
   * The kept key was dropped: the chat changed, it waited too long, a newer
   * key waits in its place (`replaced`: «загружается» stays), or a newer key
   * ran at once (`superseded`: nothing waits any more).
   */
  | { readonly kind: 'dropped'; readonly command: DispatcherCommandId; readonly why: KeptKeyDrop }
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
  /** The site's client of the vendored key scheme (`HostAdapter.hotkeyClient`): ChatSpace `extension`, Fansly `fansly`. */
  readonly client: HotkeyClient;
  /** `window`: keydown and keyup in capture, blur. */
  readonly window: EventSourceLike;
  /**
   * `document`: visibilitychange; `hidden()` reads `document.hidden`, `focused()` — `document.hasFocus()`
   * (omitted — taken for focused: a test that has no focus to speak of).
   */
  readonly document?: { readonly source: EventSourceLike; hidden(): boolean; focused?(): boolean };
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

/** Alt (⌥) held alone this long opens the quick jump (§9.1; X45 — until then ⌘/Ctrl). */
export const QUICK_JUMP_HOLD_MS = 400;
/** A kept key older than this is not run: the person has moved on. */
export const KEPT_KEY_TTL_MS = 5000;
/** `window` events after which nothing is known of the keyboard: the focus left, came back, or the page is put away. */
const FOCUS_EVENTS = ['blur', 'focus', 'pagehide'] as const;

interface KeptKey {
  readonly command: KeyCommand;
  readonly epoch: number | string;
  readonly at: number;
}

function asKeyEvent(value: unknown): KeyEventLike | null {
  if (value === null || typeof value !== 'object') return null;
  const event = value as Partial<KeyEventLike>;
  return typeof event.code === 'string' && typeof event.key === 'string' && typeof event.preventDefault === 'function' ? (value as KeyEventLike) : null;
}

export function createEarlyKeyDispatcher(options: EarlyKeyDispatcherOptions): EarlyKeyDispatcher {
  const { platform, ownership, state, timers } = options;
  const resolver = options.resolver ?? createKeyResolver(platform, options.client);
  const sampleEvery = Math.max(1, options.sampleEvery ?? 20);
  let sink: HotkeySink | null = null;
  let kept: KeptKey | null = null;
  /** While a connected sink is not ready for the kept key: the key's expiry and the sink's readiness subscription. */
  let keptTimer: unknown = null;
  let stopReady: (() => void) | null = null;
  let holdTimer: unknown = null;
  let quickJumpOpen = false;
  let disposed = false;
  const counters = { keydowns: 0, claimed: 0, isolated: 0, untrusted: 0, queued: 0, dropped: 0, maxHandlerMs: 0 };

  const stopWaiting = (): void => {
    if (keptTimer !== null) {
      timers.clearTimer(keptTimer);
      keptTimer = null;
    }
    if (stopReady !== null) {
      stopReady();
      stopReady = null;
    }
  };

  const drop = (why: KeptKeyDrop): void => {
    const dropped = kept;
    if (dropped === null) return;
    kept = null;
    stopWaiting();
    counters.dropped += 1;
    options.onEarly?.({ kind: 'dropped', command: dropped.command.id, why });
  };

  const handOver = (pending: KeptKey, to: HotkeySink): void => {
    kept = null;
    stopWaiting();
    options.onEarly?.({ kind: 'ran', command: pending.command.id });
    to.run(pending.command);
  };

  /** The kept key waited for the chat's first state as long as a key may: it runs if the state came at the last moment, else says why not. */
  const onKeptTimeout = (): void => {
    keptTimer = null;
    const pending = kept;
    const to = sink;
    if (pending === null || to === null) return;
    if (state.route().epoch !== pending.epoch) return drop('route-changed');
    if (to.ready?.(pending.command) !== false) return handOver(pending, to);
    drop('expired');
    // The person is still in that chat and nothing happened: the reason, not silence (HK-026).
    to.refuse(pending.command.id, 'chat-loading');
  };

  /**
   * HK-025: the kept key goes to the lazy part only in the chat it was
   * pressed in, only while fresh, and only once the part has the chat's first
   * state — until then it waits, bounded by what is left of its freshness.
   */
  const settleKept = (): void => {
    const pending = kept;
    const to = sink;
    if (pending === null || to === null) return;
    if (state.route().epoch !== pending.epoch) return drop('route-changed');
    const left = KEPT_KEY_TTL_MS - (options.now() - pending.at);
    if (left < 0) return drop('expired');
    if (to.ready?.(pending.command) === false) {
      stopReady ??= to.onReady?.(settleKept) ?? null;
      keptTimer ??= timers.setTimer(left, onKeptTimeout);
      return;
    }
    handOver(pending, to);
  };

  const run = (command: KeyCommand): void => {
    // HK-024: the newest key only — an older one still waiting is no longer what the person wants.
    if (sink !== null && sink.ready?.(command) !== false) {
      drop('superseded');
      sink.run(command);
      return;
    }
    drop('replaced');
    kept = { command, epoch: state.route().epoch, at: options.now() };
    counters.queued += 1;
    options.onEarly?.({ kind: 'queued', command: command.id });
    settleKept();
  };

  /** The page is not where the person's keys go: the tab is hidden, or the focus is in another window, app or the browser's own UI. */
  const away = (): boolean => options.document?.hidden() === true || options.document?.focused?.() === false;

  /**
   * A keyup the system took (the app switcher, a system shortcut) never reaches the page, and nothing else says
   * the modifier went up — except the pointer: every mouse event carries the modifiers as they are. Listened to
   * only while a hold is armed or the popup is open.
   */
  let watching = false;
  const onPointer: Listener = (raw) => {
    const event = raw as { readonly isTrusted?: unknown; readonly altKey?: unknown } | null;
    if (event === null || typeof event !== 'object' || event.isTrusted !== true) return;
    if (event.altKey === false) reset();
  };
  const watchPointer = (): void => {
    const wanted = !disposed && (holdTimer !== null || quickJumpOpen);
    if (wanted === watching) return;
    watching = wanted;
    if (wanted) options.window.addEventListener('mousemove', onPointer, { capture: true });
    else options.window.removeEventListener('mousemove', onPointer, { capture: true });
  };

  const cancelHold = (): void => {
    if (holdTimer !== null) {
      timers.clearTimer(holdTimer);
      holdTimer = null;
    }
    watchPointer();
  };

  const closeQuickJump = (): void => {
    cancelHold();
    if (!quickJumpOpen) return;
    quickJumpOpen = false;
    watchPointer();
    sink?.quickJump(false);
  };

  const contextOf = (event: KeyEventLike, focus: FocusKind = ownership.focus(event)): KeyContext => ({
    composing: isImeKey(event),
    nativeModal: ownership.nativeModalOpen(),
    focus,
    route: state.route().kind,
    // The quick-jump popup is the dispatcher's own, alive only while Alt is held: it never takes a key.
    overlays: state.overlays().filter((overlay) => overlay !== 'quick-jump'),
    dockSheet: state.dockSheet(),
    combo: isComboLike(event),
    inDock: ownership.focusInDock?.() ?? false,
  });

  /** Alt went down alone, outside any field, with the chat list on screen: the quick jump may open. */
  const armQuickJump = (event: KeyEventLike): void => {
    // Windows repeats a held modifier as keydowns (from 250 ms on, at its shortest delay): the hold goes on, nothing restarts.
    if (event.repeat === true) return;
    cancelHold();
    if (sink === null || quickJumpOpen || !resolver.jumpHeldAlone()) return;
    // Cheapest checks first: in a field Option types characters on macOS.
    const focus = ownership.focus(event);
    if (focus === 'composer' || focus === 'field' || focus === 'ours-field') return;
    if (state.route().kind === 'other' || state.overlays().length > 0 || ownership.nativeModalOpen()) return;
    // A key that reached a page without the focus has no keyup to wait for.
    if (away()) return;
    holdTimer = timers.setTimer(QUICK_JUMP_HOLD_MS, () => {
      holdTimer = null;
      // The hold is judged again when its time comes: the focus may have left without a word (no blur was heard).
      if (!disposed && sink !== null && resolver.jumpHeldAlone() && !away()) {
        quickJumpOpen = true;
        sink.quickJump(true);
      }
      watchPointer();
    });
    watchPointer();
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
      if (isJumpModifierKey(event)) armQuickJump(event);
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
      const underPopup = slotKey && quickJumpOpen;
      run(decision.run);
      // The digit ran against the popup as the person saw it; only then the popup goes.
      if (underPopup) {
        quickJumpOpen = false;
        watchPointer();
        sink?.quickJump(false);
      }
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
    if (!isJumpModifierKey(event)) return;
    // The lone Alt that held the popup open is ours: Firefox on Windows would put the focus into its menu bar.
    if (quickJumpOpen) event.preventDefault();
    closeQuickJump();
  };

  /**
   * HK-022: a modifier held across a blur or a hidden tab is an unknown state — and so is one that was «held»
   * when the focus comes back: its keyup may have gone anywhere meanwhile. Whatever was armed or open ends.
   */
  function reset(): void {
    resolver.reset();
    closeQuickJump();
  }
  const onFocusChange: Listener = () => reset();
  const onVisibility: Listener = () => {
    if (options.document?.hidden() === true) reset();
  };

  options.window.addEventListener('keydown', onKeydown, { capture: true });
  options.window.addEventListener('keyup', onKeyup, { capture: true });
  for (const type of FOCUS_EVENTS) options.window.addEventListener(type, onFocusChange);
  options.document?.source.addEventListener('visibilitychange', onVisibility);

  return {
    connect(next) {
      stopWaiting();
      sink = next;
      settleKept();
    },
    disconnect() {
      closeQuickJump();
      // A key still waiting stays kept for the next connect; its freshness is judged again there.
      stopWaiting();
      sink = null;
    },
    stats: () => ({ ...counters }),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelHold();
      stopWaiting();
      sink = null;
      kept = null;
      options.window.removeEventListener('keydown', onKeydown, { capture: true });
      options.window.removeEventListener('keyup', onKeyup, { capture: true });
      for (const type of FOCUS_EVENTS) options.window.removeEventListener(type, onFocusChange);
      options.document?.source.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
