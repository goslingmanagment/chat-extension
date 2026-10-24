// The fake hub's read models (architecture.md §8.5, §8.7; hub H-5, H-7c, H-8,
// H-9c, H-13, H-15): Spenders (board, card, batch, tier buckets), statistics
// and «ждут ответа», the archive feed with its Ping summary, «Новые», shared
// recaps and dossiers, own AI spend, and the ingest store. Data is synthetic
// (scenarios/hub world and SCENARIO_DATA shapes), per page, relative to the
// hub clock. Cursors are opaque and signed: a forged one, or one of another
// page, fan or window, is refused the way the hub refuses it. Numbers are
// plausible, not the hub's formulas: the Ping segment rule below is a
// stand-in, the client never derives it anyway (it shows what it gets).
// R20 P6c1: the page's capture of its chats (the pair of hub HF-9), and what
// the AI's serving reader reads of a conversation beside what the hub holds
// or tombstoned (the window check of hub HF-8в).

import {
  CHAT_IS_FAN,
  type AiUsageDay,
  type AiUsageQuery,
  type AiUsageReport,
  type AudienceNewItem,
  type AudienceNewPage,
  type AudienceNewQuery,
  type AutoLists,
  type ClaimSummary,
  type Dossier,
  type FeedItem,
  type FeedPage,
  type FeedQuery,
  type HubErrorCode,
  type IngestBatch,
  type IngestResult,
  type QueuePage,
  type QueueQuery,
  type RecapBody,
  type RecapStatus,
  type SendAttributionsRequest,
  type SendAttributionsResult,
  type SharedRecaps,
  type SpenderBatch,
  type SpenderBatchQuery,
  type SpenderDetail,
  type SpenderDetailQuery,
  type SpenderListItem,
  type SpendersPage,
  type SpendersQuery,
  type SpendersStats,
  type StatsQuery,
} from '@cg/contracts';

import { SCENARIO_DATA, WORLD, spenderRow } from '../scenarios/hub';
import { classifyPair, type PairState, type ServedRef, type StoreState } from './ai-rules';
import { iso } from './clock';
import { pageRefOf, type FakePage } from './config';
import { type SpenderSeed } from './types';

export interface Refusal {
  readonly error: HubErrorCode | (string & {});
  readonly reason?: string;
  readonly retryAfterSec?: number;
}
export type Read<T> = { readonly ok: true; readonly body: T } | { readonly ok: false; readonly refusal: Refusal };

const ok = <T>(body: T): Read<T> => ({ ok: true, body });
const no = (error: HubErrorCode, reason?: string): Read<never> => ({ ok: false, refusal: reason === undefined ? { error } : { error, reason } });

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ── signed cursors ─────────────────────────────────────────────────────────

