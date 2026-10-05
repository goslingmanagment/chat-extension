// Bootstrap (architecture.md §8.3, H-2): fetch, checks, cache and refresh.
// - The cache lives `ttlSec` from our fetch, in memory and in `cache.bootstrap`
//   (owner-marked: hub origin + user + epoch, AU-022).
// - Refreshed at start (unless the stored one is still fresh: an event page
//   starts again after every idle unload, so a start is not rare — then it
//   is read again by its ttl), on expiry, at sign-in, on focus at most once
//   per 60 s and on «Проверить связь»; after a failure: 5 / 15 / 60 s, then
//   every 60 s (AU-017, HUB_FACADE_TIMING).
// - An expired bootstrap blocks new sensitive actions (the facade refreshes
//   before them) but keeps whatever results exist.
// - A generation is the one exception (coordinator's decision after the first
//   live check, X13): it never waits for a refresh while a bootstrap that
//   expired no more than 2 × ttlSec ago is cached — it is served from that
//   one while the refresh runs (`recent`). The hub checks every AI call
//   again, so a switch the owner flipped meanwhile still refuses it there.
//   Inserts, navigation, X8 `dispatch` and the other writes keep the rule.
// - A hub without `client/bootstrap` (404, prod today) gets the DEV-ONLY
//   synthesized bootstrap when the compat mode is allowed (a test build with
//   debug on), else CG-HUB-OUTDATED (`bootstrapMissing`).

import {
  BootstrapSchema,
  CHAT_EXTENSION_CLIENT,
  HUB_FACADE_TIMING,
  HubAuthStateSchema,
  HubIntIdSchema,
  HubOriginSchema,
  STORAGE_KEYS,
  CountSchema,
  type Bootstrap,
  type BootstrapOptions,
  type HubAuthState,
} from '@cg/contracts';
import * as z from 'zod/mini';

import { protocolSupported, synthesizeCompatBootstrap, type CompatPage } from './bootstrap-rules';
import { type CallOptions, type Connection, type HubContext } from './context';
import { FacadeCallError, FacadeCheckError, toError, transportFailure } from './errors';
import { elapsedSince, type HubKeyValueStore } from './ports';

export type BootstrapSource = 'hub' | 'compat';

export interface BootstrapEntry {
  readonly bootstrap: Bootstrap;
  readonly source: BootstrapSource;
  /** Our wall clock at the fetch (stored); the cache lives `ttlSec` from here. */
  readonly fetchedAt: number;
  /** Our monotonic clock at the fetch; absent for an entry read back from storage (HB-008). */
  readonly fetchedMono?: number;
  readonly epoch: number;
  readonly hubOrigin: string;
  readonly userId: number;
}

const BootstrapCacheSchema = z.strictObject({
  v: z.literal(1),
  bootstrap: BootstrapSchema,
  source: z.enum(['hub', 'compat']),
  fetchedAt: CountSchema,
  epoch: CountSchema,
  hubOrigin: HubOriginSchema,
  userId: HubIntIdSchema,
});

const CompatPagesSchema = z.array(
  z.object({ id: HubIntIdSchema, label: z.string(), platform: z.string(), modelName: z.string(), displayName: z.nullable(z.string()) }),
);

/**
 * How long after its expiry a cached bootstrap still admits a generation, in
 * ttls: a refresh that hangs on the network path must not cost every quick
 * feature its whole 30 s until-meta deadline with no request sent at all.
 */
export const GENERATION_GRACE_TTLS = 2;

/** What a generation is admitted by without waiting: the cached bootstrap, and for how long it has been expired (0 — fresh). */
export interface RecentBootstrap {
  readonly entry: BootstrapEntry;
  readonly expiredMs: number;
  /** An expired one only — where its refresh stands: this call started it, it was already running, or its retry waits for its pause. */
  readonly refresh: 'started' | 'running' | 'scheduled' | null;
}

export interface BootstrapDeps {
  readonly ctx: HubContext;
  readonly local: HubKeyValueStore;
  readonly compatPageAccounts: Readonly<Record<string, string>>;
}

