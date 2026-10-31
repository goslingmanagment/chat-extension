// Public shapes of the fake hub (architecture.md §12 п. 2, R02): what a test
// scripts (SSE steps, scripted answers), the control commands (the same JSON
// in-process and over the loopback control endpoint) and the request journal.
// Everything here is JSON-serialisable: the loopback control API carries it.

import type { ClientFeatureFlag, HubAiFeature, HubErrorBody, HubFrame, HubRouteKey, OnlineAttemptRequest } from '@cg/contracts';
import type { FakeFeedRecord, FakeFeedTransaction } from './onlyfans-feed';

import type { HttpExchange, HttpScenario, SseScenario, SseStep } from '../scenarios/hub/types';
import type { FakeVoiceOutcome, VoiceNoteSnapshot } from './voice';

// ── SSE ────────────────────────────────────────────────────────────────────

/**
 * One step of a scripted stream: the scenario steps (frame with `afterMs`,
 * heartbeat, eof) plus the failure shapes a real connection has.
 */
export type FakeSseStep =
  | SseStep
  /** Pause, ms (scaled by `timeScale`). */
  | { readonly kind: 'wait'; readonly ms: number }
  /** Pause until the test releases this gate (`release`); `status` lists the gates a stream waits on. */
  | { readonly kind: 'gate'; readonly name: string }
  /** Bytes as they are: an unknown event, a frame that fails its schema, broken JSON. */
  | { readonly kind: 'raw'; readonly text: string }
  /** Half of this frame (or `keepBytes` of it), then a clean EOF: the client sees a truncated stream. */
  | { readonly kind: 'cut'; readonly frame: HubFrame; readonly keepBytes?: number }
  /** The connection breaks: the client's body read fails (a network error, not an EOF). */
  | { readonly kind: 'reset' }
  /** Nothing more, the connection stays open until the client aborts (a hung hub). */
  | { readonly kind: 'stall' };

/** One answer of the AI stream route: an HTTP refusal before the stream, or a 200 SSE body. */
export type FakeSseResponse =
  | { readonly kind: 'http-error'; readonly status: number; readonly body: HubErrorBody; readonly retryAfterSec?: number }
  | { readonly kind: 'stream'; readonly steps: readonly FakeSseStep[] };

// ── Scripts ────────────────────────────────────────────────────────────────

/**
 * How a scripted exchange is matched to an incoming request:
 * - `exact` — same route and the same facade request (deep-equal);
 * - `route` — same route and the same path params (`pageLabel`, `fanRef`,
 *   `feature`…), whatever the query or body (a real client's ids differ).
 */
export type ScriptMatch = 'exact' | 'route';

/** What a request nothing in the script matches gets: a 500 and a journal violation (`fail`), or the model's answer (`model`). */
export type UnscriptedPolicy = 'fail' | 'model';

// ── Control ────────────────────────────────────────────────────────────────

/**
 * `pilot-pages` — the default: the pilot as the owner switches it on, page by page, with the `"*"` row empty
 * (every top-level flag false). `pilot-on` — the same features through the `"*"` row.
 */
export type BootstrapPresetName = 'pilot-pages' | 'pilot-on' | 'all-off' | 'master-off';

