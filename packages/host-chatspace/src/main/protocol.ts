// ChatSpace's own literal copies of @cg/contracts constants and of the host
// contract (isolated/host-contract.ts). MAIN must not import anything but the
// shared page mechanics (@cg/host-kit: the boot and its own literals —
// versions, tags, envelope kinds, transport errors — in its main/protocol.ts),
// so the values are repeated here and pinned to their sources by
// protocol.test.ts.

/** The event that trips the X8 fuse after a send (receipt.ts; contracts FROM_MAIN.previewSendFuse, decision X25). */
export const EVT_FUSE = 'previewSendFuse';

/**
 * Requests the live port answers (live.ts): the freshness checkpoint, the X8
 * send port and the flags (§6.6–§6.8). The port comes with the tap script
 * (chatspace-ws); without it MAIN refuses them BEFORE executing anything, with
 * `disabled` (contracts BRIDGE_ERRORS_BEFORE_EXECUTION): a preview send is
 * `held`, a checkpoint null, both flags read back as off.
 */
export const LIVE_REQUESTS: readonly string[] = ['checkpoint', 'previewSendPreflight', 'previewSendCommit', 'flags'];

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
export const STORE_TABS = 'chatTabEntries';
export const KEY_ACCOUNTS = 'accounts';
export const KEY_MESSAGES = 'chatMessages';
export const KEY_FANS = 'fansMap';
export const KEY_CHAT_LIST = 'chatList';
export const KEY_MIMIC_SETTINGS = 'mimicSettings';
export const KEY_MIMIC_CHATS = 'mimicChats';
export const KEY_PERMISSIONS = 'userPermissions';
export const KEY_BUYING_POWERS = 'onlyfansBuyingPowers';
export const KEY_INSIGHTS = 'fanInsights';
/** The accounts store: `subscribedAccountIds` — the accounts ChatSpace asked its socket to subscribe (§6.7.5). */
export const STORE_ACCOUNTS = 'accounts';
/** Path of ChatSpace's own socket URL; the tap listens on that socket only (§6.8 п. 2). */
export const WS_PATH = '/api/chat-space/ws';
export const WS_NEW_MESSAGE = 'account_new_message';
export const WS_AUTHENTICATED = 'authenticated';
/** The path of ChatSpace's own API under its origin; our one read of it (X54) takes the origin from the page's requests. */
export const API_PATH = '/api/v0/';
/** The request that names that origin: the page's own read of its accounts, the first it makes (X54). */
export const API_ACCOUNTS_PATH = '/api/v0/accounts';
/** The native send request, `POST api/v0/accounts/{acc}/chats/{chat}/messages` (§6.7.2): account and chat of a URL's path. */
export const SEND_PATH = /(?:^|\/)api\/v0\/accounts\/(\d+)\/chats\/(\d+)\/messages$/;
/** The role permission that takes the Send button away (§6.7.4 п. 8). */
export const PERMISSION_NO_SEND = 'of_block_message_sending';
/** Server code of a Message Guard refusal (§6.7.4 п. 16). */
export const GUARD_CODE = 'MESSAGE_GUARD_VIOLATION';
/** Queue entry statuses and error kinds the receipt observer reads (§6.7.6). */
export const ENTRY_FAILED = 'failed';
export const ERROR_BLOCKED = 'blocked';
export const MIMIC_ENABLED = 'enabled';
export const PLATFORM = 'onlyfans';

/** §6.1: after DOMContentLoaded every 100 ms until 15 s, then every 2 s until 60 s, then give up (CG-HOST-NOT-READY). */
export const APP_SEARCH = { fastMs: 100, fastUntilMs: 15_000, slowMs: 2000, slowUntilMs: 60_000 } as const;
/** How long a composer without its editor yet is watched for TipTap (a narrow observer, never on body). */
export const EDITOR_WATCH_MS = 15_000;

// ── Limits (contracts BRIDGE_LIMITS, LIVE_TEXT_LIMITS, PART_LIMITS) ─────────

export const MAX_STRING = 20_000;
export const MAX_SNAPSHOT = 200;
export const MAX_ARRAY = 1000;
export const MAX_ACCOUNTS = 200;
export const LIVE_TEXT_MAX_CHARS = 5000;
/** Bytes of data MAIN puts into one answer: the frame limit (256 KiB of UTF-8 JSON) minus room for the envelope. */
export const FRAME_DATA_BUDGET = 196_608;
export const MAX_PARTS = 10;
export const MAX_VARIANTS = 3;
/** contracts SEND_LIMITS. */
export const SEND_MAX_CHARS = 5000;
export const NATIVE_TIMEOUT_MS = 30_000;
export const KNOWN_FAN_MESSAGES = 10;
/** contracts OPEN_CHAT_LIMITS, OPEN_CHAT_PRICE_MAX (X54). */
export const OPEN_CHAT_PAGE_MAX = 100;
export const OPEN_CHAT_REQUEST_MS = 10_000;
export const OPEN_CHAT_PRICE_MAX = 10_000;
/** contracts MEDIA_LIMITS, MEDIA_TYPES (decision X53). */
export const MEDIA_FOLDERS_PAGE = 10;
export const MEDIA_ITEMS_PAGE = 40;
export const MEDIA_MAX = 40;
export const MEDIA_IDS = 100;
export const MEDIA_PRICE_MIN = 300;
export const MEDIA_PRICE_MAX = 20_000;
export const MEDIA_TYPES = ['photo', 'video', 'gif', 'audio'] as const;

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
export const CG_SEND_OFF = 'CG-SEND-OFF';
export const CG_SEND_HOST = 'CG-SEND-HOST';
export const CG_SEND_RECEIPT = 'CG-SEND-RECEIPT';
export const CG_SEND_ACTIVE_CHAT = 'CG-SEND-ACTIVE-CHAT';
export const CG_SEND_PERMISSION = 'CG-SEND-PERMISSION';
export const CG_SEND_FAN = 'CG-SEND-FAN';
export const CG_SEND_MIMIC = 'CG-SEND-MIMIC';
export const CG_SEND_TRANSLATOR = 'CG-SEND-TRANSLATOR';
export const CG_SEND_STALE = 'CG-SEND-STALE';
export const CG_SEND_FRESHNESS = 'CG-SEND-FRESHNESS';
export const CG_SEND_BUSY = 'CG-SEND-BUSY';
export const CG_SEND_QUEUE = 'CG-SEND-QUEUE';
export const CG_SEND_PART = 'CG-SEND-PART';
export const CG_SEND_GUARD = 'CG-SEND-GUARD';
export const CG_SEND_REJECTED = 'CG-SEND-REJECTED';
export const CG_SEND_UNCERTAIN = 'CG-SEND-UNCERTAIN';
export const CG_TIMEOUT = 'CG-TIMEOUT';
