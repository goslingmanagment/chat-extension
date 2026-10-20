// HTTP scenarios of the fake hub (architecture.md §8.2–§8.5; hub H-2, H-5,
// H-7, H-8, H-9, H-13): sign-in and bootstrap (all off, pilot on), the
// Spenders board of 1000 rows over five pages, statistics and «ждут ответа»,
// archive feed pages, «Новые» pages, and the claim/custody transitions
// including the uncertain send that never frees itself.

import {
  CLIENT_FEATURE_FLAG_NAMES,
  CLIENT_HUB_CAPABILITY_NAMES,
  narrowToken,
  type AudienceNewItem,
  type AudienceNewPage,
  type Bootstrap,
  type BootstrapPage,
  type ClaimBody,
  type ClaimState,
  type ClientFeatureFlag,
  type ClientHubCapability,
  type FeatureAvailability,
  type FeedItem,
  type FeedPage,
  type HubErrorBody,
  type HubErrorCode,
  type QueuePage,
  type SpenderListItem,
  type SpendersPage,
  type SpendersStats,
} from '@cg/contracts';

import { statusOf } from './reference';
import { type ErrorExpectation, type ExchangeFacts, type HttpExchange, type HttpScenario } from './types';
import { BINDING_KEY_ONE, BINDING_KEY_VIP, NOW, PAGE, WORLD, at, uuid } from './world';

const { pages, fan } = WORLD;

function hubError(error: HubErrorCode, reason?: string): { status: number; body: HubErrorBody } {
  const status = statusOf(error);
  const body: HubErrorBody = { error, message: `synthetic ${error}`, statusCode: status };
  return { status, body: reason === undefined ? body : { ...body, reason } };
}

/** An exchange the hub refuses, with what the client must make of it. */
function refused(route: HttpExchange['route'], request: unknown, error: HubErrorCode, expect: ErrorExpectation, opts: { reason?: string; facts?: ExchangeFacts; retryAfterSec?: number; note?: string } = {}): HttpExchange {
  const { status, body } = hubError(error, opts.reason);
  return {
    route,
    request,
    response: opts.retryAfterSec === undefined ? { status, body } : { status, body, retryAfterSec: opts.retryAfterSec },
    expect,
    ...(opts.facts === undefined ? {} : { facts: opts.facts }),
    ...(opts.note === undefined ? {} : { note: opts.note }),
  };
}

const ok = (route: HttpExchange['route'], request: unknown, body: unknown, note?: string): HttpExchange =>
  note === undefined ? { route, request, response: { status: 200, body } } : { route, request, response: { status: 200, body }, note };

// ── bootstrap ──────────────────────────────────────────────────────────────

const LIMITS = {
  freshTextMaxItems: 60,
  freshTextMaxChars: 5000,
  feedMax: 100,
  deepMax: 3000,
  audienceWindowHours: 720,
  claimLeaseSec: 120,
  claimRenewSec: 40,
  claimActivityWindowSec: 120,
  previewSendPerMinute: 30,
  navInsertTimeoutSec: 20,
  dispatchTicketSec: 10,
  previewSendReceiptProfiles: [],
} as const satisfies Bootstrap['limits'];

// ── the hub's switches: their names, and what each needs by platform ──────

/** A platform the hub's table names. */
export type HubPlatform = 'onlyfans' | 'fansly';

/** What a flag needs on one platform (hub `ClientFeaturePlatformRequirement`). */
export interface HubFeatureNeeds {
  /** Capabilities the hub must serve; without one the page's feature reads `hub_not_ready`. */
  readonly capabilities: readonly ClientHubCapability[];
  /** The hub lane the feature runs on there (R20 HF-4б): the bootstrap reads `lane_off` where that lane does not serve the page. */
  readonly lane?: 'voice-notes';
}

const NOTHING: HubFeatureNeeds = { capabilities: [] };

/**
 * The hub's `CLIENT_FEATURE_REQUIREMENTS` (hub apps/runtime/src/services/client-features.ts at SDK bd3eec06;
 * HF-15 master-first admission deployed at 29708c44d010): per flag, one entry per platform the feature exists on, with what it
 * needs there. A platform with no entry has no such feature (`platform_unsupported`). R20 HF-2 made it per platform:
 * on Fansly Recap and the preview read by conversation (`conversation-recaps-v1`), «Новые» are the greeting custody
 * with the manual group and not the hub's list of new subscribers, and Fansly has its own `drafts`, `voice`,
 * `notesFill`, `notes`, `vault` and `registration`; it has no X8 send, ChatSpace navigation, socket tap or Spenders
 * statistics. It is the HUB's rule: the client does not carry this table (R20 F4). A hub rule that changes is
 * changed here.
 */
export const HUB_FEATURE_REQUIREMENTS: Readonly<Record<ClientFeatureFlag, Readonly<Partial<Record<HubPlatform, HubFeatureNeeds>>>>> = {
  insertion: { onlyfans: NOTHING, fansly: NOTHING },
  navigation: { onlyfans: NOTHING },
  wsTap: { onlyfans: NOTHING },
  sound: { onlyfans: NOTHING, fansly: NOTHING },
  fanPanel: { onlyfans: NOTHING, fansly: NOTHING },
  previewSendMarkAiGenerated: { onlyfans: NOTHING },
  spenders: { onlyfans: NOTHING, fansly: NOTHING },
  review: { onlyfans: NOTHING, fansly: NOTHING },
  coach: { onlyfans: NOTHING, fansly: NOTHING },
  freshText: { onlyfans: { capabilities: ['live-text-v1'] }, fansly: { capabilities: ['live-text-v1'] } },
  splitAll: { onlyfans: { capabilities: ['split-all-v1'] }, fansly: { capabilities: ['split-all-v1'] } },
  recap: {
    onlyfans: { capabilities: ['shared-recaps-v1', 'recap-profile-v1'] },
    fansly: { capabilities: ['shared-recaps-v1', 'recap-profile-v1', 'conversation-recaps-v1'] },
  },
  preview: { onlyfans: { capabilities: ['archive-feed-v1'] }, fansly: { capabilities: ['archive-feed-v1', 'conversation-recaps-v1'] } },
  stats: { onlyfans: { capabilities: ['spenders-stats-v1', 'awaiting-reply-v1'] } },
  newcomers: {
    onlyfans: { capabilities: ['audience-new-v1', 'preview-send-custody-v1', 'manual-greeting-v1'] },
    fansly: { capabilities: ['preview-send-custody-v1', 'manual-greeting-v1'] },
  },
  previewSend: { onlyfans: { capabilities: ['preview-send-custody-v1', 'manual-greeting-v1'] } },
  drafts: { fansly: NOTHING },
  voice: { fansly: { capabilities: ['voice-notes-v1'], lane: 'voice-notes' } },
  notesFill: { fansly: NOTHING },
  notes: { fansly: NOTHING },
  vault: { fansly: NOTHING },
  registration: { fansly: NOTHING },
};

