// The ChatSpace host contract (architecture.md §6.1, §6.2): every string the
// adapter relies on, in one place (`@cg/host-chatspace/host-contract`).
// `tools/host-contract-check` (R02) compares these with a local copy of the
// ChatSpace bundles; the isolated side imports them; the MAIN bridge cannot
// import anything and repeats the ones it needs in main/protocol.ts —
// protocol.test.ts pins the two copies together. It lives under isolated/
// because that side may import nothing else of the package (§4,
// dependency-cruiser).
// Plain data only: no DOM, no schemas.

/** The Vue app root; `#app.__vue_app__` is the way in (§6.1). */
export const APP_SELECTOR = '#app';
/** The translator bridge slot of each composer; it carries `__omComposerBridge`. Nothing goes inside it (§6.3). */
export const SLOT_SELECTOR = '[data-id="browser-composer-translator"]';
/** The composer frame; its parent `div.relative` is the frame root the dock docks into (§6.3). */
export const FRAME_SELECTOR = '.composer-frame';
/** The Tiptap editor surface; `view.dom.editor` is the editor object (§6.4). */
export const EDITOR_SELECTOR = '.ProseMirror';
/** The entry module of the ChatSpace build: its hashed name is the build fingerprint (NEW-09). */
export const BUILD_SELECTOR = 'script[type="module"][src*="/assets/index-"]';
export const BUILD_PATTERN = /\/assets\/(index-[\w-]{1,64})\.js/;
/** ChatSpace hides overlays' Esc behind this attribute (MainLayout `lastResort`, §6.3). */
export const DISMISSIBLE_ATTRIBUTE = 'data-dismissible-open';

export const ROUTE_CHAT = 'chat';
export const ROUTE_OVERVIEW = 'accounts-overview';

export const STORE_CACHE = '_pc_query';
export const STORE_CHATS = 'chats';
export const STORE_QUEUE = 'pendingMessages';
export const STORE_TRANSLATOR = 'composerTranslator';
/** Chat tabs per account: the active tab's chat is the chat the visible composer was rendered for (§6.4 «props»). */
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
/**
 * Path of ChatSpace's own socket URL (its config's `onlyMonsterWSUrl`); the
 * tap listens on that socket only (§6.8 п. 2). The path, not the origin: MAIN
 * names no origin.
 */
export const WS_PATH = '/api/chat-space/ws';
/** Socket events the tap parses; any other frame only tells its account (§6.8 п. 4). */
export const WS_NEW_MESSAGE = 'account_new_message';
export const WS_AUTHENTICATED = 'authenticated';
/**
 * The path of ChatSpace's own API under its origin (`r2.onlyMonsterUrl` + `api/v0/…`). Our one read of it, the open
 * chat's messages (X54), takes the origin from the page's own requests to this path: the path, not the origin — MAIN
 * names no origin.
 */
export const API_PATH = '/api/v0/';
/** The page's own read of its accounts, the first request it makes to its API: the one our read takes the origin from. */
export const API_ACCOUNTS_PATH = '/api/v0/accounts';
/** The native send request, `POST api/v0/accounts/{acc}/chats/{chat}/messages` (§6.7.2): account and chat of a URL's path. */
export const SEND_PATH = /(?:^|\/)api\/v0\/accounts\/(\d+)\/chats\/(\d+)\/messages$/;
/** The role permission that takes the Send button away (§6.7.4 п. 8). */
export const PERMISSION_NO_SEND = 'of_block_message_sending';
/** Server code of a Message Guard refusal (§6.7.4 п. 16). */
export const GUARD_CODE = 'MESSAGE_GUARD_VIOLATION';

/** `localStorage['chat-space:draft:of:{acc}:{fan}']` = `{ body: { json: <Tiptap JSON>, … }, updatedAt }` (§6.1). */
export const DRAFT_KEY_PREFIX = 'chat-space:draft:of:';
export const draftKey = (hostAccountId: string, platformFanId: string): string => `${DRAFT_KEY_PREFIX}${hostAccountId}:${platformFanId}`;

/** Theme: `dark`/`light` class on <html>, `--color-om-*` set inline on <html>, the fixed-width workspace variable (§6.1). */
export const THEME_DARK_CLASS = 'dark';
export const THEME_TOKEN_PREFIX = '--color-om-';
export const FIXED_WIDTH_VARIABLE = '--app-content-max-width';

/**
 * A built module of ChatSpace: `/assets/<role>-<hash>.js`, the hash being
 * Vite's 8-character content hash (so a changed module is another file).
 */
