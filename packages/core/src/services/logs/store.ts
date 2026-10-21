// The background's persistent log (architecture.md §9.2; LG-004…LG-006,
// LG-012, LG-023): IndexedDB `cg-logs` behind a platform port, the sessions
// of a week at most, within LOG_LIMITS' records and bytes and 7 days —
// whichever comes first (2026-10-21: a day of a shift at least, for the
// chatter's «Скачать лог»). The logger hands every finished, redacted record to
// `sink`; the service batches them into one write a little later and never
// throws, never waits and never makes the caller wait. What could not be
// kept is counted (pending overflow, write failures, pruning) and shown in
// diagnostics.
//
// A log session is one run of the background's log: the composition root
// keeps its number in storage.session, so an event page that wakes up again
// in the same browser session continues the same log session, and a browser
// restart or an update starts the next one.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { type LogRecord } from '@cg/contracts/logs';
import { jsonBytes, type LogSink } from '../../domain/logging';

import { type Scheduler } from '../ports';

/** One stored record: the store's own id (monotonic across sessions), its session, time and size. */
export interface StoredLog {
  readonly id: number;
  readonly session: number;
  /** Epoch ms of the record (pruning by age). */
  readonly ts: number;
  /** UTF-8 bytes of the record's JSON. */
  readonly bytes: number;
  readonly record: LogRecord;
}

export interface LogSessionInfo {
  readonly session: number;
  readonly count: number;
  readonly bytes: number;
  readonly firstTs: number;
  readonly lastTs: number;
  readonly lastId: number;
}

/**
 * IndexedDB `cg-logs` as the platform (R07) implements it: one object store
 * keyed by `id` with indexes by session and by ts. Every method may reject;
 * the service survives it.
 */
export interface LogStorePort {
  /** Appends rows in one transaction. */
  append(rows: readonly StoredLog[]): Promise<void>;
  /** Totals per stored session, oldest session first. */
  sessions(): Promise<readonly LogSessionInfo[]>;
  /** The newest `limit` rows of a session, oldest first. */
  tail(session: number, limit: number): Promise<readonly StoredLog[]>;
  /**
   * 2026-10-21 («Скачать лог»): the newest `limit` rows of every session — only those at or after `since` (epoch ms)
   * when it is given — oldest first.
   */
  newest(limit: number, since?: number): Promise<readonly StoredLog[]>;
  /** Deletes the `count` rows with the smallest ids (the oldest, whatever their session). */
  dropOldest(count: number): Promise<void>;
  /** Deletes every session below `session`. */
  dropSessionsBefore(session: number): Promise<void>;
  /** Deletes rows with ts below `ts`. */
  dropBefore(ts: number): Promise<void>;
  clear(): Promise<void>;
}

export interface LogStoreLimits {
  readonly sessionsKept: number;
  readonly maxRecords: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
}

export const LOG_STORE_LIMITS: LogStoreLimits = {
  sessionsKept: LOG_LIMITS.sessionsKept,
  maxRecords: LOG_LIMITS.idbMaxRecords,
  maxBytes: LOG_LIMITS.idbMaxBytes,
  maxAgeMs: LOG_LIMITS.idbMaxAgeMs,
};

/** How the service writes: a batch after `flushDelayMs`, or at once when `batchMax` records wait. */
export const LOG_WRITE_POLICY = {
  flushDelayMs: 500,
  batchMax: 200,
  /** Records waiting for the store; beyond it the oldest go and are counted. */
  pendingMax: 2000,
  /** Pruning removes this share more than the excess, so it does not run on every write. */
  pruneHeadroom: 0.1,
  /** Age pruning runs on open and then at most this often. */
  agePruneEveryMs: 60 * 60 * 1000,
  /** A failure is reported to `onFailure` at most this often (it logs, which writes again). */
  failureReportEveryMs: 60 * 1000,
} as const;

export interface LogStoreStats {
  /** The store opened; false — memory only (the ring still works). */
  readonly available: boolean;
  readonly session: number | null;
  readonly records: number;
  readonly bytes: number;
  readonly sessions: number;
  readonly pending: number;
  readonly written: number;
  /** Lost before reaching the store: the pending overflow and failed writes. */
  readonly lost: number;
  /** Removed by the limits (records, bytes, age, sessions). */
  readonly pruned: number;
  readonly failures: number;
}

export type LogStoreFailure = 'open' | 'append' | 'prune' | 'read' | 'clear';

export interface LogServiceOptions {
  readonly store: LogStorePort;
  readonly scheduler: Scheduler;
  readonly limits?: LogStoreLimits;
  /** A failure of the store, at most once a minute: the composition root logs `logStoreFailed`. */
  readonly onFailure?: (what: LogStoreFailure) => void;
}

