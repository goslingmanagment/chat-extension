// The hub facade (architecture.md §5.8, §8; contracts hub/facade.ts): the
// background's only door to the hub. Built over the vendored @kernel/sdk for
// the operations it has and over the RouteTransport for the client/* routes
// it does not have yet. Background-only (§4): the token, the network and the
// SDK never reach a content script, a page or a lazy chunk.
//
// Never called: `/ofapi/*`, the event streams, full personas, the raw AI
// gateway, Fansly's outreach route, pageTopSpenders (§8.1, AU-029) — the
// transports only know the contract's operations (+ `pages` for the dev
// compat bootstrap).

import {
  CHAT_EXTENSION_CLIENT,
  DeviceTokenIssueRequestSchema,
  HUB_CLIENT_CHECK_CODES,
  HUB_FACADE_TIMING,
  HUB_ROUTE_SCHEMAS,
  HUB_ROUTES,
  HubOriginSchema,
  INGEST_LIMITS,
  IngestBatchSchema,
  hasCapability,
  type AbortSignalLike,
  type AcceptanceEvent,
  type AiQuotaSnapshot,
  type AiStreamCapability,
  type AiUsageQuery,
  type AiUsageReport,
  type AudienceNewPage,
  type AudienceNewQuery,
  type AutoLists,
  type Bootstrap,
  type BootstrapOptions,
  type CgErrorWire,
  type ClaimOp,
  type ClaimState,
  type ClientFeatureFlag,
  type ClientHealthV1,
  type DeviceTokenIssueResponse,
  type Dossier,
  type DossierQuery,
  type FeedPage,
  type FeedQuery,
  type HostAccount,
  type HubAuthState,
  type HubBinding,
  type HubFacade,
  type HubFrame,
  type HubHealth,
  type HubRouteKey,
  type HubStreamRequest,
  type IngestEvent,
  type IngestResult,
  type NativeId,
  type PersonaCatalog,
  type ProfileFromGenerationRequest,
  type ProfileSaveOutcome,
  type PromptSnapshotView,
  type QueuePage,
  type QueueQuery,
  type RecapStatus,
  type RecapStatusQuery,
  type SessionIdentity,
  type SharedRecaps,
  type SharedRecapsQuery,
  type SignOutOutcome,
  type SpenderBatch,
  type SpenderBatchQuery,
  type SpenderDetail,
  type SpenderDetailQuery,
  type SpendersBoard,
  type SpendersPage,
  type SpendersQuery,
  type SpendersStats,
  type StartOp,
  type StatsQuery,
} from '@cg/contracts';
import { hubErrorWire } from '@cg/core/domain';
import { KERNEL_CONTRACT_HASH } from '@kernel/sdk';

import { buildStreamRequest, type StreamRequestResult } from './ai-request';
import { sdkStreamTransport, type AiStreamTransport } from './ai-stream-transport';
import { AuthCustody, AuthWriteError, type AuthState, type LastEnd, type SessionChange, type TokenMeta, type Unsubscribe } from './auth';
import { BootstrapService, type BootstrapEntry, type BootstrapSource } from './bootstrap';
import { bindingStillHolds, belowMinVersion, flagState, pageOf, resolveBinding, type BindingResolution, type FlagState } from './bootstrap-rules';
import { CatalogService } from './catalog';
import { HubContext, type CallFacts, type Connection } from './context';
import { PromptEchoStore, type EchoTicket } from './debug-echo';
import { FacadeCallError, FacadeCheckError, failureDetail, transportFailure } from './errors';
import { SILENT_LOG, SYSTEM_CLOCK, type FetchLike, type HubClock, type HubEnvironment, type HubKeyValueStore, type HubLog, type UuidSource } from './ports';
import { QuotaTracker } from './quota';
import { type ClientRouteKey } from './route-transport';
import { SpendersBoardService, type BoardOptions, type BoardRequest } from './spenders-board';
import { StreamService, type StreamNotice } from './stream';
import { HubWire } from './transport';
import { callScope, clientVersionHeaders } from './wire';

export interface HubFacadeOptions {
  readonly env: HubEnvironment;
  /** `storage.local`: `auth.token`, `auth.meta`, `cache.bootstrap`, `cache.catalog`. */
  readonly local: HubKeyValueStore;
  /** `storage.session`: the shared Spenders board cache; null = memory only. */
  readonly session?: HubKeyValueStore | null;
  readonly fetch: FetchLike;
  readonly clock?: HubClock;
  readonly log?: HubLog;
  readonly uuid?: UuidSource;
  /** The AI stream's transport (seam for the SDK's H-4 `capabilities`, and for tests). */
  readonly streamTransport?: AiStreamTransport;
  /**
   * DEV-ONLY compat mode (debug or a test build): pageLabel → OnlyFans
   * creator id for the synthesized bootstrap, the only way such a page can
   * bind (never by name). Ignored in a release build without debug.
   */
  readonly compatPageAccounts?: Readonly<Record<string, string>>;
}

export type HubState = 'off' | 'connecting' | 'live' | 'degraded' | 'auth-failed' | 'stopped';

/** HB-003, AU-015, AU-016, ST-044…ST-058: the «Связь» line and the account section, without secrets. */
export interface HubStatus {
  readonly state: HubState;
  readonly auth: AuthState;
  readonly session: SessionIdentity | null;
  /** The dev/compat mode is in use: a full token or the synthesized bootstrap. */
  readonly compat: boolean;
  readonly bootstrap: { readonly source: BootstrapSource; readonly configRevision: number; readonly issuedAt: string; readonly fresh: boolean } | null;
  readonly lastError: CgErrorWire | null;
  /** Why the last sign-in ended (AU-015). */
  readonly lastEnd: LastEnd | null;
  readonly token: TokenMeta | null;
  readonly reachable: boolean | null;
  readonly lastCheckedAt: string | null;
  /** HB-005/HB-007: shown, never blocking. */
  readonly sdk: { readonly vendoredHash: string; readonly hubHash: string | null; readonly compatible: boolean | null };
}

