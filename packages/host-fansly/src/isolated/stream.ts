// The isolated side of MAIN's stream (docs/project-unite/architecture.md §6;
// contracts bridge-fansly.ts): what MAIN sends in `fx.batch` under its
// credits, taken in order and acknowledged, and `fx.state` asked whenever the
// stream began or broke.
//
// - The stream starts with the first `fx.state`: its answer carries the states
//   whole (identity, the focused chat, the network anchors) and the number of
//   the last batch MAIN sent; that number is acknowledged too — a batch that
//   never reached us (refused at the frame's first stages) holds no credit.
// - Every batch is acknowledged once its events were taken (`fx.ack {n}`,
//   cumulative: a late ack holds nothing for ever).
// - A loss — `fx.gap` (MAIN stopped: its queue overflowed), a batch refused by
//   its schema (it comes as its number alone: validate.ts), a number skipped
//   (a frame refused before its schema) — makes every chat unknown and asks
//   `fx.state` again (FS-TAIL-5). A lost event never becomes a fact here.
// - `fx.state` goes one at a time; asked again meanwhile, once more after.
//
// No timer and no retry by itself: a failed `fx.state` is asked again at the
// next signal of the page (the port asks on a route change and a return).

import type { FanslyState, FromMainFansly } from '@cg/contracts/bridge-messages-fansly';

import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';

/** Why the stream lost events: MAIN's gap, a batch refused by its schema, a batch that never came. */
export type StreamLoss = 'gap' | 'refused' | 'skipped';

export interface StreamSink {
  /** `fx.state` answered: every state whole. */
  state(state: FanslyState): void;
  /** One event of a batch, in MAIN's order. */
  event(event: FromMainFansly): void;
  /** Events were lost: every chat is unknown until the next state. */
  lost(reason: StreamLoss): void;
  /** A guarded failure of MAIN's own code (decision X22): its site and how often. */
  fault(source: string, count: number): void;
}

export interface StreamStats {
  readonly batches: number;
  readonly events: number;
  /** The highest batch number acknowledged. */
  readonly acked: number;
  readonly gaps: number;
  readonly refused: number;
  readonly skipped: number;
  /** `fx.state` answers taken. */
  readonly states: number;
  readonly stateFailures: number;
}

export interface FanslyStream {
  /** Asks `fx.state`; resolves true once an answer was taken, false when it failed (or there is no MAIN). */
  resync(): Promise<boolean>;
  /** An answer of `fx.state` was ever taken: the stream runs. */
  started(): boolean;
  stats(): StreamStats;
  dispose(): void;
}

export function consumeStream(bridge: FanslyMainBridgeClient, sink: StreamSink, onFailure?: (failure: string) => void): FanslyStream {
  let disposed = false;
  /** The highest batch number seen or named by a state; null — none yet. */
  let last: number | null = null;
  let acked = 0;
  let inFlight: Promise<boolean> | null = null;
  let again = false;
  const counts = { batches: 0, events: 0, gaps: 0, refused: 0, skipped: 0, states: 0, stateFailures: 0 };

  const ack = (n: number): void => {
    if (n <= acked || disposed) return;
    acked = n;
    // A lost ack is made good by the next one: it is cumulative.
    void bridge.request('fx.ack', { n }).catch(() => undefined);
  };

  const ask = async (): Promise<boolean> => {
    try {
      const state = await bridge.request('fx.state', {});
      if (disposed) return false;
      counts.states += 1;
      last = Math.max(last ?? 0, state.lastBatch);
      ack(state.lastBatch);
      sink.state(state);
      return true;
    } catch (error) {
      counts.stateFailures += 1;
      onFailure?.(error instanceof BridgeCallError ? error.failure : 'error');
      return false;
    }
  };

  const resync = (): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (inFlight !== null) {
      again = true;
      return inFlight;
    }
    const run = ask().then((taken) => {
      inFlight = null;
      if (!again || disposed) return taken;
      again = false;
      return resync();
    });
    inFlight = run;
    return run;
  };

  const lose = (reason: StreamLoss): void => {
    sink.lost(reason);
    void resync();
  };

  const off = bridge.onEvent((event) => {
    if (disposed) return;
    if (event.t === 'fault') return sink.fault(event.payload.source, event.payload.count);
    if (event.t === 'fx.gap') {
      counts.gaps += 1;
      return lose('gap');
    }
    const { n, events } = event.payload;
    if (last !== null && n <= last) return;
    const skipped = last !== null && n > last + 1;
    last = n;
    counts.batches += 1;
    if (events.length === 0) {
      // Refused by its schema (validate.ts): nothing of it is taken, its credit is freed.
      counts.refused += 1;
      ack(n);
      return lose('refused');
    }
    if (skipped) counts.skipped += 1;
    for (const item of events) {
      counts.events += 1;
      sink.event(item);
    }
    ack(n);
    if (skipped) lose('skipped');
  });

  return {
    resync,
    started: () => counts.states > 0,
    stats: () => ({ ...counts, acked }),
    dispose() {
      disposed = true;
      off();
    },
  };
}
