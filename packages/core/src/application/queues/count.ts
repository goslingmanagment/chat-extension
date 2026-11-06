// «Очереди N» on the dock's chip (2026-10-29): how many of the open chat's page's queues have work for the person
// today (active, their day's portion not done, someone left to hand out or in their portion), or — once someone
// answered a message from a queue — how many answered («2 ↩»). The hub's list (`queues.list`), read when the chat's
// page is known and every minute while the tab is on screen. Nothing is written to anyone; a failed read leaves the
// number out until the next one.

import { type FanQueues } from '@cg/contracts/hub';
import { type QueueNudgeVM, type QueueStripVM, type QueueWalkVM } from '@cg/contracts/vm';

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
  /** Which pages' reminder the person has seen off, and on which Moscow day (storage.local). Absent — until the tab reloads. */
  readonly nudges?: { load(): Promise<unknown>; save(value: unknown): Promise<void> };
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
  /** The strip over the dock: the portion the person walks (the boards tell it), else the day's reminder; null — nothing. */
  strip(): QueueStripVM | null;
  setWalk(walk: QueueWalkVM | null): void;
  /** «Не сегодня» of the reminder. */
  dismissNudge(): void;
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

/** The Moscow day of a moment: the hub counts a day's work by it. */
export function moscowDay(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(date);
}

/** A queue worth a reminder: it has fans for the person, and they have not touched it today. */
export function nudgeOf(list: FanQueues): QueueNudgeVM | null {
  const queue = list.queues.find((one) => one.status === 'active' && one.today.mine === 0 && one.leasedToMe === 0 && one.pending > 0);
  return queue === undefined ? null : { kind: 'nudge', queueId: queue.queueId, name: queue.name, waiting: queue.pending, batch: queue.scenario.action === 'template' && queue.scenario.sendMode === 'batch' };
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
  let walk: QueueWalkVM | null = null;
  /** By page: the Moscow day the person last saw the reminder off (or started a walk). */
  const seenOff = new Map<string, string>();
  const loaded = deps.nudges === undefined ? Promise.resolve() : deps.nudges.load().then(
    (raw) => {
      if (raw === null || typeof raw !== 'object') return;
      for (const [page, day] of Object.entries(raw as Record<string, unknown>)) if (typeof day === 'string') seenOff.set(page, day);
    },
    () => undefined,
  );
  let loadedYet = deps.nudges === undefined;

  const tell = (): void => {
    for (const listener of [...listeners]) listener();
  };

  function seeOff(): void {
    if (last === null || of === null) return;
    const day = moscowDay(last.serverNow);
    if (seenOff.get(String(of)) === day) return;
    seenOff.set(String(of), day);
    // One mark per page: a new day writes over the last.
    void deps.nudges?.save(Object.fromEntries(seenOff)).catch(() => undefined);
  }

  /** A new list tells the listeners too: the palette's group shows each queue's day. */
  const set = (next: QueuesTally | null, list: FanQueues | null = null): void => {
    const same = next === value || (next !== null && value !== null && next.work === value.work && next.answered === value.answered && next.queues === value.queues);
    if (same && list === last) return;
    value = next;
    last = list;
    tell();
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
  void loaded.then(() => {
    loadedYet = true;
    if (!disposed && last !== null) tell();
  });

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
      if (disposed || page === null || page.pageId === of) return;
      // The old page's read on its way is dropped: its answer would put the next read a minute away.
      reads += 1;
      // Another page's number (and its list and reminder) never stands on this page's chat.
      set(null);
      schedule(QUEUES_COUNT_FIRST_MS);
    },
    strip() {
      if (walk !== null) return walk;
      if (last === null || of === null || !loadedYet || seenOff.get(String(of)) === moscowDay(last.serverNow)) return null;
      return nudgeOf(last);
    },
    setWalk(next) {
      const started = walk === null && next !== null;
      walk = next;
      // A walk counts as the day's start: the reminder does not come back after it.
      if (started) seeOff();
      tell();
    },
    dismissNudge() {
      seeOff();
      tell();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      listeners.clear();
    },
  };
}
