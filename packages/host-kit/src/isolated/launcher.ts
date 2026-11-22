// The launcher of a site's page, its early half (decision X46; ui-design §3.13; SP-001, NF-001): what the person asked
// of it — «Онлайн», «Очереди», Spenders or «Новые» — between the click and the application that opens the window. The
// old Fansly extension had «$» and «Новые» in the bottom left corner of every fansly.com page (`fansly-chat`
// src/content/spenders/board-launcher.ts, bootstrap.ts): one click, while outside a chat the new one had only the
// popup — two. Fansly draws it as a card in that corner, ChatSpace as a column of icons at the bottom of its account
// rail (2026-11-15): the same buttons, the same asks, the same order (`LAUNCHER_TARGETS`). The buttons themselves are a
// chunk of the site's own lazy build (launcher-view.ts), drawn once the tab may show them (each site's starter); this
// file is what the early bundle carries of them: a few lines, no DOM.
//
// - A click before the application is loaded is kept (the newest wins) and the application is wanted — the starter's
//   `wantsApp` says so, and the runtime loads it as for the dock's place. The application's half of the site's adapter
//   then `serve`s the launcher: the kept ask runs at once, every later click runs in its own click, so the tab's action
//   gate sees the person's trusted click through our closed root as with any button of ours.
// - Every ask is said again to whoever wants the application: an application whose load failed is asked for again by
//   the next click (nothing reloads by itself, UP-016).

import type { HostTheme } from '@cg/contracts/host';
import type { ColorScheme, ValueSignal } from '@cg/contracts/vm';

/**
 * What the launcher opens, top to bottom as the dock's chips stand (2026-10-27: a column, «Онлайн» added; 2026-11-02:
 * «Очереди»): the shared surfaces of the boards. The one list of both sites: a board added here is a button on Fansly's
 * card and on ChatSpace's rail, and its face (launcher-view.ts `LAUNCHER_FACES`) is then required by the compiler.
 * `customs` («Кастомы», Workboard's customs screen in the frame) comes last, under the fifth row «Отчёт», for everyone.
 */
export const LAUNCHER_TARGETS = ['online', 'queues', 'spenders', 'newcomers', 'report', 'customs'] as const;

export type LauncherTarget = (typeof LAUNCHER_TARGETS)[number];
/** The boards that are windows of ours (`Navigate` to the surface); `report` and `customs` are Workboard's in the frame. */
export type LauncherBoard = Exclude<LauncherTarget, 'report' | 'customs'>;

/**
 * The fifth row, «Отчёт» (hub package R, 2026-11-15): drawn only for a person whose pulse has a board (`report` not
 * null), with a dot while the report waits for them. null — no row at all: everyone else sees the four rows unchanged.
 */
export interface LauncherReport {
  readonly needsMe: boolean;
}

export interface SiteLauncher {
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
   * buttons are the dock's chips in every theme; until the application came (the dock's place or the first click) —
   * the page's own, as «Тема» says by default («как на сайте»).
   */
  scheme(): ColorScheme;
  onScheme(listener: () => void): () => void;
  /** The application hands its scheme; the answer stops following it. */
  follow(scheme: ValueSignal<ColorScheme>): () => void;
  /** The fifth row as the pulse says it (the tab's runtime hands it in); null — not drawn. */
  report(): LauncherReport | null;
  setReport(report: LauncherReport | null): void;
  onReport(listener: () => void): () => void;
  /**
   * How far the card stands above its place (px): the bar of the board «Отчёт» takes the bottom 44 px of the site, and
   * Fansly's corner card rises over it (the prototype's `.ln` at 58 px). 0 — its own place.
   */
  lift(): number;
  setLift(px: number): void;
}

/** The page's theme as the site's early bundle reads it. */
export type LauncherPageTheme = { current(): HostTheme; onChange(listener: (theme: HostTheme) => void): () => void };

export function createSiteLauncher(page: LauncherPageTheme): SiteLauncher {
  let kept: LauncherTarget | null = null;
  /** The application's scheme; null — not handed yet, the page's is worn. */
  let scheme: ColorScheme | null = null;
  const schemeListeners = new Set<() => void>();
  let asked = false;
  let runner: ((target: LauncherTarget) => void) | null = null;
  const wantedListeners = new Set<() => void>();
  let report: LauncherReport | null = null;
  let lift = 0;
  const reportListeners = new Set<() => void>();
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
    scheme: () => scheme ?? page.current().scheme,
    onScheme(listener) {
      const offPage = page.onChange(() => {
        if (scheme === null) listener();
      });
      const off = listen(schemeListeners, listener);
      return () => {
        offPage();
        off();
      };
    },
    follow(signal) {
      const take = (value: ColorScheme): void => {
        if (value === scheme) return;
        scheme = value;
        say(schemeListeners);
      };
      take(signal.value);
      return signal.subscribe(take);
    },
    report: () => report,
    setReport(next) {
      if (next === report || (next !== null && report !== null && next.needsMe === report.needsMe)) return;
      report = next === null ? null : { needsMe: next.needsMe };
      say(reportListeners);
    },
    onReport: (listener) => listen(reportListeners, listener),
    lift: () => lift,
    setLift(px) {
      if (px === lift) return;
      lift = px;
      say(reportListeners);
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
