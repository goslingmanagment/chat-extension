// Every route of the contracts' hub route table, served by the fake hub's model
// in-process: existing SDK operations through the vendored SDK itself (its
// own schemas check the answers, the way the background will call them), the
// new client routes by hand; every 200 passes HUB_ROUTE_SCHEMAS. Then the
// model's checks: a route of an undeclared capability is not deployed, a page
// not granted is 404, an owner flag off is 409 with its reason.

import { HUB_ROUTE_KEYS, HUB_ROUTE_SCHEMAS, HUB_ROUTES, type HubRouteKey } from '@cg/contracts';
import { createClient } from '@kernel/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

import { PAGE, WORLD, uuid } from '../scenarios/hub';
import { createFakeHub, type FakeHub } from './hub';
import { hubCall, readSse } from './kit';

type Sdk = Record<string, (input?: Record<string, unknown>) => Promise<unknown>>;

let hub: FakeHub;
let token: string;
let sdk: Sdk;

const call = (route: HubRouteKey, request: unknown, as: string | null = token): Promise<Response> => hubCall(hub.fetch, hub.origin, route, request, { token: as });

async function ok(route: HubRouteKey, request: unknown): Promise<unknown> {
  const response = await call(route, request);
  const body = (await response.json()) as unknown;
  expect(response.status, `${route}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
  expect(HUB_ROUTE_SCHEMAS[route].response.safeParse(body).success, route).toBe(true);
  return body;
}

async function refused(route: HubRouteKey, request: unknown, status: number, error: string, reason?: string): Promise<void> {
  const response = await call(route, request);
  const body = (await response.json()) as { error: string; reason?: string; statusCode: number };
  expect({ status: response.status, error: body.error, statusCode: body.statusCode, ...(reason === undefined ? {} : { reason: body.reason }) }, route).toEqual({
    status,
    error,
    statusCode: status,
    ...(reason === undefined ? {} : { reason }),
  });
}

beforeEach(() => {
  hub = createFakeHub();
  token = hub.issueToken();
  sdk = createClient({ baseUrl: hub.origin, fetch: hub.fetch, auth: { mode: 'bearer', token: () => token } }) as unknown as Sdk;
});

const served = new Set<HubRouteKey>();
const covers = (route: HubRouteKey): void => {
  served.add(route);
};

describe('fake hub routes: existing SDK operations, through the vendored SDK', () => {
  it('authIssueDeviceTokenWithPassword: a narrow active token', async () => {
    covers('authIssueDeviceTokenWithPassword');
    const answer = (await sdk['authIssueDeviceTokenWithPassword']?.({ body: { username: WORLD.user.username, password: 'synthetic-password', label: 'Firefox · macOS · ChatSpace', mode: 'active', client: 'chat-extension' } })) as { mode: string; token: string };
    expect(answer.mode).toBe('active');
    expect(answer.token).toMatch(/^cgx\d+_/);
  });

  it('authRevokeCurrentDeviceToken: revokes exactly the bearer', async () => {
    covers('authRevokeCurrentDeviceToken');
    expect(await sdk['authRevokeCurrentDeviceToken']?.()).toEqual({ revoked: true });
    await expect(sdk['me']?.()).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('health: contract hash and compatibleClientSdks, public', async () => {
    covers('health');
    expect(await sdk['health']?.()).toMatchObject({ status: 'ok', capabilities: ['desktop-lifecycle-v2'] });
    const raw = await hubCall(hub.fetch, hub.origin, 'health', null);
    expect(((await raw.json()) as { compatibleClientSdks: string[] }).compatibleClientSdks).toHaveLength(2);
  });

  it('me: the bearer and its pages', async () => {
    covers('me');
    expect(await sdk['me']?.()).toMatchObject({ authMethod: 'device_token', user: { id: WORLD.user.userId, username: WORLD.user.username, role: 'chatter', mustChangePassword: false } });
  });

  it('aiPersonaCatalog: metadata only, never prompt text', async () => {
    covers('aiPersonaCatalog');
    const catalog = (await sdk['aiPersonaCatalog']?.()) as { personas: Array<Record<string, unknown>> };
    expect(catalog.personas[0]).toEqual({ key: WORLD.persona.key, displayName: 'Default', version: 3, definitionId: WORLD.persona.definitionId, status: 'active' });
    for (const persona of catalog.personas) expect(Object.keys(persona).sort()).toEqual(['definitionId', 'displayName', 'key', 'status', 'version']);
  });

  it('aiFeatureStream: a model stream the SDK accepts frame by frame', async () => {
    covers('aiFeatureStream');
    const response = await call('aiFeatureStream', {
      feature: 'fast-reply',
      body: { clientRequestId: uuid(0x100), pageLabel: PAGE, platform: 'onlyfans', conversationRef: WORLD.fan, fanRef: WORLD.fan, personaKey: WORLD.persona.key },
      capabilities: [],
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const read = await readSse(response);
    expect(read.frames.map((frame) => (frame as { type: string }).type)).toEqual(['meta', 'content_delta', 'content_delta', 'content_delta', 'usage', 'done']);
    for (const frame of read.frames) expect(HUB_ROUTE_SCHEMAS.aiFeatureStream.response.safeParse(frame).success).toBe(true);
  });

  it('aiRecapStatus: metadata of the freshest full and short recap', async () => {
    covers('aiRecapStatus');
    const status = (await sdk['aiRecapStatus']?.({ query: { pageLabel: PAGE, conversationRef: WORLD.fan, fanRef: WORLD.fan } })) as { full: { keptCount: number } | null; short: unknown };
    expect(status.full?.keptCount).toBe(840);
    expect(status.short).toBeNull();
  });

  it('pageConversationProfile and pageFanProfile: the dossier of a known fan', async () => {
    covers('pageConversationProfile');
    covers('pageFanProfile');
    const byConversation = (await sdk['pageConversationProfile']?.({ params: { pageLabel: PAGE, conversationId: WORLD.fan } })) as { profile: { version: number } };
    expect(byConversation.profile.version).toBe(3);
    expect(await sdk['pageFanProfile']?.({ params: { pageLabel: PAGE, platformUserId: '5001' } })).toMatchObject({ fan: { platformUserId: '5001' }, profile: null });
    await expect(sdk['pageFanProfile']?.({ params: { pageLabel: PAGE, platformUserId: WORLD.otherFan } })).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('spenders: the board by pages of 200 up to the total', async () => {
    covers('spenders');
    const page = (await sdk['spenders']?.({ query: { scope: 'page', pageLabel: PAGE, period: '30d', limit: 200, offset: 800 } })) as { items: unknown[]; total: number; offset: number };
    expect({ rows: page.items.length, total: page.total, offset: page.offset }).toEqual({ rows: 200, total: 1240, offset: 800 });
    const tail = (await sdk['spenders']?.({ query: { scope: 'page', pageLabel: PAGE, period: 'lifetime', limit: 200, offset: 1200 } })) as { items: unknown[] };
    expect(tail.items).toHaveLength(40);
    const found = (await sdk['spenders']?.({ query: { scope: 'page', pageLabel: PAGE, period: '7d', limit: 50, offset: 0, query: 'fan_1239' } })) as { items: Array<{ fan: { username: string } }>; total: number };
    expect(found.items.map((row) => row.fan.username)).toEqual(['fan_1239']);
  });

  it('spenderDetail: the fan card; an unknown fan is 404', async () => {
    covers('spenderDetail');
    expect(await sdk['spenderDetail']?.({ params: { platform: 'onlyfans', platformUserId: '5003' }, query: { scope: 'page', pageLabel: PAGE, period: '30d' } })).toMatchObject({
      fan: { platformUserId: '5003' },
      pages: [{ pageLabel: PAGE, inScope: true }],
    });
    await expect(sdk['spenderDetail']?.({ params: { platform: 'onlyfans', platformUserId: '99999' }, query: { scope: 'page', pageLabel: PAGE, period: '30d' } })).rejects.toMatchObject({ status: 404 });
  });

  it('spenderBatch: found and not found (the SDK encodes the literal colon of `spenders:batch`)', async () => {
    covers('spenderBatch');
    const batch = (await sdk['spenderBatch']?.({
      params: { batch: ':batch' },
      body: { scope: 'page', pageLabel: PAGE, period: '30d', fans: [{ platform: 'onlyfans', platformUserId: '5000' }, { platform: 'onlyfans', platformUserId: '99999' }] },
    })) as { items: Array<{ found: boolean }> };
    expect(batch.items.map((item) => item.found)).toEqual([true, false]);
  });

  it('pageSpenderAutoLists: the tier buckets of the page', async () => {
    covers('pageSpenderAutoLists');
    expect(await sdk['pageSpenderAutoLists']?.({ params: { pageLabel: PAGE } })).toMatchObject({ page: { label: PAGE }, currency: 'USD', totalEntries: 1131 });
  });

  it('ingestObservations: accepted, then duplicates by clientEventId', async () => {
    covers('ingestObservations');
    const event = { clientEventId: uuid(0x500), kind: 'ai_acceptance', observedAt: '2026-10-03T10:00:00.000Z', payload: { lifecycle: 'shown' }, pageLabel: PAGE };
    expect(await sdk['ingestObservations']?.({ body: { events: [event] } })).toEqual({ accepted: 1, duplicates: 0 });
    expect(await sdk['ingestObservations']?.({ body: { events: [event, { ...event, clientEventId: uuid(0x501) }] } })).toEqual({ accepted: 1, duplicates: 1 });
    expect(hub.ingested()).toHaveLength(2);
  });
});

describe('fake hub routes: new client routes (H-2…H-15)', () => {
  it('clientBootstrap: pages, bindings, flags, limits, capabilities; tokenClient of the narrow token', async () => {
    covers('clientBootstrap');
    expect(await ok('clientBootstrap', null)).toMatchObject({ protocol: 1, identity: { userId: WORLD.user.userId, tokenClient: 'chat-extension' }, configRevision: WORLD.configRevision });
  });

  it('clientConversationRecaps: the shared full recap, saved to the dossier', async () => {
    covers('clientConversationRecaps');
    expect(await ok('clientConversationRecaps', { pageLabel: PAGE, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId })).toMatchObject({
      full: { coverage: { keptCount: 840 } },
      short: null,
      fullSavedToProfile: true,
    });
    expect(await ok('clientConversationRecaps', { pageLabel: PAGE, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.otherDefinitionId })).toMatchObject({ full: null, short: null, fullSavedToProfile: false });
  });

  it('clientFanProfileFromGeneration: a finished full fan-summary is linked once (created → existing)', async () => {
    covers('clientFanProfileFromGeneration');
    const stream = await readSse(await call('aiFeatureStream', { feature: 'fan-summary', body: { clientRequestId: uuid(0x101), pageLabel: PAGE, platform: 'onlyfans', conversationRef: WORLD.fan, fanRef: WORLD.fan, messageCount: 3000 }, capabilities: [] }));
    const generationRef = (stream.frames[0] as { requestId: string }).requestId;
    expect(await ok('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: WORLD.fan, generationRef, clientRequestId: uuid(0x101) })).toMatchObject({ outcome: 'created', profile: { version: 4 } });
    expect(await ok('clientFanProfileFromGeneration', { pageLabel: PAGE, fanRef: WORLD.fan, generationRef })).toMatchObject({ outcome: 'existing', profile: { version: 4 } });
    expect(await ok('clientConversationRecaps', { pageLabel: PAGE, fanRef: WORLD.fan })).toMatchObject({ full: { generationRef }, fullSavedToProfile: true });
  });

  it('clientConversationFeed: newest → oldest by cursor, the summary on the first page only', async () => {
    covers('clientConversationFeed');
    const first = (await ok('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, limit: 50 })) as { items: Array<{ messageId: string }>; nextOlderCursor: string; summary: unknown };
    expect(first.items[0]?.messageId).toBe('6000');
    expect(first.summary).toMatchObject({ pingSegment: 'active', fanSilenceDays: 0, window: { requested: 100, served: 100 } });
    const second = (await ok('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: first.nextOlderCursor, limit: 50 })) as { items: Array<{ messageId: string }>; nextOlderCursor: string; summary: unknown };
    expect({ head: second.items[0]?.messageId, summary: second.summary }).toEqual({ head: '6050', summary: null });
    const third = (await ok('clientConversationFeed', { pageLabel: PAGE, fanRef: WORLD.fan, cursor: second.nextOlderCursor, limit: 50 })) as { items: unknown[]; nextOlderCursor: string | null };
    expect({ rows: third.items.length, next: third.nextOlderCursor }).toEqual({ rows: 12, next: null });
  });

  it('clientSpenderStats: §8.7 numbers for the asked zone', async () => {
    covers('clientSpenderStats');
    expect(await ok('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'Europe/Moscow' })).toMatchObject({ pageLabel: PAGE, moneyUnit: 'USD-mills', basis: 'gross', timeZone: 'Europe/Moscow' });
    await refused('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'Mars/Olympus' }, 400, 'bad_request', 'unknown_time_zone');
  });

  it('clientSpenderAwaitingReply: total/loaded/unknown over cursor pages', async () => {
    covers('clientSpenderAwaitingReply');
    const first = (await ok('clientSpenderAwaitingReply', { pageLabel: PAGE, limit: 2 })) as { total: number; loaded: number; unknown: number; nextCursor: string };
    expect({ total: first.total, loaded: first.loaded, unknown: first.unknown }).toEqual({ total: 5, loaded: 2, unknown: 1 });
    const rest = (await ok('clientSpenderAwaitingReply', { pageLabel: PAGE, cursor: first.nextCursor, limit: 10 })) as { loaded: number; nextCursor: string | null };
    expect(rest).toMatchObject({ loaded: 5, nextCursor: null });
  });

  it('clientFanClaim and clientFanClaimStatus: a lease is owned, the status shows it', async () => {
    covers('clientFanClaim');
    covers('clientFanClaimStatus');
    const lease = { action: 'claim', leaseToken: uuid(0x300), instanceId: WORLD.instanceId };
    expect(await ok('clientFanClaim', { pageLabel: PAGE, fanRef: WORLD.newFan, body: lease })).toMatchObject({ lease: { state: 'owned', leaseToken: uuid(0x300) }, flagRevision: WORLD.configRevision });
    expect(await ok('clientFanClaimStatus', { pageLabel: PAGE, fanRef: WORLD.newFan })).toMatchObject({ lease: { state: 'owned' }, custody: null });
  });

  it('clientAudienceNew: «Новые» of the window with claim summaries', async () => {
    covers('clientAudienceNew');
    const page = (await ok('clientAudienceNew', { pageLabel: PAGE, windowHours: 48 })) as { items: Array<{ kind: string; trial: boolean; claim: unknown }>; window: { hours: number } };
    expect(page.window.hours).toBe(48);
    expect(page.items.map((item) => [item.kind, item.trial])).toEqual([
      ['new', false],
      ['new', true],
      ['returning', false],
      ['new', false],
      ['new', false],
    ]);
    expect(page.items[0]?.claim).toEqual({ greeting: 'none', lease: 'none', heldBy: null, custody: null });
  });

  it('clientAiUsageDaily: own spend of the day, partial while the day is open', async () => {
    covers('clientAiUsageDaily');
    await readSse(await call('aiFeatureStream', { feature: 'ping', body: { clientRequestId: uuid(0x102), pageLabel: PAGE, platform: 'onlyfans', conversationRef: WORLD.fan }, capabilities: [] }));
    const report = (await ok('clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-03', days: 2, timeZone: 'UTC' })) as { days: Array<{ date: string; coverage: string; totals: { requestCount: number; completed: number } }> };
    expect(report.days.map((day) => [day.date, day.coverage, day.totals.requestCount, day.totals.completed])).toEqual([
      ['2026-10-02', 'complete', 0, 0],
      ['2026-10-03', 'partial', 1, 1],
    ]);
    await refused('clientAiUsageDaily', { pageLabel: PAGE, date: '2026-10-04' }, 400, 'bad_request', 'date_in_future');
    await refused('clientAiUsageDaily', { pageLabel: PAGE, date: '2026-09-20' }, 400, 'bad_request', 'date_too_old');
  });

  it('every route of the route table is covered above', () => {
    expect([...served].sort()).toEqual([...HUB_ROUTE_KEYS].sort());
  });
});

describe('fake hub routes: the model’s own checks', () => {
  it('a route whose capability the hub does not declare is not deployed (404)', async () => {
    hub.control({ op: 'config', patch: { capabilities: [] } });
    for (const route of HUB_ROUTE_KEYS.filter((key) => HUB_ROUTES[key].capabilities.length > 0)) {
      const response = await call(route, route === 'clientFanClaim' ? { pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'claim', leaseToken: uuid(1), instanceId: uuid(2) } } : sampleRequest(route));
      expect([route, response.status, ((await response.json()) as { reason?: string }).reason]).toEqual([route, 404, 'route_not_deployed']);
    }
  });

  it('a page outside the grant is 404 on every page route', async () => {
    await refused('clientSpenderStats', { pageLabel: 'not-my-page', windowDays: 30, timeZone: 'UTC' }, 404, 'not_found');
    await refused('spenders', { scope: 'page', pageLabel: 'not-my-page', period: '30d', limit: 1, offset: 0 }, 404, 'not_found');
    await refused('aiFeatureStream', { feature: 'ping', body: { clientRequestId: uuid(9), pageLabel: 'not-my-page', platform: 'onlyfans', conversationRef: WORLD.fan }, capabilities: [] }, 404, 'not_found');
  });

  it('grants are per user: a known page not granted to the caller is 404 for them only; me and bootstrap list only granted pages', async () => {
    const vip = WORLD.pages.vip.pageLabel;
    const other = hub.issueToken({ username: WORLD.otherUser.username });
    expect(hub.control({ op: 'grantPages', username: WORLD.otherUser.username, pages: [PAGE] })).toEqual({ ok: true, pages: [PAGE] });
    const as = async (route: HubRouteKey, request: unknown, who: string) => {
      const response = await call(route, request, who);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };
    const me = await as('me', null, other);
    expect((me.body['user'] as { assignedPages: Array<{ label: string }> }).assignedPages.map((page) => page.label)).toEqual([PAGE]);
    const boot = (await as('clientBootstrap', null, other)).body as { pages: Array<{ pageLabel: string }>; bindingsByHost: Record<string, number> };
    expect(HUB_ROUTE_SCHEMAS.clientBootstrap.response.safeParse(boot).success).toBe(true);
    expect(boot.pages.map((page) => page.pageLabel)).toEqual([PAGE]);
    expect(Object.values(boot.bindingsByHost)).toEqual([WORLD.pages.one.pageId]);
    const stats = { pageLabel: vip, windowDays: 30, timeZone: 'UTC' };
    expect(await as('clientSpenderStats', stats, other)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await as('clientFanClaimStatus', { pageLabel: vip, fanRef: WORLD.newFan }, other)).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect((await as('clientSpenderStats', { ...stats, pageLabel: PAGE }, other)).status).toBe(200);
    // The first chatter keeps every page.
    expect((await as('clientSpenderStats', stats, token)).status).toBe(200);
    expect(hub.status().grants).toEqual([
      { userId: WORLD.user.userId, pages: [PAGE, vip, WORLD.pages.fansly.pageLabel] },
      { userId: WORLD.otherUser.userId, pages: [PAGE] },
    ]);
    expect(() => hub.control({ op: 'grantPages', username: 'nobody', pages: [] })).toThrow(/no user/);
    expect(() => hub.control({ op: 'grantPages', userId: WORLD.otherUser.userId, pages: ['not-a-page'] })).toThrow(/no page/);
  });

  it('pageAccount: the owner links a page to a platform account; bootstrap follows with a newer revision, an unknown page throws', async () => {
    const before = (await ok('clientBootstrap', null)) as { configRevision: number; pages: Array<{ pageLabel: string; platformAccountId: string | null; bindingRevision: number }> };
    const was = before.pages.find((page) => page.pageLabel === PAGE);
    expect(hub.control({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: '830000101' })).toEqual({ ok: true, configRevision: before.configRevision + 1 });
    const after = (await ok('clientBootstrap', null)) as typeof before;
    expect(after.configRevision).toBe(before.configRevision + 1);
    expect(after.pages.find((page) => page.pageLabel === PAGE)).toMatchObject({ platformAccountId: '830000101', bindingRevision: (was?.bindingRevision ?? 0) + 1 });
    // The other pages are as they were.
    expect(after.pages.filter((page) => page.pageLabel !== PAGE)).toEqual(before.pages.filter((page) => page.pageLabel !== PAGE));
    hub.control({ op: 'pageAccount', pageLabel: PAGE, platformAccountId: null });
    expect(((await ok('clientBootstrap', null)) as typeof before).pages.find((page) => page.pageLabel === PAGE)?.platformAccountId).toBeNull();
    // Without a platform account the page is still bound by the owner's explicit host binding (the pilot has one)…
    await ok('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' });
    // …and with neither the extension has no way to bind a host account to it: `binding_missing`, as the hub says it.
    hub.control({ op: 'config', patch: { bindingsByHost: {} } });
    await refused('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' }, 409, 'client_feature_disabled', 'binding_missing');
    expect(() => hub.control({ op: 'pageAccount', pageLabel: 'not-a-page', platformAccountId: '1' })).toThrow(/no page/);
    hub.control({ op: 'reset' });
    token = hub.issueToken();
    expect(((await ok('clientBootstrap', null)) as typeof before).pages).toEqual(before.pages);
  });

  it('a hub before H-2 (clientBootstrap off) answers client/bootstrap 404; its page list serves a full token and is forbidden to a narrow one', async () => {
    hub.control({ op: 'config', patch: { clientBootstrap: false, narrowTokens: false } });
    const full = hub.issueToken();
    const mark = hub.journal.mark();
    const boot = await call('clientBootstrap', null, full);
    expect({ status: boot.status, body: (await boot.json()) as unknown }).toMatchObject({ status: 404, body: { error: 'not_found', reason: 'route_not_deployed' } });
    // `pages` of the vendored SDK, with its own schema: what the client's dev/compat mode builds a bootstrap from.
    const pages = (await (createClient({ baseUrl: hub.origin, fetch: hub.fetch, auth: { mode: 'bearer', token: () => full } }) as unknown as Sdk)['pages']?.()) as Array<{ label: string; displayName: string }>;
    expect(pages.map((page) => page.label)).toEqual([PAGE, WORLD.pages.vip.pageLabel, WORLD.pages.fansly.pageLabel]);
    expect(hub.read(mark).entries.map((entry) => [entry.path, entry.kind, entry.status])).toEqual([
      ['/api/v1/client/bootstrap', 'route', 404],
      ['/api/v1/pages', 'legacy', 200],
    ]);
    expect(hub.violations(mark)).toEqual([]);

    // The narrow token (H-3) reaches only its allow-list: the page list is a call the client must never make.
    hub.control({ op: 'config', patch: { narrowTokens: true } });
    const narrow = hub.issueToken();
    const later = hub.journal.mark();
    const refusedPages = await hub.fetch(`${hub.origin}/api/v1/pages`, { headers: { authorization: `Bearer ${narrow}` } });
    expect(refusedPages.status).toBe(403);
    expect(hub.violations(later).map((entry) => [entry.kind, entry.operation])).toEqual([['forbidden', 'pages']]);
    expect((await hub.fetch(`${hub.origin}/api/v1/pages`)).status).toBe(401);
  });

  it('an owner flag off refuses its route with client_feature_disabled and the reason; Fansly is platform_unsupported', async () => {
    hub.control({ op: 'config', patch: { pageFlags: { [PAGE]: { stats: false } } } });
    await refused('clientSpenderStats', { pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' }, 409, 'client_feature_disabled', 'flag_off');
    await ok('clientSpenderStats', { pageLabel: WORLD.pages.vip.pageLabel, windowDays: 30, timeZone: 'UTC' });
    await refused('clientConversationFeed', { pageLabel: WORLD.pages.fansly.pageLabel, fanRef: WORLD.fan }, 409, 'client_feature_disabled', 'platform_unsupported');
    hub.control({ op: 'config', patch: { master: false } });
    await refused('clientAudienceNew', { pageLabel: PAGE, windowHours: 48 }, 409, 'client_feature_disabled', 'disabled');
  });

  it('«Новые» wider than the hub allows is refused', async () => {
    hub.control({ op: 'config', patch: { limits: { audienceWindowHours: 72 } } });
    await refused('clientAudienceNew', { pageLabel: PAGE, windowHours: 168 }, 400, 'bad_request', 'window_too_wide');
  });

  it('the model’s own answer is checked against the response schema: a contract-invalid answer is 500 fake_hub_bug with the issues journaled', async () => {
    hub.control({ op: 'config', patch: { limits: { claimLeaseSec: -5 } } });
    const mark = hub.journal.mark();
    const response = await call('clientBootstrap', null);
    const body = (await response.json()) as { error: string; reason: string; message: string };
    expect({ status: response.status, error: body.error, reason: body.reason }).toEqual({ status: 500, error: 'internal_error', reason: 'fake_hub_bug' });
    expect(body.message).toMatch(/self-check limits\.claimLeaseSec/);
    const [entry] = hub.read(mark).entries;
    expect(entry).toMatchObject({ route: 'clientBootstrap', status: 500, error: 'internal_error', reason: 'fake_hub_bug', servedBy: 'check' });
    expect(entry?.issues).toEqual([expect.stringMatching(/^self-check limits\.claimLeaseSec: /)]);
    // A model bug is a violation of the run, like an invalid request.
    expect(hub.violations(mark)).toHaveLength(1);
  });

  it('a request that fails the contract schema is 400 bad_request and journaled as invalid', async () => {
    const mark = hub.journal.mark();
    await refused('clientSpenderStats', { pageLabel: PAGE, windowDays: 7, timeZone: 'UTC' }, 400, 'bad_request');
    const [entry] = hub.read(mark).entries;
    expect(entry?.issues.length).toBeGreaterThan(0);
    expect(hub.violations(mark)).toHaveLength(1);
  });
});

function sampleRequest(route: HubRouteKey): unknown {
  const fan = { pageLabel: PAGE, fanRef: WORLD.fan };
  const samples: Partial<Record<HubRouteKey, unknown>> = {
    clientConversationRecaps: fan,
    clientFanClaimStatus: fan,
    clientConversationFeed: fan,
    clientFanProfileFromGeneration: { ...fan, generationRef: uuid(0x200) },
    clientSpenderStats: { pageLabel: PAGE, windowDays: 30, timeZone: 'UTC' },
    clientSpenderAwaitingReply: { pageLabel: PAGE },
    clientAudienceNew: { pageLabel: PAGE, windowHours: 48 },
    clientAiUsageDaily: { pageLabel: PAGE, date: '2026-10-03' },
  };
  if (!(route in samples)) throw new Error(`no sample for ${route}`);
  return samples[route];
}
