// The local AI spend journal of this browser (architecture.md §9.3, Б4;
// DB-018, DB-022, PU-016): every `usage` frame is counted by feature and
// local day — numbers only — and kept in storage.session so an event-page
// restart does not lose the day. Shown only in debug mode, labelled
// «только этот браузер», and replaced by the hub's own report (H-15,
// `usage.get`) where the hub has it; never presented as the full spend.
// Cleared on sign-out.

import { type FeatureId } from '@cg/contracts/features';

import { LocalSpendJournal, type SpendReport, type UsageNumbers } from '../../domain/debug';
import { type KeyValuePort } from '../ports';

export class SpendService {
  private readonly journal = new LocalSpendJournal();
  private saveQueued = false;
  private saving: Promise<void> = Promise.resolve();
  private failures = 0;

  constructor(private readonly store: KeyValuePort) {}

  /** Restores the journal of this browser session; never rejects. */
  async start(): Promise<void> {
    try {
      this.journal.restore(await this.store.load());
    } catch {
      this.failures += 1;
    }
  }

  recordUsage(feature: FeatureId, usage: UsageNumbers, at: number): void {
    this.journal.recordUsage(feature, usage, at);
    this.persist();
  }

  recordInsert(feature: FeatureId, at: number): void {
    this.journal.recordInsert(feature, at);
    this.persist();
  }

  /** `days` local days ending today, source `local-browser`. */
  report(now: number, days = 1): SpendReport {
    return this.journal.report(now, days);
  }

  /** «AI сегодня $» in the popup, debug only (PU-016). */
  todayCostMicroUsd(now: number): number {
    return this.journal.todayCostMicroUsd(now);
  }

  /** Sign-out: the person's numbers go. */
  clear(): void {
    this.journal.clear();
    this.persist();
  }

  get saveFailures(): number {
    return this.failures;
  }

  /** Resolves when the last save finished. */
  saved(): Promise<void> {
    return this.saving;
  }

  private persist(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    this.saving = this.saving.then(async () => {
      this.saveQueued = false;
      try {
        await this.store.save(this.journal.snapshot());
      } catch {
        this.failures += 1;
      }
    });
  }
}
