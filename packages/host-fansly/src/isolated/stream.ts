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
// - A state is taken only under the generation it was asked in
//   (generation.ts): one that lands after the page's route, creator or life
//   moved is discarded whole — only the credits it names are freed — and
//   asked again at once.
//
// No timer: a failed `fx.state` is asked again at the next signal of the page
// (`retry`: the port calls it on a route change and on every action of our
// UI), after a pause that doubles with each failure in a row (RETRY_FIRST_MS
// up to RETRY_MAX_MS) — never once per action.

import type { FanslyState, FromMainFansly } from '@cg/contracts/bridge-messages-fansly';

import { BridgeCallError, type FanslyMainBridgeClient } from './bridge-client';
import type { Under } from './generation';

/** The pause before a failed state is asked again; doubled with each failure in a row, up to RETRY_MAX_MS. */
export const RETRY_FIRST_MS = 250;
export const RETRY_MAX_MS = 4_000;

/** Why the stream lost events: MAIN's gap, a batch refused by its schema, a batch that never came. */
export type StreamLoss = 'gap' | 'refused' | 'skipped';

export interface StreamSink {
  /** `fx.state` answered: every state whole. */
  state(state: FanslyState): void;
  /** One event of a batch, in MAIN's order. */
  event(event: FromMainFansly): void;
  /** After the states and facts of one delivery were taken, before its acknowledgement. */
  batch?(): void;
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
  /** `fx.state` answers that landed in another generation: discarded whole and asked again. */
  readonly statesDiscarded: number;
}

export interface FanslyStream {
  /** Asks `fx.state`; resolves true once an answer was taken, false when it failed (or there is no MAIN). */
  resync(): Promise<boolean>;
  /** An answer of `fx.state` was ever taken: the stream runs. */
  started(): boolean;
  /**
   * A state is owed: none was taken yet, or a loss or a failed ask came after the last one taken. MAIN stopped by a
   * gap sends nothing until it is asked again, so the port asks at every signal of the page while this holds.
   */
  owed(): boolean;
  /** A signal of the page: an owed state is asked again — once its pause after the last failure is over. */
  retry(): void;
  stats(): StreamStats;
  dispose(): void;
}

export interface StreamOptions {
  /** The port's generation guard (generation.ts): a state is taken only in the generation it was asked in. */
  readonly under?: Under;
  /** Epoch ms, for the pause after a failure. */
  readonly now?: () => number;
  readonly onFailure?: (failure: string) => void;
}

const always: Under = <T>(ask: () => Promise<T>) =>
  ask().then(
    (value) => ({ ok: true as const, value, fresh: () => true }),
    (error: unknown) => ({ ok: false as const, error, fresh: () => true }),
  );

export function consumeStream(bridge: FanslyMainBridgeClient, sink: StreamSink, options: StreamOptions = {}): FanslyStream {
  const under = options.under ?? always;
  const now = options.now ?? (() => Date.now());
  let disposed = false;
  /** Failures of `fx.state` in a row, and when the next owed ask may go. */
  let failures = 0;
  let retryAt = 0;
  /** The highest batch number seen or named by a state; null — none yet. */
  let last: number | null = null;
  let acked = 0;
  let inFlight: Promise<boolean> | null = null;
  let again = false;
  /** Set by a loss or a failed ask, cleared by a state taken after it. */
  let owing = true;
  const counts = { batches: 0, events: 0, gaps: 0, refused: 0, skipped: 0, states: 0, stateFailures: 0, statesDiscarded: 0 };

  const ack = (n: number): void => {
    if (n <= acked || disposed) return;
    acked = n;
    // A lost ack is made good by the next one: it is cumulative.
    void bridge.request('fx.ack', { n }).catch(() => undefined);
  };

  const ask = async (): Promise<boolean> => {
    try {
      const taken = await under(() => bridge.request('fx.state', {}));
      if (!taken.ok) throw taken.error;
      const state = taken.value;
      if (disposed) return false;
      failures = 0;
      retryAt = 0;
      // The credits it names are freed whatever its generation: they are the transport's.
      last = Math.max(last ?? 0, state.lastBatch);
      ack(state.lastBatch);
      // Read now, as it is taken: the page may have moved in the turn since the answer landed.
      if (!taken.fresh()) {
        // Of another generation: nothing of it is taken, and the state is asked again at once.
        counts.statesDiscarded += 1;
        owing = true;
        again = true;
        return false;
      }
      counts.states += 1;
      // A loss while this ask was on its way asked again (`again`): only that answer settles it.
      if (!again) owing = false;
      sink.state(state);
      return true;
    } catch (error) {
      counts.stateFailures += 1;
      owing = true;
      failures += 1;
      retryAt = now() + Math.min(RETRY_FIRST_MS * 2 ** (failures - 1), RETRY_MAX_MS);
      options.onFailure?.(error instanceof BridgeCallError ? error.failure : 'error');
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
    owing = true;
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
    sink.batch?.();
    ack(n);
    if (skipped) lose('skipped');
  });

  return {
    resync,
    started: () => counts.states > 0,
    owed: () => owing,
    retry() {
      if (owing && !disposed && inFlight === null && now() >= retryAt) void resync();
    },
    stats: () => ({ ...counts, acked }),
    dispose() {
      disposed = true;
      off();
    },
  };
}
