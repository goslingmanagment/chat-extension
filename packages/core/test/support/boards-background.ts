// The background as the R12 controllers see it over the tab protocol: every
// request they make is answered here by the real R10 services — the
// operation scheduler, the action tokens, the send coordinator — and by a
// hub reached through one injected call (the test file hands in the fake
// hub's fetch; this helper imports only @cg/contracts and @cg/core, as
// dependency-cruiser asks of test helpers). Every answer is checked against
// the protocol's response schema, so a controller is never fed a shape the
// real background could not send.

import {
  PlatformSchema,
  TAB_REQUESTS,
  sendLockKey,
  type AutoLists,
  type Bootstrap,
  type CgErrorWire,
  type ClaimAction,
  type ClaimOp,
  type ClaimState,
  type Dossier,
  type HostAccount,
  type HubBinding,
  type HubFailure,
  type HubRouteKey,
  type OpView,
  type PartRef,
  type PersonaCatalog,
  type SendAttemptView,
  type SendBegin,
  type SessionIdentity,
  type SettingsV1,
  type SpenderListItem,
  type SpendersBoard,
  type SpendersPage,
  type TabEventPayload,
  type TabEventType,
  type TabRequestPayload,
  type TabResponsePayload,
} from '@cg/contracts';
import { type BoardsRequestType, type RpcResult, type TabRpc } from '@cg/core/application/boards';
import { hubErrorWire, resolveHubError } from '@cg/core/domain';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, OpScheduler, type BackgroundSendPort } from '@cg/core/services';
import { SendCoordinator } from '@cg/core/services/custody';

import { MemoryStore, sequentialIds, type FakeClock } from './clock';
import { featuresOf } from './features';
import { FakeHub, hubError } from './fake-hub';

export type HubCall = (route: HubRouteKey, request: unknown) => Promise<{ readonly status: number; readonly body: unknown; readonly retryAfterSec?: number }>;

export interface BackgroundOptions {
  readonly clock: FakeClock;
  /** One hub route with a facade-level request (the fake hub in-process). */
  readonly call: HubCall;
  readonly session: SessionIdentity | null;
  readonly bootstrap: Bootstrap;
  readonly settings: SettingsV1;
  readonly catalog: PersonaCatalog;
  readonly tab: string;
  readonly instanceId: string;
  /** Rows per «Новые» page the background asks the hub for. */
  readonly audiencePageSize?: number;
  /** The sites the background serves; absent — ChatSpace alone (`featuresOf`). */
  readonly features?: OpsEnvironment['features'];
}

type Handler<T extends BoardsRequestType> = (payload: TabRequestPayload<T>) => Promise<RpcResult<TabResponsePayload<T>>>;

const ok = <T>(payload: T): RpcResult<T> => ({ ok: true, payload });
const fail = (error: CgErrorWire): { readonly ok: false; readonly error: CgErrorWire } => ({ ok: false, error });

export class BoardsBackground {
  readonly clock: FakeClock;
  readonly tokens: ActionTokens;
  /** Scripts the AI streams of the scheduler. */
  readonly streams: FakeHub;
  readonly scheduler: OpScheduler;
  readonly coordinator: SendCoordinator;
  readonly store = new MemoryStore();
  /** Every request a controller made, in order. */
  readonly requests: { readonly type: BoardsRequestType; readonly payload: unknown }[] = [];
  /** Answers the response schema refused: a bug of this helper or of the hub fake. */
  readonly schemaFailures: string[] = [];
  session: SessionIdentity | null;
  bootstrap: Bootstrap;
  settings: SettingsV1;
  catalog: PersonaCatalog;
  settingsRevision = 1;
  /** What `op.list` answers instead of the scheduler's own list (a background that started anew and forgot its runs). */
  opList: { readonly ops: OpView[]; readonly truncated: boolean } | null = null;
  /** Events of the background do not reach this tab while set (a fact another tab's port carried, a lost batch): the tab is told nothing. */
  quiet = false;
  /**
   * The tab's port (platform rpc-tab.ts). Anything but `ready` is a port that is down: what the background emits
   * meanwhile is lost for the tab, and a request ends at once with CG-RUNTIME-UNREACHABLE.
   */
  private connection: 'ready' | 'reconnecting' | 'lost' = 'ready';
  private readonly stateListeners = new Set<(state: 'ready' | 'reconnecting' | 'lost') => void>();
  private readonly listeners = new Map<TabEventType, Set<(payload: unknown) => void>>();
  private readonly failures = new Map<BoardsRequestType, CgErrorWire[]>();
  private readonly holds = new Map<BoardsRequestType, Promise<void>[]>();
  private readonly leaseTokens = new Map<string, string>();
  private readonly ids = sequentialIds(0x7000);