/** The owner's hub configuration the model serves bootstrap and its checks from (hub-pr-plan.md PR 8, §4.12). */
export interface FakeHubConfigPatch {
  /** `chatExtensionEnabled`: off → every feature of an OnlyFans page `disabled`, every flag false. */
  readonly master?: boolean;
  /** `chatExtensionFeatures["*"]`: the value of every page that has no row of its own for the flag, and the bootstrap's top-level `flags`. */
  readonly flags?: Readonly<Partial<Record<ClientFeatureFlag | (string & {}), boolean>>>;
  /** `chatExtensionFeatures["<pageLabel>"]`: wins over `flags` on that page. */
  readonly pageFlags?: Readonly<Record<string, Readonly<Partial<Record<ClientFeatureFlag | (string & {}), boolean>>>>>;
  /** Capabilities the hub serves and declares (a route of an undeclared one is not deployed: 404). */
  readonly capabilities?: readonly string[];
  readonly minVersion?: string;
  readonly bindingsByHost?: Readonly<Record<string, number>>;
  /** `config` control: deepMax is 1500, 3000 or 5000 (HF-6), shared by both platforms. */
  readonly limits?: Readonly<Record<string, unknown>>;
  /** H-3 deployed: `client: 'chat-extension'` issues a narrow token and echoes it. Off: the hub drops `client` (a full token, no echo). */
  readonly narrowTokens?: boolean;
  /** H-2 deployed: `client/bootstrap` exists. Off: 404, as on a hub before H-2 (the client's dev/compat mode). */
  readonly clientBootstrap?: boolean;
  /** AI quota left today for every user (null = unlimited); 0 → 429 `quota_denied`. */
  readonly quotaRequestsToday?: number | null;
  /**
   * `ai-limit-v1`: the person's own daily AI limit (null = none): spent today and one generation's cost, micro-USD;
   * `poolMicroUsd` — today's shared pool (absent: an empty one). Only this person draws from it here.
   */
  readonly personalAiLimit?: { readonly dailyLimitMicroUsd: number; readonly todayMicroUsd: number; readonly perCallMicroUsd: number; readonly poolMicroUsd?: number } | null;
  /** A finished generation becomes visible to H-5 this long after `done` (`generation_not_ready` before). */
  readonly generationVisibleAfterMs?: number;
  /** Rows of the Spenders board per page. */
  readonly spendersTotal?: number;
  /** Delay before each model-stream content chunk, ms. */
  readonly aiChunkDelayMs?: number;
  /** Delay before the first content chunk, ms: the model's hidden thinking. */
  readonly aiThinkMs?: number;
  /** Every part of a draft the model writes ends with ` @<conversationRef>`: a test can tell whose chat a text was written for. */
  readonly aiNameFan?: boolean;
  /**
   * «Онлайн»: the stand's own presence of a page — its first board fans seen lately, OnlyFansAPI's «online now» on an
   * OnlyFans page (default on). Off — a page knows only what its tabs reported (OnlyFansAPI's feed gone, hub #952).
   */
  readonly onlineStand?: boolean;
  /**
   * What the model answers for a hub feature (`fast-reply`, `hi-greeting`, `fan-summary`, `chat-review`,
   * `coach-chat`…), as it is — `[NEXT]`, `[VARIANT]`, the Review frame and Coach's draft fences included.
   * Features not named keep their synthetic answer; `{}` restores them all.
   */
  readonly aiTexts?: Readonly<Record<string, string>>;
  /**
   * Pages the hub's voice-notes lane does not serve (R20 HF-4б), on either site: their `voice` reads `lane_off` in the
   * bootstrap, a voice script is `gate_voice_disabled`, a fresh create `voice_disabled`. `[]` — it serves every page.
   * Models the spend switch: existing renders remain readable and replayable.
   */
  readonly voiceLaneOff?: readonly string[];
  /**
   * 1.49.0: the voice-notes lane's day (hub `voiceNotesDailyCharBudget` per page, `voiceNotesGlobalDailyCharBudget` over
   * every page, `voiceNotesScriptMaxChars`; 5000, 20000 and 600 by default) and what pages spent today before the
   * stand's own takes (`spentToday`, by page label; merged page by page). `voiceNoteAllowance` answers from it, and a
   * fresh create longer than what is left is `voice_quota_denied`: `spentToday: { [page]: 4_800 }` puts a page near
   * its limit, `5_000` over it.
   */
  readonly voiceDay?: { readonly pageChars?: number; readonly globalChars?: number; readonly scriptMaxChars?: number; readonly spentToday?: Readonly<Record<string, number>> };
  /**
   * 2026-10-27 (`coach-depth-v1`): a long conversation for Coach's depth, on every chat — the archive the feed's first
   * page dates (`stored` messages, the oldest `oldestDays` ago, older ones sparser) and Coach's window is served from;
   * and Coach's own ```more note (`note`) at the end of an answer that read fewer than `moreBelow` of them. null — the
   * stand's own archive, and no note.
   */
  readonly coachDepth?: CoachDepthKnob | null;
}

/** The `coachDepth` knob of the fake hub. */
export interface CoachDepthKnob {
  readonly stored: number;
  readonly oldestDays: number;
  readonly moreBelow: number;
  readonly note: string;
  /** Coach's answer once it read `moreBelow` or more (it saw what it asked for); absent — the usual `coach-chat` text. */
  readonly deepText?: string;
}

/**
 * One fan at the top of the Spenders board (`spenderFans`). Money in whole dollars; ages in seconds before the
 * hub's «now» (null — never). Anything left out keeps the synthetic row's value.
 */
