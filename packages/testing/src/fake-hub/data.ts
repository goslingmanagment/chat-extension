// The fake hub's read models (architecture.md §8.5, §8.7; hub H-5, H-7c, H-8,
// H-9c, H-13, H-15): Spenders (board, card, batch, tier buckets), statistics
// and «ждут ответа», the archive feed with its Ping summary, «Новые», shared
// recaps and dossiers, own AI spend, and the ingest store. Data is synthetic
// (scenarios/hub world and SCENARIO_DATA shapes), per page, relative to the
// hub clock. Cursors are opaque and signed: a forged one, or one of another
// page, fan or window, is refused the way the hub refuses it. Numbers are
// plausible, not the hub's formulas: the Ping segment rule below is a
// stand-in, the client never derives it anyway (it shows what it gets).

import {
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
import { iso } from './clock';
import { pageRefOf, type FakePage } from './config';

export interface Refusal {
  readonly error: HubErrorCode;
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

// ── the model ──────────────────────────────────────────────────────────────

interface ArchiveMessage extends FeedItem {
  readonly order: number;
}

interface Archive {
  revision: number;
  /** Newest first. */
  readonly messages: ArchiveMessage[];
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
const AUDIENCE_SEEDS = 5;
const QUEUE_SEEDS = 5;

export class DataModel {
  private readonly archives = new Map<string, Archive>();
  private readonly audience = new Map<string, AudienceEvent[]>();
  private readonly recaps = new Map<string, { full: RecapBody | null; short: RecapBody | null }>();
  private readonly dossiers = new Map<string, NonNullable<Dossier['profile']>>();
  /** generationRef of the dossier's current body (H-5 «existing»). */
  private readonly dossierSource = new Map<string, string>();
  private readonly ingested = new Map<string, IngestBatch['events'][number]>();
  readonly usage: UsageRecord[] = [];
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
  }

  private key(pageLabel: string, fanRef: string): string {
    return `${pageLabel}\u0000${fanRef}`;
  }

  // ── fans the archive knows ──

  /** Fans the page's archive and audience know (dossier lookups 404 for anyone else). */
  knowsFan(page: FakePage, fanRef: string, spendersTotal: number): boolean {
    if (fanRef === WORLD.fan) return true;
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
    return { kind: 'page', platform: 'onlyfans', pageCount: 1, page: pageRefOf(page), model: null };
  }

  private rows(total: number): SpenderListItem[] {
    return Array.from({ length: total }, (_, rank) => spenderRow(rank));
  }

  spenders(page: FakePage, query: SpendersQuery, now: number, total: number): Read<SpendersPage> {
    const needle = query.query?.toLowerCase();
    let rows = this.rows(total).filter(
      (row) =>
        (needle === undefined || (row.fan.username ?? '').toLowerCase().includes(needle) || (row.fan.displayName ?? '').toLowerCase().includes(needle)) &&
        (query.retentionStatus === undefined || query.retentionStatus === 'all' || row.retentionStatus === query.retentionStatus),
    );
    if (query.sortBy === 'username') rows = rows.sort((a, b) => (a.fan.username ?? '').localeCompare(b.fan.username ?? ''));
    else if (query.sortBy === 'lastTransactionAt') rows = rows.sort((a, b) => (b.metrics.window?.lastTransactionAt ?? '').localeCompare(a.metrics.window?.lastTransactionAt ?? ''));
    if (query.sortDir === 'asc') rows = rows.reverse();
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

  private row(platformUserId: string, total: number): SpenderListItem | null {
    const rank = Number(platformUserId) - SPENDER_FAN_BASE;
    return Number.isInteger(rank) && rank >= 0 && rank < total ? spenderRow(rank) : null;
  }

  private breakdown(row: SpenderListItem): SpenderDetail['typeBreakdown'] {
    const window = row.metrics.window;
    if (window === null) return [];
    return [{ canonicalType: row.lastTransaction?.canonicalType ?? 'tip', grossAmountMills: window.grossAmountMills, creatorNetAmountMills: window.creatorNetAmountMills, transactionCount: window.transactionCount }];
  }

  spenderDetail(page: FakePage, query: SpenderDetailQuery, now: number, total: number): Read<SpenderDetail> {
    const row = query.platform === 'onlyfans' ? this.row(query.platformUserId, total) : null;
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
        const row = fan.platform === 'onlyfans' ? this.row(fan.platformUserId, total) : null;
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

  autoLists(page: FakePage, now: number): Read<AutoLists> {
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
      const seeded = fanRef === WORLD.fan ? SCENARIO_DATA.feedTotal : this.knowsFanStatic(fanRef) ? 3 : 0;
      archive = {
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
    return fanRef === WORLD.fan || (n >= Number(WORLD.newFan) && n < Number(WORLD.newFan) + AUDIENCE_SEEDS) || (n >= SPENDER_FAN_BASE && n < SPENDER_FAN_BASE + 1240);
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

  feed(page: FakePage, query: FeedQuery, now: number): Read<FeedPage> {
    const archive = this.archive(page, query.fanRef);
    const all = archive.messages;
    let start = 0;
    if (query.cursor !== undefined) {
      const cursor = this.cursors.open('fd1', query.cursor);
      if (cursor === null || cursor['p'] !== page.pageLabel || cursor['f'] !== query.fanRef || typeof cursor['k'] !== 'string') return no('bad_request', 'cursor_invalid');
      const index = all.findIndex((m) => m.messageId === cursor['k']);
      if (index < 0) return no('bad_request', 'cursor_invalid');
      start = index + 1;
    }
    const limit = query.limit ?? 50;
    const items = all.slice(start, start + limit).map(({ order: _order, ...item }) => item);
    const last = items.at(-1);
    const head = all[0];
    const coverage = all.length === 0 ? 'unknown' : 'complete';
    const first = query.cursor === undefined;
    return ok({
      target: { pageLabel: page.pageLabel, fanRef: query.fanRef },
      source: 'union',
      snapshotRevision: `snap-${archive.revision}`,
      asOf: iso(now),
      coverage,
      head: head === undefined ? null : { messageRef: head.messageId, at: head.at, sender: head.sender },
      newestKnownAt: head?.at ?? null,
      nextOlderCursor: last !== undefined && start + items.length < all.length ? this.cursors.sign('fd1', { p: page.pageLabel, f: query.fanRef, k: last.messageId }) : null,
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

  addAudienceEvent(page: FakePage, fanRef: string, kind: 'new' | 'returning', trial: boolean, now: number): string {
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
        thread: null,
      },
    });
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
      items: slice.map((event) => ({ ...event.item, claim: claim(event.item.fanRef) })),
      nextCursor: last !== undefined && start + slice.length < inWindow.length ? this.cursors.sign('an1', { p: page.pageLabel, h: query.windowHours, s: snapshotAt, k: last.item.eventRef }) : null,
    });
  }

  // ── recaps and dossiers (H-13, H-5) ──

  storeRecap(pageLabel: string, fanRef: string, slot: 'full' | 'short', body: RecapBody): void {
    const key = this.key(pageLabel, fanRef);
    const current = this.recaps.get(key) ?? { full: null, short: null };
    this.recaps.set(key, { ...current, [slot]: body });
  }

  sharedRecaps(pageLabel: string, fanRef: string, personaDefinitionId: string | undefined): SharedRecaps {
    const stored = this.recaps.get(this.key(pageLabel, fanRef)) ?? { full: null, short: null };
    const pick = (body: RecapBody | null): RecapBody | null => (body === null || personaDefinitionId === undefined || body.personaDefinitionId === personaDefinitionId ? body : null);
    const full = pick(stored.full);
    return { full, short: pick(stored.short), fullSavedToProfile: full !== null && this.dossierSource.get(this.key(pageLabel, fanRef)) === full.generationRef };
  }

  recapStatus(pageLabel: string, fanRef: string, personaDefinitionId: string | undefined, now: number): RecapStatus {
    const { full, short } = this.sharedRecaps(pageLabel, fanRef, personaDefinitionId);
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
    return ok({
      fan: { platform: 'onlyfans', platformUserId: fanRef, username: named ? 'fan_two' : `fan_${fanRef}`, displayName: named ? 'Fan Two' : null, createdAtExternal: null, pageAlias: null },
      profile: this.dossiers.get(this.key(page.pageLabel, fanRef)) ?? null,
    });
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
}