/**
 * What a flag needs on a platform; undefined where the feature does not exist there. A flag the hub does not know
 * (a test's future flag) is an OnlyFans flag that needs nothing, as the fake hub always served it.
 */
export function hubFeatureNeedsOn(flag: string, platform: string): HubFeatureNeeds | undefined {
  const known = narrowToken(CLIENT_FEATURE_FLAG_NAMES, flag);
  const needs: Readonly<Partial<Record<string, HubFeatureNeeds>>> = known === null ? { onlyfans: NOTHING } : HUB_FEATURE_REQUIREMENTS[known];
  return Object.hasOwn(needs, platform) ? needs[platform] : undefined;
}

/** The platforms whose pages take the owner's `"*"` row (hub `clientStarRowReaches`, R20 HF-2): a Fansly page is switched by its own row alone. */
export const STAR_ROW_PLATFORMS: readonly string[] = ['onlyfans'];

/** A page's features: every contract flag that exists on its platform reads `feature(flag)`, every other `platform_unsupported`. */
const featuresOn = (platform: HubPlatform, feature: (flag: ClientFeatureFlag) => FeatureAvailability): BootstrapPage['features'] =>
  Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, HUB_FEATURE_REQUIREMENTS[flag][platform] === undefined ? { available: false, reason: 'platform_unsupported' } : feature(flag)]));
const allFeatures = (platform: HubPlatform, reason: string): BootstrapPage['features'] => reason === 'disabled'
  ? Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: false, reason }]))
  : featuresOn(platform, () => ({ available: false, reason }));

const ofPage = (page: typeof pages.one | typeof pages.vip, features: BootstrapPage['features']): BootstrapPage => ({
  pageId: page.pageId,
  pageLabel: page.pageLabel,
  title: page.title,
  platform: 'onlyfans',
  platformAccountId: page.platformAccountId,
  bindingRevision: page.bindingRevision,
  features,
});
/**
 * The Fansly page as the hub answers it: every flag Fansly has reads `reason` — `flag_off` while the page has no row
 * of its own (R20 HF-2: the owner's `"*"` row never reaches a Fansly page; production has no Fansly row yet),
 * `disabled` for every flag under the master switch (HF-15); otherwise foreign flags are `platform_unsupported`.
 */
const fanslyPage = (reason: string): BootstrapPage => ({
  pageId: pages.fansly.pageId,
  pageLabel: pages.fansly.pageLabel,
  title: pages.fansly.title,
  platform: 'fansly',
  platformAccountId: pages.fansly.platformAccountId,
  bindingRevision: pages.fansly.bindingRevision,
  features: allFeatures('fansly', reason),
});

/** Master switch off (HF-15): every feature `disabled`, every flag false, no capabilities. */
export const BOOTSTRAP_ALL_OFF: Bootstrap = {
  protocol: 1,
  issuedAt: NOW,
  ttlSec: 300,
  configRevision: 0,
  minVersion: '0.0.0',
  identity: { userId: WORLD.user.userId, username: WORLD.user.username, role: 'chatter', tokenClient: 'chat-extension' },
  pages: [ofPage(pages.one, allFeatures('onlyfans', 'disabled')), ofPage(pages.vip, allFeatures('onlyfans', 'disabled')), fanslyPage('disabled')],
  bindingsByHost: {},
  flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, false])),
  limits: { ...LIMITS, deepMax: 1500 },
  capabilities: [],
};

/** Pilot flags: everything but X8 send and its AI mark (previewSend waits for its gates, §6.7.13). */
export const PILOT_FLAGS_OFF: readonly ClientFeatureFlag[] = ['previewSend', 'previewSendMarkAiGenerated'];
/** The pilot's switches of the OnlyFans pages: every flag OnlyFans has but X8's two. */
export const PILOT_FLAGS_ON: readonly ClientFeatureFlag[] = CLIENT_FEATURE_FLAG_NAMES.filter((flag) => HUB_FEATURE_REQUIREMENTS[flag].onlyfans !== undefined && !PILOT_FLAGS_OFF.includes(flag));
const pilotFlags = Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, PILOT_FLAGS_ON.includes(flag)]));
const pilotFeatures = featuresOn('onlyfans', (flag) => (PILOT_FLAGS_ON.includes(flag) ? { available: true } : { available: false, reason: 'flag_off' }));

/**
 * Pilot on both OF pages through the `"*"` row, explicit host bindings, every capability but client-health (B′ ingest
 * still off) and the open chat's PPV state (X54, `live-ppv-v1`: not deployed yet; a test that proves it adds it). The
 * Fansly page reads `flag_off`: the `"*"` row never reaches it (R20 HF-2).
 */
