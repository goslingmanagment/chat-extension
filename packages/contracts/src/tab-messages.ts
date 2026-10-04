// Tab and extension pages ↔ background protocol (architecture.md §5.4), the
// per-type half: the request registry (payload, response, allowed senders),
// the event registry and their payload schemas. Transport, sender rules and
// the envelope are in tab-protocol.ts.

import * as z from 'zod/mini';

import { CgCodeSchema, CgErrorWireSchema, SettingsRouteSchema } from './errors';
import { FeatureIdSchema, SurfaceSchema } from './features';
import { HostContractReportSchema, IncomingFactSchema, InsertReceiptSchema } from './host';
import { ChatKeySchema, ChatRefSchema, HostAccountSchema, HostKindSchema, HubBindingSchema, HumanCauseSchema, PartRefSchema, RoleSchema, SessionIdentitySchema, TargetSchema } from './ids';
import { DEBUG_LIMITS, LOG_LIMITS, PART_LIMITS, SIGN_IN_LIMITS, STORAGE_LIMITS } from './limits';
import { LogRecordFromUiSchema, LogRecordSchema } from './logs';
import { AdmissionSchema, OpStateSchema, OpViewSchema, PhaseSchema, StartOpSchema } from './ops';
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
import { DispatchTicketSchema, FreshnessCheckpointSchema, PendingIdSchema, SendAttemptViewSchema, SendGroupSchema, SendPurposeSchema, checkpointMatches, partInGroup } from './send';
import { CONTRACT_HASH_PATTERN } from './hub/auth';
import { PersonaCatalogSchema } from './hub/ai';
import { BootstrapSchema } from './hub/bootstrap';
import { FEED_LIMITS, FeedPageSchema } from './hub/feed';
import { AudienceNewPageSchema, ClaimStateSchema } from './hub/newcomers';
import { DossierSchema, RecapStatusSchema, SharedRecapsSchema } from './hub/recaps';
import { AI_USAGE_LIMITS, AiUsageReportSchema } from './hub/usage';
import { BusinessDateSchema } from './hub/wire';
import { QueuePageSchema, SpenderDetailSchema, SpendersBoardSchema, SpendersStatsSchema, StatsQuerySchema, type HubSpenderPeriod } from './hub/spenders';
import { SETTINGS_OPTIONS_ONLY_SECTIONS, SettingsPatchSchema, SettingsStateSchema, SettingsV1Schema, ToneIdSchema } from './settings';
import { TabRegisterRequestSchema, TabRegisterResponseSchema, type ExtensionPage, type TabSender } from './tab-protocol';
import { JOURNAL_KINDS } from './vm/selectors';
import { HealthCodeSchema, TabHealthReportSchema } from './telemetry';

// ── Shared payload pieces ──────────────────────────────────────────────────

const Empty = z.strictObject({});
const Ack = z.strictObject({ recorded: z.boolean() });

/** A hub page + fan the tab asks about; the background re-checks the page is in the tab's binding. */
const PageFan = { pageId: HubIntIdSchema, fanRef: NativeIdSchema };

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
  fanLabel: z.nullable(displayText(256)),
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

/** `diagnostics.get`: versions, flags and states without secrets or texts (LG-020…LG-025, SN-015). */
export const DiagnosticsSnapshotSchema = z.strictObject({
  generatedAt: IsoTimestampSchema,
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
        host: z.nullable(HostContractReportSchema),
        chatKey: z.nullable(ChatKeySchema),
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
    /** The MAIN document the command will go to; equals the checkpoint's. */
    documentEpoch: EpochTokenSchema,
    cause: HumanCauseSchema,
    /** «Новые»: the lease this greeting is sent under. */
    leaseToken: z.optional(UuidSchema),
  })
  .check(
    z.refine((b) => partInGroup(b.part, b.group), { message: 'the part belongs to the group: same variant (absent = 0), index below partCount' }),
    z.refine((b) => checkpointMatches(b.checkpoint, b.target.chat.hostAccountId, b.target.chat.platformFanId), { message: 'the checkpoint belongs to the target chat' }),
    z.refine((b) => b.checkpoint.documentEpoch === b.documentEpoch, { message: 'the checkpoint was taken in this document' }),
  );
export type SendBegin = z.infer<typeof SendBeginSchema>;

// ── Requests ───────────────────────────────────────────────────────────────

interface RequestSpec {
  readonly req: z.ZodMiniType;
  readonly res: z.ZodMiniType;
  readonly from: readonly TabSender[];
  /** Only these pages may send it (when the sender is a page). */
  readonly pages?: readonly ExtensionPage[];
}

const TAB = ['tab'] as const satisfies readonly TabSender[];
const PAGE = ['page'] as const satisfies readonly TabSender[];
const ANY = ['tab', 'page'] as const satisfies readonly TabSender[];

