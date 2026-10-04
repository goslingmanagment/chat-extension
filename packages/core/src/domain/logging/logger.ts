// The logger of one context — the background, a tab, an extension page
// (architecture.md §9.2; LG-001, LG-002, LG-004, LG-006, LG-010, LG-012).
//
// - `debug` records exist only in debug mode; `info`/`warn`/`error` always.
// - Every record is redacted once, here, before the console, the ring and
//   any sink; the sink (IndexedDB in the background, `log.write` from a tab)
//   gets the finished record.
// - The logger never throws and never waits: sinks are called synchronously
//   with a finished record and must hand the work off themselves; a sink or
//   console that throws is counted and ignored.
// - Records with a CG code feed the per-code daily counters.

import { type CgCode } from '@cg/contracts/errors';
import { LOG_LIMITS } from '@cg/contracts/limits';
import { type LogLevel, type LogRecord } from '@cg/contracts/logs';

import { CodeCounters } from './counters';
import { buildRecord, formatRecordLine, type LogCtx, type RecordInput } from './record';
import { createRedactor, type Redactor } from './redact';
import { Ring } from './ring';

/** Where a context's console output goes (core has no `console`; the composition root passes it). */
export interface ConsolePort {
  debug(line: string): void;
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
}

export type LogSink = (record: LogRecord) => void;

export interface LogOptions {
  readonly code?: CgCode;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly error?: unknown;
  readonly ctx?: Partial<LogCtx>;
}

export interface LoggerStats {
  readonly written: number;
  /** Debug records skipped because debug mode is off. */
  readonly skippedDebug: number;
  /** Sink or console calls that threw. */
  readonly sinkFailures: number;
  readonly consoleFailures: number;
  /** Ring records pushed out by newer ones. */
  readonly ringOverwritten: number;
  readonly byLevel: Readonly<Record<LogLevel, number>>;
}

export interface Logger {
  debug(scope: string, msg: string, options?: LogOptions): LogRecord | null;
  info(scope: string, msg: string, options?: LogOptions): LogRecord | null;
  warn(scope: string, msg: string, options?: LogOptions): LogRecord | null;
  error(scope: string, msg: string, options?: LogOptions): LogRecord | null;
  write(level: LogLevel, scope: string, msg: string, options?: LogOptions): LogRecord | null;
  /** A logger with extra default ctx (an operation, an attempt); same ring, sinks and counters. */
  child(ctx: Partial<LogCtx>): Logger;
  /** The ring of this context, oldest first. */
  recent(limit?: number): LogRecord[];
  stats(): LoggerStats;
  readonly redactor: Redactor;
  readonly counters: CodeCounters;
}

export interface LoggerOptions {
  readonly now: () => number;
  /** Debug mode (`debug.enabled`, ST-097): debug records and console debug output. */
  readonly debugEnabled: () => boolean;
  readonly redactor?: Redactor;
  readonly console?: ConsolePort | null;
  readonly sinks?: readonly LogSink[];
  /** Default ctx of every record (the tab session, the sign-in epoch). */
  readonly ctx?: () => Partial<LogCtx> | undefined;
  /** 8 KiB in the background; tabs and pages pass LOG_LIMITS.maxRecordBytesFromUi. */
  readonly maxRecordBytes?: number;
  readonly ringSize?: number;
  readonly counters?: CodeCounters;
}

const CONSOLE_PREFIX = '[ChatGoose]';

interface Shared {
  readonly options: LoggerOptions;
  readonly redactor: Redactor;
  readonly ring: Ring<LogRecord>;
  readonly counters: CodeCounters;
  seq: number;
  written: number;
  skippedDebug: number;
  sinkFailures: number;
  consoleFailures: number;
  readonly byLevel: Record<LogLevel, number>;
}

function safeNow(options: LoggerOptions): number {
  try {
    const now = options.now();
    return Number.isFinite(now) ? now : 0;
  } catch {
    return 0;
  }
}

function safeDebug(options: LoggerOptions): boolean {
  try {
    return options.debugEnabled();
  } catch {
    return false;
  }
}

function emitConsole(shared: Shared, record: LogRecord, debugOn: boolean): void {
  const port = shared.options.console;
  if (port === undefined || port === null) return;
  // LG-001/LG-002: debug and info only in debug mode; warnings and errors always.
  if ((record.level === 'debug' || record.level === 'info') && !debugOn) return;
  try {
    port[record.level](`${CONSOLE_PREFIX} ${formatRecordLine(record)}`);
  } catch {
    shared.consoleFailures += 1;
  }
}

function makeLogger(shared: Shared, extraCtx: Partial<LogCtx>): Logger {
  const write = (level: LogLevel, scope: string, msg: string, options: LogOptions = {}): LogRecord | null => {
    try {
      const debugOn = safeDebug(shared.options);
      if (level === 'debug' && !debugOn) {
        shared.skippedDebug += 1;
        return null;
      }
      const now = safeNow(shared.options);
      let baseCtx: Partial<LogCtx> | undefined;
      try {
        baseCtx = shared.options.ctx?.();
      } catch {
        baseCtx = undefined;
      }
      shared.seq += 1;
      const input: { -readonly [K in keyof RecordInput]: RecordInput[K] } = {
        level,
        scope,
        msg,
        ctx: { ...(baseCtx ?? {}), ...extraCtx, ...(options.ctx ?? {}) },
      };
      if (options.code !== undefined) input.code = options.code;
      if (options.fields !== undefined) input.fields = options.fields;
      if (options.error !== undefined) input.error = options.error;
      const record = buildRecord(input, {
        now,
        seq: shared.seq,
        redactor: shared.redactor,
        maxBytes: shared.options.maxRecordBytes ?? LOG_LIMITS.maxRecordBytes,
      });
      shared.ring.push(record);
      shared.written += 1;
      shared.byLevel[record.level] += 1;
      if (record.code !== undefined) shared.counters.count(record.code, now);
      emitConsole(shared, record, debugOn);
      for (const sink of shared.options.sinks ?? []) {
        try {
          sink(record);
        } catch {
          shared.sinkFailures += 1;
        }
      }
      return record;
    } catch {
      return null;
    }
  };
  return {
    debug: (scope, msg, options) => write('debug', scope, msg, options),
    info: (scope, msg, options) => write('info', scope, msg, options),
    warn: (scope, msg, options) => write('warn', scope, msg, options),
    error: (scope, msg, options) => write('error', scope, msg, options),
    write,
    child: (ctx) => makeLogger(shared, { ...extraCtx, ...ctx }),
    recent: (limit) => (limit === undefined ? shared.ring.toArray() : shared.ring.tail(limit)),
    stats: () => ({
      written: shared.written,
      skippedDebug: shared.skippedDebug,
      sinkFailures: shared.sinkFailures,
      consoleFailures: shared.consoleFailures,
      ringOverwritten: shared.ring.overwritten,
      byLevel: { ...shared.byLevel },
    }),
    redactor: shared.redactor,
    counters: shared.counters,
  };
}

export function createLogger(options: LoggerOptions): Logger {
  const shared: Shared = {
    options,
    redactor: options.redactor ?? createRedactor(),
    ring: new Ring<LogRecord>(options.ringSize ?? LOG_LIMITS.ringSize),
    counters: options.counters ?? new CodeCounters(safeNow(options)),
    seq: 0,
    written: 0,
    skippedDebug: 0,
    sinkFailures: 0,
    consoleFailures: 0,
    byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
  };
  return makeLogger(shared, {});
}