  constructor(private readonly options: BackgroundOptions) {
    this.clock = options.clock;
    this.session = options.session;
    this.bootstrap = options.bootstrap;
    this.settings = options.settings;
    this.catalog = options.catalog;
    this.tokens = new ActionTokens(options.clock, this.ids);
    this.streams = new FakeHub(options.clock);
    const events = { emit: <T extends TabEventType>(to: string | null, type: T, payload: TabEventPayload<T>) => (to === null || to === options.tab ? this.emit(type, payload) : undefined) };
    const environment = (): OpsEnvironment => ({
      session: this.session,
      bootstrap: this.bootstrap,
      persona: (pageId) => this.settings.personas.byPageId[String(pageId)] ?? null,
      debug: false,
      settingsLoaded: true,
      features: options.features ?? featuresOf,
    });
    this.scheduler = new OpScheduler({
      clock: options.clock,
      ids: sequentialIds(0x100),
      hub: this.streams,
      resolve: resolveHubError,
      environment,
      tokens: this.tokens,
      events,
      store: new MemoryStore(),
      presence: () => null,
    });
    this.coordinator = new SendCoordinator({
      clock: options.clock,
      hub: {
        claim: (op: ClaimOp) => this.hubClaim('clientFanClaim', op),
        claimStatus: (pageLabel: string, fanRef: string) => this.hubClaim('clientFanClaimStatus', { pageLabel, fanRef }),
      },
      resolve: resolveHubError,
      tokens: this.tokens,
      events,
      store: this.store,
      ops: { forSend: (opId) => this.scheduler.forSend(opId) },
      environment,
      instanceId: options.instanceId,
    });
  }

  // ── the tab side ──

  readonly rpc: TabRpc & Required<Pick<TabRpc, 'onState' | 'state'>> = {
    onState: (listener) => {
      this.stateListeners.add(listener);
      return () => {
        this.stateListeners.delete(listener);
      };
    },
    state: () => this.connection,
    request: <T extends BoardsRequestType>(type: T, payload: TabRequestPayload<T>): Promise<RpcResult<TabResponsePayload<T>>> => this.request(type, payload),
    onEvent: <T extends TabEventType>(type: T, listener: (payload: TabEventPayload<T>) => void): (() => void) => {
      const set = this.listeners.get(type) ?? new Set();
      this.listeners.set(type, set);
      const wrapped = listener as (payload: unknown) => void;
      set.add(wrapped);
      return () => {
        set.delete(wrapped);
      };
    },
  };

  /** Every `send.begin` the driver made, as the coordinator got it. */
  readonly begins: SendBegin[] = [];

  /** The background half of a preview send, as the send driver calls it. */
  readonly sendPort: BackgroundSendPort = {
    begin: (begin: SendBegin) => {
      this.begins.push(begin);
      return this.coordinator.begin(this.options.tab, begin);
    },
    report: async (view: SendAttemptView, pendingId?: string) => {
      await this.coordinator.report(this.options.tab, view, pendingId);
    },
  };

  emit<T extends TabEventType>(type: T, payload: TabEventPayload<T>): void {
    // A port that is down carries nothing: what is emitted meanwhile is lost for the tab.
    if (this.quiet || this.connection !== 'ready') return;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(payload);
  }

