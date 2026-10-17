// Fixed numeric limits of the contracts (architecture.md §5.3, §7, §9.2, §9.4,
// §9.6, §6.7). Every world reads the same numbers; the MAIN bridge repeats the
// ones it needs as literals and its tests pin them to these. Limits that the
// hub hands out at run time (bootstrap `limits`) are not here.
//
// Plain data only, no schema constructors: a bundle that needs a number pays
// for the number, not for the schema module next to it (zod/mini builders are
// not pure-annotated, so importing a constant from a schema module keeps the
// whole module).

import { type FeatureId } from './features';

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
  /** `op.list` with scope `all`: the newest across tabs, the rest cut and flagged `truncated`. */
  opListMax: 200,
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
  /**
   * 1.20.0 (decision X47): a draft of a greeting or a preview stays until it is sent or cleared, at most 7 days
   * (it was 24 hours). The count and byte caps above stay.
   */
  previewDraftTtlMs: 7 * 24 * 60 * MINUTE,
  /** Host accounts kept in the `presence` store. */
  seenAccountsMax: 500,
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
  /** Fan message ids a checkpoint names for the served-context check: the bounded set of §6.7.5, newest first. */
  knownFanMessagesMax: 10,
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

/**
 * Bounds of the hub's AI stream body (`aiFeatureStreamBodySchema`, vendored
 * SDK) that our own boundaries repeat, so that a StartOp or a UserOptions the
 * schemas accept is a body the hub accepts too (§8.4).
 */
export const AI_REQUEST_LIMITS = {
  /** `messageCount` (Б5, HF-6): wire ceiling; admission still obeys bootstrap `limits.deepMax`. */
  messageCountMin: 5,
  messageCountMax: 5000,
  /** `personaKey` and the catalog's `key`. */
  personaKeyMaxChars: 120,
  /** `draftText`: Fix's source, Coach's attached draft. */
  draftMaxChars: 20_000,
} as const;

/** Sign-in fields as the hub's device-token route takes them (`authIssueDeviceTokenWithPassword`). */
export const SIGN_IN_LIMITS = { loginMaxChars: 100, passwordMaxChars: 1024 } as const;

/** Coach (AI-080…AI-100). Question and history bounds are the hub body's (`chatterQuestion`, `coachHistory`). */
export const COACH_LIMITS = {
  /** AI-082 «до 2000 символов»; hub `chatterQuestion` and `coachHistory[].question`. */
  questionMaxChars: 2000,
  /** Hub COACH_ANSWER_MAX_CHARS. */
  answerMaxChars: 64_000,
  historyMaxTurns: 20,
  draftMaxChars: 1500,
  draftsMax: 2,
} as const;

/**
 * One part of one result: `variant` for Hi (up to 3 variants), `index` for
 * Split parts (up to 10). Same bounds as the hub's claim group (H-7).
 */
export const PART_LIMITS = { maxVariants: 3, maxParts: 10 } as const;

/** Hub limits for fresh text (H-4c `AI_LIVE_TEXT_MAX_ITEMS` / `_MAX_CHARS`). */
export const LIVE_TEXT_LIMITS = { maxItems: 60, maxChars: 5000 } as const;

/**
 * 1.15.0 (R20): hub limits of the window coverage check (HF-8в `AI_COVERAGE_CHECK_WINDOW_MAX` / `_DELETED_MAX`):
 * the ids of the check window and the ids of its messages the tab saw deleted, each list at most this many.
 */
export const COVERAGE_CHECK_LIMITS = { windowMax: 60, deletedMax: 60 } as const;

/**
 * 1.15.0 (R20 P4b3): hub limits of «Заполнить из чата» (`fan-notes-fill`: `AI_NOTE_FIELDS_MAX`,
 * `AI_NOTE_FIELD_LABEL_MAX_CHARS`, `AI_NOTE_VALUE_MAX_CHARS`): the questionnaire's labels in the body, each one
 * trimmed, and the value one label gets back — one line of the note.
 */
export const NOTE_FILL_LIMITS = { fieldsMax: 30, labelMaxChars: 60, valueMaxChars: 2000 } as const;

/** Starting timeouts per feature, ms (§7 «Тайм-ауты»); refined by lab measurements. */
export interface OpTimeouts {
  /** From the request until the `meta` frame. */
  readonly untilMetaMs: number;
  /** From `meta` until the first output chunk. */
  readonly firstChunkAfterMetaMs: number;
  /** Longest silence between frames. */
  readonly silenceMs: number;
  /** Whole operation. */
  readonly maxMs: number;
}

const s = (seconds: number): number => seconds * SECOND;
const QUICK: OpTimeouts = { untilMetaMs: s(30), firstChunkAfterMetaMs: s(30), silenceMs: s(30), maxMs: s(60) };
const DEEP: OpTimeouts = { untilMetaMs: s(180), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(300) };

export const OP_TIMEOUTS: Readonly<Record<FeatureId, OpTimeouts>> = {
  reply: QUICK,
  fix: QUICK,
  hi: QUICK,
  ping: QUICK,
  'recap-short': { untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(120) },
  review: DEEP,
  recap: DEEP,
  coach: { untilMetaMs: s(60), firstChunkAfterMetaMs: s(45), silenceMs: s(45), maxMs: s(180) },
};
