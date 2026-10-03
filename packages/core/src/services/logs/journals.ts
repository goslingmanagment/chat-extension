// The debug journals (architecture.md §9.2, §9.3; NF-029, `journal.read`):
// operations, hub calls and X8 attempts as bounded rings fed by the
// background logger by scope, and the «Новые» check journal with its own
// limits — at most 8 runs, 100 000 metadata events and 10 MiB, the cut
// marked. Records are the logger's finished ones: redacted, no message or
// prompt text. Collected only while debug mode is on; turning it off or
// signing out clears them (§9.3).

import { LOG_LIMITS } from '@cg/contracts/limits';
import { type LogRecord } from '@cg/contracts/logs';
import { type Uuid } from '@cg/contracts/primitives';
import { type JournalKind } from '@cg/contracts/vm';

import { Ring, jsonBytes, type LogSink } from '../../domain/logging';

export const CHECK_JOURNAL_LIMITS = {
  runs: LOG_LIMITS.newcomersJournalRuns,
  events: LOG_LIMITS.newcomersJournalEvents,
  bytes: LOG_LIMITS.newcomersJournalBytes,
} as const;

export interface CheckRunInfo {
  readonly runId: Uuid;
  readonly startedAt: string;
  readonly events: number;
}

interface Run {
  readonly runId: Uuid;
  readonly startedAt: string;
  readonly records: LogRecord[];
  readonly sizes: number[];
  /** Index of the first record still held (records before it were cut). */
  head: number;
}

/** The «Новые» check journal (NF-029): runs of metadata events within the limits, cuts marked. */
export class CheckJournal {
  private runs: Run[] = [];
  private events = 0;
  private bytes = 0;
  private cut = false;

  constructor(private readonly limits: { readonly runs: number; readonly events: number; readonly bytes: number } = CHECK_JOURNAL_LIMITS) {}

  /** A new check run; the oldest run goes when there are more than 8. */
  startRun(runId: Uuid, startedAt: string): void {
    if (this.runs.some((run) => run.runId === runId)) return;
    this.runs.push({ runId, startedAt, records: [], sizes: [], head: 0 });
    while (this.runs.length > this.limits.runs) this.dropRun();
  }

  /** One event of a run (an unknown run starts with it). Never throws. */
  add(runId: Uuid, startedAt: string, record: LogRecord): void {
    try {
      let run = this.runs.find((r) => r.runId === runId);
      if (run === undefined) {
        this.startRun(runId, startedAt);
        run = this.runs.find((r) => r.runId === runId);
        if (run === undefined) return;
      }
      const size = jsonBytes(record);
      run.records.push(record);
      run.sizes.push(size);
      this.events += 1;
      this.bytes += size;
      this.enforce();
    } catch {
      this.cut = true;
    }
  }

  /** A logger sink writing into one run: `createLogger({ sinks: [journal.sinkFor(runId, at)] })`. */
  sinkFor(runId: Uuid, startedAt: string): LogSink {
    return (record) => this.add(runId, startedAt, record);
  }

  private dropRun(): void {
    const run = this.runs.shift();
    if (run === undefined) return;
    for (let i = run.head; i < run.records.length; i += 1) {
      this.events -= 1;
      this.bytes -= run.sizes[i] ?? 0;
    }
    if (run.records.length - run.head > 0) this.cut = true;
  }

  private enforce(): void {
    while ((this.events > this.limits.events || this.bytes > this.limits.bytes) && this.runs.length > 0) {
      const oldest = this.runs[0];
      if (oldest === undefined) break;
      // A finished older run goes whole; the only (current) run loses its oldest events.
      if (this.runs.length > 1) {
        this.dropRun();
        continue;
      }
      if (oldest.head >= oldest.records.length) break;
      this.events -= 1;
      this.bytes -= oldest.sizes[oldest.head] ?? 0;
      oldest.head += 1;
      this.cut = true;
      // Compact now and then so a long run does not keep cut records alive.
      if (oldest.head > 1024 && oldest.head * 2 > oldest.records.length) {
        oldest.records.splice(0, oldest.head);
        oldest.sizes.splice(0, oldest.head);
        oldest.head = 0;
      }
    }
  }

