// The Fansly stand's own protocol: the test-control API of the page
// (`window.__fanslyStand`), its journal and the views tests read. None of this
// is a Fansly contract — it exists so tests can drive the stand and read what
// happened on it. The page itself is fixture-fansly/src (R20 P6a,
// docs/project-unite/architecture.md §13).

/** The page's test-control API lives on `window[FANSLY_STAND_GLOBAL]`. */
export const FANSLY_STAND_GLOBAL = '__fanslyStand';

/** `<html data-stand-ready>`: `1` once the app is up, `failed` if its boot threw. */
export const FANSLY_STAND_READY_ATTRIBUTE = 'data-stand-ready';

/** Query flags the page reads at boot. */
export const FANSLY_STAND_PARAMS = {
  /** `bright` (default, as in the live snapshot of 2026-10-13) or `dark`. */
  theme: 'stand-theme',
  /** `1`: the old extension's four marks are on the page from the start. */
  oldExtension: 'stand-old',
  /** Milliseconds every answer of the page's backend takes (default FANSLY_STAND_DEFAULT_LATENCY_MS). */
  latency: 'stand-latency',
  /** A group id: the mini-chat is open on it from the start. */
  miniChat: 'stand-mini',
  /** `local`: the page answers itself from its in-page world even when the stand server names a fake Fansly. */
  backend: 'stand-backend',
  /** Milliseconds between the page's socket pings (the site: one value of 20 000–25 000 for the page's life). */
  ping: 'stand-ping',
  /** Milliseconds the page collects its delivery and read marks before `POST /message/ack` (the site: 1000–3000 at random). */
  ackDelay: 'stand-ack-delay',
} as const;

export const FANSLY_STAND_DEFAULT_LATENCY_MS = 30;

/** The ids of the stand's synthetic world (data.ts): Fansly's, 18 digits, above 2^53 — strings everywhere. */
export interface FanslyStandIds {
  readonly creator: string;
  /** The first groups of the inbox, newest first; a group id is never its fan's id. */
  readonly groups: readonly string[];
  /** The fan of each group above, by group id. */
  readonly fans: Readonly<Record<string, string>>;
  /** A group with a long history: several pages of 25 above the latest one. */
  readonly longHistory: string;
  /** How many groups the inbox has in all (loaded 20 at a time). */
  readonly groupCount: number;
}

/** What the page did, in order (journal.ts): plain JSON, bounded. */
export interface FanslyPageJournalEntry {
  readonly seq: number;
  /** performance.now() of the page. */
  readonly at: number;
  readonly type: string;
  readonly [field: string]: unknown;
}

/** The event whose handler is running (the page's own handlers): a send inside one is the gesture's own. */
export interface HandlerEvent {
  readonly type: string;
  readonly isTrusted: boolean;
  readonly eventPhase: number;
}

/** A request of the page's backend as the journal records it (`type: 'api'`). */
export interface ApiCall {
  readonly method: 'GET' | 'POST';
  /** The path Fansly's client would ask for (`/api/v1/...`, fansly-web.md §4), with its query. */
  readonly path: string;
  /** Inside which of the page's own handlers the request was created and sent; null — none (a timer, a callback). */
  readonly during: HandlerEvent | null;
}

export type ComposerPlace = 'main' | 'mini';

export interface AttachmentView {
  readonly name: string;
  readonly type: string;
  readonly progress: number;
  readonly uploaded: boolean;
}

/** One `app-group-message-input` the page holds. */
export interface ComposerView {
  readonly place: ComposerPlace;
  /** Counts up with every composer the page creates: a new number is a new element. */
  readonly instance: number;
  readonly groupId: string;
  readonly connected: boolean;
  /** The textarea's own value; null — no textarea right now. */
  readonly value: string | null;
  /** The component's model — what a send sends (not the field's text). */
  readonly model: string;
  /** The page's draft cache for the group (`dmContentCache_`), shared by every composer of the group. */
  readonly cached: string;
  /** The component's own Shift flag (set by a Shift keydown on the field, cleared by its keyup). */
  readonly shiftDown: boolean;
  readonly canSend: boolean;
  readonly sending: boolean;
  /** `div.message-composer` carries `hidden` (the DM rules are not met). */
  readonly hidden: boolean;
  /** `div.no-dm-allowed` is there. */
  readonly noDmAllowed: boolean;
  readonly recording: boolean;
  readonly attachments: readonly AttachmentView[];
}

/** The main conversation's message list (`.message-content-list`) and its scroll rules. */
export interface ListView {
  readonly groupId: string;
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** The container's `scrollBlock`: a new message does not bring the list down. */
  readonly scrollBlock: boolean;
  /** The container's `resizeScrollBlock_`: a size change of the list does not bring it down (more than 1 px from the bottom). */
  readonly resizeScrollBlock: boolean;
  /** Loaded messages of the group (oldest first). */
  readonly messages: number;
  /** Their ids, oldest first — what the page holds; a test compares MAIN's observation with it (R20 P7b). */
  readonly ids: readonly string[];
  /** `app-group-message` elements in the list (quotes would add more; the stand has none). */
  readonly rendered: number;
  /** No older page left on the server side. */
  readonly loadedAll: boolean;
  readonly typing: boolean;
}

export interface InboxView {
  /** Groups loaded into the inbox so far (20 per page). */
  readonly loaded: number;
  /** Group ids of the rows in the DOM, top to bottom. */
  readonly rendered: readonly string[];
  readonly selected: string | null;
  readonly topSpacer: number;
  readonly bottomSpacer: number;
}

