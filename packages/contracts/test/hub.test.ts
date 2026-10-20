import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as C from '../src/index';
import { HUB_SAMPLES } from './fixtures/index';

const ARCHITECTURE = fileURLToPath(new URL('../../../docs/architecture.md', import.meta.url));

/** The bullets of one part of Appendix A «Колонка chat-extension», continuation lines joined. */
function appendixBullets(from: string, to: string): string[] {
  const text = readFileSync(ARCHITECTURE, 'utf8');
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start, `«${from}» in architecture.md`).toBeGreaterThan(0);
  expect(end, `«${to}» after it`).toBeGreaterThan(start);
  const bullets: string[] = [];
  for (const line of text.slice(start + from.length, end).split('\n')) {
    if (line.startsWith('- ')) bullets.push(line.slice(2));
    else if (line.startsWith('  ') && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets;
}

const hubCodesOf = (text: string): string[] => [...text.matchAll(/`([a-z_*]+)`/g)].map((m) => m[1] ?? '');
const cgCodesOf = (text: string): string[] => [...text.matchAll(/CG-[A-Z0-9-]+[A-Z0-9]/g)].map((m) => m[0]).filter((code) => C.isCgCode(code));

type Ctx = C.HubErrorContext;
const baseContext = (route: C.HubRouteKey): Ctx => ({
  route,
  currentSignIn: true,
  pageGranted: true,
  beforeFirstFrame: false,
  claimAction: null,
  fanLookup: false,
  now: Date.UTC(2026, 9, 3, 10, 0, 0),
});

function conditionHolds(condition: C.HubErrorCondition, ctx: Ctx): boolean {
  switch (condition) {
    case 'stale-sign-in':
      return !ctx.currentSignIn;
    case 'page-not-granted':
      return ctx.pageGranted === false;
    case 'fan-lookup':
      return ctx.fanLookup;
    case 'before-first-frame':
      return ctx.beforeFirstFrame;
    case 'dispatch':
      return ctx.claimAction === 'dispatch';
  }
}

/** First matching rule: the reading every resolver must give the table. */
function firstRule(status: number, error: string | null, reason: string | null, ctx: Ctx): number {
  const routeClass = C.HUB_ROUTES[ctx.route].routeClass;
  return C.HUB_HTTP_ERROR_RULES.findIndex(
    (rule) =>
      (rule.error === null || rule.error === error) &&
      (rule.status === undefined || (rule.status === '5xx' ? status >= 500 && status <= 599 : rule.status === status)) &&
      (rule.reason === undefined || rule.reason === reason) &&
      (rule.routes === undefined || rule.routes.includes(routeClass)) &&
      (rule.when === undefined || conditionHolds(rule.when, ctx)),
  );
}

const ruleFor = (status: number, error: string | null, reason: string | null, ctx: Ctx): C.HubHttpErrorRule => {
  const index = firstRule(status, error, reason, ctx);
  const rule = C.HUB_HTTP_ERROR_RULES[index];
  if (rule === undefined) throw new Error(`no rule for ${status} ${error}`);
  return rule;
};

const routeOfClass = (routeClass: C.HubRouteClass): C.HubRouteKey => {
  const key = C.HUB_ROUTE_KEYS.find((k) => C.HUB_ROUTES[k].routeClass === routeClass);
  if (key === undefined) throw new Error(routeClass);
  return key;
};

describe('hub error map vs Appendix A «Колонка chat-extension»', () => {
  it('§2 SSE: every listed code maps exactly as written; fallbacks too', () => {
    const bullets = appendixBullets('§2 SSE:', '§3 HTTP:');
    const listed: Record<string, string> = {};
    for (const bullet of bullets) {
      const [code] = hubCodesOf(bullet);
      const [cg] = cgCodesOf(bullet);
      if (code === undefined || cg === undefined || code.includes('*') || code === 'done') continue;
      listed[code] = cg;
    }
    expect(listed).toEqual(C.HUB_SSE_ERROR_CODES);
    const text = bullets.join('\n');
    expect(text).toMatch(new RegExp(`\`provider\\*\` → ${C.HUB_SSE_FALLBACKS.provider}`));
    expect(text).toContain(`прочий неизвестный код → ${C.HUB_SSE_FALLBACKS.other}`);
    expect(text).toContain(`→ ${C.HUB_SSE_FALLBACKS.truncated}`);
    expect(C.HUB_SSE_FALLBACKS.providerPrefix).toBe('provider');
  });

  it('§3 HTTP: every listed hub code has a rule for each CG code on its line', () => {
    const bullets = appendixBullets('§3 HTTP:', '**Старые коды → новые**');
    expect(bullets.length).toBeGreaterThan(10);
    for (const bullet of bullets) {
      const [lhs = '', rhs = ''] = bullet.split('→');
      const codes = hubCodesOf(lhs).filter((code) => code !== 'reason');
      const cgs = cgCodesOf(rhs);
      if (codes.some((code) => code.includes('*'))) {
        // voice_* is phase 2: no rule may claim it yet.
        expect(C.HUB_HTTP_ERROR_RULES.some((rule) => rule.error?.startsWith('voice_'))).toBe(false);
        continue;
      }
      const pairs = codes.length > 1 && codes.length === cgs.length ? codes.map((code, i) => [code, cgs[i]] as const) : codes.flatMap((code) => cgs.map((cg) => [code, cg] as const));
      for (const [code, cg] of pairs) {
        const mapped = C.HUB_HTTP_ERROR_RULES.filter((rule) => rule.error === code).map((rule) => rule.cg);
        expect(mapped, `${code} → ${cg}`).toContain(cg);
      }
    }
  });

  it('hub-pr-plan §4.11 codes all have a status and a rule', () => {
    for (const code of Object.keys(C.HUB_ERROR_STATUSES)) {
      expect(C.HUB_HTTP_ERROR_RULES.some((rule) => rule.error === code), code).toBe(true);
    }
  });

  it('every rule names registered CG codes and known route classes, and is reachable', () => {
    C.HUB_HTTP_ERROR_RULES.forEach((rule, index) => {
      if (rule.cg !== null) expect(C.isCgCode(rule.cg), `${index}`).toBe(true);
      for (const routeClass of rule.routes ?? []) expect(C.HUB_ROUTE_CLASSES).toContain(routeClass);
      const route = rule.routes?.[0] !== undefined ? routeOfClass(rule.routes[0]) : 'me';
      const ctx: Ctx = {
        ...baseContext(route),
        currentSignIn: rule.when !== 'stale-sign-in',
        pageGranted: rule.when !== 'page-not-granted',
        beforeFirstFrame: rule.when === 'before-first-frame',
        claimAction: rule.when === 'dispatch' ? 'dispatch' : null,
        fanLookup: rule.when === 'fan-lookup',
      };
      const known = rule.error !== null && rule.error in C.HUB_ERROR_STATUSES ? C.HUB_ERROR_STATUSES[rule.error as C.HubErrorCode] : null;
      const status = rule.status === '5xx' ? 502 : (rule.status ?? known ?? 418);
      const error = rule.error ?? 'some_future_code';
      expect(firstRule(status, error, rule.reason ?? null, ctx), `rule ${index} (${rule.error ?? '*'} → ${rule.cg ?? '-'}) is shadowed`).toBe(index);
    });
  });

  it('reads the route- and fact-dependent cases of §3 and §8.2', () => {
    const page = baseContext('clientConversationFeed');
    expect(ruleFor(401, 'unauthorized', 'token_revoked', page)).toMatchObject({ cg: 'CG-AUTH-REVOKED', disposition: 'clear-sign-in' });
    expect(ruleFor(401, 'unauthorized', 'token_expired', { ...page, currentSignIn: false })).toMatchObject({ cg: null, disposition: 'ignore' });
    expect(ruleFor(401, 'unauthorized', null, page)).toMatchObject({ cg: 'CG-AUTH-REJECTED', disposition: 'show' });
    expect(ruleFor(401, 'unauthorized', null, baseContext('authIssueDeviceTokenWithPassword')).cg).toBe('CG-LOGIN-CREDENTIALS');
    expect(ruleFor(429, 'rate_limit_exceeded', null, baseContext('authIssueDeviceTokenWithPassword')).cg).toBe('CG-LOGIN-RATE-LIMIT');
    expect(ruleFor(503, 'service_unavailable', null, baseContext('authIssueDeviceTokenWithPassword')).cg).toBe('CG-LOGIN-UNAVAILABLE');
    expect(ruleFor(404, 'not_found', null, { ...page, pageGranted: false }).cg).toBe('CG-BINDING-NOT-GRANTED');
    expect(ruleFor(404, 'not_found', null, { ...baseContext('pageConversationProfile'), fanLookup: true })).toMatchObject({ cg: null, disposition: 'empty' });
    expect(ruleFor(404, 'not_found', null, page).cg).toBe('CG-HUB-REQUEST');
    expect(ruleFor(409, 'conflict', null, baseContext('clientFanClaim')).cg).toBe('CG-CLAIM-BUSY');
    expect(ruleFor(409, 'conflict', null, page).cg).toBe('CG-HUB-REQUEST');
    const stream = baseContext('aiFeatureStream');
    expect(ruleFor(503, 'service_unavailable', null, { ...stream, beforeFirstFrame: true }).disposition).toBe('retry-once');
    expect(ruleFor(503, 'service_unavailable', null, stream).disposition).toBe('show');
    expect(ruleFor(503, 'service_unavailable', null, { ...baseContext('clientFanClaim'), claimAction: 'dispatch' }).disposition).toBe('show');
    expect(ruleFor(502, null, null, { ...stream, beforeFirstFrame: true })).toMatchObject({ cg: 'CG-HUB-UNAVAILABLE', disposition: 'show' });
    expect(ruleFor(429, 'quota_denied', null, stream)).toMatchObject({ cg: 'CG-QUOTA-DAILY', retryAt: 'next-utc-midnight' });
    expect(ruleFor(409, 'persona_definition_changed', null, stream).disposition).toBe('refresh-catalog');
    const claim = baseContext('clientFanClaim');
    expect(ruleFor(409, 'client_feature_disabled', 'flag_off', { ...claim, claimAction: 'dispatch' }).cg).toBe('CG-SEND-OFF');
    expect(ruleFor(409, 'client_feature_disabled', 'flag_off', { ...claim, claimAction: 'claim' }).cg).toBe('CG-FEATURE-DISABLED');
    expect(ruleFor(409, 'client_feature_disabled', 'binding_missing', page).cg).toBe('CG-BINDING-MISSING');
    expect(ruleFor(409, 'client_feature_disabled', 'client_outdated', stream).cg).toBe('CG-HUB-OUTDATED');
    expect(ruleFor(400, 'bad_request', 'cursor_window_mismatch', baseContext('clientAudienceNew')).disposition).toBe('restart-cursor');
    expect(ruleFor(409, 'generation_not_ready', null, baseContext('clientFanProfileFromGeneration'))).toMatchObject({ cg: 'CG-RECAP-SAVE', disposition: 'not-ready' });
    expect(ruleFor(409, 'custody_held', null, claim).cg).toBe('CG-SEND-UNCERTAIN');
    expect(ruleFor(409, 'part_already_sent', null, claim).disposition).toBe('read-status');
    expect(ruleFor(409, 'some_future_conflict', null, page).cg).toBe('CG-HUB-UNKNOWN');
    expect(ruleFor(400, 'Bad Request', null, page).cg).toBe('CG-HUB-REQUEST');
  });

  it('transport failures and client checks name registered codes', () => {
    for (const codes of Object.values(C.HUB_TRANSPORT_CODES)) {
      for (const code of Object.values(codes)) if (code !== null) expect(C.isCgCode(code)).toBe(true);
    }
    for (const code of Object.values(C.HUB_CLIENT_CHECK_CODES)) expect(C.isCgCode(code)).toBe(true);
    expect([...C.HUB_TRANSPORT_FAILURES].sort()).toEqual(Object.keys(C.HUB_TRANSPORT_CODES).sort());
  });

  it('1.1.0: the two rejection shapes of the facade are told apart by name, every check has a code', () => {
    expect(C.HUB_CLIENT_CHECKS).toEqual(Object.keys(C.HUB_CLIENT_CHECK_CODES));
    const check: C.HubCheckError = { name: 'HubCheckError', check: 'signInPending', code: C.HUB_CLIENT_CHECK_CODES.signInPending, route: 'authIssueDeviceTokenWithPassword', epoch: 3 };
    const call: C.HubCallError = {
      name: 'HubCallError',
      route: 'me',
      failure: { kind: 'transport', failure: 'network' },
      epoch: 3,
      resolution: { code: 'CG-NETWORK', disposition: 'show', retryAt: null, httpStatus: null },
    };
    expect(C.isHubCheckError(check)).toBe(true);
    expect(C.isHubCallError(check)).toBe(false);
    expect(C.isHubCallError(call)).toBe(true);
    expect(C.isHubCheckError(call)).toBe(false);
    for (const value of [null, undefined, 'HubCallError', { name: 'Error' }]) {
      expect(C.isHubCallError(value)).toBe(false);
      expect(C.isHubCheckError(value)).toBe(false);
    }
    expect(C.HUB_CLIENT_CHECK_CODES.notSignedIn).toBe('CG-AUTH-REQUIRED');
    expect(C.HUB_CLIENT_CHECK_CODES.bootstrapMissing).toBe('CG-HUB-OUTDATED');
    expect(C.HUB_CLIENT_CHECK_CODES.boardTimeout).toBe('CG-DATA-TIMEOUT');
    expect(C.HUB_CLIENT_CHECK_CODES.previewSendOff).toBe('CG-SEND-OFF');
  });
});

describe('hub routes, flags and the feature map', () => {
  it('the client\'s own transport needs and route capabilities use the known vocabularies', () => {
    // 1.15.0 (R20 F4): the table keeps only what this client's own transport needs on top of the hub's decision
    // about the page — one need: fresh text goes as `liveTextContext`, which the hub refuses without the
    // `context-v1` request header. What the HUB needs to offer a flag is the hub's table, in the page's feature.
    expect(C.CLIENT_FLAG_REQUIREMENTS).toEqual({ freshText: ['context-v1'] });
    for (const [flag, needs] of Object.entries(C.CLIENT_FLAG_REQUIREMENTS)) {
      expect(C.CLIENT_FEATURE_FLAG_NAMES).toContain(flag);
      for (const need of needs) expect(C.CLIENT_HUB_CAPABILITY_NAMES).toContain(need);
    }
    for (const key of C.HUB_ROUTE_KEYS) {
      const spec = C.HUB_ROUTES[key];
      for (const capability of spec.capabilities) expect(C.CLIENT_HUB_CAPABILITY_NAMES).toContain(capability);
      if (spec.flag !== null) expect(C.CLIENT_FEATURE_FLAG_NAMES).toContain(spec.flag);
      expect(C.HUB_FORBIDDEN_OPERATIONS as readonly string[]).not.toContain(key);
    }
    // §4.10.4: public routes are not in the narrow token's list; everything else is.
    expect(C.HUB_ROUTE_KEYS.filter((key) => !C.HUB_ROUTES[key].narrowToken)).toEqual(['authIssueDeviceTokenWithPassword', 'health']);
  });

  it('maps every feature of ours to one hub feature, Split and fresh text by D-14/D-15', () => {
    for (const feature of C.FEATURE_IDS) expect(C.HUB_AI_FEATURES).toContain(C.HUB_FEATURE_MAP[feature].hub);
    expect(C.HUB_FEATURE_MAP['recap-short']).toMatchObject({ hub: 'fan-summary', summaryMode: 'short' });
    const splitHub = C.FEATURE_IDS.filter((f) => C.HUB_FEATURE_MAP[f].replyMode !== null);
    expect(splitHub.sort()).toEqual([...C.SPLIT_FEATURES].sort());
    const liveHub = C.HUB_FEATURE_ONLY_FIELDS.liveTextContext;
    const live = [...C.FRESH_TEXT_FEATURES, ...C.ANSWER_FRESH_TEXT_FEATURES];
    expect([...liveHub].sort()).toEqual([...new Set([...live.map((f) => C.HUB_FEATURE_MAP[f].hub), 'voice-script', 'fan-notes-fill'])].sort());
    // 1.29.0 (decision X52): Review and Coach need the hub's token for it; the draft features need nothing more.
    expect(C.FEATURE_IDS.filter((f) => C.LIVE_TEXT_HUB_NEEDS[f] !== undefined)).toEqual(['review', 'recap', 'recap-short', 'coach']);
    expect(C.FEATURE_IDS.map((f) => C.LIVE_TEXT_HUB_NEEDS[f] ?? null)).toEqual([null, null, null, null, 'live-text-review-coach-v1', 'live-text-recap-v1', 'live-text-recap-v1', 'live-text-review-coach-v1']);
    expect(C.FEATURE_IDS.map((f) => [f, C.freshTextSurface(f)])).toEqual([
      ['reply', 'dock'], ['fix', 'dock'], ['hi', 'dock'], ['ping', 'dock'], ['review', 'dock'], ['recap', 'dock'], ['recap-short', 'dock'], ['coach', 'coach'],
    ]);
  });

  it('narrows open tokens: unknown flags are off, unknown capabilities absent', () => {
    expect(C.isFlagOn({ insertion: true }, 'insertion')).toBe(true);
    expect(C.isFlagOn({ insertion: 'true' as unknown as boolean }, 'insertion')).toBe(false);
    expect(C.isFlagOn({}, 'previewSend')).toBe(false);
    expect(C.isFlagOn(Object.create({ previewSend: true }) as Record<string, boolean>, 'previewSend')).toBe(false);
    expect(C.hasCapability(['context-v1'], 'context-v1')).toBe(true);
    expect(C.hasCapability(['context-v2'], 'context-v1')).toBe(false);
    expect(C.narrowToken(C.CLIENT_FEATURE_UNAVAILABLE_REASONS, 'flag_off')).toBe('flag_off');
    expect(C.narrowToken(C.CLIENT_FEATURE_UNAVAILABLE_REASONS, 'moon_phase')).toBeNull();
  });

  it('custody never frees itself: uncertain-held ends only by proof or resolve', () => {
    expect(C.isCustodyTransition(null, 'dispatching')).toBe(true);
    expect(C.isCustodyTransition(null, 'sent')).toBe(true);
    expect(C.isCustodyTransition(null, 'uncertain-held')).toBe(false);
    expect(C.isCustodyTransition('dispatching', 'uncertain-held')).toBe(true);
    expect(C.isCustodyTransition('uncertain-held', 'failed')).toBe(false);
    expect(C.isCustodyTransition('uncertain-held', 'dispatching')).toBe(false);
    expect(C.isCustodyTransition('uncertain-held', 'sent')).toBe(true);
    for (const terminal of ['sent', 'failed', 'resolved-sent', 'resolved-not-sent'] as const) expect(C.CUSTODY_TRANSITIONS[terminal]).toEqual([]);
    for (const state of C.CUSTODY_BLOCKING_STATES) expect(C.CUSTODY_TRANSITIONS[state].length).toBeGreaterThan(0);
  });

  it('builds the owner binding key of a host account (critic: onlymonster:<id>)', () => {
    expect(C.hostBindingKey('chatspace', '1001')).toBe('onlymonster:1001');
    expect(HUB_SAMPLES.bootstrap.bindingsByHost['onlymonster:1001']).toBe(11);
  });

  it('every route has its request and answer schemas, and the samples pass them', () => {
    expect(Object.keys(C.HUB_ROUTE_SCHEMAS).sort()).toEqual([...C.HUB_ROUTE_KEYS].sort());
    const answers: Partial<Record<C.HubRouteKey, unknown>> = {
      clientBootstrap: HUB_SAMPLES.bootstrap,
      me: HUB_SAMPLES.authState,
      health: HUB_SAMPLES.health,
      spenders: HUB_SAMPLES.spendersPage,
      clientConversationFeed: HUB_SAMPLES.feedPage,
      clientFanClaim: HUB_SAMPLES.claimState,
      clientAudienceNew: HUB_SAMPLES.audiencePage,
      aiFeatureStream: HUB_SAMPLES.frames.context,
    };
    for (const [key, answer] of Object.entries(answers)) {
      expect(C.HUB_ROUTE_SCHEMAS[key as C.HubRouteKey].response.safeParse(answer).success, key).toBe(true);
    }
    expect(C.HUB_ROUTE_SCHEMAS.aiFeatureStream.request.safeParse(HUB_SAMPLES.streamRequest).success).toBe(true);
  });

  it('keeps hub URL paths out of contracts (sdk-custody gate)', () => {
    const serialized = JSON.stringify({ routes: C.HUB_ROUTES, forbidden: C.HUB_FORBIDDEN_OPERATIONS });
    expect(serialized).not.toMatch(/\/api\/v\d+\//);
  });
});
