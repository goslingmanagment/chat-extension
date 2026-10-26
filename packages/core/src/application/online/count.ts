// «Онлайн N» on the dock's chip (2026-10-26, the owner's «ок»): how many of the open chat's page's fans are online
// within half an hour with a reason to write and set aside by nobody — the hub's list (`online.list`), read when the
// chat's page is known and every minute while the tab is on screen. On Fansly the creator's followers are read first
// (`fansly.online.seen`, the background's, at most once a minute per creator). Nothing is written to anyone; a failed
// read leaves the number out until the next one.

import { type OnlineItem, type OnlineList } from '@cg/contracts/hub';

/** The chip's number is read again this often while the tab is on screen. */
export const ONLINE_COUNT_POLL_MS = 60_000;
/** The page is read this soon after it became known (the first chat opened). */
export const ONLINE_COUNT_FIRST_MS = 2_000;
/** The number counts the fans online within this many minutes: the window's «Зашли за» it opens with. */
export const ONLINE_COUNT_MINUTES = 30;
/** The hub is asked for the window's longest period, as the window asks. */
const READ_MINUTES = 120;
/** The reasons «К разбору» holds. */
const WORTH: readonly string[] = ['waiting', 'new_unattended', 'expiring', 'silent', 'quiet', 'never_wrote'];

export interface OnlineCountPage {
  readonly pageId: number;
  /** The creator's account on the platform (Fansly's read of its followers). */
  readonly account: string;
}

export interface OnlineCountDeps {
  readonly clock: { now(): number; setTimer(ms: number, fn: () => void): unknown; clearTimer(handle: unknown): void };
  readonly visible: () => boolean;
  /** The open chat's page that has «Онлайн» (`online-v1`); null — none: no number. */
  readonly page: () => OnlineCountPage | null;
  /** One read of the hub's list (on Fansly after the site's read of who is active); null — it failed. */
  readonly read: (page: OnlineCountPage, minutes: number) => Promise<OnlineList | null>;
}

export interface OnlineCount {
  /** Fans worth a message now; null — unknown (no page, no read yet, a failed read). */
  count(): number | null;
  subscribe(listener: () => void): () => void;
  /** The open chat's page may have changed: read it soon. */
  touch(): void;
  dispose(): void;
}

/** Online within `minutes` and worth a message: a reason of «К разбору», set aside by nobody. */
export function worthOf(items: readonly OnlineItem[], now: number, minutes = ONLINE_COUNT_MINUTES): number {
  return items.filter((item) => {
    if (!WORTH.includes(item.reason) || item.aside !== null) return false;
    if (item.onlineSince !== null) return true;
    const seen = item.seenAt === null ? Number.NaN : Date.parse(item.seenAt);
    return !Number.isNaN(seen) && now - seen <= minutes * 60_000;
  }).length;
}

export function createOnlineCount(deps: OnlineCountDeps): OnlineCount {
  const { clock } = deps;
  const listeners = new Set<() => void>();
  let value: number | null = null;
  let of: number | null = null;
  let timer: unknown = null;
  let reads = 0;
  let disposed = false;

  const set = (next: number | null): void => {
    if (next === value) return;
    value = next;
    for (const listener of [...listeners]) listener();
  };

  function schedule(ms: number): void {
    if (timer !== null) clock.clearTimer(timer);
    timer = clock.setTimer(ms, () => {
      timer = null;
      void tick();
    });
  }

  async function tick(): Promise<void> {
    if (disposed) return;
    const page = deps.page();
    if (page === null) {
      of = null;
      set(null);
      schedule(ONLINE_COUNT_POLL_MS);
      return;
    }
    if (page.pageId !== of) {
      // Another page's number is not this one's.
      of = page.pageId;
      set(null);
    }
    if (deps.visible()) {
      const run = ++reads;
      const list = await deps.read(page, READ_MINUTES).catch(() => null);
      if (disposed || run !== reads) return;
      if (deps.page()?.pageId === page.pageId) set(list === null ? null : worthOf(list.items, clock.now()));
    }
    schedule(ONLINE_COUNT_POLL_MS);
  }

  schedule(ONLINE_COUNT_FIRST_MS);

  return {
    count: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    touch() {
      const page = deps.page();
      if (!disposed && page !== null && page.pageId !== of) schedule(ONLINE_COUNT_FIRST_MS);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}
