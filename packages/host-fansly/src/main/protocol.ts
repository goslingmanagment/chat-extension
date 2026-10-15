// Literal copies of the @cg/contracts values Fansly's MAIN works with, and
// MAIN's own limits (docs/project-unite/architecture.md §5.3, §5.4, §6). MAIN
// must not import anything but the boot of host-kit, so the values are
// repeated here and pinned to their source by protocol.test.ts. The boot's own
// literals (the envelope, the transport errors) are host-kit's
// (@cg/host-kit/main/protocol).

// ── The bridge (contracts bridge-fansly.ts, bridge-messages-fansly.ts) ──────

/** FANSLY_BRIDGE_LIMITS: batches sent and not acknowledged yet. */
export const MAX_UNACKED = 8;
/** FANSLY_BRIDGE_LIMITS: UTF-8 bytes of those batches together. */
export const MAX_IN_FLIGHT_BYTES = 256 * 1024;
/** FANSLY_BRIDGE_LIMITS: one `fx.batch` frame, UTF-8 bytes of its JSON — the envelope included. */
export const MAX_BATCH_BYTES = 64 * 1024;
/** FANSLY_BRIDGE_LIMITS: events in one batch. */
export const MAX_BATCH_EVENTS = 512;

/** FANSLY_WIRE_EVENT_TYPES: the batch, and the one gap notice outside the credits. */
export const EVT_BATCH = 'fx.batch';
export const EVT_GAP = 'fx.gap';
/** FANSLY_BRIDGE_STATE_EVENTS: at most once per batch, the latest wins. */
export const EVT_IDENTITY = 'fx.identity';
export const EVT_CONTRACT = 'fx.contract';
/** The focused group's state (P7b): the latest wins. */
export const EVT_CHAT = 'fx.chat';
/** FANSLY_BRIDGE_UNDROPPABLE_EVENTS MAIN sends (`fx.sent` is P7f's). */
export const EVT_INCOMING = 'fx.incoming';
export const EVT_FOLLOW = 'fx.follow';
export const EVT_COVERAGE = 'fx.coverage';
export const EVT_DELETED = 'fx.deleted';
export const EVT_VAULT = 'fx.vaultAdded';

/** TO_MAIN_FANSLY_TYPES MAIN answers itself (`probe` is the boot's). */
export const REQ_STATE = 'fx.state';
export const REQ_ACK = 'fx.ack';
export const REQ_HEALTH = 'fx.health';
export const REQ_FOCUS = 'fx.focus';
export const REQ_SNAPSHOT = 'fx.generationSnapshot';
export const REQ_WINDOW = 'fx.windowMeta';

/** FANSLY_GAP_REASONS. */
export const GAP_OVERFLOW = 'overflow';
export const GAP_MEMORY = 'memory';

/** FANSLY_COVERAGE_REASONS: `certificate` makes a chat complete; every other one says why it is unknown. */
export const WHY_CERTIFICATE = 'certificate';
export const WHY_NOT_CERTIFIED = 'not-certified';
export const WHY_LATE = 'late-install';
export const WHY_SOCKET = 'socket';
export const WHY_FRAME = 'frame';
export const WHY_UNSEEN = 'unseen';
/** The contract's word for a recovery that did not overlap; since §5.12 a certificate after a loss always recovers. */
export const WHY_NO_OVERLAP = 'no-overlap';
export const WHY_EVICTED = 'evicted';
export const WHY_PARSE_LIMIT = 'parse-limit';
export const WHY_PENDING_PARSE = 'pending-parse';
export const WHY_PARTICIPANTS = 'participants';
export const WHY_BFCACHE = 'bfcache';
export const WHY_GAP = 'gap';
/** FANSLY_COMPLETENESS. */
export const COMPLETE = 'complete';
export const UNKNOWN = 'unknown';
/** CONVERSATION_KINDS. */
export const KIND_DIRECT = 'direct';
export const KIND_GROUP = 'group';
/** FANSLY_FAN_SCRIPTS. */
export const SCRIPT_CYRILLIC = 'cyrillic';
export const SCRIPT_OTHER = 'other';

