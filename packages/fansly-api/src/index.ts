// Fansly's API (R20 docs/project-unite/architecture.md §8.1, §8.3, §8.4): the
// only code of the extension that requests Fansly, imported by Fansly's
// background chunk alone (.dependency-cruiser.cjs `fansly-api-only-in-its-chunk`).
// FS-NET-1 as data (allowlist.ts), the envelope and the errors (errors.ts), the
// pacer (pacer/), the client over them (client.ts).

import { createFanslyClient, type FanslyClient, type FanslyClientDeps, type FanslySessionPort } from './client';
import { createFanslyPacer, type FanslyPacer, type PacerDeps, type RateLimitFactLike } from './pacer';

export * from './allowlist';
export * from './errors';
export * from './client';
export * from './pacer';

/** The core's session owner as the API needs it: its templates and its 429 facts (`BackgroundKit.networkSession`). */
export interface FanslyNetworkSession extends FanslySessionPort {
  rateLimits(): readonly RateLimitFactLike[];
  idle(): Promise<void>;
  observationsPending?(): boolean;
}

export interface FanslyApiDeps extends Omit<FanslyClientDeps, 'session' | 'pacer'> {
  readonly session: FanslyNetworkSession;
  /** storage.session: the pacer's state survives the event page there. */
  readonly storage: PacerDeps['storage'];
  readonly random?: () => number;
  readonly warn?: PacerDeps['warn'];
}

export interface FanslyApi {
  readonly client: FanslyClient;
  readonly pacer: FanslyPacer;
}

/** The pacer over the core's facts and the client over the core's session: one of each per realm of the event page. */
export function createFanslyApi(deps: FanslyApiDeps): FanslyApi {
  const pacer = createFanslyPacer({
    storage: deps.storage,
    facts: () => deps.session.rateLimits(),
    settle: () => deps.session.idle(),
    pending: () => deps.session.observationsPending?.() ?? false,
    ...(deps.warn === undefined ? {} : { warn: deps.warn }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
    ...(deps.random === undefined ? {} : { random: deps.random }),
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
  });
  const { session, storage: _storage, random: _random, ...rest } = deps;
  return { pacer, client: createFanslyClient({ ...rest, session, pacer }) };
}
