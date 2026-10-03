// The stand's own wire protocol: paths, headers and payloads shared by the
// fixture page, the loopback stand server (packages/testing/src/stand) and the
// e2e harness. None of this is a ChatSpace contract — it exists so tests can
// script the stand and read what happened on it.

/**
 * The page and its API live on two loopback origins, like ChatSpace (page on
 * chat.<domain>, API and socket on the apex): the page server serves the app,
 * the control endpoints and the session token; the API server serves `/api/...`
 * with CORS for the page origin, and the socket.
 */
/** WebSocket path on the API origin; ws://<api origin><path> plays the role of ChatSpace's configured socket URL. */
export const STAND_WS_PATH = '/api/chat-space/ws';
/** Native API prefix on the API origin (the page's HTTP client resolves `api/...` against it). */
export const STAND_API_PREFIX = '/api/';
/** `<meta name=…>` the page server fills with the API origin when it serves the app. */
export const STAND_API_ORIGIN_META = 'stand-api-origin';
/** Control endpoints for tests (page origin); never called by the app's own client. */
export const STAND_CONTROL_PREFIX = '/__stand/';
/** Plays the session-token provider (Clerk's getToken), on the page origin. */
export const STAND_TOKEN_PATH = '/__stand/auth/token';

/**
 * Every request the page's native HTTP client makes carries this header. Its
 * value is unique per request (`<page boot id>.<sequence>`): the server labels a
 * value it has already answered as a replay (foreign).
 */
export const NATIVE_REQUEST_HEADER = 'x-stand-native';
/** Control requests (page test API or Node harness) carry this header. */
export const CONTROL_REQUEST_HEADER = 'x-stand-control';

/** Query flag that boots the page with ChatSpace anchors removed or renamed (a «new build»). */
export const STAND_BREAK_PARAM = 'stand-break';

/**
 * Who made a call, as the stand server labels it:
 * - `native` — the page's own client (the role ChatSpace plays);
 * - `control` — the test harness or `window.__stand`;
 * - `asset` — navigations and page subresources (`Sec-Fetch-Dest` other than
 *   `empty`): documents, scripts, styles, images;
 * - `foreign` — anything else on either origin, whatever the path: a fetch or
 *   XHR without the native header (also of the page's own index or bundles), a
 *   replayed native request, a socket that never authenticated — the extension
 *   under test (its own requests to the host must stay at zero).
 */
export type CallOrigin = 'native' | 'control' | 'asset' | 'foreign';

/** How the stand answers the next native send POST of a chat (queue, first in first out). */
export type SendOutcome =
  | {
      readonly kind: 'ok';
      /** Server message id (string, like the platform's); generated when omitted. */
      readonly id?: string;
      /** The id in the HTTP response when it differs from the message id — e.g. a number (the receipt's type is unverified live). */
      readonly responseId?: string | number;
      /** The id in the echo when it differs from the response's (a receipt that must not pair with this echo). */
      readonly echoId?: string;
      /** The echo's HTML when the platform normalised it (e.g. other entities or tags than the sent text). */
      readonly echoContent?: string;
      /** The outgoing `account_new_message` echo: before the HTTP response, after it, or none. */
      readonly echo?: 'before' | 'after' | 'none';
      /** Gap between the echo and the response, ms. */
      readonly gapMs?: number;
    }
  | { readonly kind: 'guard'; readonly words?: readonly string[]; readonly topics?: readonly string[] }
  | { readonly kind: 'status'; readonly status: number; readonly code?: string; readonly message?: string }
  /** Never answers; the request ends only when the client aborts it. */
  | { readonly kind: 'hang' }
  /** Destroys the connection without a response (network error). */
  | { readonly kind: 'drop' };

/**
 * What the stand's socket sends on its own, like ChatSpace's server: an
 * `account_notifications_summary` per subscribed account shortly after the
 * subscription and then about once a minute, `account_messages_summary` after
 * each new message (and optionally on a timer), `account_fan_typing` repeated
 * every few seconds while a fan types, and optionally frames for an account the
 * socket never subscribed (they must be ignored).
 */
export interface SocketTraffic {
  readonly enabled: boolean;
  /** First notifications summary after a subscription, ms (ChatSpace: ~7 s). */
  readonly firstSummaryMs: number;
  /** Then every …, ms (ChatSpace: ~61 s). */
  readonly summaryEveryMs: number;
  /** Messages summary on a timer per subscribed account, ms; 0 = only after new messages. */
  readonly messagesSummaryEveryMs: number;
  /** Fans that keep typing: `account_fan_typing` every `typingEveryMs`. */
  readonly typing: readonly { readonly accountId: string; readonly fanId: string }[];
  readonly typingEveryMs: number;
  /** Notifications summaries for this account to every authenticated socket, subscribed or not. */
  readonly strayAccountId: string | null;
}

export const DEFAULT_SOCKET_TRAFFIC: SocketTraffic = {
  enabled: true,
  firstSummaryMs: 7000,
  summaryEveryMs: 61_000,
  messagesSummaryEveryMs: 0,
  typing: [],
  typingEveryMs: 3500,
  strayAccountId: null,
};

