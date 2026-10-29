// Tab and extension pages ↔ background protocol (architecture.md §5.4), the
// per-type half: the shared request registry (payload, response, allowed
// senders), the event registry and their payload schemas. Transport, sender
// rules and the envelope are in tab-protocol.ts; a site's own registry is its
// own module (1.15.0: tab-messages-fansly.ts), never imported here.

import * as z from 'zod/mini';
import { AccountAdvancedSchema, FreshnessDaySchema, LocalSpendReportSchema, NetworkSessionSnapshotSchema, PageDiagnosticsSchema } from './diagnostics';
import { SiteAccessRequestSchema, SiteAccessStateSchema } from './site-access';

import { CgCodeSchema, CgErrorWireSchema, SettingsRouteSchema } from './errors';
import { FeatureIdSchema, SurfaceSchema } from './features';
import { HostContractReportSchema, IncomingFactSchema, InsertReceiptSchema, SendAttributionFactSchema } from './host';
import { ChatKeySchema, ChatRefSchema, HostAccountSchema, HostKindSchema, HubBindingSchema, HumanCauseSchema, PartRefSchema, RoleSchema, SessionIdentitySchema, TargetSchema, type HostKind } from './ids';
import { DEBUG_LIMITS, LOG_LIMITS, PART_LIMITS, SIGN_IN_LIMITS, STORAGE_LIMITS } from './limits';
import { LogRecordFromUiSchema, LogRecordSchema } from './logs';
import { GenerationDebugSchema, AdmissionSchema, OpStateSchema, OpViewSchema, PhaseSchema, StartOpSchema } from './ops';
import {
  ActionTokenSchema,
  CountSchema,
  EpochMsSchema,
  EpochTokenSchema,
  GenerationRefSchema,
  HubIntIdSchema,
  HubOriginSchema,
  IsoTimestampSchema,
  MicroUsdSchema,
  NativeIdSchema,
  OpenTokenSchema,
  PersonaDefinitionIdSchema,
  PersonaKeySchema,
  TimeZoneSchema,
  UuidSchema,
  boundedText,
  displayText,
} from './primitives';
import { DispatchTicketSchema, FreshnessCheckpointSchema, PendingIdSchema, SendAttemptViewSchema, SendFuseFactSchema, SendFuseStateSchema, SendGroupSchema, SendPurposeSchema, checkpointMatches, partInGroup, SendMarksSchema } from './send';
import { CONTRACT_HASH_PATTERN } from './hub/auth';
import { HiFanAvatarUrlSchema } from './hi-start-proof';
import { PersonaCatalogSchema } from './hub/ai';
import { BootstrapSchema } from './hub/bootstrap';
import { FEED_LIMITS, FeedPageSchema } from './hub/feed';
import { AudienceNewPageSchema, ClaimStateSchema } from './hub/newcomers';
import { DossierSchema, RecapStatusSchema, SharedRecapsSchema } from './hub/recaps';
import { FAN_CUSTOM_MAX_CHARS, FAN_FACT_MAX_CHARS, FanCardSchema, FanFactChangeResultSchema, FanLinkDecideResultSchema } from './hub/fan-card';
import { HandoffSchema, WinBackAttemptResultSchema, WinBackListSchema } from './hub/queue';
import { ONLINE_ATTEMPT_ACTIONS, ONLINE_SENT_ACTS, OnlineAttemptResultSchema, OnlineListSchema } from './hub/online';
import { FAN_QUEUE_PORTION_MAX, FAN_QUEUE_SENT_ACTS, FAN_QUEUE_SKIP_REASONS, FanQueueItemDoneSchema, FanQueueReleaseSchema, FanQueuesSchema, FanQueueTakeSchema } from './hub/fan-queues';
import { AI_USAGE_LIMITS, AiUsageReportSchema } from './hub/usage';
import { BusinessDateSchema } from './hub/wire';
import { QueuePageSchema, SpenderDetailSchema, SpendersBoardSchema, SpendersStatsSchema, StatsQuerySchema, type HubSpenderPeriod } from './hub/spenders';
import { SETTINGS_OPTIONS_ONLY_SECTIONS, SettingsPatchSchema, SettingsStateSchema, SettingsV1Schema, ToneIdSchema } from './settings';
import { FANSLY_NOTES_VIEWS } from './settings-ext';
import { NotesFillOpViewSchema, NotesFillStartSchema } from './notes-fill';
import { NOTE_ATTRIBUTION_ACTIONS } from './hub/note-attribution';
import { TabRegisterRequestSchema, TabRegisterResponseSchema, senderAllowed, type ExtensionPage, type TabEventSpec, type TabRequestSpec, type TabSender } from './tab-protocol';
import { VOICE_LIMITS, VoiceAllowanceSchema, VoiceAudioSchema, VoiceScriptStartSchema, VoiceSessionSchema, VoiceWriteResultSchema } from './voice';
import { JOURNAL_KINDS } from './vm/selectors';
import { HealthCodeSchema, TabHealthReportSchema } from './telemetry';

// ── Shared payload pieces ──────────────────────────────────────────────────

const Empty = z.strictObject({});

/**
 * Chat Memory week 1: «в разговоре» — a fan of a page another chatter wrote to in the last 15 minutes: the page and the
 * fan (the boards' rows), the chats of this browser's accounts bound to the page (`host:hostAccountId:fanId`: the dock,
 * the quick jump), the names, newest first (never the person themself), and the newest message's time. A warning,
 * never a block.
 */
export const TalkingMarkSchema = z.strictObject({
  pageId: HubIntIdSchema,
  fanRef: NativeIdSchema,
  chatKeys: z.array(ChatKeySchema).check(z.maxLength(20)),
  names: z.array(displayText(128)).check(z.minLength(1), z.maxLength(10)),
  lastSentAt: IsoTimestampSchema,
});
export type TalkingMark = z.infer<typeof TalkingMarkSchema>;
export const TalkingMarksSchema = z.strictObject({ marks: z.array(TalkingMarkSchema).check(z.maxLength(5000)) });
export type TalkingMarks = z.infer<typeof TalkingMarksSchema>;
const Ack = z.strictObject({ recorded: z.boolean() });

/** A hub page + fan the tab asks about; the background re-checks the page is in the tab's binding. */
const PageFan = { pageId: HubIntIdSchema, fanRef: NativeIdSchema };
/**
 * 1.15.0 (R20 F6b): a read by conversation (the recaps and their status, the dossier save from a generation, the
 * archive feed) names the conversation of the fan when it is not the fan — on Fansly the group. Absent — the
 * conversation is the fan, as on ChatSpace before 1.15.0. The card, the dossier and the lease are the fan's alone.
 */
const PageFanConversation = { ...PageFan, conversationRef: z.optional(NativeIdSchema) };

/** 1.20.0: names one `fans.labels` answer carries. */
export const FAN_LABELS_MAX = 64;

/** Attempts one `send.list` answer carries. */
export const SEND_LIST_MAX = 100;

/** One attempt of `send.list`: which operation, group and part it is, its state and when that state was reached. */
export const SendListItemSchema = z
  .strictObject({
    opId: UuidSchema,
    purpose: SendPurposeSchema,
    group: SendGroupSchema,
    partIndex: z.int().check(z.gte(0), z.lte(PART_LIMITS.maxParts - 1)),
    view: SendAttemptViewSchema,
    /** The background's clock at the attempt's last change: «Отправлено 09:21», «с 09:21». */
    updatedAt: EpochMsSchema,
    /**
     * The hub resolved the attempt in an audited support action (H-7
     * `resolve`): it no longer holds the fan, whatever `view.state` says.
     * `sent` — the part counts as delivered; `not-sent` — the part is free.
     */
    resolved: z.optional(z.enum(['sent', 'not-sent'])),
  })
  .check(z.refine((item) => item.partIndex < item.group.partCount, { message: 'partIndex must be below the group part count' }));
export type SendListItem = z.infer<typeof SendListItemSchema>;

/** The board's periods: the hub's (H-8) the board offers. */
export const SPENDERS_PERIODS = ['lifetime', '30d', 'mtd', '7d', 'today'] as const satisfies readonly HubSpenderPeriod[];
export const SpendersPeriodSchema = z.enum(SPENDERS_PERIODS);