/** FEATURE_IDS, FRESH_TEXT_FEATURES: who a snapshot is for, and who may get page text in it (D-14). */
export const FEATURES: readonly string[] = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'recap-short', 'coach'];
export const TEXT_FEATURES: readonly string[] = ['reply', 'fix', 'hi', 'ping'];
/** The one function a start proof and the fan's avatar are for. */
export const FEATURE_HI = 'hi';
/** START_PROOF_SOURCES: the tab's own proof. */
export const PROOF_TAB = 'tab-short-page';

/** FANSLY_LIMITS: the ring of one chat, chats at once, the check window, the fan's known messages, a history page. */
export const RING_RECORDS = 120;
export const MAX_CHATS = 300;
export const CHECK_WINDOW_MAX = 60;
export const KNOWN_FAN_MAX = 10;
export const HISTORY_PAGE = 25;
export const AUTOMATED_IDS_MAX = 120;
/** LIVE_TEXT_LIMITS.maxChars: one text of the tail (the hub's limit of one message). */
export const TAIL_TEXT_MAX_CHARS = 5000;
/** FANSLY_BRIDGE_LIMITS.maxSnapshotBytes: the snapshot's answer frame, UTF-8 bytes of its JSON. */
export const SNAPSHOT_MAX_BYTES = 128 * 1024;
/** HI_FAN_AVATAR_URL_PATTERN and its length: the hub's fanslyAvatarUrlSchema. */
export const AVATAR_PATTERN = /^https:\/\/[a-z0-9-]+\.fansly\.com\//;
export const AVATAR_MAX_CHARS = 4096;

/** ANCHOR_STATES of the network anchors (FANSLY_NETWORK_ANCHORS). */
export const ANCHOR_OK = 'ok';
export const ANCHOR_NOT_YET = 'notYet';
export const ANCHOR_SHAPE = 'shape';
/** FANSLY_TAP_STATES. */
export const TAP_OK = 'ok';
export const TAP_WRAPPED = 'wrapped';
export const TAP_SILENT = 'silent';

/** PERF_METRICS.frameParseMs and .xhrParseMs bounds (HF-13: the same for both). */
export const PARSE_BOUNDS: readonly number[] = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 16, 50, 100];
/** PERF_METRICS.snapshotMs bounds (HF-13): MAIN's step of a generation snapshot. */
export const SNAPSHOT_BOUNDS: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 3, 4, 5, 8, 16, 32, 50, 100, 250];

/** contracts NATIVE_ID_PATTERN: what a Fansly id must look like to cross (host-kit's `idOf` holds the same). */
export const ID_MAX_DIGITS = 30;

// ── MAIN's own limits ──────────────────────────────────────────────────────

/** §5.3: a socket frame longer than this (characters) is not read; its chats become unknown. */
export const FRAME_MAX_CHARS = 1024 * 1024;
/** §5.3: `t:10001` packages nested deeper than this are not read. */
export const FRAME_MAX_DEPTH = 4;
/** §5.3: wrappers of one frame (the frame and every frame of its packages). */
export const FRAME_MAX_NODES = 256;
/**
 * FS-WS-5: this many text frames on one socket and not one of them a frame the page reads — the format changed under
 * us. Every chat is unknown, and the `frames` anchor is `shape`.
 */
export const FRAMES_UNREAD_SIGN = 3;
/** §5.3: Fansly's page pings with this text; the server's answer is `t:2`. */
export const SOCKET_PING = 'p';
/**
 * The tap is `silent` when a confirmed socket brought no frame for this long: the page pings every 20–25 s and the
 * server answers each ping (`t:2`), so three missed answers in a row is no quiet chat.
 */
export const SILENT_MS = 75_000;

