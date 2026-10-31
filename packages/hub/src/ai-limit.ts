// `ai-limit-v1`: the person's own daily AI limit (the owner's; Moscow day, all
// pages) and the team's shared pool past it as the hub last reported them — its `clientAiLimit`, a generation's
// `meta` (`quota.personal`, the spend before that call) or a 429 with reason
// `personal_daily_limit`. A display snapshot for the dock, the popup and the
// alerts; the hub stays the judge and refuses by itself.

import { AiLimitSnapshotSchema, type AiLimitReport, type AiLimitSnapshot, type MetaFrame } from '@cg/contracts';
import { nextMskMidnight } from '@cg/core/domain';
import { type HubKeyValueStore } from './ports';

/** `storage.session` key of the last snapshot: an event page woken by the popup answers at once, not after the hub. */
export const AI_LIMIT_SESSION_KEY = 'cache.aiLimit';

type LimitFields = Pick<AiLimitSnapshot, 'dailyLimitMicroUsd' | 'todayMicroUsd' | 'remainingMicroUsd' | 'poolMicroUsd' | 'poolRemainingMicroUsd' | 'resetsAt'>;

export class AiLimitTracker {
  private snapshot: AiLimitSnapshot | null = null;
  private readonly listeners = new Set<(limit: AiLimitSnapshot) => void>();
  /** Bumped by `clear`: a read of storage.session started before it is not this sign-in's. */
  private epoch = 0;
  private restoring: Promise<void> | null = null;

  constructor(
    private readonly now: () => number,
    private readonly session: HubKeyValueStore | null = null,
  ) {}

  /**
   * After an idle unload of the event page: the snapshot the previous background kept in storage.session, unless
   * this one already knows one or its Moscow day is over. Read once; never fails.
   */
  restore(): Promise<void> {
    this.restoring ??= this.readSession();
    return this.restoring;
  }

  private async readSession(): Promise<void> {
    if (this.session === null || this.snapshot !== null) return;
    const epoch = this.epoch;
    const read = await this.session.get([AI_LIMIT_SESSION_KEY]).catch(() => null);
    if (read === null || !read.ok || epoch !== this.epoch || this.snapshot !== null) return;
    const parsed = AiLimitSnapshotSchema.safeParse(read.value[AI_LIMIT_SESSION_KEY]);
    if (parsed.success && this.now() < Date.parse(parsed.data.resetsAt)) this.snapshot = parsed.data;
  }

  onChange(listener: (limit: AiLimitSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The last snapshot, or null when none is known or its Moscow day is over (ask the hub again). */
  get(): AiLimitSnapshot | null {
    const limit = this.snapshot;
    if (limit === null) return null;
    if (this.now() >= Date.parse(limit.resetsAt)) {
      this.snapshot = null;
      return null;
    }
    return limit;
  }

  fromReport(report: AiLimitReport): void {
    this.set({
      dailyLimitMicroUsd: report.dailyLimitMicroUsd,
      todayMicroUsd: report.todayMicroUsd,
      remainingMicroUsd: report.remainingMicroUsd,
      poolMicroUsd: report.poolMicroUsd ?? null,
      poolRemainingMicroUsd: report.poolRemainingMicroUsd ?? null,
      resetsAt: report.resetsAt,
    });
  }

  /** A hub without `ai-limit-v1` sends no `personal`: nothing changes then. */
  fromMeta(meta: MetaFrame): void {
    const personal = meta.quota.personal;
    if (personal === undefined) return;
    if (personal === null) {
      this.set({
        dailyLimitMicroUsd: null,
        todayMicroUsd: this.get()?.todayMicroUsd ?? 0,
        remainingMicroUsd: null,
        poolMicroUsd: null,
        poolRemainingMicroUsd: null,
        resetsAt: new Date(nextMskMidnight(this.now())).toISOString(),
      });
      return;
    }
    // The meta's spend is the hub's before this call; a newer answer of the same day may already know more.
    const known = this.get();
    const sameDay = known !== null && known.resetsAt === personal.resetsAt;
    const today = sameDay ? Math.max(known.todayMicroUsd, personal.todayMicroUsd) : personal.todayMicroUsd;
    // A frame without the pool (a hub before it) keeps what the last answer of the day said of the pool.
    const poolLeft = personal.poolRemainingMicroUsd ?? (sameDay ? known.poolRemainingMicroUsd : null);
    this.set({
      dailyLimitMicroUsd: personal.dailyLimitMicroUsd,
      todayMicroUsd: today,
      remainingMicroUsd: Math.max(personal.dailyLimitMicroUsd - today, 0),
      poolMicroUsd: personal.poolMicroUsd ?? (sameDay ? known.poolMicroUsd : null),
      poolRemainingMicroUsd: sameDay && poolLeft !== null && known.poolRemainingMicroUsd !== null ? Math.min(poolLeft, known.poolRemainingMicroUsd) : poolLeft,
      resetsAt: personal.resetsAt,
    });
  }

  /** 429 `personal_daily_limit`: the own limit and the pool are spent until 00:00 МСК. False — no limit known yet (ask the hub). */
  denied(): boolean {
    const known = this.get();
    if (known === null || known.dailyLimitMicroUsd === null) return false;
    this.set({
      ...known,
      todayMicroUsd: Math.max(known.todayMicroUsd, known.dailyLimitMicroUsd),
      remainingMicroUsd: 0,
      poolRemainingMicroUsd: known.poolRemainingMicroUsd === null ? null : 0,
    });
    return true;
  }

  /** Sign-in transitions and «Очистить локальные данные»: nothing of the previous person survives, here or stored. */
  clear(): void {
    this.snapshot = null;
    this.epoch += 1;
    if (this.session !== null) void this.session.remove([AI_LIMIT_SESSION_KEY]).catch(() => undefined);
  }

  private set(fields: LimitFields): void {
    const limit: AiLimitSnapshot = { ...fields, observedAt: new Date(this.now()).toISOString() };
    this.snapshot = limit;
    this.epoch += 1;
    if (this.session !== null) void this.session.set({ [AI_LIMIT_SESSION_KEY]: limit }).catch(() => undefined);
    for (const listener of [...this.listeners]) listener(limit);
  }
}
