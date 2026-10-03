// `log.write` in the background (LG-011, ER-021, ER-022): records from a tab
// or an extension page arrive already redacted by their writer and at most
// 4 KiB each (the protocol layer checked LogRecordFromUiSchema). The
// background redacts them again — now with the live token and its tail,
// which a tab never holds — adds the sender's tab session, and hands them to
// the same sinks as its own records (the ring, the store, the journals).
// Debug records from a context whose debug switch lagged behind are dropped
// while debug mode is off. Never throws.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { type LogRecord } from '@cg/contracts/logs';
import { type Uuid } from '@cg/contracts/primitives';

import { redactRecord, type CodeCounters, type LogSink, type Redactor } from '../../domain/logging';

export interface UiRecordsOptions {
  readonly redactor: Pick<Redactor, 'text'>;
  readonly sinks: readonly LogSink[];
  readonly debugEnabled: () => boolean;
  /** The background's per-code daily counters: a tab's CG codes count too (LG-010). */
  readonly counters?: CodeCounters;
}

export interface UiRecordsSender {
  /** The sender's tab session, when the sender is a tab. */
  readonly tabSessionId?: Uuid;
}

/** Re-redacts and stores one `log.write` batch; returns the protocol's answer. */
export function acceptUiRecords(records: readonly LogRecord[], sender: UiRecordsSender, options: UiRecordsOptions): { accepted: number; dropped: number } {
  let accepted = 0;
  let dropped = 0;
  let debug: boolean;
  try {
    debug = options.debugEnabled();
  } catch {
    debug = false;
  }
  for (const record of records.slice(0, LOG_LIMITS.maxRecordsPerWrite)) {
    try {
      if (record.level === 'debug' && !debug) {
        dropped += 1;
        continue;
      }
      const clean = redactRecord(record, options.redactor, {
        maxBytes: LOG_LIMITS.maxRecordBytes,
        ...(sender.tabSessionId === undefined ? {} : { ctx: { tabSessionId: sender.tabSessionId } }),
      });
      for (const sink of options.sinks) {
        try {
          sink(clean);
        } catch {
          // One failing sink does not lose the record for the others.
        }
      }
      if (clean.code !== undefined) options.counters?.count(clean.code, Date.parse(clean.ts));
      accepted += 1;
    } catch {
      dropped += 1;
    }
  }
  dropped += Math.max(0, records.length - LOG_LIMITS.maxRecordsPerWrite);
  return { accepted, dropped };
}
