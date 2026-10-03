// The background's log (architecture.md §9.2, D-21; R18's parts over R07's
// store): one logger for every service of the event page, redacted once
// before the console, the ring, the IndexedDB store and the debug journals;
// per-code counters of the day; `log.write` records of tabs and pages redacted
// a second time with the live token. Texts of conversations, drafts, prompts
// and model output never reach it — the services log facts only.

import { type LogRecord } from '@cg/contracts/logs';
import { LOG_DB_NAME } from '@cg/contracts/settings';
import { CodeCounters, createLogger, createRedactor, logEvent, type ConsolePort, type LogCtx, type Logger, type Redactor } from '@cg/core/domain/logging';
import { DebugJournals, LogService, acceptUiRecords } from '@cg/core/services/logs';
import { openBoundedStore, type KeyValueStore } from '@cg/platform';

import { LOG_STORE_BOUNDS, logStoreOver } from './log-store';
import { SCHEDULER, keyOf } from './ports';

/** storage.session: the log session survives the event page unloading, not a browser restart (§9.2). */
export const LOG_SESSION_KEY = 'log.session';
/** storage.session: today's counters by CG code (LG-010). */
export const LOG_COUNTERS_KEY = 'log.counters';
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
  /** `log.write` from a tab or a page. */
  acceptUi(records: readonly LogRecord[], tabSessionId: string | null): { accepted: number; dropped: number };
}

export interface BackgroundLoggingDeps {
  readonly session: KeyValueStore;
  readonly debugEnabled: () => boolean;
  /** Default ctx of every record (the sign-in epoch). */
  readonly ctx: () => Partial<LogCtx> | undefined;
}

export function createBackgroundLogging(deps: BackgroundLoggingDeps): BackgroundLogging {
  const redactor = createRedactor();
  const counters = new CodeCounters(Date.now());
  const journals = new DebugJournals(deps.debugEnabled);
  const sessionKey = keyOf(deps.session, LOG_SESSION_KEY);
  const countersKey = keyOf(deps.session, LOG_COUNTERS_KEY);
  let cancelSave: (() => void) | null = null;

  const saveCounters = (): void => {
    if (cancelSave !== null) return;
    cancelSave = SCHEDULER.after(COUNTERS_SAVE_DELAY_MS, () => {
      cancelSave = null;
      void countersKey.save(counters.snapshot(Date.now())).catch(() => undefined);
    });
  };

  const logs: LogService = new LogService({
    store: logStoreOver(() => openBoundedStore({ dbName: LOG_DB_NAME, ...LOG_STORE_BOUNDS })),
    scheduler: SCHEDULER,
    onFailure: (what) => logEvent(logger, 'logStoreFailed', { fields: { what } }),
  });

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
      const [resume, stored] = await Promise.all([sessionKey.load().catch(() => null), countersKey.load().catch(() => null)]);
      counters.restore(stored, Date.now());
      const session = await logs.open(typeof resume === 'number' ? resume : null);
      await sessionKey.save(session).catch(() => undefined);
    },
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
