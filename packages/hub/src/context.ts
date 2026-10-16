// The facade's shared plumbing: who is signed in (the connection of one
// sign-in epoch), authenticated calls on both transports, and the one place
// where a failure becomes a FacadeCallError — with the resolver's reading,
// the 401 rule (AU-010/011/014) and the dispositions that concern the hub
// layer's own state (refresh the catalog or the bootstrap).

import { type ClaimAction, type HubFailure, type HubRequestCheck, type HubRouteKey, type HubErrorResolution, type AbortSignalLike } from '@cg/contracts';
import { resolveHubError } from '@cg/core/domain';

import { type AuthCustody } from './auth';
import { FacadeCallError, FacadeCheckError, failureFields } from './errors';
import { type HubClock, type HubEnvironment, type HubLog, type UuidSource } from './ports';
import { type SdkOperation, type SdkRawInput } from './sdk-transport';
import { type ClientFamilyKey, type HubWire, type WireResult } from './transport';
import { REQUEST_TIMEOUT_MS } from './wire';

/** A call of the hub that takes this long is said in the log (`hub: slow call`), whatever its answer. */
export const SLOW_CALL_MS = 3_000;

/** One sign-in, frozen for the calls that run under it. */
export interface Connection {
  readonly epoch: number;
  readonly token: string;
  readonly hubOrigin: string;
  readonly userId: number;
  /** The hub echoed a narrow token (H-3); false only in the dev/compat mode. */
  readonly narrow: boolean;
}

/** Facts of a call that some error rules read (HubErrorContext). */
export interface CallFacts {
  readonly pageLabel?: string | null;
  readonly beforeFirstFrame?: boolean;
  readonly claimAction?: ClaimAction | null;
  readonly fanLookup?: boolean;
  /** The AI stream already spent its one transparent 503 retry: `retry-once` reads as `show`. */
  readonly retrySpent?: boolean;
  /** A public route (sign-in, health) or a sign-in not committed yet: no older sign-in to ignore. */
  readonly unbound?: boolean;
}

export interface CallOptions {
  readonly signal?: AbortSignalLike | undefined;
  /** null: no deadline of ours. */
  readonly timeoutMs?: number | null;
  readonly facts?: CallFacts;
  /** A client/* request's strict schema of its site (R20 P9d), instead of the registry's. */
  readonly check?: HubRequestCheck;
}

export interface ContextHooks {
  /** Pages of the cached bootstrap of this epoch; null when there is none. */
  grantedPages(): readonly string[] | null;
  refreshBootstrap(): void;
  refreshCatalog(): void;
  /** The hub denied a narrow token after all (bootstrap without `identity.tokenClient`): wipe and revoke it (CG-HUB-OUTDATED). */
  dropFullToken(connection: Connection): void;
}

export class HubContext {
  hooks: ContextHooks = {
    grantedPages: () => null,
    refreshBootstrap: () => undefined,
    refreshCatalog: () => undefined,
    dropFullToken: () => undefined,
  };

  constructor(
    readonly env: HubEnvironment,
    readonly custody: AuthCustody,
    readonly wire: HubWire,
    readonly clock: HubClock,
    readonly log: HubLog,
    readonly uuid: UuidSource,
  ) {}

  /**
   * The dev/compat mode (a full token kept, the bootstrap synthesized for a hub without `client/*` routes) is a
   * developer's tool: only in a test build AND with debug mode on. A release build never has it, whatever its
   * settings say — debug mode is a switch any chatter can flip, and the narrow token (H-3) is what bounds the
   * damage of a stolen sign-in (architecture.md §14). A release build that meets a hub without H-2/H-3 says
   * CG-HUB-OUTDATED and revokes what the hub issued.
   */
  compatAllowed(): boolean {
    return this.env.testBuild && this.env.debugEnabled();
  }

  /** The current sign-in or the check that refuses: not signed in, another hub, unreadable, a full token in a release build. */
  connection(route: HubRouteKey | null): Connection {
    const state = this.custody.state();
    if (state === 'unreadable') throw new FacadeCheckError('authUnreadable', route, this.custody.epoch());
    if (state === 'mismatch') throw new FacadeCheckError('hubOriginMismatch', route, this.custody.epoch());
    const stored = this.custody.current();
    if (stored === null) throw new FacadeCheckError('notSignedIn', route, this.custody.epoch());
    const connection: Connection = {
      epoch: this.custody.epoch(),
      token: stored.token,
      hubOrigin: stored.hubOrigin,
      userId: stored.user.userId,
      narrow: stored.narrow,
    };
    // Refused, never erased here: this runs on every read, and the debug switch may not be loaded
    // yet (a background restart) — a read must not wipe and revoke a developer's sign-in. Erasing
    // a full token is the explicit debug-off transition's job (facade.notifyDebugChanged).
    if (!connection.narrow && !this.compatAllowed()) throw new FacadeCheckError('narrowTokenMissing', route, connection.epoch);
    return connection;
  }

  isCurrent(connection: Connection): boolean {
    return this.custody.isCurrent(connection.epoch, connection.token);
  }

