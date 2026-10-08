// The guard of every MAIN callback the page or the browser calls (architecture.md
// §5.3 «Правила MAIN-мира», decision X22). MAIN runs in the page's own world:
// an exception of ours that left a callback would land in ChatSpace's error
// handling — in 0.195.0 that is Sentry (global `error`/`unhandledrejection`
// handlers, wrapped timers and listeners), with frames of our script — and
// where ChatSpace calls us inside its own work (a store, a store action, a
// route change, an editor transaction) it would stop that work. So:
// - such a callback goes through `guard(site, fn)`: a failure of ours never
//   leaves it and never reaches the console; it is counted by site;
// - the bridge keeps the counts of both MAIN scripts (the tap script hands
//   its failures over through the live port) and sends a site's count to the
//   isolated side — the `fault` event — when it reaches 1, 2, 4, 8…: a
//   callback that fails on every frame reports a handful of times, never once
//   per call; the isolated side logs it;
// - only our own code is guarded. A function of ChatSpace's or of the browser
//   that a call passes through (the page's `fetch` behind the receipt
//   observer, the WebSocket constructor behind the tap) is never inside a
//   guard: its errors reach ChatSpace exactly as they would without us.
// `pnpm gates` checks that a callback handed to the page or the browser is a
// `guard(…)` (tools/gates, `main-world-guard`).

/** Wraps a callback the page or the browser will call: it never throws; a failure is counted by `site`. */
export type Guard = <A extends unknown[]>(site: string, fn: (...args: A) => unknown) => (...args: A) => void;

/** A guard whose failures go to `fail` (which must not throw itself). */
export const guardWith =
  (fail: (site: string) => void): Guard =>
  (site, fn) =>
  (...args) => {
    try {
      fn(...args);
    } catch {
      fail(site);
    }
  };

/** Counts failures by site; `report(site, count)` hears a site's count when it reaches 1, 2, 4, 8…; a failing report is dropped. */
export const faultCounter = (report: (site: string, count: number) => void): ((site: string) => void) => {
  const counts: Record<string, number> = {};
  return (site) => {
    const count = (counts[site] = (counts[site] ?? 0) + 1);
    if (count & (count - 1)) return;
    try {
      report(site, count);
    } catch {
      // Nothing more can be said: the count stays for the next report.
    }
  };
};