export interface SpenderSeed {
  readonly fanRef: string;
  /** Explicit null lets a test exercise the page cache/search when the hub has no group yet. */
  readonly conversationRef?: string | null;
  readonly username?: string;
  readonly displayName?: string | null;
  readonly lifetimeUsd?: number;
  /** Spent in the board's period; null — nothing in it. */
  readonly windowUsd?: number | null;
  readonly fanWroteAgoSec?: number | null;
  readonly weWroteAgoSec?: number | null;
  /** Stands in «ждут ответа» (the fan wrote last and nobody answered). */
  readonly awaiting?: boolean;
  /** The newest message's text, the row's «Последнее сообщение» (default: a stock line by the row's rank). */
  readonly preview?: string;
}

export type FakeHubCommand =
  /** Back to the defaults: config, tokens, claims, data, scripts, gates, clock mode. The journal keeps its sequence. */
  | { readonly op: 'reset' }
  | { readonly op: 'preset'; readonly name: BootstrapPresetName }
  | { readonly op: 'config'; readonly patch: FakeHubConfigPatch }
  /** Replays an HTTP scenario (by name from HTTP_SCENARIOS, or inline). */
  | { readonly op: 'useHttpScenario'; readonly scenario: string | HttpScenario; readonly match?: ScriptMatch; readonly unscripted?: UnscriptedPolicy }
  /** Answers the next AI stream POSTs with a stream scenario's responses (by name from SSE_SCENARIOS, or inline). */
  | { readonly op: 'useSseScenario'; readonly scenario: string | SseScenario; readonly match?: ScriptMatch }
  /** Appends ad hoc exchanges to the HTTP script. */
  | { readonly op: 'scriptHttp'; readonly exchanges: readonly HttpExchange[]; readonly match?: ScriptMatch; readonly unscripted?: UnscriptedPolicy }
  /** The next AI stream POSTs (of `feature`, or any) get these responses, in order. */
  | { readonly op: 'scriptSse'; readonly responses: readonly FakeSseResponse[]; readonly feature?: HubAiFeature }
  /**
   * What becomes of the next fresh voice-note creates (voice.ts `FAKE_VOICE_OUTCOMES`), one outcome each, in order:
   * each is used by the next create — never a replay — that gets as far as the point where it applies (a refusal at
   * its place in the hub's admission, a render or a lost answer once admitted). Unscripted, a render completes.
   */
  | { readonly op: 'scriptVoice'; readonly outcomes: readonly FakeVoiceOutcome[] }
  /** Drops every scripted HTTP answer, stream and voice outcome not used yet, and the unscripted policy. */
  | { readonly op: 'clearScripts' }
  | { readonly op: 'release'; readonly gate: string }
  | { readonly op: 'clock'; readonly mode?: 'manual' | 'system'; readonly setMs?: number; readonly advanceMs?: number }
  /** Revokes tokens (all, or of a user, or one by id): the next call gets 401 `token_revoked`. */
  | { readonly op: 'revokeTokens'; readonly userId?: number; readonly tokenId?: number }
  /** Expires tokens now: the next call gets 401 `token_expired`. */
  | { readonly op: 'expireTokens'; readonly userId?: number; readonly tokenId?: number }
  | { readonly op: 'health'; readonly status?: 'ok' | 'degraded'; readonly compatibleClientSdks?: readonly string[] | null; readonly contractHash?: string }
  /** Upserts a persona of the catalog (a new definitionId = the owner changed the persona). */
  | { readonly op: 'persona'; readonly key: string; readonly definitionId: string; readonly displayName?: string; readonly status?: 'active' | 'archived' }
  /** An owner/team lead resolved an uncertain send in the hub cabinet (H-7e). */
  | {
      readonly op: 'resolveCustody';
      readonly pageLabel: string;
      readonly fanRef: string;
      readonly attemptId: string;
      readonly outcome: 'sent' | 'not_sent';
      readonly platformMessageId?: string;
    }
  /** The desktop holds an unresolved new-follower command for this fan (blocks a greeting dispatch). */
  | { readonly op: 'desktopHold'; readonly pageLabel: string; readonly fanRef: string; readonly held: boolean }
  /** The desktop's new-follower command for this fan succeeded: the greeting is confirmed outside this client (source `desktop-outbox`). */
  | { readonly op: 'desktopGreeting'; readonly pageLabel: string; readonly fanRef: string }
  /** A fan message lands in the archive (the feed's head moves, a new snapshot). On Fansly `fanRef` names the conversation's archive: the group. */
  | { readonly op: 'archiveMessage'; readonly pageLabel: string; readonly fanRef: string; readonly sender?: 'fan' | 'model'; readonly messageId?: string }
  /**
   * R20 P6c1: a conversation's archive becomes exactly these messages, oldest first (a new archive generation): what
   * the AI's reader reads, and beside it what the hub holds without reading (`held`) or tombstoned (`deleted`).
   * `lookupFails` — the hub's lookup of the ids outside the served window fails there (the window check answers
   * `unknown`). A message may bring what the site shows of it — its `text`, when it was written (`at`, ISO), a paid
   * message's price (`priceMills`) — as the showcase world's mirror of a stand chat does; without them the archive's
   * own synthetic text, a minute apart.
   */
  | {
      readonly op: 'archiveConversation';
      readonly pageLabel: string;
      readonly conversationRef: string;
      readonly messages: readonly { readonly id: string; readonly sender: 'fan' | 'model'; readonly state?: 'held' | 'deleted'; readonly text?: string; readonly at?: string; readonly priceMills?: number }[];
      readonly lookupFails?: boolean;
    }
  /**
   * R20 P6c1 (hub HF-9): the page's capture of a chat (`page_dm_threads`) names its fan — or, `fanRef: null`, a fan it
   * does not know. The pair a request names is checked against it: another fan's group is 409
   * `conversation_fan_mismatch`, a group without a known fan is served `unverified`.
   */
  | { readonly op: 'thread'; readonly pageLabel: string; readonly conversationRef: string; readonly fanRef: string | null }
  /** The pages granted to a user (by username or userId), replacing the current grant: `me`, bootstrap and every page route follow it (404 outside it). */
  | { readonly op: 'grantPages'; readonly username?: string; readonly userId?: number; readonly pages: readonly string[] }
  /**
   * The owner links a page to a platform account (`pages.external_page_id`; null — unlinks it): bootstrap,
   * `me` and every page route follow it, and the page's binding revision grows.
   */
  | { readonly op: 'pageAccount'; readonly pageLabel: string; readonly platformAccountId: string | null }
  /** The fan's archive is rebuilt (the hub's archive generation moves): every feed cursor of the fan is `cursor_invalid` from now on. */
  | { readonly op: 'archiveRebuild'; readonly pageLabel: string; readonly fanRef: string }
  /** A subscription event lands in «Новые». */
  | {
      readonly op: 'audienceEvent';
      readonly pageLabel: string;
      readonly fanRef: string;
      readonly kind?: 'new' | 'returning';
      readonly trial?: boolean;
      readonly fanWrote?: boolean;
      readonly handSent?: boolean;
      /** The subscription this long before now (the greeting reminder). */
      readonly agoMs?: number;
      /** The fan's handle and name as the platform shows them (default: a synthetic handle, no name). */
      readonly username?: string;
      readonly displayName?: string;
    }
  /**
   * The first rows of every page's Spenders board are these fans, in this order — fans the e2e's stand has, so
   * a chat a preview names can be opened, inserted into and sent to. The board's shelves become the six
   * standard tiers counted over its rows, and «ждут ответа» is the fans marked `awaiting`. `fans: []` — back
   * to the synthetic board.
   */
  | { readonly op: 'spenderFans'; readonly fans: readonly SpenderSeed[] }
  /**
   * Chat Memory week 1: another chatter (`name`, a userId of nobody signed in here) wrote to the fan `agoMs` before now
   * (default 3 minutes): «в разговоре» answers it for the next 15 minutes.
   */
  /**
   * Chat Memory week 3, «Очередь» of a page: «Ждут» rows in place of the seeded ones (with aliases and chats), the
   * «Вернуть» list and the «Передача» as the hub answers them. Each one left out stays as it was.
   */
  | { readonly op: 'queue'; readonly pageLabel: string; readonly waiting?: readonly Record<string, unknown>[]; readonly winBack?: Record<string, unknown>; readonly handoff?: Record<string, unknown> }
  | { readonly op: 'talking'; readonly pageLabel: string; readonly fanRef: string; readonly conversationRef?: string; readonly name: string; readonly agoMs?: number }
  /**
   * «Онлайн» of a page as the hub answers it (`clientOnline`): `items` — the fans online, each a fan id and any field of
   * the hub's item (the rest filled in; `seenAgoMs` / `onlineAgoMs` count back from the hub's «now» at every read, so an
   * item stays fresh in a long session; a reason, act or aside left out is the hub's rules' over the given facts);
   * `templates` — the guide's texts. `null` — back to the stand's fans (items) or the guide (templates); left out — as
   * it was. What the chatters do in the window and the Fansly tabs' reports go on top of either.
   */
  | { readonly op: 'online'; readonly pageLabel: string; readonly items?: readonly Record<string, unknown>[] | null; readonly templates?: readonly Record<string, unknown>[] | null }
  /**
   * «Очереди» of a page (fan-queues.ts): `stand` — the owner's prototype over the page's board fans (a cold batch queue,
   * the standing «Платили, молчат» with one fan who answered, one paused, one the chatter asked for); null — none, as a
   * page of the hub has until someone asks Gengar. `userId` — the chatter the stand signs in as (WORLD.user by default).
   */
  | { readonly op: 'fanQueues'; readonly pageLabel: string; readonly set: 'stand' | null; readonly userId?: number }
  /** Chat Memory week 2: the fan's card as the hub answers it (`clientFanCard`), until a decision or a fact change moves it. */
  | { readonly op: 'fanCard'; readonly pageLabel: string; readonly fanRef: string; readonly card: Record<string, unknown> }
  /** 2026-10-29: a note write recorded before the run (a colleague's), as `clientNoteAttributions` would have it; the
   * person by their login (`chatter` — any other). */
  | { readonly op: 'noteWrite'; readonly pageLabel: string; readonly fanRef: string; readonly noteRef: string; readonly action: 'created' | 'edited' | 'deleted'; readonly login: string; readonly at: string }
  /** Read-only snapshot for assertions (no secrets: token ids, never tokens). */
  | { readonly op: 'status' };

