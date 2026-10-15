import type { FanslyApiSignal, FanslyPaceMode } from '@cg/contracts/fansly-api';
import { FanslyApiError } from '../errors';
import type { ApiSessionPort, LimitFact, PacerStorage } from '../ports';
import { abortable, checkAbort, sleep } from './async';
import { BAD_MEMORY_MS, fresh, healed, limited, rested } from './controller';
import { LANE_GAP_MAX_MS, LANE_GAP_MS, LANE_JITTER_MS, paceFor, policyOf, RECOVERY } from './policy';
import { PacerStore, type PacerSnapshot, type SavedLane } from './store';

interface Queue { tail: Promise<void>; pending: number }
export interface Permit { release(): void; served(): void }
export interface PacerDeps {
  readonly session: ApiSessionPort;
  readonly storage: PacerStorage;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly countLimit?: (source: LimitFact['source']) => void;
}
const gap = (level: number): number => Math.min(LANE_GAP_MAX_MS, LANE_GAP_MS * 2 ** level);
const emptyLane = (now: number): SavedLane => ({ nextAt: 0, cooldownUntil: 0, level: 0, gapLevel: 0, answered: 0, healFrom: 0, clean: 0, usedAt: now, routes: {} });

/** One FIFO per creator across tabs; cooling also applies to calls outside it. */
export class FanslyPacer {
  readonly ready: Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly store: PacerStore;
  private snapshot: PacerSnapshot = { v: 1, lanes: {}, seen: {}, aliases: {} };
  private readonly queues = new Map<string, Queue>();
  private syncing = Promise.resolve();
  private savedAt = 0;
  constructor(private readonly deps: PacerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.store = new PacerStore(deps.storage);
    this.ready = Promise.all([deps.session.ready, this.store.load()]).then(([, snapshot]) => { this.snapshot = snapshot; });
    void this.ready.catch(() => undefined);
  }
  private canonical(accountId: string): string {
    const session = this.deps.session.forAccount(accountId);
    if (session?.canonicalId !== null && session?.canonicalId !== undefined) this.snapshot.aliases[session.legacyId] = session.canonicalId;
    return session?.canonicalId ?? this.snapshot.aliases[accountId] ?? accountId;
  }
  /** A learned canonical id must not replace an in-flight FIFO's identity. */
  private queueKey(accountId: string): string {
    return this.deps.session.forAccount(accountId)?.legacyId ?? Object.entries(this.snapshot.aliases).find(([, canonical]) => canonical === accountId)?.[0] ?? accountId;
  }
  private lane(id: string): SavedLane { return this.snapshot.lanes[id] ??= emptyLane(this.now()); }
  private save(): Promise<void> { this.savedAt = this.now(); return this.store.save(this.snapshot); }

  /** Import P9a facts before admission, including observations queued outside its owner. */
  sync(): Promise<void> {
    const work = this.syncing.then(async () => {
      await this.ready;
      await this.deps.session.idle();
      this.store.check();
      if (this.importFacts()) await this.save();
    });
    this.syncing = work.catch(() => undefined);
    return work;
  }

  private importFacts(): boolean {
    let dirty = false;
    // /account/me can resolve an alias while a lane has a penalty. Carry it
    // forward before the dedup check (the same fact may now name the canonical id).
    for (const [id, lane] of Object.entries(this.snapshot.lanes)) {
      const canonical = this.canonical(id);
      if (canonical === id) continue;
      const target = this.snapshot.lanes[canonical];
      if (target === undefined) this.snapshot.lanes[canonical] = lane;
      else {
        for (const key of ['nextAt', 'cooldownUntil', 'level', 'gapLevel', 'healFrom', 'usedAt'] as const) target[key] = Math.max(target[key], lane[key]);
        target.clean = 0;
        for (const [key, state] of Object.entries(lane.routes)) {
          const other = target.routes[key];
          target.routes[key] = other === undefined ? state : { spacingMs: Math.max(other.spacingMs, state.spacingMs), lastStartAt: Math.max(other.lastStartAt, state.lastStartAt), badMs: Math.max(other.badMs, state.badMs), badAt: Math.max(other.badAt, state.badAt) };
        }
      }
      delete this.snapshot.lanes[id]; dirty = true;
    }
    for (const fact of this.deps.session.rateLimits()) {
      if (fact.at < this.now() - BAD_MEMORY_MS) continue;
      const id = fact.accountId === null ? '*' : this.canonical(fact.accountId);
      const lane = this.lane(id);
      const retryUntil = fact.at + Math.min(RECOVERY.retryAfterMaxMs, Math.max(0, fact.retryAfterMs ?? 0));
      const seen = this.snapshot.seen[fact.requestId];
      if (seen !== undefined) {
        // The fetch response can add Retry-After after onCompleted delivered
        // the same 429; extend the deadline without another penalty or count.
        if (retryUntil > seen.retryUntil) { lane.cooldownUntil = Math.max(lane.cooldownUntil, retryUntil); lane.healFrom = Math.max(lane.healFrom, lane.cooldownUntil); seen.retryUntil = retryUntil; dirty = true; }
        continue;
      }
      this.rest(id, lane, fact.at);
      const { key, policy } = paceFor(fact.method ?? 'GET', fact.pathname ?? '/unknown');
      const wait = Math.max(Math.min(RECOVERY.cooldownMaxMs, RECOVERY.cooldownStepMs * 2 ** Math.min(lane.level, 4)), Math.min(RECOVERY.cooldownMaxMs, lane.answered * RECOVERY.perAnswerMs));
      if (!policy.isolated || lane.level > 0) lane.gapLevel = Math.min(RECOVERY.maxLevel, lane.gapLevel + 1);
      lane.level = Math.min(RECOVERY.maxLevel, lane.level + 1);
      lane.cooldownUntil = Math.max(lane.cooldownUntil, fact.at + wait, retryUntil);
      lane.healFrom = lane.cooldownUntil; lane.clean = 0; lane.answered = 0; lane.usedAt = fact.at;
      lane.routes[key] = limited(lane.routes[key] ?? fresh(policy), policy, fact.at);
      this.snapshot.seen[fact.requestId] = { at: fact.at, retryUntil };
      this.deps.countLimit?.(fact.source);
      dirty = true;
    }
    for (const [id, seen] of Object.entries(this.snapshot.seen)) if (seen.at < this.now() - BAD_MEMORY_MS) { delete this.snapshot.seen[id]; dirty = true; }
    return dirty;
  }