interface Totals {
  count: number;
  bytes: number;
}

function sumSessions(sessions: readonly LogSessionInfo[]): Totals {
  return sessions.reduce<Totals>((acc, s) => ({ count: acc.count + s.count, bytes: acc.bytes + s.bytes }), { count: 0, bytes: 0 });
}

function recordTs(record: LogRecord, fallback: number): number {
  const at = Date.parse(record.ts);
  return Number.isFinite(at) ? at : fallback;
}

export class LogService {
  private readonly limits: LogStoreLimits;
  private pending: LogRecord[] = [];
  private session: number | null = null;
  private available = false;
  private opened = false;
  private nextId = 1;
  private sessionsKnown: LogSessionInfo[] = [];
  private totals: Totals = { count: 0, bytes: 0 };
  private written = 0;
  private lost = 0;
  private pruned = 0;
  private failures = 0;
  private lastFailureReport = Number.NEGATIVE_INFINITY;
  private lastAgePrune = Number.NEGATIVE_INFINITY;
  private cancelTimer: (() => void) | null = null;
  private chain: Promise<void> = Promise.resolve();

  /** The logger's sink: `createLogger({ sinks: [logs.sink] })`. */
  readonly sink: LogSink = (record) => {
    this.push(record);
  };

  constructor(private readonly options: LogServiceOptions) {
    this.limits = options.limits ?? LOG_STORE_LIMITS;
  }

  /**
   * Opens the store and picks the log session: `resume` continues it when it
   * is the newest stored one, anything else starts the next number. Prunes
   * old sessions and old records. Returns the session (the composition root
   * keeps it in storage.session); never rejects.
   */
  open(resume: number | null): Promise<number> {
    const work = this.serial(async () => {
      let sessions: readonly LogSessionInfo[] = [];
      try {
        sessions = await this.options.store.sessions();
        this.available = true;
      } catch {
        this.fail('open');
        this.available = false;
      }
      const newest = sessions.at(-1);
      const maxSession = sessions.reduce((max, s) => Math.max(max, s.session), 0);
      this.nextId = sessions.reduce((max, s) => Math.max(max, s.lastId), 0) + 1;
      this.session = resume !== null && Number.isInteger(resume) && resume > 0 && (newest === undefined || resume >= maxSession) ? resume : maxSession + 1;
      this.sessionsKnown = [...sessions];
      this.totals = sumSessions(sessions);
      this.opened = true;
      if (this.available) {
        await this.pruneSessions();
        await this.pruneAge(true);
      }
    });
    return work.then(() => {
      // What was logged while the store opened goes out now.
      if (this.pending.length > 0) void this.flush();
      return this.session ?? 1;
    });
  }

  private push(record: LogRecord): void {
    try {
      this.pending.push(record);
      if (this.pending.length > LOG_WRITE_POLICY.pendingMax) {
        const over = this.pending.length - LOG_WRITE_POLICY.pendingMax;
        this.pending.splice(0, over);
        this.lost += over;
      }
      if (this.pending.length >= LOG_WRITE_POLICY.batchMax) {
        void this.flush();
        return;
      }
      if (this.cancelTimer !== null) return;
      this.cancelTimer = this.options.scheduler.after(LOG_WRITE_POLICY.flushDelayMs, () => {
        this.cancelTimer = null;
        void this.flush();
      });
    } catch {
      this.lost += 1;
    }
  }

  /** Writes what is pending now (also on suspend). Never rejects. */
  flush(): Promise<void> {
    if (this.cancelTimer !== null) {
      try {
        this.cancelTimer();
      } catch {
        // A timer that is already gone.
      }
      this.cancelTimer = null;
    }
    return this.serial(async () => {
      while (this.opened && this.pending.length > 0) {
        const batch = this.pending.splice(0, LOG_WRITE_POLICY.batchMax);
        if (!this.available || this.session === null) {
          this.lost += batch.length;
          continue;
        }
        const now = this.options.scheduler.now();
        const rows = batch.map((record): StoredLog => ({
          id: this.nextId++,
          session: this.session ?? 0,
          ts: recordTs(record, now),
          bytes: jsonBytes(record),
          record,
        }));
        try {
          await this.options.store.append(rows);
          this.written += rows.length;
          this.account(rows);
        } catch {
          this.lost += rows.length;
          this.fail('append');
        }
      }
      if (this.available) {
        await this.pruneSize();
        await this.pruneAge(false);
      }
    });
  }

