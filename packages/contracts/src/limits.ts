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
  /** A whole batch (`BATCH_LIMITS.picks`) and the dock's own results. */
  resultsPerTab: 64,
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
  /**
   * Drafts of all lists in the one store, the oldest go first: several whole batches of «Новые» (`BATCH_LIMITS.picks`
   * each) with room for the previews — at 100 a second batch dropped the first one's unsent greetings.
   */
  previewDrafts: 400,
  /** The store's key whole, its removal marks too; the oldest drafts go first past it. */
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

/**
 * Logs (§9.2, LG-004…LG-012, LG-023). 2026-10-21 (the chatter's full log): the chatter sends the owner the file of
 * a shift when something does not work, so the store keeps at least a day of every tab and the background — what
 * was pressed, what the extension decided and why, the configuration — and the file carries the last 24 hours.
 */
export const LOG_LIMITS = {
  maxDepth: 8,
  maxArrayLength: 100,
  maxObjectKeys: 100,
  maxStringLength: 20_000,
  /** One record after redaction and truncation. */
  maxRecordBytes: 16 * KiB,
  /** One record sent from a tab or page to the background (a configuration snapshot fits). */
  maxRecordBytesFromUi: 12 * KiB,
  /** Records per `log.write` request. */
  maxRecordsPerWrite: 50,
  /** In-memory ring per context. */
  ringSize: 5000,
  /** IndexedDB `cg-logs`: the sessions (a browser start, an update) of a week at most, whichever limit comes first. */
  sessionsKept: 40,
  idbMaxRecords: 150_000,
  idbMaxBytes: 64 * MiB,
  idbMaxAgeMs: 7 * 24 * 60 * MINUTE,
  /** «Новые» check journal (NF-029). */
  newcomersJournalRuns: 8,
  newcomersJournalEvents: 100_000,
  newcomersJournalBytes: 10 * MiB,
  /** Diagnostics export (LG-020…LG-025): one file at most this size. */
  exportMaxBytes: 20 * MiB,
  /** The debug journals' reads (`journal.read`). */
  exportRecentRecords: 500,
  /** The file holds every record of this window, across sessions, tabs and the background… */
  exportWindowMs: 24 * 60 * MINUTE,
  /** …and at least this many of the newest ones, however old (a shift that ended days ago). */
  exportMinRecords: 3000,
  /** Records read for one file at most. */
  exportMaxRecords: 150_000,
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
  /**
   * 2026-10-27 (`coach-depth-v1`): Coach's own note that older messages would change its advice (a ```more block at
   * the end of its answer), as the window shows it over its two choices. A longer note is cut, never dropped.
   */
  moreMaxChars: 600,
} as const;

/**
 * One part of one result: `variant` for Hi (up to 3 variants), `index` for
 * Split parts (up to 10). Same bounds as the hub's claim group (H-7).
 */
export const PART_LIMITS = { maxVariants: 3, maxParts: 10 } as const;

/** 1.30.0 (X53): the media picker of a preview and the media a part takes along (media.ts). */
export const MEDIA_LIMITS = {
  /** Folders of one page: the API takes at most 10. */
  foldersPage: 10,
  /** Media of one page: ChatSpace's own vault dialog asks 40. */
  mediasPage: 40,
  /** Media of one message (OnlyFans and ChatSpace's composer take 40). */
  maxMedia: 40,
  /** Media ids of one status or release-form request (the API takes 100). */
  idsPerRequest: 100,
  /** A PPV price, cents: OnlyFans takes $3…$200 on a message. */
  priceMinCents: 300,
  priceMaxCents: 20_000,
  /** Characters of a thumbnail address (OnlyMonster's signed proxy addresses are ~1.3 KB). */
  maxThumbChars: 4096,
  /** MAIN aborts its request after this; the isolated side's deadline adds the frame. */
  requestMs: 10 * SECOND,
  bridgeMs: 12 * SECOND,
} as const;

/** Hub limits for fresh text (H-4c `AI_LIVE_TEXT_MAX_ITEMS` / `_MAX_CHARS`). */
export const LIVE_TEXT_LIMITS = { maxItems: 60, maxChars: 5000 } as const;

