// The OnlyFans feed's uploader (hub #953, `clientOnlyfansFeed`): from
// 2026-11-01 the hub has no OnlyFansAPI, and every ChatSpace tab of this
// browser passes on what its page received — its socket's frames, the answers
// of its own reads. The event page is one for every tab, so this is the ONE
// uploader of an account here: two tabs of one account, or the same history
// page read twice, upload a record once.
//
// - What goes: a record the hub's schema takes (it is checked here again),
//   for the page its account is bound to, under the person signed in when it
//   was taken. A record already sent or waiting, with nothing changed (its
//   OnlyFans id and its content, apart from when and how it was seen), is not
//   taken again; the memory of that is bounded (SEEN_MAX) and lives as long as
//   the event page.
// - How: records of one page gather for BATCH_MS and go together, at most
//   ONLYFANS_FEED_MAX_RECORDS and ONLYFANS_FEED_REPORT_BYTES a request, one
//   request of a page at a time.
// - Answers: an answer is final — the hub journaled every record (taken,
//   duplicate, held, out of range). Only an answer that was lost or refused for
//   the moment (the network, a 5xx, a 429) is asked again, on RETRY_DELAYS_MS,
//   and the hub dedups the repeat; after them the batch is given up (the next
//   sighting of the same thing carries it). A refusal (another 4xx, a token the
//   hub did not take, the hub layer's own: no capability, the page not
//   granted, its switch off) gives the batch up at once.
// - Memory only: nothing is journaled to storage. A record lost with the event
//   page, or given up, is not money lost for good: the next sighting of the same
//   thing — the chat opened again, the ledger read again, the server's own tab
//   (owner, 2026-10-31) — brings it, and the hub counts a purchase once
//   however many times it hears of it.
//
// Never a request to OnlyFans or OnlyMonster: only to the hub.

import { ONLYFANS_FEED_MAX_RECORDS, ONLYFANS_FEED_REPORT_BYTES, OnlyfansFeedRecordSchema, onlyfansFeedRecordKey, type HubFacade, type HubFailure, type OnlyfansFeedRecord } from '@cg/contracts/hub';

import { reportRetryable } from '../domain/send';
import { NO_LOG, type Clock, type LogSink, type TimerHandle } from './ports';

/** How long records of a page gather before their report goes. */
export const ONLYFANS_FEED_BATCH_MS = 2_000;
/** Records a page may have waiting; beyond it the oldest go. */
export const ONLYFANS_FEED_QUEUE_MAX = 5_000;
/** Records remembered as sent or waiting (by id and content), across pages; the oldest are forgotten. */
export const ONLYFANS_FEED_SEEN_MAX = 50_000;
/** Waits before a lost answer is asked again; after the last the batch is given up. */
export const ONLYFANS_FEED_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

export interface OnlyfansFeedReport {
  readonly pageLabel: string;
  /** `onlymonster:<id>`. */
  readonly hostAccountRef: string;
  readonly creatorRef: string;
  readonly records: readonly OnlyfansFeedRecord[];
}

export type OnlyfansFeedOutcome = { readonly queued: number; readonly known: number; readonly invalid: number } | 'signed-out';

export interface OnlyfansFeedDeps {
  readonly clock: Pick<Clock, 'setTimer' | 'clearTimer' | 'now'>;
  readonly hub: Pick<HubFacade, 'onlyfansFeed'>;
  /** Who is signed in — `hubOrigin|userId`; null — nobody. */
  readonly owner: () => string | null;
  readonly log?: LogSink;
}

interface Queue {
  readonly owner: string;
  readonly pageLabel: string;
  readonly hostAccountRef: string;
  readonly creatorRef: string;
  readonly records: { readonly record: OnlyfansFeedRecord; readonly seen: string }[];
  timer: TimerHandle | null;
  running: boolean;
}

function failureOf(error: unknown): HubFailure | null {
  if (typeof error !== 'object' || error === null) return null;
  const failure = (error as { readonly failure?: unknown }).failure;
  return (error as { readonly name?: unknown }).name === 'HubCallError' && typeof failure === 'object' && failure !== null ? (failure as HubFailure) : null;
}

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

/** What a record says apart from when and how the page got it: two tabs that saw the same thing say the same. Pure. */
export function onlyfansFeedSeenKey(record: OnlyfansFeedRecord): string {
  const { observedAt: _observedAt, ...rest } = record;
  const content = rest.kind === 'message' ? { ...rest, via: null } : rest;
  return `${onlyfansFeedRecordKey(record)}|${JSON.stringify(canonical(content))}`;
}

export class OnlyfansFeedUploader {
  private readonly queues = new Map<string, Queue>();
  /** Records sent or waiting, by owner, page and seen key; insertion order is the age. */
  private readonly seen = new Set<string>();
  private readonly log: LogSink;
  private readonly encoder = new TextEncoder();

