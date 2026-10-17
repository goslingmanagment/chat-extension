// The fake hub (architecture.md §12 п. 2, R02): every route of the contracts'
// hub route table, answered by a stateful model of the hub or by scenario
// scripts a test switches per test, behind the hub's own checks — bearer
// auth with revoke/expiry reasons, the narrow token's allow-list (H-3),
// strict request schemas (400 like the real hub), deployment by capability,
// page grants and the owner's flags (§4.12). One request pipeline serves two
// modes: in-process (`hub.fetch`, a fetch implementation for unit tests, e.g.
// the vendored SDK's `fetch` option) and loopback (server.ts, for e2e).
//
// Pipeline: control? → classify (route / forbidden / unknown) → auth →
// narrow-token allow-list → wire → facade request → schema → script → model
// checks (deployed, page granted, flag) → model. Every call is journaled.
//
// R20 P6c1: Fansly per SDK bd3eec06, with HF-15 master-first admission — the switches by
// platform (HF-2: a Fansly page by its own row alone), the narrow token's AI
// switch by platform (HF-12), the pair `groupId ↔ fanRef` against the page's
// capture (HF-9) for a generation and a read, the transcript of a Fansly
// generation read by its group, and the answer to the window check (HF-8в).

import {
  CHAT_IS_FAN,
  HUB_ERROR_STATUSES,
  HUB_FEATURE_ONLY_FIELDS,
  HUB_ROUTE_SCHEMAS,
  HUB_ROUTES,
  type AiFeatureStreamBody,
  type AiUsageQuery,
  type AudienceNewQuery,
  type HubClaimOp,
  type ClientFeatureFlag,
  type ClientHubCapability,
  type DeviceTokenIssueRequest,
  type DeviceTokenIssueResponse,
  type DossierQuery,
  type FeedQuery,
  type HubAiFeature,
  type HubErrorBody,
  type HubErrorCode,
  type HubFrame,
  type HubRouteKey,
  type HubStreamRequest,
  type IngestBatch,
  type SendAttributionsRequest,
  type PersonaCatalogItem,
  type ProfileFromGenerationRequest,
  type QueueQuery,
  type RecapStatusQuery,
  type SharedRecapsQuery,
  type SpenderBatchQuery,
  type SpenderDetailQuery,
  type SpendersQuery,
  type StatsQuery,
} from '@cg/contracts';

import { HTTP_SCENARIOS, NOW_MS, SCENARIO_DATA, SSE_SCENARIOS, WORLD, hubFeatureNeedsOn, type HttpExchange } from '../scenarios/hub';
import { DEFAULT_CATALOG, modelStream, type Generation } from './ai';
import { HI_GREETING_MAX_TRANSCRIPT, aiFeatureExistsOn, aiFeatureFlag, hiStartProofDecides, judgeHiStartProof, pingActiveRefusal, resolveCoverageCheck, streamBodyRefusal, transcriptWindow, voiceScriptRefusal, type BodySchemaLike } from './ai-rules';
import { AuthModel, FAKE_USERS, type FakeUser, type TokenRecord } from './auth';
import { ClaimsModel, custodyExistsOn, stableJson, type ClaimContext, type FlagVerdict } from './claims';
import { FakeHubClock, iso } from './clock';
import { checkCommand } from './command';
import { bootstrapOf, chatIsFan, DEFAULT_PRESET, FAKE_PAGES, featureVerdict, pageRefOf, patchConfig, presetConfig, type FakeHubConfig, type FakePage } from './config';
import { CursorSigner, DataModel, type FakeSendAttribution, type Read, type Refusal } from './data';
import { FakeHubJournal, journalViolations, type JournalRecord } from './journal';
import { AI_CAPABILITIES_HEADER, facadeRequestOf, hubSchemaRefusal, matchRoute, validateRequest, type HubRouteTableLike } from './routing';
import { Gates, sseBody } from './sse';
import {
  type BootstrapPresetName,
  type FakeHubCommand,
  type FakeHubConfigPatch,
  type FakeHubJournalEntry,
  type FakeHubJournalPage,
  type FakeHubServedBy,
  type FakeHubStatus,
  type FakeSseResponse,
  type ScriptMatch,
  type StreamOutcome,
  type UnscriptedPolicy,
} from './types';

import { matchVoiceRoute, voiceClientOutdated, VoiceModel, type VoiceCreateBody, type VoiceRouteMatch } from './voice';

/** Control endpoints of the loopback mode (the harness only; the client never calls them). */
export const FAKE_HUB_CONTROL_PREFIX = '/__fake-hub/';
/** Every control request carries this header; without it the path is just an unknown route. */
export const FAKE_HUB_CONTROL_HEADER = 'x-fake-hub-control';

export interface FakeHubOptions {
  /** Origin of the in-process mode (default WORLD.hubOrigin); the loopback server sets its own. */
  readonly origin?: string;
  /** Start of a manual clock (default NOW_MS), or the system clock. */
  readonly clock?: number | 'system';
  readonly preset?: BootstrapPresetName;
  readonly config?: FakeHubConfigPatch;
  /** Multiplies every SSE delay (0 = none; default 1). */
  readonly timeScale?: number;
  /**
   * The hub's REAL body schema of the AI stream — the vendored SDK's
   * `routeSchemas.aiFeatureStream.body`. With it every AI body is checked by
   * the hub's own schema before anything else, as the hub's route does: a
   * body the hub would answer 400 to fails here (the e2e harness and the
   * wiring tests pass it; see ai-rules.ts).
   */
  readonly streamBodySchema?: BodySchemaLike;
  /**
   * The hub's REAL route schemas — the vendored SDK's `routeSchemas`. With
   * them every client/* request is checked by the hub's own params,
   * querystring and body schemas before our contract's mirror, as the hub's
   * server does (a request the hub would answer 400 to fails here), and every
   * answer the model serves on a client/* route by the hub's own response
   * schema besides ours (an answer the SDK would refuse is a fake hub bug).
   * The e2e harness and the wiring tests pass it; this package's shipped-side
   * code never imports the SDK. The SDK-only voice routes require this option
   * and check both requests and JSON responses with it (R20 P6c4).
   */
  readonly routeSchemas?: HubRouteTableLike;
}

/** The routes the hub's own schemas are checked on (`FakeHubOptions.routeSchemas`): the client family. */
const isClientRoute = (route: HubRouteKey): boolean => route.startsWith('client');

interface Principal {
  readonly token: TokenRecord;
  readonly user: FakeUser;
}

type Outcome =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown; readonly retryAfterSec?: number }
  | { readonly kind: 'refuse'; readonly refusal: Refusal }
  | { readonly kind: 'sse'; readonly response: FakeSseResponse; readonly request: HubStreamRequest };

interface HttpScriptEntry {
  readonly exchange: HttpExchange;
  readonly match: ScriptMatch;
  used: boolean;
}

interface SseScriptEntry {
  readonly response: FakeSseResponse;
  readonly feature: HubAiFeature | null;
  readonly request: HubStreamRequest | null;
  readonly match: ScriptMatch;
  used: boolean;
}

interface HealthState {
  status: 'ok' | 'degraded';
  compatibleClientSdks: readonly string[] | null;
  contractHash: string;
}

interface State {
  config: FakeHubConfig;
  readonly auth: AuthModel;
  readonly claims: ClaimsModel;
  readonly data: DataModel;
  readonly generations: Map<string, Generation>;
  readonly voice: VoiceModel;
  /** Pages granted per user id (FakeUser.pages, changed by `grantPages`). */
  readonly grants: Map<number, readonly string[]>;
  /** Platform accounts the owner linked to pages after the fact (`pageAccount`), by page label. */
  readonly pageAccounts: Map<string, string | null>;
  catalog: PersonaCatalogItem[];
  health: HealthState;
  httpScript: HttpScriptEntry[];
  unscripted: UnscriptedPolicy | null;
  sseScript: SseScriptEntry[];
  readonly gates: Gates;
  /** Aborted (and replaced) by closeStreams: every stream open at that moment ends like a reset connection. */
  streams: AbortController;
  openStreams: number;
  generationSeq: number;
}

/** The part of a zod schema the self-check uses (testing does not depend on zod itself). */
interface SafeParser {
  safeParse(value: unknown): { readonly success: true } | { readonly success: false; readonly error: { readonly issues: ReadonlyArray<{ readonly path: readonly PropertyKey[]; readonly code: string }> } };
}