export class BootstrapService {
  private entry: BootstrapEntry | null = null;
  private inFlight: { readonly epoch: number; readonly promise: Promise<BootstrapEntry> } | null = null;
  private timer: unknown = null;
  private failures = 0;
  /** Monotonic. */
  private lastFocusRefreshAt = Number.NEGATIVE_INFINITY;
  private lastFailure: unknown = null;
  private readonly listeners = new Set<(entry: BootstrapEntry) => void>();

  constructor(private readonly deps: BootstrapDeps) {}

  private get ctx(): HubContext {
    return this.deps.ctx;
  }

  /** The cached bootstrap of the CURRENT sign-in, fresh or not. */
  cached(): BootstrapEntry | null {
    const entry = this.entry;
    const session = this.ctx.custody.session();
    if (entry === null || session === null) return null;
    if (entry.epoch !== session.epoch || entry.hubOrigin !== session.hubOrigin || entry.userId !== session.userId) return null;
    if (entry.source === 'compat' && !this.ctx.compatAllowed()) return null;
    return entry;
  }

  isFresh(entry: BootstrapEntry): boolean {
    return this.age(entry) < entry.bootstrap.ttlSec * 1000;
  }

  /** Monotonic within this background, wall for a stored entry (HB-008). */
  private age(entry: BootstrapEntry): number {
    return elapsedSince(this.ctx.clock, { at: entry.fetchedAt, mono: entry.fetchedMono });
  }

  /** The last refresh failure (a FacadeCallError / FacadeCheckError), null after a success. */
  lastError(): unknown {
    return this.lastFailure;
  }

