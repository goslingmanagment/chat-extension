// `fx.batch` with credits (docs/project-unite/architecture.md §6; contracts
// bridge-fansly.ts): Fansly packs its events itself.
// - The events of one listener call go out in ONE `post` — a batch
//   `{n, events: [{t, p}]}` — when the runtime calls `flush()` at the end of
//   the call (≤ 1 post per listener call, §6; «per task» is not promised:
//   microtasks run between the listeners of one native event).
// - States (`fx.identity`, `fx.contract`; `fx.chat` from P7b) coalesce by type,
//   the latest wins, and lead the next batch; the stream (`fx.incoming`,
//   `fx.coverage`…) goes in order, never coalesced, thinned or dropped one by
//   one.
// - Credits: at most MAX_UNACKED batches and MAX_IN_FLIGHT_BYTES not
//   acknowledged (`fx.ack {n}`, cumulative). Waiting events stay in the queue;
//   the queue and the batches in flight are MAIN's memory (`held()`, part of
//   the observation's account, §5.5). A batch is ≤ MAX_BATCH_BYTES of JSON with
//   its envelope and ≤ MAX_BATCH_EVENTS events — what the isolated side checks
//   (`fanslyFrameByteLimit`): every payload here is ASCII (ids, enums, ISO
//   times), so the length of its JSON is its UTF-8 size.
// - The queue full: MAIN drops it, sends ONE `fx.gap` (outside the batches and
//   their credits) and takes nothing more until the isolated side asks
//   `fx.state` — every chat is unknown, and a lost event never makes a false
//   `sent` (FS-TAIL-5). `n` goes on: a gap does not reset it.
// - The stream starts with the first `fx.state` (`start()`): the isolated side
//   asks it once it listens. Until then events wait in the queue, under the
//   same limit.

import type { Plain } from '@cg/host-kit/main/check';

import { BATCH_ENVELOPE_BYTES, EVT_BATCH, EVT_GAP, GAP_OVERFLOW, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, MAX_IN_FLIGHT_BYTES, MAX_UNACKED, QUEUE_MAX_BYTES, QUEUE_MAX_EVENTS } from './protocol';

export interface StreamStats {
  readonly batches: number;
  readonly unacked: number;
  readonly queued: number;
  readonly heldBytes: number;
  readonly gaps: number;
}

export interface Emitter {
  /** An event of the stream: in order, never coalesced. */
  event(t: string, p: Plain): void;
  /** A state: the latest of its type leads the next batch. */
  state(t: string, p: Plain): void;
  /** The end of a listener call: at most one batch goes out, within the credits. */
  flush(): void;
  /** The isolated side took every batch up to `n`: their credits are free. */
  ack(n: number): void;
  /** `fx.state`: the stream starts (or starts again after a gap) after the batch it returns the number of. */
  start(): number;
  /** Drops the queue and says `fx.gap` once; nothing more until `start()`. */
  gap(reason: string): void;
  /** Bytes the stream holds: the queue and the batches in flight. */
  held(): number;
  stats(): StreamStats;
}

interface Item {
  readonly t: string;
  readonly p: Plain;
  /** Its JSON in a batch, the comma after it included. */
  readonly b: number;
}

/** `gapped` — told after the one `fx.gap` went: every chat of the observation is unknown from then on (§5.6). */
export function createEmitter(post: (t: string, payload: Plain) => void, stringify: (value: unknown) => string, gapped: (reason: string) => void = () => undefined): Emitter {
  const size = (t: string, p: Plain): number => stringify({ t, p }).length + 1;
  let queue: Item[] = [];
  let head = 0;
  let queueBytes = 0;
  let states: Record<string, Plain> = {};
  /** Batches in flight, oldest first: number → bytes. */
  const unacked = new Map<number, number>();
  let inFlight = 0;
  let n = 0;
  let streaming = false;
  let stopped = false;
  let gaps = 0;

  const drop = (): void => {
    queue = [];
    head = 0;
    queueBytes = 0;
    states = {};
  };

  const gap = (reason: string): void => {
    if (stopped) return;
    drop();
    stopped = true;
    gaps += 1;
    post(EVT_GAP, { reason });
    gapped(reason);
  };

  const flush = (): void => {
    if (!streaming || stopped || unacked.size >= MAX_UNACKED) return;
    const room = Math.min(MAX_BATCH_BYTES, MAX_IN_FLIGHT_BYTES - inFlight) - BATCH_ENVELOPE_BYTES;
    const events: Array<{ t: string; p: Plain }> = [];
    let bytes = 0;
    const keys = Object.keys(states);
    for (const t of keys) {
      const p = states[t] as Plain;
      bytes += size(t, p);
      events.push({ t, p });
    }
    // The states alone do not fit what is left in flight: they wait for an ack.
    if (bytes > room) return;
    let next = head;
    while (next < queue.length && events.length < MAX_BATCH_EVENTS) {
      const item = queue[next] as Item;
      if (bytes + item.b > room) break;
      bytes += item.b;
      events.push({ t: item.t, p: item.p });
      next += 1;
    }
    if (events.length === 0) {
      // One event larger than any batch could ever be: it can never go, and it must not go missing quietly.
      if (next < queue.length && unacked.size === 0) gap(GAP_OVERFLOW);
      return;
    }
    states = {};
    for (let i = head; i < next; i += 1) queueBytes -= (queue[i] as Item).b;
    head = next;
    if (head === queue.length) {
      queue = [];
      head = 0;
    }
    n += 1;
    const batch = bytes + BATCH_ENVELOPE_BYTES;
    unacked.set(n, batch);
    inFlight += batch;
    post(EVT_BATCH, { n, events });
  };

  return {
    event(t, p) {
      if (stopped) return;
      const b = size(t, p);
      queue.push({ t, p, b });
      queueBytes += b;
      if (queueBytes > QUEUE_MAX_BYTES || queue.length - head > QUEUE_MAX_EVENTS) gap(GAP_OVERFLOW);
    },
    state(t, p) {
      if (!stopped) states[t] = p;
    },
    flush,
    ack(upTo) {
      for (const [id, bytes] of unacked) {
        if (id > upTo) break;
        unacked.delete(id);
        inFlight -= bytes;
      }
      flush();
    },
    start() {
      streaming = true;
      stopped = false;
      // The answer of `fx.state` carries every state whole.
      states = {};
      return n;
    },
    gap,
    held: () => queueBytes + inFlight,
    stats: () => ({ batches: n, unacked: unacked.size, queued: queue.length - head, heldBytes: queueBytes + inFlight, gaps }),
  };
}