  private rest(id: string, lane: SavedLane, now: number): void {
    if ((this.queues.get(this.queueKey(id))?.pending ?? 0) > 0 || Math.max(lane.usedAt + RECOVERY.idleMs, lane.cooldownUntil) >= now) return;
    const routes = lane.routes;
    Object.assign(lane, emptyLane(now));
    for (const [key, route] of Object.entries(routes)) if (route.badMs > 0 && now - route.badAt < BAD_MEMORY_MS) lane.routes[key] = rested(route, policyOf(key), now);
  }
  private heal(lane: SavedLane): void {
    if (lane.level === 0 || lane.clean < RECOVERY.healReads || this.now() - lane.healFrom < RECOVERY.healMs) return;
    lane.level--; lane.gapLevel = Math.max(0, lane.gapLevel - 1); lane.clean = 0; lane.healFrom = this.now();
    for (const [key, state] of Object.entries(lane.routes)) lane.routes[key] = healed(state, policyOf(key), this.now());
  }
  status(accountId: string): { cooldownUntil: number; intervalMs: number; level: number } {
    const lane = this.snapshot.lanes[this.canonical(accountId)];
    const global = this.snapshot.lanes['*'];
    return { cooldownUntil: Math.max(lane?.cooldownUntil ?? 0, global?.cooldownUntil ?? 0), intervalMs: gap(Math.max(lane?.gapLevel ?? 0, global?.gapLevel ?? 0)), level: lane?.level ?? 0 };
  }
  /** Synchronous last check: after custody it never queues or sleeps. */
  assertOpen(accountId: string): void {
    this.store.check();
    if (this.importFacts()) void this.save().catch(() => undefined);
    const { cooldownUntil } = this.status(accountId);
    if (cooldownUntil > this.now()) throw new FanslyApiError('CG-FAN-RATE-LIMIT', 'before-dispatch', 0, cooldownUntil);
  }
  async acquire(accountId: string, method: string, pathname: string, mode: FanslyPaceMode, signal: FanslyApiSignal): Promise<Permit> {
    checkAbort(signal);
    await abortable(this.sync(), signal);
    const id = this.canonical(accountId);
    const global = this.snapshot.lanes['*'];
    if (global !== undefined) this.rest('*', global, this.now());
    if (mode !== 'queue') { this.assertOpen(id); return { release() {}, served() {} }; }
    if (method === 'POST') this.assertOpen(id);
    const lane = this.lane(id);
    this.rest(id, lane, this.now());
    const queueId = this.queueKey(id);
    const queue = this.queues.get(queueId) ?? { tail: Promise.resolve(), pending: 0 };
    this.queues.set(queueId, queue);
    const previous = queue.tail;
    let unlock!: () => void;
    queue.tail = new Promise<void>((resolve) => { unlock = resolve; }); queue.pending++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true; queue.pending--; lane.usedAt = this.now();
      void previous.then(unlock);
      if (this.now() - this.savedAt >= RECOVERY.saveEveryMs) void this.save().catch(() => undefined);
    };
    try {
      await abortable(previous, signal);
      this.heal(lane);
      const { key, policy } = paceFor(method, pathname);
      const route = lane.routes[key] ?? fresh(policy);
      const base = Math.max(lane.nextAt, route.lastStartAt ? route.lastStartAt + route.spacingMs : 0);
      const jitter = base > this.now() ? Math.floor(this.random() * (LANE_JITTER_MS + 1)) : 0;
      for (;;) {
        await abortable(this.sync(), signal);
        if (method === 'POST') this.assertOpen(id);
        const currentRoute = lane.routes[key] ?? route;
        const due = Math.max(lane.nextAt, currentRoute.lastStartAt ? currentRoute.lastStartAt + currentRoute.spacingMs : 0) + jitter;
        const until = Math.max(due, this.status(id).cooldownUntil);
        if (until <= this.now()) break;
        await sleep(until - this.now(), signal);
      }
      checkAbort(signal);
      lane.nextAt = this.now() + this.status(id).intervalMs;
      lane.routes[key] = { ...(lane.routes[key] ?? route), lastStartAt: this.now() };
      signal.addEventListener('abort', release, { once: true });
      return {
        release: () => { signal.removeEventListener('abort', release); release(); },
        served: () => { if (method === 'GET') { lane.answered++; if (this.now() - lane.healFrom >= RECOVERY.healMs) lane.clean++; } },
      };
    } catch (error) { release(); throw error; }
  }
  async idle(): Promise<void> { await this.sync(); await this.save(); }
}
