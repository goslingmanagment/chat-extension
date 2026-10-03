// The fake hub's read models over HTTP (architecture.md §8.5, §8.7; hub H-7c,
// H-8, H-9c, H-15): signed cursors that refuse forgeries and other targets,
// a feed pass bound to its snapshot, user and archive generation, the fixed
// «Новые» window of a cursor pass, the feed's head and Ping
// summary, Spenders filters and sorting, statistics in the asked zone, own AI
// spend per zone, the ingest kinds of the narrow token, health and `me`.

import { HUB_ROUTE_SCHEMAS, type HubRouteKey } from '@cg/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE, SCENARIO_DATA, WORLD, uuid } from '../scenarios/hub';
import { CursorSigner, localDate, zonedMidnight } from './data';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall } from './kit';

let hub: FakeHub;
let token: string;

async function get<T = Record<string, unknown>>(route: HubRouteKey, request: unknown, as: string = token): Promise<T> {
  const response = await hubCall(hub.fetch, hub.origin, route, request, { token: as });
  const body = (await response.json()) as T;
  expect(response.status, `${route}: ${JSON.stringify(body).slice(0, 200)}`).toBe(200);
  expect(HUB_ROUTE_SCHEMAS[route].response.safeParse(body).success, route).toBe(true);
  return body;
}

async function refused(route: HubRouteKey, request: unknown, as: string = token): Promise<{ status: number; error: string; reason?: string }> {
  const response = await hubCall(hub.fetch, hub.origin, route, request, { token: as });
  const body = (await response.json()) as { error: string; reason?: string };
  return body.reason === undefined ? { status: response.status, error: body.error } : { status: response.status, error: body.error, reason: body.reason };
}

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
});

describe('fake hub data: signed cursors', () => {
  it('opens only its own cursors of the same kind', () => {
    const signer = new CursorSigner('s1');
    const cursor = signer.sign('fd1', { p: PAGE });
    expect(signer.open('fd1', cursor)).toEqual({ p: PAGE });
    expect(signer.open('an1', cursor)).toBeNull();
    expect(new CursorSigner('s2').open('fd1', cursor)).toBeNull();
    expect(signer.open('fd1', `${cursor}x`)).toBeNull();
    expect(signer.open('fd1', 'fd1')).toBeNull();
    expect(signer.open('fd1', `fd1.${Buffer.from('[1]').toString('base64url')}.00000000`)).toBeNull();
  });

  it('the feed refuses a forged cursor, another fan’s, and one of another hub instance', async () => {
    const first = await get<{ nextOlderCursor: string }>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10 });
    expect(await refused('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: 'forged' })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
    expect(await refused('clientConversationFeed', { pageLabel: PAGE, fanRef: '5001', cursor: first.nextOlderCursor })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
    expect(await refused('clientConversationFeed', { pageLabel: WORLD.pages.vip.pageLabel, fanRef: WORLD.fan, cursor: first.nextOlderCursor })).toMatchObject({ reason: 'cursor_invalid' });
    hub.control({ op: 'reset' });
    token = hub.issueToken();
    expect(await refused('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: first.nextOlderCursor })).toMatchObject({ reason: 'cursor_invalid' });
  });

  it('the feed cursor is bound to the user and the archive generation: another chatter’s cursor, or one from before a rebuild, is cursor_invalid', async () => {
    const first = await get<{ nextOlderCursor: string }>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10 });
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    expect(await refused('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: first.nextOlderCursor }, other)).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
    await get('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: first.nextOlderCursor });
    expect(hub.control({ op: 'archiveRebuild', pageLabel: PAGE, fanRef: WORLD.fan })).toEqual({ ok: true, generation: 2 });
    expect(await refused('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: first.nextOlderCursor })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
    // A new pass starts on the new generation.
    const again = await get<{ nextOlderCursor: string; snapshotRevision: string }>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10 });
    expect(again.snapshotRevision).toBe('snap-2');
    await get('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: again.nextOlderCursor });
  });

  it('«ждут ответа» refuses a cursor of another page', async () => {
    const first = await get<{ nextCursor: string }>('clientSpenderAwaitingReply', { pageLabel: PAGE, limit: 1 });
    expect(await refused('clientSpenderAwaitingReply', { pageLabel: WORLD.pages.vip.pageLabel, cursor: first.nextCursor })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
  });
});

describe('fake hub data: archive feed (H-9c)', () => {
  it('a cursor pass stays on its snapshot: messages arriving meanwhile wait for the next pass; no gaps, no duplicates', async () => {
    type Page = { snapshotRevision: string; head: { messageRef: string } | null; items: Array<{ messageId: string }>; nextOlderCursor: string | null };
    const first = await get<Page>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10 });
    const arrived = (hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: WORLD.fan }) as { messageId: string }).messageId;
    const seen = [...first.items.map((item) => item.messageId)];
    let cursor = first.nextOlderCursor;
    while (cursor !== null) {
      const page = await get<Page>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10, cursor });
      expect({ snapshot: page.snapshotRevision, head: page.head?.messageRef }).toEqual({ snapshot: first.snapshotRevision, head: first.head?.messageRef });
      seen.push(...page.items.map((item) => item.messageId));
      cursor = page.nextOlderCursor;
    }
    expect(seen).not.toContain(arrived);
    expect(new Set(seen).size).toBe(seen.length);
    const fresh = await get<Page>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 10 });
    expect(fresh.head?.messageRef).toBe(arrived);
    expect(fresh.snapshotRevision).not.toBe(first.snapshotRevision);
    expect(seen).toHaveLength(SCENARIO_DATA.feedTotal);
  });

  it('an unknown fan has an empty, unknown archive; the summary says so', async () => {
    expect(await get('clientConversationFeed', { pageLabel: PAGE, fanRef: '999999' })).toMatchObject({
      coverage: 'unknown',
      head: null,
      newestKnownAt: null,
      nextOlderCursor: null,
      items: [],
      summary: { pingSegment: 'unknown', fanSilenceDays: null, window: { requested: 100, served: 0 } },
    });
  });

  it('the Ping summary is the hub’s: silence days and the segment from the fan’s text messages in the window', async () => {
    hub.control({ op: 'clock', advanceMs: 2 * 86_400_000 });
    const known = await get<{ summary: { pingSegment: string; fanSilenceDays: number; window: { requested: number; served: number } } }>('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, summaryWindow: 20 });
    expect(known.summary).toMatchObject({ pingSegment: 'segment-b', fanSilenceDays: 2, window: { requested: 20, served: 20 } });
    const short = await get<{ summary: { pingSegment: string }; items: unknown[] }>('clientConversationFeed', { pageLabel: PAGE, fanRef: '5001' });
    expect({ segment: short.summary.pingSegment, items: short.items.length }).toEqual({ segment: 'segment-a', items: 3 });
    hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: '5001' });
    expect((await get<{ summary: { pingSegment: string } }>('clientConversationFeed', { pageLabel: PAGE, fanRef: '5001' })).summary.pingSegment).toBe('active');
    hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: '5001', sender: 'model' });
    expect((await get<{ head: { sender: string } }>('clientConversationFeed', { pageLabel: PAGE, fanRef: '5001' })).head.sender).toBe('model');
  });
});