const json = (status: number, body: unknown, retryAfterSec?: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(retryAfterSec === undefined ? {} : { 'retry-after': String(retryAfterSec) }) },
  });

export function hubErrorBody(error: HubErrorCode | (string & {}), status: number, reason?: string, message?: string): HubErrorBody {
  const body: HubErrorBody = { error, message: message ?? `fake hub: ${error}`, statusCode: status };
  return reason === undefined ? body : { ...body, reason };
}

const statusOfCode = (error: string): number => (HUB_ERROR_STATUSES as Readonly<Record<string, number>>)[error] ?? (error.startsWith('gate_voice_') ? 400 : 500);

/** The `error` and `reason` of an error answer's body, for the journal. */
function errorFields(status: number, body: unknown): { error: string | null; reason: string | null } {
  if (status < 400 || typeof body !== 'object' || body === null) return { error: null, reason: null };
  const { error, reason } = body as { error?: unknown; reason?: unknown };
  return { error: typeof error === 'string' ? error : null, reason: typeof reason === 'string' ? reason : null };
}

/** Deep equality of two facade requests (undefined keys dropped, key order ignored). */
const sameRequest = (a: unknown, b: unknown): boolean => stableJson(JSON.parse(JSON.stringify(a ?? null))) === stableJson(JSON.parse(JSON.stringify(b ?? null)));

const PATH_KEYS = ['pageLabel', 'fanRef', 'platform', 'platformUserId', 'feature'] as const;
const samePathParams = (a: unknown, b: unknown): boolean => {
  const read = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);
  return PATH_KEYS.every((key) => read(a, key) === undefined || read(a, key) === read(b, key));
};

/** The page key a facade request names (path param or query/body `pageLabel`). */
function pageLabelOf(route: HubRouteKey, request: unknown): string | null {
  if (typeof request !== 'object' || request === null) return null;
  const value = route === 'aiFeatureStream' ? (request as { body?: { pageLabel?: unknown } }).body?.pageLabel : (request as { pageLabel?: unknown }).pageLabel;
  return typeof value === 'string' ? value : null;
}

/** `pages` of the vendored SDK: the hub's page list, read only by the client's dev/compat mode. */
const LEGACY_PAGES_PATH = '/api/v1/pages';

/**
 * A route that serves one part of its flagged feature, by the capability of that part: it exists only where the
 * feature's requirement on the page's platform names it (hub `requireClientFeature`'s `part`, R20 HF-2) — the hub's
 * list of new subscribers is part of «Новые» on OnlyFans alone (Fansly's are found by the extension itself).
 */
const ROUTE_PARTS: Partial<Record<HubRouteKey, ClientHubCapability>> = { clientAudienceNew: 'audience-new-v1' };
/** The hub's `HI_GREETING_MAX_TRANSCRIPT` (feature-policies.ts): a greeting is for a conversation of at most this many messages. */
export { HI_GREETING_MAX_TRANSCRIPT } from './ai-rules';

/** Why the hub refuses an AI body before the generic 400 (hub-pr-plan.md §4.11). */
function streamRefusalReason(request: unknown): string | undefined {
  if (typeof request !== 'object' || request === null) return undefined;
  const { feature, body, capabilities } = request as { feature?: unknown; body?: Partial<AiFeatureStreamBody>; capabilities?: unknown };
  // X54 (hub `assertLivePpvRequestShape`): the PPV state where fresh text goes, on an OnlyFans page, the same reason.
  if (body?.livePpvContext !== undefined) {
    const allowed = HUB_FEATURE_ONLY_FIELDS.livePpvContext as readonly string[];
    if ((typeof feature === 'string' && !allowed.includes(feature)) || body.platform !== 'onlyfans') return 'live_text_not_allowed';
  }
  if (body?.liveTextContext === undefined) return undefined;
  const allowed = HUB_FEATURE_ONLY_FIELDS.liveTextContext as readonly string[];
  if (typeof feature === 'string' && !allowed.includes(feature)) return 'live_text_not_allowed';
  if (!Array.isArray(capabilities) || !capabilities.includes('context-v1')) return 'capability_required';
  return undefined;
}

export class FakeHub {
  readonly clock: FakeHubClock;
  readonly journal = new FakeHubJournal();
  private origin_: string;
  private readonly options: FakeHubOptions;
  private state: State;

  constructor(options: FakeHubOptions = {}) {
    this.options = options;
    this.origin_ = options.origin ?? WORLD.hubOrigin;
    this.clock = new FakeHubClock(options.clock ?? NOW_MS);
    this.state = this.freshState();
  }

  get origin(): string {
    return this.origin_;
  }

  /** The loopback server learns its port after listening. */
  setOrigin(origin: string): void {
    this.origin_ = origin;
  }

  private freshState(): State {
    const preset = presetConfig(this.options.preset ?? DEFAULT_PRESET);
    const now = this.clock.now();
    return {
      config: this.options.config === undefined ? preset : patchConfig(preset, this.options.config),
      auth: new AuthModel(),
      claims: new ClaimsModel(),
      data: new DataModel(new CursorSigner(crypto.randomUUID()), now),
      generations: new Map(),
      voice: new VoiceModel(),
      grants: new Map(FAKE_USERS.map((user) => [user.userId, user.pages])),
      pageAccounts: new Map(),
      catalog: [...DEFAULT_CATALOG],
      health: { status: 'ok', compatibleClientSdks: SCENARIO_DATA.health.compatibleClientSdks, contractHash: SCENARIO_DATA.health.contractHash },
      httpScript: [],
      unscripted: null,
      sseScript: [],
      gates: new Gates(),
      streams: new AbortController(),
      openStreams: 0,
      generationSeq: 0,
    };
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * A fetch implementation over the same pipeline (in-process mode). Other
   * origins fail like a network error and are journaled. The stream follows
   * the caller's own signal: the copy a `new Request` makes stops following
   * it once that Request is garbage-collected, and nothing keeps it alive
   * after `handle` returns.
   */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== this.origin_) {
      this.journal.record({ ...this.base(request.method, url.pathname, null), kind: 'foreign-origin', status: 0, servedBy: 'check' });
      throw new TypeError(`fetch failed: the fake hub serves ${this.origin_}, not ${url.origin}`);
    }
    if (request.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
    return this.handle(request, callerSignal ?? request.signal);
  };

