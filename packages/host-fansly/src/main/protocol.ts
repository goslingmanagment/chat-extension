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
/** FANSLY_BRIDGE_UNDROPPABLE_EVENTS (the ones MAIN sends from P7a on). */
export const EVT_INCOMING = 'fx.incoming';
export const EVT_FOLLOW = 'fx.follow';
export const EVT_COVERAGE = 'fx.coverage';
export const EVT_VAULT = 'fx.vaultAdded';

/** TO_MAIN_FANSLY_TYPES MAIN answers itself from P7a on (`probe` is the boot's; the rest wait for the observation, P7b). */
export const REQ_STATE = 'fx.state';
export const REQ_ACK = 'fx.ack';
export const REQ_HEALTH = 'fx.health';
export const REQ_LATER: readonly string[] = ['fx.focus', 'fx.generationSnapshot', 'fx.windowMeta'];

/** FANSLY_GAP_REASONS. */
export const GAP_OVERFLOW = 'overflow';

/** FANSLY_COVERAGE_REASONS MAIN gives from P7a on (every one lowers to `unknown`). */
export const WHY_LATE = 'late-install';
export const WHY_SOCKET = 'socket';
export const WHY_FRAME = 'frame';
export const WHY_PARSE_LIMIT = 'parse-limit';
/** FANSLY_COMPLETENESS. */
export const UNKNOWN = 'unknown';

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