  private account(rows: readonly StoredLog[]): void {
    const bytes = rows.reduce((sum, row) => sum + row.bytes, 0);
    this.totals = { count: this.totals.count + rows.length, bytes: this.totals.bytes + bytes };
    const session = this.session;
    if (session === null) return;
    const last = rows.at(-1);
    const first = rows[0];
    if (last === undefined || first === undefined) return;
    const index = this.sessionsKnown.findIndex((s) => s.session === session);
    const known = this.sessionsKnown[index];
    if (known === undefined) {
      this.sessionsKnown.push({ session, count: rows.length, bytes, firstTs: first.ts, lastTs: last.ts, lastId: last.id });
    } else {
      this.sessionsKnown[index] = { ...known, count: known.count + rows.length, bytes: known.bytes + bytes, lastTs: last.ts, lastId: last.id };
    }
  }

  private async refresh(): Promise<void> {
    try {
      const sessions = await this.options.store.sessions();
      this.sessionsKnown = [...sessions];
      this.totals = sumSessions(sessions);
    } catch {
      this.fail('read');
    }
  }

  private async pruneSessions(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    const keepFrom = session - (this.limits.sessionsKept - 1);
    if (!this.sessionsKnown.some((s) => s.session < keepFrom)) return;
    const before = this.totals.count;
    try {
      await this.options.store.dropSessionsBefore(keepFrom);
    } catch {
      this.fail('prune');
      return;
    }
    await this.refresh();
    this.pruned += Math.max(0, before - this.totals.count);
  }

  private async pruneSize(): Promise<void> {
    const overRecords = this.totals.count - this.limits.maxRecords;
    const overBytes = this.totals.bytes - this.limits.maxBytes;
    if (overRecords <= 0 && overBytes <= 0) return;
    // Bytes are turned into a record count by the average size; each limit adds its own headroom.
    const average = Math.max(1, this.totals.count > 0 ? this.totals.bytes / this.totals.count : 1);
    const headroom = LOG_WRITE_POLICY.pruneHeadroom;
    const byRecords = overRecords > 0 ? overRecords + Math.ceil(this.limits.maxRecords * headroom) : 0;
    const byBytes = overBytes > 0 ? Math.ceil((overBytes + this.limits.maxBytes * headroom) / average) : 0;
    const drop = Math.min(this.totals.count, Math.max(byRecords, byBytes));
    const before = this.totals.count;
    try {
      await this.options.store.dropOldest(drop);
    } catch {
      this.fail('prune');
      return;
    }
    await this.refresh();
    this.pruned += Math.max(0, before - this.totals.count);
  }

  private async pruneAge(force: boolean): Promise<void> {
    const now = this.options.scheduler.now();
    if (!force && now - this.lastAgePrune < LOG_WRITE_POLICY.agePruneEveryMs) return;
    this.lastAgePrune = now;
    const cutoff = now - this.limits.maxAgeMs;
    if (!this.sessionsKnown.some((s) => s.firstTs < cutoff)) return;
    const before = this.totals.count;
    try {
      await this.options.store.dropBefore(cutoff);
    } catch {
      this.fail('prune');
      return;
    }
    await this.refresh();
    this.pruned += Math.max(0, before - this.totals.count);
  }

  /** The newest `limit` records of this session, oldest first (LG-021). */
  recent(limit: number = LOG_LIMITS.exportRecentRecords): Promise<LogRecord[]> {
    return this.serial(async () => {
      const session = this.session;
      const stored = this.available && session !== null ? await this.readTail(session, limit) : [];
      // Records still waiting for the store are the newest of all.
      const take = Math.max(0, Math.floor(limit));
      return take === 0 ? [] : [...stored, ...this.pending].slice(-take);
    });
  }