/** `ingest`: the hub's counts, plus the client_health events refused locally (no `client-health-perf-v1`). */
export interface IngestOutcome extends IngestResult {
  /** Not sent and never to be retried: the hub has not declared `client-health-perf-v1`. */
  readonly healthRefused: number;
}

export type CheckResult = { readonly ok: true } | { readonly ok: false; readonly error: CgErrorWire | null };

/** «Проверить связь» (HB-001, HB-002, ST-045). */
export interface ConnectionReport {
  readonly checkedAt: string;
  readonly health: CheckResult;
  readonly bootstrap: CheckResult;
  readonly catalog: CheckResult;
}

const OS_LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux', other: 'OS' } as const;
const WIPE_REASONS = new Set(['token_revoked', 'token_expired']);

/** A UUID-shaped id derived from `seed` (FNV-1a, four lanes): the same report always gets the same `clientEventId`. */
export function stableEventId(seed: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15].map((basis) => {
    let hash = basis >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  });
  const hex = lanes.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The wire form of any facade rejection; null when there is nothing to show. */
export function errorWireOf(error: unknown): CgErrorWire | null {
  if (error instanceof FacadeCheckError) return { code: error.code, ...(error.reason === undefined ? {} : { detail: error.reason }) };
  if (error instanceof FacadeCallError) {
    if (error.resolution === undefined) return null;
    return hubErrorWire(error.resolution, failureDetail(error.failure));
  }
  return null;
}

export class ChatExtensionHub implements HubFacade {
  readonly ready: Promise<void>;
  private readonly ctx: HubContext;
  private readonly custody: AuthCustody;
  private readonly bootstrapService: BootstrapService;
  private readonly catalogService: CatalogService;
  private readonly quota: QuotaTracker;
  private readonly echo: PromptEchoStore;
  private readonly board: SpendersBoardService;
  private readonly streams: StreamService;
  private readonly wire: HubWire;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly notices = new Set<(notice: StreamNotice) => void>();
  private droppingFullToken: Promise<void> | null = null;
  private configRevision: number | null = null;
  private healthState: { reachable: boolean | null; checkedAt: string | null; hubHash: string | null; compatible: boolean | null } = {
    reachable: null,
    checkedAt: null,
    hubHash: null,
    compatible: null,
  };

  constructor(private readonly options: HubFacadeOptions) {
    const clock = options.clock ?? SYSTEM_CLOCK;
    const log = options.log ?? SILENT_LOG;
    const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
    const headers = () => clientVersionHeaders(options.env.extensionVersion);
    this.wire = new HubWire({ fetch: options.fetch, clock, headers });
    this.custody = new AuthCustody({ local: options.local, clock, log, configuredOrigin: () => options.env.hubOrigin() });
    this.ctx = new HubContext(options.env, this.custody, this.wire, clock, log, uuid);
    this.bootstrapService = new BootstrapService({ ctx: this.ctx, local: options.local, compatPageAccounts: options.compatPageAccounts ?? {} });
    this.catalogService = new CatalogService(this.ctx, options.local);
    this.quota = new QuotaTracker(() => clock.now());
    this.echo = new PromptEchoStore(clock, uuid);
    this.board = new SpendersBoardService(
      this.ctx,
      this.bootstrapService,
      {
        // The board's 120 s budget is the only deadline of its reads (SP-031).
        page: (query, signal, connection) =>
          this.ctx.sdk('spenders', { query }, { signal, timeoutMs: null, facts: { pageLabel: query.pageLabel } }, connection) as Promise<SpendersPage>,
        tiers: (pageLabel, signal, connection) =>
          this.ctx.sdk('pageSpenderAutoLists', { params: { pageLabel } }, { signal, timeoutMs: null, facts: { pageLabel } }, connection) as Promise<AutoLists>,
      },
      options.session ?? null,
    );
    this.streams = new StreamService({
      ctx: this.ctx,
      bootstrap: this.bootstrapService,
      catalog: this.catalogService,
      quota: this.quota,
      echo: this.echo,
      transport: options.streamTransport ?? sdkStreamTransport,
      fetch: options.fetch,
      headers,
      notify: (notice) => {
        for (const listener of [...this.notices]) listener(notice);
      },
    });
    this.ctx.hooks = {
      grantedPages: () => this.bootstrapService.cached()?.bootstrap.pages.map((page) => page.pageLabel) ?? null,
      refreshBootstrap: () => void this.bootstrapService.refresh().catch(() => undefined),
      refreshCatalog: () => this.catalogService.invalidate(),
      dropFullToken: (connection) => void this.dropFullToken(connection),
    };
    // Every sign-in transition forgets what belonged to the previous one (§9.4).
    this.custody.onChange((change) => this.forgetPreviousSignIn(change));
    // AU-027: an owner change of the client config (configRevision) may have moved personas.
    this.bootstrapService.onChange((entry) => {
      const revision = entry.bootstrap.configRevision;
      if (this.configRevision !== null && this.configRevision !== revision && this.custody.isCurrent(entry.epoch, this.custody.storedRecord()?.token ?? '')) {
        this.catalogService.refresh().catch(() => undefined);
      }
      this.configRevision = revision;
    });
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    await this.custody.load();
    if (this.custody.current() === null) return;
    await Promise.all([this.bootstrapService.loadStored(), this.catalogService.loadStored()]);
    // §8.3: refresh at start; AU-027: the catalog too. Failures schedule their own retries.
    this.bootstrapService.refresh().catch(() => undefined);
    this.catalogService.refresh().catch(() => undefined);
  }