export const BOOTSTRAP_PILOT_ON: Bootstrap = {
  ...BOOTSTRAP_ALL_OFF,
  configRevision: WORLD.configRevision,
  minVersion: '0.1.0',
  pages: [ofPage(pages.one, pilotFeatures), ofPage(pages.vip, pilotFeatures), fanslyPage('flag_off')],
  bindingsByHost: { [BINDING_KEY_ONE]: pages.one.pageId, [BINDING_KEY_VIP]: pages.vip.pageId },
  flags: pilotFlags,
  limits: LIMITS,
  capabilities: CLIENT_HUB_CAPABILITY_NAMES.filter((capability) => capability !== 'client-health-perf-v1' && capability !== 'live-ppv-v1'),
};

/**
 * The pilot as the owner really switches it on: `chatExtensionFeatures["*"]` is empty and each pilot page has
 * its own row. The hub then answers the same page features as BOOTSTRAP_PILOT_ON and every top-level flag
 * false (`clientBootstrapFlags` reads the `"*"` row alone). A client that gates on `bootstrap.flags` shows
 * everything «выключено владельцем» here; the page's own `features` are the truth.
 */
export const BOOTSTRAP_PILOT_PAGES: Bootstrap = {
  ...BOOTSTRAP_PILOT_ON,
  flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, false])),
};

/**
 * The OnlyFans column of the hub's table (`HUB_FEATURE_REQUIREMENTS[flag].onlyfans.capabilities`; the same as at
 * 6ee3d627, before R20 HF-2 made the table per platform): what the hub must serve before it offers a flag on an
 * OnlyFans page; without it the page's feature reads `hub_not_ready`. A switch it does not name (Fansly's own) does
 * not exist on OnlyFans: `platform_unsupported` there. It is the HUB's rule — the client does not
 * carry this table (R20 F4: it reads the page's feature, and only its own transport needs on top,
 * `CLIENT_FLAG_REQUIREMENTS`). Fresh text needs `live-text-v1` here: `context-v1` is the client's own need (a
 * request header), not the hub's.
 */
export const HUB_FEATURE_CAPABILITIES: Readonly<Partial<Record<ClientFeatureFlag, readonly ClientHubCapability[]>>> = Object.fromEntries(
  CLIENT_FEATURE_FLAG_NAMES.flatMap((flag) => {
    const needs = HUB_FEATURE_REQUIREMENTS[flag].onlyfans;
    return needs === undefined ? [] : [[flag, needs.capabilities]];
  }),
);

/** The switch exists on an OnlyFans page (the column names it); a name the hub's table does not know is let through, as the fake hub always served it. */
export function existsOnOnlyFans(flag: string): boolean {
  return hubFeatureNeedsOn(flag, 'onlyfans') !== undefined;
}

/**
 * The same sign-in on a hub that serves only `capabilities` (a hub older than the SDK, a production that lags
 * `main`): the bootstrap as THAT hub computes it — it declares these capabilities, and every page feature that
 * needs one it does not serve reads `hub_not_ready`. The hub never offers a feature it cannot serve, so a bootstrap
 * whose `capabilities` were cut by hand while its pages still say «available» is not one a hub answers with.
 */
export function hubServing(bootstrap: Bootstrap, capabilities: readonly string[]): Bootstrap {
  // What the flag needs on the page's own platform (R20 HF-2: the table is per platform).
  const served = (flag: string, platform: string): boolean => (hubFeatureNeedsOn(flag, platform)?.capabilities ?? []).every((capability) => capabilities.includes(capability));
  return {
    ...bootstrap,
    capabilities: [...capabilities],
    pages: bootstrap.pages.map((page) => ({
      ...page,
      features: Object.fromEntries(
        Object.entries(page.features).map(([flag, feature]) => [flag, feature.available && !served(flag, page.platform) ? { available: false, reason: 'hub_not_ready' } : feature]),
      ),
    })),
  };
}

/**
 * A bootstrap in which the hub answers these features of its OnlyFans pages (all of them, or the ones named)
 * as unavailable, with a reason — what an owner's page row, the master switch or a hub that is not ready looks
 * like to the client. The top-level `flags` are left as they are: they do not decide what a page may do.
 */
export function pageFeaturesOff(
  bootstrap: Bootstrap,
  flags: readonly ClientFeatureFlag[],
  options: { readonly reason?: string; readonly pageIds?: readonly number[] } = {},
): Bootstrap {
  const reason = options.reason ?? 'flag_off';
  return {
    ...bootstrap,
    pages: bootstrap.pages.map((page) =>
      page.platform !== 'onlyfans' || (options.pageIds !== undefined && !options.pageIds.includes(page.pageId))
        ? page
        : { ...page, features: { ...page.features, ...Object.fromEntries(flags.map((flag) => [flag, { available: false, reason }])) } },
    ),
  };
}

