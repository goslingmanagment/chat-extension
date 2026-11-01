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
// or tombstoned (the window check of hub HF-8в). In the showcase world
// (src/showcase.ts) its stock lines read as a working day's (showcase.ts).

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
  type OnlyfansFeedRequest,
  type OnlyfansFeedResult,
  type OnlyfansPollPass,
  type OnlyfansPollResult,
  type IngestResult,
  type QueuePage,
  type QueueQuery,
  type RecapBody,
  type RecapStatus,
  type SendAttributionsRequest,
  type SendAttributionsResult,
  type FanNoteAttributions,
  type NoteAttributionsRequest,
  type NoteAttributionsResult,
  type ActivityBeatRequest,
  type ActivityBeatResult,
  type InConversationResult,
  type FanCard,
  type FanFactChangeRequest,
  type FanFactChangeResult,
  type FanLinkDecideRequest,
  type FanLinkDecideResult,
  type FanCardCustom,
  type FanCustomChangeRequest,
  type FanCustomCreateRequest,
  type Handoff,
  type WinBackAttemptRequest,
  type WinBackAttemptResult,
  type WinBackList,
  type FanQueueItemDone,
  type FanQueueItemDoneRequest,
  type FanQueueRelease,
  type FanQueueReleaseRequest,
  type FanQueueTake,
  type FanQueueTakeRequest,
  type FanQueues,
  type OnlineAttemptRequest,
  type OnlineAttemptResult,
  type OnlineList,
  type OnlinePresenceRequest,
  type OnlinePresenceResult,
  type OnlineProbeResult,
  type OnlineQuery,
  type OnlineTemplate,
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
import { SHOWCASE } from '../showcase';
import { classifyPair, type PairState, type ServedRef, type StoreState } from './ai-rules';
import { iso } from './clock';
import { pageRefOf, type FakePage } from './config';
import { FanQueuesModel, type FanQueuesSet } from './fan-queues';
import { OutreachModel } from './outreach';
import { FakeOnlyfansFeed, type FakeFeedRecord, type FakeFeedTransaction, type FeedArchiveMessage } from './onlyfans-feed';
import { ONLINE_RULES, ONLINE_SEEN_SOURCES, OnlineModel, type OnlineFacts, type OnlineSeed, type OnlineWorld, type OthersTalking } from './online';
import { SHOWCASE_NEW_MESSAGE, showcaseFirstDay, showcaseStats, showcaseSubscriber } from './showcase';
import { type CoachDepthKnob, type FakeFanQueueDone, type FakeOnlineAttempt, type FakeOnlinePresenceReport, type FakeOnlineProbe, type SpenderSeed } from './types';

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
  /** What the site shows of it (the showcase world's mirror of a stand chat); absent — the archive's synthetic text. */
  readonly text?: string;
  /** When it was written, ISO; absent — a minute apart, before the hub's start. */
  readonly at?: string;
  /** A paid message's price. */
  readonly priceMills?: number;
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

/**
 * «Онлайн» of the stand (no scenario's list): the board's first fans, each seen this many minutes before «now» (the
 * ninth outside the window's default half hour), the ones OnlyFansAPI holds online now on an OnlyFans page, and the
 * stories of a working day on top of what the board says: the first fan who never wrote subscribed yesterday, the
 * second fan's subscription ends in two days without renewal, the seventh has a short chat (below Ping's 10).
 */