  /** `journal.read` for «Новые»: the newest `limit` events across runs (oldest first), the runs and the cut mark. */
  read(limit: number): { readonly records: LogRecord[]; readonly truncated: boolean; readonly runs: CheckRunInfo[] } {
    const all: LogRecord[] = [];
    for (const run of this.runs) all.push(...run.records.slice(run.head));
    const take = Math.max(0, Math.min(Math.floor(limit), LOG_LIMITS.exportRecentRecords));
    return {
      records: take === 0 ? [] : all.slice(-take),
      truncated: this.cut || all.length > take,
      runs: this.runs.map((run) => ({ runId: run.runId, startedAt: run.startedAt, events: run.records.length - run.head })),
    };
  }

  stats(): { readonly runs: number; readonly events: number; readonly bytes: number; readonly truncated: boolean } {
    return { runs: this.runs.length, events: this.events, bytes: this.bytes, truncated: this.cut };
  }

  clear(): void {
    this.runs = [];
    this.events = 0;
    this.bytes = 0;
    this.cut = false;
  }
}

/** Which background scopes feed which journal (a record goes to the first matching one). */
export const JOURNAL_SCOPES: Readonly<Record<Exclude<JournalKind, 'newcomers-check'>, readonly string[]>> = {
  operations: ['bg.ops', 'bg.ai'],
  'hub-calls': ['bg.hub', 'bg.auth', 'bg.telemetry'],
  'send-attempts': ['bg.send', 'tab.insert', 'tab.route'],
};

/** Records kept per ring journal. */
export const JOURNAL_RING_SIZE = LOG_LIMITS.exportRecentRecords;

function scopeMatches(scope: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => scope === prefix || scope.startsWith(`${prefix}.`));
}

export interface JournalRead {
  readonly records: LogRecord[];
  readonly truncated: boolean;
  readonly runs: CheckRunInfo[] | null;
}

/** All four journals of `journal.read`, collected only while `enabled()` (debug mode). */
export class DebugJournals {
  private readonly rings = new Map<Exclude<JournalKind, 'newcomers-check'>, Ring<LogRecord>>();
  readonly newcomers = new CheckJournal();

  constructor(private readonly enabled: () => boolean) {
    for (const kind of Object.keys(JOURNAL_SCOPES) as Exclude<JournalKind, 'newcomers-check'>[]) this.rings.set(kind, new Ring<LogRecord>(JOURNAL_RING_SIZE));
  }

  /** The background logger's sink: routes a record to its journal by scope. */
  readonly sink: LogSink = (record) => {
    try {
      if (!this.enabled()) return;
      for (const [kind, prefixes] of Object.entries(JOURNAL_SCOPES) as [Exclude<JournalKind, 'newcomers-check'>, readonly string[]][]) {
        if (scopeMatches(record.scope, prefixes)) {
          this.rings.get(kind)?.push(record);
          return;
        }
      }
    } catch {
      // A journal never breaks the logger.
    }
  };

  /** A «Новые» check run's sink (only while debug is on). */
  newcomersSink(runId: Uuid, startedAt: string): LogSink {
    return (record) => {
      try {
        if (this.enabled()) this.newcomers.add(runId, startedAt, record);
      } catch {
        // Never breaks the check.
      }
    };
  }

  read(kind: JournalKind, limit: number): JournalRead {
    if (kind === 'newcomers-check') return this.newcomers.read(limit);
    const ring = this.rings.get(kind);
    if (ring === undefined) return { records: [], truncated: false, runs: null };
    const take = Math.max(0, Math.min(Math.floor(limit), LOG_LIMITS.exportRecentRecords));
    return { records: take === 0 ? [] : ring.tail(take), truncated: ring.overwritten > 0 || ring.size > take, runs: null };
  }

  /** Debug off or sign-out: everything goes (§9.3). */
  clear(): void {
    for (const kind of [...this.rings.keys()]) this.rings.set(kind, new Ring<LogRecord>(JOURNAL_RING_SIZE));
    this.newcomers.clear();
  }
}
