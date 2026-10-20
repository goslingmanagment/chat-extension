// The floating launcher of a Fansly page, its early half (decision X46; ui-design §3.13; SP-001, NF-001): what the
// person asked of it — Spenders or «Новые» — between the click and the application that opens the window. The old
// Fansly extension had «$» and «Новые» in the bottom left corner of every fansly.com page (`fansly-chat`
// src/content/spenders/board-launcher.ts, bootstrap.ts): one click, while outside a chat the new one had only the
// popup — two. The buttons themselves are a chunk of Fansly's own lazy build (launcher-view.ts), drawn once the tab is
// admitted (starter.ts); this file is what the early bundle carries of them: a few lines, no DOM.
//
// - A click before the application is loaded is kept (the newest wins) and the application is wanted — the starter's
//   `wantsApp` says so, and the runtime loads it as for the dock's place. The application's half of Fansly's adapter
//   then `serve`s the launcher: the kept ask runs at once, every later click runs in its own click, so the tab's action
//   gate sees the person's trusted click through our closed root as with any button of ours.
// - Every ask is said again to whoever wants the application: an application whose load failed is asked for again by
//   the next click (nothing reloads by itself, UP-016).

import type { ColorScheme, ValueSignal } from '@cg/contracts/vm';

/** What the launcher opens: the shared surfaces of the boards. */
export type LauncherTarget = 'spenders' | 'newcomers';

export interface FanslyLauncher {
  /** The person clicked one of the launcher's buttons. */
  ask(target: LauncherTarget): void;
  /** A click waits for the application: true from the first click on — the application stays once it came. */
  wanted(): boolean;
  /** Said on every click: the application is wanted (again). */
  onWanted(listener: () => void): () => void;
  /** The kept click, if one waits for the application; null — none. */
  pending(): LauncherTarget | null;
  /** Said whenever the kept click comes or goes (the buttons show the wait). */
  onPending(listener: () => void): () => void;
  /** The application's runner: a kept click runs at once, the next ones in their own click. The answer stops it. */
  serve(run: (target: LauncherTarget) => void): () => void;
  /**
   * The scheme the buttons wear: the one the application resolved from «Тема» for our surfaces (`follow`), so the
   * buttons are the dock's chips in every theme; null until the application came — the light paper, the default.
   */
  scheme(): ColorScheme | null;
  onScheme(listener: () => void): () => void;
  /** The application hands its scheme; the answer stops following it. */
  follow(scheme: ValueSignal<ColorScheme>): () => void;
}

export function createFanslyLauncher(): FanslyLauncher {
  let kept: LauncherTarget | null = null;
  let scheme: ColorScheme | null = null;
  const schemeListeners = new Set<() => void>();
  let asked = false;
  let runner: ((target: LauncherTarget) => void) | null = null;
  const wantedListeners = new Set<() => void>();
  const pendingListeners = new Set<() => void>();
  const say = (listeners: ReadonlySet<() => void>): void => {
    for (const listener of [...listeners]) listener();
  };
  const listen = (listeners: Set<() => void>, listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const keep = (next: LauncherTarget | null): void => {
    if (next === kept) return;
    kept = next;
    say(pendingListeners);
  };
  return {
    ask(target) {
      asked = true;
      if (runner !== null) runner(target);
      else {
        keep(target);
        say(wantedListeners);
      }
    },
    wanted: () => asked,
    onWanted: (listener) => listen(wantedListeners, listener),
    pending: () => kept,
    onPending: (listener) => listen(pendingListeners, listener),
    scheme: () => scheme,
    onScheme: (listener) => listen(schemeListeners, listener),
    follow(signal) {
      const take = (value: ColorScheme): void => {
        if (value === scheme) return;
        scheme = value;
        say(schemeListeners);
      };
      take(signal.value);
      return signal.subscribe(take);
    },
    serve(run) {
      runner = run;
      const waiting = kept;
      keep(null);
      if (waiting !== null) run(waiting);
      return () => {
        if (runner === run) runner = null;
      };
    },
  };
}