  private forgetPreviousSignIn(change: SessionChange): void {
    this.configRevision = null;
    this.bootstrapService.reset();
    this.catalogService.reset();
    this.board.clear();
    this.quota.clear();
    this.echo.clear();
    this.inFlight.clear();
    if (change.session === null) {
      void this.bootstrapService.clearStored();
      void this.catalogService.clearStored();
    }
  }

  // ── events ───────────────────────────────────────────────────────────────

  /** `session.changed`; every change bumps the epoch and cancels the previous sign-in's operations (epochSignal). */
  onSessionChange(listener: (change: SessionChange) => void): Unsubscribe {
    return this.custody.onChange(listener);
  }

  /** `bootstrap.changed`. */
  onBootstrapChange(listener: (entry: BootstrapEntry) => void): Unsubscribe {
    return this.bootstrapService.onChange(listener);
  }

  /** `catalog.changed`. */
  onCatalogChange(listener: () => void): Unsubscribe {
    return this.catalogService.onChange(listener);
  }

  /** `quota.changed` (TL-013). */
  onQuotaChange(listener: (quota: AiQuotaSnapshot) => void): Unsubscribe {
    return this.quota.onChange(listener);
  }

  /** «Сервис недоступен, повтор через 5 с…» of an operation. */
  onStreamNotice(listener: (notice: StreamNotice) => void): Unsubscribe {
    this.notices.add(listener);
    return () => this.notices.delete(listener);
  }

  /** Aborted at the next sign-in transition: operations link to it (§8.2 «Любая смена входа … отменяет операции»). */
  epochSignal(): AbortSignal {
    return this.custody.epochSignal();
  }

  // ── sign-in custody (§8.2) ───────────────────────────────────────────────

  session(): SessionIdentity | null {
    return this.custody.session();
  }

  async signIn(login: string, password: string): Promise<SessionIdentity> {
    await this.ready;
    return this.custody.transition(() => this.signInNow(login, password));
  }

  private async signInNow(login: string, password: string): Promise<SessionIdentity> {
    const { env } = this.options;
    const hubOrigin = env.hubOrigin();
    const route: HubRouteKey = 'authIssueDeviceTokenWithPassword';
    const epoch = this.custody.epoch();
    if (!HubOriginSchema.safeParse(hubOrigin).success || (!env.testBuild && !hubOrigin.startsWith('https://'))) {
      throw new FacadeCheckError('hubUrlInvalid', route, epoch);
    }
    // The sign-in being made: its epoch is the next one, so transitions of the old sign-in do not cancel it.
    const unbound: Connection = { epoch: epoch + 1, token: '', hubOrigin, userId: 1, narrow: true };
    const scope = callScope(this.ctx.clock, [], HUB_FACADE_TIMING.signInTimeoutMs);
    const call = { signal: scope.signal, timeoutMs: null, facts: { unbound: true } } as const;
    let issuedToken: string | null = null;
    try {
      const body = { username: login, password, label: `Firefox · ${OS_LABELS[env.os]} · ChatSpace`, mode: 'active' as const, client: CHAT_EXTENSION_CLIENT };
      if (!DeviceTokenIssueRequestSchema.safeParse(body).success) throw this.ctx.failure(route, transportFailure('contract'), unbound, { unbound: true });
      const result = await this.wire.sdk(route, { hubOrigin, token: null, signals: [scope.signal], timeoutMs: null }, { body });
      if (!result.ok) throw this.ctx.failure(route, result.failure, unbound, { unbound: true });
      const issued = result.value as DeviceTokenIssueResponse;
      // AU-002: a pending reservation is never stored.
      if (issued.mode === 'pending') throw new FacadeCheckError('signInPending', route, epoch);
      issuedToken = issued.token;
      // PR 9 rule: only the echo proves a narrow token; a hub without H-3 issues a full one silently.
      const narrow = issued.client === CHAT_EXTENSION_CLIENT;
      if (!narrow && !this.ctx.compatAllowed()) throw new FacadeCheckError('narrowTokenMissing', route, epoch);
      let connection: Connection = { ...unbound, token: issued.token, narrow };
      const me = (await this.ctx.sdk('me', {}, call, connection)) as HubAuthState;
      connection = { ...connection, userId: me.user.id };
      // The bootstrap shares the 20 s; without it the sign-in still holds: CG-LOGIN-INCOMPLETE, retried 5/15/60 s (AU-017).
      let entry: BootstrapEntry | null = null;
      let bootstrapError: unknown = null;
      try {
        entry = await this.bootstrapService.fetchFor(connection, call);
      } catch (error) {
        if (error instanceof FacadeCheckError) throw error;
        bootstrapError = scope.timedOut() ? this.ctx.failure('clientBootstrap', transportFailure('timeout'), connection, { unbound: true }) : error;
      }
      const previous = this.custody.storedRecord();
      let session: SessionIdentity;
      try {
        session = await this.custody.commitSignIn({
          token: issued.token,
          hubOrigin,
          user: { userId: me.user.id, login: me.user.username, role: me.user.role },
          narrow,
          tokenMeta: { keyPrefix: issued.keyPrefix, issuedAt: new Date(this.ctx.clock.now()).toISOString(), expiresAt: issued.expiresAt, label: issued.label, version: env.extensionVersion },
        });
      } catch (error) {
        if (error instanceof AuthWriteError) throw new FacadeCheckError('authWriteFailed', route, epoch);
        throw error;
      }
      issuedToken = null;
      connection = { ...connection, epoch: session.epoch };
      if (entry !== null) this.bootstrapService.adopt({ ...entry, epoch: session.epoch });
      else this.bootstrapService.failed(bootstrapError, connection);
      this.catalogService.refresh().catch(() => undefined);
      // «Войти заново» replaced a sign-in: its token is revoked where it was issued.
      if (previous !== null && previous.token !== issued.token) void this.revoke(previous.hubOrigin, previous.token);
      return session;
    } catch (error) {
      // A token that was issued but is not kept is revoked at once.
      if (issuedToken !== null) void this.revoke(hubOrigin, issuedToken);
      // AU-004: the 20 s ran out — whichever step was waiting, it is the sign-in's timeout.
      if (scope.timedOut() && !(error instanceof FacadeCheckError)) throw this.ctx.failure(route, transportFailure('timeout'), unbound, { unbound: true });
      throw error;
    } finally {
      scope.dispose();
    }
  }