describe('fake hub data: «Новые» (H-7c)', () => {
  it('the window is fixed for the whole cursor pass: later events wait for the next pass', async () => {
    const first = await get<{ items: Array<{ fanRef: string }>; nextCursor: string; window: { hours: number } }>('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, limit: 2 });
    expect(first.items.map((item) => item.fanRef)).toEqual(['2010', '2011']);
    hub.control({ op: 'clock', advanceMs: 60_000 });
    expect(hub.control({ op: 'audienceEvent', pageLabel: PAGE, fanRef: '2050', trial: true })).toMatchObject({ ok: true, eventRef: expect.stringMatching(/^evt-11-/) as unknown });
    const second = await get<{ items: Array<{ fanRef: string }>; nextCursor: string | null; window: { to: string } }>('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, limit: 2, cursor: first.nextCursor });
    expect({ fans: second.items.map((item) => item.fanRef), to: second.window.to }).toEqual({ fans: ['2012', '2013'], to: '2026-10-03T10:00:00.000Z' });
    const fresh = await get<{ items: Array<{ fanRef: string; trial: boolean; kind: string; thread: unknown }> }>('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, limit: 1 });
    expect(fresh.items[0]).toMatchObject({ fanRef: '2050', trial: true, kind: 'new', thread: null });
    expect(await refused('clientAudienceNew', { pageLabel: PAGE, windowHours: 72, cursor: first.nextCursor })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_window_mismatch' });
    expect(await refused('clientAudienceNew', { pageLabel: PAGE, windowHours: 48, cursor: 'forged' })).toEqual({ status: 400, error: 'bad_request', reason: 'cursor_invalid' });
  });

  it('a narrow window keeps only the subscriptions inside it; a returning fan of another page is there too', async () => {
    const narrow = await get<{ items: Array<{ fanRef: string }> }>('clientAudienceNew', { pageLabel: PAGE, windowHours: 2 });
    expect(narrow.items.map((item) => item.fanRef)).toEqual(['2010', '2011']);
    hub.control({ op: 'audienceEvent', pageLabel: WORLD.pages.vip.pageLabel, fanRef: '2060', kind: 'returning' });
    const vip = await get<{ items: Array<{ fanRef: string; kind: string }> }>('clientAudienceNew', { pageLabel: WORLD.pages.vip.pageLabel, windowHours: 1 });
    expect(vip.items).toMatchObject([{ fanRef: '2060', kind: 'returning' }, { fanRef: '2010' }]);
  });
});

describe('fake hub data: Spenders, statistics, spend', () => {
  it('the board filters, searches and sorts like the hub; the total follows the config', async () => {
    hub.control({ op: 'config', patch: { spendersTotal: 30 } });
    const board = (query: Record<string, unknown>) => get<{ items: Array<{ fan: { username: string }; retentionStatus: string; metrics: { window: { lastTransactionAt: string } } }>; total: number }>('spenders', { scope: 'page', pageLabel: PAGE, period: 'lifetime', limit: 200, offset: 0, ...query });
    expect((await board({})).total).toBe(30);
    const cooling = await board({ retentionStatus: 'cooling' });
    expect(cooling.items.map((row) => row.fan.username)).toEqual(['fan_0', 'fan_9', 'fan_18', 'fan_27']);
    expect((await board({ sortBy: 'username' })).items.slice(0, 4).map((row) => row.fan.username)).toEqual(['fan_0', 'fan_1', 'fan_10', 'fan_11']);
    expect((await board({ sortBy: 'username', sortDir: 'desc' })).items.slice(0, 3).map((row) => row.fan.username)).toEqual(['fan_9', 'fan_8', 'fan_7']);
    expect((await board({})).items.slice(0, 2).map((row) => row.fan.username)).toEqual(['fan_0', 'fan_1']);
    expect((await board({ sortBy: 'grossAmountMills', sortDir: 'asc' })).items[0]?.fan.username).toBe('fan_29');
    const recent = await board({ sortBy: 'lastTransactionAt' });
    const times = recent.items.map((row) => Date.parse(row.metrics.window.lastTransactionAt));
    expect(times).toEqual([...times].sort((x, y) => y - x));
    for (const sortBy of ['creatorNetAmountMills', 'postedGrossAmountMills', 'pendingGrossAmountMills', 'postedCreatorNetAmountMills', 'pendingCreatorNetAmountMills', 'lifetimeGrossAmountMills', 'lifetimeCreatorNetAmountMills']) {
      expect((await board({ sortBy })).items[0]?.fan.username, sortBy).toBe('fan_0');
    }
    expect((await board({ sortBy: 'platformUserId' })).items.slice(0, 2).map((row) => row.fan.username)).toEqual(['fan_0', 'fan_1']);
    expect((await board({ sortBy: 'displayName' })).items[0]?.fan.username).toBe('fan_0');
    expect((await board({ query: 'FAN 1' })).items.map((row) => row.fan.username)).toEqual(['fan_1', 'fan_10', 'fan_11', 'fan_13', 'fan_14', 'fan_16', 'fan_17', 'fan_19']);
  });

  it('periods: custom keeps its dates, mtd starts on the 1st, today is one day in Moscow', async () => {
    const period = async (query: Record<string, unknown>) =>
      (await get<{ period: { fromBusinessDate: string | null; toBusinessDateInclusive: string | null } }>('spenders', { scope: 'page', pageLabel: PAGE, limit: 1, offset: 0, ...query })).period;
    expect(await period({ period: 'custom', from: '2026-09-01', to: '2026-09-15' })).toMatchObject({ fromBusinessDate: '2026-09-01', toBusinessDateInclusive: '2026-09-15' });
    expect(await period({ period: 'mtd' })).toMatchObject({ fromBusinessDate: '2026-10-01', toBusinessDateInclusive: '2026-10-03' });
    expect(await period({ period: 'today' })).toMatchObject({ fromBusinessDate: '2026-10-03' });
    expect(await period({ period: 'lifetime' })).toMatchObject({ fromBusinessDate: null });
    const batch = await get<{ period: { fromBusinessDate: string | null } }>('spenderBatch', { scope: 'page', pageLabel: PAGE, fans: [{ platform: 'onlyfans', platformUserId: '5000' }] });
    expect(batch.period.fromBusinessDate).toBeNull();
    expect(await refused('spenderDetail', { platform: 'fansly', platformUserId: '5000', scope: 'page', pageLabel: PAGE, period: '30d' })).toEqual({ status: 404, error: 'not_found' });
    const fansly = await get<{ items: Array<{ found: boolean }> }>('spenderBatch', { scope: 'page', pageLabel: PAGE, period: '7d', fans: [{ platform: 'fansly', platformUserId: '5000' }] });
    expect(fansly.items[0]?.found).toBe(false);
  });

  it('statistics answer in the asked zone, with the queue summary of the same snapshot', async () => {
    expect(await get('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'Asia/Tokyo' })).toMatchObject({ timeZone: 'Asia/Tokyo', asOf: '2026-10-03T10:00:00.000Z', queueSummary: { total: 5, unknown: 1 } });
  });

  it('own AI spend: days end at local midnight of the zone; the last day is open; seven days at most', async () => {
    const report = await get<{ timeZone: string; days: Array<{ date: string; from: string; toExclusive: string; coverage: string; coverageReasons: string[] }> }>('clientAiUsageDaily', {
      pageLabel: PAGE,
      date: '2026-10-03',
      days: 7,
    });
    expect(report.timeZone).toBe('Europe/Moscow');
    expect(report.days.map((day) => day.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(report.days.at(-1)).toMatchObject({ from: '2026-10-02T21:00:00.000Z', toExclusive: '2026-10-03T21:00:00.000Z', coverage: 'partial', coverageReasons: ['day_open'] });
    expect(report.days[0]).toMatchObject({ coverage: 'complete', coverageReasons: [] });
    expect(await refused('clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-03', timeZone: 'Mars/Olympus' })).toEqual({ status: 400, error: 'bad_request', reason: 'unknown_time_zone' });
    expect(await refused('clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-03', days: 8 })).toMatchObject({ status: 400, error: 'bad_request' });
  });

  it('zone helpers: local dates and midnights across DST', () => {
    expect(localDate(Date.parse('2026-10-03T22:30:00Z'), 'Europe/Moscow')).toBe('2026-10-04');
    expect(new Date(zonedMidnight('2026-03-08', 'America/New_York')).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(new Date(zonedMidnight('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(() => localDate(0, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('fake hub data: ingest, dossier, health, me', () => {
  const event = (kind: string, n: number) => ({ clientEventId: uuid(0x500 + n), kind, observedAt: '2026-10-03T10:00:00.000Z', payload: { lifecycle: 'shown' }, pageLabel: PAGE });

  it('the narrow token ingests only ai_acceptance, plus client_health once its capability is declared; a full token any kind', async () => {
    expect(await refused('ingestObservations', { events: [event('client_health', 1)] })).toEqual({ status: 400, error: 'bad_request', reason: 'ingest_kind_not_allowed' });
    hub.control({ op: 'config', patch: { capabilities: [...hub.config().capabilities, 'client-health-perf-v1'] } });
    expect(await get('ingestObservations', { events: [event('client_health', 1)] })).toEqual({ accepted: 1, duplicates: 0 });
    const full = hub.issueToken({ client: null });
    expect(await get('ingestObservations', { events: [event('desktop_lifecycle', 2)] }, full)).toEqual({ accepted: 1, duplicates: 0 });
    // Deduplication is per user.
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    expect(await get('ingestObservations', { events: [event('ai_acceptance', 1)] }, other)).toEqual({ accepted: 1, duplicates: 0 });
    expect(hub.status().ingested).toBe(3);
  });

  it('dossiers exist for fans the page knows: an audience fan has none yet', async () => {
    expect(await get('pageFanProfile', { pageLabel: PAGE, fanRef: '2012' })).toMatchObject({ fan: { platformUserId: '2012', username: 'fan_2012' }, profile: null });
    hub.control({ op: 'archiveMessage', pageLabel: PAGE, fanRef: '777777' });
    expect((await get('pageConversationProfile', { pageLabel: PAGE, fanRef: '777777' })).profile).toBeNull();
  });

  it('health: degraded is 503 with the body; the compatibility list can be withdrawn; the contract hash is settable', async () => {
    hub.control({ op: 'health', status: 'degraded', compatibleClientSdks: null, contractHash: 'a'.repeat(64) });
    const response = await hubCall(hub.fetch, hub.origin, 'health', null);
    const body = (await response.json()) as Record<string, unknown>;
    expect({ status: response.status, hubStatus: body['status'], hash: body['contractHash'], listed: 'compatibleClientSdks' in body }).toEqual({ status: 503, hubStatus: 'degraded', hash: 'a'.repeat(64), listed: false });
    hub.control({ op: 'health', status: 'ok', compatibleClientSdks: ['b'.repeat(64)] });
    expect(await get('health', null)).toMatchObject({ status: 'ok', compatibleClientSdks: ['b'.repeat(64)] });
  });

  it('me lists the pages the chatter is granted', async () => {
    const me = await get<{ user: { assignedPages: Array<{ label: string; platform: string }> } }>('me', null);
    expect(me.user.assignedPages.map((page) => [page.label, page.platform])).toEqual([
      [WORLD.pages.one.pageLabel, 'onlyfans'],
      [WORLD.pages.vip.pageLabel, 'onlyfans'],
      [WORLD.pages.fansly.pageLabel, 'fansly'],
    ]);
  });
});