  /** Applies a control command (the same JSON the loopback control endpoint takes); an unknown op or field throws. */
  control(command: FakeHubCommand): unknown {
    checkCommand(command);
    const s = this.state;
    const now = this.clock.now();
    switch (command.op) {
      case 'reset': {
        s.streams.abort();
        this.state = this.freshState();
        if (this.options.clock === 'system') this.clock.useSystem();
        return { ok: true };
      }
      case 'preset': {
        // An owner change: the revision only grows (a client skips a bootstrap that is not newer).
        const preset = presetConfig(command.name);
        s.config = { ...preset, configRevision: Math.max(s.config.configRevision + 1, preset.configRevision) };
        return { ok: true, configRevision: s.config.configRevision };
      }
      case 'config':
        s.config = patchConfig(s.config, command.patch);
        return { ok: true, configRevision: s.config.configRevision };
      case 'useHttpScenario': {
        const scenario = typeof command.scenario === 'string' ? HTTP_SCENARIOS.find((item) => item.name === command.scenario) : command.scenario;
        if (scenario === undefined) throw new Error(`fake hub: no HTTP scenario «${typeof command.scenario === 'string' ? command.scenario : command.scenario.name}»`);
        s.httpScript = scenario.exchanges.map((exchange) => ({ exchange, match: command.match ?? 'exact', used: false }));
        s.unscripted = command.unscripted ?? 'fail';
        return { ok: true, exchanges: s.httpScript.length };
      }
      case 'scriptHttp':
        s.httpScript.push(...command.exchanges.map((exchange) => ({ exchange, match: command.match ?? 'exact', used: false })));
        s.unscripted = command.unscripted ?? s.unscripted ?? 'model';
        return { ok: true, exchanges: s.httpScript.filter((entry) => !entry.used).length };
      case 'useSseScenario': {
        const scenario = typeof command.scenario === 'string' ? SSE_SCENARIOS.find((item) => item.name === command.scenario) : command.scenario;
        if (scenario === undefined) throw new Error(`fake hub: no SSE scenario «${typeof command.scenario === 'string' ? command.scenario : command.scenario.name}»`);
        s.sseScript = scenario.responses.map((response) => ({ response, feature: scenario.request.feature, request: scenario.request, match: command.match ?? 'route', used: false }));
        return { ok: true, responses: s.sseScript.length };
      }
      case 'scriptSse':
        s.sseScript.push(...command.responses.map((response) => ({ response, feature: command.feature ?? null, request: null, match: 'route' as const, used: false })));
        return { ok: true, responses: s.sseScript.filter((entry) => !entry.used).length };
      case 'clearScripts':
        s.httpScript = [];
        s.sseScript = [];
        s.unscripted = null;
        return { ok: true };
      case 'release':
        s.gates.release(command.gate);
        return { ok: true };
      case 'clock':
        if (command.mode === 'system') this.clock.useSystem();
        if (command.mode === 'manual') this.clock.set(this.clock.now());
        if (command.setMs !== undefined) this.clock.set(command.setMs);
        if (command.advanceMs !== undefined) this.clock.advance(command.advanceMs);
        return { ok: true, now: this.clock.now() };
      case 'revokeTokens':
        return { ok: true, revoked: s.auth.revoke(command) };
      case 'expireTokens':
        return { ok: true, expired: s.auth.expire(command, now) };
      case 'health':
        if (command.status !== undefined) s.health.status = command.status;
        if (command.compatibleClientSdks !== undefined) s.health.compatibleClientSdks = command.compatibleClientSdks;
        if (command.contractHash !== undefined) s.health.contractHash = command.contractHash;
        return { ok: true };
      case 'persona': {
        const index = s.catalog.findIndex((item) => item.key === command.key);
        const previous = s.catalog[index];
        const item: PersonaCatalogItem = {
          key: command.key,
          displayName: command.displayName ?? previous?.displayName ?? command.key,
          version: (previous?.version ?? 0) + 1,
          definitionId: command.definitionId,
          status: command.status ?? 'active',
        };
        if (index >= 0) s.catalog[index] = item;
        else s.catalog.push(item);
        return { ok: true };
      }
      case 'resolveCustody':
        s.claims.resolve(command.pageLabel, command.fanRef, command.attemptId, command.outcome, now, command.platformMessageId ?? null);
        return { ok: true };
      case 'desktopHold':
        s.claims.setDesktopHold(command.pageLabel, command.fanRef, command.held);
        return { ok: true };
      case 'desktopGreeting':
        s.claims.confirmFromDesktop(command.pageLabel, command.fanRef, now);
        return { ok: true };
      case 'grantPages': {
        const user = FAKE_USERS.find((candidate) => candidate.username === command.username || candidate.userId === command.userId);
        if (user === undefined) throw new Error(`fake hub: no user ${command.username ?? String(command.userId)}`);
        for (const label of command.pages) this.page(label);
        s.grants.set(user.userId, [...command.pages]);
        return { ok: true, pages: [...command.pages] };
      }
      case 'pageAccount': {
        this.page(command.pageLabel);
        s.pageAccounts.set(command.pageLabel, command.platformAccountId);
        // What bootstrap shows changed: its revision grows, as after any owner change.
        s.config = { ...s.config, configRevision: s.config.configRevision + 1 };
        return { ok: true, configRevision: s.config.configRevision };
      }
      case 'archiveMessage':
        return { ok: true, messageId: s.data.addArchiveMessage(this.page(command.pageLabel), command.fanRef, command.sender ?? 'fan', now, command.messageId) };
      case 'archiveRebuild':
        return { ok: true, generation: s.data.rebuildArchive(this.page(command.pageLabel), command.fanRef) };
      case 'archiveConversation':
        s.data.seedConversation(this.page(command.pageLabel), command.conversationRef, command.messages, command.lookupFails ?? false);
        return { ok: true, messages: command.messages.length };
      case 'thread':
        this.page(command.pageLabel);
        s.data.setThread(command.pageLabel, command.conversationRef, command.fanRef);
        return { ok: true };
      case 'audienceEvent':
        return { ok: true, eventRef: s.data.addAudienceEvent(this.page(command.pageLabel), command.fanRef, command.kind ?? 'new', command.trial ?? false, now) };
      case 'spenderFans':
        s.data.useSpenderFans(command.fans);
        return { ok: true, fans: command.fans.length };
      case 'status':
        return this.status();
      default:
        throw new Error(`fake hub control: unknown op «${String((command as { readonly op?: unknown }).op)}»`);
    }
  }

  status(): FakeHubStatus {
    const s = this.state;
    const now = this.clock.now();
    const httpLeft = s.httpScript.filter((entry) => !entry.used);
    return {
      origin: this.origin_,
      clock: { now, manual: this.clock.manual },
      configRevision: s.config.configRevision,
      master: s.config.master,
      tokens: s.auth.list(now),
      script: { httpLeft: httpLeft.length, sseLeft: s.sseScript.filter((entry) => !entry.used).length, httpLeftRoutes: httpLeft.map((entry) => entry.exchange.route) },
      waitingGates: s.gates.waiting(),
      openStreams: s.openStreams,
      grants: [...s.grants].map(([userId, pages]) => ({ userId, pages: [...pages] })),
      claims: s.claims.snapshot(now),
      ingested: s.data.ingestedEvents().length,
    };
  }

  /** The current config (tests read flags, limits, revision). */
  config(): FakeHubConfig {
    return this.state.config;
  }

  /** Issues a token without HTTP (test setup; not journaled). */
  issueToken(options: { readonly username?: string; readonly client?: 'chat-extension' | null } = {}): string {
    const username = options.username ?? WORLD.user.username;
    const user = FAKE_USERS.find((candidate) => candidate.username === username);
    if (user === undefined) throw new Error(`fake hub: no user ${username}`);
    const result = this.state.auth.signIn(
      { username: user.username, password: user.password, label: 'Firefox · test · ChatSpace', mode: 'active', ...(options.client === null ? {} : { client: 'chat-extension' as const }) },
      this.clock.now(),
      this.state.config.narrowTokens,
    );
    if (!result.ok || result.response.mode !== 'active') throw new Error('fake hub: could not issue a token');
    return result.response.token;
  }

  read(since = 0): FakeHubJournalPage {
    return this.journal.read(since);
  }

  /** Forbidden, unknown, invalid and unscripted calls since `since`. */
  violations(since = 0): FakeHubJournalEntry[] {
    return journalViolations(this.journal.read(since).entries);
  }

  /** Ingested telemetry (tests assert on acceptance fields; no texts by contract). */
  ingested(): IngestBatch['events'] {
    return this.state.data.ingestedEvents();
  }

  /** 1.21.0 (X48): the sends recorded with their person (tests assert who sent what; no texts by contract). */
  sendAttributions(): readonly FakeSendAttribution[] {
    return this.state.data.sendAttributionRows();
  }

  /** Ends every open stream like a reset connection (server close). Streams opened later are closed by the next call. */
  closeStreams(): void {
    const closing = this.state.streams;
    this.state.streams = new AbortController();
    closing.abort();
  }

  // ── the pipeline ─────────────────────────────────────────────────────────

  private base(method: string, path: string, clientVersion: string | null): Omit<JournalRecord, 'kind' | 'status' | 'servedBy'> {
    return { at: this.clock.now(), method: method.toUpperCase(), path, route: null, operation: null, error: null, reason: null, token: null, clientVersion, request: null, issues: [] };
  }