export const ACTION_TOKEN_KINDS = ['generate', 'insert', 'navigate', 'send'] as const;
/** Kinds HostPort spends through `token.redeem`; the other two are spent by the request they authorize. */
export const HOST_ACTION_TOKEN_KINDS = ['insert', 'navigate'] as const satisfies readonly (typeof ACTION_TOKEN_KINDS)[number][];

const CursorSchema = z.nullable(boundedText(2048));

/** A background toast; the tab renders the text from the code and its i18n catalog (§9.5). */
export const BackgroundToastSchema = z.strictObject({
  toastId: UuidSchema,
  kind: z.enum(['info', 'success', 'warning', 'error']),
  /** Toasts with the same code and scope replace each other. */
  scope: OpenTokenSchema,
  code: z.optional(CgCodeSchema),
  error: z.optional(CgErrorWireSchema),
  /** «AI готово · {фан}» jumps to this chat on click. */
  opId: z.optional(UuidSchema),
  feature: z.optional(FeatureIdSchema),
  chat: z.optional(ChatRefSchema),
  /**
   * 1.15.0 (R20 F6a): the conversation of that chat when it is not the fan — on Fansly the group id of the
   * operation's target; «Открыть чат» opens that conversation. Only with `chat`. Absent — the conversation is the
   * fan (ChatSpace, and every toast before 1.15.0).
   */
  conversationRef: z.optional(NativeIdSchema),
  fanLabel: z.nullable(displayText(256)),
  /**
   * 1.54.0: a fan of «Новые» nobody greeted ten minutes after subscribing (the greeting reminder; 1.67.0 — three, ten
   * and fifteen minutes). The toast stays until it is closed, and its «Hi» opens the fan's chat and puts the dock's
   * greeting into its field, by that click; the fan's next reminder takes its place (the same scope).
   */
  greet: z.optional(
    z.strictObject({
      pageId: HubIntIdSchema,
      fanRef: NativeIdSchema,
      /** 1.61.0: the fan's @handle (without «@»), their picture (Fansly's own address), the follow's or subscription's moment. */
      username: z.optional(z.nullable(displayText(64))),
      avatarUrl: z.optional(z.nullable(HiFanAvatarUrlSchema)),
      since: z.optional(IsoTimestampSchema),
      /**
       * 1.62.0: the model's name, when the toast stands in a tab of another model (the one the person looks at): its
       * «Hi» goes to a tab of that model (`greet.start`).
       */
      page: z.optional(displayText(256)),
      /** 1.67.0 (the owner, 2026-10-29: «третий красный через 15»): the last of the fan's three reminders — red. */
      urgent: z.optional(z.literal(true)),
    }),
  ),
});
export type BackgroundToast = z.infer<typeof BackgroundToastSchema>;

/** The page's AI quota as the last generation's `meta` reported it (§8.4): the dock and the popup show it (UI-031, §9.9). */
export const AiQuotaSnapshotSchema = z.strictObject({
  pageId: HubIntIdSchema,
  remainingRequestsToday: z.nullable(CountSchema),
  /** Debug surfaces only (Б4). */
  remainingMicroUsdToday: z.nullable(MicroUsdSchema),
  /** The next 00:00 UTC after `observedAt`: the quota's day boundary (CG-QUOTA-DAILY). */
  resetsAt: IsoTimestampSchema,
  observedAt: IsoTimestampSchema,
});
export type AiQuotaSnapshot = z.infer<typeof AiQuotaSnapshotSchema>;

const ContractHashSchema = z.string().check(z.regex(CONTRACT_HASH_PATTERN));

/**
 * Where a site's background module (`bg/<site>.js`, docs/project-unite/architecture.md §3.3) stands: `idle` — not
 * needed yet, `starting`, `started`, `failed` — its services did not start (1.15.0, R20 F1).
 */
export const HOST_MODULE_STATES = ['idle', 'starting', 'started', 'failed'] as const;

/** `diagnostics.get`: versions, flags and states without secrets or texts (LG-020…LG-025, SN-015). */
export const DiagnosticsSnapshotSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
  siteAccess: z.optional(z.array(SiteAccessStateSchema).check(z.maxLength(8))),
  requestModes: z.optional(z.array(z.strictObject({ host: HostKindSchema, mode: z.enum(['background', 'relay']) })).check(z.maxLength(8))),
  freshness: z.optional(FreshnessDaySchema),
  extension: z.strictObject({
    version: boundedText(32),
    contractsVersion: boundedText(32),
    testBuild: z.boolean(),
    /**
     * When this version replaced an older one (`runtime.onInstalled`, reason
     * `update`) — the «Обновилось сегодня в 09:02 с 0.4.2» line of «Статус»;
     * absent — a fresh install or not known. `staleTabs` — ChatSpace tabs still
     * on the scripts of the old version (UP-009), null — not counted. 1.2.0.
     */
    updated: z.optional(z.strictObject({ at: IsoTimestampSchema, from: boundedText(32), staleTabs: z.nullable(CountSchema) })),
  }),
  browser: z.strictObject({ name: z.literal('firefox'), major: z.nullable(z.int().check(z.gte(1))) }),
  os: z.enum(['windows', 'macos', 'linux', 'other']),
  session: z.strictObject({ signedIn: z.boolean(), hubOrigin: z.nullable(HubOriginSchema), role: z.nullable(RoleSchema) }),
  hub: z.strictObject({
    reachable: z.nullable(z.boolean()),
    lastCheckedAt: z.nullable(IsoTimestampSchema),
    lastError: z.nullable(CgErrorWireSchema),
    flags: z.record(OpenTokenSchema, z.boolean()),
    /** The vendored SDK's contract hash against `health` (H-1): the «Совместимость» line of «Аккаунт». */
    sdk: z.strictObject({
      vendoredHash: ContractHashSchema,
      hubHash: z.nullable(ContractHashSchema),
      /** vendoredHash ∈ health.compatibleClientSdks; null — health not read or the hub lists none. */
      compatible: z.nullable(z.boolean()),
    }),
  }),
  tabs: z
    .array(
      z.strictObject({
        tabSessionId: UuidSchema,
        /** 1.15.0 (R20 F7): the tab's site, as it registered (`tab.register`). Absent — a background before 1.15.0: ChatSpace. */
        site: z.optional(HostKindSchema),
        host: z.nullable(HostContractReportSchema),
        chatKey: z.nullable(ChatKeySchema),
        conversationRef: z.optional(NativeIdSchema),
        page: z.optional(PageDiagnosticsSchema),
        networkSession: z.optional(NetworkSessionSnapshotSchema),
      }),
    )
    .check(z.maxLength(32)),
  counters: z.record(HealthCodeSchema, CountSchema),
  logs: z.strictObject({ records: CountSchema, bytes: CountSchema, dropped: CountSchema }),
  telemetry: z.strictObject({ consent: z.boolean(), queued: CountSchema, dropped: CountSchema }),
  sound: z.strictObject({
    listeningTabs: CountSchema,
    lastIncomingAt: z.nullable(IsoTimestampSchema),
    outcomes: z.record(OpenTokenSchema, CountSchema),
  }),
  ops: z.strictObject({ active: CountSchema }),
  sends: z.strictObject({ open: CountSchema, uncertain: CountSchema }),
  /** 1.11.0 (decision X25): the X8 fuse of this browser — the X8 row of «Статус» and the diagnostics file. */
  sendFuse: z.optional(SendFuseStateSchema),
  /**
   * 1.15.0 (R20 F1): the sites' background modules and where each stands. `failed` — the site's services in the
   * background did not start: «Статус» warns, the site's own requests answer CG-RUNTIME-UNREACHABLE, nothing is
   * sent. Absent — a background before 1.15.0.
   */
  hostModules: z.optional(z.array(z.strictObject({ host: HostKindSchema, state: z.enum(HOST_MODULE_STATES) })).check(z.maxLength(8))),
  /**
   * Sizes of our own caches and logs, an estimate (ST-110, options
   * «Диагностика»); absent — the background does not measure them. 1.2.0.
   */
  footprint: z.optional(z.strictObject({ cachesKB: CountSchema, logsKB: CountSchema })),
});
export type DiagnosticsSnapshot = z.infer<typeof DiagnosticsSnapshotSchema>;

