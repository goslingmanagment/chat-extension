// e2e diagnostics — compiled into CG_TEST_HOSTS builds only (the composition
// root passes the probe only under the compile-time constant, so the release
// bundle drops it; `pnpm gates` checks the marker), and active only on the
// loopback stand. Writes a JSON report to <html data-cg-spike> for the e2e:
// WebDriver cannot look inside our closed shadow roots or our sandbox, so the
// extension reports for itself — which start ran, what the bridge and the
// background answered, and what the dock actually shows.

/** Same key as build/bundle-timing.ts (the marks around this bundle, test builds only). */
const BUNDLE_MARKS_KEY = '__cgBundleMarks';

export interface TabProbe {
  set(key: string, value: unknown): void;
  /** composeTab's own synchronous time; the bundle-wide number follows a task later. */
  bootstrapped(composeMs: number): void;
}

interface BundleMarks {
  readonly t0?: number;
  readonly t1?: number;
}

/**
 * The probe of a tab — on the loopback stand only. A test build also runs on
 * the real ChatSpace (`pnpm dev`, X9), and there nothing of ours is written
 * where the page can read it: no report attribute, no login, no page label.
 */
export function tabProbeFor(win: Window): TabProbe | null {
  return /^(?:127\.0\.0\.1|localhost)$/.test(win.location.hostname) ? createTabProbe(win) : null;
}

export function createTabProbe(win: Window): TabProbe {
  const doc = win.document;
  const html = doc.documentElement;
  const startedAt = performance.now();
  const state: Record<string, unknown> = { startedAt, readyStateAtStart: doc.readyState };
  const flush = (): void => html.setAttribute('data-cg-spike', JSON.stringify(state));
  const set = (key: string, value: unknown): void => {
    state[key] = value;
    flush();
  };
  flush();
  return {
    set,
    bootstrapped(composeMs) {
      // The bundle's last statement (t1) runs after main() returns: read it a task later.
      setTimeout(() => {
        const marks = Reflect.get(globalThis, BUNDLE_MARKS_KEY) as BundleMarks | undefined;
        const bundleMs = marks?.t0 !== undefined && marks.t1 !== undefined ? marks.t1 - marks.t0 : null;
        // From the bundle's first statement to composeTab: module evaluation and WXT's own start.
        const evalMs = marks?.t0 !== undefined ? startedAt - marks.t0 : null;
        set('bootstrap', { composeMs, bundleMs, evalMs });
      }, 0);
    },
  };
}