/**
 * Telegram spec §4.3, §6.2: the hub's bounds of `clientContext` (its `aiFeatureStreamBodySchema`): the transcript's
 * characters, its message count and the fan's name. The tab renders at most ~120 messages; a transcript longer than
 * the bound drops its oldest messages first.
 */
export const CLIENT_CONTEXT_LIMITS = { transcriptMaxChars: 300_000, messageCountMax: 5000, fanNameMaxChars: 200 } as const;

/**
 * 1.22.0 (X54): our own read of the open chat from OnlyMonster's API (`openChatMessages`). `pageMax` — messages one
 * request asks for (ChatSpace itself asks up to 100); `requestMs` — MAIN aborts its request after this; `bridgeMs` —
 * the isolated side's deadline for the answer (the request plus the frame); `cacheMs` — how long a read of the open
 * chat answers again without a new request, unless a message of that chat came in.
 */
export const OPEN_CHAT_LIMITS = { pageMax: 100, requestMs: 10 * SECOND, bridgeMs: 12 * SECOND, cacheMs: 15 * SECOND } as const;

/**
 * Whether the fan read our newest message (`chatReadState`, `fansly.preview.readState`), read live when a preview
 * opens. `usernameMax` — the longest username searched for; `bridgeMs` — the deadline of ChatSpace's answer: two
 * requests of OPEN_CHAT_LIMITS.requestMs each (the chat list, then the history's newest message); `freshMs` — a fan's
 * answer is shown again without a new read this long (a preview walked with J / K and back); `settleMs` — a preview
 * rests this long on a fan before the read goes, so a walk through the list asks nothing of the fans it passes;
 * `pollMs`, `pollForMs` — while the open preview says «не прочитано» it reads again this often, for at most this long
 * on the same fan (the old OnlyFans client's read-state sweep: 30 s, 10 min).
 */
export const CHAT_READ_LIMITS = { usernameMax: 100, bridgeMs: 22 * SECOND, freshMs: 30 * SECOND, settleMs: 600, pollMs: 30 * SECOND, pollForMs: 10 * MINUTE } as const;

/**
 * 2026-10-28 (the owner's exception to X54): OnlyMonster's own notes of the open chat's fan, read and written by MAIN
 * (`fanNotes`, `createFanNote`, `updateFanNote`, `deleteFanNote`; HostPort.fanNotes). `titleMax` — a note's title:
 * ChatSpace shows it as one cut line, so 200 characters hold any title a person gives there. `textMax` — a note's
 * body as the API keeps it (HTML or plain text): the bridge's longest string (BRIDGE_LIMITS.maxStringLength); the team's
 * notes run to a few hundred characters, and a longer one comes cut (`OmFanNote.cut`), never to be written back.
 * `listMax` — notes of one fan in an answer: the team keeps about five per fan, and ChatSpace's own tab lists them all
 * without pages. `bridgeMs` — the isolated side's deadline: MAIN's request (OPEN_CHAT_LIMITS.requestMs) and the frame.
 */
export const FAN_NOTES_LIMITS = { titleMax: 200, textMax: 20_000, listMax: 100, bridgeMs: 12 * SECOND } as const;

/**
 * 1.27.0 (X54): the PPV state of the open chat a draft start carries (`StartOp.livePpv`, hub `livePpvContext`).
 * `readMessages` — how many of the chat's newest messages the start reads from the host's API for it; `waitMs` — how
 * long the Generate click waits for that read beside the tail before it starts without it (the read goes on and fills
 * the port's cache for the next click); `maxItems` — the hub's `AI_LIVE_PPV_MAX_ITEMS`.
 */
export const LIVE_PPV_LIMITS = { readMessages: 50, waitMs: 1200, maxItems: 100 } as const;

/**
 * The fan's newest photos a Reply, Fix or Coach start carries as images (`StartOp.liveImages`, hub `liveImages`,
 * `live-images-v1`): the photos of the fan's latest turn — their messages after the model's last personal one — among
 * the open chat's `windowMessages` newest, at most `maxImages` (the hub's `AI_LIVE_IMAGES_MAX`), drawn from the page's
 * own media proxy as JPEG of at most `maxEdgePx` on the long edge. `perMessage` — the photos one message of the open
 * chat's page names; `urlMaxChars` — a photo's address; `dataMaxChars` — one image's base64 (the hub's
 * `AI_LIVE_IMAGE_DATA_MAX_CHARS`); `waitMs` — how long the click waits for the photos after the chat's page before it
 * starts with those that came.
 */