  onChange(listener: (entry: BootstrapEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** HubFacade.bootstrap. */
  async get(options: BootstrapOptions = {}): Promise<Bootstrap> {
    // Signed in, the right hub, a token this build may keep — before any cache.
    this.ctx.connection('clientBootstrap');
    const cached = this.cached();
    if (options.force !== true && cached !== null && this.isFresh(cached) && (options.ifRevision === undefined || options.ifRevision === cached.bootstrap.configRevision)) {
      return cached.bootstrap;
    }
    return (await this.refresh()).bootstrap;
  }

  /** A fresh bootstrap for a sensitive action: the cache when fresh, otherwise a refresh that must succeed. */
  async fresh(): Promise<BootstrapEntry> {
    this.ctx.connection('clientBootstrap');
    const cached = this.cached();
    if (cached !== null && this.isFresh(cached)) return cached;
    return this.refresh();
  }

  /**
   * For a generation: the cached bootstrap when it is fresh or expired no more than `GENERATION_GRACE_TTLS`
   * ttls ago — an expired one has its refresh running (started here unless one runs or its retry is scheduled).
   * null — nothing recent enough is cached: the caller waits for `refresh()`.
   */
  recent(): RecentBootstrap | null {
    const connection = this.ctx.connection('clientBootstrap');
    const cached = this.cached();
    if (cached === null) return null;
    const ttlMs = cached.bootstrap.ttlSec * 1000;
    const expiredMs = Math.max(0, Math.round(this.age(cached) - ttlMs));
    if (expiredMs === 0 && this.isFresh(cached)) return { entry: cached, expiredMs: 0, refresh: null };
    if (expiredMs > GENERATION_GRACE_TTLS * ttlMs) return null;
    if (this.inFlight !== null && this.inFlight.epoch === connection.epoch) return { entry: cached, expiredMs, refresh: 'running' };
    if (this.timer !== null) return { entry: cached, expiredMs, refresh: 'scheduled' };
    this.refresh().catch(() => undefined);
    return { entry: cached, expiredMs, refresh: 'started' };
  }

  /** One fetch per sign-in epoch at a time; the result is adopted only while that sign-in lasts. */
  refresh(): Promise<BootstrapEntry> {
    let connection: Connection;
    try {
      connection = this.ctx.connection('clientBootstrap');
    } catch (error) {
      return Promise.reject(toError(error));
    }
    if (this.inFlight !== null && this.inFlight.epoch === connection.epoch) return this.inFlight.promise;
    const promise = this.fetchFor(connection, {})
      .then((entry) => {
        if (this.ctx.isCurrent(connection)) this.adopt(entry);
        return entry;
      })
      .catch((error: unknown) => {
        if (this.ctx.isCurrent(connection)) this.failed(error, connection);
        throw error;
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });
    this.inFlight = { epoch: connection.epoch, promise };
    return promise;
  }

  /**
   * Fetches and checks a bootstrap for `connection` (also a sign-in not
   * committed yet). Refuses: another user than the token's (contract), an
   * unknown protocol, a full token (no `identity.tokenClient`) outside the
   * compat mode, a missing route outside the compat mode.
   */
  async fetchFor(connection: Connection, options: CallOptions): Promise<BootstrapEntry> {
    const now = this.ctx.clock.now();
    const mono = this.ctx.clock.monotonic();
    let bootstrap: Bootstrap;
    let source: BootstrapSource = 'hub';
    try {
      bootstrap = (await this.ctx.client('clientBootstrap', null, options, connection)) as Bootstrap;
    } catch (error) {
      if (!(error instanceof FacadeCallError) || error.failure.kind !== 'http' || error.failure.status !== 404) throw error;
      if (!this.ctx.compatAllowed()) throw new FacadeCheckError('bootstrapMissing', 'clientBootstrap', connection.epoch);
      bootstrap = await this.synthesize(connection, options, now);
      source = 'compat';
    }
    if (bootstrap.identity.userId !== connection.userId) throw this.ctx.failure('clientBootstrap', transportFailure('contract'), connection);
    if (!protocolSupported(bootstrap)) throw new FacadeCheckError('bootstrapProtocol', 'clientBootstrap', connection.epoch);
    if (source === 'hub' && bootstrap.identity.tokenClient !== CHAT_EXTENSION_CLIENT && !this.ctx.compatAllowed()) {
      throw new FacadeCheckError('narrowTokenMissing', 'clientBootstrap', connection.epoch);
    }
    return { bootstrap, source, fetchedAt: now, fetchedMono: mono, epoch: connection.epoch, hubOrigin: connection.hubOrigin, userId: connection.userId };
  }

  private async synthesize(connection: Connection, options: CallOptions, now: number): Promise<Bootstrap> {
    this.ctx.log('warn', 'hub: no client/bootstrap — using the DEV-ONLY compat bootstrap', { epoch: connection.epoch });
    const me = (await this.ctx.sdk('me', {}, options, connection)) as HubAuthState;
    const pages = CompatPagesSchema.parse(await this.ctx.sdk('pages', {}, options, connection)) as CompatPage[];
    return synthesizeCompatBootstrap({ me: HubAuthStateSchema.parse(me), pages, issuedAt: new Date(now).toISOString(), pageAccounts: this.deps.compatPageAccounts });
  }

  /** Takes a checked bootstrap as the current one, persists it and schedules its expiry refresh. */
  adopt(entry: BootstrapEntry): void {
    const previous = this.entry;
    this.entry = entry;
    this.failures = 0;
    this.lastFailure = null;
    this.schedule(Math.max(1_000, entry.bootstrap.ttlSec * 1000 - this.age(entry)));
    // The monotonic stamp means nothing to another background: only the wall one is stored.
    const { fetchedMono: _mono, ...stored } = entry;
    void this.deps.local.set({ [STORAGE_KEYS.cacheBootstrap]: { v: 1, ...stored } }).then((written) => {
      if (!written.ok) this.ctx.log('warn', 'hub: bootstrap cache write failed', { code: written.code });
    });
    if (previous === null || previous.bootstrap.configRevision !== entry.bootstrap.configRevision || previous.epoch !== entry.epoch || previous.bootstrap.issuedAt !== entry.bootstrap.issuedAt) {
      for (const listener of [...this.listeners]) listener(entry);
    }
  }

  /** A bootstrap that did not arrive (at sign-in: CG-LOGIN-INCOMPLETE): retry by the backoff (AU-017). */
  failed(error: unknown, connection: Connection): void {
    this.lastFailure = error;
    this.failures += 1;
    const pauses = HUB_FACADE_TIMING.bootstrapRetryPausesMs;
    const pause = pauses[Math.min(this.failures - 1, pauses.length - 1)] ?? 60_000;
    if (error instanceof FacadeCheckError && error.check === 'narrowTokenMissing') {
      this.ctx.hooks.dropFullToken(connection);
      return;
    }
    if (error instanceof FacadeCallError && error.failure.kind === 'transport' && error.failure.failure === 'aborted') return;
    // The call's own lines («slow call», «call failed») say what happened to the request; this one says what the
    // hub layer does next and whether the bootstrap it still holds has run out.
    const cached = this.cached();
    this.ctx.log('warn', 'hub: bootstrap refresh failed', {
      route: 'clientBootstrap',
      failures: this.failures,
      retryInMs: pause,
      cached: cached === null ? 'none' : this.isFresh(cached) ? 'fresh' : 'expired',
      epoch: connection.epoch,
    });
    this.schedule(pause);
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.ctx.clock.setTimeout(() => {
      this.timer = null;
      if (this.ctx.custody.current() === null) return;
      this.refresh().catch(() => undefined);
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.ctx.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Focus of a ChatSpace tab: refresh at most once per 60 s (§8.3). A bootstrap read less than 60 s ago —
   * by this background or by the one before it (the stored stamp) — is not read again for a focus either:
   * a restarted event page hears «focus» from every tab that registers again.
   */
  onFocus(): void {
    const now = this.ctx.clock.monotonic();
    const minMs = HUB_FACADE_TIMING.bootstrapFocusRefreshMinMs;
    if (this.ctx.custody.current() === null || now - this.lastFocusRefreshAt < minMs) return;
    const cached = this.cached();
    if (cached !== null && this.age(cached) < minMs) return;
    this.lastFocusRefreshAt = now;
    this.refresh().catch(() => undefined);
  }

  /**
   * Background start, after `loadStored` (§8.3). The stored bootstrap of this sign-in, while still fresh,
   * is kept and read again when its ttl runs out; a missing or expired one is read now.
   */
  startRefresh(): void {
    if (this.ctx.custody.current() === null) return;
    const cached = this.cached();
    if (cached !== null && this.isFresh(cached)) {
      this.schedule(Math.max(1_000, cached.bootstrap.ttlSec * 1000 - this.age(cached)));
      return;
    }
    this.refresh().catch(() => undefined);
  }

  /** A sign-in transition: forget the previous sign-in's bootstrap and its timers. */
  reset(): void {
    this.cancelTimer();
    this.entry = null;
    this.inFlight = null;
    this.failures = 0;
    this.lastFailure = null;
  }

  async clearStored(): Promise<void> {
    const removed = await this.deps.local.remove([STORAGE_KEYS.cacheBootstrap]);
    if (!removed.ok) this.ctx.log('warn', 'hub: bootstrap cache erase failed', { code: removed.code });
  }

  /** Background start: the stored bootstrap of THIS sign-in (same hub, user and epoch) is used until the refresh lands. */
  async loadStored(): Promise<void> {
    const read = await this.deps.local.get([STORAGE_KEYS.cacheBootstrap]);
    if (!read.ok) {
      this.ctx.log('warn', 'hub: bootstrap cache read failed', { code: read.code });
      return;
    }
    const parsed = BootstrapCacheSchema.safeParse(read.value[STORAGE_KEYS.cacheBootstrap]);
    if (!parsed.success) return;
    const { v: _v, ...entry } = parsed.data;
    this.entry = entry;
    if (this.cached() === null) this.entry = null;
  }

  dispose(): void {
    this.cancelTimer();
  }
}