  constructor(private readonly deps: OnlyfansFeedDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** Takes a tab's records for a page; at once, never waiting for the hub. */
  report(input: OnlyfansFeedReport): OnlyfansFeedOutcome {
    const owner = this.deps.owner();
    if (owner === null) return 'signed-out';
    this.dropOthers(owner);
    const key = `${owner}|${input.pageLabel}|${input.hostAccountRef}|${input.creatorRef}`;
    let queue = this.queues.get(key);
    if (queue === undefined) {
      queue = { owner, pageLabel: input.pageLabel, hostAccountRef: input.hostAccountRef, creatorRef: input.creatorRef, records: [], timer: null, running: false };
      this.queues.set(key, queue);
    }
    let queued = 0;
    let known = 0;
    let invalid = 0;
    for (const record of input.records) {
      if (!OnlyfansFeedRecordSchema.safeParse(record).success) {
        invalid += 1;
        continue;
      }
      const seen = `${owner}|${input.pageLabel}|${onlyfansFeedSeenKey(record)}`;
      if (this.seen.has(seen)) {
        known += 1;
        continue;
      }
      this.remember(seen);
      queue.records.push({ record, seen });
      queued += 1;
    }
    while (queue.records.length > ONLYFANS_FEED_QUEUE_MAX) {
      const dropped = queue.records.shift();
      if (dropped !== undefined) this.seen.delete(dropped.seen);
    }
    if (queued > 0) this.schedule(key, queue);
    return { queued, known, invalid };
  }

  /** Waiting records of every page (the background's diagnostics). */
  waiting(): number {
    let count = 0;
    for (const queue of this.queues.values()) count += queue.records.length;
    return count;
  }

  private remember(seen: string): void {
    this.seen.add(seen);
    while (this.seen.size > ONLYFANS_FEED_SEEN_MAX) this.seen.delete(this.seen.values().next().value ?? '');
  }

  /** Another person signed in: what the one before had waiting is theirs, and goes nowhere now. */
  private dropOthers(owner: string): void {
    for (const [key, queue] of this.queues) {
      if (queue.owner === owner) continue;
      if (queue.timer !== null) this.deps.clock.clearTimer(queue.timer);
      this.queues.delete(key);
    }
  }

  private schedule(key: string, queue: Queue): void {
    if (queue.timer !== null || queue.running) return;
    queue.timer = this.deps.clock.setTimer(ONLYFANS_FEED_BATCH_MS, () => {
      queue.timer = null;
      void this.drain(key, queue);
    });
  }

  /** The next batch of a queue: at most ONLYFANS_FEED_MAX_RECORDS and ONLYFANS_FEED_REPORT_BYTES of JSON. */
  private take(queue: Queue): { readonly record: OnlyfansFeedRecord; readonly seen: string }[] {
    const batch: { readonly record: OnlyfansFeedRecord; readonly seen: string }[] = [];
    let bytes = 512;
    while (queue.records.length > 0 && batch.length < ONLYFANS_FEED_MAX_RECORDS) {
      const next = queue.records[0] as { readonly record: OnlyfansFeedRecord; readonly seen: string };
      const size = this.encoder.encode(JSON.stringify(next.record)).length + 1;
      if (batch.length > 0 && bytes + size > ONLYFANS_FEED_REPORT_BYTES) break;
      queue.records.shift();
      batch.push(next);
      bytes += size;
    }
    return batch;
  }

  private async drain(key: string, queue: Queue): Promise<void> {
    if (queue.running) return;
    queue.running = true;
    try {
      while (queue.records.length > 0 && this.queues.get(key) === queue) {
        const batch = this.take(queue);
        const sent = await this.send(queue, batch);
        // Given up: the next sighting of the same thing may carry it again.
        if (!sent) for (const item of batch) this.seen.delete(item.seen);
      }
    } finally {
      queue.running = false;
      if (queue.records.length === 0 && this.queues.get(key) === queue) this.queues.delete(key);
    }
  }

  /** One batch to the hub; true — the hub answered (every record journaled there). */
  private async send(queue: Queue, batch: readonly { readonly record: OnlyfansFeedRecord }[]): Promise<boolean> {
    const request = { pageLabel: queue.pageLabel, hostAccountRef: queue.hostAccountRef, creatorRef: queue.creatorRef, records: batch.map((item) => item.record) };
    for (let attempt = 0; ; attempt += 1) {
      if (this.deps.owner() !== queue.owner) return false;
      try {
        const answer = await this.deps.hub.onlyfansFeed(request);
        if (answer.held > 0 || answer.outOfRange > 0) {
          this.log.write({ level: 'info', scope: 'bg.onlyfans-feed', msg: 'feed records journaled only', fields: { held: answer.held, outOfRange: answer.outOfRange } });
        }
        return true;
      } catch (error) {
        const failure = failureOf(error);
        const delay = ONLYFANS_FEED_RETRY_DELAYS_MS[attempt];
        if (failure === null || !reportRetryable(failure) || delay === undefined) {
          this.log.write({
            level: failure === null ? 'info' : 'warn',
            scope: 'bg.onlyfans-feed',
            msg: failure === null ? 'feed records held back: the hub layer refused' : 'feed records not taken by the hub, given up',
            fields: { records: batch.length, status: failure?.kind === 'http' ? failure.status : null },
          });
          return false;
        }
        await new Promise<void>((resolve) => this.deps.clock.setTimer(delay, resolve));
      }
    }
  }
}
