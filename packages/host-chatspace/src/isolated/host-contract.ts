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

export const KEY_ACCOUNTS = 'accounts';
export const KEY_MESSAGES = 'chatMessages';
export const KEY_FANS = 'fansMap';
export const KEY_CHAT_LIST = 'chatList';
export const KEY_MIMIC_SETTINGS = 'mimicSettings';
export const KEY_MIMIC_CHATS = 'mimicChats';
export const KEY_PERMISSIONS = 'userPermissions';
export const KEY_BUYING_POWERS = 'onlyfansBuyingPowers';
export const KEY_INSIGHTS = 'fanInsights';

/** `localStorage['chat-space:draft:of:{acc}:{fan}']` = `{ body: { json: <Tiptap JSON>, … }, updatedAt }` (§6.1). */
export const DRAFT_KEY_PREFIX = 'chat-space:draft:of:';
export const draftKey = (hostAccountId: string, platformFanId: string): string => `${DRAFT_KEY_PREFIX}${hostAccountId}:${platformFanId}`;

/** Theme: `dark`/`light` class on <html>, `--color-om-*` set inline on <html>, the fixed-width workspace variable (§6.1). */
export const THEME_DARK_CLASS = 'dark';
export const THEME_TOKEN_PREFIX = '--color-om-';
export const FIXED_WIDTH_VARIABLE = '--app-content-max-width';