/**
 * A click on an extension page that acts inside ChatSpace (§9.9; 1.2.0): the
 * popup's «Spenders», «Новые» and «Клавиши», and «к вкладке» of an account
 * in the options (Б13, ST-076). The background brings a ChatSpace tab to the
 * front and has it run the command as that human action — the tab opens its
 * overlay, or its router opens the account; nothing is loaded from the host.
 */
export const PAGE_COMMAND_SURFACES = ['spenders', 'newcomers', 'cheatsheet'] as const;
export const PageCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('surface'), surface: z.enum(PAGE_COMMAND_SURFACES) }),
  z.strictObject({ kind: z.literal('account'), host: HostKindSchema, hostAccountId: NativeIdSchema }),
]);
export type PageCommand = z.infer<typeof PageCommandSchema>;

/** `debug.prompt`: the prompt snapshot for debug-prompt.html only, by an opaque token (§9.3, DB-004…DB-008). */
export const PromptSnapshotViewSchema = z.strictObject({
  generation: z.optional(GenerationDebugSchema),
  state: z.enum(['ok', 'expired', 'not-found', 'debug-off', 'echo-off']),
  fromCache: z.boolean(),
  capturedAt: z.nullable(IsoTimestampSchema),
  feature: z.nullable(FeatureIdSchema),
  manifest: z.nullable(displayText(DEBUG_LIMITS.promptManifestMaxChars)),
  blocks: z
    .array(z.strictObject({ name: boundedText(64), text: displayText(DEBUG_LIMITS.promptBlockMaxChars), truncated: z.boolean() }))
    .check(z.maxLength(32)),
});
export type PromptSnapshotView = z.infer<typeof PromptSnapshotViewSchema>;

/**
 * X8 `send.begin`: what the background needs to journal the attempt and ask
 * the hub for `dispatch`. The background holds with CG-SEND-FRESHNESS when
 * `checkpoint` is not the one the operation started with (StartOp, kept
 * with the opId) or when that operation had none: a checkpoint taken at
 * send time would hide what the fan wrote after Generate (§6.7.5).
 */
export const SendBeginSchema = z
  .strictObject({
    attemptId: UuidSchema,
    opId: UuidSchema,
    target: TargetSchema,
    purpose: SendPurposeSchema,
    group: SendGroupSchema,
    part: PartRefSchema,
    previewRevision: CountSchema,
    /** Revision of this part's text, the hub's custody key (H-7 `textRevision`); 0 while parts are not editable (v1). */
    textRevision: CountSchema,
    checkpoint: FreshnessCheckpointSchema,
    /** «Отправить всё равно» on a freshness warning: the background does not hold on condition 14 (audit 2026-10-20, rows 3–4). */
    acceptFreshness: z.optional(z.literal(true)),
    /**
     * The person's own text from the preview's draft field (audit 2026-10-20, row 1): no generation behind it. `opId`
     * and `group` are the tab's own local names for it (one part); the hub's custody keys it by `textFingerprint`, the
     * sha256 of the exact text (lower-case hex), as a manual group (`manual-greeting-v1`).
     */
    manual: z.optional(z.strictObject({ textFingerprint: z.string().check(z.regex(/^[0-9a-f]{64}$/)) })),
    /** The MAIN document the command will go to; equals the checkpoint's. */
    documentEpoch: EpochTokenSchema,
    cause: HumanCauseSchema,
    /** «Новые»: the lease this greeting is sent under. */
    leaseToken: z.optional(UuidSchema),
    /**
     * 1.11.0 (decision X25): the ChatSpace build of the tab (its host report's `build`): the background holds the
     * send with CG-SEND-FUSE while a tripped fuse names this build. Absent — a tab before 1.11.0: a fuse holds it.
     */
    hostBuild: z.optional(z.nullable(displayText(80))),
    /** 1.30.0 (X53): the marks of the media the part takes along (who sent it, X48); absent — its text alone. */
    marks: z.optional(SendMarksSchema),
  })
  .check(
    z.refine((b) => partInGroup(b.part, b.group), { message: 'the part belongs to the group: same variant (absent = 0), index below partCount' }),
    z.refine((b) => checkpointMatches(b.checkpoint, b.target.chat.hostAccountId, b.target.chat.platformFanId), { message: 'the checkpoint belongs to the target chat' }),
    z.refine((b) => b.checkpoint.documentEpoch === b.documentEpoch, { message: 'the checkpoint was taken in this document' }),
    z.refine((b) => b.manual === undefined || (b.group.partCount === 1 && b.group.variant === 0 && b.part.index === 0), { message: 'own text is one part' }),
  );
export type SendBegin = z.infer<typeof SendBeginSchema>;

// ── Requests ───────────────────────────────────────────────────────────────

const TAB = ['tab'] as const satisfies readonly TabSender[];
const PAGE = ['page'] as const satisfies readonly TabSender[];
const ANY = ['tab', 'page'] as const satisfies readonly TabSender[];
/**
 * 1.15.0: requests only a ChatSpace tab sends (a page is not affected): X8 — the send from a preview through
 * ChatSpace's own queue — and the hub's «Новые» with its lease. Fansly sends its greeting over HTTP from the
 * background (its own machine and journal) and finds «Новые» by its own pass; a fansly.com tab never sends these.
 */
const CHATSPACE = ['chatspace'] as const satisfies readonly HostKind[];

/** 2026-10-29: one write as the background tells it to a tab: the login, whether it is the person's own, when. */
const NoteAuthorSchema = z.strictObject({ name: z.string().check(z.maxLength(120)), me: z.boolean(), atMs: z.int().check(z.gt(0)) });
/** `notes.authors`: per note the hub knows a write of, who created it and who changed it last; or why none is known. */
export const NotesAuthorsSchema = z.union([
  z.strictObject({ ok: z.literal(true), notes: z.array(z.strictObject({ noteId: NativeIdSchema, created: z.nullable(NoteAuthorSchema), edited: z.nullable(NoteAuthorSchema) })).check(z.maxLength(200)) }),
  z.strictObject({ ok: z.literal(false), code: z.string().check(z.maxLength(64)) }),
]);
export type NotesAuthors = z.infer<typeof NotesAuthorsSchema>;