export const LIVE_IMAGE_LIMITS = {
  windowMessages: 10,
  maxImages: 3,
  perMessage: 4,
  maxEdgePx: 1024,
  jpegQuality: 0.82,
  urlMaxChars: 2048,
  dataMaxChars: 700_000,
  waitMs: 2000,
} as const;

/**
 * The media attached to the message being written that a Reply, Fix, Hi, Ping or Coach start carries (`StartOp.draftMedia`,
 * hub `draftMedia`, `draft-media-v1`): every medium of the composer, at most `itemsMax` (the hub's
 * `AI_DRAFT_MEDIA_ITEMS_MAX`, a message's own cap), and the pictures of the first `imagesMax` that show one (the hub's
 * `AI_DRAFT_MEDIA_IMAGES_MAX`) — drawn as JPEG with the live photos' bounds (`LIVE_IMAGE_LIMITS`). `waitMs` — how long the
 * click waits for the pictures beside its other reads; `priceMaxUsd` — the hub's `AI_DRAFT_MEDIA_PRICE_MAX_USD`;
 * `durationMaxSec` — a medium's length the hub takes.
 */
export const DRAFT_MEDIA_LIMITS = { itemsMax: 40, imagesMax: 4, waitMs: 1500, priceMaxUsd: 10_000, durationMaxSec: 86_400 } as const;

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

/**
 * 1.47.0: a file of ours into ChatSpace's composer (`attachFile`, HostPort.attachFile). `maxBytes` — the file (the voice
 * note's MP3: the hub's own cap, VOICE_LIMITS.audioMaxBytes); `watchMs` — how long MAIN looks for the composer's word on
 * it after the drop; `watchMaxMs` — the longest, while the site's upload of it is still on view; `bridgeMs` — the
 * isolated side's deadline for MAIN's answer.
 */
export const ATTACH_LIMITS = { maxBytes: 2 * MiB, watchMs: 60 * SECOND, watchMaxMs: 3 * MINUTE, bridgeMs: 3 * MINUTE + 5 * SECOND } as const;

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
/**
 * An operation that may think silently: the hub streams nothing while the model reasons, so the first chunk and the
 * silence wait as long as the whole operation. A 45 s ceiling cut Recap, Review and «Дополнить из чата» on long chats
 * with an empty answer, while the Fansly extension's Recap ran up to 185 s and its notes fill up to 94 s (prod,
 * 15–20.10.2026).
 */
const thinking = (untilMetaSec: number, maxSec: number): OpTimeouts => ({
  untilMetaMs: s(untilMetaSec),
  firstChunkAfterMetaMs: s(maxSec),
  silenceMs: s(maxSec),
  maxMs: s(maxSec),
});
const QUICK: OpTimeouts = { untilMetaMs: s(30), firstChunkAfterMetaMs: s(30), silenceMs: s(30), maxMs: s(60) };
const DEEP: OpTimeouts = thinking(180, 300);
/**
 * Coach runs on the Fansly extension's deep stream budget: its answer may take 300 s (old `shared/constants.ts:226`,
 * audit 2026-10-20 №6). At 180 s a long Coach answer was cut with a timeout. The hub sends `meta` once the context
 * is loaded, so the wait for it stays short.
 */
const COACH: OpTimeouts = thinking(60, 300);
/**
 * The short Recap reads the same history as the full one, only answers shorter: at 120 s it was cut where the old
 * Fansly extension still waited (its deep stream budget, 300 s). The wait for `meta` stays short.
 */
const RECAP_SHORT: OpTimeouts = thinking(60, 300);

export const OP_TIMEOUTS: Readonly<Record<FeatureId, OpTimeouts>> = {
  reply: QUICK,
  fix: QUICK,
  hi: QUICK,
  ping: QUICK,
  'recap-short': RECAP_SHORT,
  review: DEEP,
  recap: DEEP,
  coach: COACH,
};
