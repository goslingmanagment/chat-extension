// FBuddy's spending tiers for «Онлайн» (contracts fan-badges.ts; 2026-10-28, the owner: «какой у них алмазик»): one
// `GET <FBuddy>/api/v1/fan-spend/batch?fanIds=…&tierVersion=2` with `X-Fansly-Account-Id: <creator>`, made the way
// FBuddy's own extension makes it — from the background, in this browser's own FBuddy sign-in (its cookie). On by
// default (the owner, 2026-10-28): FBuddy's address is granted at install. An older install the update did not grant
// it to asks FBuddy all the same — Firefox sends a `SameSite=None` sign-in without it, a `Lax` one only with it —, and
// «not signed in» there says the address is what may be missing (`off`). Nothing but the creator's and the fans' ids
// goes to FBuddy; nothing is written there. A tier is kept ten minutes per creator and fan (FBuddy's own cache
// time); a fan read within them is answered from it. Not signed in to FBuddy, or FBuddy not answering, is said once
// and asked again only with the next read after a minute. A test build reads the stand's copy (its origin from the e2e's
// key), never FBuddy itself.

import { FBUDDY_ORIGIN, type FbuddyState, type FbuddyTier } from '@cg/contracts/fan-badges';
import { readFbuddyTiers } from '@cg/core/domain/hosts/fansly/badges';

export const FBUDDY_READ = {
  /** A fan's tier is kept this long (FBuddy's own cache time). */
  keepMs: 10 * 60_000,
  /** After «not signed in» or no answer, FBuddy is asked again no sooner. */
  retryMs: 60_000,
  /** The fans one request names. */
  batch: 100,
  /** One request waits this long. */
  timeoutMs: 8_000,
  /** The kept tiers at most (every creator together). */
  keepMax: 5_000,
} as const;

/** Where the batch is read: FBuddy's API in a release; a test build hands in the stand's copy. */
export const fbuddyBatchUrl = (base: string, fanRefs: readonly string[]): string => `${base}/api/v1/fan-spend/batch?fanIds=${fanRefs.join(',')}&tierVersion=2`;

export interface FbuddyAnswer {
  readonly state: FbuddyState;
  /** The fans FBuddy named, with their tier; a fan read and not named has none (absent). */
  readonly tiers: ReadonlyMap<string, FbuddyTier | null>;
}

export interface FbuddyTiers {
  read(creator: string, fanRefs: readonly string[]): Promise<FbuddyAnswer>;
  /** Forgets everything (another person signed in). */
  clear(): void;
}

export interface FbuddyDeps {
  /** FBuddy's address is granted (at install, or allowed by the person since). */
  granted(): Promise<boolean>;
  /** FBuddy's base; null — none (a test build without its stand). */
  base(): Promise<string | null>;
  now(): number;
  fetch(url: string, init: RequestInit): Promise<Response>;
  warn(msg: string, fields: Record<string, string | number>): void;
}

/** The release's FBuddy: its API, through the global `fetch` (tools/gates FETCH_EXCEPTIONS). */
export const releaseFbuddy = {
  base: (): Promise<string> => Promise.resolve(FBUDDY_ORIGIN),
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
} as const;

export function createFbuddyTiers(deps: FbuddyDeps): FbuddyTiers {
  const kept = new Map<string, { readonly at: number; readonly tier: FbuddyTier | null }>();
  /** The last «not signed in» / «no answer», and when: FBuddy is not asked again within `retryMs`. */
  let refused: { readonly at: number; readonly state: FbuddyState } | null = null;
  const key = (creator: string, fan: string): string => `${creator}:${fan}`;
  const prune = (): void => {
    for (const [name, entry] of kept) if (kept.size > FBUDDY_READ.keepMax || deps.now() - entry.at >= FBUDDY_READ.keepMs) kept.delete(name);
  };

  async function ask(base: string, creator: string, batch: readonly string[]): Promise<FbuddyState> {
    let response: Response;
    try {
      response = await deps.fetch(fbuddyBatchUrl(base, batch), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json', 'X-Fansly-Account-Id': creator },
        signal: AbortSignal.timeout(FBUDDY_READ.timeoutMs),
      });
    } catch {
      deps.warn('fbuddy not reached', {});
      return 'failed';
    }
    if (response.status === 401) return (await deps.granted().catch(() => false)) ? 'signed-out' : 'off';
    if (!response.ok) {
      deps.warn('fbuddy refused', { status: response.status });
      return 'failed';
    }
    const tiers = readFbuddyTiers(await response.json().catch(() => null));
    if (tiers === null) {
      deps.warn('fbuddy answer malformed', {});
      return 'failed';
    }
    const at = deps.now();
    for (const fan of batch) kept.set(key(creator, fan), { at, tier: tiers.get(fan) ?? null });
    return 'on';
  }

  return {
    async read(creator, fanRefs) {
      prune();
      const asked = [...new Set(fanRefs)];
      const missing = asked.filter((fan) => !kept.has(key(creator, fan)));
      let state: FbuddyState = 'on';
      if (missing.length > 0) {
        const base = await deps.base();
        if (base === null) state = 'failed';
        else if (refused !== null && deps.now() - refused.at < FBUDDY_READ.retryMs) state = refused.state;
        else {
          for (let at = 0; at < missing.length && state === 'on'; at += FBUDDY_READ.batch) state = await ask(base, creator, missing.slice(at, at + FBUDDY_READ.batch));
          refused = state === 'on' ? null : { at: deps.now(), state };
        }
      }
      const tiers = new Map<string, FbuddyTier | null>();
      for (const fan of asked) {
        const entry = kept.get(key(creator, fan));
        if (entry !== undefined) tiers.set(fan, entry.tier);
      }
      return { state, tiers };
    },
    clear() {
      kept.clear();
      refused = null;
    },
  };
}