export const TAB_REQUESTS = {
  // ── tab lifecycle ──
  /** First request of a tab document: the background mints the tab session (§5.1). */
  'tab.register': { req: TabRegisterRequestSchema, res: TabRegisterResponseSchema, from: TAB },
  /** Which chat the tab shows and whether it is visible and focused (sound, «AI готово» toasts). */
  'tab.presence': {
    req: z.strictObject({
      conversationRef: z.optional(NativeIdSchema),
      chat: z.nullable(ChatRefSchema),
      routeEpoch: CountSchema,
      visible: z.boolean(),
      focused: z.boolean(),
      /** The host accounts this tab's ChatSpace has loaded, when they changed: the `presence` store (§9.9). */
      accounts: z.optional(z.array(HostAccountSchema).check(z.maxLength(200))),
      /**
       * The account the tab's route is on (`/accounts/<id>/…`), chat open or not; null — the route names none.
       * One of the loaded `accounts`, which may be several: «Статус» names this one (1.8.0). Absent — a tab
       * from before 1.8.0: its route is not known.
       */
      routeAccount: z.optional(z.nullable(HostAccountSchema)),
      /**
       * 1.20.0 (decision X47): the open chat's fan as the tab already names it (the site's header or memory) — for
       * the popup and «Идут сейчас», display only, kept in the background's memory alone. null — the tab knows no
       * name; absent — a tab before 1.20.0. Never read from anywhere for this.
       */
      fanLabel: z.optional(z.nullable(displayText(256))),
      /** 2026-10-22: the open chat's fan's @handle as the tab already knows it (without «@»), for the popup; display only. */
      fanUsername: z.optional(z.nullable(displayText(64))),
      /**
       * Chat Memory week 1: when the person last pressed a key, clicked or scrolled in this tab (this browser's clock);
       * null — not since the tab opened. Never what: the beat of the hub's shift reads only the time.
       */
      lastInputAt: z.optional(z.nullable(EpochMsSchema)),
    }),
    res: Ack,
    from: TAB,
  },

  // ── sign-in and bootstrap ──
  'session.get': { req: Empty, res: z.strictObject({ session: z.nullable(SessionIdentitySchema) }), from: ANY },
  /** The password goes page → background once and is never logged or stored. */
  'session.signIn': {
    req: z.strictObject({ login: boundedText(SIGN_IN_LIMITS.loginMaxChars), password: boundedText(SIGN_IN_LIMITS.passwordMaxChars) }),
    res: z.strictObject({ session: SessionIdentitySchema }),
    from: PAGE,
    pages: ['options', 'popup'],
  },
  /** `serverRevoked: null` — the hub did not answer; the local sign-in is cleared anyway. */
  'session.signOut': { req: Empty, res: z.strictObject({ serverRevoked: z.nullable(z.boolean()) }), from: PAGE },
  'bootstrap.get': { req: z.strictObject({ force: z.optional(z.boolean()) }), res: BootstrapSchema, from: ANY },
  /** Binds a host account to exactly one page by platformAccountId; CG-BINDING-* on failure. */
  'binding.resolve': { req: z.strictObject({ account: HostAccountSchema }), res: z.strictObject({ binding: HubBindingSchema }), from: ANY },
  'catalog.get': { req: z.strictObject({ force: z.optional(z.boolean()) }), res: PersonaCatalogSchema, from: ANY },
  /** The quota of a page as last seen; null — no generation on it since the background started (unknown). */
  'quota.get': { req: z.strictObject({ pageId: HubIntIdSchema }), res: z.strictObject({ quota: z.nullable(AiQuotaSnapshotSchema) }), from: ANY },
  /**
   * Options «Аккаунты»: the host accounts this browser has seen, and how many tabs show each now —
   * `openTabs` have it loaded, `routeTabs` (1.8.0) are on it, its route (absent — not counted).
   */
  'accounts.seen': {
    req: Empty,
    res: z.strictObject({
      accounts: z
        .array(z.strictObject({ account: HostAccountSchema, lastSeenAt: IsoTimestampSchema, openTabs: CountSchema, routeTabs: z.optional(CountSchema) }))
        .check(z.maxLength(STORAGE_LIMITS.seenAccountsMax)),
    }),
    from: PAGE,
    pages: ['options', 'popup'],
  },
  'persona.set': {
    req: z.strictObject({ pageId: HubIntIdSchema, key: PersonaKeySchema, definitionId: PersonaDefinitionIdSchema }),
    res: z.strictObject({ revision: CountSchema }),
    from: ANY,
  },

  // ── operations ──
  'op.start': { req: StartOpSchema, res: AdmissionSchema, from: TAB },
  'op.cancel': { req: z.strictObject({ opId: UuidSchema }), res: z.strictObject({ state: OpStateSchema }), from: ANY },
  /** `tab`: this tab's results (≤ resultsPerTab); `all`: newest first across tabs, at most opListMax. */
  'op.list': {
    req: z.strictObject({ scope: z.enum(['tab', 'all']), chatKey: z.optional(ChatKeySchema) }),
    res: z.strictObject({ ops: z.array(OpViewSchema).check(z.maxLength(STORAGE_LIMITS.opListMax)), truncated: z.boolean() }),
    from: ANY,
  },
  /** The result was really visible (telemetry `shown`). */
  'op.reportShown': { req: z.strictObject({ opId: UuidSchema, part: z.optional(PartRefSchema) }), res: Ack, from: TAB },
  /** Written to the clipboard successfully (telemetry `copied`, Б14). */
  'op.reportCopy': { req: z.strictObject({ opId: UuidSchema, part: z.optional(PartRefSchema) }), res: Ack, from: TAB },
  /** A guarded insert finished; `inserted` only for `applied`. */
  'op.reportInsert': { req: z.strictObject({ opId: UuidSchema, part: PartRefSchema, receipt: InsertReceiptSchema }), res: Ack, from: TAB },
  /**
   * A human send from the composer proven by receipt + echo with the same id
   * (§6.6); `edited` is HumanSendFact.draft.editedSinceInsert, the op and part
   * come from the insert intent the draft descends from.
   */
  'op.reportSent': {
    req: z.strictObject({
      opId: UuidSchema,
      part: PartRefSchema,
      pendingId: PendingIdSchema,
      platformMessageId: NativeIdSchema,
      edited: z.boolean(),
    }),
    res: Ack,
    from: TAB,
  },

  // ── X8 preview send ──
  /** Journal first, then hub `dispatch`; the answer is the one-time ticket or the reason to hold. */
  'send.begin': {
    req: SendBeginSchema,
    res: z.discriminatedUnion('ok', [
      z.strictObject({ ok: z.literal(true), ticket: DispatchTicketSchema }),
      z.strictObject({ ok: z.literal(false), view: SendAttemptViewSchema }),
    ]),
    from: TAB,
    hosts: CHATSPACE,
  },
  'send.status': { req: z.strictObject({ attemptId: UuidSchema }), res: z.strictObject({ view: z.nullable(SendAttemptViewSchema) }), from: ANY, hosts: CHATSPACE },
  /**
   * 1.2.0. The attempts the background knows for one fan of the page: open
   * ones, uncertain ones until resolved, ended and resolved ones while it
   * remembers them — those that hold the fan first, then newest, at most
   * SEND_LIST_MAX. A tab that lost its own tracking (a reload) holds the
   * fan, the group and «Открыть и вставить» by them, and learns here that
   * the hub resolved an attempt (§6.7.8, §6.7.9). Ids and states, no text.
   */
  'send.list': {
    req: z.strictObject(PageFan),
    res: z.strictObject({
      attempts: z.array(SendListItemSchema).check(z.maxLength(SEND_LIST_MAX)),
      /** More attempts than SEND_LIST_MAX: the oldest ended ones are left out. */
      truncated: z.boolean(),
    }),
    from: TAB,
    hosts: CHATSPACE,
  },
  /**
   * A state MAIN observed; the background journals it and reports to the hub
   * custody by SEND_CUSTODY_REPORTS only on proof (a refusal's status is
   * `view.httpStatus`).
   */
  'send.report': {
    req: z.strictObject({ view: SendAttemptViewSchema, pendingId: z.optional(PendingIdSchema) }),
    res: Ack,
    from: TAB,
    hosts: CHATSPACE,
  },
  /**
   * 1.11.0 (decision X25): MAIN saw what trips the X8 fuse after a send of this tab (the host port's `sendFuse`
   * event); `build` — the tab's ChatSpace build. The background keeps the fuse (the first trip stands until the
   * build changes or the person resets it), logs and counts it, and tells every tab and page (`send.fuse`).
   */
  'send.fuse': {
    req: z.strictObject({ fact: SendFuseFactSchema, build: z.nullable(displayText(80)) }),
    res: SendFuseStateSchema,
    from: TAB,
    hosts: CHATSPACE,
  },
  /** 1.11.0: the fuse as the background keeps it — a tab reads it at start and after a lost port. */
  'send.fuseState': { req: Empty, res: SendFuseStateSchema, from: ANY, hosts: CHATSPACE },
  /** Chat Memory week 1: «в разговоре» as the background last heard it from the hub, for a tab that starts or came back. */
  'talk.read': { req: Empty, res: TalkingMarksSchema, from: TAB },
  /** 1.11.0 «Сбросить предохранитель» of «Статус»: the fuse is cleared; X8 is on again until it trips again. */
  'send.fuseReset': { req: Empty, res: SendFuseStateSchema, from: PAGE, pages: ['options'] },

  // ── recaps ──
  'recap.status': { req: z.strictObject({ ...PageFanConversation, personaDefinitionId: PersonaDefinitionIdSchema }), res: RecapStatusSchema, from: ANY },
  'recap.read': { req: z.strictObject({ ...PageFanConversation, personaDefinitionId: PersonaDefinitionIdSchema }), res: SharedRecapsSchema, from: ANY },
  /**
   * 1.2.0 — «Сохранить ещё раз» (CG-RECAP-SAVE, UiAction RetryRecapSave) and
   * the late save of a full recap opened from the hub (AI-068): one
   * idempotent `profile/from-generation` link write (H-5), never a new
   * generation. `not-ready` — the tab repeats by the §7 schedule while it is
   * open; `rejected` — for good (CG-RECAP-SAVE). `opId` is the hub's
   * `clientRequestId` when the tab knows the operation.
   */
  'recap.save': {
    req: z.strictObject({ ...PageFanConversation, generationRef: GenerationRefSchema, opId: z.optional(UuidSchema) }),
    res: z.strictObject({ state: z.enum(['saved', 'not-ready', 'rejected']), savedAt: z.nullable(IsoTimestampSchema) }),
    from: TAB,
  },

  // ── hub data ──
  /** The whole board up to 1000 rows; the background pages through the hub (§8.5). */
  'spenders.board': {
    req: z.strictObject({ pageId: HubIntIdSchema, period: SpendersPeriodSchema, force: z.optional(z.boolean()) }),
    res: SpendersBoardSchema,
    from: TAB,
  },
  'spenders.stats': {
    /** The hub's v1 serves only the 30-day window (H-8b); a longer one is a new contract. */
    req: z.strictObject({ pageId: HubIntIdSchema, windowDays: StatsQuerySchema.shape.windowDays, timeZone: TimeZoneSchema }),
    res: SpendersStatsSchema,
    from: TAB,
  },
  'spenders.queue': {
    /** `everyone` — Chat Memory week 3, «Ждут» of «Очередь»: every fan who wrote in 30 days, not only payers. */
    req: z.strictObject({ pageId: HubIntIdSchema, cursor: CursorSchema, limit: z.int().check(z.gte(1), z.lte(100)), everyone: z.optional(z.boolean()) }),
    res: QueuePageSchema,
    from: TAB,
  },
  /** Chat Memory week 3, «Вернуть» of «Очередь»: a few fans of the page to win back and the owner's approaches. */
  'queue.winback': { req: z.strictObject({ pageId: HubIntIdSchema }), res: WinBackListSchema, from: TAB },
  /** A chatter's approach pick for a fan of the list: one call, never repeated; answered with the list after it. Nothing is sent to the fan. */
  'queue.winback.pick': { req: z.strictObject({ pageId: HubIntIdSchema, fanRef: NativeIdSchema, approachId: HubIntIdSchema }), res: WinBackAttemptResultSchema, from: TAB },
  /**
   * «Онлайн» (hub `clientOnline`, `online-v1`): the page's fans seen online within `minutes`, each with why to write now
   * and with what, the team's guide texts with them. Read while the window or the bar's count needs it; nothing is sent.
   */
  'online.list': { req: z.strictObject({ pageId: HubIntIdSchema, minutes: z.int().check(z.gte(5), z.lte(180)) }), res: OnlineListSchema, from: TAB },
  /**
   * What a chatter did in «Онлайн» (hub `clientOnlineAttempt`): a message went from the window (what wrote it, the
   * template), «Не предлагать» or its undo. One call, never repeated; journaled and shared by the page's team.
   */
  'online.attempt': {
    req: z.strictObject({
      pageId: HubIntIdSchema,
      fanRef: NativeIdSchema,
      action: z.enum(ONLINE_ATTEMPT_ACTIONS),
      act: z.optional(z.enum(ONLINE_SENT_ACTS)),
      templateId: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
      reason: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
    }),
    res: OnlineAttemptResultSchema,
    from: TAB,
  },
  /** Chat Memory week 3, «Передача» of «Очередь»: whom the team wrote to, who waits, the open promises. */
  'queue.handoff': { req: z.strictObject({ pageId: HubIntIdSchema }), res: HandoffSchema, from: TAB },
  /**
   * «Очереди» (hub `clientFanQueues`, `fan-queues-v1`): the person's fan queues of the page — progress today, the goal,
   * how they write — and the fans who answered a message from a queue. Read while the window or the bar's count needs it.
   */
  'queues.list': { req: z.strictObject({ pageId: HubIntIdSchema }), res: FanQueuesSchema, from: TAB },
  /** A portion of a queue (hub `clientFanQueueTake`): up to 10 fans, each re-checked by the hub. Nothing is sent. */
  'queues.take': {
    req: z.strictObject({ pageId: HubIntIdSchema, queueId: HubIntIdSchema, count: z.int().check(z.gte(1), z.lte(FAN_QUEUE_PORTION_MAX)), more: z.boolean() }),
    res: FanQueueTakeSchema,
    from: TAB,
  },
  /**
   * A fan of the portion (hub `clientFanQueueItemDone`): a message went (what wrote it, the template, an unknown
   * outcome) or the person skipped them (why). One call, never repeated; journaled by the hub.
   */
  'queues.done': {
    req: z.strictObject({
      pageId: HubIntIdSchema,
      itemId: HubIntIdSchema,
      outcome: z.enum(['sent', 'skipped']),
      act: z.optional(z.enum(FAN_QUEUE_SENT_ACTS)),
      templateId: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
      skipReason: z.optional(z.enum(FAN_QUEUE_SKIP_REASONS)),
      uncertain: z.optional(z.boolean()),
    }),
    res: FanQueueItemDoneSchema,
    from: TAB,
  },
  /** The window closed: the person's untouched portion goes back to the queue (hub `clientFanQueueRelease`). */
  'queues.release': { req: z.strictObject({ pageId: HubIntIdSchema, queueId: HubIntIdSchema }), res: FanQueueReleaseSchema, from: TAB },
  'feed.read': {
    req: z.strictObject({
      ...PageFanConversation,
      cursor: CursorSchema,
      limit: z.int().check(z.gte(1), z.lte(FEED_LIMITS.maxLimit)),
      /** The Ping chip's window (settings `generation.windows.ping`); the hub's default 100 when absent. */
      summaryWindow: z.optional(z.int().check(z.gte(FEED_LIMITS.summaryWindowMin), z.lte(FEED_LIMITS.summaryWindowMax))),
      /** 2026-10-27: Coach's depths for the first page to date (`FeedPage.depth`); only to a hub with `coach-depth-v1`. */
      depthMarks: z.optional(z.array(z.int().check(z.gte(1), z.lte(FEED_LIMITS.depthMarkMax))).check(z.minLength(1), z.maxLength(FEED_LIMITS.depthMarksMax))),
    }),
    res: FeedPageSchema,
    from: TAB,
  },
  /** The fan panel's money (D-29): `period` '30d' gives the window and the lifetime in one read. */
  'fan.card': { req: z.strictObject({ ...PageFan, period: SpendersPeriodSchema }), res: SpenderDetailSchema, from: TAB },
  /** The fan panel's dossier (D-29: `pageConversationProfile` / `pageFanProfile`); null — the hub knows no profile. */
  'fan.dossier': { req: z.strictObject(PageFan), res: z.strictObject({ dossier: z.nullable(DossierSchema) }), from: TAB },
  /** Chat Memory week 2: the fan's card across pages («Память» of the fan panel). */
  'fan.memory': { req: z.strictObject(PageFan), res: FanCardSchema, from: TAB },
  /** A chatter's «Да, это он» / «Нет» on a suggested account; answered with the card as it stands. */
  'fan.memory.link': {
    req: z.strictObject({ ...PageFan, otherPlatform: OpenTokenSchema, otherFanRef: NativeIdSchema, decision: z.enum(['same', 'different']) }),
    res: FanLinkDecideResultSchema,
    from: TAB,
  },
  /** A chatter deletes or corrects a fact of a page they work; answered with the card as it stands. */
  'fan.memory.fact': {
    req: z.union([
      z.strictObject({ ...PageFan, factId: HubIntIdSchema, action: z.literal('delete') }),
      z.strictObject({ ...PageFan, factId: HubIntIdSchema, action: z.literal('correct'), text: z.string().check(z.trim(), z.minLength(1), z.maxLength(FAN_FACT_MAX_CHARS)) }),
    ]),
    res: FanFactChangeResultSchema,
    from: TAB,
  },
  /**
   * Chat Memory week 4: a custom written into the fan's card (`create`, paid by a suggested tip or not yet), or marked
   * paid / delivered by the card's suggestion, or cancelled. One call, never repeated; answered with the card as it stands.
   */
  'fan.memory.custom': {
    req: z.union([
      z.strictObject({ ...PageFan, action: z.literal('create'), description: z.string().check(z.trim(), z.minLength(1), z.maxLength(FAN_CUSTOM_MAX_CHARS)), priceMills: z.optional(z.int().check(z.gte(0))), paymentRef: z.optional(NativeIdSchema) }),
      z.strictObject({ ...PageFan, customId: HubIntIdSchema, action: z.literal('paid'), paymentRef: NativeIdSchema }),
      z.strictObject({ ...PageFan, customId: HubIntIdSchema, action: z.literal('delivered'), messageRef: NativeIdSchema }),
      z.strictObject({ ...PageFan, customId: HubIntIdSchema, action: z.literal('cancel') }),
    ]),
    res: FanFactChangeResultSchema,
    from: TAB,
  },
  /** Tabs, and the popup for its newcomer count (§9.9). */
  'newcomers.list': {
    req: z.strictObject({ pageId: HubIntIdSchema, windowHours: z.int().check(z.gte(1), z.lte(720)), cursor: CursorSchema }),
    res: AudienceNewPageSchema,
    from: ANY,
    pages: ['popup'],
    hosts: CHATSPACE,
  },
  'newcomers.claim': {
    req: z.strictObject({ ...PageFan, action: z.enum(['claim', 'renew', 'release']) }),
    res: ClaimStateSchema,
    from: TAB,
    hosts: CHATSPACE,
  },

  // ── voice notes (1.47.0; voice.ts) ──
  /** The chat's voice session as the background keeps it; null — none. The page must be one of the tab's bindings. */
  'voice.read': {
    req: z.strictObject({ pageId: HubIntIdSchema, conversationRef: NativeIdSchema }),
    res: z.strictObject({ session: z.nullable(VoiceSessionSchema) }),
    from: TAB,
  },
  /**
   * 1.49.0: what the page may still voice today, as the hub last said (kept by the background for
   * `VOICE_LIMITS.allowanceTtlMs`, read again once a take moves); null — not known (a failed read, an older hub, a page
   * not the tab's). A free read: no token.
   */
  'voice.allowance': {
    req: z.strictObject({ pageId: HubIntIdSchema }),
    res: z.strictObject({ allowance: z.nullable(VoiceAllowanceSchema) }),
    from: TAB,
  },
  /**
   * The script, from the draft (the shared scheduler's `voice-script`, its admission and token): into the session
   * `sessionId` names — its takes stay — or, null, a new session of the chat, replacing whatever it had (the person
   * was asked first when a take of it was never put into the field).
   */
  'voice.script': {
    req: z.strictObject({ start: VoiceScriptStartSchema, sessionId: z.nullable(UuidSchema) }),
    res: VoiceWriteResultSchema,
    from: TAB,
  },
  /** The person's text of the script (the last one written wins: one person edits one chat's script). */
  'voice.edit': {
    req: z.strictObject({ sessionId: UuidSchema, text: displayText(VOICE_LIMITS.scriptMaxChars) }),
    res: VoiceWriteResultSchema,
    from: TAB,
  },
  /**
   * A take, the paid step (`voiceNoteCreate`): written into the session before the hub is asked and never repeated by
   * itself; `takeId` is its `clientRequestId`. `cause` — the person's click (a `generate` token, redeemed here).
   */
  'voice.take': {
    req: z.strictObject({ sessionId: UuidSchema, takeId: UuidSchema, script: displayText(VOICE_LIMITS.scriptMaxChars), cause: HumanCauseSchema }),
    res: VoiceWriteResultSchema,
    from: TAB,
  },
  /**
   * «Проверить» of a take: a free status read; for an `uncertain` one the same create again, by the same id (the hub
   * answers the note it has, or creates it once) — the person's click only.
   */
  'voice.check': {
    req: z.strictObject({ sessionId: UuidSchema, takeId: UuidSchema, cause: HumanCauseSchema }),
    res: VoiceWriteResultSchema,
    from: TAB,
  },
  /** A ready take's MP3, checked against the hub's sha256 and length before it is handed over. */
  'voice.audio': {
    req: z.strictObject({ sessionId: UuidSchema, takeId: UuidSchema }),
    res: z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), audio: VoiceAudioSchema }), z.strictObject({ ok: z.literal(false), error: CgErrorWireSchema })]),
    from: TAB,
  },
  /** What the composer showed after the person's «Прикрепить»: the take is in it, or its outcome was not seen. */
  'voice.attached': {
    req: z.strictObject({ sessionId: UuidSchema, takeId: UuidSchema, state: z.enum(['attached', 'unknown']) }),
    res: VoiceWriteResultSchema,
    from: TAB,
  },
  /** «Новый войс»: the session goes (the hub keeps its audio). */
  'voice.discard': {
    req: z.strictObject({ sessionId: UuidSchema }),
    res: z.strictObject({ discarded: z.boolean() }),
    from: TAB,
  },

  // ── «Заметки» of a site whose notes the tab itself reads and writes (2026-10-28: ChatSpace, OnlyMonster's fan notes;
  // notes.ts, notes-fill.ts). Fansly's tab keeps its own `fansly.notes.*` and `fansly.ops.*`. ──
  /** The panel's view as `settings.ext` holds it (FS-NOTE-2: one for every tab of every site). */
  'notes.view': { req: Empty, res: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), from: TAB },
  /** The person chose a view in the panel: stored for every tab, each tab hears `notes.viewChanged`. */
  'notes.setView': { req: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), res: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), from: TAB },
  /**
   * «✨ Заполнить из чата» of the open chat (FS-NOTE-6): the shared scheduler's `notes-fill`, admitted by the page's
   * `notesFill`, with a click's token; its stage comes as `op.update`, its end as `notes.fill.done`.
   */
  'notes.fill.start': { req: NotesFillStartSchema, res: AdmissionSchema, from: TAB },
  /** The fill as the scheduler keeps it now; null — no such fill of this site. */
  'notes.fill.read': { req: z.strictObject({ opId: UuidSchema }), res: z.strictObject({ view: z.nullable(NotesFillOpViewSchema) }), from: TAB },
  /** «Остановить»: the fill is cancelled and its answer never lands; null — no such fill. */
  'notes.fill.cancel': { req: z.strictObject({ opId: UuidSchema }), res: z.strictObject({ state: z.nullable(OpStateSchema) }), from: TAB },
  /**
   * 2026-10-29 (the owner: «понимать кто и когда создавал анкетку»), every site's tab: who created each of the open
   * fan's notes and who changed it last, as the hub recorded our writes (`clientFanNoteAttributions`). A page bound to the
   * tab where the manifest admits `note-authors`; only ids and logins travel.
   */
  'notes.authors': { req: z.strictObject({ pageId: HubIntIdSchema, fanRef: NativeIdSchema }), res: NotesAuthorsSchema, from: TAB },
  /**
   * A write of «Заметки» the site took, from a tab that writes its notes itself (ChatSpace's OnlyMonster notes): told to
   * the hub's record of who wrote each note. Fansly's background tells its own. `queued` — owed to the hub now.
   */
  'notes.written': {
    req: z.strictObject({
      pageId: HubIntIdSchema,
      fanRef: NativeIdSchema,
      noteRef: NativeIdSchema,
      action: z.enum(NOTE_ATTRIBUTION_ACTIONS),
      origin: z.optional(z.string().check(z.maxLength(64))),
      fields: z.optional(z.array(z.string().check(z.maxLength(1000))).check(z.maxLength(200))),
    }),
    res: z.strictObject({ queued: z.boolean() }),
    from: TAB,
  },

  // ── service ──
  'site.access': { req: SiteAccessRequestSchema, res: SiteAccessStateSchema, from: PAGE, pages: ['popup', 'options'] },
  'settings.get': { req: Empty, res: SettingsStateSchema, from: ANY },
  /**
   * «Сохранено» is shown only on this confirmation with its revision
   * (ST-013…ST-015). Not the hub address nor debug: those only from the
   * options page (`settings.patchRestricted`), so a tab cannot point the
   * next sign-in elsewhere or switch debug output on.
   */
  'settings.patch': {
    req: z.strictObject({
      patch: SettingsPatchSchema.check(
        z.refine((p) => SETTINGS_OPTIONS_ONLY_SECTIONS.every((section) => p[section] === undefined), {
          message: 'hub and debug change only from the options page',
        }),
      ),
      baseRevision: z.nullable(CountSchema),
    }),
    res: SettingsStateSchema,
    from: ANY,
  },
  /**
   * 1.2.0. «Настройки» pressed in a ChatSpace tab — the remedy of a dock
   * banner (CG-AUTH-REQUIRED, CG-PERSONA-UNASSIGNED), the button of an error
   * card or of a toast, ⌘, — opens the settings page at the section of the
   * route (`options.html#<раздел>:<CODE>`, ST-006…ST-010). A content script
   * cannot open an extension page by itself; the background focuses the open
   * settings tab or opens one. `opened: false` — the browser refused.
   */
  'settings.open': {
    req: z.strictObject({ route: SettingsRouteSchema }),
    res: z.strictObject({ opened: z.boolean() }),
    from: TAB,
  },
  /** Any section, the hub address and debug included; the options page only. */
  'settings.patchRestricted': {
    req: z.strictObject({ patch: SettingsPatchSchema, baseRevision: z.nullable(CountSchema) }),
    res: SettingsStateSchema,
    from: PAGE,
    pages: ['options'],
  },
  'log.write': {
    req: z.strictObject({ records: z.array(LogRecordFromUiSchema).check(z.minLength(1), z.maxLength(LOG_LIMITS.maxRecordsPerWrite)) }),
    res: z.strictObject({ accepted: CountSchema, dropped: CountSchema }),
    from: ANY,
  },
  'diagnostics.get': { req: Empty, res: DiagnosticsSnapshotSchema, from: PAGE },
  /** The debug journals (§9.2, NF-029): records without any message or prompt text, newest last. */
  'journal.read': {
    req: z.strictObject({ journal: z.enum(JOURNAL_KINDS), limit: z.int().check(z.gte(1), z.lte(LOG_LIMITS.exportRecentRecords)) }),
    res: z.strictObject({
      records: z.array(LogRecordSchema).check(z.maxLength(LOG_LIMITS.exportRecentRecords)),
      /** The journal hit its cap («обрезано»). */
      truncated: z.boolean(),
      /** «Новые» check runs only. */
      runs: z.nullable(
        z.array(z.strictObject({ runId: UuidSchema, startedAt: IsoTimestampSchema, events: CountSchema })).check(z.maxLength(LOG_LIMITS.newcomersJournalRuns)),
      ),
    }),
    from: PAGE,
    pages: ['debug-journal', 'options'],
  },
  /**
   * The person's own AI spend (H-15; DB-022, PU-016), debug only (Б4): null
   * while debug is off or the hub lacks `ai-usage-v1`.
   */
  'usage.get': {
    req: z.strictObject({ pageId: HubIntIdSchema, date: BusinessDateSchema, days: z.optional(z.int().check(z.gte(1), z.lte(AI_USAGE_LIMITS.maxDays))) }),
    res: z.strictObject({ report: z.nullable(AiUsageReportSchema) }),
    from: PAGE,
    pages: ['popup', 'options', 'debug-journal'],
  },
  /**
   * 1.20.0 (DB-022, decision X47): this browser's own AI spend journal by feature over `days` local days, debug only
   * (Б4): null while debug is off. «Только этот браузер» — never presented as the person's full spend.
   */
  'usage.local': {
    req: z.strictObject({ days: z.int().check(z.gte(1), z.lte(7)) }),
    res: z.strictObject({ report: z.nullable(LocalSpendReportSchema) }),
    from: PAGE,
    pages: ['options', 'debug-journal'],
  },
  /** 1.20.0 (DB-027, decision X47): «Аккаунт → Дополнительно», debug only: null while debug is off or nobody is signed in. */
  'account.advanced': {
    req: Empty,
    res: z.strictObject({ info: z.nullable(AccountAdvancedSchema) }),
    from: PAGE,
    pages: ['options'],
  },
  /**
   * 1.20.0 (decision X47): the names of fans the tabs already know — the open chats' (`tab.presence`) and those the
   * tabs started an operation for (`StartOp.fanLabel`) — for the popup and «Идут сейчас» instead of «фан <id>».
   * The background's memory alone: nothing is read anywhere for it, nothing is stored, a sign-out empties it.
   */
  'fans.labels': {
    req: Empty,
    // 2026-10-22: `username` — the fan's @handle where an open chat's tab knows it (the popup's «Диалог»).
    res: z.strictObject({ fans: z.array(z.strictObject({ chatKey: ChatKeySchema, label: displayText(256), username: z.optional(displayText(64)) })).check(z.maxLength(FAN_LABELS_MAX)) }),
    from: PAGE,
    pages: ['popup', 'options'],
  },
  /**
   * The page or the tab saves it through a Blob; no `downloads` permission (§3). 2026-10-21: «Скачать лог» of the
   * popup and of the dock asks it too; `site` names the file (a tab's own site wins over it).
   */
  'diagnostics.export': {
    req: z.strictObject({ format: z.enum(['json', 'txt']), site: z.optional(HostKindSchema) }),
    res: z.strictObject({
      fileName: boundedText(128),
      mime: z.enum(['application/json', 'text/plain']),
      body: displayText(LOG_LIMITS.exportMaxBytes),
    }),
    from: ANY,
    pages: ['options', 'popup'],
  },
  /**
   * «Очистить локальные данные» (options «Диагностика», ST-110; 1.2.0): our
   * caches and logs go — cached hub answers, finished results, the log store
   * and the journals. The sign-in, the settings and open X8 attempts stay.
   * The page asks the person first; `confirmed` records that it did.
   */
  'data.clear': {
    req: z.strictObject({ confirmed: z.literal(true) }),
    res: z.strictObject({ cleared: z.boolean() }),
    from: PAGE,
    pages: ['options'],
  },
  /**
   * See PageCommandSchema; `delivered: false` — no ChatSpace tab is open to
   * act in. The tab gets the command as the `tab.command` event. 1.2.0.
   */
  'tab.command': {
    req: z.strictObject({ command: PageCommandSchema }),
    res: z.strictObject({ delivered: z.boolean() }),
    from: PAGE,
    pages: ['popup', 'options'],
  },
  /**
   * 1.21.0 (decision X48): who sent a message — a human send of the site's composer whose message id the page's own
   * response named. `queued` — the background owes it to the hub under the person signed in; false with the reason
   * it is not ours to report (the page, its switch, the hub). Ids, a time and two marks; never a text.
   */
  'attribution.report': {
    req: z.strictObject({ fact: SendAttributionFactSchema }),
    res: z.strictObject({ queued: z.boolean(), reason: z.optional(OpenTokenSchema) }),
    from: TAB,
  },
  /** An incoming-message fact for the one sound arbiter of the extension (§9.8). */
  'sound.event': {
    req: z.strictObject({ fact: IncomingFactSchema }),
    res: z.strictObject({ played: z.boolean(), reason: z.optional(OpenTokenSchema) }),
    from: TAB,
  },
  'sound.preview': {
    req: z.strictObject({ tone: ToneIdSchema, volume: SettingsV1Schema.shape.sound.shape.volume }),
    res: z.strictObject({ played: z.boolean(), code: z.optional(CgCodeSchema) }),
    from: PAGE,
    pages: ['options'],
  },
  'debug.prompt': { req: z.strictObject({ token: boundedText(128) }), res: PromptSnapshotViewSchema, from: PAGE, pages: ['debug-prompt'] },
  /**
   * 1.2.0. «Промпт» of a result's debug block in a ChatSpace tab (DB-007):
   * the prompt echo is read on `debug-prompt.html?t=<token>`, an extension
   * page, and a content script cannot open one — the background does. Only
   * the opaque token of the snapshot travels (DB-006): never an address, and
   * the prompt itself never reaches a tab. `opened: false` — debug mode is
   * off, or the browser refused.
   */
  'debug.open': { req: z.strictObject({ token: boundedText(128) }), res: z.strictObject({ opened: z.boolean() }), from: TAB },
  'health.report': { req: z.strictObject({ report: TabHealthReportSchema }), res: Ack, from: TAB },
  /**
   * One-time action token for a trusted (`isTrusted`) event inside our closed shadow root (§14). 1.39.0: `deferred`
   * — the insert of a Fix the person's click started, asked for by that Fix's own end (X68); the tab's gate answers
   * it from that click's deferred grant only.
   */
  'token.issue': {
    req: z.strictObject({ kind: z.enum(ACTION_TOKEN_KINDS), surface: SurfaceSchema, deferred: z.optional(z.literal(true)) }),
    res: z.strictObject({ actionToken: ActionTokenSchema, expiresAt: EpochMsSchema }),
    from: TAB,
  },
  /**
   * HostPort spends an `insert` or `navigate` token on exactly one intent
   * before the bridge call (`generate` and `send` tokens are spent by
   * `op.start` and `send.begin` themselves). The background accepts a token
   * once, for its kind and surface, before its deadline, from the tab
   * session it was issued to; `redeemed: false` — HostPort does not write.
   */
  'token.redeem': {
    req: z.strictObject({ kind: z.enum(HOST_ACTION_TOKEN_KINDS), surface: SurfaceSchema, actionToken: ActionTokenSchema, intentId: UuidSchema }),
    res: z.strictObject({ redeemed: z.boolean() }),
    from: TAB,
  },
} as const satisfies Record<string, TabRequestSpec>;