  /**
   * Every request of both modes. `signal` is the client's own (the loopback
   * server's connection, the in-process caller's): an SSE body ends when it
   * aborts.
   */
  async handle(request: Request, signal: AbortSignal = request.signal): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith(FAKE_HUB_CONTROL_PREFIX) && request.headers.get(FAKE_HUB_CONTROL_HEADER) === '1') return this.handleControl(request, url);
    const method = request.method.toUpperCase();
    const base = this.base(method, url.pathname, request.headers.get('x-client-version'));
    const bodyText = method === 'GET' || method === 'HEAD' ? '' : await request.text();
    const now = this.clock.now();
    const s = this.state;
    const match = matchRoute(method, url.pathname);
    const verdict = s.auth.authenticate(request.headers.get('authorization'), now);
    const tokenOf = (p: Principal | null) => (p === null ? null : { id: p.token.id, client: p.token.client });

    const refuse = (record: Partial<JournalRecord> & { readonly servedBy: FakeHubServedBy }, error: string, reason?: string, retryAfterSec?: number, issues: readonly string[] = []): Response => {
      const status = statusOfCode(error);
      this.journal.record({ ...base, kind: 'route', ...record, status, error, reason: reason ?? null, issues });
      return json(status, hubErrorBody(error, status, reason, issues.length > 0 ? `fake hub: ${issues.join('; ')}` : undefined), retryAfterSec);
    };

    const voice = matchVoiceRoute(method, url.pathname);
    if (voice !== null) {
      if (!verdict.ok) return refuse({ route: voice.route, servedBy: 'check' }, 'unauthorized', verdict.reason ?? undefined);
      return this.handleVoice(voice, request, bodyText, { token: verdict.token, user: verdict.user }, base);
    }

    if (match.kind !== 'route' && method === 'GET' && url.pathname === LEGACY_PAGES_PATH) {
      // The hub's own page list: the client reads it only in its dev/compat mode, with a full token (docs/hub-layer.md).
      const principal = verdict.ok ? { token: verdict.token, user: verdict.user } : null;
      if (principal === null) return refuse({ kind: 'legacy', servedBy: 'check' }, 'unauthorized', verdict.ok ? undefined : (verdict.reason ?? undefined));
      // H-3: `pages` is not on the narrow token's allow-list — a call the client must never make.
      if (principal.token.client !== null) return refuse({ kind: 'forbidden', operation: 'pages', servedBy: 'check', token: tokenOf(principal) }, 'forbidden');
      const body = this.grantedPages(principal.user.userId).map((page) => ({
        ...pageRefOf(page),
        username: null,
        displayName: page.title,
        followerCount: { value: null, available: false },
        subscriberCount: { value: null, available: false },
        lastLightSyncAt: null,
        lastFollowerSyncAt: null,
      }));
      this.journal.record({ ...base, kind: 'legacy', status: 200, servedBy: 'model', token: tokenOf(principal) });
      return json(200, body);
    }

    if (match.kind !== 'route') {
      const principal = verdict.ok ? { token: verdict.token, user: verdict.user } : null;
      const record = { kind: match.kind, operation: match.kind === 'forbidden' ? match.operation : null, servedBy: 'check' as const, token: tokenOf(principal) };
      if (match.kind === 'forbidden' && !verdict.ok) return refuse(record, 'unauthorized', verdict.reason ?? undefined);
      if (match.kind === 'forbidden' && verdict.ok && verdict.token.client !== null) return refuse(record, 'forbidden');
      return refuse(record, 'not_found');
    }

    const route = match.route;
    const spec = HUB_ROUTES[route];
    const isPublic = route === 'health' || route === 'authIssueDeviceTokenWithPassword';
    let principal: Principal | null = null;
    if (!isPublic) {
      if (!verdict.ok) return refuse({ route, servedBy: 'check' }, 'unauthorized', verdict.reason ?? undefined);
      principal = { token: verdict.token, user: verdict.user };
      // H-3: the narrow token reaches only its allow-list (403 without a reason).
      if (principal.token.client !== null && !spec.narrowToken) return refuse({ route, servedBy: 'check', token: tokenOf(principal) }, 'forbidden');
    }
    const token = tokenOf(principal);

    const facade = facadeRequestOf(route, {
      params: match.params,
      query: url.searchParams,
      bodyText,
      contentType: request.headers.get('content-type'),
      capabilitiesHeader: request.headers.get(AI_CAPABILITIES_HEADER),
    });
    if (!facade.ok) return refuse({ route, servedBy: 'check', token }, 'bad_request', undefined, undefined, facade.issues);
    if (route === 'aiFeatureStream') {
      // As the hub's route does: its own body schema first, then the rules of its handler (ai-rules.ts) — both
      // before our contract's mirror of them, so that a drift of the mirror cannot hide a body the hub refuses.
      const { feature, body, capabilities } = facade.request as { feature: string; body: unknown; capabilities: string[] };
      const real = this.options.streamBodySchema;
      if (real !== undefined && !real.safeParse(body).success) {
        return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', streamRefusalReason(facade.request), undefined, ['body: refused by the hub’s own body schema (vendored SDK)']);
      }
      // A hub before HF-5 has none of these optional fields in its strict body. Advertising a future token alone
      // does not enable a handler the old hub does not have (modelAi keeps its old count gate below).
      if (typeof body === 'object' && body !== null && ['startProof', 'personalMessageCount', 'fanAvatarUrl'].some((field) => field in body) && !s.config.capabilities.includes('hi-start-proof-v1')) {
        return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', undefined, undefined, ['Hi start-proof fields: unknown keys on a hub without hi-start-proof-v1']);
      }
      const rule = typeof body === 'object' && body !== null ? streamBodyRefusal(feature, body, capabilities) : null;
      if (rule !== null) return refuse({ route, servedBy: 'check', token, request: facade.request }, rule.error, rule.reason, undefined, [rule.message]);
      if (feature === 'voice-script' && typeof body === 'object' && body !== null) {
        const error = voiceScriptRefusal(body, false);
        if (error !== null) return refuse({ route, servedBy: 'check', token, request: facade.request }, error);
      }
      // R20 HF-8в: a hub before it has no `coverageCheck` in its strict body — an unknown key, 400.
      if (typeof body === 'object' && body !== null && (body as { coverageCheck?: unknown }).coverageCheck !== undefined && !s.config.capabilities.includes('coverage-check-v1')) {
        return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', undefined, undefined, ['coverageCheck: an unknown key on a hub without coverage-check-v1']);
      }
      // Decision X52: a hub before `live-text-review-coach-v1` takes fresh text on the four draft features only.
      if (typeof body === 'object' && body !== null && (body as { liveTextContext?: unknown }).liveTextContext !== undefined && (feature === 'chat-review' || feature === 'coach-chat') && !s.config.capabilities.includes('live-text-review-coach-v1')) {
        return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', 'live_text_not_allowed', undefined, [`${feature} does not accept liveTextContext`]);
      }
    }
    // R20 F6b: a hub before HF-10 has no `conversationRef` in these strict queries and bodies — an unknown key, 400.
    if (CONVERSATION_ROUTES.includes(route) && namesConversation(facade.request) && !s.config.capabilities.includes('conversation-recaps-v1')) {
      return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', undefined, undefined, ['conversationRef: an unknown key on a hub without conversation-recaps-v1']);
    }
    const real = isClientRoute(route) ? this.options.routeSchemas?.[route] : undefined;
    if (real !== undefined) {
      // As the hub's server does: its route's own params, querystring and body schemas, before our contract's mirror.
      const issues = hubSchemaRefusal(real, { params: match.params, query: url.searchParams, body: bodyText === '' ? undefined : (JSON.parse(bodyText) as unknown) });
      if (issues.length > 0) return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', undefined, undefined, issues);
    }
    const valid = validateRequest(route, facade.request);
    if (!valid.ok) {
      const reason = route === 'aiFeatureStream' ? streamRefusalReason(facade.request) : undefined;
      return refuse({ route, servedBy: 'check', token, request: facade.request }, 'bad_request', reason, undefined, valid.issues);
    }
    const record = { route, token, request: valid.request };

    // Scripts answer before the model's checks: a scenario is self-contained.
    if (route === 'aiFeatureStream') {
      const scripted = this.takeSse(valid.request as HubStreamRequest);
      if (scripted !== null) return this.respond({ kind: 'sse', response: scripted, request: valid.request as HubStreamRequest }, record, 'script', principal, signal, base);
    } else {
      const scripted = this.takeHttp(route, valid.request);
      if (scripted !== null) {
        const answer = scripted.response;
        this.afterScripted(route, valid.request, answer.status, answer.body);
        const { error, reason } = errorFields(answer.status, answer.body);
        this.journal.record({ ...base, kind: 'route', ...record, status: answer.status, error, reason, servedBy: 'script' });
        return json(answer.status, answer.body, answer.retryAfterSec);
      }
      if (s.unscripted === 'fail') return refuse({ ...record, servedBy: 'unscripted' }, 'internal_error', 'unscripted_request');
    }

    // The model's own checks: deployed (capability), page granted, owner flag.
    if (!spec.capabilities.every((capability) => s.config.capabilities.includes(capability))) return refuse({ ...record, servedBy: 'check' }, 'not_found', 'route_not_deployed');
    // A hub before H-2 has no `client/bootstrap` at all.
    if (route === 'clientBootstrap' && !s.config.clientBootstrap) return refuse({ ...record, servedBy: 'check' }, 'not_found', 'route_not_deployed');
    const pageLabel = pageLabelOf(route, valid.request);
    const page = pageLabel === null ? null : (this.pages().find((candidate) => candidate.pageLabel === pageLabel) ?? null);
    // A page the hub does not know, or one not granted to the caller: 404 either way (the hub never tells them apart).
    if (pageLabel !== null && (page === null || (principal !== null && !this.granted(principal.user.userId, page)))) return refuse({ ...record, servedBy: 'check' }, 'not_found');
    if (spec.flag !== null && page !== null) {
      if (!s.config.master) return refuse({ ...record, servedBy: 'check' }, 'client_feature_disabled', 'disabled');
      const part = ROUTE_PARTS[route];
      if (part !== undefined && !(hubFeatureNeedsOn(spec.flag, page.platform)?.capabilities.includes(part) ?? false)) {
        return refuse({ ...record, servedBy: 'check' }, 'client_feature_disabled', 'platform_unsupported');
      }
      const flag = featureVerdict(s.config, page, spec.flag);
      if (!flag.available) return refuse({ ...record, servedBy: 'check' }, 'client_feature_disabled', flag.reason ?? 'flag_off');
    }
    // HF-3/HF-2: status exists where at least one send is admitted. Each POST checks its own action;
    // release/sent/failed need the grant alone, a dispatch checks admission only after its repeat check.
    // The claim status has no flag of its own, but the hub's master switch refuses it (hub `requireClientPage`).
    if (route === 'clientFanClaimStatus' && !s.config.master) return refuse({ ...record, servedBy: 'check' }, 'client_feature_disabled', 'disabled');
    if (route === 'clientFanClaimStatus' && page !== null && !custodyExistsOn(page.platform)) return refuse({ ...record, servedBy: 'check' }, 'client_feature_disabled', 'platform_unsupported');

    let outcome: Outcome;
    try {
      outcome = this.model(route, valid.request, principal, page);
    } catch (error) {
      return refuse({ ...record, servedBy: 'check' }, 'internal_error', 'fake_hub_bug', undefined, [`fake hub model: ${error instanceof Error ? error.message : String(error)}`]);
    }
    return this.respond(outcome, record, 'model', principal, signal, base);
  }

  /** SDK-only voice routes, checked by the actual SDK schemas rather than a second facade schema. */
  private handleVoice(match: VoiceRouteMatch, request: Request, bodyText: string, principal: Principal, base: Omit<JournalRecord, 'kind' | 'status' | 'servedBy'>): Response {
    const s = this.state;
    const record = { ...base, kind: 'route' as const, route: match.route, token: { id: principal.token.id, client: principal.token.client } };
    let body: unknown;
    const answer = (status: number, value: unknown, error: string | null = null, reason: string | null = null, issues: readonly string[] = []): Response => {
      this.journal.record({ ...record, request: { ...match.params, body }, status, error, reason, issues, servedBy: error === null ? 'model' : 'check' });
      return json(status, value);
    };
    const refuse = (status: number, error: string, reason?: string, issues: readonly string[] = []): Response => answer(status, hubErrorBody(error, status, reason), error, reason ?? null, issues);
    if (bodyText !== '') {
      if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) return refuse(400, 'bad_request');
      try { body = JSON.parse(bodyText) as unknown; } catch { return refuse(400, 'bad_request'); }
    }
    const schema = this.options.routeSchemas?.[match.route];
    // No permissive fallback: a test of these routes must inject the vendored schemas, like the e2e harness.
    if (schema === undefined) return refuse(500, 'internal_error', 'fake_hub_bug', ['voice routes need FakeHubOptions.routeSchemas from the vendored SDK']);
    const issues = hubSchemaRefusal(schema, { params: match.params, query: new URL(request.url).searchParams, body });
    if (issues.length > 0) return refuse(400, 'bad_request', undefined, issues);
    const page = this.pages().find((candidate) => candidate.pageLabel === match.params['pageLabel']);
    if (page === undefined || !this.granted(principal.user.userId, page)) return principal.token.client === null ? refuse(404, 'not_found') : refuse(409, 'client_feature_disabled', 'not_granted');
    if (principal.token.client !== null) {
      const verdict = featureVerdict(s.config, page, 'voice');
      if (!verdict.available) return refuse(409, 'client_feature_disabled', verdict.reason ?? 'flag_off');
      if (voiceClientOutdated(s.config.minVersion, request.headers.get('x-client-version'))) return refuse(409, 'client_feature_disabled', 'client_outdated');
    }
    // A synthetic render stays queued: no provider is invoked; audio is not ready (the real route's 404).
    const result = match.route === 'voiceNoteCreate'
      ? s.voice.create(body as VoiceCreateBody, { userId: principal.user.userId, pageId: page.pageId, pageLabel: page.pageLabel, now: this.clock.now(), laneOff: s.config.voiceLaneOff.includes(page.pageLabel), generations: s.generations, pair: (conversation, fan) => s.data.pair(page.pageLabel, conversation, fan) })
      : match.route === 'voiceNoteStatus' ? s.voice.status(Number(match.params['id']), page.pageId, principal.user.userId) : { status: 404 as const, error: 'not_found' };
    if ('error' in result) return refuse(result.status, result.error);
    if (schema.response[result.status]?.safeParse(result.body).success !== true) return refuse(500, 'internal_error', 'fake_hub_bug', ['voice response refused by the vendored SDK']);
    return answer(result.status, result.body);
  }

  private respond(
    outcome: Outcome,
    record: { readonly route: HubRouteKey; readonly token: { id: number; client: string | null } | null; readonly request: unknown },
    servedBy: 'model' | 'script',
    principal: Principal | null,
    signal: AbortSignal,
    base: Omit<JournalRecord, 'kind' | 'status' | 'servedBy'>,
  ): Response {
    const fullBase = { ...base, kind: 'route' as const, ...record };
    if (outcome.kind === 'refuse') {
      const status = statusOfCode(outcome.refusal.error);
      this.journal.record({ ...fullBase, status, error: outcome.refusal.error, reason: outcome.refusal.reason ?? null, servedBy });
      return json(status, hubErrorBody(outcome.refusal.error, status, outcome.refusal.reason), outcome.refusal.retryAfterSec);
    }
    if (outcome.kind === 'json') {
      if (servedBy === 'model' && outcome.status >= 200 && outcome.status < 300) {
        const checked = (HUB_ROUTE_SCHEMAS[record.route].response as unknown as SafeParser).safeParse(outcome.body);
        // And by the hub's own response schema of the status (the vendored SDK's), where the harness passed it.
        const real = isClientRoute(record.route) ? this.options.routeSchemas?.[record.route] : undefined;
        const realRefused = real !== undefined && real.response[outcome.status]?.safeParse(outcome.body).success !== true;
        if (!checked.success || realRefused) {
          const issues = checked.success
            ? [`self-check: refused by the hub’s own response schema of ${String(outcome.status)} (vendored SDK)`]
            : checked.error.issues.map((issue) => `self-check ${issue.path.map(String).join('.')}: ${issue.code}`);
          this.journal.record({ ...fullBase, status: 500, error: 'internal_error', reason: 'fake_hub_bug', servedBy: 'check', issues });
          return json(500, hubErrorBody('internal_error', 500, 'fake_hub_bug', issues.join('; ')));
        }
      }
      this.journal.record({ ...fullBase, status: outcome.status, ...errorFields(outcome.status, outcome.body), servedBy });
      return json(outcome.status, outcome.body, outcome.retryAfterSec);
    }
    // SSE
    const response = outcome.response;
    if (response.kind === 'http-error') {
      this.journal.record({ ...fullBase, status: response.status, error: response.body.error, reason: response.body.reason ?? null, servedBy });
      if (principal !== null && response.body.error === 'quota_denied') this.recordUsage(outcome.request, principal, 'quota-denied');
      return json(response.status, response.body, response.retryAfterSec);
    }
    const seq = this.journal.record({ ...fullBase, status: 200, servedBy, streaming: true });
    const s = this.state;
    s.openStreams += 1;
    let generation: Generation | null = null;
    const body = sseBody(response.steps, {
      signal,
      hubSignal: s.streams.signal,
      timeScale: this.options.timeScale ?? 1,
      gates: s.gates,
      rewrite: (frame) => (frame.type === 'meta' ? { ...frame, clientRequestId: outcome.request.body.clientRequestId } : frame),
      onFrame: (frame) => {
        this.journal.streamFrame(seq, frame?.type ?? 'raw');
        if (frame === null || principal === null) return;
        if (frame.type === 'meta') generation = this.openGeneration(frame, outcome.request, principal);
        else if (frame.type === 'content_delta' && generation !== null) generation.text += frame.text;
        else if (frame.type === 'done' && generation !== null) generation.stopReason = frame.stopReason ?? null;
      },
      onEnd: (end) => {
        s.openStreams -= 1;
        this.journal.streamEnd(seq, end);
        if (generation !== null && principal !== null) this.closeGeneration(generation, end, outcome.request, principal);
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' } });
  }

  // ── scripts ──────────────────────────────────────────────────────────────

  private takeHttp(route: HubRouteKey, request: unknown): HttpExchange | null {
    const entry = this.state.httpScript.find(
      (candidate) =>
        !candidate.used && candidate.exchange.route === route && (candidate.match === 'exact' ? sameRequest(candidate.exchange.request, request) : samePathParams(candidate.exchange.request, request)),
    );
    if (entry === undefined) return null;
    entry.used = true;
    return entry.exchange;
  }

  private takeSse(request: HubStreamRequest): FakeSseResponse | null {
    const entry = this.state.sseScript.find(
      (candidate) =>
        !candidate.used &&
        (candidate.feature === null || candidate.feature === request.feature) &&
        (candidate.match === 'route' || candidate.request === null || sameRequest(candidate.request, request)),
    );
    if (entry === undefined) return null;
    entry.used = true;
    return entry.response;
  }

  /** A scripted sign-in's token becomes real; a scripted revoke revokes the bearer. */
  private afterScripted(route: HubRouteKey, request: unknown, status: number, body: unknown): void {
    if (route !== 'authIssueDeviceTokenWithPassword' || status !== 200) return;
    const response = body as DeviceTokenIssueResponse;
    if (response.mode !== 'active') return;
    const expiresAt = Date.parse(response.expiresAt);
    this.state.auth.adopt(response.token, (request as DeviceTokenIssueRequest).username, response.client ?? null, this.clock.now(), Number.isNaN(expiresAt) ? null : expiresAt);
  }

  // ── the model ────────────────────────────────────────────────────────────

  /** The pages as the owner has them now: the synthetic ones, with the accounts linked by `pageAccount`. */
  private pages(): FakePage[] {
    const linked = this.state.pageAccounts;
    return FAKE_PAGES.map((page) => (linked.has(page.pageLabel) ? { ...page, platformAccountId: linked.get(page.pageLabel) ?? null, bindingRevision: page.bindingRevision + 1 } : page));
  }

  private grantedPages(userId: number): FakePage[] {
    const labels = this.state.grants.get(userId) ?? [];
    return this.pages().filter((page) => labels.includes(page.pageLabel));
  }

  private granted(userId: number, page: FakePage): boolean {
    return (this.state.grants.get(userId) ?? []).includes(page.pageLabel);
  }

  private page(pageLabel: string): FakePage {
    const page = this.pages().find((candidate) => candidate.pageLabel === pageLabel);
    if (page === undefined) throw new Error(`fake hub: no page ${pageLabel}`);
    return page;
  }

  private flagVerdict(page: FakePage): (flag: ClientFeatureFlag) => FlagVerdict {
    return (flag) => {
      const verdict = featureVerdict(this.state.config, page, flag);
      return verdict.available ? { ok: true } : { ok: false, reason: verdict.reason ?? 'flag_off' };
    };
  }

  private claimContext(page: FakePage, principal: Principal): ClaimContext {
    const { limits, configRevision, master } = this.state.config;
    return {
      platform: page.platform,
      master,
      now: this.clock.now(),
      userId: principal.user.userId,
      leaseSec: limits.claimLeaseSec,
      ticketSec: limits.dispatchTicketSec,
      perMinute: limits.previewSendPerMinute,
      greetingPerMinute: limits.greetingSendPerMinute,
      flagRevision: configRevision,
      flag: this.flagVerdict(page),
    };
  }

  private model(route: HubRouteKey, request: unknown, principal: Principal | null, page: FakePage | null): Outcome {
    const s = this.state;
    const now = this.clock.now();
    const read = <T>(result: Read<T>): Outcome => (result.ok ? { kind: 'json', status: 200, body: result.body } : { kind: 'refuse', refusal: result.refusal });
    const need = <T>(value: T | null): T => {
      if (value === null) throw new Error(`${route} needs a principal and a page`);
      return value;
    };
    switch (route) {
      case 'authIssueDeviceTokenWithPassword': {
        const result = s.auth.signIn(request as DeviceTokenIssueRequest, now, s.config.narrowTokens);
        if (!result.ok) return { kind: 'refuse', refusal: result.retryAfterSec === undefined ? { error: result.error } : { error: result.error, retryAfterSec: result.retryAfterSec } };
        return { kind: 'json', status: 200, body: result.response };
      }
      case 'authRevokeCurrentDeviceToken':
        s.auth.revoke({ tokenId: need(principal).token.id });
        return { kind: 'json', status: 200, body: { revoked: true } };
      case 'health': {
        const { compatibleClientSdks, ...rest } = SCENARIO_DATA.health;
        void compatibleClientSdks;
        const degraded = s.health.status === 'degraded';
        const body = {
          ...rest,
          status: s.health.status,
          timestamp: iso(now),
          contractHash: s.health.contractHash,
          checks: { api: { status: 'ok' }, database: degraded ? { status: 'error', latencyMs: null, error: 'synthetic outage' } : rest.checks.database },
          ...(s.health.compatibleClientSdks === null ? {} : { compatibleClientSdks: [...s.health.compatibleClientSdks] }),
        };
        return { kind: 'json', status: degraded ? 503 : 200, body };
      }
      case 'me': {
        const { user } = need(principal);
        return {
          kind: 'json',
          status: 200,
          body: { authMethod: 'device_token', user: { id: user.userId, username: user.username, role: user.role, mustChangePassword: false, assignedPages: this.grantedPages(user.userId).map(pageRefOf) } },
        };
      }
      case 'clientBootstrap': {
        const { user, token } = need(principal);
        return { kind: 'json', status: 200, body: bootstrapOf(s.config, this.grantedPages(user.userId), { userId: user.userId, username: user.username, role: user.role, tokenClient: token.client }, now) };
      }
      case 'aiPersonaCatalog':
        return { kind: 'json', status: 200, body: { personas: s.catalog.map((item) => ({ ...item })) } };
      case 'aiFeatureStream':
        return this.modelAi(request as HubStreamRequest, need(principal), need(page));
      case 'aiRecapStatus': {
        const query = request as RecapStatusQuery;
        return { kind: 'json', status: 200, body: s.data.recapStatus(need(page).pageLabel, query.fanRef ?? query.conversationRef, query.personaDefinitionId, now, query.conversationRef) };
      }
      case 'pageConversationProfile':
      case 'pageFanProfile':
        return read(s.data.dossier(need(page), (request as DossierQuery).fanRef, s.config.spendersTotal));
      case 'spenders':
        return read(s.data.spenders(need(page), request as SpendersQuery, now, s.config.spendersTotal));
      case 'spenderDetail':
        return read(s.data.spenderDetail(need(page), request as SpenderDetailQuery, now, s.config.spendersTotal));
      case 'spenderBatch':
        return read(s.data.spenderBatch(need(page), request as SpenderBatchQuery, now, s.config.spendersTotal));
      case 'pageSpenderAutoLists':
        return read(s.data.autoLists(need(page), now, s.config.spendersTotal));
      case 'ingestObservations': {
        const { token, user } = need(principal);
        const allowed = token.client === null ? null : ['ai_acceptance', ...(s.config.capabilities.includes('client-health-perf-v1') ? ['client_health'] : [])];
        return read(s.data.ingest(user.userId, request as IngestBatch, allowed));
      }
      case 'clientConversationRecaps': {
        const query = request as SharedRecapsQuery;
        const conversation = conversationOf(need(page), query, s.data);
        if (typeof conversation !== 'string') return conversation;
        return { kind: 'json', status: 200, body: s.data.sharedRecaps(need(page).pageLabel, query.fanRef, query.personaDefinitionId, conversation) };
      }
      case 'clientFanProfileFromGeneration': {
        const conversation = conversationOf(need(page), request as ProfileFromGenerationRequest, s.data);
        if (typeof conversation !== 'string') return conversation;
        return this.profileFromGeneration(request as ProfileFromGenerationRequest, need(principal), conversation);
      }
      case 'clientConversationFeed': {
        const conversation = conversationOf(need(page), request as FeedQuery, s.data);
        if (typeof conversation !== 'string') return conversation;
        return read(s.data.feed(need(page), request as FeedQuery, now, need(principal).user.userId, conversation));
      }
      case 'clientSpenderStats':
        return read(s.data.stats(need(page), request as StatsQuery, now));
      case 'clientSpenderAwaitingReply':
        return read(s.data.awaitingReply(need(page), request as QueueQuery, now));
      case 'clientFanClaim': {
        const op = request as HubClaimOp;
        const result = s.claims.apply(op.pageLabel, op.fanRef, op.body, this.claimContext(need(page), need(principal)));
        return result.ok ? { kind: 'json', status: 200, body: result.state } : { kind: 'refuse', refusal: result };
      }
      case 'clientFanClaimStatus': {
        const params = request as { readonly pageLabel: string; readonly fanRef: string };
        return { kind: 'json', status: 200, body: s.claims.status(params.pageLabel, params.fanRef, this.claimContext(need(page), need(principal))) };
      }
      case 'clientAudienceNew': {
        const query = request as AudienceNewQuery;
        // The hub bounds the window by its query schema (the limit it announces): a plain 400, no reason.
        if (query.windowHours > s.config.limits.audienceWindowHours) return { kind: 'refuse', refusal: { error: 'bad_request' } };
        const ctx = this.claimContext(need(page), need(principal));
        return read(s.data.audienceNew(need(page), query, now, (fanRef) => s.claims.summary(query.pageLabel, fanRef, ctx)));
      }
      case 'clientAiUsageDaily':
        return read(s.data.aiUsage(need(page), request as AiUsageQuery, need(principal).user.userId, now, s.config.quotaRequestsToday));
      case 'clientSendAttributions':
        return read(s.data.sendAttributions(need(page), need(principal).user.userId, request as SendAttributionsRequest, now));
    }
  }

  private modelAi(request: HubStreamRequest, principal: Principal, page: FakePage): Outcome {
    const s = this.state;
    const refusal = (error: HubErrorCode | (string & {}), reason?: string): Outcome => ({ kind: 'refuse', refusal: reason === undefined ? { error } : { error, reason } });
    const { body, feature } = request;
    // H-3 / HF-15: master first, then the narrow token's AI switch by the platform the body names (hub client-ai-switch.ts): a feature the
    // extension does not have there is `platform_unsupported`; one behind a flag — Coach, Recap, Review everywhere,
    // and on Fansly Reply, Fix, Hi and Ping behind `drafts` (R20 HF-12) — answers as that flag on the page; any other
    // needs no further switch.
    if (principal.token.client !== null) {
      if (!s.config.master) return refusal('client_feature_disabled', 'disabled');
      if (!aiFeatureExistsOn(feature, body.platform)) return refusal('client_feature_disabled', 'platform_unsupported');
      const flag = aiFeatureFlag(feature, body.platform, (name, platform) => hubFeatureNeedsOn(name, platform) !== undefined);
      if (flag !== null) {
        const verdict = featureVerdict(s.config, page, flag);
        if (!verdict.available) return refusal('client_feature_disabled', verdict.reason ?? 'flag_off');
      }
    }
    // The hub's access check: a body naming another platform than its page's finds no page (404, as one not granted).
    if (body.platform !== page.platform) return refusal('not_found');
    // R20 HF-9: a Fansly request whose transcript the hub loads itself names the group and the fan apart; the page's
    // capture of the group decides the pair before anything loads — another fan's group is 409, one the hub cannot
    // vouch for is served `unverified`. No fan named, no pair to check.
    let pair: 'verified' | 'unverified' | undefined;
    if (!chatIsFan(page) && body.fanRef !== undefined && body.fanRef !== null && body.fanRef.trim() !== '') {
      const state = s.data.pair(page.pageLabel, body.conversationRef, body.fanRef);
      if (state === 'mismatch') return refusal('conversation_fan_mismatch');
      pair = state;
    }
    if (feature === 'voice-script') {
      const error = voiceScriptRefusal(body, s.config.voiceLaneOff.includes(page.pageLabel));
      if (error !== null) return refusal(error);
    }
    // Where a chat is its fan the transcript is the fan's; on Fansly it is the group's (the fan's data stay the fan's).
    const transcript = transcriptRefOf(page, body);
    let definitionId: string | null = null;
    if (body.personaKey !== undefined && body.personaKey !== null) {
      const persona = s.catalog.find((item) => item.key === body.personaKey && item.status === 'active');
      if (persona === undefined) return refusal('not_found', 'persona_not_found');
      if (body.expectedPersonaDefinitionId !== undefined && body.expectedPersonaDefinitionId !== persona.definitionId) return refusal('persona_definition_changed');
      definitionId = persona.definitionId;
    }
    const hiByStartProof = s.config.capabilities.includes('hi-start-proof-v1') && hiStartProofDecides(feature, body, request.capabilities);
    // assertHiStartProofSent: no proof fails before reading the context, even if that read would fail too.
    if (hiByStartProof && body.startProof === undefined) return refusal('gate_hi_greeting_limit', 'history_unproven');
    const window = transcriptWindow(request, s.config.limits.deepMax);
    const served = s.data.served(page, transcript, window.limit);
    if (hiByStartProof) {
      // assertHiStartProof reads the served window AND the oldest live archive ref. In the fake, `stores` holds
      // every ref outside the window: checking all its live refs is equivalent to checking their oldest one.
      // A failed archive lookup is fatal on this lane, never an admission on a guess (unlike HF-8's unknown).
      if (served.stores === null) return refusal('internal_error');
      const reason = judgeHiStartProof({
        proof: body.startProof,
        windowIds: body.coverageCheck?.window.map((item) => item.id) ?? [],
        knownLiveIds: [...served.window.map((item) => item.messageRef), ...[...served.stores].filter(([, state]) => state === 'present').map(([id]) => id)],
      });
      if (reason !== null) return refusal('gate_hi_greeting_limit', reason);
    } else if (feature === 'hi-greeting' && s.data.archiveFacts(page, transcript).total > HI_GREETING_MAX_TRANSCRIPT) {
      // OnlyFans and Fansly without the proof token keep assertHiGreetingFreshness and its reason-less envelope.
      return refusal('gate_hi_greeting_limit');
    }
    if (feature === 'ping') {
      // The hub's segment reads its transcript: the archive the reader serves and, under context-v1, the page's texts.
      const live = request.capabilities.includes('context-v1') ? (body.liveTextContext?.items ?? []).filter((item) => item.direction === 'fan' && item.text.trim() !== '').map((item) => Date.parse(item.occurredAt)) : [];
      const active = pingActiveRefusal({ platform: page.platform, fanTextTimes: [...s.data.fanTextTimes(page, transcript, window.limit), ...live], now: this.clock.now() });
      if (active !== null) return refusal(active);
    }
    if (feature === 'fan-notes-fill' && served.window.length === 0) return refusal('gate_min_messages');
    if (s.config.quotaRequestsToday === 0) {
      this.recordUsage(request, principal, 'quota-denied');
      return refusal('quota_denied');
    }
    const remaining = s.config.quotaRequestsToday === null ? null : s.config.quotaRequestsToday - 1;
    if (remaining !== null) s.config = { ...s.config, quotaRequestsToday: remaining };
    s.generationSeq += 1;
    const archive = s.data.archiveFacts(page, transcript);
    // On Fansly the frame describes what the serving reader read: the hub's tombstones and what it holds beside the
    // reader are not in the window (hub `TranscriptServedSnapshot`). The ChatSpace frame stays what it always was.
    const newest = served.window[0];
    // R20 HF-8в: answered only to a request that advertised `coverage-check-v1` (it rides in the context frame).
    const coverageCheck =
      body.coverageCheck !== undefined && request.capabilities.includes('coverage-check-v1') ? resolveCoverageCheck({ check: body.coverageCheck, window: served.window, stores: served.stores }) : undefined;
    const steps = modelStream(request, {
      requestId: crypto.randomUUID(),
      personaDefinitionId: definitionId,
      remainingRequestsToday: remaining,
      splitAllFlag: featureVerdict(s.config, page, 'splitAll').available,
      freshTextFlag: featureVerdict(s.config, page, 'freshText').available,
      archive: chatIsFan(page)
        ? {
            head: archive.head === null ? null : { messageRef: archive.head.messageId, at: archive.head.at, isFromFan: archive.head.sender === 'fan' },
            total: archive.total,
            state: archive.states,
          }
        : { head: newest === undefined ? null : { messageRef: newest.messageRef, at: newest.at, isFromFan: newest.isFromFan }, total: served.window.length, state: archive.states },
      chunkDelayMs: s.config.aiChunkDelayMs,
      window,
      nameFan: s.config.aiNameFan,
      texts: s.config.aiTexts,
      ...(pair === undefined ? {} : { pair }),
      ...(coverageCheck === undefined ? {} : { coverageCheck }),
    });
    return { kind: 'sse', response: { kind: 'stream', steps }, request };
  }

  private generationWindow(request: HubStreamRequest): { requested: number; served: number } {
    const window = transcriptWindow(request, this.state.config.limits.deepMax);
    const page = this.pages().find((candidate) => candidate.pageLabel === request.body.pageLabel);
    const total = page === undefined ? 0 : chatIsFan(page) ? this.state.data.archiveFacts(page, transcriptRefOf(page, request.body)).total : this.state.data.served(page, request.body.conversationRef, window.limit).window.length;
    return { requested: window.requested, served: Math.min(window.limit, total) };
  }

  private openGeneration(meta: Extract<HubFrame, { type: 'meta' }>, request: HubStreamRequest, principal: Principal): Generation {
    const generation: Generation = {
      requestId: meta.requestId,
      clientRequestId: request.body.clientRequestId,
      feature: request.feature,
      pageLabel: request.body.pageLabel,
      fanRef: request.body.fanRef ?? request.body.conversationRef,
      conversationRef: request.body.conversationRef,
      userId: principal.user.userId,
      summaryMode: request.body.summaryMode ?? null,
      messageCount: request.body.messageCount ?? null,
      personaDefinitionId: meta.personaDefinitionId ?? null,
      startedAt: this.clock.now(),
      completedAt: null,
      outcome: 'open',
      text: '',
      stopReason: null,
      window: this.generationWindow(request),
    };
    this.state.generations.set(meta.requestId, generation);
    return generation;
  }

  private closeGeneration(generation: Generation, end: StreamOutcome, request: HubStreamRequest, principal: Principal): void {
    const now = this.clock.now();
    generation.completedAt = now;
    generation.outcome = end === 'done' ? 'done' : end === 'aborted' ? 'aborted' : 'error';
    this.recordUsage(request, principal, end === 'done' ? 'completed' : end === 'aborted' ? 'cancelled' : 'failed');
    if (generation.outcome !== 'done' || generation.feature !== 'fan-summary') return;
    const { requested, served } = generation.window;
    const page = this.pages().find((candidate) => candidate.pageLabel === generation.pageLabel);
    const total = page === undefined ? 0 : this.state.data.archiveFacts(page, chatIsFan(page) ? generation.fanRef : generation.conversationRef).total;
    this.state.data.storeRecap(generation.pageLabel, generation.fanRef, generation.summaryMode === 'short' ? 'short' : 'full', {
      generationRef: generation.requestId,
      generatedAt: iso(now),
      personaDefinitionId: generation.personaDefinitionId,
      coverage: { transcriptCoverage: total <= served ? 'full-history' : 'window', requestedCount: requested, keptCount: served },
      text: generation.text,
    }, generation.conversationRef);
  }

  private recordUsage(request: HubStreamRequest, principal: Principal, outcome: 'completed' | 'failed' | 'cancelled' | 'quota-denied'): void {
    const charged = outcome === 'completed' || outcome === 'failed';
    this.state.data.usage.push({
      userId: principal.user.userId,
      pageLabel: request.body.pageLabel,
      feature: request.feature,
      at: this.clock.now(),
      outcome,
      regeneration: request.body.isRegeneration === true,
      costMicroUsd: charged ? 2500 : 0,
      tokens: charged ? { input: 1200, output: 40, cacheWrite: 0, cacheRead: 1000 } : { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    });
  }

  /** H-5: an idempotent link write from a finished full fan-summary of the same user, page and fan. */
  private profileFromGeneration(request: ProfileFromGenerationRequest, principal: Principal, conversation: string): Outcome {
    const s = this.state;
    const now = this.clock.now();
    const generation = s.generations.get(request.generationRef);
    const refusal = (error: HubErrorCode | (string & {}), reason?: string): Outcome => ({ kind: 'refuse', refusal: reason === undefined ? { error } : { error, reason } });
    if (generation === undefined) {
      const inFlight = request.clientRequestId !== undefined && [...s.generations.values()].some((g) => g.clientRequestId === request.clientRequestId);
      return inFlight ? refusal('generation_not_ready') : refusal('not_found');
    }
    if (generation.userId !== principal.user.userId || generation.pageLabel !== request.pageLabel || generation.fanRef !== request.fanRef) return refusal('not_found');
    // R20 F6b (hub HF-10, `generationIsOfConversation`): a generation of the fan's own form, or of this conversation.
    if (generation.conversationRef !== generation.fanRef && generation.conversationRef !== conversation) return refusal('not_found');
    if (generation.outcome === 'open') return refusal('generation_not_ready');
    if (generation.outcome !== 'done') return refusal('generation_not_eligible', 'not_completed');
    if (generation.feature !== 'fan-summary' || generation.summaryMode !== null) return refusal('generation_not_eligible', 'not_full_summary');
    if (generation.completedAt === null || generation.completedAt + s.config.generationVisibleAfterMs > now) return refusal('generation_not_ready');
    const saved = s.data.saveDossier(request.pageLabel, request.fanRef, generation.requestId, generation.text, generation.completedAt, principal.user.userId, now);
    return { kind: 'json', status: 200, body: { outcome: saved.outcome, profile: { version: saved.profile.version, createdAt: saved.profile.createdAt, sourceGeneratedAt: saved.profile.sourceGeneratedAt ?? null } } };
  }

  // ── loopback control endpoint ────────────────────────────────────────────

  private async handleControl(request: Request, url: URL): Promise<Response> {
    try {
      if (url.pathname === `${FAKE_HUB_CONTROL_PREFIX}journal`) return json(200, this.journal.read(Number(url.searchParams.get('since') ?? '0') || 0));
      if (url.pathname === `${FAKE_HUB_CONTROL_PREFIX}control` && request.method.toUpperCase() === 'POST') {
        return json(200, this.control(checkCommand(await request.json())) ?? { ok: true });
      }
      return json(404, { error: 'not_found', message: 'fake hub: no such control endpoint', statusCode: 404 });
    } catch (error) {
      return json(400, { error: 'bad_request', message: `fake hub control: ${error instanceof Error ? error.message : String(error)}`, statusCode: 400 });
    }
  }
}

/** The archive a generation's transcript is read from: the fan's where a chat is its fan, the group's on Fansly. */
function transcriptRefOf(page: FakePage, body: { readonly conversationRef: string; readonly fanRef?: string | null | undefined }): string {
  return chatIsFan(page) ? (body.fanRef ?? body.conversationRef) : body.conversationRef;
}

/** The client reads keyed by conversation (R20 F6b, hub HF-10). */
const CONVERSATION_ROUTES: readonly HubRouteKey[] = ['clientConversationRecaps', 'clientConversationFeed', 'clientFanProfileFromGeneration'];

function namesConversation(request: unknown): boolean {
  return typeof request === 'object' && request !== null && (request as { conversationRef?: unknown }).conversationRef !== undefined;
}

/**
 * The hub's resolver of a read by conversation (HF-10 `services/client-conversation.ts`), before anything is read:
 * where a chat is its fan (OnlyFans) the conversation is the fan — absent or equal changes nothing, another is 409
 * `conversation_fan_mismatch`; where a chat has an id of its own (Fansly) it is required (400 without it), and its
 * pair is checked by the AI lane's own rule (HF-9): a group the page's capture holds as another fan's is 409
 * `conversation_fan_mismatch`; a group without a thread, or with a fan the hub does not know, is served unverified.
 */
function conversationOf(page: FakePage, request: { readonly fanRef: string; readonly conversationRef?: string | undefined }, data: DataModel): string | Outcome {
  const { fanRef, conversationRef } = request;
  const mismatch: Outcome = { kind: 'refuse', refusal: { error: 'conversation_fan_mismatch' } };
  if (CHAT_IS_FAN[page.platform]) return conversationRef === undefined || conversationRef === fanRef ? fanRef : mismatch;
  if (conversationRef === undefined) return { kind: 'refuse', refusal: { error: 'bad_request' } };
  return data.pair(page.pageLabel, conversationRef, fanRef) === 'mismatch' ? mismatch : conversationRef;
}

/** A fake hub for one test file (in-process mode). */
export function createFakeHub(options: FakeHubOptions = {}): FakeHub {
  return new FakeHub(options);
}