  /** AU-013: erase → revoke at the issuing hub (5 s) → erase again. The local sign-in is gone whatever the hub says. */
  async signOut(): Promise<SignOutOutcome> {
    await this.ready;
    return this.custody.transition(async () => {
      const stored = this.custody.storedRecord();
      await this.custody.wipe('sign-out', null);
      const serverRevoked = stored === null ? null : await this.revoke(stored.hubOrigin, stored.token);
      await this.custody.eraseAgain();
      return { serverRevoked };
    });
  }

  /** true: revoked (or already revoked); false: the hub refused; null: no answer in 5 s. */
  private async revoke(hubOrigin: string, token: string): Promise<boolean | null> {
    const result = await this.wire.sdk('authRevokeCurrentDeviceToken', { hubOrigin, token, signals: [], timeoutMs: HUB_FACADE_TIMING.signOutRevokeTimeoutMs });
    if (result.ok) return true;
    if (result.failure.kind !== 'http') return null;
    return result.failure.status === 401 && result.failure.reason !== null && WIPE_REASONS.has(result.failure.reason);
  }

  /** A full token met a release build (PR 9 rule): wipe it with CG-HUB-OUTDATED and revoke it. */
  private dropFullToken(connection: Connection): Promise<void> {
    if (this.droppingFullToken !== null) return this.droppingFullToken;
    const dropping = this.custody
      .transition(async () => {
        if (!this.custody.isCurrent(connection.epoch, connection.token)) return;
        await this.custody.wipe('outdated', 'CG-HUB-OUTDATED');
        await this.revoke(connection.hubOrigin, connection.token);
      })
      .finally(() => {
        this.droppingFullToken = null;
      });
    this.droppingFullToken = dropping;
    return dropping;
  }

  /**
   * `settings.debug.enabled` changed — and once after the settings load at
   * start. A full token (dev/compat mode) is erased only here, by this
   * explicit transition, never by a read: with debug off in a release build
   * it is wiped with CG-HUB-OUTDATED and revoked (PR 9 rule), and the prompt
   * echoes go (§9.3). With debug on, a sign-in reads its bootstrap and
   * catalog again (the compat bootstrap is allowed now).
   */
  async notifyDebugChanged(): Promise<void> {
    await this.ready;
    const debug = this.options.env.debugEnabled();
    if (!debug) this.echo.clear();
    const stored = this.custody.current();
    if (stored === null) return;
    if (!stored.narrow && !this.ctx.compatAllowed()) {
      const epoch = this.custody.epoch();
      await this.dropFullToken({ epoch, token: stored.token, hubOrigin: stored.hubOrigin, userId: stored.user.userId, narrow: false });
      return;
    }
    if (debug) {
      this.bootstrapService.refresh().catch(() => undefined);
      this.catalogService.refresh().catch(() => undefined);
    }
  }

  // ── status and connection (HB-001…HB-007) ────────────────────────────────

  async health(): Promise<HubHealth> {
    await this.ready;
    const stored = this.custody.storedRecord();
    const hubOrigin = stored?.hubOrigin ?? this.options.env.hubOrigin();
    const unbound: Connection = { epoch: this.custody.epoch(), token: '', hubOrigin, userId: 1, narrow: true };
    const result = await this.wire.sdk('health', { hubOrigin, token: null, signals: [], timeoutMs: null });
    const checkedAt = new Date(this.ctx.clock.now()).toISOString();
    if (!result.ok) {
      this.healthState = { ...this.healthState, reachable: false, checkedAt };
      throw this.ctx.failure('health', result.failure, unbound, { unbound: true });
    }
    const health = result.value as HubHealth;
    this.healthState = {
      reachable: true,
      checkedAt,
      hubHash: health.contractHash,
      compatible: health.compatibleClientSdks === undefined ? null : health.compatibleClientSdks.includes(KERNEL_CONTRACT_HASH),
    };
    return health;
  }

  /** «Проверить связь»: health, bootstrap and catalog read again; a 401 with a reason heals through the usual rule (HB-002). */
  async checkConnection(): Promise<ConnectionReport> {
    await this.ready;
    this.ctx.connection(null);
    const [health, bootstrap, catalog] = await Promise.allSettled([this.health(), this.bootstrapService.refresh(), this.catalogService.refresh()]);
    const result = (settled: PromiseSettledResult<unknown>): CheckResult => (settled.status === 'fulfilled' ? { ok: true } : { ok: false, error: errorWireOf(settled.reason) });
    return { checkedAt: new Date(this.ctx.clock.now()).toISOString(), health: result(health), bootstrap: result(bootstrap), catalog: result(catalog) };
  }