export type TabRequestType = keyof typeof TAB_REQUESTS;
export const TAB_REQUEST_TYPES = Object.keys(TAB_REQUESTS) as TabRequestType[];
export type TabRequestPayload<T extends TabRequestType> = z.infer<(typeof TAB_REQUESTS)[T]['req']>;
export type TabResponsePayload<T extends TabRequestType> = z.infer<(typeof TAB_REQUESTS)[T]['res']>;

// ── Events ─────────────────────────────────────────────────────────────────

export const TAB_EVENTS = {
  /** Stream text in 50 ms batches (`append` since the previous `seq`), plus phase/state changes. */
  'op.update': {
    payload: z.strictObject({
      opId: UuidSchema,
      seq: CountSchema,
      append: displayText(64_000),
      state: OpStateSchema,
      phase: PhaseSchema,
      firstChunkAt: z.optional(EpochMsSchema),
      /** 2026-10-27: the messages the hub served to the model, once its `context_v1` came (before the first chunk). */
      served: z.optional(CountSchema),
    }),
    to: ANY,
  },
  /** The terminal view of an operation. */
  'op.done': { payload: z.strictObject({ view: OpViewSchema }), to: ANY },
  /** 1.47.0: a chat's voice session changed (a script written, a take's state, an edit of another tab); null — it went. */
  'voice.changed': { payload: z.strictObject({ chat: ChatRefSchema, conversationRef: NativeIdSchema, session: z.nullable(VoiceSessionSchema) }), to: TAB },
  /** 2026-10-28: the notes' view changed (`notes.setView` of any tab, or Fansly's own). */
  'notes.viewChanged': { payload: z.strictObject({ view: z.enum(FANSLY_NOTES_VIEWS) }), to: TAB },
  /** 2026-10-28: a fill of `notes.fill.start` ended (done, failed, cancelled): its view, to the tab that started it. */
  'notes.fill.done': { payload: z.strictObject({ view: NotesFillOpViewSchema }), to: TAB },
  'send.state': { payload: z.strictObject({ view: SendAttemptViewSchema }), to: ANY },
  /** 1.11.0 (decision X25): the X8 fuse tripped or was reset; tabs reconfigure their host adapter by it. */
  'send.fuse': { payload: SendFuseStateSchema, to: ANY },
  /** Chat Memory week 1: «в разговоре» changed (the background asks the hub every 30 s per page with an open tab). */
  'talk.changed': { payload: TalkingMarksSchema, to: TAB },
  toast: { payload: z.strictObject({ toast: BackgroundToastSchema }), to: TAB },
  'settings.changed': { payload: SettingsStateSchema, to: ANY },
  'session.changed': {
    payload: z.strictObject({
      session: z.nullable(SessionIdentitySchema),
      reason: z.enum(['sign-in', 'sign-out', 'revoked', 'expired', 'hub-changed']),
    }),
    to: ANY,
  },
  /** A newer bootstrap is cached; receivers call `bootstrap.get`. */
  'bootstrap.changed': { payload: z.strictObject({ configRevision: CountSchema, issuedAt: IsoTimestampSchema }), to: ANY },
  'catalog.changed': { payload: Empty, to: ANY },
  /**
   * 1.20.0 (decision X47): the names of fans the tabs told the background changed (an open chat's fan was named,
   * renamed or left, a start named its fan); pages that show names read `fans.labels` again.
   */
  'fans.changed': { payload: Empty, to: PAGE },
  'newcomers.changed': { payload: z.strictObject({ pageId: HubIntIdSchema }), to: TAB },
  /** A generation's `meta` moved a page's quota. */
  'quota.changed': { payload: z.strictObject({ quota: AiQuotaSnapshotSchema }), to: ANY },
  /** Owner kill switches; unknown flag names mean "off" (open tokens, critic item 14). */
  'flags.changed': { payload: z.strictObject({ flags: z.record(OpenTokenSchema, z.boolean()), configRevision: CountSchema }), to: ANY },
  /**
   * 1.2.0. The second half of the `tab.command` request: the background
   * brought this ChatSpace tab to the front and hands it the click a person
   * made on an extension page (PageCommand: open Spenders, «Новые» or the
   * key cheatsheet, go to an account). Sent to that one tab only, and only
   * for a request of the popup or the options page; the tab runs it as that
   * human action — a navigation, never an insert, a send or a generation.
   */
  'tab.command': { payload: z.strictObject({ command: PageCommandSchema }), to: TAB },
  /**
   * 1.62.0: «Hi» of a greeting reminder's toast pressed in a tab of another model (the owner, 2026-10-25: «может
   * приходит только в одно окно активное?»). The background redeemed that tab's token of the click, brought a tab of
   * the fan's model to the front and hands the click to it: the tab runs `GreetNewcomer` of this fan as that click.
   */
  'greet.start': { payload: z.strictObject({ pageId: HubIntIdSchema, fanRef: NativeIdSchema }), to: TAB },
} as const satisfies Record<string, TabEventSpec>;