const healthBody = {
  status: 'ok',
  timestamp: NOW,
  contractHash: '1'.repeat(64),
  capabilities: ['desktop-lifecycle-v2'],
  checks: { api: { status: 'ok' }, database: { status: 'ok', latencyMs: 2, error: null } },
  compatibleClientSdks: ['1'.repeat(64), '2'.repeat(64)],
};
const authState = {
  authMethod: 'device_token',
  user: {
    id: WORLD.user.userId,
    username: WORLD.user.username,
    role: 'chatter',
    mustChangePassword: false,
    assignedPages: [{ id: pages.one.pageId, label: pages.one.pageLabel, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One' }],
  },
};
// The extension's own sign-in body: its device label names the extension, not a site (AU-005, R20 F9b).
const signIn = { username: WORLD.user.username, password: 'synthetic-password', label: 'Firefox · macOS · ChatGoose', mode: 'active', client: 'chat-extension' };

// ── Spenders board: 1240 payers, five pages of 200 = the 1000-row cap ──────

export const BOARD_TOTAL = 1240;
const scope = { kind: 'page', platform: 'onlyfans', pageCount: 1, page: { id: pages.one.pageId, label: PAGE, platform: 'onlyfans', modelSlug: 'model-one', modelName: 'Model One' }, model: null } as const;
const period = { timeZone: 'Europe/Moscow', fromBusinessDate: '2026-09-04', toBusinessDateInclusive: '2026-10-03', asOf: NOW };
const diagnostics = {
  totalGrossAmountMills: 98_765_000,
  totalCreatorNetAmountMills: 79_012_000,
  attributedGrossAmountMills: 98_000_000,
  attributedCreatorNetAmountMills: 78_400_000,
  unattributedGrossAmountMills: 765_000,
  unattributedCreatorNetAmountMills: 612_000,
};

/** Rank 0 spends most; fan ids are synthetic 4-digit numbers. */
export function spenderRow(rank: number): SpenderListItem {
  const units = BOARD_TOTAL - rank;
  const gross = units * 1_000;
  const net = units * 800;
  return {
    fan: { platform: 'onlyfans', platformUserId: String(5000 + rank), username: `fan_${rank}`, displayName: rank % 3 === 0 ? null : `Fan ${rank}`, createdAtExternal: null, pageAlias: null },
    metrics: {
      window: {
        grossAmountMills: gross,
        creatorNetAmountMills: net,
        postedGrossAmountMills: gross,
        pendingGrossAmountMills: 0,
        unknownGrossAmountMills: 0,
        postedCreatorNetAmountMills: net,
        pendingCreatorNetAmountMills: 0,
        unknownCreatorNetAmountMills: 0,
        transactionCount: 1 + (rank % 7),
        lastTransactionAt: at(-3600 * (rank % 48)),
      },
      lifetime: { scopeGrossAmountMills: gross * 3, scopeCreatorNetAmountMills: net * 3, platformGrossAmountMills: gross * 3, platformCreatorNetAmountMills: net * 3 },
      comparison: null,
    },
    lifetimeLastTransactionAt: at(-3600 * (rank % 48)),
    lastFanMessageAt: rank % 5 === 0 ? null : at(-86_400 * (rank % 30)),
    conversation: {
      platformConversationId: String(5000 + rank),
      unreadCount: rank % 4,
      lastMessageAt: at(-3600),
      lastFanMessageAt: rank % 5 === 0 ? null : at(-86_400 * (rank % 30)),
      lastModelMessageAt: at(-3600),
      lastMessagePreview: null,
      storedMessageCount: 10 + rank,
      messageCoverageStatus: rank % 10 === 0 ? 'partial_window' : 'complete',
      messageBackfillComplete: rank % 10 !== 0,
    },
    lastTransaction: { canonicalType: rank % 2 === 0 ? 'tip' : 'message_purchase', transactionState: 'posted', grossAmountMills: 5_000, creatorNetAmountMills: 4_000, occurredAt: at(-3600) },
    retentionStatus: rank % 9 === 0 ? 'cooling' : 'active',
  };
}

const boardPage = (offset: number): SpendersPage => ({
  scope,
  period,
  diagnostics,
  items: Array.from({ length: 200 }, (_, i) => spenderRow(offset + i)),
  limit: 200,
  offset,
  total: BOARD_TOTAL,
});

const stats: SpendersStats = {
  pageLabel: PAGE,
  metricVersion: 1,
  moneyUnit: 'USD-mills',
  basis: 'gross',
  timeZone: 'Europe/Moscow',
  from: '2026-09-04',
  to: '2026-10-03',
  asOf: NOW,
  projectionAsOf: at(-120),
  includedStates: ['posted', 'pending', 'unknown'],
  coverage: { state: 'complete', reasons: [] },
  days: Array.from({ length: 30 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 8, 4 + i)).toISOString().slice(0, 10);
    return { date, grossMills: 3_000_000 + i * 10_000, purchasesGrossMills: 3_050_000 + i * 10_000, adjustmentsMills: -50_000, creatorNetMills: 2_400_000 + i * 8_000, purchaseCount: 40 + i, byState: { posted: 3_000_000 + i * 10_000 } };
  }),
  totals: {
    today: { grossMills: 3_290_000, purchasesGrossMills: 3_340_000, adjustmentsMills: -50_000, creatorNetMills: 2_632_000, purchaseCount: 69, payerCount: 41 },
    d7: { grossMills: 22_820_000, purchasesGrossMills: 23_170_000, adjustmentsMills: -350_000, creatorNetMills: 18_256_000, purchaseCount: 462, payerCount: 180 },
    prev7: { grossMills: 22_330_000, purchasesGrossMills: 22_680_000, adjustmentsMills: -350_000, creatorNetMills: 17_864_000, purchaseCount: 413, payerCount: 171 },
    d30: { grossMills: 94_350_000, purchasesGrossMills: 95_850_000, adjustmentsMills: -1_500_000, creatorNetMills: 75_480_000, purchaseCount: 1635, payerCount: 640 },
    d7DeltaPct: 2.19,
  },
  avgCheckMills: 58_623,
  // As the hub sends them: the tiers ascending, then its two remainder tiers — both without bounds.
  tiers: [
    { key: '0-25', label: '$0–25', minMills: 10, maxMills: 25_000, members: 1100, windowPayers: 500, windowGrossMills: 53_100_000 },
    { key: '600-plus', label: '$600+', minMills: 600_000, maxMills: null, members: 31, windowPayers: 28, windowGrossMills: 40_000_000 },
    { key: 'untiered', label: 'Без тира', minMills: null, maxMills: null, members: 109, windowPayers: 112, windowGrossMills: 0 },
    { key: 'unattributed', label: 'Не распределено', minMills: null, maxMills: null, members: 0, windowPayers: 0, windowGrossMills: 1_250_000 },
  ],
  silence: { d8to21: { fans: 120, lifetimeGrossMills: 9_000_000 }, over21: { fans: 300, lifetimeGrossMills: 15_000_000 }, unknown: { fans: 12, lifetimeGrossMills: 400_000 } },
  newPayers: { count: 57, firstPurchaseKnown: true },
  queueSummary: { total: 3, unknown: 1 },
};