/** «Очереди» (fan-queues.ts): one report of a fan's outcome, as the hub journals it (ids, a word of a closed list, a time; never a text). */
export interface FakeFanQueueDone {
  readonly pageLabel: string;
  readonly userId: number;
  readonly queueId: number;
  readonly itemId: number;
  readonly fanRef: string;
  readonly outcome: 'sent' | 'skipped';
  readonly act: string | null;
  readonly templateId: string | null;
  readonly skipReason: string | null;
  readonly uncertain: boolean;
  readonly at: string;
}

/** «Онлайн» (online.ts): one action of a chatter in the window, as the hub journals it (ids, a word of a closed list, a time; never a text). */
export interface FakeOnlineAttempt {
  readonly attemptId: number;
  readonly pageLabel: string;
  readonly fanRef: string;
  readonly userId: number;
  /** The chatter's username: who marked «Не предлагать». */
  readonly by: string;
  readonly action: OnlineAttemptRequest['action'];
  readonly act: OnlineAttemptRequest['act'] | null;
  readonly templateId: string | null;
  readonly reason: string | null;
  readonly at: number;
}

/** One presence report a tab sent, as kept: the fans of the page and when each was seen (Fansly) or found online (ChatSpace). */
export interface FakeOnlinePresenceReport {
  readonly pageLabel: string;
  readonly userId: number;
  readonly seen: readonly { readonly fanRef: string; readonly lastSeenAt: string }[];
  readonly at: number;
}