export type TabEventType = keyof typeof TAB_EVENTS;
export const TAB_EVENT_TYPES = Object.keys(TAB_EVENTS) as TabEventType[];
export type TabEventPayload<T extends TabEventType> = z.infer<(typeof TAB_EVENTS)[T]['payload']>;

export function isTabRequestType(type: string): type is TabRequestType {
  return Object.prototype.hasOwnProperty.call(TAB_REQUESTS, type);
}

export function isTabEventType(type: string): type is TabEventType {
  return Object.prototype.hasOwnProperty.call(TAB_EVENTS, type);
}

export type TabPayloadCheck = { readonly ok: true; readonly payload: unknown } | { readonly ok: false };

/** Second stage: the payload of a request, a response or an event of a known type. */
export function parseTabPayload(kind: 'req' | 'res' | 'evt', type: string, payload: unknown): TabPayloadCheck {
  let schema: z.ZodMiniType;
  if (kind === 'evt') {
    if (!isTabEventType(type)) return { ok: false };
    schema = TAB_EVENTS[type].payload;
  } else {
    if (!isTabRequestType(type)) return { ok: false };
    schema = kind === 'req' ? TAB_REQUESTS[type].req : TAB_REQUESTS[type].res;
  }
  const parsed = schema.safeParse(payload);
  return parsed.success ? { ok: true, payload: parsed.data } : { ok: false };
}

/**
 * Whether a sender kind (and page, or site) may send this request type (`senderAllowed`). `host` — 1.15.0: the site
 * of a tab or of a relay's tab; null for a page. A tab of an unnamed site is refused a request whose spec names `hosts`.
 */
export function mayRequest(type: TabRequestType, sender: TabSender, page: ExtensionPage | null, host: HostKind | null = null): boolean {
  return senderAllowed(TAB_REQUESTS[type], sender, page, host);
}
