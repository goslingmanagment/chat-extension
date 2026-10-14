import {
  BootstrapSchema,
  CLIENT_FEATURE_FLAG_NAMES,
  HUB_ERROR_STATUSES,
  HUB_ROUTE_KEYS,
  HUB_ROUTE_SCHEMAS,
  HubErrorBodySchema,
  HubFrameSchema,
  HubStreamRequestSchema,
  SPENDERS_BOARD,
  SpendersBoardSchema,
  hasCapability,
  hostBindingKey,
  isCustodyTransition,
  isFlagOn,
  narrowPlatform,
  type AutoLists,
  type Bootstrap,
  type BootstrapPage,
  type ClaimAction,
  type ClaimState,
  type ClientFeatureFlag,
  type CustodyState,
  type FeedPage,
  type HubErrorCode,
  type SpendersPage,
} from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { BOARD_TOTAL, BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_FEATURE_CAPABILITIES, PILOT_FLAGS_OFF, existsOnOnlyFans } from './http';
import { readStreamScenario, resolveHubErrorReference, sseText } from './reference';
import { SSE_SCENARIOS } from './sse';
import { HUB_ROUTE_PATHS, type HttpExchange, type HttpScenario } from './types';
import { NOW, NOW_MS, PAGE, WORLD } from './world';

