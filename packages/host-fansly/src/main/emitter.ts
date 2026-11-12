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
//   (`fanslyFrameByteLimit`), in the same unit: the UTF-8 bytes of the JSON
//   (2026-11-13: names of the creator's tiers and lists cross now, not ASCII).
// - A state larger than any batch could ever carry, or states that together
//   never fit an empty pipe, are dropped, the largest first, and said as a
//   fault (`oversize`): one state never stops the stream of every other fact.
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
  /** A state: the latest of its type leads the next batch. `bytes` — its payload's UTF-8 JSON size, when the caller measured it. */
  state(t: string, p: Plain, bytes?: number): void;
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
  /** Terminal coexistence transition: drop pending facts and release credits, keeping batch order. */
  retire(): void;
  stats(): StreamStats;
}

interface Item {
  readonly t: string;
  readonly p: Plain;
  /** Its JSON in a batch, the comma after it included. */
  readonly b: number;
}

const NON_ASCII = /[\u0080-\uffff]/;

/**
 * UTF-8 bytes of a JSON text, as the isolated side counts them (contracts bridge.ts `checkBridgeFrame`). A lone
 * surrogate never stands in `JSON.stringify`'s output (it is escaped as `\\uXXXX`, ASCII).
 */
export function utf8Bytes(text: string): number {
  if (!NON_ASCII.test(text)) return text.length;
  let bytes = text.length;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) bytes += 1;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // A pair: two UTF-16 units, four bytes.
      bytes += 2;
      i += 1;
    } else bytes += 2;
  }
  return bytes;
}

/**
 * `gapped` — told after the one `fx.gap` went: every chat of the observation is unknown from then on (§5.6).
 * `oversize` — a state dropped because no batch could carry it.
 */
export function createEmitter(
  post: (t: string, payload: Plain) => void,
  stringify: (value: unknown) => string,
  gapped: (reason: string) => void = () => undefined,
  oversize: (t: string) => void = () => undefined,
): Emitter {
  const size = (t: string, p: Plain): number => utf8Bytes(stringify({ t, p })) + 1;
  /** The most one batch can ever carry, its envelope aside. */
  const ROOM_MAX = Math.min(MAX_BATCH_BYTES, MAX_IN_FLIGHT_BYTES) - BATCH_ENVELOPE_BYTES;
  let queue: Item[] = [];
  let head = 0;
  let queueBytes = 0;
  let states: Record<string, { readonly p: Plain; readonly b: number }> = {};
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
    let bytes = 0;
    for (const t of Object.keys(states)) bytes += (states[t] as { readonly b: number }).b;
    // States that could never go together, even with nothing in flight: the largest goes, said once each — never a stall.
    while (bytes > ROOM_MAX) {
      let largest: string | null = null;
      for (const t of Object.keys(states)) if (largest === null || (states[t] as { readonly b: number }).b > (states[largest] as { readonly b: number }).b) largest = t;
      if (largest === null) break;
      bytes -= (states[largest] as { readonly b: number }).b;
      delete states[largest];
      oversize(largest);
    }
    // The states alone do not fit what is left in flight: they wait for an ack.
    if (bytes > room) return;
    const events: Array<{ t: string; p: Plain }> = Object.keys(states).map((t) => ({ t, p: (states[t] as { readonly p: Plain }).p }));
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
    state(t, p, bytes) {
      if (stopped) return;
      const b = bytes === undefined ? size(t, p) : 14 + utf8Bytes(t) + bytes;
      if (b > ROOM_MAX) {
        delete states[t];
        oversize(t);
        return;
      }
      states[t] = { p, b };
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
    retire() { drop(); unacked.clear(); inFlight = 0; stopped = false; },
    held: () => queueBytes + inFlight,
    stats: () => ({ batches: n, unacked: unacked.size, queued: queue.length - head, heldBytes: queueBytes + inFlight, gaps }),
  };
}
