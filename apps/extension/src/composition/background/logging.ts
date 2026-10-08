// The background's log (architecture.md §9.2, D-21; R18's parts over R07's
// store): one logger for every service of the event page, redacted once
// before the console, the ring, the IndexedDB store and the debug journals;
// per-code counters of the day; `log.write` records of tabs and pages redacted
// a second time with the live token. Texts of conversations, drafts, prompts
// and model output never reach it — the services log facts only.
//
// The day's counters (LG-010) are kept in storage.local: «Ошибки за сегодня»
// and the export's `counters.today` are the calendar day's, whatever happened
// to the add-on in between — the event page unloaded, the add-on updated or
// reinstalled, the browser restarted (storage.session, where they lived
// before, is emptied by each of the last three). Codes and counts of today
// and of the day before, nothing else; «Очистить локальные данные» empties
// them; a sign-out leaves them, as it leaves the log. They are written two
// seconds after a change and never in `runtime.onSuspend`: a storage write
// there comes back to the page as `storage.onChanged`, and an event that
// reaches a page being suspended cancels its unload — the event page would
// never go. An idle page is unloaded after 30 s, long after the last write;
// a browser closed within those two seconds loses the last counts only.

import { type LogRecord } from '@cg/contracts/logs';
import { LOG_DB_NAME } from '@cg/contracts/settings';
import { CodeCounters, createLogger, createRedactor, logEvent, type ConsolePort, type LogCtx, type Logger, type Redactor } from '@cg/core/domain/logging';
import { LOCAL_KEYS } from '@cg/core/domain';
import { DebugJournals, LogService, acceptUiRecords } from '@cg/core/services/logs';
import { openBoundedStore, type KeyValueStore } from '@cg/platform';

import { LOG_STORE_BOUNDS, logStoreOver } from './log-store';
import { IDS, SCHEDULER, keyOf } from './ports';

/** storage.session: the log session survives the event page unloading, not a browser restart (§9.2). */
export const LOG_SESSION_KEY = 'log.session';
/** storage.local: the counters of today and of the day before, by CG code (LG-010). */
export const LOG_COUNTERS_KEY = LOCAL_KEYS.dayCounters;
/** The scope of the background's «Новые» checks: the subscriber poll, a tab's list read, the greeting leases. */
export const NEWCOMERS_SCOPE = 'bg.newcomers';
/** The counters are saved at most this often after a change. */
const COUNTERS_SAVE_DELAY_MS = 2000;

/* eslint-disable no-console -- the one console port of the event page (LG-001, LG-002): records are redacted before they reach it */
const CONSOLE: ConsolePort = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};
/* eslint-enable no-console */

export interface BackgroundLogging {
  readonly logger: Logger;
  readonly redactor: Redactor;
  readonly logs: LogService;
  readonly journals: DebugJournals;
  readonly counters: CodeCounters;
  /** Readiness step: opens the store, continues or starts the log session, restores the day's counters. Never rejects. */
  start(): Promise<void>;
  /** «Очистить локальные данные»: the kept days are emptied, in memory and in storage. Never rejects. */
  clearCounters(): Promise<void>;
  /** What the kept counters take in storage.local, in bytes. */
  countersBytes(): number;
  /** `log.write` from a tab or a page. */
  acceptUi(records: readonly LogRecord[], tabSessionId: string | null): { accepted: number; dropped: number };
}

export interface BackgroundLoggingDeps {
  readonly session: KeyValueStore;
  readonly local: KeyValueStore;
  readonly debugEnabled: () => boolean;
  /** Default ctx of every record (the sign-in epoch). */
  readonly ctx: () => Partial<LogCtx> | undefined;
  /** COUNTERS_SAVE_DELAY_MS, for a test that cannot wait. */
  readonly countersSaveDelayMs?: number;
}

export function createBackgroundLogging(deps: BackgroundLoggingDeps): BackgroundLogging {
  const redactor = createRedactor();
  const counters = new CodeCounters(Date.now());
  const journals = new DebugJournals(deps.debugEnabled);
  const sessionKey = keyOf(deps.session, LOG_SESSION_KEY);
  const countersKey = keyOf(deps.local, LOG_COUNTERS_KEY);
  let cancelSave: (() => void) | null = null;
  /** The stored days are in the counters: before that a save would write this instance's few counts over the day's. */
  let countersRead = false;

  const writeCounters = (): Promise<void> => {
    cancelSave?.();
    cancelSave = null;
    if (!countersRead) return Promise.resolve();
    return countersKey.save(counters.days(Date.now())).catch(() => undefined);
  };
  const saveCounters = (): void => {
    if (cancelSave !== null) return;
    cancelSave = SCHEDULER.after(deps.countersSaveDelayMs ?? COUNTERS_SAVE_DELAY_MS, () => {
      cancelSave = null;
      void writeCounters();
    });
  };

  const logs: LogService = new LogService({
    store: logStoreOver(() => openBoundedStore({ dbName: LOG_DB_NAME, ...LOG_STORE_BOUNDS })),
    scheduler: SCHEDULER,
    onFailure: (what) => logEvent(logger, 'logStoreFailed', { fields: { what } }),
  });

  // NF-029 «Журнал проверки «Новых»»: one run per life of the event page — every read of the list for the
  // subscriber sound and every move of a greeting lease, as metadata (page ids, counts, states).
  const checkRun = journals.newcomersSink(IDS.uuid(), new Date().toISOString());

  const logger: Logger = createLogger({
    now: () => Date.now(),
    debugEnabled: deps.debugEnabled,
    redactor,
    console: CONSOLE,
    counters,
    ctx: deps.ctx,
    sinks: [
      logs.sink,
      journals.sink,
      (record) => {
        if (record.scope === NEWCOMERS_SCOPE) checkRun(record);
      },
      (record) => {
        if (record.code !== undefined) saveCounters();
      },
    ],
  });

  return {
    logger,
    redactor,
    logs,
    journals,
    counters,
    async start() {
      const [resume, stored] = await Promise.all([sessionKey.load().catch(() => null), countersKey.load().then((value) => ({ value }), () => null)]);
      // Unreadable days are not written over: this instance counts on its own, and the next one reads them again.
      if (stored !== null) {
        counters.restore(stored.value, Date.now());
        countersRead = true;
        // What this instance counted before the read is part of the day now.
        if (counters.sessionCounts().length > 0) saveCounters();
      }
      const session = await logs.open(typeof resume === 'number' ? resume : null);
      await sessionKey.save(session).catch(() => undefined);
    },
    clearCounters() {
      counters.clearDays(Date.now());
      countersRead = true;
      return writeCounters();
    },
    countersBytes: () => JSON.stringify(counters.days(Date.now())).length,
    acceptUi(records, tabSessionId) {
      const answer = acceptUiRecords(records, tabSessionId === null ? {} : { tabSessionId }, {
        redactor,
        sinks: [logs.sink, journals.sink],
        debugEnabled: deps.debugEnabled,
        counters,
      });
      if (answer.accepted > 0) saveCounters();
      return answer;
    },
  };
}
