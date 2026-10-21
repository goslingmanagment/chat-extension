// A tab's or a page's records on their way to the background (LG-011,
// `log.write`): records are already redacted and at most 4 KiB (the logger of
// those contexts is built with LOG_LIMITS.maxRecordBytesFromUi); the
// forwarder batches them (≤ 50 per request), keeps a bounded backlog while
// the background does not answer, drops the oldest beyond it and counts what
// it lost. It never throws and never waits for the answer before returning.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { type LogRecord } from '@cg/contracts/logs';

export interface ForwarderOptions {
  /** `log.write` through the tab port; rejects when the background is unreachable. */
  readonly send: (records: readonly LogRecord[]) => Promise<{ readonly accepted: number; readonly dropped: number }>;
  /** Runs `fn` soon (a microtask or a short timer of the composition root). */
  readonly schedule: (fn: () => void) => void;
  readonly batchMax?: number;
  /** Records kept while the background is away; the oldest go first. */
  readonly backlogMax?: number;
}

export interface ForwarderStats {
  /** Waiting records plus the batch on its way. */
  readonly pending: number;
  readonly sent: number;
  /** Lost: backlog overflow, plus what the background reported as dropped. */
  readonly lost: number;
  readonly failures: number;
}

export interface LogForwarder {
  /** A logger sink: `createLogger({ sinks: [forwarder.push] })`. */
  readonly push: (record: LogRecord) => void;
  /** Sends what is pending now (pagehide, a test). */
  flush(): Promise<void>;
  stats(): ForwarderStats;
}

export const FORWARDER_BACKLOG_MAX = 2000;

export function createLogForwarder(options: ForwarderOptions): LogForwarder {
  const batchMax = Math.max(1, Math.min(options.batchMax ?? LOG_LIMITS.maxRecordsPerWrite, LOG_LIMITS.maxRecordsPerWrite));
  const backlogMax = Math.max(batchMax, options.backlogMax ?? FORWARDER_BACKLOG_MAX);
  const pending: LogRecord[] = [];
  let scheduled = false;
  let inFlight: Promise<void> | null = null;
  /** Records of the batch on its way: out of `pending`, so an overflow meanwhile never trims them. */
  let travelling = 0;
  let sent = 0;
  let lost = 0;
  let failures = 0;

  /** The oldest beyond the backlog bound go, counted. */
  const trim = (): void => {
    if (pending.length <= backlogMax) return;
    const over = pending.length - backlogMax;
    pending.splice(0, over);
    lost += over;
  };

  const drain = async (): Promise<void> => {
    while (pending.length > 0) {
      const batch = pending.splice(0, batchMax);
      travelling = batch.length;
      try {
        const answer = await options.send(batch);
        sent += Math.max(0, answer.accepted);
        lost += Math.max(0, answer.dropped);
      } catch {
        // The background is away: the batch goes back to the head of the backlog (still bounded); the next record tries again.
        pending.unshift(...batch);
        trim();
        failures += 1;
        return;
      } finally {
        travelling = 0;
      }
    }
  };

  const flush = (): Promise<void> => {
    if (inFlight !== null) return inFlight;
    inFlight = drain().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const push = (record: LogRecord): void => {
    try {
      pending.push(record);
      trim();
      if (scheduled) return;
      scheduled = true;
      options.schedule(() => {
        scheduled = false;
        void flush();
      });
    } catch {
      lost += 1;
    }
  };

  return {
    push,
    flush,
    stats: () => ({ pending: pending.length + travelling, sent, lost, failures }),
  };
}
