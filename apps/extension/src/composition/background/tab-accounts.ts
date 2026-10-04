// Which ChatSpace accounts a tab shows is known to the background from the
// tab's own presence report (architecture.md §5.4 «Правила отправителей»:
// a tab may ask the hub's data only for the pages its accounts are bound
// to). That report leaves the tab a moment after its registration — the tab
// coalesces its reports (tab/runtime.ts) and ChatSpace has to load its
// accounts first — while the tab's application may already ask: a key of
// ours pressed while the page was still loading runs the instant the
// controllers are in (HK-024). A request that outruns the report is not
// «this page is not yours»; it waits for the report, for a bounded time.
//
// Nothing here decides a right: it only says when the accounts of a tab are
// known, so the one check (`pageOf`) is asked at the right moment.

/** How long a request waits for the tab's first report of its accounts. */
export const TAB_ACCOUNTS_WAIT_MS = 3000;

export interface TabAccountsGate {
  /** The tab's presence report with its accounts was recorded (the list of seen accounts included). */
  reported(tabSessionId: string): void;
  /** The tab's port closed: whoever waits for it stops waiting. */
  gone(tabSessionId: string): void;
  /** The tab has said which accounts it shows. */
  has(tabSessionId: string): boolean;
  /** Resolves when the tab's accounts are known — at once if they are — or after `waitMs`, whichever is first. */
  known(tabSessionId: string): Promise<void>;
}

export function createTabAccountsGate(deps: { readonly setTimer: (fn: () => void, ms: number) => unknown; readonly waitMs?: number }): TabAccountsGate {
  const waitMs = deps.waitMs ?? TAB_ACCOUNTS_WAIT_MS;
  const known = new Set<string>();
  const waiting = new Map<string, Set<() => void>>();
  const release = (tabSessionId: string): void => {
    const waiters = waiting.get(tabSessionId);
    if (waiters === undefined) return;
    waiting.delete(tabSessionId);
    for (const done of waiters) done();
  };
  return {
    reported(tabSessionId) {
      known.add(tabSessionId);
      release(tabSessionId);
    },
    gone(tabSessionId) {
      known.delete(tabSessionId);
      release(tabSessionId);
    },
    has: (tabSessionId) => known.has(tabSessionId),
    known(tabSessionId) {
      if (known.has(tabSessionId)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const waiters = waiting.get(tabSessionId) ?? new Set<() => void>();
        waiting.set(tabSessionId, waiters);
        const done = (): void => {
          waiters.delete(done);
          resolve();
        };
        waiters.add(done);
        deps.setTimer(done, waitMs);
      });
    },
  };
}
