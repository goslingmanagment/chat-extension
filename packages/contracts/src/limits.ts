// Fixed numeric limits of the contracts (architecture.md §5.3, §7, §9.2, §9.4,
// §9.6, §6.7). Every world reads the same numbers; the MAIN bridge repeats the
// ones it needs as literals and its tests pin them to these. Limits that the
// hub hands out at run time (bootstrap `limits`) are not here.

const KiB = 1024;
const MiB = 1024 * KiB;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** MAIN ↔ isolated bridge (§5.3 «Пределы»). Everything that crosses from MAIN is held to these. */
export const BRIDGE_LIMITS = {
  /** One frame, measured as UTF-8 bytes of its JSON form. */
  maxFrameBytes: 256 * KiB,
  /** Any single string value or key. */
  maxStringLength: 20_000,
  /** Messages in one snapshot of a chat (tail, window). */
  maxSnapshotMessages: 200,
  /** Elements in any one array; specific schemas cap tighter. */
  maxArrayLength: 1000,
  /** Keys in any one object. */
  maxObjectKeys: 256,
  /** Nesting depth of a frame. */
  maxDepth: 16,
  /** UI-bound events per second; extra ones are coalesced (never freshness and receipt events). */
  uiEventsPerSecond: 50,
  /** Ordinary request timeout. */
  callTimeoutMs: 2 * SECOND,
  /** Navigation with a follow-up insert; the bootstrap value `limits.navInsertTimeoutSec` overrides it. */
  navInsertTimeoutDefaultMs: 20 * SECOND,
} as const;

/** Operation scheduler (§7, А3). */
export const OP_LIMITS = {
  /** Operations per chat across the whole extension (any feature, any surface). */
  perChat: 1,
  /** Operations per tab; the fourth is refused with the list of the three. */
  perTab: 3,
  /** How long results stay in storage.session. */
  resultTtlMs: 30 * MINUTE,
  /** Stream text is forwarded to the tab in batches of this period. */
  updateBatchMs: 50,
  /** The only automatic retry: a structured service_unavailable before the first output frame. */
  serviceUnavailableRetries: 1,
  serviceUnavailableRetryDelayMs: 5 * SECOND,
} as const;

/** Storage caps (§9.4 «Пределы хранилищ»). */
export const STORAGE_LIMITS = {
  resultsPerTab: 24,
  resultsTotalBytes: 4 * MiB,
  coachSessions: 5,
  coachExchangesPerSession: 50,
  coachTotalBytes: 2 * MiB,
  previewFeeds: 10,
  previewFeedMessages: 100,
  previewFeedsTotalBytes: 2 * MiB,
  /** Visible rows of any list; the rest stays behind the server cursor, marked "truncated". */
  listVisibleRows: 1000,
  previewDrafts: 100,
  previewDraftsTotalBytes: 1 * MiB,
  previewDraftTtlMs: 24 * 60 * MINUTE,
} as const;

/** X8 preview send (§6.7). */
export const SEND_LIMITS = {
  /** Characters of a preview draft, all parts together (§6.7.1). */
  previewDraftMaxChars: 5000,
  /** While the archive lags behind a held send: poll the hub this often, for this long (§6.7.5). */
  archivePollMs: 5 * SECOND,
  archivePollMaxMs: 2 * MINUTE,
  /** ChatSpace's own native send timeout (`notificationEntry:1425`); after it the outcome is uncertain. */
  nativeTimeoutMs: 30 * SECOND,
  /** Per-chat entries in ChatSpace's queue at which it refuses (`notificationEntry:1426, 1544`). */
  nativeQueueMaxPerChat: 50,
} as const;

/** Logs (§9.2, LG-004…LG-012, LG-023). */
export const LOG_LIMITS = {
  maxDepth: 8,
  maxArrayLength: 100,
  maxObjectKeys: 100,
  maxStringLength: 20_000,
  /** One record after redaction and truncation. */
  maxRecordBytes: 8 * KiB,
  /** One record sent from a tab or page to the background. */
  maxRecordBytesFromUi: 4 * KiB,
  /** Records per `log.write` request. */
  maxRecordsPerWrite: 50,
  /** In-memory ring per context. */
  ringSize: 1000,
  /** IndexedDB `cg-logs`: current + two previous sessions, whichever limit comes first. */
  sessionsKept: 3,
  idbMaxRecords: 20_000,
  idbMaxBytes: 10 * MiB,
  idbMaxAgeMs: 7 * 24 * 60 * MINUTE,
  /** «Новые» check journal (NF-029). */
  newcomersJournalRuns: 8,
  newcomersJournalEvents: 100_000,
  newcomersJournalBytes: 10 * MiB,
  /** Diagnostics export (LG-020…LG-025). */
  exportMaxBytes: 2 * MiB,
  exportRecentRecords: 500,
} as const;

/** Telemetry queue and client_health (§9.6, TL-009…TL-012). */
export const TELEMETRY_LIMITS = {
  queueMaxEvents: 500,
  batchMaxEvents: 100,
  batchDebounceMs: 1 * SECOND,
  /** Pauses between the five delivery attempts. */
  retryDelaysMs: [1 * SECOND, 2 * SECOND, 4 * SECOND, 8 * SECOND, 16 * SECOND],
  healthWindowMs: 15 * MINUTE,
  healthMinIntervalMs: 60 * SECOND,
  /** Handlers are measured 1 in this many; rare latency events always. */
  handlerSampleRate: 20,
  /** client_health report caps (hub H-11a). */
  healthMaxPerf: 16,
  healthMaxCounters: 200,
  healthMaxListItems: 64,
  healthMaxCounterValue: 1_000_000,
} as const;

/** Debug prompt snapshots (§9.3, DB-004, DB-005). */
export const DEBUG_LIMITS = {
  promptSnapshotTtlMs: 12 * MINUTE,
  promptSnapshotsKept: 10,
  promptBlockMaxChars: 500_000,
  promptManifestMaxChars: 100_000,
} as const;