/** One lend of a page's probe (hub #952): to whom, how many spenders it named, when. */
export interface FakeOnlineProbe {
  readonly pageLabel: string;
  readonly userId: number;
  readonly fanRefs: number;
  readonly at: number;
}

/**
 * What one request of the client-context lane (Telegram) gave the model: the chat the tab read, as sent. The stand's
 * chats are synthetic; `pnpm see` writes these to `client-context.json` (the journal keeps only their lengths).
 */
export interface FakeClientContextRecord {
  readonly feature: string;
  readonly pageLabel: string;
  readonly fanRef: string | null;
  readonly conversationRef: string;
  readonly at: string;
  readonly clientContext: unknown;
}

/** What an AI request read of the hub's archive (its transcript's newest messages), as the fake's reader served it. */
export interface FakeAiReadRecord {
  readonly feature: string;
  readonly pageLabel: string;
  /** The conversation the transcript was read from (on OnlyFans the fan). */
  readonly ref: string;
  readonly at: string;
  /** The served window's newest message ids, newest first (at most 10). */
  readonly refs: readonly string[];
}

export interface FakeHubStatus {
  readonly origin: string;
  readonly clock: { readonly now: number; readonly manual: boolean };
  readonly configRevision: number;
  readonly master: boolean;
  readonly tokens: ReadonlyArray<{ readonly id: number; readonly userId: number; readonly client: string | null; readonly state: 'active' | 'pending' | 'revoked' | 'expired' }>;
  readonly script: { readonly httpLeft: number; readonly sseLeft: number; readonly httpLeftRoutes: readonly HubRouteKey[]; readonly voiceLeft: number };
  /** Gates a stream waits on now. */
  readonly waitingGates: readonly string[];
  readonly openStreams: number;
  /** Pages granted per user. */
  readonly grants: ReadonlyArray<{ readonly userId: number; readonly pages: readonly string[] }>;
  readonly claims: ReadonlyArray<{
    readonly pageLabel: string;
    readonly fanRef: string;
    readonly greeting: 'none' | 'confirmed';
    readonly lease: string;
    readonly attempts: ReadonlyArray<{ readonly attemptId: string; readonly state: string; readonly partIndex: number }>;
  }>;
  readonly ingested: number;
  /** Every voice note the lane admitted, in order, with its state now: one per paid create (a replay adds none). */
  readonly voiceNotes: readonly VoiceNoteSnapshot[];
  /** «Онлайн»: what the chatters did in the window, the tabs' presence reports and the probes lent, in order (ids and times). */
  readonly online: { readonly attempts: readonly FakeOnlineAttempt[]; readonly presence: readonly FakeOnlinePresenceReport[]; readonly probes: readonly FakeOnlineProbe[] };
  /** hub #953: the OnlyFans feed's records as reported (with who and what the fake did) and the transactions it wrote. */
  readonly onlyfansFeed: { readonly records: readonly FakeFeedRecord[]; readonly transactions: readonly FakeFeedTransaction[] };
  /** «Очереди»: every fan's outcome the client reported, in order (ids and closed words only). */
  readonly fanQueues: { readonly reports: readonly FakeFanQueueDone[] };
  /** Telegram: the chats the AI requests carried (`clientContext`), in order. */
  readonly clientContexts: readonly FakeClientContextRecord[];
  /** hub #953's check: what each AI request read of the archive — a message the feed brought is in its context. */
  readonly aiReads: readonly FakeAiReadRecord[];
}