  /**
   * `settings.hub.baseUrl` changed (the settings service calls this; ST-042
   * normally allows it only signed out). A stored sign-in that this makes
   * unusable (another hub) or usable again gets a new epoch: the operations
   * of the old address are cancelled and `session.changed` says `hub-changed`
   * (§7). Usable again: the bootstrap and the catalog are read anew.
   */
  async notifyHubOriginChanged(): Promise<void> {
    await this.ready;
    const moved = await this.custody.transition(() => this.custody.hubOriginChanged());
    if (moved && this.custody.current() !== null) {
      this.bootstrapService.refresh().catch(() => undefined);
      this.catalogService.refresh().catch(() => undefined);
    }
  }

  /** A ChatSpace tab got focus: refresh the bootstrap at most once per 60 s. */
  notifyFocus(): void {
    this.bootstrapService.onFocus();
  }

  status(): HubStatus {
    const auth = this.custody.state();
    const session = this.custody.session();
    const entry = this.bootstrapService.cached();
    const lastError = this.bootstrapService.lastError();
    const lastEnd = this.custody.lastEnd();
    const stopChecks = new Set(['narrowTokenMissing', 'bootstrapMissing', 'bootstrapProtocol']);
    const stored = this.custody.current();
    // A full token outside the dev/compat mode: refused until notifyDebugChanged erases it (or debug comes back on).
    const fullTokenRefused = stored !== null && !stored.narrow && !this.ctx.compatAllowed();
    let state: HubState;
    if (auth === 'unreadable' || auth === 'mismatch') state = 'auth-failed';
    else if (fullTokenRefused) state = 'stopped';
    else if (session === null) state = lastEnd?.reason === 'outdated' ? 'stopped' : lastEnd?.reason === 'revoked' || lastEnd?.reason === 'expired' ? 'auth-failed' : 'off';
    else if ((lastError instanceof FacadeCheckError && stopChecks.has(lastError.check)) || (entry !== null && belowMinVersion(entry.bootstrap, this.options.env.extensionVersion))) state = 'stopped';
    else if (entry === null) state = lastError === null ? 'connecting' : 'degraded';
    else state = this.bootstrapService.isFresh(entry) && entry.source === 'hub' && lastError === null ? 'live' : 'degraded';
    return {
      state,
      auth,
      session,
      compat: (stored !== null && !stored.narrow) || entry?.source === 'compat',
      bootstrap:
        entry === null
          ? null
          : { source: entry.source, configRevision: entry.bootstrap.configRevision, issuedAt: entry.bootstrap.issuedAt, fresh: this.bootstrapService.isFresh(entry) },
      lastError: fullTokenRefused ? { code: HUB_CLIENT_CHECK_CODES.narrowTokenMissing } : this.statusError(lastError, session !== null && entry === null),
      lastEnd,
      token: this.custody.tokenMeta(),
      reachable: this.healthState.reachable,
      lastCheckedAt: this.healthState.checkedAt,
      sdk: { vendoredHash: KERNEL_CONTRACT_HASH, hubHash: this.healthState.hubHash, compatible: this.healthState.compatible },
    };
  }

  /** Signed in without a bootstrap yet: CG-LOGIN-INCOMPLETE, the cause in the detail line. */
  private statusError(error: unknown, incomplete: boolean): CgErrorWire | null {
    if (error === null) return null;
    const wire = errorWireOf(error);
    if (!incomplete || error instanceof FacadeCheckError) return wire;
    return { code: 'CG-LOGIN-INCOMPLETE', ...(wire === null ? {} : { detail: [wire.code, wire.detail].filter((part) => part !== undefined).join(' • ').slice(0, 400) }) };
  }

  // ── bootstrap, binding, catalog (§8.3, AU-022…AU-028) ────────────────────

  async bootstrap(options?: BootstrapOptions): Promise<Bootstrap> {
    await this.ready;
    return this.bootstrapService.get(options);
  }

  /** The cached bootstrap of this sign-in, fresh or expired (results stay readable, §8.3). */
  cachedBootstrap(): { readonly bootstrap: Bootstrap; readonly source: BootstrapSource; readonly fresh: boolean } | null {
    const entry = this.bootstrapService.cached();
    return entry === null ? null : { bootstrap: entry.bootstrap, source: entry.source, fresh: this.bootstrapService.isFresh(entry) };
  }

  /**
   * `binding.resolve`: by platformAccountId or the owner's explicit entry, never by name.
   * Identity only: it keeps resolving on an expired bootstrap (results stay readable, §8.3);
   * acting on the binding is gated by `flagState`, which requires a fresh one.
   */
  resolveBinding(account: HostAccount): BindingResolution | { readonly state: 'signed-out' } {
    const session = this.custody.session();
    const entry = this.bootstrapService.cached();
    if (session === null) return { state: 'signed-out' };
    if (entry === null) return { state: 'loading' };
    return resolveBinding(entry.bootstrap, session, account);
  }

  /** AU-024: re-checked at the end of a generation and before a write. */
  bindingHolds(binding: HubBinding): boolean {
    return bindingStillHolds(binding, this.custody.session(), this.bootstrapService.cached()?.bootstrap ?? null);
  }

  /**
   * The gate of a sensitive action (insertion, navigation, X8 and the rest):
   * usable only on a FRESH bootstrap — an expired one reads `bootstrap_expired`
   * until a refresh lands (§8.3: the owner may have switched it off since).
   * `await bootstrap()` first refreshes an expired one (or rejects with why not).
   */
  flagState(flag: ClientFeatureFlag, pageLabel: string | null): FlagState {
    const entry = this.bootstrapService.cached();
    if (entry === null) return { usable: false, reason: 'hub_not_ready' };
    const state = flagState(entry.bootstrap, flag, pageLabel);
    return state.usable && !this.bootstrapService.isFresh(entry) ? { usable: false, reason: 'bootstrap_expired' } : state;
  }

  async catalog(): Promise<PersonaCatalog> {
    await this.ready;
    return this.catalogService.get();
  }