function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class CursorSigner {
  constructor(private readonly secret: string) {}

  sign(kind: string, payload: Record<string, unknown>): string {
    const json = JSON.stringify(payload);
    return `${kind}.${Buffer.from(json, 'utf8').toString('base64url')}.${fnv(`${this.secret}|${kind}|${json}`)}`;
  }

  /** null: forged, of another kind, or not ours. */
  open(kind: string, cursor: string): Record<string, unknown> | null {
    const [k, body, sig] = cursor.split('.');
    if (k !== kind || body === undefined || sig === undefined) return null;
    let json: string;
    try {
      json = Buffer.from(body, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    if (fnv(`${this.secret}|${kind}|${json}`) !== sig) return null;
    try {
      const parsed = JSON.parse(json) as unknown;
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

// ── dates in a zone ────────────────────────────────────────────────────────

/** `YYYY-MM-DD` of an instant in an IANA zone; throws RangeError for an unknown zone. */
export function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(ms)
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const wall = Date.UTC(parts['year'] ?? 0, (parts['month'] ?? 1) - 1, parts['day'] ?? 1, parts['hour'] ?? 0, parts['minute'] ?? 0, parts['second'] ?? 0);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The instant a local date starts in a zone. */
export function zonedMidnight(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return guess - zoneOffsetMs(guess, timeZone);
}

const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const isKnownZone = (timeZone: string): boolean => {
  try {
    localDate(0, timeZone);
    return true;
  } catch {
    return false;
  }
};

/** What a seeded fan's row says was written last (`lastMessagePreview`), by who wrote it. */
const FAN_PREVIEWS = ['hey are you there? 🥺', 'that last set was 🔥 do you have more like it?', 'Yeah', 'Sorry, busy week at work. Missed you though'] as const;
const OUR_PREVIEWS = ['did you like the new set? 😏', 'gimme a min to make it 👀', 'glad to hear it! how was ur day?', '[Photo]'] as const;

// ── the model ──────────────────────────────────────────────────────────────

interface ArchiveMessage extends FeedItem {
  readonly order: number;
  /**
   * R20 P6c1: held for this conversation, but not in what the AI's serving reader reads (older than its window, cut by
   * the prompt's budget, or in a store that reader does not read) — the window check answers it `outside_window`.
   */
  readonly held?: true;
}

interface Archive {
  /** The hub's `archive_generation`: a rebuild of the archive (re-capture) bumps it and invalidates every feed cursor. */
  generation: number;
  /** Grows with every change; `snapshotRevision` of a feed pass. */
  revision: number;
  /** Newest first. */
  readonly messages: ArchiveMessage[];
  /** R20 P6c1: the hub's lookup of the ids outside the served window fails here (the window check answers them `unknown`). */
  lookupFails?: boolean;
}

/** One message of a conversation seeded as a whole (`archiveConversation`), oldest first. */
export interface ConversationSeed {
  readonly id: string;
  readonly sender: 'fan' | 'model';
  /** `held` — the hub holds it but the AI's reader does not read it; `deleted` — tombstoned. Absent — read, inside the window. */
  readonly state?: 'held' | 'deleted';
}

/** What the AI's serving reader read of a conversation, newest first, and what the stores hold about any other id (null — their lookup failed). */
export interface ServedSnapshot {
  readonly window: readonly (ServedRef & { readonly at: string | null })[];
  readonly stores: ReadonlyMap<string, StoreState> | null;
}

interface AudienceEvent {
  readonly item: Omit<AudienceNewItem, 'claim'>;
  /** Visible from this instant (the hub's `created_at`). */
  readonly createdAt: number;
}

export interface UsageRecord {
  readonly userId: number;
  readonly pageLabel: string;
  readonly feature: string;
  readonly at: number;
  readonly outcome: 'completed' | 'failed' | 'cancelled' | 'quota-denied' | 'open';
  readonly regeneration: boolean;
  readonly costMicroUsd: number;
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheWrite: number; readonly cacheRead: number };
}

const SPENDER_FAN_BASE = 5000;

const TEXT_SORT_KEYS: ReadonlySet<string> = new Set(['platformUserId', 'username', 'displayName']);

/** The board's sort keys (SPENDER_SORT_KEYS) read off one row. */
function sortValue(sortBy: NonNullable<SpendersQuery['sortBy']>): (row: SpenderListItem) => string | number {
  const window = (row: SpenderListItem) => row.metrics.window;
  switch (sortBy) {
    case 'grossAmountMills':
    case 'creatorNetAmountMills':
    case 'postedGrossAmountMills':
    case 'pendingGrossAmountMills':
    case 'postedCreatorNetAmountMills':
    case 'pendingCreatorNetAmountMills':
      return (row) => window(row)?.[sortBy] ?? 0;
    case 'lifetimeGrossAmountMills':
      return (row) => row.metrics.lifetime.scopeGrossAmountMills;
    case 'lifetimeCreatorNetAmountMills':
      return (row) => row.metrics.lifetime.scopeCreatorNetAmountMills;
    case 'lastTransactionAt':
      return (row) => Date.parse(window(row)?.lastTransactionAt ?? '') || 0;
    case 'platformUserId':
      return (row) => row.fan.platformUserId.padStart(30, '0');
    case 'username':
      return (row) => row.fan.username ?? '';
    case 'displayName':
      return (row) => row.fan.displayName ?? '';
  }
}
const AUDIENCE_SEEDS = 5;
const QUEUE_SEEDS = 5;

/** The board's shelves once its first rows are seeded fans (`spenderFans`): six tiers by lifetime, in dollars. */
const SEEDED_TIERS: ReadonlyArray<{ readonly key: string; readonly label: string; readonly min: number; readonly max: number | null }> = [
  { key: '1-25', label: '$1–25', min: 1, max: 25 },
  { key: '25-50', label: '$25–50', min: 25, max: 50 },
  { key: '50-150', label: '$50–150', min: 50, max: 150 },
  { key: '150-350', label: '$150–350', min: 150, max: 350 },
  { key: '350-600', label: '$350–600', min: 350, max: 600 },
  { key: '600-plus', label: '$600+', min: 600, max: null },
];
const MILLS = 1000;

export class DataModel {
  private readonly archives = new Map<string, Archive>();
  private readonly audience = new Map<string, AudienceEvent[]>();
  private readonly recaps = new Map<string, { full: RecapBody | null; short: RecapBody | null }>();
  private readonly dossiers = new Map<string, NonNullable<Dossier['profile']>>();
  /** generationRef of the dossier's current body (H-5 «existing»). */
  private readonly dossierSource = new Map<string, string>();
  private readonly ingested = new Map<string, IngestBatch['events'][number]>();
  /** 1.21.0 (X48): who sent each message, by `page|message`; the first report wins (hub client_send_attributions). */
  private readonly attributions = new Map<string, FakeSendAttribution>();
  /**
   * R20 P6c1: the page's capture of its chats (`page_dm_threads`), by page and conversation: the fan the thread
   * names, or null — a thread whose fan the hub does not know. A conversation without a thread is not here.
   */
  private readonly threads = new Map<string, string | null>();
  readonly usage: UsageRecord[] = [];
  /** The fans at the top of every page's board (`spenderFans`); empty — the synthetic board. */
  private seeds: readonly SpenderSeed[] = [];
  private archiveOrder = 0;
  private extraMessageId = 7000;

  constructor(
    private readonly cursors: CursorSigner,
    private readonly base: number,
  ) {
    const fan = WORLD.fan;
    for (const page of [WORLD.pages.one.pageLabel, WORLD.pages.vip.pageLabel]) {
      this.recaps.set(this.key(page, fan), {
        full: {
          generationRef: '00000000-0000-4000-8000-000000000200',
          generatedAt: iso(base - HOUR_MS),
          personaDefinitionId: WORLD.persona.definitionId,
          coverage: { transcriptCoverage: 'full-history', requestedCount: 3000, keptCount: 840 },
          text: '## Fan\nLikes short replies.',
        },
        short: null,
      });
      this.dossiers.set(this.key(page, fan), {
        version: 3,
        body: '## Fan\nLikes short replies.',
        source: 'chatmuse',
        createdAt: iso(base - 60_000),
        sourceGeneratedAt: iso(base - HOUR_MS),
        createdByUserId: WORLD.user.userId,
      });
      this.dossierSource.set(this.key(page, fan), '00000000-0000-4000-8000-000000000200');
    }
    // The Fansly page's capture knows its chats (scenarios/hub world: the stand's first two, and an old fan's).
    for (const chat of [WORLD.fansly.chats.a, WORLD.fansly.chats.b, WORLD.fansly.old]) this.threads.set(this.key(WORLD.pages.fansly.pageLabel, chat.group), chat.fan);
  }

  private key(pageLabel: string, fanRef: string): string {
    return `${pageLabel}\u0000${fanRef}`;
  }

  // ── the page's threads and the pair (R20 HF-9) ──

  /** The page's capture learns a chat (`fanRef` null — a thread whose fan it does not know). */
  setThread(pageLabel: string, conversationRef: string, fanRef: string | null): void {
    this.threads.set(this.key(pageLabel, conversationRef), fanRef);
  }

  /** The pair a request names, judged by the page's thread of the group (hub `checkAiConversationPair`). */
  pair(pageLabel: string, conversationRef: string, fanRef: string): PairState {
    return classifyPair(this.threads.get(this.key(pageLabel, conversationRef)), fanRef);
  }

  /**
   * The fan's chat as the page's capture knows it (R20 P8a): the group whose thread is the fan's; null — none. What a
   * Fansly page's Spenders row names as `conversation.platformConversationId` (architecture §8.11).
   */
  private threadOf(pageLabel: string, fanRef: string): string | null {
    const prefix = this.key(pageLabel, '');
    for (const [key, fan] of this.threads) if (key.startsWith(prefix) && fan === fanRef) return key.slice(prefix.length);
    return null;
  }

  /** A row as this page's hub serves it: where a chat has an id of its own, the row names the fan's group or none. */
  private onPage(page: FakePage, row: SpenderListItem): SpenderListItem {
    if (CHAT_IS_FAN[page.platform]) return row;
    const seed = this.seeds.find((seed) => seed.fanRef === row.fan.platformUserId);
    const ref = seed?.conversationRef;
    return { ...row, conversation: { ...row.conversation, platformConversationId: ref === undefined ? this.threadOf(page.pageLabel, row.fan.platformUserId) : ref } };
  }

  private threadFan(pageLabel: string, fanRef: string): boolean {
    const prefix = this.key(pageLabel, '');
    return [...this.threads].some(([key, fan]) => key.startsWith(prefix) && fan === fanRef);
  }

  /** The first rows of the board become these fans (the stand's own, in e2e); `[]` — the synthetic board again. */
  useSpenderFans(seeds: readonly SpenderSeed[]): void {
    this.seeds = seeds.map((seed) => ({ ...seed }));
  }

  private seedOf(fanRef: string): SpenderSeed | null {
    return this.seeds.find((seed) => seed.fanRef === fanRef) ?? null;
  }

  // ── fans the archive knows ──

  /** Fans the page's archive and audience know (dossier lookups 404 for anyone else). */
  knowsFan(page: FakePage, fanRef: string, spendersTotal: number): boolean {
    if (fanRef === WORLD.fan || this.seedOf(fanRef) !== null || this.threadFan(page.pageLabel, fanRef)) return true;
    const n = Number(fanRef);
    if (n >= SPENDER_FAN_BASE && n < SPENDER_FAN_BASE + spendersTotal) return true;
    if (this.audienceOf(page).some((event) => event.item.fanRef === fanRef)) return true;
    return (this.archives.get(this.key(page.pageLabel, fanRef))?.messages.length ?? 0) > 0;
  }

  // ── Spenders ──

  private periodMeta(period: string, from: string | undefined, to: string | undefined, now: number): SpendersPage['period'] {
    const timeZone = 'Europe/Moscow';
    const today = localDate(now, timeZone);
    const back: Record<string, number> = { today: 0, '7d': 6, '30d': 29, '90d': 89, '180d': 179 };
    const fromDate =
      period === 'custom' ? (from ?? null) : period === 'lifetime' ? null : period === 'mtd' ? `${today.slice(0, 8)}01` : shiftDate(today, -(back[period] ?? 29));
    return { timeZone, fromBusinessDate: fromDate, toBusinessDateInclusive: period === 'custom' ? (to ?? null) : today, asOf: iso(now) };
  }

  private scopeOf(page: FakePage): SpendersPage['scope'] {
    return { kind: 'page', platform: page.platform, pageCount: 1, page: pageRefOf(page), model: null };
  }

  /** A seeded fan's row: the synthetic row of its rank with the seed's fan, money and message ages. */
  private seedRow(seed: SpenderSeed, rank: number, now: number): SpenderListItem {
    const base = spenderRow(rank);
    const ago = (seconds: number | null | undefined, fallback: string | null): string | null => (seconds === undefined ? fallback : seconds === null ? null : iso(now - seconds * 1000));
    const lifetime = seed.lifetimeUsd === undefined ? base.metrics.lifetime.scopeGrossAmountMills : Math.round(seed.lifetimeUsd * MILLS);
    const net = (mills: number): number => Math.round(mills * 0.8);
    const windowGross = seed.windowUsd === undefined ? (base.metrics.window?.grossAmountMills ?? 0) : seed.windowUsd === null ? null : Math.round(seed.windowUsd * MILLS);
    const fanWrote = ago(seed.fanWroteAgoSec, base.lastFanMessageAt);
    const weWrote = ago(seed.weWroteAgoSec, base.conversation.lastModelMessageAt);
    const last = [fanWrote, weWrote].filter((value): value is string => value !== null).sort().at(-1) ?? null;
    // The hub's `lastMessagePreview`: the newest message's text, the fan's or ours, whoever wrote last.
    const preview = last === null ? null : (last === weWrote ? OUR_PREVIEWS : FAN_PREVIEWS)[rank % 4] ?? null;
    return {
      ...base,
      fan: { ...base.fan, platformUserId: seed.fanRef, username: seed.username ?? `fan_${seed.fanRef}`, displayName: seed.displayName === undefined ? null : seed.displayName },
      metrics: {
        ...base.metrics,
        window:
          windowGross === null || base.metrics.window === null
            ? null
            : { ...base.metrics.window, grossAmountMills: windowGross, creatorNetAmountMills: net(windowGross), postedGrossAmountMills: windowGross, postedCreatorNetAmountMills: net(windowGross) },
        lifetime: { scopeGrossAmountMills: lifetime, scopeCreatorNetAmountMills: net(lifetime), platformGrossAmountMills: lifetime, platformCreatorNetAmountMills: net(lifetime) },
      },
      lastFanMessageAt: fanWrote,
      conversation: {
        ...base.conversation,
        platformConversationId: seed.fanRef,
        unreadCount: seed.awaiting === true ? 1 : 0,
        lastMessageAt: last,
        lastFanMessageAt: fanWrote,
        lastModelMessageAt: weWrote,
        lastMessagePreview: preview,
        messageCoverageStatus: 'complete',
        messageBackfillComplete: true,
      },
    };
  }

  private rows(page: FakePage, total: number, now: number): SpenderListItem[] {
    return Array.from({ length: Math.max(total, this.seeds.length) }, (_, rank) => {
      const seed = this.seeds[rank];
      return this.onPage(page, seed === undefined ? spenderRow(rank) : this.seedRow(seed, rank, now));
    });
  }

  spenders(page: FakePage, query: SpendersQuery, now: number, total: number): Read<SpendersPage> {
    const needle = query.query?.toLowerCase();
    let rows = this.rows(page, total, now).filter(
      (row) =>
        (needle === undefined || (row.fan.username ?? '').toLowerCase().includes(needle) || (row.fan.displayName ?? '').toLowerCase().includes(needle)) &&
        (query.retentionStatus === undefined || query.retentionStatus === 'all' || row.retentionStatus === query.retentionStatus),
    );
    const sortBy = query.sortBy ?? 'grossAmountMills';
    const text = TEXT_SORT_KEYS.has(sortBy);
    const value = sortValue(sortBy);
    // By the key in the asked direction (text keys default to ascending, amounts and times to descending), ties by rank.
    const sign = (query.sortDir ?? (text ? 'asc' : 'desc')) === 'desc' ? -1 : 1;
    rows = rows
      .map((row, rank) => ({ row, rank, key: value(row) }))
      .sort((a, b) => sign * (text ? String(a.key).localeCompare(String(b.key)) : Number(a.key) - Number(b.key)) || a.rank - b.rank)
      .map(({ row }) => row);
    return ok({
      scope: this.scopeOf(page),
      period: this.periodMeta(query.period, query.from, query.to, now),
      diagnostics: SCENARIO_DATA.diagnostics,
      items: rows.slice(query.offset, query.offset + query.limit),
      limit: query.limit,
      offset: query.offset,
      total: rows.length,
    });
  }

  private row(page: FakePage, platformUserId: string, total: number, now: number): SpenderListItem | null {
    const seeded = this.seeds.findIndex((seed) => seed.fanRef === platformUserId);
    const seed = this.seeds[seeded];
    if (seed !== undefined) return this.onPage(page, this.seedRow(seed, seeded, now));
    const rank = Number(platformUserId) - SPENDER_FAN_BASE;
    // A rank a seeded fan took has no synthetic fan any more.
    return Number.isInteger(rank) && rank >= this.seeds.length && rank < total ? this.onPage(page, spenderRow(rank)) : null;
  }

  private breakdown(row: SpenderListItem): SpenderDetail['typeBreakdown'] {
    const window = row.metrics.window;
    if (window === null) return [];
    return [{ canonicalType: row.lastTransaction?.canonicalType ?? 'tip', grossAmountMills: window.grossAmountMills, creatorNetAmountMills: window.creatorNetAmountMills, transactionCount: window.transactionCount }];
  }

  spenderDetail(page: FakePage, query: SpenderDetailQuery, now: number, total: number): Read<SpenderDetail> {
    // A fan of the page's own platform (R20 P8a: a Fansly page's fan card too).
    const row = query.platform === page.platform ? this.row(page, query.platformUserId, total, now) : null;
    if (row === null) return no('not_found');
    return ok({
      scope: this.scopeOf(page),
      fan: row.fan,
      period: this.periodMeta(query.period, query.from, query.to, now),
      metrics: row.metrics,
      typeBreakdown: this.breakdown(row),
      pages: [
        {
          pageId: page.pageId,
          pageLabel: page.pageLabel,
          modelSlug: page.modelSlug,
          modelName: page.modelName,
          inScope: true,
          grossAmountMills: row.metrics.lifetime.scopeGrossAmountMills,
          creatorNetAmountMills: row.metrics.lifetime.scopeCreatorNetAmountMills,
          lastTransactionAt: row.lifetimeLastTransactionAt,
          isFollower: true,
          followerSince: null,
          isSubscriber: true,
          subscriberSince: null,
          subscriptionExpiresAt: null,
          autoRenew: null,
          autoRenewOffDetectedAt: null,
        },
      ],
    });
  }

  spenderBatch(page: FakePage, query: SpenderBatchQuery, now: number, total: number): Read<SpenderBatch> {
    return ok({
      scope: this.scopeOf(page),
      period: this.periodMeta(query.period ?? 'lifetime', query.from, query.to, now),
      items: query.fans.map((fan) => {
        const row = fan.platform === page.platform ? this.row(page, fan.platformUserId, total, now) : null;
        return row === null
          ? { requestedFan: fan, found: false, fan: null, metrics: null, typeBreakdown: null, lifetimeLastTransactionAt: null, subscription: null }
          : {
              requestedFan: fan,
              found: true,
              fan: row.fan,
              metrics: row.metrics,
              typeBreakdown: this.breakdown(row),
              lifetimeLastTransactionAt: row.lifetimeLastTransactionAt,
              subscription: { status: 'active' as const, expiresAt: null, autoRenew: null, autoRenewOffDetectedAt: null },
            };
      }),
    });
  }

  autoLists(page: FakePage, now: number, total: number): Read<AutoLists> {
    if (this.seeds.length > 0) {
      const lifetimes = this.rows(page, total, now).map((row) => row.metrics.lifetime.scopeGrossAmountMills);
      const lists = SEEDED_TIERS.map((tier) => ({
        key: tier.key,
        label: tier.label,
        minAmountMills: tier.min * MILLS,
        maxAmountMillsExclusive: tier.max === null ? null : tier.max * MILLS,
        entryCount: lifetimes.filter((mills) => mills >= tier.min * MILLS && (tier.max === null || mills < tier.max * MILLS)).length,
      }));
      return ok({
        ...SCENARIO_DATA.tierBuckets,
        page: pageRefOf(page),
        period: this.periodMeta('lifetime', undefined, undefined, now),
        asOf: iso(now),
        totalEntries: lists.reduce((sum, list) => sum + list.entryCount, 0),
        lists,
      });
    }
    return ok({ ...SCENARIO_DATA.tierBuckets, page: pageRefOf(page), period: this.periodMeta('lifetime', undefined, undefined, now), asOf: iso(now), lists: [...SCENARIO_DATA.tierBuckets.lists] });
  }

  stats(page: FakePage, query: StatsQuery, now: number): Read<SpendersStats> {
    if (!isKnownZone(query.timeZone)) return no('bad_request', 'unknown_time_zone');
    const queue = this.queue(page, now);
    return ok({
      ...SCENARIO_DATA.stats,
      pageLabel: page.pageLabel,
      timeZone: query.timeZone,
      asOf: iso(now),
      projectionAsOf: iso(now - 120_000),
      queueSummary: { total: queue.length, unknown: queue.filter((item) => item.readState === 'unknown').length },
    });
  }

  // ── «ждут ответа» ──

  private queue(page: FakePage, now: number): QueuePage['items'] {
    void page;
    if (this.seeds.length > 0) {
      return this.seeds
        .filter((seed) => seed.awaiting === true)
        .map((seed) => ({
          fanRef: seed.fanRef,
          username: seed.username ?? `fan_${seed.fanRef}`,
          displayName: seed.displayName ?? null,
          lifetimeGrossMills: Math.round((seed.lifetimeUsd ?? 0) * MILLS),
          lastFanMessageAt: iso(now - (seed.fanWroteAgoSec ?? 0) * 1000),
          lastModelMessageAt: seed.weWroteAgoSec === undefined || seed.weWroteAgoSec === null ? null : iso(now - seed.weWroteAgoSec * 1000),
          unreadCount: 1,
          readState: 'unread' as const,
        }));
    }
    return Array.from({ length: QUEUE_SEEDS }, (_, i) => ({
      fanRef: String(SPENDER_FAN_BASE + i * 3),
      username: `fan_${i * 3}`,
      displayName: null,
      lifetimeGrossMills: (1240 - i * 3) * 3_000,
      lastFanMessageAt: iso(now - HOUR_MS * (i + 1)),
      lastModelMessageAt: iso(now - DAY_MS),
      unreadCount: i === 0 ? null : 1,
      readState: i === 0 ? 'unknown' : 'unread',
    }));
  }

  awaitingReply(page: FakePage, query: QueueQuery, now: number): Read<QueuePage> {
    let offset = 0;
    let asOf = now;
    if (query.cursor !== undefined) {
      const cursor = this.cursors.open('aw1', query.cursor);
      if (cursor === null || cursor['p'] !== page.pageLabel || typeof cursor['o'] !== 'number' || typeof cursor['s'] !== 'number') return no('bad_request', 'cursor_invalid');
      offset = cursor['o'];
      asOf = cursor['s'];
    }
    const all = this.queue(page, asOf);
    const limit = query.limit ?? 50;
    const items = all.slice(offset, offset + limit);
    const next = offset + items.length;
    return ok({
      items,
      total: all.length,
      loaded: next,
      unknown: all.filter((item) => item.readState === 'unknown').length,
      nextCursor: next < all.length ? this.cursors.sign('aw1', { p: page.pageLabel, o: next, s: asOf }) : null,
      asOf: iso(asOf),
    });
  }

  // ── archive feed (H-9c) ──

  private archive(page: FakePage, fanRef: string): Archive {
    const key = this.key(page.pageLabel, fanRef);
    let archive = this.archives.get(key);
    if (archive === undefined) {
      // A conversation with an id of its own (a Fansly group, R20 F6b) holds three messages of its own, ids from its id.
      const seeded = fanRef === WORLD.fan ? SCENARIO_DATA.feedTotal : this.knowsFanStatic(fanRef) || !CHAT_IS_FAN[page.platform] ? 3 : 0;
      archive = {
        generation: 1,
        revision: 1,
        messages: Array.from({ length: seeded }, (_, n) => {
          const item = SCENARIO_DATA.feedItem(n);
          return { ...item, at: iso(this.base - 600_000 * n), messageId: fanRef === WORLD.fan ? item.messageId : `${fanRef}${String(n).padStart(3, '0')}`, order: -(n + 1) };
        }),
      };
      this.archives.set(key, archive);
    }
    return archive;
  }

  private knowsFanStatic(fanRef: string): boolean {
    const n = Number(fanRef);
    return fanRef === WORLD.fan || this.seedOf(fanRef) !== null || (n >= Number(WORLD.newFan) && n < Number(WORLD.newFan) + AUDIENCE_SEEDS) || (n >= SPENDER_FAN_BASE && n < SPENDER_FAN_BASE + 1240);
  }

  /** A message lands in the archive: the feed head moves and the snapshot changes. */
  addArchiveMessage(page: FakePage, fanRef: string, sender: 'fan' | 'model', now: number, messageId?: string): string {
    const archive = this.archive(page, fanRef);
    this.extraMessageId += 1;
    this.archiveOrder += 1;
    const id = messageId ?? String(this.extraMessageId);
    archive.messages.unshift({
      messageId: id,
      at: iso(now),
      sender,
      text: sender === 'fan' ? 'new synthetic fan message' : 'new synthetic model message',
      automatic: null,
      deleted: false,
      tipMills: null,
      priceMills: null,
      attachmentLabels: [],
      order: this.archiveOrder,
    });
    archive.revision += 1;
    return id;
  }

  /** The archive is rebuilt (the hub's `archive_generation` moves): every feed cursor of the fan becomes `cursor_invalid`. */
  rebuildArchive(page: FakePage, fanRef: string): number {
    const archive = this.archive(page, fanRef);
    archive.generation += 1;
    archive.revision += 1;
    return archive.generation;
  }

  /**
   * R20 P6c1: a conversation's archive becomes exactly these messages, oldest first — the window check's world as the
   * matrix the hub shares with this client writes it: what the model reads, and what the hub holds or tombstoned
   * beside it. A new archive generation: every feed cursor of the conversation is `cursor_invalid` from now on.
   */
  seedConversation(page: FakePage, conversationRef: string, messages: readonly ConversationSeed[], lookupFails: boolean): void {
    const key = this.key(page.pageLabel, conversationRef);
    const old = this.archives.get(key);
    const count = messages.length;
    const seeded: ArchiveMessage[] = messages.map((message, index) => ({
      messageId: message.id,
      at: iso(this.base - 60_000 * (count - index)),
      sender: message.sender,
      text: message.sender === 'fan' ? 'seeded synthetic fan message' : 'seeded synthetic model message',
      automatic: null,
      deleted: message.state === 'deleted',
      tipMills: null,
      priceMills: null,
      attachmentLabels: [],
      order: -(count - index),
      ...(message.state === 'held' ? { held: true as const } : {}),
    }));
    this.archives.set(key, { generation: (old?.generation ?? 0) + 1, revision: (old?.revision ?? 0) + 1, messages: seeded.reverse(), lookupFails });
  }

  /**
   * What the AI's serving reader reads of a conversation (hub `TranscriptServedSnapshot`), newest first: its newest
   * `requested` messages the hub has neither tombstoned nor holds beside the reader; and the store state of every other
   * id the archive has — `present` or `deleted` — or null when that lookup fails (`lookupFails`).
   */
  served(page: FakePage, ref: string, requested: number): ServedSnapshot {
    const archive = this.archive(page, ref);
    const window = archive.messages.filter((message) => !message.deleted && message.held !== true).slice(0, requested);
    const read = new Set(window.map((message) => message.messageId));
    const stores =
      archive.lookupFails === true
        ? null
        : new Map(archive.messages.filter((message) => !read.has(message.messageId)).map((message): [string, StoreState] => [message.messageId, message.deleted ? 'deleted' : 'present']));
    return { window: window.map((message) => ({ messageRef: message.messageId, isFromFan: message.sender === 'fan', at: message.at })), stores };
  }

  /** The head the generation reader serves (context_v1) and whether a message id is in the archive. */
  archiveFacts(page: FakePage, fanRef: string): { head: FeedItem | null; total: number; states: (id: string) => 'included' | 'absent' | 'deleted' } {
    const archive = this.archive(page, fanRef);
    return {
      head: archive.messages[0] ?? null,
      total: archive.messages.length,
      states: (id) => {
        const message = archive.messages.find((m) => m.messageId === id);
        return message === undefined ? 'absent' : message.deleted ? 'deleted' : 'included';
      },
    };
  }

  /**
   * One page of the feed. The cursor is bound like the hub's (hub-pr-plan.md
   * PR 22): page, fan, user, archive generation, the snapshot (revision and
   * the newest message order it covered) and the position. A pass stays on
   * its snapshot: messages that arrive later are never in it (they wait for
   * the next pass), and every page of it carries the same snapshotRevision
   * and head. A forged cursor, another target's or user's, or a changed
   * generation is 400 `cursor_invalid`.
   */
  feed(page: FakePage, query: FeedQuery, now: number, userId: number, conversation: string = query.fanRef): Read<FeedPage> {
    // R20 F6b (hub HF-10): the conversation's archive; the fan's own chat keeps its cursor scope, another's binds it.
    const archive = this.archive(page, conversation);
    const scope = conversation === query.fanRef ? {} : { c: conversation };
    let all: readonly ArchiveMessage[] = archive.messages;
    let revision = archive.revision;
    let start = 0;
    if (query.cursor !== undefined) {
      const cursor = this.cursors.open('fd1', query.cursor);
      if (
        cursor === null ||
        cursor['p'] !== page.pageLabel ||
        cursor['f'] !== query.fanRef ||
        cursor['c'] !== scope.c ||
        cursor['u'] !== userId ||
        cursor['g'] !== archive.generation ||
        typeof cursor['r'] !== 'number' ||
        typeof cursor['t'] !== 'number' ||
        typeof cursor['k'] !== 'string'
      ) {
        return no('bad_request', 'cursor_invalid');
      }
      const top = cursor['t'];
      all = archive.messages.filter((m) => m.order <= top);
      revision = cursor['r'];
      const index = all.findIndex((m) => m.messageId === cursor['k']);
      if (index < 0) return no('bad_request', 'cursor_invalid');
      start = index + 1;
    }
    const limit = query.limit ?? 50;
    const items = all.slice(start, start + limit).map(({ order: _order, held: _held, ...item }) => item);
    const last = items.at(-1);
    const head = all[0];
    const coverage = all.length === 0 ? 'unknown' : 'complete';
    const first = query.cursor === undefined;
    const snapshot = { p: page.pageLabel, f: query.fanRef, ...scope, u: userId, g: archive.generation, r: revision, t: head?.order ?? 0 };
    return ok({
      target: { pageLabel: page.pageLabel, fanRef: query.fanRef, ...(query.conversationRef === undefined ? {} : { conversationRef: query.conversationRef }) },
      source: 'union',
      snapshotRevision: `snap-${revision}`,
      asOf: iso(now),
      coverage,
      head: head === undefined ? null : { messageRef: head.messageId, at: head.at, sender: head.sender },
      newestKnownAt: head?.at ?? null,
      nextOlderCursor: last !== undefined && start + items.length < all.length ? this.cursors.sign('fd1', { ...snapshot, k: last.messageId }) : null,
      items,
      summary: first ? this.feedSummary(all, query.summaryWindow ?? 100, coverage, now) : null,
    });
  }

  /** A stand-in for the hub's Ping segment (computed by the hub; the client only shows it). */
  private feedSummary(all: readonly FeedItem[], window: number, coverage: string, now: number): NonNullable<FeedPage['summary']> {
    const served = all.slice(0, window);
    const fanTexts = served.filter((m) => m.sender === 'fan' && m.text !== '' && !m.deleted);
    const lastFanAt = fanTexts[0]?.at ?? null;
    const silenceDays = lastFanAt === null ? null : Math.max(0, Math.floor((now - Date.parse(lastFanAt)) / DAY_MS));
    const pingSegment = silenceDays === null ? 'unknown' : silenceDays < 1 ? 'active' : fanTexts.length >= 3 ? 'segment-b' : 'segment-a';
    return { pingSegment, fanSilenceDays: silenceDays, window: { requested: window, served: served.length }, coverage, asOf: iso(now) };
  }

  // ── «Новые» (H-7c) ──

  private audienceOf(page: FakePage): AudienceEvent[] {
    let events = this.audience.get(page.pageLabel);
    if (events === undefined) {
      events = Array.from({ length: AUDIENCE_SEEDS }, (_, n) => {
        const { claim: _claim, ...item } = SCENARIO_DATA.audienceItem(n, {
          trial: n === 1,
          ...(n === 2 ? { kind: 'returning', subscribedAtSource: 'subscribeAt' } : {}),
        });
        const subscribedAt = this.base - HOUR_MS * (n + 1);
        return {
          createdAt: subscribedAt,
          item: {
            ...item,
            eventRef: `evt-${page.pageId}-${1000 + n}`,
            subscribedAt: iso(subscribedAt),
            status: { ...item.status, endsAt: iso(this.base + 30 * DAY_MS), asOf: iso(this.base - 60_000) },
            thread: item.thread === null ? null : { ...item.thread, lastMessageAt: iso(subscribedAt), lastModelMessageAt: iso(subscribedAt) },
          },
        };
      });
      this.audience.set(page.pageLabel, events);
    }
    return events;
  }

  /**
   * `fanWrote` — the fan already wrote a message (one stored message of the fan's); `handSent` — a person greeted the
   * fan by hand in the site's composer (a send attribution of that moment).
   */
  addAudienceEvent(page: FakePage, fanRef: string, kind: 'new' | 'returning', trial: boolean, now: number, fanWrote = false, handSent = false): string {
    const events = this.audienceOf(page);
    const eventRef = `evt-${page.pageId}-${2000 + events.length}`;
    const { claim: _claim, ...seed } = SCENARIO_DATA.audienceItem(0);
    events.unshift({
      createdAt: now,
      item: {
        ...seed,
        eventRef,
        fanRef,
        username: `newfan_${fanRef}`,
        kind,
        trial,
        subscribedAt: iso(now),
        subscribedAtSource: 'notification',
        status: { isSubscriber: true, subscriptionStatus: 'active', endsAt: iso(now + 30 * DAY_MS), asOf: iso(now), source: 'webhook' },
        thread: fanWrote ? { lastMessageAt: iso(now), lastFanMessageAt: iso(now), lastModelMessageAt: null, storedMessageCount: 1, coverage: 'complete', backfillComplete: true } : null,
      },
    });
    if (handSent) {
      const platformMessageId = String(9_000_000 + this.attributions.size);
      this.attributions.set(`${page.pageLabel}|${platformMessageId}`, { pageLabel: page.pageLabel, userId: 0, source: 'chatspace-extension', platformMessageId, fanRef, observedAt: iso(now), priced: false, withMedia: false });
    }
    return eventRef;
  }

  audienceNew(page: FakePage, query: AudienceNewQuery, now: number, claim: (fanRef: string) => ClaimSummary): Read<AudienceNewPage> {
    let snapshotAt = now;
    let after: string | null = null;
    if (query.cursor !== undefined) {
      const cursor = this.cursors.open('an1', query.cursor);
      if (cursor === null || cursor['p'] !== page.pageLabel || typeof cursor['s'] !== 'number' || typeof cursor['k'] !== 'string') return no('bad_request', 'cursor_invalid');
      if (cursor['h'] !== query.windowHours) return no('bad_request', 'cursor_window_mismatch');
      snapshotAt = cursor['s'];
      after = cursor['k'];
    }
    const from = snapshotAt - query.windowHours * HOUR_MS;
    const inWindow = this.audienceOf(page)
      .filter((event) => event.createdAt <= snapshotAt && Date.parse(event.item.subscribedAt) >= from && Date.parse(event.item.subscribedAt) <= snapshotAt)
      .sort((a, b) => Date.parse(b.item.subscribedAt) - Date.parse(a.item.subscribedAt) || b.item.eventRef.localeCompare(a.item.eventRef));
    const start = after === null ? 0 : inWindow.findIndex((event) => event.item.eventRef === after) + 1;
    if (after !== null && start === 0) return no('bad_request', 'cursor_invalid');
    const limit = query.limit ?? 50;
    const slice = inWindow.slice(start, start + limit);
    const last = slice.at(-1);
    return ok({
      pageLabel: page.pageLabel,
      window: { hours: query.windowHours, from: iso(from), to: iso(snapshotAt), snapshotAt: iso(snapshotAt) },
      serverNow: iso(now),
      coverage: { state: 'complete', deliveryFrontier: iso(now - 90_000), lastAudienceSweepAt: iso(now - HOUR_MS), reasons: [] },
      unknownCount: 0,
      welcomeTemplate: { ref: 'welcome-1', observedAt: iso(this.base - DAY_MS), enabled: true, hasText: true, hasMedia: false, priceMills: null },
      items: slice.map((event) => ({ ...event.item, lastPersonalSendAt: this.personalSendAt(page, event.item), claim: claim(event.item.fanRef) })),
      nextCursor: last !== undefined && start + slice.length < inWindow.length ? this.cursors.sign('an1', { p: page.pageLabel, h: query.windowHours, s: snapshotAt, k: last.item.eventRef }) : null,
    });
  }

  /** As the hub: the newest send by hand to the fan (a send attribution) at or after the row's subscription. */
  private personalSendAt(page: FakePage, item: Pick<AudienceNewItem, 'fanRef' | 'subscribedAt'>): string | null {
    const sends = [...this.attributions.values()]
      .filter((row) => row.pageLabel === page.pageLabel && row.fanRef === item.fanRef && Date.parse(row.observedAt) >= Date.parse(item.subscribedAt))
      .map((row) => Date.parse(row.observedAt));
    return sends.length === 0 ? null : iso(Math.max(...sends));
  }

  // ── recaps and dossiers (H-13, H-5) ──

  /** Where a recap of a conversation about a fan is kept: the fan's own form, or the conversation's when it is not the fan (R20 F6b). */
  private recapKey(pageLabel: string, conversation: string, fanRef: string): string {
    return this.key(pageLabel, conversation === fanRef ? fanRef : `${conversation}\u0000${fanRef}`);
  }

  storeRecap(pageLabel: string, fanRef: string, slot: 'full' | 'short', body: RecapBody, conversation: string = fanRef): void {
    const key = this.recapKey(pageLabel, conversation, fanRef);
    const current = this.recaps.get(key) ?? { full: null, short: null };
    this.recaps.set(key, { ...current, [slot]: body });
  }

  /**
   * The shared recaps of a fan (H-13). By a conversation of its own (hub HF-10): the recaps of that conversation
   * stored about this fan, and those in the fan's own form — the freshest of each length. Never another fan's.
   */
  sharedRecaps(pageLabel: string, fanRef: string, personaDefinitionId: string | undefined, conversation: string = fanRef): SharedRecaps {
    const own = this.recaps.get(this.key(pageLabel, fanRef)) ?? { full: null, short: null };
    const group = conversation === fanRef ? { full: null, short: null } : (this.recaps.get(this.recapKey(pageLabel, conversation, fanRef)) ?? { full: null, short: null });
    const pick = (body: RecapBody | null): RecapBody | null => (body === null || personaDefinitionId === undefined || body.personaDefinitionId === personaDefinitionId ? body : null);
    const newest = (a: RecapBody | null, b: RecapBody | null): RecapBody | null => (a === null ? b : b === null || Date.parse(a.generatedAt) >= Date.parse(b.generatedAt) ? a : b);
    const full = newest(pick(group.full), pick(own.full));
    return { full, short: newest(pick(group.short), pick(own.short)), fullSavedToProfile: full !== null && this.dossierSource.get(this.key(pageLabel, fanRef)) === full.generationRef };
  }

  recapStatus(pageLabel: string, fanRef: string, personaDefinitionId: string | undefined, now: number, conversation: string = fanRef): RecapStatus {
    const { full, short } = this.sharedRecaps(pageLabel, fanRef, personaDefinitionId, conversation);
    const slot = (body: RecapBody | null): RecapStatus['full'] =>
      body === null
        ? null
        : {
            generatedAt: body.generatedAt,
            ageMs: Math.max(0, now - Date.parse(body.generatedAt)),
            transcriptCoverage: body.coverage.transcriptCoverage === 'full-history' || body.coverage.transcriptCoverage === 'window' ? body.coverage.transcriptCoverage : null,
            requestedCount: body.coverage.requestedCount,
            keptCount: body.coverage.keptCount,
          };
    return { full: slot(full), short: slot(short) };
  }

  dossier(page: FakePage, fanRef: string, spendersTotal: number): Read<Dossier> {
    if (!this.knowsFan(page, fanRef, spendersTotal)) return no('not_found');
    const named = fanRef === WORLD.fan;
    const seed = this.seedOf(fanRef);
    return ok({
      fan: {
        platform: page.platform,
        platformUserId: fanRef,
        username: seed?.username ?? (named ? 'fan_two' : `fan_${fanRef}`),
        displayName: seed?.displayName ?? (named ? 'Fan Two' : null),
        createdAtExternal: null,
        pageAlias: null,
      },
      profile: this.dossiers.get(this.key(page.pageLabel, fanRef)) ?? null,
    });
  }

  /** The fan's dossier as a prompt reads it (the latest saved full Recap); null — none. */
  dossierOf(pageLabel: string, fanRef: string): NonNullable<Dossier['profile']> | null {
    return this.dossiers.get(this.key(pageLabel, fanRef)) ?? null;
  }

  /** H-5: links a finished full recap into the dossier; idempotent per generation. */
  saveDossier(pageLabel: string, fanRef: string, generationRef: string, body: string, sourceGeneratedAt: number, userId: number, now: number): { outcome: 'created' | 'existing'; profile: NonNullable<Dossier['profile']> } {
    const key = this.key(pageLabel, fanRef);
    const current = this.dossiers.get(key);
    if (current !== undefined && this.dossierSource.get(key) === generationRef) return { outcome: 'existing', profile: current };
    const profile = { version: (current?.version ?? 0) + 1, body, source: 'chatmuse' as const, createdAt: iso(now), sourceGeneratedAt: iso(sourceGeneratedAt), createdByUserId: userId };
    this.dossiers.set(key, profile);
    this.dossierSource.set(key, generationRef);
    return { outcome: 'created', profile };
  }

  // ── own AI spend (H-15) ──

  aiUsage(page: FakePage, query: AiUsageQuery, userId: number, now: number, quota: number | null): Read<AiUsageReport> {
    const timeZone = query.timeZone ?? 'Europe/Moscow';
    if (!isKnownZone(timeZone)) return no('bad_request', 'unknown_time_zone');
    const today = localDate(now, timeZone);
    if (query.date > today) return no('bad_request', 'date_in_future');
    if (query.date < shiftDate(today, -8)) return no('bad_request', 'date_too_old');
    const days = query.days ?? 1;
    const report: AiUsageDay[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = shiftDate(query.date, -i);
      const from = zonedMidnight(date, timeZone);
      const toExclusive = zonedMidnight(shiftDate(date, 1), timeZone);
      const records = this.usage.filter((r) => r.userId === userId && r.pageLabel === page.pageLabel && r.at >= from && r.at < toExclusive);
      const totals = (list: readonly UsageRecord[]) => ({
        requestCount: list.length,
        costMicroUsd: list.reduce((sum, r) => sum + r.costMicroUsd, 0),
        costApproximate: false,
        tokens: {
          input: list.reduce((sum, r) => sum + r.tokens.input, 0),
          output: list.reduce((sum, r) => sum + r.tokens.output, 0),
          cacheWrite: list.reduce((sum, r) => sum + r.tokens.cacheWrite, 0),
          cacheRead: list.reduce((sum, r) => sum + r.tokens.cacheRead, 0),
        },
        completed: list.filter((r) => r.outcome === 'completed').length,
        failed: list.filter((r) => r.outcome === 'failed').length,
        cancelled: list.filter((r) => r.outcome === 'cancelled').length,
        quotaDenied: list.filter((r) => r.outcome === 'quota-denied').length,
        openReservations: list.filter((r) => r.outcome === 'open').length,
        regenerations: list.filter((r) => r.regeneration).length,
      });
      const open = now < toExclusive;
      const reservations = records.some((r) => r.outcome === 'open');
      report.push({
        date,
        from: iso(from),
        toExclusive: iso(toExclusive),
        coverage: open || reservations ? 'partial' : 'complete',
        coverageReasons: [...(open ? ['day_open'] : []), ...(reservations ? ['open_reservations'] : [])],
        totals: totals(records),
        features: [...new Set(records.map((r) => r.feature))].sort().map((feature) => ({ feature, ...totals(records.filter((r) => r.feature === feature)) })),
      });
    }
    return ok({
      scope: { pageLabel: page.pageLabel, userId },
      timeZone,
      asOf: iso(now),
      moneyUnit: 'micro-USD',
      days: report,
      quota: { dayBoundary: 'UTC', remainingRequestsToday: quota, remainingMicroUsdToday: null },
    });
  }

  // ── ingest ──

  /** Deduplicates by (user, clientEventId); `allowedKinds` null = any kind (a full token). */
  ingest(userId: number, batch: IngestBatch, allowedKinds: readonly string[] | null): Read<IngestResult> {
    if (allowedKinds !== null && batch.events.some((event) => !allowedKinds.includes(event.kind))) return no('bad_request', 'ingest_kind_not_allowed');
    let accepted = 0;
    let duplicates = 0;
    for (const event of batch.events) {
      const key = `${userId}\u0000${event.clientEventId}`;
      if (this.ingested.has(key)) duplicates += 1;
      else {
        this.ingested.set(key, event);
        accepted += 1;
      }
    }
    return ok({ accepted, duplicates });
  }

  ingestedEvents(): IngestBatch['events'] {
    return [...this.ingested.values()];
  }

  /**
   * 1.21.0 (X48), as the hub's `clientSendAttributions` does: the person is the token's, OnlyFans takes the extension
   * on ChatSpace and Fansly the extension on fansly.com (Chat Memory week 1; every Fansly fact names its group, else
   * 400), one row per message of a page — the first report wins, a repeat of the same person, fan and chat is
   * `duplicate`, anything else `conflict` — and a time more than 5 minutes ahead or 30 days back is `out_of_range`,
   * stored nowhere.
   */
  sendAttributions(page: FakePage, userId: number, request: SendAttributionsRequest, now: number): Read<SendAttributionsResult> {
    const admitted = page.platform === 'onlyfans' ? 'chatspace-extension' : page.platform === 'fansly' ? 'fansly-extension' : null;
    if (request.source !== admitted) return no('client_feature_disabled', 'platform_unsupported');
    if (admitted === 'fansly-extension' && request.facts.some((fact) => fact.conversationRef === undefined)) return no('bad_request', 'conversation_ref_required');
    const results = request.facts.map((fact) => {
      const at = Date.parse(fact.observedAt);
      if (at > now + 5 * 60_000 || at < now - 30 * DAY_MS) return { platformMessageId: fact.platformMessageId, outcome: 'out_of_range' };
      const key = `${page.pageLabel}|${fact.platformMessageId}`;
      const known = this.attributions.get(key);
      if (known === undefined) {
        this.attributions.set(key, { pageLabel: page.pageLabel, userId, source: request.source, ...fact });
        return { platformMessageId: fact.platformMessageId, outcome: 'recorded' };
      }
      return { platformMessageId: fact.platformMessageId, outcome: known.userId === userId && known.fanRef === fact.fanRef && known.conversationRef === fact.conversationRef ? 'duplicate' : 'conflict' };
    });
    return ok({ pageLabel: page.pageLabel, results, serverNow: iso(now) });
  }

  sendAttributionRows(): readonly FakeSendAttribution[] {
    return [...this.attributions.values()];
  }
}

/** One recorded send (X48): ids, the person, a time, two marks and how the text was written; never a text. */
export interface FakeSendAttribution {
  readonly pageLabel: string;
  readonly userId: number;
  readonly source: string;
  readonly platformMessageId: string;
  readonly fanRef: string;
  readonly conversationRef?: string | undefined;
  readonly observedAt: string;
  readonly priced: boolean;
  readonly withMedia: boolean;
  readonly composedWith?: string | undefined;
  readonly edited?: boolean | undefined;
}
