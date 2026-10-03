// The Spenders board (architecture.md §8.5; SP-004…SP-032): the ranked list
// of one page and period from the hub's `/api/v2/spenders` (SP-004), up to
// 1000 rows from 5 pages of 200, two at a time, inside one 120 s budget,
// with the hub's tier buckets as shelves.
// - One build per key (hub, user, sign-in epoch, page, period): every tab
//   joins it; it is cancelled when its last waiter leaves (SP-027).
// - 10 min cache in memory and in `storage.session` (SP-026); an empty or
//   partial board is never cached; Refresh bypasses the cache (SP-024).
// - The ranking shows as soon as the first page lands; later pages extend
//   it (`onProgress`, SP-028). A failed first page is an error, never an
//   empty board (SP-029); a failed later page or the budget running out
//   gives a board marked incomplete; no page inside 120 s is
//   CG-DATA-TIMEOUT (SP-031).

import {
  CountSchema,
  SPENDERS_BOARD,
  SpendersBoardSchema,
  type AbortSignalLike,
  type AutoLists,
  type HubSpenderPeriod,
  type SpenderListItem,
  type SpendersBoard,
  type SpendersPage,
  type SpendersQuery,
} from '@cg/contracts';
import * as z from 'zod/mini';

import { type BootstrapService } from './bootstrap';
import { flagState, pageOf } from './bootstrap-rules';
import { type Connection, type HubContext } from './context';
import { FacadeCallError, FacadeCheckError, toError, transportFailure } from './errors';
import { type HubKeyValueStore } from './ports';
import { callScope, onAbort } from './wire';

/** `storage.session` key of the shared board cache (§9.4: session data, survives a background unload). */
export const BOARD_SESSION_KEY = 'cache.spenders';
const SESSION_BOARDS_KEPT = 2;

export interface BoardRequest {
  readonly pageLabel: string;
  readonly period: HubSpenderPeriod;
  /** SP-024 Refresh: skip the cache. */
  readonly force?: boolean;
}

export interface BoardOptions {
  readonly signal?: AbortSignalLike;
  /** SP-028: the board so far, after every page (complete: false until the last). */
  readonly onProgress?: (board: SpendersBoard) => void;
}

export interface BoardReaders {
  page(query: SpendersQuery, signal: AbortSignalLike, connection: Connection): Promise<SpendersPage>;
  tiers(pageLabel: string, signal: AbortSignalLike, connection: Connection): Promise<AutoLists>;
}

interface Build {
  readonly key: string;
  readonly promise: Promise<SpendersBoard>;
  readonly controller: AbortController;
  readonly waiters: Set<symbol>;
  readonly progress: Set<(board: SpendersBoard) => void>;
}

const SessionCacheSchema = z.strictObject({
  v: z.literal(1),
  entries: z.array(z.strictObject({ key: z.string(), at: CountSchema, board: SpendersBoardSchema })),
});

export class SpendersBoardService {
  private readonly cache = new Map<string, { readonly at: number; readonly board: SpendersBoard }>();
  private readonly builds = new Map<string, Build>();
  private sessionLoaded = false;

  constructor(
    private readonly ctx: HubContext,
    private readonly bootstrap: BootstrapService,
    private readonly readers: BoardReaders,
    private readonly session: HubKeyValueStore | null,
  ) {}

  async board(request: BoardRequest, options: BoardOptions = {}): Promise<SpendersBoard> {
    const connection = this.ctx.connection('spenders');
    await this.guard(request.pageLabel, connection);
    const key = [connection.hubOrigin, connection.userId, connection.epoch, request.pageLabel, request.period].join('|');
    if (request.force !== true) {
      await this.loadSession();
      const hit = this.cache.get(key);
      if (hit !== undefined && this.ctx.clock.now() - hit.at < SPENDERS_BOARD.cacheMs) return hit.board;
    } else {
      this.cache.delete(key);
    }
    // A build its last waiter left is already cancelled: never join it, start anew (SP-027).
    const running = this.builds.get(key);
    const build = running !== undefined && !running.controller.signal.aborted ? running : this.start(key, request, connection);
    return this.join(build, options, connection);
  }

  /** SP-032: signed in, the page granted to this user, the `spenders` switch usable on it (SP-023 names why not). */
  private async guard(pageLabel: string, connection: Connection): Promise<void> {
    const entry = this.bootstrap.cached() ?? (await this.bootstrap.fresh());
    if (pageOf(entry.bootstrap, pageLabel) === null) throw new FacadeCheckError('pageNotGranted', 'spenders', connection.epoch);
    const state = flagState(entry.bootstrap, 'spenders', pageLabel);
    if (!state.usable) throw new FacadeCheckError('featureDisabled', 'spenders', connection.epoch, state.reason ?? undefined);
  }

  private join(build: Build, options: BoardOptions, connection: Connection): Promise<SpendersBoard> {
    const waiter = Symbol('waiter');
    build.waiters.add(waiter);
    if (options.onProgress !== undefined) build.progress.add(options.onProgress);
    let detach: () => void = () => undefined;
    const release = () => {
      detach();
      build.waiters.delete(waiter);
      if (options.onProgress !== undefined) build.progress.delete(options.onProgress);
    };
    return new Promise<SpendersBoard>((resolve, reject) => {
      const cancelled = () => {
        release();
        if (build.waiters.size === 0) {
          // The last waiter left: cancel the build and drop it at once, so a request in the
          // same tick (another tab opening, a remount) starts a new one instead of joining it.
          build.controller.abort();
          if (this.builds.get(build.key) === build) this.builds.delete(build.key);
        }
        reject(this.ctx.failure('spenders', transportFailure('aborted'), connection));
      };
      const signal = options.signal;
      if (signal?.aborted === true) return cancelled();
      if (signal !== undefined) detach = onAbort(signal, cancelled);
      build.promise.then(
        (board) => {
          release();
          resolve(board);
        },
        (error: unknown) => {
          release();
          reject(toError(error));
        },
      );
    });
  }

