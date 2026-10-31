// The fake hub's OnlyFans feed (hub #953, `clientOnlyfansFeed`), as the hub keeps it:
// - every record is journaled with the person who reported it; the same thing reported again (its OnlyFans id and
//   content, apart from when and how it was seen) is a duplicate and changes nothing;
// - a message reaches the fan's archive — what the preview's feed and the AI's transcript read; a deletion
//   tombstones it there;
// - a purchase, a tip and a ledger row reach the page's transactions, one purchase once however many ways it was
//   seen: a later sighting of the same fan, gross and kind within ten minutes claims the row (hub
//   client-onlyfans-feed-money.ts, simplified: no earlier writer here). The hub's writer gate is not modelled: the
//   stand's pages take the feed's money.

import { type OnlyfansFeedRecord, type OnlyfansFeedRequest, type OnlyfansFeedResult } from '@cg/contracts/hub';

import { iso } from './clock';

export interface FakeFeedRecord {
  readonly userId: number;
  readonly pageLabel: string;
  readonly hostAccountRef: string;
  readonly creatorRef: string;
  readonly at: string;
  readonly outcome: 'taken' | 'duplicate';
  readonly record: OnlyfansFeedRecord;
}

export interface FakeFeedTransaction {
  readonly pageLabel: string;
  transactionId: string;
  source: 'chatspace:ws' | 'chatspace:ledger';
  readonly fanRef: string | null;
  readonly kind: string;
  readonly grossMills: number;
  netMills: number;
  readonly at: string;
  /** The sightings that counted it: `ws:…`, `ledger:…`. */
  readonly sightings: string[];
}

/** What the archive takes of a message record. */
export interface FeedArchiveMessage {
  readonly messageId: string;
  readonly fanRef: string;
  readonly sender: 'fan' | 'model';
  readonly at: string;
  readonly text: string;
  readonly priceMills: number | null;
  readonly tipMills: number | null;
  readonly automatic: boolean | null;
}

export interface FeedArchive {
  readonly message: (pageLabel: string, message: FeedArchiveMessage) => void;
  readonly deleted: (pageLabel: string, messageId: string) => void;
}

const MATCH_WINDOW_MS = 10 * 60_000;
const mills = (dollars: number): number => Math.round(dollars * 1000);
const plain = (html: string): string => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
};

function keyOf(record: OnlyfansFeedRecord): string {
  const { observedAt: _observedAt, ...rest } = record;
  return JSON.stringify(canonical(rest.kind === 'message' ? { ...rest, via: null } : rest));
}

const ledgerKind = (description: string): string => {
  const text = description.toLowerCase();
  if (text.includes('tip')) return 'tip';
  if (text.includes('subscri')) return 'subscription';
  if (text.includes('message')) return 'message_purchase';
  if (text.includes('post')) return 'post_purchase';
  return 'other';
};

export class FakeOnlyfansFeed {
  private readonly journal: FakeFeedRecord[] = [];
  private readonly keys = new Set<string>();
  private readonly rows: FakeFeedTransaction[] = [];

  report(userId: number, request: OnlyfansFeedRequest, now: number, archive: FeedArchive): OnlyfansFeedResult {
    let taken = 0;
    let duplicates = 0;
    for (const record of request.records) {
      const key = `${request.pageLabel}|${keyOf(record)}`;
      const duplicate = this.keys.has(key);
      this.journal.push({ userId, pageLabel: request.pageLabel, hostAccountRef: request.hostAccountRef, creatorRef: request.creatorRef, at: iso(now), outcome: duplicate ? 'duplicate' : 'taken', record });
      if (duplicate) {
        duplicates += 1;
        continue;
      }
      this.keys.add(key);
      taken += 1;
      this.apply(request.pageLabel, record, archive);
    }
    return { pageLabel: request.pageLabel, taken, duplicates, held: 0, outOfRange: 0, serverNow: iso(now) };
  }

  private apply(pageLabel: string, record: OnlyfansFeedRecord, archive: FeedArchive): void {
    switch (record.kind) {
      case 'message':
        archive.message(pageLabel, {
          messageId: record.messageRef,
          fanRef: record.fanRef,
          sender: record.fromFan ? 'fan' : 'model',
          at: record.sentAt,
          text: plain(record.textHtml),
          priceMills: record.isTip || record.price === null ? null : mills(record.price),
          tipMills: record.isTip && record.price !== null ? mills(record.price) : null,
          automatic: record.automatic,
        });
        return;
      case 'deleted':
        archive.deleted(pageLabel, record.messageRef);
        return;
      case 'ppv':
        return this.sighting(pageLabel, 'ws', `ws:ppv:${record.contentType}:${record.contentRef}:${record.fanRef}`, `chatspace:ppv:${record.contentType}:${record.contentRef}`, record.fanRef, record.contentType === 'post' ? 'post_purchase' : 'message_purchase', mills(record.priceGross), Math.round(mills(record.priceGross) * 0.8), record.observedAt);
      case 'tip':
        return this.sighting(pageLabel, 'ws', `ws:tip:${record.tipRef}`, `chatspace:tip:${record.tipRef}`, record.fanRef, 'tip', mills(record.amountGross), Math.round(mills(record.amountGross) * 0.8), record.observedAt);
      case 'ledger':
        return this.sighting(pageLabel, 'ledger', `ledger:${record.transactionRef}`, record.transactionRef, record.fanRef, ledgerKind(record.description), mills(Math.abs(record.amountGross)), mills(Math.abs(record.amountNet)), record.createdAt);
      case 'fan':
      case 'chat':
        return;
    }
  }

  private sighting(pageLabel: string, kind: 'ws' | 'ledger', sightingKey: string, transactionId: string, fanRef: string | null, type: string, grossMills: number, netMills: number, at: string): void {
    if (grossMills <= 0) return;
    if (this.rows.some((row) => row.pageLabel === pageLabel && (row.sightings.includes(sightingKey) || row.transactionId === transactionId))) return;
    const own = kind === 'ws' ? 'chatspace:ws' : 'chatspace:ledger';
    const time = Date.parse(at);
    const match = this.rows
      .filter((row) => row.pageLabel === pageLabel && row.source !== own && row.fanRef === fanRef && row.grossMills === grossMills && (row.kind === type || type === 'other' || row.kind === 'other'))
      .filter((row) => !row.sightings.some((seen) => seen.startsWith(`${kind}:`)))
      .filter((row) => Math.abs(Date.parse(row.at) - time) <= MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(Date.parse(a.at) - time) - Math.abs(Date.parse(b.at) - time))[0];
    if (match !== undefined) {
      match.sightings.push(sightingKey);
      if (kind === 'ledger' && match.source === 'chatspace:ws') match.netMills = netMills;
      return;
    }
    this.rows.push({ pageLabel, transactionId, source: own, fanRef, kind: type, grossMills, netMills, at, sightings: [sightingKey] });
  }

  records(): readonly FakeFeedRecord[] {
    return this.journal;
  }

  transactions(): readonly FakeFeedTransaction[] {
    return this.rows.map((row) => ({ ...row, sightings: [...row.sightings] }));
  }
}