const scenario = (name: string): HttpScenario => {
  const found = HTTP_SCENARIOS.find((s) => s.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};
const bodies = <T>(exchanges: readonly HttpExchange[]): T[] => exchanges.filter((e) => e.response.status === 200).map((e) => e.response.body as T);
const requestOf = (exchange: HttpExchange): Record<string, unknown> => exchange.request as Record<string, unknown>;

/** The SDK's SSE parse: blank-line frames, `event: ai`, `data:` lines; comments skipped. */
function parseSse(text: string): unknown[] {
  return text
    .split('\n\n')
    .filter((raw) => raw.length > 0)
    .flatMap((raw) => {
      const lines = raw.split('\n').filter((line) => !line.startsWith(':'));
      const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
      const data = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
      return event === 'ai' && data !== '' ? [JSON.parse(data) as unknown] : [];
    });
}

/** A flag works on a page only with the flag on, the page feature available and every capability the HUB asks for it declared (§4.12; the hub's table, as the fake hub repeats it). */
function usable(bootstrap: Bootstrap, page: BootstrapPage, flag: ClientFeatureFlag): boolean {
  return (
    isFlagOn(bootstrap.flags, flag) &&
    page.features[flag]?.available === true &&
    (HUB_FEATURE_CAPABILITIES[flag] ?? []).every((capability) => hasCapability(bootstrap.capabilities, capability))
  );
}

describe('fake hub: AI stream scenarios', () => {
  it('names are unique', () => {
    expect(new Set(SSE_SCENARIOS.map((s) => s.name)).size).toBe(SSE_SCENARIOS.length);
  });

  for (const s of SSE_SCENARIOS) {
    it(`${s.name}: request, frames and refusals parse; the client reads it as expected`, () => {
      expect(HubStreamRequestSchema.safeParse(s.request).success, 'request').toBe(true);
      for (const response of s.responses) {
        if (response.kind === 'http-error') {
          expect(HubErrorBodySchema.safeParse(response.body).success).toBe(true);
          expect(response.status).toBe(HUB_ERROR_STATUSES[response.body.error as HubErrorCode]);
          expect(response.body.statusCode).toBe(response.status);
          continue;
        }
        const frames = response.steps.flatMap((step) => (step.kind === 'frame' ? [step.frame] : []));
        for (const frame of frames) expect(HubFrameSchema.safeParse(frame).success, JSON.stringify(frame).slice(0, 120)).toBe(true);
        expect(parseSse(sseText(response))).toEqual(frames);
        expect(response.steps.at(-1)?.kind).toBe('eof');
      }

      const reading = readStreamScenario(s, NOW_MS);
      expect(reading.orderProblems).toEqual([]);
      expect(reading.requests, 'every scripted response is used').toBe(s.responses.length);
      expect({
        outcome: reading.outcome,
        requests: reading.requests,
        cg: reading.resolution?.code ?? null,
        disposition: reading.resolution?.disposition ?? null,
        retryAfterMs: reading.resolution?.retryAt === null || reading.resolution === null ? null : reading.resolution.retryAt - NOW_MS,
        result: reading.result,
        context: reading.context === null ? null : { source: reading.context.source, live: reading.context.live.status },
      }).toEqual(s.expect);
    });
  }

  it('covers the required cases', () => {
    const names = SSE_SCENARIOS.map((s) => s.name);
    for (const required of ['reply-normal', 'persona-409', 'quota-429', 'unavailable-503-then-stream', 'error-frame-provider-rate-limited', 'truncated-mid-stream', 'reply-split-across-chunks', 'hi-three-variants']) {
      expect(names).toContain(required);
    }
    expect(SSE_SCENARIOS.filter((s) => s.name.startsWith('context-')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('fake hub: HTTP scenarios', () => {
  it('names are unique; every route has a path', () => {
    expect(new Set(HTTP_SCENARIOS.map((s) => s.name)).size).toBe(HTTP_SCENARIOS.length);
    expect(Object.keys(HUB_ROUTE_PATHS).sort()).toEqual([...HUB_ROUTE_KEYS].sort());
    for (const path of Object.values(HUB_ROUTE_PATHS)) expect(path).toMatch(/^\/api\/v\d+\//);
  });

  for (const s of HTTP_SCENARIOS) {
    it(`${s.name}: requests and answers parse; refusals read as expected`, () => {
      s.exchanges.forEach((exchange, index) => {
        const label = `${s.name}[${index}] ${exchange.route}`;
        const schemas = HUB_ROUTE_SCHEMAS[exchange.route];
        if (schemas.request === null) expect(exchange.request, label).toBeNull();
        else expect(schemas.request.safeParse(exchange.request).success, `${label} request`).toBe(true);

        const { status, body } = exchange.response;
        if (status >= 200 && status < 300) {
          const parsed = schemas.response.safeParse(body);
          expect(parsed.success, `${label} answer: ${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
          expect(exchange.expect, label).toBeUndefined();
          return;
        }
        expect(HubErrorBodySchema.safeParse(body).success, `${label} error body`).toBe(true);
        const error = (body as { error: string; reason?: string }).error;
        expect(status, label).toBe(HUB_ERROR_STATUSES[error as HubErrorCode]);
        expect(exchange.expect, `${label} needs an expectation`).toBeDefined();
        const claimAction = exchange.route === 'clientFanClaim' ? ((requestOf(exchange)['body'] as { action: ClaimAction }).action ?? null) : null;
        const resolution = resolveHubErrorReference(
          {
            kind: 'http',
            status,
            error,
            reason: (body as { reason?: string }).reason ?? null,
            retryAfterMs: exchange.response.retryAfterSec === undefined ? null : exchange.response.retryAfterSec * 1000,
          },
          {
            route: exchange.route,
            currentSignIn: exchange.facts?.currentSignIn ?? true,
            pageGranted: exchange.facts?.pageGranted ?? true,
            beforeFirstFrame: exchange.facts?.beforeFirstFrame ?? false,
            claimAction,
            fanLookup: exchange.facts?.fanLookup ?? false,
            now: NOW_MS,
          },
        );
        expect({ cg: resolution.code, disposition: resolution.disposition }, label).toEqual(exchange.expect);
      });
    });
  }

  it('bootstrap all-off: nothing is usable; pilot-on: every pilot flag on both OF pages, Fansly off — the `*` row never reaches it (R20 HF-2)', () => {
    expect(BootstrapSchema.parse(BOOTSTRAP_ALL_OFF).configRevision).toBe(0);
    for (const page of BOOTSTRAP_ALL_OFF.pages) {
      for (const flag of CLIENT_FEATURE_FLAG_NAMES) expect(usable(BOOTSTRAP_ALL_OFF, page, flag), `${page.pageLabel} ${flag}`).toBe(false);
    }
    const ofPages = BOOTSTRAP_PILOT_ON.pages.filter((page) => narrowPlatform(page.platform) === 'onlyfans');
    expect(ofPages.map((page) => page.pageLabel)).toEqual([WORLD.pages.one.pageLabel, WORLD.pages.vip.pageLabel]);
    for (const page of ofPages) {
      // Fansly's own switches (contracts 1.15.0, P4b3) are not on an OnlyFans page at all (hub HF-2).
      for (const flag of CLIENT_FEATURE_FLAG_NAMES) expect(usable(BOOTSTRAP_PILOT_ON, page, flag), `${page.pageLabel} ${flag}`).toBe(existsOnOnlyFans(flag) && !PILOT_FLAGS_OFF.includes(flag));
      for (const flag of ['drafts', 'voice', 'notesFill', 'notes', 'vault', 'registration']) expect(page.features[flag], `${page.pageLabel} ${flag}`).toEqual({ available: false, reason: 'platform_unsupported' });
    }
    const fansly = BOOTSTRAP_PILOT_ON.pages.find((page) => page.platform === 'fansly');
    expect(fansly?.features['insertion']?.reason).toBe('flag_off');
    expect(fansly?.features['navigation']?.reason).toBe('platform_unsupported');
    expect(BOOTSTRAP_PILOT_ON.bindingsByHost[hostBindingKey('chatspace', WORLD.pages.vip.hostAccountId)]).toBe(WORLD.pages.vip.pageId);
  });

  it('the Spenders board: five pages fill exactly the 1000-row cap, ranked, no duplicates', () => {
    const all = scenario('spenders-board-1000').exchanges;
    const exchanges = all.filter((e) => e.route === 'spenders');
    expect(exchanges.map((e) => requestOf(e)['offset'])).toEqual([0, 200, 400, 600, 800]);
    const pages = bodies<SpendersPage>(exchanges);
    const tiers = bodies<AutoLists>(all.filter((e) => e.route === 'pageSpenderAutoLists'))[0] ?? null;
    expect(tiers).not.toBeNull();
    expect(pages.length).toBe(SPENDERS_BOARD.maxPages);
    const items = pages.flatMap((page) => page.items);
    expect(items.length).toBe(SPENDERS_BOARD.maxRows);
    expect(new Set(items.map((item) => item.fan.platformUserId)).size).toBe(items.length);
    const gross = items.map((item) => item.metrics.window?.grossAmountMills ?? 0);
    expect([...gross].sort((a, b) => b - a)).toEqual(gross);
    const first = pages[0];
    if (first === undefined) throw new Error('no page');
    const board = {
      pageLabel: PAGE,
      period: '30d',
      scope: first.scope,
      periodMeta: first.period,
      diagnostics: first.diagnostics,
      items,
      total: first.total,
      complete: true,
      fetchedAt: NOW,
      tiers,
    };
    expect(SpendersBoardSchema.safeParse(board).success).toBe(true);
    expect(board.total).toBe(BOARD_TOTAL);
    expect(SpendersBoardSchema.safeParse({ ...board, items: [...items, ...items.slice(0, 1)] }).success).toBe(false);
  });

  it('feed pages chain by cursor, newest → oldest, summary on the first page only', () => {
    const exchanges = scenario('feed-pages').exchanges.slice(0, 3);
    const pages = bodies<FeedPage>(exchanges);
    pages.forEach((page, i) => {
      expect(page.summary === null, `page ${i}`).toBe(i > 0);
      const next = exchanges[i + 1];
      expect(page.nextOlderCursor).toBe(next === undefined ? null : requestOf(next)['cursor']);
    });
    const items = pages.flatMap((page) => page.items);
    expect(new Set(items.map((item) => item.messageId)).size).toBe(items.length);
    const times = items.map((item) => Date.parse(item.at ?? ''));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('claim and custody move only along the frozen transitions; a greeting stays confirmed', () => {
    for (const s of HTTP_SCENARIOS.filter((x) => x.name.startsWith('claim') || x.name.includes('native') || x.name.includes('preview-reply'))) {
      const custody = new Map<string, CustodyState>();
      let greeted = false;
      for (const state of bodies<ClaimState>(s.exchanges.filter((e) => e.route === 'clientFanClaim' || e.route === 'clientFanClaimStatus'))) {
        if (state.custody !== null) {
          const before = custody.get(state.custody.attemptId) ?? null;
          expect(isCustodyTransition(before, state.custody.state), `${s.name}: ${before ?? 'none'} → ${state.custody.state}`).toBe(true);
          custody.set(state.custody.attemptId, state.custody.state);
          if (state.custody.ticket !== null) expect(state.custody.state, `${s.name}: a ticket only with dispatching`).toBe('dispatching');
        }
        if (greeted) expect(state.greeting.state, s.name).toBe('confirmed');
        greeted = state.greeting.state === 'confirmed';
      }
    }
  });
});