  private start(key: string, request: BoardRequest, connection: Connection): Build {
    const controller = new AbortController();
    const progress = new Set<(board: SpendersBoard) => void>();
    const promise = this.assemble(request, connection, controller.signal, (board) => {
      for (const listener of [...progress]) listener(board);
    })
      .then((board) => {
        if (board.complete && board.items.length > 0 && this.ctx.isCurrent(connection)) this.remember(key, board);
        return board;
      })
      .finally(() => {
        if (this.builds.get(key)?.promise === promise) this.builds.delete(key);
      });
    promise.catch(() => undefined);
    const build: Build = { key, promise, controller, waiters: new Set(), progress };
    this.builds.set(key, build);
    return build;
  }

  private async assemble(request: BoardRequest, connection: Connection, cancel: AbortSignal, progress: (board: SpendersBoard) => void): Promise<SpendersBoard> {
    const scope = callScope(this.ctx.clock, [cancel, this.ctx.epochSignalOf(connection)], SPENDERS_BOARD.budgetMs);
    const query = (offset: number): SpendersQuery => ({ scope: 'page', pageLabel: request.pageLabel, period: request.period, limit: SPENDERS_BOARD.pageSize, offset });
    const tiers = this.readers.tiers(request.pageLabel, scope.signal, connection).catch(() => null);
    try {
      let first: SpendersPage;
      try {
        first = await this.readers.page(query(0), scope.signal, connection);
      } catch (error) {
        if (scope.timedOut()) throw new FacadeCheckError('boardTimeout', 'spenders', connection.epoch);
        throw error;
      }
      const pages = new Map<number, readonly SpenderListItem[]>([[0, first.items]]);
      let complete = true;
      const snapshot = (tierBuckets: AutoLists | null, done: boolean): SpendersBoard => ({
        pageLabel: request.pageLabel,
        period: request.period,
        scope: first.scope,
        periodMeta: first.period,
        diagnostics: first.diagnostics,
        items: mergePages(pages),
        total: first.total,
        complete: done && complete,
        fetchedAt: new Date(this.ctx.clock.now()).toISOString(),
        tiers: tierBuckets,
      });
      progress(snapshot(null, false));
      const offsets: number[] = [];
      for (let offset = SPENDERS_BOARD.pageSize; offset < Math.min(first.total, SPENDERS_BOARD.maxRows); offset += SPENDERS_BOARD.pageSize) offsets.push(offset);
      if (first.items.length < SPENDERS_BOARD.pageSize) offsets.length = 0;
      let next = 0;
      const worker = async (): Promise<void> => {
        while (complete && next < offsets.length && !scope.signal.aborted) {
          const offset = offsets[next] as number;
          next += 1;
          try {
            const page = await this.readers.page(query(offset), scope.signal, connection);
            pages.set(offset, page.items);
            progress(snapshot(null, false));
          } catch (error) {
            if (cancel.aborted || (error instanceof FacadeCallError && error.failure.kind === 'transport' && error.failure.failure === 'aborted' && !scope.timedOut())) throw error;
            complete = false;
            this.ctx.log('warn', 'hub: spenders board page failed', { offset, timedOut: scope.timedOut() });
          }
        }
      };
      await Promise.all(Array.from({ length: SPENDERS_BOARD.parallel }, () => worker()));
      if (next < offsets.length) complete = false;
      const board = snapshot(await tiers, true);
      return SpendersBoardSchema.parse(board);
    } finally {
      scope.dispose();
    }
  }

  private remember(key: string, board: SpendersBoard): void {
    this.cache.set(key, { at: this.ctx.clock.now(), board });
    if (this.session === null) return;
    const entries = [...this.cache.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, SESSION_BOARDS_KEPT)
      .map(([entryKey, value]) => ({ key: entryKey, at: value.at, board: value.board }));
    void this.session.set({ [BOARD_SESSION_KEY]: { v: 1, entries } }).then((written) => {
      if (!written.ok) this.ctx.log('warn', 'hub: board cache write failed', { code: written.code });
    });
  }

  private async loadSession(): Promise<void> {
    if (this.sessionLoaded || this.session === null) return;
    this.sessionLoaded = true;
    const read = await this.session.get([BOARD_SESSION_KEY]);
    if (!read.ok) {
      this.ctx.log('warn', 'hub: board cache read failed', { code: read.code });
      return;
    }
    const parsed = SessionCacheSchema.safeParse(read.value[BOARD_SESSION_KEY]);
    if (!parsed.success) return;
    for (const entry of parsed.data.entries) if (!this.cache.has(entry.key)) this.cache.set(entry.key, { at: entry.at, board: entry.board });
  }

  /** Sign-in transitions: nothing of the previous user survives. */
  clear(): void {
    this.cache.clear();
    for (const build of this.builds.values()) build.controller.abort();
    this.builds.clear();
    if (this.session !== null) void this.session.remove([BOARD_SESSION_KEY]);
  }
}

/** Pages in offset order, one row per fan (the order may shift between pages; the first sighting wins), at most 1000. */
export function mergePages(pages: ReadonlyMap<number, readonly SpenderListItem[]>): SpenderListItem[] {
  const seen = new Set<string>();
  const rows: SpenderListItem[] = [];
  for (const offset of [...pages.keys()].sort((a, b) => a - b)) {
    for (const item of pages.get(offset) ?? []) {
      const key = `${item.fan.platform}:${item.fan.platformUserId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
    }
  }
  return rows.slice(0, SPENDERS_BOARD.maxRows);
}