  // ── the AI stream (§8.4) ─────────────────────────────────────────────────

  async stream(request: HubStreamRequest, sink: (frame: HubFrame) => void, signal: AbortSignalLike): Promise<void> {
    await this.ready;
    return this.streams.run(request, sink, signal);
  }

  /** Capabilities a request may ask for now (declared by the hub ∩ carried by the transport). */
  streamCapabilities(): readonly AiStreamCapability[] {
    return this.streams.available();
  }

  /** AI-142: the request body of an operation over the current bootstrap; refuses without one. */
  buildStreamRequest(op: StartOp, input: { readonly opId: string; readonly persona: { readonly key: string; readonly definitionId: string } }): StreamRequestResult {
    const entry = this.bootstrapService.cached();
    if (entry === null) return { ok: false, problem: 'no bootstrap' };
    return buildStreamRequest(op, { ...input, bootstrap: entry.bootstrap, capabilities: this.streams.available(), debug: this.options.env.debugEnabled() });
  }

  quotaOf(pageId: number): AiQuotaSnapshot | null {
    return this.quota.get(pageId);
  }

  /** DB-006: an operation's echo as a token and counters for the tab. */
  promptEchoTicket(opId: string): EchoTicket | null {
    return this.echo.ticket(opId);
  }

  /** DB-008: a cached result shows its original's echo, marked «из кэша». */
  promptEchoFromCache(originalOpId: string, opId: string): void {
    this.echo.alias(originalOpId, opId);
  }

  /** `debug.prompt` for debug-prompt.html. */
  promptEcho(token: string): PromptSnapshotView {
    return this.echo.view(token, this.options.env.debugEnabled());
  }

  /** Debug turned off: the snapshots go (§9.3). */
  clearPromptEchoes(): void {
    this.echo.clear();
  }

  // ── recaps and the dossier (H-5, H-13) ───────────────────────────────────

  async recapStatus(query: RecapStatusQuery): Promise<RecapStatus> {
    await this.ready;
    await this.guard('aiRecapStatus', query.pageLabel, query);
    return (await this.ctx.sdk('aiRecapStatus', { query }, { facts: { pageLabel: query.pageLabel } })) as RecapStatus;
  }

  async recaps(query: SharedRecapsQuery): Promise<SharedRecaps> {
    return (await this.client('clientConversationRecaps', query, query.pageLabel)) as SharedRecaps;
  }

  /** The dossier of a conversation (`pageConversationProfile`; on OnlyFans the conversation is the fan); null for a fan the hub does not know. */
  async dossier(query: DossierQuery): Promise<Dossier | null> {
    return this.profileRead('pageConversationProfile', query, { pageLabel: query.pageLabel, conversationId: query.fanRef });
  }

  /** The same document looked up by the fan (`pageFanProfile`), for the fan panel's dossier pointer (AI-071). */
  async fanDossier(query: DossierQuery): Promise<Dossier | null> {
    return this.profileRead('pageFanProfile', query, { pageLabel: query.pageLabel, platformUserId: query.fanRef });
  }

  private async profileRead(route: 'pageConversationProfile' | 'pageFanProfile', query: DossierQuery, params: Record<string, string>): Promise<Dossier | null> {
    await this.ready;
    await this.guard(route, query.pageLabel, query);
    try {
      return (await this.coalesced(route, query, () => this.ctx.sdk(route, { params }, { facts: { pageLabel: query.pageLabel, fanLookup: true } }))) as Dossier;
    } catch (error) {
      if (error instanceof FacadeCallError && error.resolution?.disposition === 'empty') return null;
      throw error;
    }
  }

  async profileFromGeneration(request: ProfileFromGenerationRequest): Promise<ProfileSaveOutcome> {
    return this.profileWrite(request, undefined);
  }

  /** One H-5 link write; `signal` (the tab) cancels it in flight. */
  private async profileWrite(request: ProfileFromGenerationRequest, signal: AbortSignalLike | undefined): Promise<ProfileSaveOutcome> {
    try {
      const response = await this.client('clientFanProfileFromGeneration', request, request.pageLabel, { signal });
      return { state: 'saved', response: response as Extract<ProfileSaveOutcome, { state: 'saved' }>['response'] };
    } catch (error) {
      if (!(error instanceof FacadeCallError) || error.failure.kind !== 'http') throw error;
      if (error.resolution?.disposition === 'not-ready') return { state: 'not-ready' };
      if (error.failure.error === 'generation_not_eligible' || error.failure.status === 404) {
        return { state: 'rejected', reason: error.failure.reason ?? error.failure.error };
      }
      throw error;
    }
  }