export const MODULE_PATTERN = /\/assets\/([\w.-]+?)-([\w-]{8})\.js$/;
/**
 * The modules the X8 send path and its receipt live in (§6.2 «профиль пути
 * отправки и квитанции»), by the name before the hash, with what each
 * carries in 0.195.0 (a role may have several modules; its fingerprint is
 * all their hashes):
 * - `notificationEntry` — the send queue store and its sequence, the request
 *   body and its single POST, the quick reply from a notification;
 * - `composables` (two modules) — the HTTP client (where `fetch` is
 *   captured), the 401 handler, the socket bus and its frame normalizer, the
 *   query cache, the role permissions;
 * - `onlyfans` (two modules) — a small one the page loads at once (OnlyFans
 *   helpers the queue and the client import) and the one that loads with the
 *   main layout: the composer and its Send, `__omComposerBridge`, the
 *   translator store, the echo handler of the open chat. In 0.172.0 that
 *   content was a `messages` module, which 0.195.0 no longer has;
 * - `accounts` — the accounts store and its socket subscriptions, the chat
 *   list's echo handling, the fans map, the API error handler;
 * - `inbox` — Mimic's settings and chats.
 * The entry module (`index-*`) is not one of them: it is the build
 * fingerprint, a diagnostic. (In 0.195.0 it also installs the Sentry wrapper
 * of `window.fetch` that the captured `fetch` now goes through: reviewed and
 * accepted, §6.2.) When ChatSpace's bundler regroups these modules, the list
 * changes with an adapter release — a new hub value alone cannot follow.
 */
export const RECEIPT_MODULE_ROLES: readonly string[] = ['notificationEntry', 'composables', 'onlyfans', 'accounts', 'inbox'];

/** How a send-path anchor is written in a bundle: a whole identifier, a string literal in any quotes, or the text as is. */
export interface SendPathAnchor {
  /** The part of the send path it marks. */
  readonly part: string;
  readonly kind: 'member' | 'string' | 'text';
  readonly value: string;
}

/**
 * The regroup tripwire of `tools/host-contract-check` (§6.2 «Перегруппировка
 * модулей»): strings that mark the send path. Every place a copy of ChatSpace
 * has one of them must be a module of a role above; one found in any other
 * file — the entry module `index-*` included (in 0.172.0 and 0.195.0 none of
 * them is there) — means the bundler moved part of the send path out of the
 * profile, and the build needs an adapter release. One found nowhere is a
 * changed send path. The HTTP client's strings are Ky's own API (`fetch`
 * captured when a request is made, the hooks that carry the token and the
 * 401 handler). The queue's action is not listed: its name lives in the send
 * port only (tools/gates), and its callers and an unrelated stream method of
 * the same name may sit anywhere — the tool checks instead that it is in the
 * module of the queue store.
 */
export const SEND_PATH_ANCHORS: readonly SendPathAnchor[] = [
  { part: 'composer bridge', kind: 'member', value: '__omComposerBridge' },
  { part: 'translator store', kind: 'string', value: STORE_TRANSLATOR },
  { part: 'translator store', kind: 'member', value: 'getAccountSettings' },
  { part: 'queue store', kind: 'string', value: STORE_QUEUE },
  { part: 'queue store', kind: 'member', value: 'messagesByAccountId' },
  { part: 'queue store', kind: 'member', value: 'processingByAccountId' },
  { part: 'queue store', kind: 'string', value: GUARD_CODE },
  { part: 'HTTP client', kind: 'text', value: 'globalThis.fetch.bind(globalThis)' },
  { part: 'HTTP client', kind: 'member', value: 'prefixUrl' },
  { part: 'HTTP client', kind: 'member', value: 'beforeRequest' },
  { part: 'HTTP client', kind: 'member', value: 'afterResponse' },
  { part: 'open-chat echo handler', kind: 'string', value: KEY_MESSAGES },
  { part: 'open-chat echo handler', kind: 'member', value: 'confirmEchoedMessage' },
  { part: 'socket bus', kind: 'text', value: WS_PATH },
];

/**
 * The adapter's own version, reported in the contract check; a receipt
 * profile names the version it was approved for (§6.2). It changes when the
 * adapter's reading of the send path changes — the role list above included
 * (0.3.0: `messages` → `onlyfans`, ChatSpace 0.195.0).
 */
export const ADAPTER_VERSION = '0.3.0';

/**
 * Member names of ChatSpace's own objects that the MAIN side reads or calls
 * (MAIN names them inline: it cannot import this file). Listed here for
 * `tools/host-contract-check`, which looks for every string of this file in a
 * local copy of the bundles; the send queue's action name is the send port's
 * own (tools/gates keeps it in one file).
 */
export const HOST_MEMBERS = {
  app: ['__vue_app__'],
  composerBridge: ['__omComposerBridge', 'setText', 'insertText'],
  queue: ['messagesByAccountId', 'processingByAccountId', 'composerContent', 'platformMetadata', 'isAiGenerated', 'isCopied', 'hasAttachments'],
  chatTabs: ['stateByAccountId', 'activeEntryId'],
  accounts: ['subscribedAccountIds', 'platformAccountId'],
  fans: ['isBlocked', 'canReceiveMessages', 'isRestricted'],
  mimic: ['isActive'],
  translator: ['getAccountSettings', 'autoTranslate'],
  socketFrames: ['account_id', 'is_from_fan', 'chatId', 'isFromQueue', 'isTip', 'sentAt'],
  guard: ['topic_matches'],
} as const;