/** §5.4: an answer up to this many characters is parsed at once, at `loadend`. */
export const RESPONSE_NOW_CHARS = 64 * 1024;
/** §5.4: an answer longer than this is not parsed at all: an explicit loss, never a long block. */
export const RESPONSE_MAX_CHARS = 1024 * 1024;
/** §5.4: the deferred-parse queue: at most this many answers… */
export const DEFERRED_MAX_ITEMS = 8;
/** …and this many characters together. */
export const DEFERRED_MAX_CHARS = 1024 * 1024;
/** An idle callback stops taking answers when less than this is left of its slice (ms). */
export const IDLE_RESERVE_MS = 2;
/** The idle callback comes at the latest after this long (ms), a busy page or not. */
export const IDLE_TIMEOUT_MS = 1000;

/**
 * §6: the stream waiting for credits, in the memory account (§5.5) — calibrated in P7a. At the busiest page's peak
 * (12 frames a second, S2 Q1.8) this holds minutes of events; past it the isolated side has stopped taking batches,
 * and MAIN drops the queue and says `fx.gap` once. With the batches in flight the stream holds ≤ 512 KiB.
 */
export const QUEUE_MAX_BYTES = 256 * 1024;
export const QUEUE_MAX_EVENTS = 2048;
/** What a batch frame carries besides its events, generously: `{v, kind, t, documentEpoch, seq, payload: {n, events: []}}`. */
export const BATCH_ENVELOPE_BYTES = 256;

// ── The observation's own limits (§5.5–§5.8; FS-TAIL-5) ───────────────────

/** §5.5: texts are held for this many recently active chats… */
export const TEXT_CHATS = 20;
/** …the last this many of each (the check window is at most 60). */
export const TEXTS_PER_CHAT = 60;
/** FS-TAIL-5: everything the observation holds, by one account (memory.ts)… */
export const MEMORY_MAX_BYTES = 4 * 1024 * 1024;
/** …of it, texts. */
export const TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** Ids seen deleted (5/10), so a late answer cannot bring one back (§5.6), the oldest forgotten first. */
export const TOMBSTONES = 2048;
/** Deleted mass-send parents (`type 3`), so a late answer cannot bring back one of their copies. */
export const CASCADES = 256;
/** Groups whose members, kind and DM rules MAIN knows (§5.7), the least recently touched forgotten first. */
export const MAX_GROUPS = 600;
/** Fans' avatar addresses from the page's answers (FX-018), the least recently seen forgotten first. */
export const MAX_AVATARS = 300;
/** Welcome texts of `/message/automated` (§5.8), as hashes. */
export const WELCOME_MAX = 256;
/**
 * A source named a message the observation lacks (§5.6): the socket may still be bringing it — a message created
 * while the page's request was being answered — so the chat is lowered only if it has not come this much later. Until
 * then a snapshot of the chat is `unknown` (`unseen`).
 */
export const UNSEEN_GRACE_MS = 3000;
/** Such messages waited for at once; past it the chat is lowered at once. */
export const UNSEEN_MAX = 64;
/** §5.4, FS-TAIL-6: a snapshot drains the deferred parse for this long at most; what is left makes it `pending-parse`. */
export const SNAPSHOT_DRAIN_MS = 3;
/**
 * …and starts an answer only if it can be read in what is left of that, at this many characters a millisecond. Once
 * started, an answer is read to its end, so the estimate is a slow one: P3a read a 115 KB inbox answer in 0.18 ms, the
 * review of P7b a `/messages` answer of 987 K characters and 190 messages in 7.5–12.9 ms (≈ 100 K a millisecond).
 */
export const DRAIN_CHARS_PER_MS = 64 * 1024;

/**
 * The account's estimates (§5.5, spike P3a: a compact record measured 33 B, a text of 150 characters 220 B in Latin
 * and 364 B in Cyrillic): an id string with its slot; a slot of the typed arrays (three 32-bit words and a byte); a
 * chat's own object and arrays; a correlation id with its slot; a text — 64 + 2 a character; a tombstone; a group with
 * its members; an avatar address — as a text.
 */
export const COST_RECORD = 40;
export const COST_SLOT = 16;
export const COST_CHAT = 256;
export const COST_CORR = 48;
export const COST_TEXT = 64;
export const COST_TOMB = 64;
export const COST_GROUP = 160;
export const COST_MEMBER = 40;