  /** An SDK operation under the current sign-in (or an explicit connection, during sign-in). */
  async sdk(route: SdkOperation, input: SdkRawInput, options: CallOptions = {}, connection: Connection = this.connection(asRoute(route))): Promise<unknown> {
    const started = this.clock.monotonic();
    const result = await this.wire.sdk(route, this.wireCall(connection, options), input);
    this.noteSlow(asRoute(route), started, result, connection);
    return this.unwrap(asRoute(route), result, connection, options.facts);
  }

  /** A client/* route under the current sign-in (or an explicit connection). */
  async client(route: ClientFamilyKey, request: unknown, options: CallOptions = {}, connection: Connection = this.connection(route)): Promise<unknown> {
    const started = this.clock.monotonic();
    const result = await this.wire.client(route, this.wireCall(connection, options), request, options.check);
    this.noteSlow(route, started, result, connection);
    return this.unwrap(route, result, connection, options.facts);
  }

  /**
   * A call that took long, said in the log with its route, its time and how it ended — facts only. The hub's
   * own log tells how long the hub worked on a request; this line tells how long the request was on its way
   * and back: the difference is the network between this browser and the hub (a «Проверяю…» that lasted 20 s
   * with a hub that answered in milliseconds).
   */
  private noteSlow(route: HubRouteKey, started: number, result: WireResult, connection: Connection): void {
    const ms = Math.round(this.clock.monotonic() - started);
    if (ms < SLOW_CALL_MS) return;
    this.log('warn', 'hub: slow call', { route, ms, ...(result.ok ? { outcome: 'answered', status: result.status } : { outcome: 'failed', ...failureFields(result.failure) }), epoch: connection.epoch });
  }

  wireCall(connection: Connection, options: CallOptions) {
    return {
      hubOrigin: connection.hubOrigin,
      token: connection.token,
      signals: [options.signal, this.epochSignalOf(connection)],
      timeoutMs: options.timeoutMs === undefined ? REQUEST_TIMEOUT_MS : options.timeoutMs,
    };
  }

  /** The signal of the connection's epoch: already aborted when that sign-in has ended. */
  epochSignalOf(connection: Connection): AbortSignalLike {
    if (this.isCurrent(connection)) return this.custody.epochSignal();
    // A connection being signed in (not committed yet) is not cancelled by transitions of the old one.
    if (connection.epoch > this.custody.epoch()) return NEVER_ABORTED;
    return ALREADY_ABORTED;
  }

  unwrap(route: HubRouteKey, result: WireResult, connection: Connection, facts: CallFacts = {}): unknown {
    if (result.ok) return result.value;
    throw this.failure(route, result.failure, connection, facts);
  }

  /** The reading of a failure, its side effects on the hub layer's state, and the error to throw. */
  failure(route: HubRouteKey, failure: HubFailure, connection: Connection, facts: CallFacts = {}): FacadeCallError {
    const resolution = this.resolve(route, failure, connection, facts);
    if (failure.kind === 'http' && failure.status === 401 && resolution.disposition === 'clear-sign-in') {
      this.custody.reportUnauthorized(connection.epoch, connection.token, failure.reason);
    }
    if (resolution.disposition === 'refresh-catalog') this.hooks.refreshCatalog();
    if (resolution.disposition === 'refresh-bootstrap') this.hooks.refreshBootstrap();
    if (failure.kind !== 'transport' || failure.failure !== 'aborted') {
      this.log('warn', 'hub: call failed', { route, ...failureFields(failure), code: resolution.code, disposition: resolution.disposition, epoch: connection.epoch });
    }
    return new FacadeCallError(route, failure, connection.epoch, resolution);
  }

  resolve(route: HubRouteKey, failure: HubFailure, connection: Connection, facts: CallFacts): HubErrorResolution {
    const pageLabel = facts.pageLabel ?? null;
    const granted = this.hooks.grantedPages();
    const resolution = resolveHubError(failure, {
      route,
      currentSignIn:
        facts.unbound === true ||
        this.isCurrent(connection) ||
        connection.epoch > this.custody.epoch() ||
        this.custody.endedByOwnUnauthorized(connection.epoch, connection.token),
      pageGranted: pageLabel === null || granted === null ? null : granted.includes(pageLabel),
      beforeFirstFrame: facts.beforeFirstFrame ?? false,
      claimAction: facts.claimAction ?? null,
      fanLookup: facts.fanLookup ?? false,
      now: this.clock.now(),
    });
    return facts.retrySpent === true && resolution.disposition === 'retry-once' ? { ...resolution, disposition: 'show' } : resolution;
  }
}

function asRoute(operation: SdkOperation): HubRouteKey {
  // `pages` (dev/compat only) reads its errors like `me`: an account route.
  return operation === 'pages' ? 'me' : operation;
}

const NEVER_ABORTED: AbortSignalLike = { aborted: false, addEventListener: () => undefined };
const ALREADY_ABORTED: AbortSignalLike = { aborted: true, addEventListener: () => undefined };
