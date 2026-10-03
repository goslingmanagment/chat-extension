// Literal copies of @cg/contracts constants and of the host contract
// (isolated/host-contract.ts). MAIN must not import anything, so the values are
// repeated here and pinned to their sources by protocol.test.ts.

export const PROTOCOL_VERSION = 1;
export const TAG_MAIN_READY = 'main-ready';
export const TAG_ISO_HELLO = 'iso-hello';
export const TAG_CONNECT = 'connect';
export const WS_TAP_KEY = 'chatgoose.wsTap';
/** Symbol.for key of the boot's one-shot hook for a runtime from a later MAIN script (bridge.ts). */
export const RUNTIME_KEY = 'chatgoose.mainRuntime';

/** Envelope kinds (contracts BridgeRequestSchema / BridgeResponseSchema / BridgeEventSchema). */
export const KIND_REQ = 'req';
export const KIND_RES = 'res';
export const KIND_EVT = 'evt';

/** contracts BRIDGE_ERRORS. */
export const ERR_UNKNOWN_REQUEST = 'unknown-request';
export const ERR_BAD_REQUEST = 'bad-request';
export const ERR_NOT_READY = 'not-ready';
export const ERR_IDENTITY = 'identity-mismatch';
export const ERR_STALE_DOCUMENT = 'stale-document';
export const ERR_DISABLED = 'disabled';
export const ERR_INTERNAL = 'internal';

/**
 * The typed «not yet» of part A: the X8 send port and the freshness
 * checkpoint (§6.6–§6.8) land with part B. Until then MAIN refuses these
 * requests BEFORE executing anything, with `disabled` (contracts
 * BRIDGE_ERRORS_BEFORE_EXECUTION): a preview send is `held`, a checkpoint null.
 */
export const NOT_YET_REQUESTS: readonly string[] = ['checkpoint', 'previewSendPreflight', 'previewSendCommit'];

/** contracts BRIDGE_WRITE_REQUESTS: deduplicated by request id. */
export const WRITE_REQUESTS: readonly string[] = ['insertGuarded', 'navigate', 'previewSendCommit'];

// ── Host contract (isolated/host-contract.ts) ───────────────────────────────────

export const APP_SELECTOR = '#app';
export const SLOT_SELECTOR = '[data-id="browser-composer-translator"]';
export const FRAME_SELECTOR = '.composer-frame';
export const EDITOR_SELECTOR = '.ProseMirror';
export const BUILD_SELECTOR = 'script[type="module"][src*="/assets/index-"]';
export const BUILD_PATTERN = /\/assets\/(index-[\w-]{1,64})\.js/;
export const ROUTE_CHAT = 'chat';
export const ROUTE_OVERVIEW = 'accounts-overview';
export const STORE_CACHE = '_pc_query';
export const STORE_CHATS = 'chats';
export const STORE_QUEUE = 'pendingMessages';
export const STORE_TRANSLATOR = 'composerTranslator';
export const KEY_ACCOUNTS = 'accounts';
export const KEY_MESSAGES = 'chatMessages';
export const KEY_FANS = 'fansMap';
export const KEY_CHAT_LIST = 'chatList';
export const KEY_MIMIC_SETTINGS = 'mimicSettings';
export const KEY_MIMIC_CHATS = 'mimicChats';
export const KEY_PERMISSIONS = 'userPermissions';
export const KEY_BUYING_POWERS = 'onlyfansBuyingPowers';
export const KEY_INSIGHTS = 'fanInsights';

/** §6.1: after DOMContentLoaded every 100 ms until 15 s, then every 2 s until 60 s, then give up (CG-HOST-NOT-READY). */
export const APP_SEARCH = { fastMs: 100, fastUntilMs: 15_000, slowMs: 2000, slowUntilMs: 60_000 } as const;
/** §5.3: UI events at most 50 per second per type; extra ones coalesce (the latest wins). */
export const UI_EVENT_GAP_MS = 20;
/** A hidden tab gets no animation frames: a timer stands in for «one frame». */
export const FRAME_FALLBACK_MS = 100;
/** Write results kept for deduplication by request id. */
export const WRITE_MEMORY = 64;
/** How long a composer without its editor yet is watched for TipTap (a narrow observer, never on body). */
export const EDITOR_WATCH_MS = 15_000;

// ── Limits (contracts BRIDGE_LIMITS, LIVE_TEXT_LIMITS, PART_LIMITS) ─────────

export const MAX_STRING = 20_000;
export const MAX_SNAPSHOT = 200;
export const MAX_ARRAY = 1000;
export const MAX_ACCOUNTS = 200;
export const LIVE_TEXT_MAX_CHARS = 5000;
export const MAX_PARTS = 10;
export const MAX_VARIANTS = 3;

/** CG codes MAIN answers with (contracts CG_CODES). */
export const CG_CHAT_CHANGED = 'CG-INSERT-CHAT-CHANGED';
export const CG_INSERT_FAILED = 'CG-INSERT-FAILED';
export const CG_UNCERTAIN = 'CG-INSERT-UNCERTAIN';
export const CG_MISPLACED = 'CG-INSERT-MISPLACED';
export const CG_CANCELED = 'CG-INSERT-CANCELED';
export const CG_DRAFT_CHANGED = 'CG-DRAFT-CHANGED';
export const CG_NAV_FAILED = 'CG-NAV-FAILED';
export const CG_NAV_TIMEOUT = 'CG-NAV-TIMEOUT';
export const CG_COMPOSER_MISSING = 'CG-HOST-COMPOSER-MISSING';
export const CG_FAN_BLOCKED = 'CG-GATE-FAN-BLOCKED';
