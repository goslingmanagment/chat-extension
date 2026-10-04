// TL-013: the AI quota of each page as the last generation's `meta`
// reported it, and the day boundary (00:00 UTC). A 429 `quota_denied`
// marks the page spent until that boundary; the hub stays the judge — this
// is a display snapshot, never a local refusal.

import { type AiQuotaSnapshot, type MetaFrame } from '@cg/contracts';
import { nextUtcMidnight } from '@cg/core/domain';

export class QuotaTracker {
  private readonly byPage = new Map<number, AiQuotaSnapshot>();
  private readonly listeners = new Set<(quota: AiQuotaSnapshot) => void>();

  constructor(private readonly now: () => number) {}

  onChange(listener: (quota: AiQuotaSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The snapshot of a page, or null when none or when its UTC day is over. */
  get(pageId: number): AiQuotaSnapshot | null {
    const quota = this.byPage.get(pageId);
    if (quota === undefined) return null;
    if (this.now() >= Date.parse(quota.resetsAt)) {
      this.byPage.delete(pageId);
      return null;
    }
    return quota;
  }

  fromMeta(pageId: number, meta: MetaFrame): void {
    this.set(pageId, meta.quota.remainingRequestsToday, meta.quota.remainingMicroUsdToday);
  }

  /** 429 quota_denied: nothing left today. */
  denied(pageId: number): void {
    this.set(pageId, 0, this.get(pageId)?.remainingMicroUsdToday ?? null);
  }

  clear(): void {
    this.byPage.clear();
  }

  private set(pageId: number, requests: number | null, microUsd: number | null): void {
    const now = this.now();
    const quota: AiQuotaSnapshot = {
      pageId,
      remainingRequestsToday: requests,
      remainingMicroUsdToday: microUsd,
      resetsAt: new Date(nextUtcMidnight(now)).toISOString(),
      observedAt: new Date(now).toISOString(),
    };
    this.byPage.set(pageId, quota);
    for (const listener of [...this.listeners]) listener(quota);
  }
}