const queuePage = (n: number, cursor: string | null): QueuePage => ({
  items: Array.from({ length: n }, (_, i) => ({
    fanRef: String(5000 + i * 3),
    username: `fan_${i * 3}`,
    displayName: null,
    lifetimeGrossMills: (BOARD_TOTAL - i * 3) * 3_000,
    lastFanMessageAt: at(-3600 * (i + 1)),
    lastModelMessageAt: at(-86_400),
    unreadCount: i === 0 ? null : 1,
    readState: i === 0 ? 'unknown' : 'unread',
  })),
  total: 3,
  loaded: cursor === null ? 3 : 2,
  unknown: 1,
  nextCursor: cursor,
  asOf: NOW,
});

// ── archive feed: 112 messages, pages of 50 ────────────────────────────────

const feedItem = (n: number): FeedItem => {
  const fromFan = n % 2 === 0;
  return {
    messageId: String(6000 + n),
    at: at(-600 * n),
    sender: fromFan ? 'fan' : 'model',
    text: n % 11 === 0 ? '' : fromFan ? `fan message ${n}` : `model message ${n}`,
    automatic: null,
    deleted: n === 7,
    tipMills: n % 13 === 0 ? 10_000 : null,
    priceMills: !fromFan && n % 11 === 0 ? 15_000 : null,
    attachmentLabels: n % 11 === 0 ? ['[Photo]'] : [],
  };
};
const FEED_TOTAL = 112;
const feedPage = (from: number, cursor: string | null, first: boolean): FeedPage => ({
  target: { pageLabel: PAGE, fanRef: fan },
  source: 'union',
  snapshotRevision: 'snap-0042',
  asOf: NOW,
  coverage: 'complete',
  head: { messageRef: '6000', at: at(0), sender: 'fan' },
  newestKnownAt: at(0),
  nextOlderCursor: cursor,
  items: Array.from({ length: Math.min(50, FEED_TOTAL - from) }, (_, i) => feedItem(from + i)),
  summary: first ? { pingSegment: 'active', fanSilenceDays: 0, window: { requested: 100, served: 100 }, coverage: 'complete', asOf: NOW } : null,
});

// ── «Новые» ────────────────────────────────────────────────────────────────

const noClaim = { greeting: 'none', lease: 'none', heldBy: null, custody: null } as const;
const audienceItem = (n: number, over: Partial<AudienceNewItem> = {}): AudienceNewItem => ({
  eventRef: `evt-${1000 + n}`,
  fanRef: String(Number(WORLD.newFan) + n),
  username: `newfan_${n}`,
  displayName: null,
  kind: 'new',
  trial: false,
  subscribedAt: at(-3600 * (n + 1)),
  subscribedAtSource: 'notification',
  status: { isSubscriber: true, subscriptionStatus: 'active', endsAt: at(86_400 * 30), asOf: at(-60), source: 'webhook' },
  thread: { lastMessageAt: at(-3600 * (n + 1)), lastFanMessageAt: null, lastModelMessageAt: at(-3600 * (n + 1)), storedMessageCount: 1, coverage: 'complete', backfillComplete: true },
  claim: noClaim,
  ...over,
});
const audiencePage = (items: AudienceNewItem[], nextCursor: string | null): AudienceNewPage => ({
  pageLabel: PAGE,
  window: { hours: 48, from: at(-48 * 3600), to: NOW, snapshotAt: NOW },
  serverNow: NOW,
  coverage: { state: 'partial', deliveryFrontier: at(-90), lastAudienceSweepAt: null, reasons: ['audience_sweep_pending'] },
  unknownCount: 1,
  welcomeTemplate: { ref: 'welcome-1', observedAt: at(-86_400), enabled: true, hasText: true, hasMedia: false, priceMills: null },
  items,
  nextCursor,
});

// ── claim and custody ──────────────────────────────────────────────────────

const GEN = uuid(0x200);
const LEASE = uuid(0x300);
const ATTEMPT = { a: uuid(0x401), b: uuid(0x402), c: uuid(0x403), d: uuid(0x404), e: uuid(0x405), f: uuid(0x406), native: uuid(0x407) };
const claimParams = { pageLabel: PAGE, fanRef: WORLD.newFan };
const op = (body: ClaimBody) => ({ ...claimParams, body });
const lease = (action: 'claim' | 'renew' | 'release'): ClaimBody => ({ action, leaseToken: LEASE, instanceId: WORLD.instanceId });
const dispatch = (attemptId: string, partIndex: number, purpose: 'greeting' | 'preview-reply' = 'greeting', generationRef = GEN): ClaimBody => ({
  action: 'dispatch',
  attemptId,
  instanceId: WORLD.instanceId,
  purpose,
  group: { generationRef, variant: 0, partCount: 2 },
  partIndex,
  textRevision: 1,
  ...(purpose === 'greeting' ? { leaseToken: LEASE } : {}),
  flagRevision: WORLD.configRevision,
});
const sent = (attemptId: string, platformMessageId: string): ClaimBody => ({ action: 'sent', attemptId, instanceId: WORLD.instanceId, platformMessageId, evidence: 'receipt+echo' });

const state = (over: Partial<ClaimState>): ClaimState => ({
  greeting: { state: 'none', at: null, messageRef: null, source: null },
  lease: { state: 'none', leaseToken: null, expiresAt: null, heldBy: null },
  group: null,
  custody: null,
  serverNow: NOW,
  flagRevision: WORLD.configRevision,
  ...over,
});
const owned = { state: 'owned', leaseToken: LEASE, expiresAt: at(120), heldBy: null } as const;
const group = (sentParts: number[], heldParts: number[] = []) => ({ generationRef: GEN, variant: 0, partCount: 2, sentParts, heldParts });
const custody = (attemptId: string, s: NonNullable<ClaimState['custody']>['state'], ticket: string | null = null) => ({
  attemptId,
  state: s,
  ticket,
  ticketExpiresAt: ticket === null ? null : at(10),
});
const greeted = (messageRef: string, source: string) => ({ state: 'confirmed', at: at(5), messageRef, source }) as const;