  /**
   * H-5 on the §7 schedule (AI-067, AI-068): `not-ready` is asked again after
   * 5 s, 15 s and 60 s, then every 3 min, up to 30 min from the first ask,
   * while `signal` lives (the tab is open) and the sign-in lasts. An
   * idempotent link write, never a new generation. Resolves with the last
   * outcome — `not-ready` when the 30 min ran out (the caller shows
   * CG-RECAP-SAVE); rejects when cancelled.
   */
  async saveRecapProfile(request: ProfileFromGenerationRequest, signal: AbortSignalLike): Promise<ProfileSaveOutcome> {
    // Elapsed on the monotonic clock: a wall-clock jump neither ends nor stretches the 30 min (HB-008).
    const started = this.ctx.clock.monotonic();
    const timing = HUB_FACADE_TIMING;
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.profileWrite(request, signal);
      if (outcome.state !== 'not-ready') return outcome;
      const delay = timing.profileSaveDelaysMs[attempt] ?? timing.profileSaveThenEveryMs;
      if (this.ctx.clock.monotonic() + delay - started > timing.profileSaveGiveUpMs) return outcome;
      await this.sleep('clientFanProfileFromGeneration', delay, signal);
    }
  }

  /** Waits `ms` unless `signal` or the sign-in epoch ends first (then rejects as aborted). */
  private sleep(route: HubRouteKey, ms: number, signal: AbortSignalLike): Promise<void> {
    const connection = this.ctx.connection(route);
    const scope = callScope(this.ctx.clock, [signal, this.ctx.epochSignalOf(connection)], ms);
    return new Promise<void>((resolve, reject) => {
      const settle = () => {
        scope.dispose();
        if (scope.timedOut()) resolve();
        else reject(this.ctx.failure(route, transportFailure('aborted'), connection));
      };
      if (scope.signal.aborted) settle();
      else scope.signal.addEventListener('abort', settle, { once: true });
    });
  }

  // ── Spenders (§8.5, H-8) ─────────────────────────────────────────────────

  async spenders(query: SpendersQuery): Promise<SpendersPage> {
    await this.ready;
    await this.guard('spenders', query.pageLabel, query);
    return (await this.coalesced('spenders', query, () => this.ctx.sdk('spenders', { query }, { facts: { pageLabel: query.pageLabel } }))) as SpendersPage;
  }

  async spenderDetail(query: SpenderDetailQuery): Promise<SpenderDetail> {
    await this.ready;
    await this.guard('spenderDetail', query.pageLabel, query);
    const { platform, platformUserId, ...rest } = query;
    return (await this.coalesced('spenderDetail', query, () =>
      this.ctx.sdk('spenderDetail', { params: { platform, platformUserId }, query: rest }, { facts: { pageLabel: query.pageLabel, fanLookup: true } }),
    )) as SpenderDetail;
  }

  async spenderBatch(query: SpenderBatchQuery): Promise<SpenderBatch> {
    await this.ready;
    await this.guard('spenderBatch', query.pageLabel, query);
    return (await this.coalesced('spenderBatch', query, () => this.ctx.sdk('spenderBatch', { body: query }, { facts: { pageLabel: query.pageLabel } }))) as SpenderBatch;
  }

  async autoLists(pageLabel: string): Promise<AutoLists> {
    await this.ready;
    await this.guard('pageSpenderAutoLists', pageLabel, { pageLabel });
    return (await this.coalesced('pageSpenderAutoLists', { pageLabel }, () =>
      this.ctx.sdk('pageSpenderAutoLists', { params: { pageLabel } }, { facts: { pageLabel } }),
    )) as AutoLists;
  }

  /** `spenders.board`: up to 1000 rows with shelves, shared by tabs, cached 10 min (SP-026…SP-032). */
  async spendersBoard(request: BoardRequest, options?: BoardOptions): Promise<SpendersBoard> {
    await this.ready;
    return this.board.board(request, options);
  }

  async spendersStats(query: StatsQuery): Promise<SpendersStats> {
    return (await this.client('clientSpenderStats', query, query.pageLabel)) as SpendersStats;
  }

  async awaitingReply(query: QueueQuery): Promise<QueuePage> {
    return (await this.client('clientSpenderAwaitingReply', query, query.pageLabel)) as QueuePage;
  }

  // ── feed, «Новые», claim and custody (H-7, H-9) ──────────────────────────

  async feed(query: FeedQuery): Promise<FeedPage> {
    return (await this.client('clientConversationFeed', query, query.pageLabel)) as FeedPage;
  }

  async audienceNew(query: AudienceNewQuery): Promise<AudienceNewPage> {
    return (await this.client('clientAudienceNew', query, query.pageLabel)) as AudienceNewPage;
  }

  /**
   * H-7b. Never repeated by the facade — least of all `dispatch`: a lost
   * answer ends the attempt `held`, and only a new click makes a new one.
   * Taking work (claim, renew, dispatch) needs a fresh bootstrap and its
   * flags; reporting what happened (sent, failed, release, registerNativeSend)
   * is never blocked by an expired one.
   */
  async claim(op: ClaimOp): Promise<ClaimState> {
    const { action } = op.body;
    const taking = action === 'claim' || action === 'renew' || action === 'dispatch';
    let flags: readonly ClientFeatureFlag[] = [];
    if (action === 'claim' || action === 'renew') flags = ['newcomers'];
    if (op.body.action === 'dispatch') flags = op.body.purpose === 'greeting' ? ['previewSend', 'newcomers'] : ['previewSend'];
    return (await this.client('clientFanClaim', op, op.pageLabel, { flags, fresh: taking, facts: { claimAction: action } })) as ClaimState;
  }

  async claimStatus(pageLabel: string, fanRef: NativeId): Promise<ClaimState> {
    return (await this.client('clientFanClaimStatus', { pageLabel, fanRef }, pageLabel)) as ClaimState;
  }

  // ── ingest and AI usage (H-11, H-14, H-15) ───────────────────────────────

  /**
   * `ai_acceptance` always; `client_health` only under `client-health-perf-v1`
   * and in its own batches; at most 100 events a batch. The acceptance
   * batches go out first and never wait on the health part: without the
   * capability the health events are not sent and come back counted in
   * `healthRefused` (CG-HUB-CAPABILITY, logged) — the caller drops them like
   * a refused batch, never retries them. The caller's queue keeps
   * `clientEventId` stable across retries (the hub deduplicates). A health
   * report's id comes from its kind, version and window: one report per
   * window — a second, different report of the same window is dropped by the
   * hub as a duplicate.
   */
  async ingest(events: readonly (AcceptanceEvent | ClientHealthV1)[]): Promise<IngestOutcome> {
    await this.ready;
    const connection = this.ctx.connection('ingestObservations');
    const acceptance: IngestEvent[] = [];
    const health: IngestEvent[] = [];
    for (const event of events) {
      if (event.kind === 'ai_acceptance') {
        acceptance.push({ clientEventId: event.clientEventId, kind: event.kind, observedAt: event.observedAt, payload: { ...event.payload }, pageLabel: event.pageLabel });
      } else {
        const { kind, ...payload } = event;
        // Stable for the same report: a retried batch is deduplicated by the hub (TL-009).
        health.push({ clientEventId: stableEventId(`${kind}|${event.client.version}|${event.window.from}|${event.window.to}`), kind, observedAt: event.window.to, payload });
      }
    }
    const batchesOf = (group: readonly IngestEvent[]) => {
      const batches: { events: IngestEvent[] }[] = [];
      for (let start = 0; start < group.length; start += INGEST_LIMITS.maxEventsPerBatch) batches.push({ events: group.slice(start, start + INGEST_LIMITS.maxEventsPerBatch) });
      return batches;
    };
    const acceptanceBatches = batchesOf(acceptance);
    const healthBatches = batchesOf(health);
    // Nothing goes out unless every batch is inside the contract (HB-006).
    if ([...acceptanceBatches, ...healthBatches].some((batch) => !IngestBatchSchema.safeParse(batch).success)) {
      throw this.ctx.failure('ingestObservations', transportFailure('contract'), connection);
    }
    let accepted = 0;
    let duplicates = 0;
    const send = async (batches: readonly { events: IngestEvent[] }[]) => {
      for (const batch of batches) {
        const result = (await this.ctx.sdk('ingestObservations', { body: batch }, {}, connection)) as IngestResult;
        accepted += result.accepted;
        duplicates += result.duplicates;
      }
    };
    await send(acceptanceBatches);
    let healthRefused = 0;
    if (health.length > 0) {
      const entry = this.bootstrapService.cached() ?? (await this.bootstrapService.fresh());
      if (hasCapability(entry.bootstrap.capabilities, 'client-health-perf-v1')) {
        await send(healthBatches);
      } else {
        healthRefused = health.length;
        this.ctx.log('warn', 'hub: client_health not sent, the hub lacks its capability', { code: 'CG-HUB-CAPABILITY', count: healthRefused, epoch: connection.epoch });
      }
    }
    return { accepted, duplicates, healthRefused };
  }

  /** H-15, debug only (§5.8): refused locally with debug off (CG-FEATURE-DISABLED · debug_off) and without `ai-usage-v1`. */
  async aiUsage(query: AiUsageQuery): Promise<AiUsageReport> {
    await this.ready;
    const connection = this.ctx.connection('clientAiUsageDaily');
    if (!this.options.env.debugEnabled()) throw new FacadeCheckError('featureDisabled', 'clientAiUsageDaily', connection.epoch, 'debug_off');
    return (await this.client('clientAiUsageDaily', query, query.pageLabel)) as AiUsageReport;
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  /**
   * A client/* route: signed in; the bootstrap (fresh for taking work);
   * every capability the route needs declared (else CG-HUB-CAPABILITY — so
   * a hub without the route is never asked); the page granted; its flags.
   */
  private async client(
    route: ClientRouteKey,
    request: unknown,
    pageLabel: string,
    options: { readonly flags?: readonly ClientFeatureFlag[]; readonly fresh?: boolean; readonly facts?: CallFacts; readonly signal?: AbortSignalLike | undefined } = {},
  ): Promise<unknown> {
    await this.ready;
    const connection = this.ctx.connection(route);
    const entry = options.fresh === true ? await this.bootstrapService.fresh() : (this.bootstrapService.cached() ?? (await this.bootstrapService.fresh()));
    const missing = HUB_ROUTES[route].capabilities.filter((capability) => !hasCapability(entry.bootstrap.capabilities, capability));
    if (missing.length > 0) throw new FacadeCheckError('capabilityMissing', route, connection.epoch, missing.join(','));
    if (pageOf(entry.bootstrap, pageLabel) === null) throw new FacadeCheckError('pageNotGranted', route, connection.epoch);
    const routeFlag = HUB_ROUTES[route].flag;
    for (const flag of options.flags ?? (routeFlag === null ? [] : [routeFlag])) {
      const state = flagState(entry.bootstrap, flag, pageLabel);
      if (!state.usable) throw new FacadeCheckError(flag === 'previewSend' ? 'previewSendOff' : 'featureDisabled', route, connection.epoch, state.reason ?? undefined);
    }
    return this.ctx.client(route, request, { signal: options.signal, facts: { pageLabel, ...options.facts } }, connection);
  }

  /**
   * SDK page routes: signed in, the request inside its contract (never sent
   * otherwise, HB-006), and the page granted by the bootstrap of this sign-in.
   */
  private async guard(route: HubRouteKey, pageLabel: string, request: unknown): Promise<void> {
    const connection = this.ctx.connection(route);
    const schema = HUB_ROUTE_SCHEMAS[route].request;
    if (schema !== null && !schema.safeParse(request).success) throw this.ctx.failure(route, transportFailure('contract'), connection);
    const entry = this.bootstrapService.cached() ?? (await this.bootstrapService.fresh());
    if (pageOf(entry.bootstrap, pageLabel) === null) throw new FacadeCheckError('pageNotGranted', route, connection.epoch);
  }

  /** Identical reads of one sign-in share one request (§8.5 «склеиваются»). */
  private coalesced(route: HubRouteKey, query: unknown, read: () => Promise<unknown>): Promise<unknown> {
    const key = `${this.custody.epoch()}|${route}|${JSON.stringify(query)}`;
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;
    const promise = read().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  dispose(): void {
    this.bootstrapService.dispose();
    this.catalogService.dispose();
  }
}
