// The tab's keys from document_start (architecture.md §9.1; HK-022…HK-029):
// the one early dispatcher of R17 — `keydown`/`keyup` in capture on `window`,
// registered in the synchronous start of the isolated bundle, before
// ChatSpace's own listeners exist — over R09's registry of our closed roots,
// and the state it reads: our open overlays and the route.
//
// Until the lazy part of the tab is loaded there is nobody to run a command:
// the dispatcher keeps the newest key, the dock host carries
// `data-pending` (the only thing that can show a wait that early), and
// `onWaiting` tells the runtime to load the application now — also outside a
// chat, where no composer would ever ask for it (HK-024: ⌘K and ⌘⇧M work on
// the whole of ChatSpace).
//
// The action gate (action-gate.ts) lives in the lazy part and registers its
// own listeners late, after this dispatcher — which stops a key of ours
// before any later listener of `window` hears it. So this module hears every
// trusted keydown first and hands it on (`onKeydown`), and remembers the
// keydown of the key the dispatcher keeps: when that key runs at last, its
// event is long over, and still it is the person's own key (`takeKept`).
//
// A held Enter never crosses from our UI into ChatSpace. «Вставить» pressed
// with Enter puts the focus into ChatSpace's composer (UI-019), where Enter
// sends — and the key is still down: its auto-repeat would send a text that
// was only inserted (§14: nothing is sent without the person's own act). The
// repeats of an Enter that went down inside a root of ours are stopped
// wherever they land, until the key is released.

import { createEarlyKeyDispatcher, createEarlyNotices, createTabKeyState, type EarlyKeyDispatcher, type EarlyNotice, type EarlyNotices, type TabKeyState } from '@cg/core/application/hotkeys';
import { createOverlayState, mirrorDismissible, type OverlayState } from '@cg/core/application/navigation';
import { hotkeyPlatformOf, type HotkeyPlatform } from '@cg/core/domain/hotkeys';
import { createKeyPendingMark, createKeyboardProbe, routeOfLocation, type MountManager } from '@cg/host-chatspace/isolated';

/** The trusted keydown of a key the dispatcher kept, and when it was pressed (epoch ms). */
export interface KeptKeydown {
  readonly event: Event;
  readonly at: number;
}

export interface TabKeys {
  readonly platform: HotkeyPlatform;
  /** Which of our overlays are open: the dispatcher reads it, whoever mounts an overlay writes it. */
  readonly overlays: OverlayState;
  readonly state: TabKeyState;
  readonly dispatcher: EarlyKeyDispatcher;
  readonly notices: EarlyNotices;
  /** `data-dismissible-open` on the dock host while its sheet is open (the overlays are mirrored by themselves). */
  dockSheet(open: boolean): void;
  /** Every trusted keydown, before the dispatcher decides whose it is; null — nobody listens. */
  onKeydown(listener: ((event: Event) => void) | null): void;
  /** One handler in twenty, ms (§9.6: `handlerMs`); null — nobody measures. */
  onHandlerMs(listener: ((ms: number) => void) | null): void;
  /**
   * The keydown of the kept key the dispatcher hands over in this very step
   * (HK-024, HK-025); null — the command comes from a key still in flight.
   * Read once: the next call answers null.
   */
  takeKept(): KeptKeydown | null;
  dispose(): void;
}

export interface TabKeysEnv {
  readonly win: Window;
  readonly mounts: Pick<MountManager, 'dock' | 'registry' | 'setDismissibleOpen'>;
  /** A key waits for the lazy part: load it now. */
  readonly onWaiting: () => void;
}

export function startTabKeys(env: TabKeysEnv): TabKeys {
  const { win, mounts } = env;
  const doc = win.document;
  const platform = hotkeyPlatformOf(win.navigator.platform);

  // ── the keydown the gate needs, heard before the dispatcher stops it ───────
  let listener: ((event: Event) => void) | null = null;
  let last: Event | null = null;
  /** The Enter that is down now went down inside one of our roots. */
  let enterFromOurs = false;
  const isEnter = (event: Event): boolean => (event as Partial<KeyboardEvent>).key === 'Enter';
  const onKeydown = (event: Event): void => {
    if (!event.isTrusted) return;
    if (isEnter(event)) {
      const ours = mounts.registry.hostOf(event) !== null;
      if ((event as KeyboardEvent).repeat !== true) enterFromOurs = ours;
      else if (enterFromOurs && !ours) {
        // The repeat of our Enter landed in the page (the focus moved to the composer): nobody hears it.
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    last = event;
    listener?.(event);
  };
  const onKeyup = (event: Event): void => {
    if (event.isTrusted && isEnter(event)) enterFromOurs = false;
  };
  win.addEventListener('keydown', onKeydown, true);
  win.addEventListener('keyup', onKeyup, true);

  // ── the kept key ───────────────────────────────────────────────────────────
  let kept: KeptKeydown | null = null;
  let handed: KeptKeydown | null = null;
  const pending = createKeyPendingMark(mounts.dock.host);
  const notices = createEarlyNotices({
    onWaiting(waiting) {
      pending(waiting);
      if (waiting) env.onWaiting();
    },
  });
  const onEarly = (notice: EarlyNotice): void => {
    // `queued` comes from inside the keydown handler: `last` is that very keydown.
    if (notice.kind === 'queued') kept = last === null ? null : { event: last, at: Date.now() };
    // `ran` comes right before the sink's `run`, in the same step.
    else if (notice.kind === 'ran') {
      handed = kept;
      kept = null;
    } else if (notice.kind === 'dropped' && notice.why !== 'replaced') kept = null;
    notices.onEarly(notice);
  };

  const overlays = createOverlayState();
  const state = createTabKeyState({ overlays, route: () => routeOfLocation(win.location) });
  let handlerMs: ((ms: number) => void) | null = null;
  // Registered after `onKeydown` above, on the same target and phase: it runs second.
  const dispatcher = createEarlyKeyDispatcher({
    platform,
    window: win,
    document: { source: doc, hidden: () => doc.hidden, focused: () => doc.hasFocus() },
    ownership: createKeyboardProbe(doc, mounts.registry),
    state,
    timers: { setTimer: (ms, fn) => win.setTimeout(fn, ms), clearTimer: (handle) => win.clearTimeout(handle as number) },
    now: () => Date.now(),
    perfNow: () => performance.now(),
    onHandlerMs: (ms) => handlerMs?.(ms),
    onEarly,
  });
  const mirror = mirrorDismissible(overlays, (target, owner, open) => mounts.setDismissibleOpen(target, owner, open));

  return {
    platform,
    overlays,
    state,
    dispatcher,
    notices,
    dockSheet: (open) => mirror.dockSheet(open),
    onKeydown(next) {
      listener = next;
    },
    onHandlerMs(next) {
      handlerMs = next;
    },
    takeKept() {
      const event = handed;
      handed = null;
      return event;
    },
    dispose() {
      win.removeEventListener('keydown', onKeydown, true);
      win.removeEventListener('keyup', onKeyup, true);
      dispatcher.dispose();
      mirror.dispose();
      pending(false);
      listener = null;
      handlerMs = null;
      kept = null;
      handed = null;
      last = null;
    },
  };
}