/** The hub's tier buckets (`pageSpenderAutoLists`): the board's shelves. */
const tierBuckets = {
  page: scope.page,
  currency: 'USD',
  metric: 'lifetimeGrossAmountMills',
  period,
  asOf: NOW,
  totalEntries: 1131,
  lists: [
    { key: '0-25', label: '$0–25', minAmountMills: 10, maxAmountMillsExclusive: 25_000, entryCount: 1100 },
    { key: '600-plus', label: '$600+', minAmountMills: 600_000, maxAmountMillsExclusive: null, entryCount: 31 },
  ],
} as const;

export const HTTP_SCENARIOS: readonly HttpScenario[] = [
  {
    name: 'sign-in-and-bootstrap-all-off',
    description: 'Wrong password, rate limit, then a narrow token (client echo); bootstrap with the master switch off; later the token is revoked.',
    exchanges: [
      refused('authIssueDeviceTokenWithPassword', { ...signIn, password: 'wrong' }, 'unauthorized', { cg: 'CG-LOGIN-CREDENTIALS', disposition: 'show' }),
      refused('authIssueDeviceTokenWithPassword', signIn, 'rate_limit_exceeded', { cg: 'CG-LOGIN-RATE-LIMIT', disposition: 'show' }, { retryAfterSec: 60 }),
      ok('authIssueDeviceTokenWithPassword', signIn, {
        mode: 'active',
        token: 'cgx_synthetic_token_0001',
        id: 41,
        label: signIn.label,
        keyPrefix: 'cgx_synt',
        expiresAt: at(90 * 86_400),
        client: 'chat-extension',
      }),
      ok('health', null, healthBody),
      ok('me', null, authState),
      ok('clientBootstrap', null, BOOTSTRAP_ALL_OFF, 'every feature disabled: the dock shows CG-FEATURE-DISABLED, nothing calls a client route'),
      ok('aiPersonaCatalog', null, { personas: [{ key: WORLD.persona.key, displayName: 'Default', version: 3, definitionId: WORLD.persona.definitionId, status: 'active' }] }),
      refused('me', null, 'unauthorized', { cg: null, disposition: 'ignore' }, { reason: 'token_expired', facts: { currentSignIn: false }, note: 'an answer to the previous sign-in' }),
      refused('me', null, 'unauthorized', { cg: 'CG-AUTH-REVOKED', disposition: 'clear-sign-in' }, { reason: 'token_revoked' }),
    ],
  },
  {
    name: 'bootstrap-pilot-on',
    description: 'Pilot flags on both OF pages, explicit host bindings, capabilities declared; the Fansly page reads flag_off (no row of its own; the `*` row never reaches it, R20 HF-2).',
    exchanges: [ok('clientBootstrap', null, BOOTSTRAP_PILOT_ON)],
  },
  {
    name: 'bootstrap-pilot-pages',
    description:
      'The pilot switched on page by page, the `"*"` row empty: every top-level flag is false while the features of both OF pages are available. The client reads the page, never the top-level flags.',
    exchanges: [ok('clientBootstrap', null, BOOTSTRAP_PILOT_PAGES)],
  },
  {
    name: 'spenders-board-1000',
    description: '1240 payers: five pages of 200 (offsets 0…800) fill the 1000-row cap; the board says the scope has more. The shelves are the tier buckets read with it.',
    exchanges: [
      ...[0, 200, 400, 600, 800].map((offset) => ok('spenders', { scope: 'page', pageLabel: PAGE, period: '30d', limit: 200, offset }, boardPage(offset))),
      ok('pageSpenderAutoLists', { pageLabel: PAGE }, tierBuckets),
    ],
  },
  {
    name: 'spenders-stats-and-queue',
    description: 'H-8b statistics (30 days, Moscow) and the «ждут ответа» queue over two cursor pages; tier buckets.',
    exchanges: [
      ok('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' }, stats),
      ok('clientSpenderAwaitingReply', { pageLabel: PAGE, limit: 2 }, { ...queuePage(2, 'queue-2'), total: 3 }),
      ok('clientSpenderAwaitingReply', { pageLabel: PAGE, cursor: 'queue-2', limit: 2 }, { ...queuePage(1, null), items: queuePage(3, null).items.slice(2) }),
      ok('pageSpenderAutoLists', { pageLabel: PAGE }, tierBuckets),
      refused('clientSpenderStats', { pageLabel: pages.vip.pageLabel, windowDays: 30, timeZone: 'Europe/Moscow' }, 'client_feature_disabled', { cg: 'CG-FEATURE-DISABLED', disposition: 'refresh-bootstrap' }, { reason: 'flag_off' }),
    ],
  },
  {
    name: 'feed-pages',
    description: 'Archive feed of one fan: three pages (50 + 50 + 12) newest → oldest, summary on the first only; a forged cursor restarts from the first page.',
    exchanges: [
      ok('clientConversationFeed', { pageLabel: PAGE, fanRef: fan, limit: 50 }, feedPage(0, 'feed-2', true)),
      ok('clientConversationFeed', { pageLabel: PAGE, fanRef: fan, cursor: 'feed-2', limit: 50 }, feedPage(50, 'feed-3', false)),
      ok('clientConversationFeed', { pageLabel: PAGE, fanRef: fan, cursor: 'feed-3', limit: 50 }, feedPage(100, null, false)),
      refused('clientConversationFeed', { pageLabel: PAGE, fanRef: fan, cursor: 'forged', limit: 50 }, 'bad_request', { cg: 'CG-HUB-REQUEST', disposition: 'restart-cursor' }, { reason: 'cursor_invalid' }),
      ok('clientConversationFeed', { pageLabel: PAGE, fanRef: fan, limit: 50 }, feedPage(0, 'feed-2', true), 'the restart'),
    ],
  },
  {
    name: 'audience-new',
    description: '«Новые» over 48 h: new, trial and returning subscribers, a fan another chatter holds, one the desktop already greeted; a changed window with the old cursor is refused.',
    exchanges: [
      ok(
        'clientAudienceNew',
        { pageLabel: PAGE, windowHours: 48, limit: 3 },
        audiencePage([audienceItem(0), audienceItem(1, { trial: true }), audienceItem(2, { kind: 'returning', subscribedAtSource: 'subscribeAt' })], 'aud-2'),
      ),
      ok(
        'clientAudienceNew',
        { pageLabel: PAGE, windowHours: 48, cursor: 'aud-2', limit: 3 },
        audiencePage(
          [
            audienceItem(3, { claim: { greeting: 'none', lease: 'held', heldBy: 'someone-else', custody: null } }),
            audienceItem(4, { claim: { greeting: 'confirmed', lease: 'none', heldBy: null, custody: null } }),
          ],
          null,
        ),
      ),
      refused('clientAudienceNew', { pageLabel: PAGE, windowHours: 72, cursor: 'aud-2', limit: 3 }, 'bad_request', { cg: 'CG-HUB-REQUEST', disposition: 'restart-cursor' }, { reason: 'cursor_window_mismatch' }),
    ],
  },
  {
    name: 'claim-greeting-two-parts',
    description: 'Lease → dispatch part 0 (ticket) → sent (greeting confirmed) → part 1 → sent → release; a repeated dispatch only reads.',
    exchanges: [
      ok('clientFanClaimStatus', claimParams, state({})),
      ok('clientFanClaim', op(lease('claim')), state({ lease: owned })),
      ok('clientFanClaim', op(lease('renew')), state({ lease: { ...owned, expiresAt: at(160) } })),
      ok('clientFanClaim', op(dispatch(ATTEMPT.a, 0)), state({ lease: owned, group: group([]), custody: custody(ATTEMPT.a, 'dispatching', 'tkt-once-a') })),
      ok('clientFanClaim', op(sent(ATTEMPT.a, WORLD.messages.sentByUs)), state({ greeting: greeted(WORLD.messages.sentByUs, 'preview-send'), lease: owned, group: group([0]), custody: custody(ATTEMPT.a, 'sent') })),
      ok('clientFanClaim', op(dispatch(ATTEMPT.b, 1)), state({ greeting: greeted(WORLD.messages.sentByUs, 'preview-send'), lease: owned, group: group([0]), custody: custody(ATTEMPT.b, 'dispatching', 'tkt-once-b') })),
      ok('clientFanClaim', op(sent(ATTEMPT.b, WORLD.messages.sentPart2)), state({ greeting: greeted(WORLD.messages.sentByUs, 'preview-send'), lease: owned, group: group([0, 1]), custody: custody(ATTEMPT.b, 'sent') })),
      ok('clientFanClaim', op(dispatch(ATTEMPT.b, 1)), state({ greeting: greeted(WORLD.messages.sentByUs, 'preview-send'), lease: owned, group: group([0, 1]), custody: custody(ATTEMPT.b, 'sent') }), 'same attemptId: read only, no new ticket'),
      ok('clientFanClaim', op(lease('release')), state({ greeting: greeted(WORLD.messages.sentByUs, 'preview-send'), lease: { state: 'released', leaseToken: null, expiresAt: null, heldBy: null }, group: group([0, 1]) })),
    ],
  },
  {
    name: 'claim-uncertain-held',
    description: 'Dispatch, then nothing proven: past the ticket the custody reads uncertain-held, and the person\'s new click of the part is dispatched — the unknown send holds nothing any more (audit 2026-10-20, row 2).',
    exchanges: [
      ok('clientFanClaim', op(lease('claim')), state({ lease: owned })),
      ok('clientFanClaim', op(dispatch(ATTEMPT.c, 0)), state({ lease: owned, group: group([]), custody: custody(ATTEMPT.c, 'dispatching', 'tkt-once-c') })),
      ok('clientFanClaim', op(dispatch(ATTEMPT.d, 0)), state({ lease: owned, group: group([]), custody: custody(ATTEMPT.d, 'dispatching', 'tkt-once-d') }), 'the person sends the part again'),
    ],
  },
  {
    name: 'claim-refusals',
    description: 'Every refusal of the claim route and what the client makes of it.',
    exchanges: [
      refused('clientFanClaim', op(lease('claim')), 'claim_busy', { cg: 'CG-CLAIM-BUSY', disposition: 'show' }),
      ok('clientFanClaimStatus', claimParams, state({ lease: { state: 'held', leaseToken: null, expiresAt: at(90), heldBy: 'someone-else' } })),
      refused('clientFanClaim', op(lease('renew')), 'claim_expired', { cg: 'CG-CLAIM-EXPIRED', disposition: 'show' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 0)), 'greeting_done', { cg: 'CG-CLAIM-BUSY', disposition: 'show' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 0)), 'client_feature_disabled', { cg: 'CG-SEND-OFF', disposition: 'refresh-bootstrap' }, { reason: 'flag_off' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 0)), 'preview_send_rate_limited', { cg: 'CG-HUB-RATE-LIMIT', disposition: 'show' }, { retryAfterSec: 20 }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 0, 'greeting', uuid(0x201))), 'generation_mismatch', { cg: 'CG-CONTEXT-CHANGED', disposition: 'show' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 1)), 'part_already_sent', { cg: 'CG-SEND-PART', disposition: 'read-status' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.a, 0)), 'attempt_conflict', { cg: 'CG-HUB-REQUEST', disposition: 'show' }),
      refused('clientFanClaim', op(sent(ATTEMPT.f, WORLD.messages.sentByUs)), 'custody_not_owned', { cg: 'CG-HUB-REQUEST', disposition: 'show' }),
      refused('clientFanClaim', op(dispatch(ATTEMPT.e, 0)), 'service_unavailable', { cg: 'CG-HUB-UNAVAILABLE', disposition: 'show' }, { note: 'never retried for a send' }),
      refused('clientFanClaimStatus', { pageLabel: 'not-my-page', fanRef: fan }, 'not_found', { cg: 'CG-BINDING-NOT-GRANTED', disposition: 'show' }, { facts: { pageGranted: false } }),
    ],
  },
  {
    name: 'preview-reply-rejected-then-sent',
    description: 'Spenders preview reply (no lease): ChatSpace refused it natively (422, proof of non-acceptance) → failed; a new attempt goes through.',
    exchanges: [
      ok('clientFanClaim', { pageLabel: PAGE, fanRef: fan, body: dispatch(ATTEMPT.e, 0, 'preview-reply') }, state({ group: group([]), custody: custody(ATTEMPT.e, 'dispatching', 'tkt-once-e') })),
      ok('clientFanClaim', { pageLabel: PAGE, fanRef: fan, body: { action: 'failed', attemptId: ATTEMPT.e, instanceId: WORLD.instanceId, reason: 'native_rejected', httpStatus: 422 } }, state({ group: group([]), custody: custody(ATTEMPT.e, 'failed') })),
      ok('clientFanClaim', { pageLabel: PAGE, fanRef: fan, body: dispatch(ATTEMPT.f, 0, 'preview-reply') }, state({ group: group([]), custody: custody(ATTEMPT.f, 'dispatching', 'tkt-once-f') })),
      ok('clientFanClaim', { pageLabel: PAGE, fanRef: fan, body: sent(ATTEMPT.f, WORLD.messages.sentByUs) }, state({ group: group([0]), custody: custody(ATTEMPT.f, 'sent') })),
    ],
  },
  {
    name: 'register-native-send',
    description: 'X8 off → «Открыть и вставить» → the human pressed Send: the proven native send confirms the greeting; a repeat is idempotent.',
    exchanges: [
      ok(
        'clientFanClaim',
        op({ action: 'registerNativeSend', attemptId: ATTEMPT.native, instanceId: WORLD.instanceId, purpose: 'greeting', group: { generationRef: GEN, variant: 0, partCount: 2 }, partIndex: 0, platformMessageId: WORLD.messages.sentByUs }),
        state({ greeting: greeted(WORLD.messages.sentByUs, 'native-register'), group: group([0]), custody: custody(ATTEMPT.native, 'sent') }),
      ),
      ok(
        'clientFanClaim',
        op({ action: 'registerNativeSend', attemptId: ATTEMPT.native, instanceId: WORLD.instanceId, purpose: 'greeting', group: { generationRef: GEN, variant: 0, partCount: 2 }, partIndex: 0, platformMessageId: WORLD.messages.sentByUs }),
        state({ greeting: greeted(WORLD.messages.sentByUs, 'native-register'), group: group([0]), custody: custody(ATTEMPT.native, 'sent') }),
      ),
    ],
  },
  {
    name: 'recaps-and-dossier',
    description: 'Shared recaps (H-13), the dossier save not ready → created → existing (H-5), a short recap refused, the dossier read, an unknown fan and a page not granted.',
    exchanges: [
      ok('clientConversationRecaps', { pageLabel: PAGE, fanRef: fan, personaDefinitionId: WORLD.persona.definitionId }, {
        full: { generationRef: GEN, generatedAt: at(-3600), personaDefinitionId: WORLD.persona.definitionId, coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 840 }, text: '## Fan\nLikes short replies.' },
        short: null,
        fullSavedToProfile: false,
      }),
      refused('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: fan, generationRef: GEN, clientRequestId: uuid(0x100) }, 'generation_not_ready', { cg: 'CG-RECAP-SAVE', disposition: 'not-ready' }),
      ok('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: fan, generationRef: GEN, clientRequestId: uuid(0x100) }, { outcome: 'created', profile: { version: 3, createdAt: at(5), sourceGeneratedAt: at(-3600) } }),
      ok('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: fan, generationRef: GEN, clientRequestId: uuid(0x100) }, { outcome: 'existing', profile: { version: 3, createdAt: at(5), sourceGeneratedAt: at(-3600) } }),
      refused('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: fan, generationRef: uuid(0x202) }, 'generation_not_eligible', { cg: 'CG-HUB-REQUEST', disposition: 'show' }, { reason: 'not_full_summary' }),
      ok('pageConversationProfile', { pageLabel: PAGE, fanRef: fan }, {
        fan: { platform: 'onlyfans', platformUserId: fan, username: 'fan_two', displayName: 'Fan Two', createdAtExternal: null, pageAlias: null },
        profile: { version: 3, body: '## Fan\nLikes short replies.', source: 'chatmuse', createdAt: at(5), sourceGeneratedAt: at(-3600), createdByUserId: WORLD.user.userId },
      }),
      refused('pageFanProfile', { pageLabel: PAGE, fanRef: WORLD.otherFan }, 'not_found', { cg: null, disposition: 'empty' }, { facts: { fanLookup: true } }),
      refused('clientConversationRecaps', { pageLabel: 'not-my-page', fanRef: fan }, 'not_found', { cg: 'CG-BINDING-NOT-GRANTED', disposition: 'show' }, { facts: { pageGranted: false } }),
    ],
  },
];

/**
 * The building blocks above, for the fake hub's model (packages/testing/src/
 * fake-hub): it serves its default data from the same synthetic shapes the
 * scenarios use, adapted per page and clock.
 */
export const SCENARIO_DATA = {
  limits: LIMITS,
  health: healthBody,
  scope,
  period,
  diagnostics,
  stats,
  tierBuckets,
  feedItem,
  feedTotal: FEED_TOTAL,
  audienceItem,
  queuePage,
} as const;