/** Things a «new ChatSpace build» can lose or rename, for degradation tests (§6.2). */
export type StandBreak =
  | 'vue-app'
  | 'router-name'
  | 'composer-bridge'
  | 'composer-slot'
  | 'composer-frame'
  | 'editor-handle'
  | 'draft-key'
  | `store:${string}`
  | `query-key:${string}`;

export interface ServerJournalEntry {
  readonly seq: number;
  /** ms since the stand server started. */
  readonly at: number;
  readonly kind:
    | 'http'
    | 'history-load'
    | 'send'
    | 'send-aborted'
    | 'ws-open'
    | 'ws-in'
    | 'ws-out'
    | 'ws-close'
    /** A socket that stayed silent past the grace period is relabelled foreign. */
    | 'ws-silent'
    | 'control';
  readonly origin: CallOrigin | 'pending';
  readonly method?: string;
  readonly path?: string;
  readonly status?: number;
  readonly socketId?: number;
  readonly accountId?: string;
  readonly chatId?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ServerJournalPage {
  readonly entries: readonly ServerJournalEntry[];
  /** Pass as `since` to read only newer entries. */
  readonly next: number;
}

export interface PageJournalEntry {
  readonly seq: number;
  /** performance.now() of the page. */
  readonly at: number;
  readonly type: string;
  readonly [field: string]: unknown;
}

/** One composer as the page renders it (for the harness; the extension finds composers on its own). */
export interface ComposerSnapshot {
  readonly key: string;
  readonly tabId: string;
  readonly accountId: string;
  readonly chatId: string;
  /** v-show state: the stand's own idea of the active composer. */
  readonly shown: boolean;
  readonly hasBridge: boolean;
  readonly hasEditor: boolean;
}

export interface QueryObserverState {
  readonly exists: boolean;
  readonly hasData: boolean;
  /** At least one observer (a mounted component or a held test observer). */
  readonly active: boolean;
  readonly loading: boolean;
  readonly stale: boolean;
  readonly observers: number;
}

export interface MessageListState {
  readonly atBottom: boolean;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface TranslatorSettings {
  readonly enabled: boolean;
  readonly autoTranslate: boolean;
}

export interface MimicState {
  readonly isActive: boolean;
  /** `${accountId}:${fanId}` → status. */
  readonly chats: Readonly<Record<string, 'enabled' | 'disabled' | 'escalated'>>;
}

export interface FanPatch {
  readonly isBlocked?: boolean;
  readonly isRestricted?: boolean;
  readonly canReceiveChatMessage?: boolean;
  readonly subscribedOn?: boolean;
}

export interface OpenChatOptions {
  /** Open in a new chat tab (a second composer) instead of the active one. */
  readonly newTab?: boolean;
}

/**
 * `window.__stand` — the test-control API of the fixture page. Everything is
 * plain JSON in and out, so WebDriver `execute` can call it.
 */
export interface StandControl {
  readonly version: 1;
  readonly ready: boolean;
  readonly breaks: readonly StandBreak[];
  route(): { readonly name: string | null; readonly accountId: string | null; readonly chatId: string | null };
  openChat(accountId: string, chatId: string, options?: OpenChatOptions): Promise<void>;
  openAccount(accountId: string): Promise<void>;
  closeActiveChatTab(): Promise<void>;
  setTheme(mode: 'light' | 'dark'): void;
  setFixedWidth(on: boolean, align?: 'left' | 'center' | 'right'): void;
  composers(): readonly ComposerSnapshot[];
  composerState(accountId: string, chatId: string): { readonly text: string; readonly html: string; readonly marks: Readonly<Record<string, boolean>> } | null;
  draft(accountId: string, chatId: string): unknown;
  messageList(): MessageListState | null;
  queryState(key: readonly string[]): QueryObserverState;
  queryData(key: readonly string[]): unknown;
  holdQueryObserver(key: readonly string[]): number;
  releaseQueryObserver(token: number): void;
  pendingMessages(): unknown;
  setQueueTimeoutMs(ms: number): void;
  injectFanMessage(accountId: string, fanId: string, text?: string): Promise<string>;
  scriptSend(accountId: string, chatId: string, outcomes: readonly SendOutcome[]): Promise<void>;
  setFan(accountId: string, fanId: string, patch: FanPatch): Promise<void>;
  setFanOnline(accountId: string, fanId: string, online: boolean): void;
  setTranslator(accountId: string, settings: Partial<TranslatorSettings>): void;
  setMimic(state: MimicState): Promise<void>;
  setPermissions(permissions: readonly string[]): Promise<void>;
  wsStatus(): { readonly status: string; readonly sockets: number; readonly authenticated: boolean };
  reconnectWs(): void;
  journal(since?: number): readonly PageJournalEntry[];
  /** Reloads the page as a «new build» without the given anchors (§6.2). */
  simulateBuildChange(breaks: readonly StandBreak[]): void;
}

declare global {
  interface Window {
    __stand?: StandControl;
  }
}