export interface GroupView {
  readonly id: string;
  readonly fanId: string;
  readonly username: string;
  readonly partners: number;
  readonly dmRulesUnmet: boolean;
  readonly unread: number;
  /** In the page's group cache: opening it re-creates the container in the same task. */
  readonly cached: boolean;
}

export interface RouteView {
  readonly path: string;
  readonly groupId: string | null;
  /** The gallery replaces the chat header and the container, the address unchanged. */
  readonly gallery: boolean;
}

export type FanslyStandTheme = 'bright' | 'dark';

/**
 * Who answers the page: `local` — itself, from its in-page world (no network: DOM tests, a page served by hand);
 * `server` — the fake Fansly (R20 P6b), by real XHR requests and a real socket, as fansly.com asks apiv3 and wsv3.
 */
export type FanslyStandBackend = 'local' | 'server';

/** The page's socket to the fake Fansly. */
export interface SocketView {
  /** Sockets the page created so far — `new WebSocket` calls: each one is a new instance (the tap's epoch). */
  readonly created: number;
  readonly state: 'connecting' | 'authorizing' | 'connected' | 'disconnected';
  /** `t: 1` frames read: sessions verified. */
  readonly verified: number;
  /** Text frames read (a batch's inner frames each count). */
  readonly frames: number;
  /** Frames the page could not parse (it drops them). */
  readonly damaged: number;
}

export type OpenVia =
  /** `router.navigateByUrl`, as the page's own code does. */
  | 'router'
  /** A click on the inbox row's `<a href="/messages/<id>">` (it must be rendered). */
  | 'link'
  /** `history.pushState` + a `popstate` with `state: null` (what an extension can do, architecture.md §7.6). */
  | 'popstate';

/** `window.__fanslyStand`. */
export interface FanslyStandControl {
  readonly version: 1;
  readonly ready: boolean;
  readonly ids: FanslyStandIds;
  readonly backend: FanslyStandBackend;
  /** The session is dead (`GET /account/me` answered 401, or the socket said so): the page shows no chat. */
  readonly loggedOut: boolean;
  route(): RouteView;
  groups(): GroupView[];
  /** Resolves once the navigation ran (the container may still wait for its group). */
  open(groupId: string, via?: OpenVia): Promise<void>;
  openInbox(): Promise<void>;
  /** Every answer of the page's own backend takes this long from now on (`local` only; the fake Fansly's delays are scripted on the server). */
  setLatency(ms: number): void;
  /** Drops the group from the page's cache: the next open waits for `GET /group/<id>/`. */
  forget(groupId: string): void;
  /**
   * The group's participants other than the creator (the header's contact block stands only at 1). With the fake
   * Fansly this and the four controls below ask the SERVER, and the page hears of it the way Fansly's page would
   * (`4/6` and `4/7` frames, `5/22`, `5/1`): the effect lands a moment after the call.
   */
  setPartners(groupId: string, count: number): void;
  setDmRulesUnmet(groupId: string, unmet: boolean): void;
  /** The partner's online status (1 online, 2 away, 3 offline, 4 hidden): the sub-row's status line. */
  setStatus(groupId: string, status: 1 | 2 | 3 | 4): void;
  /** Opens or closes the gallery of the open chat (as its «Gallery» icon and its back button do). */
  setGallery(open: boolean): void;
  /** The fan starts typing (socket 5/22): the typing line until 3.1 s pass without another, or the fan's message. */
  fanTyping(groupId: string): void;
  /** A message of the fan arrives (socket 5/1). */
  fanMessage(groupId: string, text: string): void;
  /**
   * The last rendered message of the open chat grows by this many px (an image that loaded): the list's content grows,
   * its own box does not — nothing of the page brings it down (its size rule watches the list's box only).
   */
  growLastMessage(px: number): void;
  setTheme(theme: FanslyStandTheme): void;
  /** The old extension's four marks on the page (its root re-inserted before the main composer after every chat switch). */
  setOldExtension(on: boolean): void;
  /** Opens the mini-chat on a group (its own container and composer); null closes it. */
  setMiniChat(groupId: string | null): void;
  /**
   * Re-creates the main composer's field branch (`div.message-composer`, the textarea with it) inside the same
   * `app-group-message-input`, the address unchanged: what a change of the composer's `mode` does in Fansly's
   * template. Beyond what the stand's DM-rule and voice controls do, which follow the bundle (see main.ts).
   */
  recreateField(): void;
  /** The page's socket; null with the `local` backend. */
  socket(): SocketView | null;
  /**
   * The page has settled (`server` only; `local` always says true): its socket is verified, none of its requests is
   * in flight, its unread reading is over, and no read mark waits for its collecting delay or is going out in chunks.
   * A test waits for it before it marks a journal and before it reads one: the page sends its marks 1–3 s later and
   * 25 at a time, 200 ms apart, so «no request in flight» alone is not «done». A request that never ends (one a
   * neighbour's guard swallowed) keeps the page from ever being idle.
   */
  idle(): boolean;
  /** A message-like notification names these messages: the page asks for them by id (`GET /messages?ids=`). `server` only. */
  notify(messageIds: string[]): void;
  /**
   * The tab was hidden for `hiddenMs` and is visible again: past 30 s the page reads its unread messages and asks for
   * the open chat's fresh end again; past 1 s it looks at its socket. `server` only.
   */
  cameBack(hiddenMs: number): void;
  composers(): ComposerView[];
  list(): ListView | null;
  inbox(): InboxView;
  /** Open modals, by their component tag. */
  modals(): string[];
  journal(since?: number): FanslyPageJournalEntry[];
}
