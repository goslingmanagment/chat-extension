// «Очереди N» on the dock's chip (2026-10-29): how many of the open chat's page's queues have work for the person
// today (active, their day's portion not done, someone left to hand out or in their portion), or — once someone
// answered a message from a queue — how many answered («2 ↩»). The hub's list (`queues.list`), read when the chat's
// page is known and every minute while the tab is on screen. Nothing is written to anyone; a failed read leaves the
// number out until the next one.

import { type FanQueues } from '@cg/contracts/hub';

/** The chip's number is read again this often while the tab is on screen. */
export const QUEUES_COUNT_POLL_MS = 60_000;
/** The page is read this soon after it became known (the first chat opened). */
export const QUEUES_COUNT_FIRST_MS = 2_500;

export interface QueuesCountPage {
  readonly pageId: number;
}

export interface QueuesCountDeps {
  readonly clock: { now(): number; setTimer(ms: number, fn: () => void): unknown; clearTimer(handle: unknown): void };
  readonly visible: () => boolean;
  /** The open chat's page that has «Очереди» (`fan-queues-v1`); null — none: no number. */
  readonly page: () => QueuesCountPage | null;
  /** One read of the hub's list; null — it failed. */
  readonly read: (page: QueuesCountPage) => Promise<FanQueues | null>;
}

/** What the chip shows: the queues with work today, and the fans who answered a message from a queue. */
export interface QueuesTally {
  readonly work: number;
  readonly answered: number;
  /** The person's queues of the page at all: none — no chip (a page has queues only on someone's word). */
  readonly queues: number;
}

export interface QueuesCount {
  /** null — unknown (no page, no read yet, a failed read). */
  count(): QueuesTally | null;
  /** The last list of the open chat's page (the palette's group «Очереди»); null — unknown. */
  list(): FanQueues | null;
  subscribe(listener: () => void): () => void;
  /** The open chat's page may have changed: read it soon. */
  touch(): void;
  dispose(): void;
}

/** A queue with work for the person today: active, their portion for the day not done, a fan to hand out or in hand. */
export function tallyOf(list: FanQueues): QueuesTally {
  const work = list.queues.filter((queue) => {
    if (queue.status !== 'active') return false;
    if (queue.perPerson !== null && queue.today.mine >= queue.perPerson) return false;
    return queue.pending > 0 || queue.leasedToMe > 0;
  }).length;
  return { work, answered: list.answered.length, queues: list.queues.length };
}

export function createQueuesCount(deps: QueuesCountDeps): QueuesCount {
  const { clock } = deps;
  const listeners = new Set<() => void>();
  let value: QueuesTally | null = null;
  let last: FanQueues | null = null;
  let of: number | null = null;
  let timer: unknown = null;
  let reads = 0;
  let disposed = false;

  /** A new list tells the listeners too: the palette's group shows each queue's day. */
  const set = (next: QueuesTally | null, list: FanQueues | null = null): void => {
    const same = next === value || (next !== null && value !== null && next.work === value.work && next.answered === value.answered && next.queues === value.queues);
    if (same && list === last) return;
    value = next;
    last = list;
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
      schedule(QUEUES_COUNT_POLL_MS);
      return;
    }
    if (page.pageId !== of) {
      // Another page's number is not this one's.
      of = page.pageId;
      set(null);
    }
    if (deps.visible()) {
      const run = ++reads;
      const list = await deps.read(page).catch(() => null);
      if (disposed || run !== reads) return;
      if (deps.page()?.pageId === page.pageId) set(list === null ? null : tallyOf(list), list);
    }
    schedule(QUEUES_COUNT_POLL_MS);
  }

  schedule(QUEUES_COUNT_FIRST_MS);

  return {
    count: () => value,
    list: () => last,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    touch() {
      const page = deps.page();
      if (!disposed && page !== null && page.pageId !== of) schedule(QUEUES_COUNT_FIRST_MS);
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}
