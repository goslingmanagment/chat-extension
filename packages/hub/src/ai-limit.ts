// `ai-limit-v1`: the person's own daily AI limit (the owner's; Moscow day, all
// pages) as the hub last reported it — its `clientAiLimit`, a generation's
// `meta` (`quota.personal`, the spend before that call) or a 429 with reason
// `personal_daily_limit`. A display snapshot for the dock, the popup and the
// alerts; the hub stays the judge and refuses by itself.

import { type AiLimitReport, type AiLimitSnapshot, type MetaFrame } from '@cg/contracts';
import { nextMskMidnight } from '@cg/core/domain';

type LimitFields = Pick<AiLimitSnapshot, 'dailyLimitMicroUsd' | 'todayMicroUsd' | 'remainingMicroUsd' | 'resetsAt'>;

export class AiLimitTracker {
  private snapshot: AiLimitSnapshot | null = null;
  private readonly listeners = new Set<(limit: AiLimitSnapshot) => void>();

  constructor(private readonly now: () => number) {}

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
      resetsAt: report.resetsAt,
    });
  }

  /** A hub without `ai-limit-v1` sends no `personal`: nothing changes then. */
  fromMeta(meta: MetaFrame): void {
    const personal = meta.quota.personal;
    if (personal === undefined) return;
    if (personal === null) {
      this.set({ dailyLimitMicroUsd: null, todayMicroUsd: this.get()?.todayMicroUsd ?? 0, remainingMicroUsd: null, resetsAt: new Date(nextMskMidnight(this.now())).toISOString() });
      return;
    }
    // The meta's spend is the hub's before this call; a newer answer of the same day may already know more.
    const known = this.get();
    const today = known !== null && known.resetsAt === personal.resetsAt ? Math.max(known.todayMicroUsd, personal.todayMicroUsd) : personal.todayMicroUsd;
    this.set({
      dailyLimitMicroUsd: personal.dailyLimitMicroUsd,
      todayMicroUsd: today,
      remainingMicroUsd: Math.max(personal.dailyLimitMicroUsd - today, 0),
      resetsAt: personal.resetsAt,
    });
  }

  /** 429 `personal_daily_limit`: nothing left until 00:00 МСК. False — no limit known yet (ask the hub). */
  denied(): boolean {
    const known = this.get();
    if (known === null || known.dailyLimitMicroUsd === null) return false;
    this.set({ ...known, todayMicroUsd: Math.max(known.todayMicroUsd, known.dailyLimitMicroUsd), remainingMicroUsd: 0 });
    return true;
  }

  clear(): void {
    this.snapshot = null;
  }

  private set(fields: LimitFields): void {
    const limit: AiLimitSnapshot = { ...fields, observedAt: new Date(this.now()).toISOString() };
    this.snapshot = limit;
    for (const listener of [...this.listeners]) listener(limit);
  }
}