  /** The tab's port goes down or comes back. */
  setConnection(state: 'ready' | 'reconnecting' | 'lost'): void {
    this.connection = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  /**
   * `op.reportSent` as the real background takes it (§6.6): the person pressed ChatSpace's own Send on a part
   * «Открыть и вставить» put into the composer, and a tab proved it. The part is journaled as delivered.
   */
  humanSent(opId: string, part: PartRef, platformMessageId: string): SendAttemptView | null {
    const view = this.scheduler.view(opId);
    return view === null ? null : this.coordinator.nativeSent({ attemptId: this.ids.uuid(), view, part, platformMessageId });
  }

  /** The next request of `type` fails with `error` instead of reaching the hub. */
  failNext(type: BoardsRequestType, error: CgErrorWire): void {
    this.failures.set(type, [...(this.failures.get(type) ?? []), error]);
  }

  /** The next request of `type` waits until the returned function is called (a late answer). */
  hold(type: BoardsRequestType): () => void {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.set(type, [...(this.holds.get(type) ?? []), gate]);
    return release;
  }

  count(type: BoardsRequestType): number {
    return this.requests.filter((request) => request.type === type).length;
  }

  signIn(session: SessionIdentity | null, reason: TabEventPayload<'session.changed'>['reason'] = 'sign-in'): void {
    this.session = session;
    this.emit('session.changed', { session, reason });
  }

  setBootstrap(bootstrap: Bootstrap): void {
    this.bootstrap = bootstrap;
    this.emit('bootstrap.changed', { configRevision: bootstrap.configRevision, issuedAt: bootstrap.issuedAt });
  }

  setSettings(settings: SettingsV1): void {
    this.settings = settings;
    this.settingsRevision += 1;
    this.emit('settings.changed', { settings, revision: this.settingsRevision, readOnly: false });
  }

  // ── requests ──

  private async request<T extends BoardsRequestType>(type: T, payload: TabRequestPayload<T>): Promise<RpcResult<TabResponsePayload<T>>> {
    this.requests.push({ type, payload });
    if (this.connection !== 'ready') return fail({ code: 'CG-RUNTIME-UNREACHABLE', detail: this.connection });
    const gate = this.holds.get(type)?.shift();
    if (gate !== undefined) await gate;
    const failure = this.failures.get(type)?.shift();
    if (failure !== undefined) return fail(failure);
    const handler = this.handlers[type];
    if (handler === undefined) return fail({ code: 'CG-UNKNOWN', detail: `no handler for ${type}` });
    const answer = await handler(payload);
    if (answer.ok && !TAB_REQUESTS[type].res.safeParse(answer.payload).success) {
      this.schemaFailures.push(type);
      return fail({ code: 'CG-HUB-REQUEST', detail: `${type}: the answer breaks the protocol schema` });
    }
    return answer;
  }

  private pageLabel(pageId: number): string | null {
    return this.bootstrap.pages.find((page) => page.pageId === pageId)?.pageLabel ?? null;
  }

  private wireOf(route: HubRouteKey, answer: { readonly status: number; readonly body: unknown; readonly retryAfterSec?: number }, claimAction: ClaimAction | null = null, fanLookup = false): CgErrorWire {
    const body = (answer.body ?? {}) as { readonly error?: string; readonly reason?: string };
    const failure: HubFailure = { kind: 'http', status: answer.status, error: body.error ?? null, reason: body.reason ?? null, retryAfterMs: answer.retryAfterSec === undefined ? null : answer.retryAfterSec * 1000 };
    const resolution = resolveHubError(failure, { route, currentSignIn: true, pageGranted: true, beforeFirstFrame: false, claimAction, fanLookup, now: this.clock.now() });
    return hubErrorWire(resolution, `HTTP ${answer.status} • ${body.error ?? 'error'}`) ?? { code: 'CG-DATA-UNAVAILABLE' };
  }

  private async read<R>(route: HubRouteKey, request: unknown, fanLookup = false): Promise<RpcResult<R>> {
    const answer = await this.options.call(route, request);
    if (answer.status >= 200 && answer.status <= 299) return ok(answer.body as R);
    return fail(this.wireOf(route, answer, null, fanLookup));
  }

  private async hubClaim(route: 'clientFanClaim' | 'clientFanClaimStatus', request: unknown): Promise<ClaimState> {
    const answer = await this.options.call(route, request);
    if (answer.status >= 200 && answer.status <= 299) return answer.body as ClaimState;
    const body = (answer.body ?? {}) as { readonly error?: string; readonly reason?: string };
    throw hubError(route, { kind: 'http', status: answer.status, error: body.error ?? null, reason: body.reason ?? null, retryAfterMs: answer.retryAfterSec === undefined ? null : answer.retryAfterSec * 1000 }, this.session?.epoch ?? 0);
  }

  private bindingOf(account: HostAccount): RpcResult<{ binding: HubBinding }> {
    const session = this.session;
    if (session === null) return fail({ code: 'CG-AUTH-REQUIRED' });
    const pages = this.bootstrap.pages.filter((page) => page.platform === account.platform && page.platformAccountId !== null && page.platformAccountId === account.platformAccountId);
    const page = pages[0];
    if (page === undefined || page.platformAccountId === null) return fail({ code: 'CG-BINDING-MISSING' });
    if (pages.length > 1) return fail({ code: 'CG-BINDING-AMBIGUOUS' });
    return ok({
      binding: {
        hubOrigin: session.hubOrigin,
        principalId: session.userId,
        loginEpoch: session.epoch,
        host: account.host,
        hostAccountId: account.hostAccountId,
        platform: account.platform,
        platformAccountId: page.platformAccountId,
        pageId: page.pageId,
        pageLabel: page.pageLabel,
        bindingRevision: page.bindingRevision,
      },
    });
  }

  /** The board as the hub layer assembles it: up to five pages of 200 and the tier buckets. */
  private async board(pageId: number, period: SpendersBoard['period']): Promise<RpcResult<SpendersBoard>> {
    const pageLabel = this.pageLabel(pageId);
    if (pageLabel === null) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
    const items: SpenderListItem[] = [];
    let first: SpendersPage | null = null;
    let complete = true;
    for (let offset = 0; offset < 1000; offset += 200) {
      const answer = await this.options.call('spenders', { scope: 'page', pageLabel, period, limit: 200, offset });
      if (answer.status < 200 || answer.status > 299) {
        if (first === null) return fail(this.wireOf('spenders', answer));
        complete = false;
        break;
      }
      const page = answer.body as SpendersPage;
      first ??= page;
      items.push(...page.items);
      if (offset + 200 >= page.total) break;
    }
    if (first === null) return fail({ code: 'CG-DATA-UNAVAILABLE' });
    const tiers = await this.options.call('pageSpenderAutoLists', { pageLabel });
    return ok({
      pageLabel,
      period,
      scope: first.scope,
      periodMeta: first.period,
      diagnostics: first.diagnostics,
      items,
      total: first.total,
      complete,
      fetchedAt: new Date(this.clock.now()).toISOString(),
      tiers: tiers.status >= 200 && tiers.status <= 299 ? (tiers.body as AutoLists) : null,
    });
  }

  private readonly handlers: { readonly [T in BoardsRequestType]?: Handler<T> } = {
    'session.get': () => Promise.resolve(ok({ session: this.session })),
    'bootstrap.get': () => Promise.resolve(this.session === null ? fail({ code: 'CG-AUTH-REQUIRED' }) : ok(this.bootstrap)),
    'settings.get': () => Promise.resolve(ok({ settings: this.settings, revision: this.settingsRevision, readOnly: false })),
    'catalog.get': () => Promise.resolve(ok(this.catalog)),
    'binding.resolve': ({ account }) => Promise.resolve(this.bindingOf(account)),
    'token.issue': ({ kind, surface }) => Promise.resolve(ok(this.tokens.issue(this.options.tab, kind, surface))),
    'op.start': async (start) => {
      const outcome = await this.scheduler.start(this.options.tab, start);
      return outcome.kind === 'refused' ? fail({ code: outcome.code }) : ok(outcome.admission);
    },
    'op.cancel': ({ opId }) => {
      const state = this.scheduler.cancel(opId);
      return Promise.resolve(state === null ? fail({ code: 'CG-UNKNOWN' }) : ok({ state }));
    },
    'op.list': ({ scope, chatKey }) => Promise.resolve(ok(this.opList ?? this.scheduler.list(this.options.tab, scope, chatKey))),
    'op.reportCopy': () => Promise.resolve(ok({ recorded: true })),
    'op.reportInsert': () => Promise.resolve(ok({ recorded: true })),
    'op.reportShown': () => Promise.resolve(ok({ recorded: true })),
    'spenders.board': ({ pageId, period }) => this.board(pageId, period),
    'spenders.stats': ({ pageId, windowDays, timeZone }) => {
      const pageLabel = this.pageLabel(pageId);
      return pageLabel === null ? Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' })) : this.read('clientSpenderStats', { pageLabel, windowDays, timeZone });
    },
    'spenders.queue': ({ pageId, cursor, limit, everyone }) => {
      const pageLabel = this.pageLabel(pageId);
      const all = everyone === true ? { everyone: 'true' as const } : {};
      return pageLabel === null ? Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' })) : this.read('clientSpenderAwaitingReply', cursor === null ? { pageLabel, limit, ...all } : { pageLabel, cursor, limit, ...all });
    },
    'queue.winback': ({ pageId }) => {
      const pageLabel = this.pageLabel(pageId);
      return pageLabel === null ? Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' })) : this.read('clientWinBack', { pageLabel });
    },
    'queue.winback.pick': ({ pageId, fanRef, approachId }) => {
      const pageLabel = this.pageLabel(pageId);
      return pageLabel === null ? Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' })) : this.read('clientWinBackAttempt', { pageLabel, fanRef, approachId });
    },
    'queue.handoff': ({ pageId }) => {
      const pageLabel = this.pageLabel(pageId);
      return pageLabel === null ? Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' })) : this.read('clientHandoff', { pageLabel });
    },
    'feed.read': ({ pageId, fanRef, cursor, limit, summaryWindow, conversationRef }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      // As the background's hub-data route: the conversation goes along only when it is not the fan (R20 F6b).
      const conversation = conversationRef === undefined || conversationRef === fanRef ? {} : { conversationRef };
      return this.read('clientConversationFeed', { pageLabel, fanRef, limit, ...(cursor === null ? {} : { cursor }), ...(summaryWindow === undefined ? {} : { summaryWindow }), ...conversation });
    },
    'fan.dossier': async ({ pageId, fanRef }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
      // The facade's `fanDossier`: a fan the hub does not know is «no profile» (null), not an error.
      const answer = await this.options.call('pageFanProfile', { pageLabel, fanRef });
      if (answer.status === 404) return ok({ dossier: null });
      if (answer.status >= 200 && answer.status <= 299) return ok({ dossier: answer.body as Dossier });
      return fail(this.wireOf('pageFanProfile', answer, null, true));
    },
    'fan.card': ({ pageId, fanRef, period }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      return this.read('spenderDetail', { platform: 'onlyfans', platformUserId: fanRef, scope: 'page', pageLabel, period }, true);
    },
    // Chat Memory week 2: the fan's card, «Да / Нет», a fact changed — as the background's hub-data routes.
    'fan.memory': ({ pageId, fanRef }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      return this.read('clientFanCard', { pageLabel, fanRef });
    },
    'fan.memory.link': ({ pageId, fanRef, otherPlatform, otherFanRef, decision }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      return this.read('clientFanLinkDecide', { pageLabel, fanRef, otherPlatform, otherFanRef, decision });
    },
    'fan.memory.fact': (request) => {
      const pageLabel = this.pageLabel(request.pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      const { pageId: _pageId, ...change } = request;
      return this.read('clientFanFactChange', { ...change, pageLabel });
    },
    'newcomers.list': ({ pageId, windowHours, cursor }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      const limit = this.options.audiencePageSize ?? 100;
      return this.read('clientAudienceNew', cursor === null ? { pageLabel, windowHours, limit } : { pageLabel, windowHours, cursor, limit });
    },
    'send.list': ({ pageId, fanRef }) => {
      const page = this.bootstrap.pages.find((candidate) => candidate.pageId === pageId);
      const platform = PlatformSchema.safeParse(page?.platform);
      if (!platform.success || this.session === null) return Promise.resolve(fail({ code: 'CG-BINDING-NOT-GRANTED' }));
      // The fan's lock key, as the coordinator builds it for a send.
      return Promise.resolve(ok(this.coordinator.attemptsOf(sendLockKey({ hubOrigin: this.session.hubOrigin, pageId, platform: platform.data, fanRef }))));
    },
    'newcomers.claim': async ({ pageId, fanRef, action }) => {
      const pageLabel = this.pageLabel(pageId);
      if (pageLabel === null) return fail({ code: 'CG-BINDING-NOT-GRANTED' });
      // The background owns the lease token: one per fan and lease, kept across renewals.
      const key = `${pageLabel}|${fanRef}`;
      const leaseToken = this.leaseTokens.get(key) ?? this.ids.uuid();
      this.leaseTokens.set(key, leaseToken);
      const answer = await this.options.call('clientFanClaim', { pageLabel, fanRef, body: { action, leaseToken, instanceId: this.options.instanceId } });
      if (answer.status >= 200 && answer.status <= 299) return ok(answer.body as ClaimState);
      return fail(this.wireOf('clientFanClaim', answer, action));
    },
  };
}
