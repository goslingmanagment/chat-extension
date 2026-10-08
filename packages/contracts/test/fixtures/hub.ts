// Valid samples of every hub DTO (synthetic ids only) and one valid + one
// invalid fixture (at least) for every schema of src/hub. The samples are
// typed against the inferred DTO types, so a renamed or missing field breaks
// the build before a test runs. Other packages' tests (the hub facade, the
// fake hub) can build on HUB_SAMPLES through @cg/contracts/fixtures.

import type * as z from 'zod/mini';

import * as C from '../../src/index';
import { IDS, ISO, ISO_LATER, uuid } from './samples';

const fixture = (name: string, schema: z.ZodMiniType, valid: readonly unknown[], invalid: readonly unknown[]) => ({ name, schema, valid, invalid });

const PAGE = 'model-one';
/** A persona definition id: opaque, 16–100 characters. */
export const PDEF = 'pdef_0123456789abcdef';
const GEN = uuid(6);
const INSTANCE = uuid(31);
const LEASE = uuid(30);

const pageRef: C.HubPageRef = { id: 11, label: PAGE, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One' };

// ── auth ──
const authState: C.HubAuthState = {
  authMethod: 'device_token',
  user: { id: 7, username: 'chatter1', role: 'chatter', mustChangePassword: false, assignedPages: [pageRef] },
};
const health: C.HubHealth = {
  status: 'ok',
  timestamp: ISO,
  contractHash: 'a'.repeat(64),
  capabilities: ['desktop-lifecycle-v2'],
  checks: { api: { status: 'ok' }, database: { status: 'ok', latencyMs: 3, error: null } },
  compatibleClientSdks: ['b'.repeat(64)],
};
const issueRequest: C.DeviceTokenIssueRequest = {
  username: 'chatter1',
  password: 'pw-not-a-secret',
  label: 'Firefox · macOS · ChatSpace',
  mode: 'active',
  client: 'chat-extension',
};
const issuedActive: C.DeviceTokenIssueResponse = {
  mode: 'active',
  token: 'cgx_synthetic_token_0001',
  id: 41,
  label: 'Firefox · macOS · ChatSpace',
  keyPrefix: 'cgx_synt',
  expiresAt: ISO_LATER,
  client: 'chat-extension',
};
const issuedPending: C.DeviceTokenIssueResponse = {
  mode: 'pending',
  token: 'cgr_synthetic_reservation',
  reservationId: 5,
  label: 'Desktop',
  keyPrefix: 'cgr_synt',
  reservationExpiresAt: ISO_LATER,
};

// ── bootstrap ──
const receiptProfile: C.ReceiptProfile = { id: 'chatspace-0.172', adapterVersion: '1.0.0', modules: { notificationEntry: 'sha256-0001' } };
const bootstrapPage: C.BootstrapPage = {
  pageId: 11,
  pageLabel: PAGE,
  title: 'Model One',
  platform: 'onlyfans',
  platformAccountId: IDS.creator,
  bindingRevision: 2,
  features: { insertion: { available: true }, newcomers: { available: false, reason: 'flag_off' } },
};
const bootstrapLimits: C.BootstrapLimits = {
  freshTextMaxItems: 60,
  freshTextMaxChars: 5000,
  feedMax: 100,
  deepMax: 1500,
  audienceWindowHours: 720,
  claimLeaseSec: 120,
  claimRenewSec: 40,
  claimActivityWindowSec: 120,
  previewSendPerMinute: 6,
  navInsertTimeoutSec: 20,
  dispatchTicketSec: 10,
  previewSendReceiptProfiles: [],
};
const bootstrap: C.Bootstrap = {
  protocol: 1,
  issuedAt: ISO,
  ttlSec: 300,
  configRevision: 4,
  minVersion: '0.1.0',
  identity: { userId: 7, username: 'chatter1', role: 'chatter', tokenClient: 'chat-extension' },
  pages: [bootstrapPage],
  bindingsByHost: { [C.hostBindingKey('chatspace', IDS.acc)]: 11 },
  flags: { insertion: true, newcomers: false },
  limits: bootstrapLimits,
  capabilities: ['context-v1'],
};

// ── AI ──
const persona: C.PersonaCatalogItem = { key: 'default', displayName: 'Default', version: 3, definitionId: PDEF, status: 'active' };
const liveText: C.LiveTextContext = {
  capturedAt: ISO,
  items: [
    { platformMessageId: IDS.msg1, direction: 'model', occurredAt: ISO, text: 'hi there' },
    { platformMessageId: IDS.msg2, direction: 'fan', occurredAt: ISO_LATER, text: 'hey' },
  ],
};
const streamBody: C.AiFeatureStreamBody = {
  clientRequestId: uuid(2),
  pageLabel: PAGE,
  platform: 'onlyfans',
  conversationRef: IDS.fan,
  fanRef: IDS.fan,
  personaKey: 'default',
  expectedPersonaDefinitionId: PDEF,
  replyTone: 'flirty',
  replyMode: 'preferSplit',
  messageCount: 100,
  isRegeneration: false,
};
const streamRequest: C.HubStreamRequest = {
  feature: 'fast-reply',
  body: { ...streamBody, knownFanMessageIds: [IDS.msg2, IDS.msg1], liveTextContext: liveText },
  capabilities: ['context-v1', 'split-all-v1'],
};
const reviewBody: C.AiFeatureStreamBody = { clientRequestId: uuid(3), pageLabel: PAGE, platform: 'onlyfans', conversationRef: IDS.fan, messageCount: 1500 };

const meta = {
  type: 'meta',
  requestId: GEN,
  clientRequestId: uuid(2),
  feature: 'fast-reply',
  pageLabel: PAGE,
  model: 'model-x',
  provider: 'anthropic',
  providerResponseId: null,
  personaDefinitionId: PDEF,
  quota: { accepted: true, remainingRequestsToday: 120, remainingMicroUsdToday: null },
} as const satisfies C.MetaFrame;
const usageFrame = {
  type: 'usage',
  usage: { inputTokens: 1200, outputTokens: 80, cacheWriteTokens: 0, cacheReadTokens: 900, costMicroUsd: 4200, costApproximate: false },
  providerResponseId: 'resp_01',
  cacheHit: true,
} as const satisfies C.HubFrame;
const errorFrame = { type: 'error', code: 'provider_rate_limited', message: 'AI provider rate limit reached', retryAfterMs: 30_000 } as const satisfies C.ErrorFrame;
const debugFrame = {
  type: 'debug_input_v1',
  systemBlocks: [{ text: 'system block', cache: '1h' }],
  userBlocks: [{ text: 'user block', cache: 'none' }],
  contextManifest: { source: 'union' },
} as const satisfies C.HubFrame;
const contextFrame: C.ContextFrame = {
  type: 'context_v1',
  generationRef: GEN,
  source: 'union',
  servedHead: { messageRef: IDS.msg2, occurredAt: ISO_LATER, isFromFan: true },
  archiveHead: null,
  window: { requested: 100, served: 87 },
  coverage: 'complete',
  knownFanMessages: [
    { id: IDS.msg2, state: 'included' },
    { id: IDS.msg1, state: 'absent' },
  ],
  live: { status: 'served', accepted: 2, rejected: 0 },
  fanLanguageEvidence: 'latin',
};

// ── recaps ──
const recapSlot = { generatedAt: ISO, ageMs: 60_000, transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 1500 } as const;
const recapStatus: C.RecapStatus = { full: recapSlot, short: null };
const recapBody: C.RecapBody = {
  generationRef: GEN,
  generatedAt: ISO,
  personaDefinitionId: PDEF,
  coverage: { transcriptCoverage: 'window', requestedCount: 3000, keptCount: 1500 },
  text: '## Fan\nLikes short replies.',
};
const sharedRecaps: C.SharedRecaps = { full: recapBody, short: null, fullSavedToProfile: true };
const profileResponse: C.ProfileFromGenerationResponse = { outcome: 'created', profile: { version: 2, createdAt: ISO, sourceGeneratedAt: ISO } };
const dossier: C.Dossier = {
  fan: { platform: 'onlyfans', platformUserId: IDS.fan, username: 'fan_two', displayName: 'Fan Two', createdAtExternal: null, pageAlias: null },
  profile: { version: 2, body: 'Likes short replies.', source: 'chatmuse', createdAt: ISO, sourceGeneratedAt: ISO, createdByUserId: 7 },
};

// ── spenders ──
const spenderFan: C.SpenderFan = { platform: 'onlyfans', platformUserId: IDS.fan, username: 'fan_two', displayName: 'Fan Two', createdAtExternal: null, pageAlias: null };
const periodMeta = { timeZone: 'Europe/Moscow', fromBusinessDate: '2026-09-04', toBusinessDateInclusive: '2026-10-03', asOf: ISO };
const scope = { kind: 'page', platform: 'onlyfans', pageCount: 1, page: pageRef, model: null } as const;
const metrics = {
  window: {
    grossAmountMills: 125_000,
    creatorNetAmountMills: 100_000,
    postedGrossAmountMills: 100_000,
    pendingGrossAmountMills: 25_000,
    unknownGrossAmountMills: 0,
    postedCreatorNetAmountMills: 80_000,
    pendingCreatorNetAmountMills: 20_000,
    unknownCreatorNetAmountMills: 0,
    transactionCount: 4,
    lastTransactionAt: ISO,
  },
  lifetime: { scopeGrossAmountMills: 900_000, scopeCreatorNetAmountMills: 720_000, platformGrossAmountMills: 950_000, platformCreatorNetAmountMills: 760_000 },
  comparison: { previousGrossAmountMills: 0, previousCreatorNetAmountMills: 0, deltaGrossAmountMills: 125_000, deltaCreatorNetAmountMills: 100_000, deltaPct: null },
};
const listItem: C.SpenderListItem = {
  fan: spenderFan,
  metrics,
  lifetimeLastTransactionAt: ISO,
  lastFanMessageAt: ISO,
  conversation: {
    platformConversationId: IDS.fan,
    unreadCount: 1,
    lastMessageAt: ISO,
    lastFanMessageAt: ISO,
    lastModelMessageAt: null,
    lastMessagePreview: 'hey',
    storedMessageCount: 40,
    messageCoverageStatus: 'complete',
    messageBackfillComplete: true,
  },
  lastTransaction: { canonicalType: 'tip', transactionState: 'posted', grossAmountMills: 25_000, creatorNetAmountMills: 20_000, occurredAt: ISO },
  retentionStatus: 'active',
};
const diagnostics = {
  totalGrossAmountMills: 125_000,
  totalCreatorNetAmountMills: 100_000,
  attributedGrossAmountMills: 125_000,
  attributedCreatorNetAmountMills: 100_000,
  unattributedGrossAmountMills: 0,
  unattributedCreatorNetAmountMills: 0,
};
const spendersPage: C.SpendersPage = { scope, period: periodMeta, diagnostics, items: [listItem], limit: 200, offset: 0, total: 1 };
const spendersBoard: C.SpendersBoard = { pageLabel: PAGE, period: '30d', scope, periodMeta, diagnostics, items: [listItem], total: 1, complete: true, fetchedAt: ISO, tiers: null };
const typeBreakdown = [{ canonicalType: 'tip', grossAmountMills: 25_000, creatorNetAmountMills: 20_000, transactionCount: 1 }] as const;
const spenderDetail: C.SpenderDetail = {
  scope,
  fan: spenderFan,
  period: periodMeta,
  metrics,
  typeBreakdown: [...typeBreakdown],
  pages: [
    {
      pageId: 11,
      pageLabel: PAGE,
      modelSlug: 'model-one',
      modelName: 'Model One',
      inScope: true,
      grossAmountMills: 125_000,
      creatorNetAmountMills: 100_000,
      lastTransactionAt: ISO,
      isFollower: true,
      followerSince: ISO,
      isSubscriber: true,
      subscriberSince: ISO,
      subscriptionExpiresAt: ISO_LATER,
      autoRenew: null,
      autoRenewOffDetectedAt: null,
    },
  ],
};
const spenderBatch: C.SpenderBatch = {
  scope,
  period: periodMeta,
  items: [
    {
      requestedFan: { platform: 'onlyfans', platformUserId: IDS.fan },
      found: true,
      fan: spenderFan,
      metrics,
      typeBreakdown: [...typeBreakdown],
      lifetimeLastTransactionAt: ISO,
      subscription: { status: 'active', expiresAt: ISO_LATER, autoRenew: true, autoRenewOffDetectedAt: null },
    },
    {
      requestedFan: { platform: 'onlyfans', platformUserId: IDS.otherFan },
      found: false,
      fan: null,
      metrics: null,
      typeBreakdown: null,
      lifetimeLastTransactionAt: null,
      subscription: null,
    },
  ],
};
const autoLists: C.AutoLists = {
  page: pageRef,
  currency: 'USD',
  metric: 'lifetimeGrossAmountMills',
  period: periodMeta,
  asOf: ISO,
  totalEntries: 3,
  lists: [
    { key: '0-25', label: '$0–25', minAmountMills: 10, maxAmountMillsExclusive: 25_000, entryCount: 2 },
    { key: '600-plus', label: '$600+', minAmountMills: 600_000, maxAmountMillsExclusive: null, entryCount: 1 },
  ],
};
const moneyWindow = { grossMills: 125_000, purchasesGrossMills: 130_000, adjustmentsMills: -5_000, creatorNetMills: 100_000, purchaseCount: 4, payerCount: 2 };
const stats: C.SpendersStats = {
  pageLabel: PAGE,
  metricVersion: 1,
  moneyUnit: 'USD-mills',
  basis: 'gross',
  timeZone: 'Europe/Moscow',
  from: '2026-09-04',
  to: '2026-10-03',
  asOf: ISO,
  projectionAsOf: ISO,
  includedStates: ['posted', 'pending', 'unknown'],
  coverage: { state: 'complete', reasons: [] },
  days: [{ date: '2026-10-03', grossMills: 25_000, purchasesGrossMills: 25_000, adjustmentsMills: 0, creatorNetMills: 20_000, purchaseCount: 1, byState: { posted: 25_000 } }],
  totals: { today: moneyWindow, d7: moneyWindow, prev7: { ...moneyWindow, grossMills: 0 }, d30: moneyWindow, d7DeltaPct: null },
  avgCheckMills: 32_500,
  tiers: [{ key: '0-25', label: '$0–25', minMills: 10, maxMills: 25_000, members: 2, windowPayers: 1, windowGrossMills: 25_000 }],
  silence: { d8to21: { fans: 1, lifetimeGrossMills: 50_000 }, over21: { fans: 0, lifetimeGrossMills: 0 }, unknown: { fans: 0, lifetimeGrossMills: 0 } },
  newPayers: { count: 1, firstPurchaseKnown: true },
  queueSummary: { total: 3, unknown: 1 },
};
const queuePage: C.QueuePage = {
  items: [
    {
      fanRef: IDS.fan,
      username: 'fan_two',
      displayName: null,
      lifetimeGrossMills: 900_000,
      lastFanMessageAt: ISO_LATER,
      lastModelMessageAt: ISO,
      unreadCount: null,
      readState: 'unknown',
    },
  ],
  total: 3,
  loaded: 1,
  unknown: 1,
  nextCursor: 'cur-queue-2',
  asOf: ISO,
};

// ── feed ──
const feedItem: C.FeedItem = {
  messageId: IDS.msg2,
  at: ISO_LATER,
  sender: 'fan',
  text: 'hey',
  automatic: null,
  deleted: false,
  tipMills: null,
  priceMills: null,
  attachmentLabels: [],
};
const feedPage: C.FeedPage = {
  target: { pageLabel: PAGE, fanRef: IDS.fan },
  source: 'union',
  snapshotRevision: 'snap-1',
  asOf: ISO_LATER,
  coverage: 'complete',
  head: { messageRef: IDS.msg2, at: ISO_LATER, sender: 'fan' },
  newestKnownAt: ISO_LATER,
  nextOlderCursor: 'cur-older-1',
  items: [feedItem, { ...feedItem, messageId: IDS.msg1, sender: 'model', text: '', tipMills: null, priceMills: 15_000, attachmentLabels: ['[Photo]'] }],
  summary: { pingSegment: 'segment-a', fanSilenceDays: 0, window: { requested: 100, served: 40 }, coverage: 'complete', asOf: ISO_LATER },
};

// ── «Новые», claim, custody ──
const group: C.ClaimGroup = { generationRef: GEN, variant: 0, partCount: 2 };
const claimBodies: Record<C.ClaimAction, C.ClaimBody> = {
  claim: { action: 'claim', leaseToken: LEASE, instanceId: INSTANCE },
  renew: { action: 'renew', leaseToken: LEASE, instanceId: INSTANCE },
  release: { action: 'release', leaseToken: LEASE, instanceId: INSTANCE },
  dispatch: {
    action: 'dispatch',
    attemptId: uuid(5),
    instanceId: INSTANCE,
    purpose: 'greeting',
    group,
    partIndex: 0,
    textRevision: 1,
    leaseToken: LEASE,
    flagRevision: 4,
  },
  sent: { action: 'sent', attemptId: uuid(5), instanceId: INSTANCE, platformMessageId: IDS.msg2, evidence: 'receipt+echo' },
  failed: { action: 'failed', attemptId: uuid(5), instanceId: INSTANCE, reason: 'native_rejected', httpStatus: 422 },
  registerNativeSend: {
    action: 'registerNativeSend',
    attemptId: uuid(7),
    instanceId: INSTANCE,
    purpose: 'greeting',
    group,
    partIndex: 1,
    platformMessageId: IDS.msg2,
  },
};
const claimState: C.ClaimState = {
  greeting: { state: 'none', at: null, messageRef: null, source: null },
  lease: { state: 'owned', leaseToken: LEASE, expiresAt: ISO_LATER, heldBy: null },
  group: { generationRef: GEN, variant: 0, partCount: 2, sentParts: [], heldParts: [] },
  custody: { attemptId: uuid(5), state: 'dispatching', ticket: 'tkt_once_0001', ticketExpiresAt: ISO_LATER },
  serverNow: ISO,
  flagRevision: 4,
};
const claimSummary: C.ClaimSummary = { greeting: 'none', lease: 'none', heldBy: null, custody: null };
const audienceItem: C.AudienceNewItem = {
  eventRef: 'evt-0001',
  fanRef: IDS.fan,
  username: 'fan_two',
  displayName: 'Fan Two',
  kind: 'new',
  trial: false,
  subscribedAt: ISO,
  subscribedAtSource: 'notification',
  status: { isSubscriber: true, subscriptionStatus: 'active', endsAt: ISO_LATER, asOf: ISO, source: 'webhook' },
  thread: { lastMessageAt: ISO, lastFanMessageAt: null, lastModelMessageAt: ISO, storedMessageCount: 1, coverage: 'complete', backfillComplete: true },
  claim: claimSummary,
};
const audiencePage: C.AudienceNewPage = {
  pageLabel: PAGE,
  window: { hours: 48, from: '2026-10-01T10:00:00Z', to: ISO, snapshotAt: ISO },
  serverNow: ISO,
  coverage: { state: 'partial', deliveryFrontier: ISO, lastAudienceSweepAt: null, reasons: ['sweep_missing'] },
  unknownCount: 1,
  welcomeTemplate: { ref: 'wm-1', observedAt: ISO, enabled: true, hasText: true, hasMedia: false, priceMills: null },
  items: [audienceItem],
  nextCursor: null,
};

// ── ingest and AI usage ──
const ingestEvent: C.IngestEvent = {
  clientEventId: uuid(40),
  kind: 'ai_acceptance',
  observedAt: ISO,
  payload: { generationRef: GEN, lifecycle: 'shown' },
  pageLabel: PAGE,
};
const usageTotals: C.AiUsageTotals = {
  requestCount: 12,
  costMicroUsd: 52_000,
  costApproximate: false,
  tokens: { input: 12_000, output: 900, cacheWrite: 0, cacheRead: 8_000 },
  completed: 11,
  failed: 1,
  cancelled: 0,
  quotaDenied: 0,
  openReservations: 0,
  regenerations: 2,
};
const usageDay: C.AiUsageDay = {
  date: '2026-10-03',
  from: '2026-10-02T21:00:00Z',
  toExclusive: '2026-10-03T21:00:00Z',
  coverage: 'partial',
  coverageReasons: ['day_open'],
  totals: usageTotals,
  features: [{ ...usageTotals, feature: 'fast-reply' }],
};
const usageReport: C.AiUsageReport = {
  scope: { pageLabel: PAGE, userId: 7 },
  timeZone: 'Europe/Moscow',
  asOf: ISO,
  moneyUnit: 'micro-USD',
  days: [usageDay],
  quota: { dayBoundary: 'UTC', remainingRequestsToday: 100, remainingMicroUsdToday: null },
};

/** Valid samples of the hub DTOs for other packages' tests. */
export const HUB_SAMPLES = {
  pageRef,
  authState,
  health,
  issueRequest,
  issuedActive,
  issuedPending,
  bootstrap,
  bootstrapPage,
  bootstrapLimits,
  persona,
  liveText,
  streamBody,
  streamRequest,
  frames: { meta, usage: usageFrame, error: errorFrame, debug: debugFrame, context: contextFrame },
  recapStatus,
  recapBody,
  sharedRecaps,
  profileResponse,
  dossier,
  spenderFan,
  listItem,
  spendersPage,
  spendersBoard,
  spenderDetail,
  spenderBatch,
  autoLists,
  stats,
  queuePage,
  feedItem,
  feedPage,
  claimBodies,
  claimState,
  audienceItem,
  audiencePage,
  ingestEvent,
  usageReport,
} as const;

const { window: _window, ...metricsWithoutWindow } = metrics;

export const HUB_SCHEMA_FIXTURES = [
  // ── wire ──
  fixture('BusinessDate', C.BusinessDateSchema, ['2026-10-03', '2024-02-29'], ['2026-02-30', '2026-1-3', '2026-10-03T00:00:00Z']),
  fixture('PageLabel', C.PageLabelSchema, [PAGE], ['', 'x'.repeat(121)]),
  fixture('PageParams', C.PageParamsSchema, [{ pageLabel: PAGE }], [{ pageLabel: PAGE, fanRef: IDS.fan }]),
  fixture('PageFanParams', C.PageFanParamsSchema, [{ pageLabel: PAGE, fanRef: IDS.fan }], [{ pageLabel: PAGE, fanRef: 'fan_two' }]),
  fixture('HubCursor', C.HubCursorSchema, ['cur-1'], ['', 'c'.repeat(2049)]),
  fixture('PersonaDefinitionId', C.PersonaDefinitionIdSchema, [PDEF], ['too-short', 'd'.repeat(101)]),
  fixture('PersonaKey', C.PersonaKeySchema, ['default', 'k'.repeat(120)], ['', 'k'.repeat(121)]),
  fixture(
    'HubErrorBody',
    C.HubErrorBodySchema,
    [
      { error: 'unauthorized', message: 'Unauthorized', statusCode: 401, reason: 'token_revoked' },
      { error: 'sync_snapshot_restart_required', message: 'm', statusCode: 409, replayFloor: 3 },
    ],
    [{ error: 'bad_request', statusCode: 400 }, { error: 'x', message: 'm', statusCode: '400' }],
  ),
  fixture('AiStreamCapability', C.AiStreamCapabilitySchema, ['context-v1', 'debug-input-v1'], ['live-text-v1']),

  // ── auth ──
  fixture('DeviceTokenIssueRequest', C.DeviceTokenIssueRequestSchema, [issueRequest, { ...issueRequest, mode: 'pending', client: undefined }], [
    { ...issueRequest, mode: 'pending' },
    { ...issueRequest, password: '' },
    { ...issueRequest, client: 'desktop' },
  ]),
  fixture('DeviceTokenIssueResponse', C.DeviceTokenIssueResponseSchema, [issuedActive, issuedPending, { ...issuedActive, client: undefined }], [
    { ...issuedActive, mode: 'reserved' },
    { ...issuedPending, reservationId: undefined },
  ]),
  fixture('DeviceTokenRevokeResponse', C.DeviceTokenRevokeResponseSchema, [{ revoked: true }], [{ revoked: false }]),
  fixture('SignOutOutcome', C.SignOutOutcomeSchema, [{ serverRevoked: true }, { serverRevoked: null }], [{}]),
  fixture('HubPageRef', C.HubPageRefSchema, [pageRef], [{ ...pageRef, platform: 'patreon' }]),
  fixture('HubAuthState', C.HubAuthStateSchema, [authState], [{ ...authState, authMethod: 'api_key' }]),
  fixture('HubHealth', C.HubHealthSchema, [health, { ...health, status: 'degraded', compatibleClientSdks: undefined }], [
    { ...health, contractHash: 'abc' },
    { ...health, compatibleClientSdks: ['nothex'] },
  ]),

  // ── bootstrap ──
  fixture('FeatureAvailability', C.FeatureAvailabilitySchema, [{ available: true }, { available: false, reason: 'a-reason-from-the-future' }], [
    { available: 'yes' },
    { available: false, reason: '' },
  ]),
  fixture('ReceiptProfile', C.ReceiptProfileSchema, [receiptProfile], [{ ...receiptProfile, modules: { role: '' } }]),
  fixture(
    'BootstrapPage',
    C.BootstrapPageSchema,
    [bootstrapPage, { ...bootstrapPage, platform: 'some-new-platform', platformAccountId: null, features: { futureFlag: { available: true } } }],
    [{ ...bootstrapPage, pageId: 0 }, { ...bootstrapPage, features: { insertion: true } }],
  ),
  fixture('BootstrapLimits', C.BootstrapLimitsSchema, [bootstrapLimits, { ...bootstrapLimits, previewSendReceiptProfiles: [receiptProfile] }], [
    { ...bootstrapLimits, freshTextMax: 60, freshTextMaxItems: undefined },
    { ...bootstrapLimits, feedMax: 0 },
  ]),
  fixture(
    'Bootstrap',
    C.BootstrapSchema,
    [
      bootstrap,
      // Unknown role, flag and capability tokens never fail the parse (critic item 14).
      {
        ...bootstrap,
        identity: { ...bootstrap.identity, role: 'auditor', tokenClient: null },
        flags: { someFutureFlag: true },
        capabilities: ['some-future-v9'],
        futureTopLevel: { any: 1 },
      },
    ],
    [
      { ...bootstrap, identity: { ...bootstrap.identity, username: undefined, login: 'chatter1' } },
      { ...bootstrap, protocol: 0 },
      { ...bootstrap, bindingsByHost: { 'onlymonster:1001': 'model-one' } },
    ],
  ),

  // ── AI ──
  fixture('PersonaCatalogItem', C.PersonaCatalogItemSchema, [persona], [{ ...persona, definitionId: 'short' }, { ...persona, status: 'deleted' }]),
  fixture('PersonaCatalog', C.PersonaCatalogSchema, [{ personas: [persona] }, { personas: [] }], [{ personas: [{ ...persona, version: 0 }] }]),
  fixture('HubAiFeature', C.HubAiFeatureSchema, ['fast-reply', 'coach-chat'], ['help-me', 'reply']),
  fixture('LiveTextContext', C.LiveTextContextSchema, [liveText], [
    { ...liveText, items: [] },
    { ...liveText, items: [{ platformMessageId: '0123', direction: 'fan', occurredAt: ISO, text: 'x' }] },
    { ...liveText, items: [{ platformMessageId: IDS.msg1, direction: 'fan', occurredAt: ISO, text: 'x', isFromQueue: true }] },
  ]),
  fixture('AiFeatureStreamBody', C.AiFeatureStreamBodySchema, [streamBody, reviewBody, { ...streamBody, knownFanMessageIds: [IDS.msg2, IDS.msg1] }], [
    { ...streamBody, messageCount: 3001 },
    { ...streamBody, clientContext: { transcript: 'x' } },
    { ...streamBody, conversationRef: 'chat-2002' },
    // The bounded set of §6.7.5: 1–10 distinct ids, never the old single field.
    { ...streamBody, knownFanMessageIds: [] },
    { ...streamBody, knownFanMessageIds: [IDS.msg2, IDS.msg2] },
    { ...streamBody, knownFanMessageIds: Array.from({ length: 11 }, (_, i) => String(5000 + i)) },
    { ...streamBody, knownFanMessageId: IDS.msg2 },
  ]),
  fixture(
    'HubStreamRequest',
    C.HubStreamRequestSchema,
    [
      streamRequest,
      { feature: 'chat-review', body: reviewBody, capabilities: [] },
      { feature: 'improve-draft', body: { ...reviewBody, draftText: 'my draft' }, capabilities: ['debug-input-v1'] },
      { feature: 'fan-summary', body: { ...reviewBody, summaryMode: 'short' }, capabilities: ['context-v1'] },
      // Coach (1.3.0): a question of ours, or the hub's preset — which carries its own question.
      { feature: 'coach-chat', body: { ...reviewBody, chatterQuestion: 'What do I offer him?', coachHistory: [] }, capabilities: [] },
      { feature: 'coach-chat', body: { ...reviewBody, preset: 'situation' }, capabilities: [] },
    ],
    [
      // The hub answers 400 to both: «coach-chat preset forbids chatterQuestion», «coach-chat requires chatterQuestion».
      { feature: 'coach-chat', body: { ...reviewBody, preset: 'situation', chatterQuestion: 'What is going on in the chat?' }, capabilities: [] },
      { feature: 'coach-chat', body: { ...reviewBody, chatterQuestion: '   ' }, capabilities: [] },
      { feature: 'coach-chat', body: reviewBody, capabilities: [] },
      { feature: 'chat-review', body: { ...reviewBody, liveTextContext: liveText }, capabilities: ['context-v1'] },
      { feature: 'fast-reply', body: { ...streamBody, liveTextContext: liveText }, capabilities: [] },
      { feature: 'improve-draft', body: reviewBody, capabilities: [] },
      { feature: 'ping', body: streamBody, capabilities: [] },
      { feature: 'fast-reply', body: streamBody, capabilities: ['context-v1', 'context-v1'] },
    ],
  ),
  fixture('MetaFrame', C.MetaFrameSchema, [meta, { ...meta, feature: 'future-feature', provider: 'future-provider', presetQuestion: 'q' }], [
    { ...meta, requestId: 'not-a-uuid' },
    { ...meta, extra: 1 },
  ]),
  fixture('ContentDeltaFrame', C.ContentDeltaFrameSchema, [{ type: 'content_delta', text: `Hey${C.SPLIT_MARKERS.next}there` }], [{ type: 'content_delta' }]),
  fixture('ReasoningDeltaFrame', C.ReasoningDeltaFrameSchema, [{ type: 'reasoning_delta', text: 'thinking' }], [{ type: 'reasoning_delta', text: 1 }]),
  fixture('UsageFrame', C.UsageFrameSchema, [usageFrame], [{ ...usageFrame, cacheHit: 'yes' }]),
  fixture('ErrorFrame', C.ErrorFrameSchema, [errorFrame, { ...errorFrame, code: 'provider_billing', retryAfterMs: null }], [
    { ...errorFrame, message: '' },
    { ...errorFrame, retryAfterMs: undefined },
  ]),
  fixture('DoneFrame', C.DoneFrameSchema, [{ type: 'done', stopReason: 'end_turn' }, { type: 'done', stopReason: null }], [{ type: 'done' }]),
  fixture('DebugInputFrame', C.DebugInputFrameSchema, [debugFrame, { ...debugFrame, contextManifest: null }], [
    { ...debugFrame, systemBlocks: [] },
    { ...debugFrame, images: [{ url: 'https://evil.example/x.png' }] },
  ]),
  fixture('ContextFrame', C.ContextFrameSchema, [contextFrame, { ...contextFrame, source: 'archive', servedHead: null, knownFanMessages: undefined, futureKey: true }], [
    { ...contextFrame, live: undefined },
    { ...contextFrame, generationRef: 'gen-1' },
  ]),
  fixture('HubFrame', C.HubFrameSchema, [meta, usageFrame, errorFrame, debugFrame, contextFrame, { type: 'done', stopReason: null }], [
    { type: 'heartbeat' },
    { type: 'content_delta', text: 'x', extra: true },
  ]),

  // ── the hub layer's own checks (1.1.0) ──
  fixture('HubClientCheck', C.HubClientCheckSchema, ['signInPending', 'narrowTokenMissing', 'notSignedIn', 'boardTimeout', 'previewSendOff'], ['CG-LOGIN-PENDING', 'signedOut', '']),

  // ── recaps ──
  fixture('RecapStatusQuery', C.RecapStatusQuerySchema, [{ pageLabel: PAGE, conversationRef: IDS.fan, fanRef: IDS.fan, personaDefinitionId: PDEF }], [
    { pageLabel: PAGE, conversationRef: IDS.fan, personaDefinitionId: 'short' },
  ]),
  fixture('RecapStatus', C.RecapStatusSchema, [recapStatus, { full: null, short: null }], [{ full: { ...recapSlot, transcriptCoverage: 'all' }, short: null }]),
  fixture('SharedRecapsQuery', C.SharedRecapsQuerySchema, [{ pageLabel: PAGE, fanRef: IDS.fan }, { pageLabel: PAGE, fanRef: IDS.fan, personaDefinitionId: PDEF }], [
    { pageLabel: PAGE, fanRef: '0' },
  ]),
  fixture('RecapBody', C.RecapBodySchema, [recapBody], [{ ...recapBody, text: undefined }]),
  fixture('SharedRecaps', C.SharedRecapsSchema, [sharedRecaps, { full: null, short: null, fullSavedToProfile: false }], [{ full: null, short: null }]),
  fixture('ProfileFromGenerationRequest', C.ProfileFromGenerationRequestSchema, [{ pageLabel: PAGE, fanRef: IDS.fan, generationRef: GEN, clientRequestId: uuid(2) }], [
    { pageLabel: PAGE, fanRef: IDS.fan, generationRef: '' },
  ]),
  fixture('ProfileFromGenerationResponse', C.ProfileFromGenerationResponseSchema, [profileResponse, { ...profileResponse, outcome: 'existing' }], [
    { ...profileResponse, outcome: 'saved' },
  ]),
  fixture(
    'ProfileSaveOutcome',
    C.ProfileSaveOutcomeSchema,
    [{ state: 'saved', response: profileResponse }, { state: 'not-ready' }, { state: 'rejected', reason: 'not_full_summary' }],
    [{ state: 'saved' }, { state: 'not-ready', retryInMs: 5000 }],
  ),
  fixture('DossierQuery', C.DossierQuerySchema, [{ pageLabel: PAGE, fanRef: IDS.fan }], [{ pageLabel: PAGE }]),
  fixture('Dossier', C.DossierSchema, [dossier, { ...dossier, profile: null }], [{ ...dossier, profile: { ...dossier.profile, source: 'chat-extension' } }]),

  // ── spenders ──
  fixture('HubSpenderPeriod', C.HubSpenderPeriodSchema, ['90d', 'lifetime'], ['year']),
  fixture(
    'SpendersQuery',
    C.SpendersQuerySchema,
    [
      { scope: 'page', pageLabel: PAGE, period: '30d', limit: 200, offset: 400 },
      { scope: 'page', pageLabel: PAGE, period: 'custom', from: '2026-09-01', to: '2026-09-30', limit: 50, offset: 0, sortBy: 'lastTransactionAt', sortDir: 'desc' },
    ],
    [
      { scope: 'agency', pageLabel: PAGE, period: '30d', limit: 200, offset: 0 },
      { scope: 'page', pageLabel: PAGE, period: '30d', limit: 201, offset: 0 },
      { scope: 'page', pageLabel: PAGE, period: 'custom', from: '2026-09-30', to: '2026-09-01', limit: 50, offset: 0 },
      { scope: 'page', pageLabel: PAGE, period: '30d', from: '2026-09-01', limit: 50, offset: 0 },
    ],
  ),
  fixture('SpenderFan', C.SpenderFanSchema, [spenderFan], [{ ...spenderFan, username: undefined }]),
  fixture('SpenderPeriodMeta', C.SpenderPeriodMetaSchema, [periodMeta, { ...periodMeta, fromBusinessDate: null, toBusinessDateInclusive: null }], [
    { ...periodMeta, fromBusinessDate: '04.09.2026' },
  ]),
  fixture('SpenderScope', C.SpenderScopeSchema, [scope], [{ ...scope, kind: 'team' }]),
  fixture('SpenderMetrics', C.SpenderMetricsSchema, [metrics, { ...metrics, window: null, comparison: null }], [metricsWithoutWindow]),
  fixture('SpenderListItem', C.SpenderListItemSchema, [listItem], [{ ...listItem, retentionStatus: 'all' }, { ...listItem, metrics: { ...metrics, window: { ...metrics.window, grossAmountMills: 1.5 } } }]),
  fixture('SpenderDiagnostics', C.SpenderDiagnosticsSchema, [diagnostics], [{ ...diagnostics, totalGrossAmountMills: '125' }]),
  fixture('SpendersPage', C.SpendersPageSchema, [spendersPage, { ...spendersPage, items: [], total: 0 }], [{ ...spendersPage, total: undefined }]),
  fixture('SpendersBoard', C.SpendersBoardSchema, [spendersBoard, { ...spendersBoard, tiers: autoLists }], [
    { ...spendersBoard, items: Array.from({ length: 1001 }, () => listItem) },
    { ...spendersBoard, period: 'year' },
    // The shelves come with the board: null when the bucket read failed, never absent.
    { ...spendersBoard, tiers: undefined },
    { ...spendersBoard, tiers: { ...autoLists, currency: 'EUR' } },
  ]),
  fixture('SpenderDetailQuery', C.SpenderDetailQuerySchema, [{ platform: 'onlyfans', platformUserId: IDS.fan, scope: 'page', pageLabel: PAGE, period: 'lifetime' }], [
    { platform: 'onlyfans', platformUserId: 'fan_two', scope: 'page', pageLabel: PAGE, period: 'lifetime' },
  ]),
  fixture('SpenderDetail', C.SpenderDetailSchema, [spenderDetail], [{ ...spenderDetail, typeBreakdown: [{ canonicalType: 'gift' }] }]),
  fixture(
    'SpenderBatchQuery',
    C.SpenderBatchQuerySchema,
    [
      { scope: 'page', pageLabel: PAGE, period: '30d', fans: [{ platform: 'onlyfans', platformUserId: IDS.fan }] },
      { scope: 'page', pageLabel: PAGE, fans: [{ platform: 'onlyfans', platformUserId: IDS.fan }] },
    ],
    [
      { scope: 'page', pageLabel: PAGE, fans: [] },
      { scope: 'page', pageLabel: PAGE, from: '2026-09-01', fans: [{ platform: 'onlyfans', platformUserId: IDS.fan }] },
    ],
  ),
  fixture('SpenderBatch', C.SpenderBatchSchema, [spenderBatch], [{ ...spenderBatch, items: [{ ...spenderBatch.items[0], found: 'yes' }] }]),
  fixture('AutoLists', C.AutoListsSchema, [autoLists], [{ ...autoLists, currency: 'EUR' }, { ...autoLists, lists: [{ ...autoLists.lists[0], minAmountMills: -1 }] }]),
  fixture('StatsQuery', C.StatsQuerySchema, [{ pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' }], [
    { pageLabel: PAGE, windowDays: 7, timeZone: 'Europe/Moscow' },
    { pageLabel: PAGE, windowDays: 30, timeZone: 'Moscow time' },
  ]),
  fixture(
    'SpendersStats',
    C.SpendersStatsSchema,
    [stats, { ...stats, coverage: { state: 'partial', reasons: ['history_unknown'] }, avgCheckMills: null, futureMetric: 1 }],
    [
      { ...stats, moneyUnit: 'USD' },
      { ...stats, totals: { ...stats.totals, d30: undefined } },
    ],
  ),
  fixture('QueueQuery', C.QueueQuerySchema, [{ pageLabel: PAGE }, { pageLabel: PAGE, cursor: 'cur-queue-2', limit: 100 }], [{ pageLabel: PAGE, limit: 0 }]),
  fixture('QueuePage', C.QueuePageSchema, [queuePage, { ...queuePage, items: [], nextCursor: null }], [
    { ...queuePage, items: [{ ...queuePage.items[0], fanRef: 'fan_two' }] },
  ]),

  // ── feed ──
  fixture('FeedQuery', C.FeedQuerySchema, [{ pageLabel: PAGE, fanRef: IDS.fan }, { pageLabel: PAGE, fanRef: IDS.fan, cursor: 'cur-older-1', limit: 100, summaryWindow: 1500 }], [
    { pageLabel: PAGE, fanRef: IDS.fan, summaryWindow: 3000 },
    { pageLabel: PAGE, fanRef: IDS.fan, limit: 101 },
  ]),
  fixture('FeedItem', C.FeedItemSchema, [feedItem, { ...feedItem, at: null, sender: 'some-new-sender', automatic: true, deleted: true }], [
    { ...feedItem, attachmentLabels: ['x'.repeat(81)] },
    { ...feedItem, tipMills: 1.25 },
  ]),
  fixture('FeedSummary', C.FeedSummarySchema, [feedPage.summary, { ...feedPage.summary, pingSegment: 'unknown', fanSilenceDays: null }], [
    { ...feedPage.summary, window: { requested: 100 } },
  ]),
  fixture('FeedPage', C.FeedPageSchema, [feedPage, { ...feedPage, head: null, nextOlderCursor: null, items: [], summary: null, coverage: 'unknown' }], [
    { ...feedPage, items: Array.from({ length: 101 }, () => feedItem) },
    { ...feedPage, target: { pageLabel: PAGE, fanRef: 'fan_two' } },
  ]),

  // ── newcomers, claim, custody ──
  fixture('ClaimGroup', C.ClaimGroupSchema, [group, { ...group, variant: 2, partCount: 10 }], [{ ...group, variant: 3 }, { ...group, partCount: 0 }, { ...group, generationRef: 'gen-1' }]),
  fixture('ClaimBody', C.ClaimBodySchema, [...Object.values(claimBodies), { ...claimBodies.dispatch, textRevision: C.CLAIM_REVISION_MAX, flagRevision: C.CLAIM_REVISION_MAX }], [
    { ...claimBodies.dispatch, partIndex: 2 },
    // 1.6.0: the hub keeps both revisions in 32-bit columns and answers 400 to a larger one.
    { ...claimBodies.dispatch, textRevision: C.CLAIM_REVISION_MAX + 1 },
    { ...claimBodies.dispatch, flagRevision: C.CLAIM_REVISION_MAX + 1 },
    { action: 'failed', attemptId: uuid(5), instanceId: INSTANCE, reason: 'native_rejected' },
    { action: 'failed', attemptId: uuid(5), instanceId: INSTANCE, reason: 'native_rejected', httpStatus: 401 },
    { action: 'failed', attemptId: uuid(5), instanceId: INSTANCE, reason: 'native_rejected', httpStatus: 503 },
    { action: 'failed', attemptId: uuid(5), instanceId: INSTANCE, reason: 'not_enqueued', httpStatus: 422 },
    { action: 'failed', attemptId: uuid(5), reason: 'not_enqueued' },
    { action: 'sent', attemptId: uuid(5), instanceId: INSTANCE, platformMessageId: '0404', evidence: 'receipt+echo' },
    { action: 'resolve', attemptId: uuid(5), outcome: 'sent' },
  ]),
  fixture('ClaimOp', C.ClaimOpSchema, [{ pageLabel: PAGE, fanRef: IDS.fan, body: claimBodies.claim }], [{ pageLabel: PAGE, fanRef: IDS.fan, body: { action: 'claim' } }]),
  fixture(
    'ClaimState',
    C.ClaimStateSchema,
    [
      claimState,
      {
        ...claimState,
        greeting: { state: 'confirmed', at: ISO, messageRef: IDS.msg2, source: 'desktop-outbox' },
        lease: { state: 'held', leaseToken: null, expiresAt: ISO_LATER, heldBy: 'someone-else' },
        custody: { attemptId: uuid(5), state: 'uncertain-held', ticket: null, ticketExpiresAt: ISO },
      },
    ],
    [
      { ...claimState, custody: { ...claimState.custody, state: 'lost' } },
      { ...claimState, lease: { ...claimState.lease, heldBy: 'chatter2' } },
    ],
  ),
  fixture('AudienceNewQuery', C.AudienceNewQuerySchema, [{ pageLabel: PAGE, windowHours: 48 }, { pageLabel: PAGE, windowHours: 720, cursor: 'c2', limit: 100 }], [
    { pageLabel: PAGE, windowHours: 721 },
  ]),
  fixture('ClaimSummary', C.ClaimSummarySchema, [claimSummary, { greeting: 'confirmed', lease: 'held', heldBy: 'you-elsewhere', custody: 'sent' }], [{ ...claimSummary, lease: 'mine' }]),
  fixture('AudienceNewItem', C.AudienceNewItemSchema, [audienceItem, { ...audienceItem, kind: 'returning', trial: true, thread: null }], [
    { ...audienceItem, fanRef: '0' },
    { ...audienceItem, claim: undefined },
  ]),
  fixture('AudienceNewPage', C.AudienceNewPageSchema, [audiencePage, { ...audiencePage, welcomeTemplate: null, items: [], nextCursor: 'c2' }], [
    { ...audiencePage, window: { ...audiencePage.window, hours: 0 } },
  ]),

  // ── ingest and AI usage ──
  fixture('IngestEvent', C.IngestEventSchema, [ingestEvent, { ...ingestEvent, kind: 'client_health', pageLabel: undefined }], [
    { ...ingestEvent, clientEventId: 'evt-1' },
    { ...ingestEvent, payload: ['shown'] },
  ]),
  fixture('IngestBatch', C.IngestBatchSchema, [{ events: [ingestEvent] }], [{ events: [] }, { events: Array.from({ length: 101 }, () => ingestEvent) }]),
  fixture('IngestResult', C.IngestResultSchema, [{ accepted: 1, duplicates: 0 }], [{ accepted: -1, duplicates: 0 }]),
  fixture('AiUsageQuery', C.AiUsageQuerySchema, [{ pageLabel: PAGE, date: '2026-10-03' }, { pageLabel: PAGE, date: '2026-10-03', days: 7, timeZone: 'UTC' }], [
    { pageLabel: PAGE, date: '2026-10-03', days: 8 },
    { date: '2026-10-03' },
  ]),
  fixture('AiUsageTotals', C.AiUsageTotalsSchema, [usageTotals], [{ ...usageTotals, tokens: { input: 1 } }]),
  fixture('AiUsageDay', C.AiUsageDaySchema, [usageDay], [{ ...usageDay, features: [usageTotals] }]),
  fixture('AiUsageReport', C.AiUsageReportSchema, [usageReport, { ...usageReport, quota: null }], [{ ...usageReport, moneyUnit: 'USD-mills' }]),
];
