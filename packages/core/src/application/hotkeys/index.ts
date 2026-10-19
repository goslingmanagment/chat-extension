// core/application/hotkeys — the tab's keys at work (architecture.md §9.1):
// the early dispatcher for the isolated world at document_start and the
// runner that turns its commands into UiActions.
//
// Wiring for the integrator (tab composition root):
// 1. At document_start, synchronously, before anything else of the page runs:
//      overlays = createOverlayState();
//      keyState = createTabKeyState({ overlays, route: () => routeOfLocation(win.location) });
//      dispatcher = createEarlyKeyDispatcher({ platform: hotkeyPlatformOf(navigator.platform), client: adapter.hotkeyClient,
//        window: win, document: { source: doc, hidden: () => doc.hidden },
//        ownership: createKeyboardProbe(doc, started.mounts.registry),   // @cg/host-chatspace/isolated
//        state: keyState, timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: clearTimeout },
//        now: Date.now, perfNow: () => performance.now(), onEarly: early.onEarly });
//      // early = createEarlyNotices({ onWaiting: createKeyPendingMark(started.mounts.dock.host) })
//      mirror = mirrorDismissible(overlays, started.mounts.setDismissibleOpen);
// 2. When the lazy part is up (AppClient router, toasts):
//      runner = createHotkeyRunner({ client, catalog, i18n, toasts, overlays, cause,
//        onDockSheet: (open) => { keyState.setDockSheet(open); mirror.dockSheet(open); },
//        onFix: (fix) => keyState.setFix(fix) });
//      early.attach({ toasts, refuse: (command, refusal) => runner.refuse(command, refusal) });
//      dispatcher.connect(runner);
//    A key kept from before the lazy part — and a key of the dock pressed before the dock has its
//    first state — waits for that state (HK-025): «Загрузка…» is on screen from `attach` until the
//    key runs or is dropped, and the dock host carries `data-pending` from the keydown on.
// 3. Whoever mounts an overlay calls overlays.set(surface, open) (the palette,
//    the quick jump and the cheatsheet are set by R17's own controllers).

export {
  KEPT_KEY_TTL_MS,
  QUICK_JUMP_HOLD_MS,
  createEarlyKeyDispatcher,
  type DispatcherState,
  type DispatcherStats,
  type DispatcherTimers,
  type EarlyKeyDispatcher,
  type EarlyKeyDispatcherOptions,
  type EarlyNotice,
  type EventSourceLike,
  type HotkeySink,
  type KeptKeyDrop,
  type KeyEventLike,
  type KeyOwnership,
} from './dispatcher';
export { createEarlyNotices, type EarlyNoticePresenter, type EarlyNotices, type EarlyNoticesOptions } from './notices';
export { createHotkeyRunner, nextTone, type HotkeyRunner, type HotkeyRunnerDeps } from './runner';
export { createTabKeyState, type TabKeyState, type TabKeyStateOptions } from './state';