export const TAB_REQUESTS = {
  // ── tab lifecycle ──
  /** First request of a tab document: the background mints the tab session (§5.1). */
  'tab.register': { req: TabRegisterRequestSchema, res: TabRegisterResponseSchema, from: TAB },
  /** Which chat the tab shows and whether it is visible and focused (sound, «AI готово» toasts). */
  'tab.presence': {
    req: z.strictObject({
      chat: z.nullable(ChatRefSchema),
      routeEpoch: CountSchema,
      visible: z.boolean(),
      focused: z.boolean(),
      /** The host accounts this tab's ChatSpace has loaded, when they changed: the `presence` store (§9.9). */
      accounts: z.optional(z.array(HostAccountSchema).check(z.maxLength(200))),
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
  /** Options «Аккаунты»: the host accounts this browser has seen, and how many tabs show each now. */
  'accounts.seen': {
    req: Empty,
    res: z.strictObject({
      accounts: z
        .array(z.strictObject({ account: HostAccountSchema, lastSeenAt: IsoTimestampSchema, openTabs: CountSchema }))
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
  },
  'send.status': { req: z.strictObject({ attemptId: UuidSchema }), res: z.strictObject({ view: z.nullable(SendAttemptViewSchema) }), from: ANY },
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
  },

  // ── recaps ──
  'recap.status': { req: z.strictObject({ ...PageFan, personaDefinitionId: PersonaDefinitionIdSchema }), res: RecapStatusSchema, from: ANY },
  'recap.read': { req: z.strictObject({ ...PageFan, personaDefinitionId: PersonaDefinitionIdSchema }), res: SharedRecapsSchema, from: ANY },
  /**
   * 1.2.0 — «Сохранить ещё раз» (CG-RECAP-SAVE, UiAction RetryRecapSave) and
   * the late save of a full recap opened from the hub (AI-068): one
   * idempotent `profile/from-generation` link write (H-5), never a new
   * generation. `not-ready` — the tab repeats by the §7 schedule while it is
   * open; `rejected` — for good (CG-RECAP-SAVE). `opId` is the hub's
   * `clientRequestId` when the tab knows the operation.
   */
  'recap.save': {
    req: z.strictObject({ ...PageFan, generationRef: GenerationRefSchema, opId: z.optional(UuidSchema) }),
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
    req: z.strictObject({ pageId: HubIntIdSchema, cursor: CursorSchema, limit: z.int().check(z.gte(1), z.lte(100)) }),
    res: QueuePageSchema,
    from: TAB,
  },
  'feed.read': {
    req: z.strictObject({
      ...PageFan,
      cursor: CursorSchema,
      limit: z.int().check(z.gte(1), z.lte(FEED_LIMITS.maxLimit)),
      /** The Ping chip's window (settings `generation.windows.ping`); the hub's default 100 when absent. */
      summaryWindow: z.optional(z.int().check(z.gte(FEED_LIMITS.summaryWindowMin), z.lte(FEED_LIMITS.summaryWindowMax))),
    }),
    res: FeedPageSchema,
    from: TAB,
  },
  /** The fan panel's money (D-29): `period` '30d' gives the window and the lifetime in one read. */
  'fan.card': { req: z.strictObject({ ...PageFan, period: SpendersPeriodSchema }), res: SpenderDetailSchema, from: TAB },
  /** The fan panel's dossier (D-29: `pageConversationProfile` / `pageFanProfile`); null — the hub knows no profile. */
  'fan.dossier': { req: z.strictObject(PageFan), res: z.strictObject({ dossier: z.nullable(DossierSchema) }), from: TAB },
  /** Tabs, and the popup for its newcomer count (§9.9). */
  'newcomers.list': {
    req: z.strictObject({ pageId: HubIntIdSchema, windowHours: z.int().check(z.gte(1), z.lte(720)), cursor: CursorSchema }),
    res: AudienceNewPageSchema,
    from: ANY,
    pages: ['popup'],
  },
  'newcomers.claim': {
    req: z.strictObject({ ...PageFan, action: z.enum(['claim', 'renew', 'release']) }),
    res: ClaimStateSchema,
    from: TAB,
  },

  // ── service ──
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
  /** The page saves it through a Blob; no `downloads` permission (§3). */
  'diagnostics.export': {
    req: z.strictObject({ format: z.enum(['json', 'txt']) }),
    res: z.strictObject({
      fileName: boundedText(128),
      mime: z.enum(['application/json', 'text/plain']),
      body: displayText(LOG_LIMITS.exportMaxBytes),
    }),
    from: PAGE,
    pages: ['options'],
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
  'health.report': { req: z.strictObject({ report: TabHealthReportSchema }), res: Ack, from: TAB },
  /** One-time action token for a trusted (`isTrusted`) event inside our closed shadow root (§14). */
  'token.issue': {
    req: z.strictObject({ kind: z.enum(ACTION_TOKEN_KINDS), surface: SurfaceSchema }),
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
} as const satisfies Record<string, RequestSpec>;

export type TabRequestType = keyof typeof TAB_REQUESTS;
export const TAB_REQUEST_TYPES = Object.keys(TAB_REQUESTS) as TabRequestType[];
export type TabRequestPayload<T extends TabRequestType> = z.infer<(typeof TAB_REQUESTS)[T]['req']>;
export type TabResponsePayload<T extends TabRequestType> = z.infer<(typeof TAB_REQUESTS)[T]['res']>;

// ── Events ─────────────────────────────────────────────────────────────────

interface EventSpec {
  readonly payload: z.ZodMiniType;
  readonly to: readonly TabSender[];
}

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
    }),
    to: ANY,
  },
  /** The terminal view of an operation. */
  'op.done': { payload: z.strictObject({ view: OpViewSchema }), to: ANY },
  'send.state': { payload: z.strictObject({ view: SendAttemptViewSchema }), to: ANY },
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
} as const satisfies Record<string, EventSpec>;

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

/** Whether a sender kind (and page) may send this request type. */
export function mayRequest(type: TabRequestType, sender: TabSender, page: ExtensionPage | null): boolean {
  const spec: RequestSpec = TAB_REQUESTS[type];
  if (!spec.from.includes(sender)) return false;
  if (sender === 'page' && spec.pages !== undefined) return page !== null && spec.pages.includes(page);
  return true;
}