const ONLINE_STAND = { seenAgoMin: [1, 4, 2, 6, 9, 3, 13, 18, 41, 7], onlineNow: [0, 2, 5], expiring: 1, shortChat: 6 } as const;

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
  /** Who wrote each Fansly note, by `page|event`; the first report wins (hub client_note_attributions). */
  private readonly noteWrites = new Map<string, FakeNoteAttribution>();
  /** Chat Memory week 1: every beat, in order (tests read them; ids and idle only). */
  private readonly beats: FakeActivityBeat[] = [];
  /** Chat Memory week 2: the fans' cards a scenario set (`fanCard`), by `page|fan`. */
  private readonly cards = new Map<string, FanCard>();
  /** Chat Memory week 3: «Очередь» a scenario set (`queue`), by page. */
  private readonly queues = new Map<string, { waiting?: QueuePage['items']; winBack?: WinBackList; handoff?: Handoff }>();
  private winBackAttempts = 0;
  /** «Онлайн»: a scenario's lists, the Fansly tabs' presence reports, what the chatters did in the window. */
  private readonly onlineModel = new OnlineModel();
  /** hub #953: the OnlyFans feed the tabs reported (onlyfans-feed.ts). */
  private readonly feedModel = new FakeOnlyfansFeed();
  /** «Очереди»: a scenario's queues of a page, their portions and what the chatters reported of each fan. */
  private readonly queuesModel = new FanQueuesModel();
  /** «Рассылки» kept by the hub, the page's team's (`outreach-store-v1`). */
  readonly outreach = new OutreachModel();
  private queueMessageId = 8_800_000_000;
  /** Chat Memory week 1: another chatter's message to a fan, set by a scenario (`talking`): «в разговоре» without a send. */
  private readonly talking: FakeTalking[] = [];
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
    const preview = last === null ? null : (seed.preview ?? (last === weWrote ? OUR_PREVIEWS : FAN_PREVIEWS)[rank % 4] ?? null);
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
      ...(seed.lookupMissAgoSec === undefined ? {} : { accountLookupMissAt: iso(now - seed.lookupMissAgoSec * 1000) }),
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
    if (SHOWCASE) return ok(showcaseStats(now, query.timeZone, page.pageLabel, { total: queue.length, unknown: queue.filter((item) => item.readState === 'unknown').length }));
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
    const set = this.queues.get(page.pageLabel)?.waiting;
    if (set !== undefined) return set;
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
      // The showcase world's fan the stand does not show: the lines of a first day instead of the synthetic ones.
      const firstDay = SHOWCASE && fanRef !== WORLD.fan ? showcaseFirstDay(fanRef) : null;
      archive = {
        generation: 1,
        revision: 1,
        messages: Array.from({ length: seeded }, (_, n) => {
          const item = SCENARIO_DATA.feedItem(n);
          const line = firstDay?.[n];
          return {
            ...item,
            ...(line === undefined ? {} : { sender: line.sender, text: line.text, tipMills: null, priceMills: null, attachmentLabels: [], deleted: false }),
            at: iso(this.base - 600_000 * n),
            messageId: fanRef === WORLD.fan ? item.messageId : `${fanRef}${String(n).padStart(3, '0')}`,
            order: -(n + 1),
          };
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
      text: SHOWCASE ? SHOWCASE_NEW_MESSAGE[sender] : sender === 'fan' ? 'new synthetic fan message' : 'new synthetic model message',
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

  /**
   * As the hub's `clientOnlyfansFeed` (hub #953): every record journaled with its reporter; a message lands in the
   * fan's archive — the preview's feed and the AI's transcript — in its place by time, a deletion tombstones it there,
   * and money reaches the page's transactions once.
   */
  onlyfansFeed(page: FakePage, userId: number, request: OnlyfansFeedRequest, now: number): Read<OnlyfansFeedResult> {
    return ok(
      this.feedModel.report(userId, request, now, {
        message: (_label, message) => this.feedArchiveMessage(page, message),
        deleted: (_label, messageId) => this.feedArchiveDeleted(page, messageId),
      }),
    );
  }

  /** As the hub's `clientOnlyfansPoll` (hub #955): the page's poll lent to one tab every ten minutes. */
  onlyfansPoll(page: FakePage, now: number, passed?: OnlyfansPollPass): Read<OnlyfansPollResult> {
    return ok(this.feedModel.poll(page.pageLabel, now, passed));
  }

  /** hub #953: every record the tabs reported, in order, with who reported it and what the fake hub did with it. */
  onlyfansFeedRecords(): readonly FakeFeedRecord[] {
    return this.feedModel.records();
  }

  /** hub #961: the poll holders' reports of their passes, in order. */
  onlyfansFeedPasses(): readonly { readonly pageLabel: string; readonly at: string; readonly subscribers: boolean; readonly ledger: boolean }[] {
    return [...this.feedModel.passes];
  }

  /** hub #953: the transactions the feed wrote, with the sightings each one counts. */
  onlyfansFeedTransactions(): readonly FakeFeedTransaction[] {
    return this.feedModel.transactions();
  }

  private feedArchiveMessage(page: FakePage, message: FeedArchiveMessage): void {
    const archive = this.archive(page, message.fanRef);
    const item = {
      messageId: message.messageId,
      at: message.at,
      sender: message.sender,
      text: message.text,
      automatic: message.automatic,
      deleted: false,
      tipMills: message.tipMills,
      priceMills: message.priceMills,
      attachmentLabels: [],
    };
    const at = archive.messages.findIndex((existing) => existing.messageId === message.messageId);
    if (at >= 0) {
      const existing = archive.messages[at] as ArchiveMessage;
      archive.messages[at] = { ...existing, ...item, deleted: existing.deleted };
    } else {
      this.archiveOrder += 1;
      const time = Date.parse(message.at);
      const place = archive.messages.findIndex((existing) => existing.at === null || Date.parse(existing.at) <= time);
      const entry: ArchiveMessage = { ...item, order: this.archiveOrder };
      if (place < 0) archive.messages.push(entry);
      else archive.messages.splice(place, 0, entry);
    }
    archive.revision += 1;
  }

  private feedArchiveDeleted(page: FakePage, messageId: string): void {
    for (const [key, archive] of this.archives) {
      if (!key.startsWith(`${page.pageLabel}\u0000`)) continue;
      const at = archive.messages.findIndex((existing) => existing.messageId === messageId);
      if (at < 0) continue;
      archive.messages[at] = { ...(archive.messages[at] as ArchiveMessage), deleted: true };
      archive.revision += 1;
    }
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
      at: message.at ?? iso(this.base - 60_000 * (count - index)),
      sender: message.sender,
      text: message.text ?? (message.sender === 'fan' ? 'seeded synthetic fan message' : 'seeded synthetic model message'),
      automatic: null,
      deleted: message.state === 'deleted',
      tipMills: null,
      priceMills: message.priceMills ?? null,
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
  /**
   * `depth` (2026-10-27, `coach-depth-v1`): whether the hub dates depths, and the `coachDepth` knob's long conversation —
   * null: the archive as it is.
   */
  feed(page: FakePage, query: FeedQuery, now: number, userId: number, conversation: string = query.fanRef, depth: { readonly served: boolean; readonly knob: CoachDepthKnob | null } = { served: false, knob: null }): Read<FeedPage> {
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
      // 2026-10-27: a first page that asks dates its depths (hub `depthMarks` → `depth`), from a hub that serves it.
      ...(first && depth.served && query.depthMarks !== undefined ? { depth: this.feedDepth(all, query.depthMarks, coverage, now, depth.knob) } : {}),
    });
  }

  /**
   * How deep the archive goes (hub `clientConversationFeed.depth`): its count, the oldest message's time, whether it
   * holds the chat from its start, and the time of each asked newest-first count it holds. The `coachDepth` knob stands
   * for a long conversation: its count, its oldest message `oldestDays` ago, older messages sparser than recent ones.
   */
  private feedDepth(all: readonly FeedItem[], marks: string, coverage: string, now: number, knob: CoachDepthKnob | null): NonNullable<FeedPage['depth']> {
    const counts = [...new Set(marks.split(',').map(Number))].filter((count) => Number.isInteger(count) && count >= 1).sort((a, b) => a - b);
    if (knob !== null) {
      const at = (count: number): string => iso(now - knob.oldestDays * DAY_MS * Math.pow(Math.min(1, count / knob.stored), 1.33));
      return { storedCount: knob.stored, oldestAt: at(knob.stored), historyComplete: true, marks: counts.filter((count) => count <= knob.stored).map((count) => ({ count, at: at(count) })) };
    }
    return {
      storedCount: all.length,
      oldestAt: all.at(-1)?.at ?? null,
      historyComplete: coverage === 'complete',
      marks: counts.filter((count) => count <= all.length).map((count) => ({ count, at: all[count - 1]?.at ?? null })),
    };
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
            ...(SHOWCASE ? showcaseSubscriber(n) : {}),
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
  addAudienceEvent(page: FakePage, fanRef: string, kind: 'new' | 'returning', trial: boolean, now: number, fanWrote = false, handSent = false, named: { readonly username?: string; readonly displayName?: string } = {}): string {
    const events = this.audienceOf(page);
    const eventRef = `evt-${page.pageId}-${2000 + events.length}`;
    const { claim: _claim, ...seed } = SCENARIO_DATA.audienceItem(0);
    events.unshift({
      createdAt: now,
      item: {
        ...seed,
        eventRef,
        fanRef,
        // A name the scenario gives; the showcase world's person; else the synthetic handle.
        ...(SHOWCASE ? showcaseSubscriber(Number(BigInt(fanRef) % 97n) + events.length) : { username: `newfan_${fanRef}` }),
        ...(named.username === undefined ? {} : { username: named.username }),
        ...(named.displayName === undefined ? {} : { displayName: named.displayName }),
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

  /**
   * As the hub's `clientNoteAttributions`: Fansly's on Fansly pages, ChatSpace's on OnlyFans ones (hub #912), the person
   * is the token's, one row per event of a page —
   * the first report wins, a repeat of the same person, note and action is `duplicate`, anything else `conflict` — and
   * a time more than 5 minutes ahead or 30 days back is `out_of_range`, stored nowhere.
   */
  noteAttributions(page: FakePage, userId: number, request: NoteAttributionsRequest, now: number): Read<NoteAttributionsResult> {
    const admitted = page.platform === 'fansly' ? 'fansly-extension' : page.platform === 'onlyfans' ? 'chatspace-extension' : null;
    if (request.source !== admitted) return no('client_feature_disabled', 'platform_unsupported');
    const results = request.facts.map((fact) => {
      const at = Date.parse(fact.observedAt);
      if (at > now + 5 * 60_000 || at < now - 30 * DAY_MS) return { eventId: fact.eventId, outcome: 'out_of_range' };
      const key = `${page.pageLabel}|${fact.eventId.toLowerCase()}`;
      const known = this.noteWrites.get(key);
      if (known === undefined) {
        this.noteWrites.set(key, { pageLabel: page.pageLabel, userId, source: request.source, ...fact });
        return { eventId: fact.eventId, outcome: 'recorded' };
      }
      const same = known.userId === userId && known.fanRef === fact.fanRef && known.noteRef === fact.noteRef && known.noteKind === fact.noteKind && known.action === fact.action;
      return { eventId: fact.eventId, outcome: same ? 'duplicate' : 'conflict' };
    });
    return ok({ pageLabel: page.pageLabel, results, serverNow: iso(now) });
  }

  noteAttributionRows(): readonly FakeNoteAttribution[] {
    return [...this.noteWrites.values()];
  }

  /** A scenario's record of a write made before the run (another chatter's), as if reported then. */
  seedNoteAttribution(row: FakeNoteAttribution): void {
    this.noteWrites.set(`${row.pageLabel}|${row.eventId.toLowerCase()}`, row);
  }

  /**
   * As the hub's `clientFanNoteAttributions` (hub #912): each note of the fan with a recorded write, the latest written
   * first — its earliest `created` and its latest `edited`; a note whose latest write is a delete is left out.
   */
  fanNoteAttributions(page: FakePage, fanRef: string, me: number, name: (userId: number) => string, now: number): FanNoteAttributions {
    const byNote = new Map<string, FakeNoteAttribution[]>();
    for (const row of this.noteWrites.values()) {
      if (row.pageLabel !== page.pageLabel || row.fanRef !== fanRef) continue;
      byNote.set(row.noteRef, [...(byNote.get(row.noteRef) ?? []), row]);
    }
    const who = (row: FakeNoteAttribution | undefined) => (row === undefined ? null : { userId: row.userId, name: row.name ?? name(row.userId), isMe: row.userId === me, at: row.observedAt });
    const notes = [...byNote.entries()]
      .map(([noteRef, rows]) => {
        const sorted = [...rows].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
        return { noteRef, rows: sorted, last: sorted.at(-1) as FakeNoteAttribution };
      })
      .filter((note) => note.last.action !== 'deleted')
      .sort((a, b) => Date.parse(b.last.observedAt) - Date.parse(a.last.observedAt))
      .slice(0, 200)
      .map(({ noteRef, rows, last }) => ({
        noteRef,
        noteKind: last.noteKind,
        created: who(rows.find((row) => row.action === 'created')),
        edited: who([...rows].reverse().find((row) => row.action === 'edited')),
      }));
    return { pageLabel: page.pageLabel, fanRef, notes, serverNow: iso(now) };
  }

  /** Chat Memory week 1, as the hub's `clientActivity`: each named page granted to the caller is recorded, others skipped. */
  activity(userId: number, request: ActivityBeatRequest, granted: (pageLabel: string) => boolean, now: number): Read<ActivityBeatResult> {
    const pages = request.pages.filter((page) => granted(page.pageLabel));
    this.beats.push({ userId, instanceId: request.instanceId, pages, closed: request.closed === true, at: now });
    return ok({ recorded: pages.length, serverNow: iso(now) });
  }

  activityBeats(): readonly FakeActivityBeat[] {
    return [...this.beats];
  }

  /** A scenario's card of a fan (Chat Memory week 2). */
  setFanCard(pageLabel: string, fanRef: string, card: FanCard): void {
    this.cards.set(`${pageLabel}|${fanRef}`, card);
  }

  /** As the hub's `clientFanCard`: the card a scenario set, else a fan nobody knows yet. */
  fanCard(page: FakePage, fanRef: string, now: number): FanCard {
    const card = this.cards.get(`${page.pageLabel}|${fanRef}`);
    return card === undefined ? { pageLabel: page.pageLabel, fanRef, known: false, accounts: [], pages: [], suggestions: [], facts: [], serverNow: iso(now) } : { ...card, serverNow: iso(now) };
  }

  /** As the hub's `clientFanLinkDecide`: only a pair the card suggests (409 `not_suggested`); `same` joins its account and pages. */
  fanLinkDecide(page: FakePage, request: FanLinkDecideRequest, by: string, now: number): Read<FanLinkDecideResult> {
    const card = this.fanCard(page, request.fanRef, now);
    const suggestion = card.suggestions.find((item) => item.platform === request.otherPlatform && item.fanRef === request.otherFanRef);
    if (suggestion === undefined) return no('conflict', 'not_suggested');
    const { reason: _reason, shared: _shared, sharedOn: _on, pages, ...account } = suggestion;
    const next: FanCard = {
      ...card,
      suggestions: card.suggestions.filter((item) => item !== suggestion),
      ...(request.decision === 'same' ? { accounts: [...card.accounts, { ...account, linkedBy: by }], pages: [...card.pages, ...pages].sort((a, b) => b.spentMills - a.spentMills) } : {}),
    };
    this.setFanCard(page.pageLabel, request.fanRef, next);
    return ok({ decision: request.decision, recorded: true, card: next });
  }

  /** As the hub's `clientFanFactChange`: a fact of a page the caller works; a fact no longer there changes nothing. */
  fanFactChange(page: FakePage, request: FanFactChangeRequest, by: string, now: number): Read<FanFactChangeResult> {
    const card = this.fanCard(page, request.fanRef, now);
    const fact = card.facts.find((item) => item.id === request.factId);
    if (fact === undefined) return ok({ changed: false, card });
    if (!fact.granted) return no('client_feature_disabled', 'not_granted');
    const facts = request.action === 'delete' ? card.facts.filter((item) => item !== fact) : card.facts.map((item) => (item === fact ? { ...item, text: request.text, source: 'chatter', author: by } : item));
    const next = { ...card, facts };
    this.setFanCard(page.pageLabel, request.fanRef, next);
    return ok({ changed: true, card: next });
  }

  setQueue(pageLabel: string, set: { readonly waiting?: QueuePage['items']; readonly winBack?: WinBackList; readonly handoff?: Handoff }): void {
    this.queues.set(pageLabel, { ...this.queues.get(pageLabel), ...set });
  }

  /** As the hub's `clientWinBack`: the list a scenario set, else nobody to win back. */
  winBack(page: FakePage, now: number): WinBackList {
    const set = this.queues.get(page.pageLabel)?.winBack;
    return set === undefined ? { pageLabel: page.pageLabel, approaches: [], items: [], serverNow: iso(now) } : { ...set, serverNow: iso(now) };
  }

  /** As the hub's `clientWinBackAttempt`: only a fan on the list and an approach of it (409 `not_listed` / `approach_inactive`); the fan leaves the list. */
  winBackAttempt(page: FakePage, request: WinBackAttemptRequest, now: number): Read<WinBackAttemptResult> {
    const list = this.winBack(page, now);
    if (!list.items.some((item) => item.fanRef === request.fanRef)) return no('conflict', 'not_listed');
    if (!list.approaches.some((approach) => approach.id === request.approachId)) return no('conflict', 'approach_inactive');
    const next = { ...list, items: list.items.filter((item) => item.fanRef !== request.fanRef) };
    this.setQueue(page.pageLabel, { winBack: next });
    this.winBackAttempts += 1;
    return ok({ attemptId: this.winBackAttempts, list: next });
  }

  // ── «Онлайн» (hub #879; online.ts) ──

  /** A scenario's «Онлайн» of a page: its items and templates; `null` — back to the stand's fans or the guide. */
  setOnline(pageLabel: string, set: { readonly items?: readonly OnlineSeed[] | null; readonly templates?: readonly OnlineTemplate[] | null }): void {
    this.onlineModel.set(pageLabel, set);
  }

  /**
   * What «Онлайн» reads of this model: the board's first fans with their stories (none with `stand` off — the page
   * has only its tabs' word), a reported fan, «в разговоре».
   */
  private onlineWorld(page: FakePage, userId: number, names: (userId: number) => string, now: number, total: number, stand = true): OnlineWorld {
    const others = new Map<string, OthersTalking>();
    const talking = this.inConversation(page, userId, names, now);
    for (const fan of talking.ok ? talking.body.fans : []) {
      const chatters = fan.chatters.filter((chatter) => !chatter.isMe);
      const newest = chatters[0];
      if (newest !== undefined) others.set(fan.fanRef, { names: chatters.map((chatter) => chatter.name), lastSentAt: Date.parse(newest.lastSentAt) });
    }
    return {
      stand: () => (stand ? this.onlineStand(page, now, total) : []),
      known: (fanRef) => {
        const row = this.row(page, fanRef, total, now);
        if (row !== null) return { ...this.onlineFactsOf(page, row), seenAt: null, onlineSince: null, seenSource: null };
        // A follower the board does not have: the hub knows no chat, no money, no subscription of his.
        return {
          fanRef,
          conversationRef: CHAT_IS_FAN[page.platform] ? fanRef : this.threadOf(page.pageLabel, fanRef),
          username: null,
          displayName: null,
          alias: null,
          lifetimeGrossMills: 0,
          last30dGrossMills: 0,
          seenAt: null,
          onlineSince: null,
          seenSource: null,
          lastFanMessageAt: null,
          answeredAt: null,
          isSubscriber: false,
          startedAt: null,
          endsAt: null,
          autoRenew: null,
          messageCount: 0,
        };
      },
      others,
    };
  }

  /** A board row's facts as «Онлайн» reads them (no moment yet, a plain subscription). */
  private onlineFactsOf(page: FakePage, row: SpenderListItem): OnlineFacts {
    const at = (value: string | null): number | null => (value === null ? null : Date.parse(value));
    const fanWrote = at(row.conversation.lastFanMessageAt);
    const weWrote = at(row.conversation.lastModelMessageAt);
    return {
      fanRef: row.fan.platformUserId,
      conversationRef: CHAT_IS_FAN[page.platform] ? row.fan.platformUserId : row.conversation.platformConversationId,
      username: row.fan.username,
      displayName: row.fan.displayName,
      alias: row.fan.pageAlias,
      lifetimeGrossMills: row.metrics.lifetime.scopeGrossAmountMills,
      last30dGrossMills: row.metrics.window?.grossAmountMills ?? 0,
      seenAt: null,
      onlineSince: null,
      seenSource: page.platform === 'onlyfans' ? ONLINE_SEEN_SOURCES.ofapi : ONLINE_SEEN_SOURCES.fanslyFollowers,
      lastFanMessageAt: fanWrote,
      answeredAt: weWrote,
      isSubscriber: true,
      startedAt: null,
      endsAt: null,
      autoRenew: null,
      messageCount: fanWrote === null && weWrote === null ? 0 : Math.min(10, row.conversation.storedMessageCount),
    };
  }

  /** The stand's fans of a page seen online lately (ONLINE_STAND): the board's first rows, with their stories. */
  private onlineStand(page: FakePage, now: number, total: number): OnlineFacts[] {
    const count = ONLINE_STAND.seenAgoMin.length;
    const rows = this.rows(page, Math.min(total, count), now).slice(0, count);
    const fresh = rows.findIndex((row) => row.conversation.lastFanMessageAt === null);
    return rows.map((row, index) => {
      const facts = this.onlineFactsOf(page, row);
      const ago = (ONLINE_STAND.seenAgoMin[index] ?? 30) * 60_000;
      const started = index === fresh ? now - 20 * HOUR_MS : now - (45 + 9 * index) * DAY_MS;
      return {
        ...facts,
        seenAt: now - ago,
        onlineSince: page.platform === 'onlyfans' && (ONLINE_STAND.onlineNow as readonly number[]).includes(index) ? now - ago - 3 * 60_000 : null,
        startedAt: started,
        endsAt: index === ONLINE_STAND.expiring ? now + 2 * DAY_MS : index === fresh ? started + 30 * DAY_MS : now + (6 + 2 * index) * DAY_MS,
        autoRenew: index !== ONLINE_STAND.expiring,
        messageCount: index === ONLINE_STAND.shortChat ? 4 : facts.messageCount,
      };
    });
  }

  // ── «Очереди» (hub fan queues; fan-queues.ts) ──

  /**
   * A scenario's queues of a page (`fanQueues`): `stand` — the prototype's over the page's first board fans (the stand's
   * chats), their archives made to fit their stories; null — none.
   */
  setFanQueues(page: FakePage, set: FanQueuesSet, me: { readonly userId: number; readonly name: string }, total: () => number): void {
    this.queuesModel.set(page, set, (now) => ({
      board: this.rows(page, Math.min(total(), 16), now)
        .slice(0, 16)
        .map((row) => this.onlineFactsOf(page, row)),
      me,
      conversation: (ref, messages) => {
        const seeded = messages.map((message) => {
          this.queueMessageId += 1;
          return { id: String(this.queueMessageId), sender: message.sender, text: message.text, at: iso(message.at) };
        });
        this.seedConversation(page, ref, seeded, false);
      },
    }));
  }

  /** As the hub's `clientFanQueues`. */
  fanQueues(page: FakePage, userId: number, now: number): Read<FanQueues> {
    return this.queuesModel.list(page, userId, now);
  }

  /** As the hub's `clientFanQueueTake`. */
  fanQueueTake(page: FakePage, userId: number, request: FanQueueTakeRequest, now: number): Read<FanQueueTake> {
    return this.queuesModel.take(page, userId, request, now);
  }

  /** As the hub's `clientFanQueueItemDone`. */
  fanQueueDone(page: FakePage, userId: number, request: FanQueueItemDoneRequest, now: number): Read<FanQueueItemDone> {
    return this.queuesModel.done(page, userId, request, now);
  }

  /** As the hub's `clientFanQueueRelease`. */
  fanQueueRelease(page: FakePage, userId: number, request: FanQueueReleaseRequest, now: number): Read<FanQueueRelease> {
    return this.queuesModel.release(page, userId, request, now);
  }

  /** «Очереди»: what the chatters reported of each fan, in order. */
  fanQueueReports(): readonly FakeFanQueueDone[] {
    return this.queuesModel.reports();
  }

  /**
   * As the hub's `clientOnline` (online.ts): the page's fans seen online within `minutes`, why to write now and with
   * what; `stand` off — no presence of the stand's own, only what the tabs reported.
   */
  online(page: FakePage, query: OnlineQuery, userId: number, names: (userId: number) => string, now: number, total: number, stand = true): Read<OnlineList> {
    return ok(this.onlineModel.list(page, query.minutes, this.onlineWorld(page, userId, names, now, total, stand), now));
  }

  /** As the hub's `clientOnlinePresence`: a Fansly page's followers its tab saw active, an OnlyFans page's fans ChatSpace found online. */
  onlinePresence(page: FakePage, userId: number, request: OnlinePresenceRequest, now: number, total: number): Read<OnlinePresenceResult> {
    return this.onlineModel.report(page, userId, request, now, (fanRef) => this.knowsFan(page, fanRef, total));
  }

  /** As the hub's `clientOnlineProbe` (hub #952): the page's probe, with the board's paying fans, the most paid first. */
  onlineProbe(page: FakePage, userId: number, now: number, total: number): Read<OnlineProbeResult> {
    const spenders = (): string[] =>
      this.rows(page, Math.min(total, ONLINE_RULES.probeMax), now)
        .filter((row) => row.metrics.lifetime.scopeGrossAmountMills > 0)
        .sort((a, b) => b.metrics.lifetime.scopeGrossAmountMills - a.metrics.lifetime.scopeGrossAmountMills)
        .map((row) => row.fan.platformUserId);
    return this.onlineModel.probe(page, userId, spenders, now);
  }

  /** «Онлайн»: every lend of a page's probe, in order. */
  onlineProbes(): readonly FakeOnlineProbe[] {
    return this.onlineModel.probeRows();
  }

  /** As the hub's `clientOnlineAttempt`: a fan the page has (its list, its board, its archive, a report), else 409 `not_listed`. */
  onlineAttempt(page: FakePage, userId: number, by: string, request: OnlineAttemptRequest, now: number, total: number): Read<OnlineAttemptResult> {
    const linked = this.knowsFan(page, request.fanRef, total) || this.onlineModel.listed(page, this.onlineWorld(page, userId, () => by, now, total), request.fanRef, now);
    return this.onlineModel.attempt(page, userId, by, request, linked, now);
  }

  /** What the chatters did in «Онлайн», in order (ids, actions, times). */
  onlineAttempts(): readonly FakeOnlineAttempt[] {
    return this.onlineModel.attemptRows();
  }

  /** The Fansly tabs' presence reports, in order. */
  onlinePresenceReports(): readonly FakeOnlinePresenceReport[] {
    return this.onlineModel.presenceReports();
  }

  /** As the hub's `clientHandoff`: the handoff a scenario set, else nobody written to and the awaiting queue's head. */
  handoff(page: FakePage, now: number): Handoff {
    const set = this.queues.get(page.pageLabel)?.handoff;
    if (set !== undefined) return { ...set, serverNow: iso(now) };
    const waiting = this.queue(page, now);
    return {
      pageLabel: page.pageLabel,
      recent: [],
      waiting: { total: waiting.length, head: waiting.slice(0, 10).map((item) => ({ fanRef: item.fanRef, conversationRef: item.conversationRef ?? null, username: item.username, alias: item.alias ?? null, lifetimeGrossMills: item.lifetimeGrossMills, lastFanMessageAt: item.lastFanMessageAt })) },
      promises: [],
      serverNow: iso(now),
    };
  }

  /** As the hub's `clientFanCustomCreate`: paid by a tip of `customPayments` (else 409 `not_suggested`) or waiting for it. */
  fanCustomCreate(page: FakePage, request: FanCustomCreateRequest, by: string, now: number): Read<FanFactChangeResult> {
    const card = this.fanCard(page, request.fanRef, now);
    const payments = card.customPayments ?? [];
    const payment = request.paymentRef === undefined ? null : (payments.find((item) => item.paymentRef === request.paymentRef) ?? null);
    if (request.paymentRef !== undefined && payment === null) return no('conflict', 'not_suggested');
    const customs = card.customs ?? [];
    const custom: FanCardCustom = {
      id: Math.max(0, ...customs.map((item) => item.id)) + 1,
      pageLabel: page.pageLabel,
      granted: true,
      description: request.description.trim(),
      priceMills: request.priceMills ?? null,
      state: payment === null ? 'ordered' : 'paid',
      paymentMills: payment?.amountMills ?? null,
      paidAt: payment?.at ?? null,
      deliveredMessageRef: null,
      deliveredAt: null,
      createdBy: by,
      createdAt: iso(now),
      deliveryCandidates: [],
    };
    const next = { ...card, customs: [custom, ...customs], customPayments: payments.filter((item) => item !== payment) };
    this.setFanCard(page.pageLabel, request.fanRef, next);
    return ok({ changed: true, card: next });
  }

  /** As the hub's `clientFanCustomChange`: only by the card's suggestions (409 `not_suggested`); delivered or cancelled is final. */
  fanCustomChange(page: FakePage, request: FanCustomChangeRequest, now: number): Read<FanFactChangeResult> {
    const card = this.fanCard(page, request.fanRef, now);
    const customs = card.customs ?? [];
    const custom = customs.find((item) => item.id === request.customId);
    if (custom === undefined) return no('not_found', 'custom_not_found');
    if (!custom.granted) return no('client_feature_disabled', 'not_granted');
    if (custom.state === 'delivered' || custom.state === 'cancelled') return ok({ changed: false, card });
    const payments = card.customPayments ?? [];
    let changed: FanCardCustom;
    let left = payments;
    if (request.action === 'paid') {
      const payment = payments.find((item) => item.paymentRef === request.paymentRef);
      if (payment === undefined) return no('conflict', 'not_suggested');
      changed = { ...custom, state: 'paid', paymentMills: payment.amountMills, paidAt: payment.at };
      left = payments.filter((item) => item !== payment);
    } else if (request.action === 'delivered') {
      const candidate = custom.deliveryCandidates.find((item) => item.messageRef === request.messageRef);
      if (candidate === undefined) return no('conflict', 'not_suggested');
      changed = { ...custom, state: 'delivered', deliveredMessageRef: candidate.messageRef, deliveredAt: candidate.at, deliveryCandidates: [] };
    } else if (request.action === 'cancel') changed = { ...custom, state: 'cancelled', deliveryCandidates: [] };
    else changed = { ...custom, description: request.description.trim(), priceMills: request.priceMills };
    const next = { ...card, customs: customs.map((item) => (item === custom ? changed : item)), customPayments: left };
    this.setFanCard(page.pageLabel, request.fanRef, next);
    return ok({ changed: true, card: next });
  }

  /** A scenario's «в разговоре»: `name` (another chatter) wrote to the fan `agoMs` before now. */
  addTalking(entry: FakeTalking): void {
    this.talking.push(entry);
  }

  /**
   * Chat Memory week 1, as the hub's `clientInConversation`: whoever wrote to a fan of the page (an attribution, or a
   * scenario's `talking`) less than 15 minutes ago, unless their install closed after it; the caller is `isMe`.
   */
  inConversation(page: FakePage, userId: number, names: (userId: number) => string, now: number): Read<InConversationResult> {
    const since = now - 15 * 60_000;
    const closedAt = (who: number): number => Math.max(-Infinity, ...this.beats.filter((beat) => beat.userId === who && beat.closed).map((beat) => beat.at));
    const sends = [
      ...[...this.attributions.values()].filter((row) => row.pageLabel === page.pageLabel).map((row) => ({ userId: row.userId, name: names(row.userId), fanRef: row.fanRef, conversationRef: row.conversationRef ?? null, at: Date.parse(row.observedAt) })),
      ...this.talking.filter((row) => row.pageLabel === page.pageLabel).map((row) => ({ userId: row.userId, name: row.name, fanRef: row.fanRef, conversationRef: row.conversationRef, at: row.at })),
    ].filter((send) => send.at > since && send.at <= now && closedAt(send.userId) < send.at);
    const fans = new Map<string, { conversationRef: string | null; chatters: Map<number, { name: string; at: number }> }>();
    for (const send of sends) {
      const fan = fans.get(send.fanRef) ?? { conversationRef: send.conversationRef, chatters: new Map() };
      const known = fan.chatters.get(send.userId);
      if (known === undefined || known.at < send.at) fan.chatters.set(send.userId, { name: send.name, at: send.at });
      fans.set(send.fanRef, fan);
    }
    return ok({
      pageLabel: page.pageLabel,
      fans: [...fans.entries()].map(([fanRef, fan]) => ({
        fanRef,
        conversationRef: fan.conversationRef,
        chatters: [...fan.chatters.entries()]
          .sort((a, b) => b[1].at - a[1].at)
          .map(([who, chatter]) => ({ userId: who, name: chatter.name, isMe: who === userId, lastSentAt: iso(chatter.at), until: iso(chatter.at + 15 * 60_000) })),
      })),
      serverNow: iso(now),
    });
  }
}

/** Chat Memory week 1: one beat as the hub got it — the pages granted to the caller, never a content. */
export interface FakeActivityBeat {
  readonly userId: number;
  readonly instanceId: string;
  readonly pages: ActivityBeatRequest['pages'];
  readonly closed: boolean;
  readonly at: number;
}

/** A scenario's «в разговоре»: another chatter's message to the fan at `at`. */
export interface FakeTalking {
  readonly pageLabel: string;
  readonly fanRef: string;
  readonly conversationRef: string | null;
  readonly userId: number;
  readonly name: string;
  readonly at: number;
}

/** One recorded write of a Fansly note: ids, the person, the action, where in the panel, labels; never a text. */
export interface FakeNoteAttribution {
  readonly pageLabel: string;
  readonly userId: number;
  readonly source: string;
  readonly eventId: string;
  readonly fanRef: string;
  readonly noteRef: string;
  readonly noteKind: string;
  readonly action: string;
  readonly origin?: string | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly observedAt: string;
  /** A seeded colleague's login (`noteWrite`); absent — the user's own. */
  readonly name?: string | undefined;
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
