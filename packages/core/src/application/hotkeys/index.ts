// core/application/hotkeys — the tab's keys at work (architecture.md §9.1):
// the early dispatcher for the isolated world at document_start and the
// runner that turns its commands into UiActions.
//
// Wiring for the integrator (tab composition root):
// 1. At document_start, synchronously, before anything else of the page runs:
//      overlays = createOverlayState();
//      keyState = createTabKeyState({ overlays, route: () => routeOfLocation(win.location) });
//      dispatcher = createEarlyKeyDispatcher({ platform: hotkeyPlatformOf(navigator.platform),
//        window: win, document: { source: doc, hidden: () => doc.hidden },
//        ownership: createKeyboardProbe(doc, started.mounts.registry),   // @cg/host-chatspace/isolated
//        state: keyState, timers: { setTimer: (ms, fn) => setTimeout(fn, ms), clearTimer: clearTimeout },
//        now: Date.now, perfNow: () => performance.now(), onEarly: early.onEarly });   // early = createEarlyNotices()
//      mirror = mirrorDismissible(overlays, started.mounts.setDismissibleOpen);
// 2. When the lazy part is up (AppClient router, toasts):
//      runner = createHotkeyRunner({ client, catalog, i18n, toasts, overlays, cause,
//        onDockSheet: (open) => { keyState.setDockSheet(open); mirror.dockSheet(open); } });
//      early.attach({ toasts, refuse: (command, refusal) => runner.refuse(command, refusal) });
//      dispatcher.connect(runner); early.settled();
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
  type KeyEventLike,
  type KeyOwnership,
} from './dispatcher';
export { createEarlyNotices, type EarlyNoticePresenter, type EarlyNotices } from './notices';
export { createHotkeyRunner, nextTone, type HotkeyRunner, type HotkeyRunnerDeps } from './runner';
export { createTabKeyState, type TabKeyState, type TabKeyStateOptions } from './state';