// ── Journal ────────────────────────────────────────────────────────────────

/**
 * - `route` — one of the client's routes (HUB_ROUTES);
 * - `forbidden` — an operation or route family the client must never call (§8.1 «Никогда»);
 * - `unknown` — any other path or method;
 * - `foreign-origin` — the in-process fetch was asked for another origin (the request never left);
 * - `legacy` — `GET /pages`, which only the client's dev/compat mode reads from a hub without
 *   `client/bootstrap` (docs/hub-layer.md): served to a full token, refused to a narrow one.
 */
export type FakeHubCallKind = 'route' | 'forbidden' | 'unknown' | 'foreign-origin' | 'legacy';

/** Who answered: the model, a script, or the hub's own checks before either (auth, schema, grant, flag, capability). */
export type FakeHubServedBy = 'model' | 'script' | 'check' | 'unscripted';

export type StreamOutcome = 'done' | 'error-frame' | 'eof' | 'cut' | 'reset' | 'stall' | 'aborted';

export interface FakeHubJournalEntry {
  readonly seq: number;
  /** Hub clock, epoch ms. */
  readonly at: number;
  readonly method: string;
  /** Pathname only: queries and bodies are in `request`, redacted. */
  readonly path: string;
  readonly kind: FakeHubCallKind;
  readonly route: HubRouteKey | null;
  /** Forbidden operation key or family (`ofapi`, `events`…). */
  readonly operation: string | null;
  /** 0 — no answer: the request never left (`foreign-origin`), or got none (a voice create scripted `drop` or `hang`; `reason` says which). */
  readonly status: number;
  /** Hub error code of a refusal. */
  readonly error: string | null;
  readonly reason: string | null;
  readonly servedBy: FakeHubServedBy;
  /** The bearer's token id and profile; never the token itself. */
  readonly token: { readonly id: number; readonly client: string | null } | null;
  /** `x-client-version`. */
  readonly clientVersion: string | null;
  /** The facade request, redacted by default: only ids, enums, dates and cursors under known keys stay; every other string is its length (journal.ts `redact`). */
  readonly request: unknown;
  /** Schema problems of a 400 (paths and rules, never values). */
  readonly issues: readonly string[];
  /** AI stream: frames written and how the stream ended (filled in when it ends). */
  readonly stream: { readonly frames: readonly string[]; readonly outcome: StreamOutcome | null } | null;
}

export interface FakeHubJournalPage {
  readonly entries: readonly FakeHubJournalEntry[];
  /** Pass as `since` to read only what came after. */
  readonly next: number;
}