  /**
   * The chatter's file (2026-10-21): every record of the last `windowMs` across sessions — every tab's and the
   * background's — and at least the newest `minRecords` however old, at most `maxRecords`, oldest first; the records
   * still waiting for the store are the newest of all.
   */
  window(options: { readonly windowMs: number; readonly minRecords: number; readonly maxRecords: number }): Promise<{ readonly records: LogRecord[]; readonly sessions: readonly number[] }> {
    return this.serial(async () => {
      const max = Math.max(0, Math.floor(options.maxRecords));
      const since = this.options.scheduler.now() - options.windowMs;
      let rows: readonly StoredLog[] = [];
      if (this.available && max > 0) {
        try {
          rows = await this.options.store.newest(max, since);
          if (rows.length < options.minRecords) rows = await this.options.store.newest(Math.min(max, Math.floor(options.minRecords)));
        } catch {
          this.fail('read');
          rows = [];
        }
      }
      // By the time each record names: a click is written once its answer came, stamped with the click's own time.
      const records = [...rows.map((row) => row.record), ...this.pending]
        .map((record, index) => ({ record, index, at: Date.parse(record.ts) }))
        .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.index - b.index))
        .map((entry) => entry.record)
        .slice(-max);
      const sessions = [...new Set(rows.map((row) => row.session))].sort((a, b) => a - b);
      return { records, sessions };
    });
  }

  /** The newest `limit` records of the session before this one: yesterday's failure in today's export (LG-023). */
  previousTail(limit: number): Promise<{ readonly session: number | null; readonly records: LogRecord[] }> {
    return this.serial(async () => {
      const session = this.session;
      const previous = this.sessionsKnown.filter((s) => session === null || s.session < session).at(-1);
      if (!this.available || previous === undefined) return { session: null, records: [] };
      return { session: previous.session, records: await this.readTail(previous.session, limit) };
    });
  }

  private async readTail(session: number, limit: number): Promise<LogRecord[]> {
    try {
      const rows = await this.options.store.tail(session, Math.max(0, Math.floor(limit)));
      return rows.map((row) => row.record);
    } catch {
      this.fail('read');
      return [];
    }
  }

  /** «Очистить локальные данные»: the store and the pending records; the session number stays. */
  clear(): Promise<void> {
    return this.serial(async () => {
      this.pending = [];
      try {
        await this.options.store.clear();
        this.sessionsKnown = [];
        this.totals = { count: 0, bytes: 0 };
      } catch {
        this.fail('clear');
      }
    });
  }

  stats(): LogStoreStats {
    return {
      available: this.available,
      session: this.session,
      records: this.totals.count,
      bytes: this.totals.bytes,
      sessions: this.sessionsKnown.length,
      pending: this.pending.length,
      written: this.written,
      lost: this.lost,
      pruned: this.pruned,
      failures: this.failures,
    };
  }

  private fail(what: LogStoreFailure): void {
    this.failures += 1;
    const now = this.options.scheduler.now();
    if (now - this.lastFailureReport < LOG_WRITE_POLICY.failureReportEveryMs) return;
    this.lastFailureReport = now;
    try {
      this.options.onFailure?.(what);
    } catch {
      // Reporting a failure never fails the log.
    }
  }

  /** One store operation at a time, in order; a failing step never breaks the chain. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

/**
 * The store in memory: the reference implementation of the port for tests
 * and the fallback when IndexedDB is unavailable (a private window).
 */
export class MemoryLogStore implements LogStorePort {
  private rows: StoredLog[] = [];

  append(rows: readonly StoredLog[]): Promise<void> {
    this.rows.push(...rows);
    return Promise.resolve();
  }

  sessions(): Promise<readonly LogSessionInfo[]> {
    const by = new Map<number, { count: number; bytes: number; firstTs: number; lastTs: number; lastId: number }>();
    for (const row of this.rows) {
      const info = by.get(row.session);
      if (info === undefined) by.set(row.session, { count: 1, bytes: row.bytes, firstTs: row.ts, lastTs: row.ts, lastId: row.id });
      else {
        info.count += 1;
        info.bytes += row.bytes;
        info.firstTs = Math.min(info.firstTs, row.ts);
        info.lastTs = Math.max(info.lastTs, row.ts);
        info.lastId = Math.max(info.lastId, row.id);
      }
    }
    return Promise.resolve([...by.entries()].sort((a, b) => a[0] - b[0]).map(([session, info]) => ({ session, ...info })));
  }

  tail(session: number, limit: number): Promise<readonly StoredLog[]> {
    const rows = this.rows.filter((row) => row.session === session).sort((a, b) => a.id - b.id);
    return Promise.resolve(limit <= 0 ? [] : rows.slice(-limit));
  }

  newest(limit: number, since?: number): Promise<readonly StoredLog[]> {
    const rows = this.rows.filter((row) => since === undefined || row.ts >= since).sort((a, b) => a.ts - b.ts || a.id - b.id);
    return Promise.resolve(limit <= 0 ? [] : rows.slice(-limit));
  }

  dropOldest(count: number): Promise<void> {
    this.rows = [...this.rows].sort((a, b) => a.id - b.id).slice(Math.max(0, count));
    return Promise.resolve();
  }

  dropSessionsBefore(session: number): Promise<void> {
    this.rows = this.rows.filter((row) => row.session >= session);
    return Promise.resolve();
  }

  dropBefore(ts: number): Promise<void> {
    this.rows = this.rows.filter((row) => row.ts >= ts);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.rows = [];
    return Promise.resolve();
  }

  get size(): number {
    return this.rows.length;
  }
}
