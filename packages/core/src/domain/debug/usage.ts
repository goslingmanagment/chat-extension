// Usage and AI money for debug only (architecture.md §9.3, Б4; DB-017,
// DB-018, DB-022, PU-016). The `usage` frame is always logged (numbers only)
// and shown only in debug mode: the cost line of a result, and the local
// spend journal by feature for today and 7 days. Until the hub's own report
// (H-15) answers, the journal is built from the usage frames this browser
// saw and says so — «только этот браузер»; its sum is never presented as the
// person's full daily spend. Hub credits are never shown to anyone.

import { FEATURE_IDS, type FeatureId } from '@cg/contracts/features';
import { type HubFrame } from '@cg/contracts/hub';
import { type OpDebugView } from '@cg/contracts/ops';

import { type Translator } from '../i18n';
import { localDayKey } from '../logging/counters';

export type UsageFrame = Extract<HubFrame, { readonly type: 'usage' }>;
export type UsageNumbers = UsageFrame['usage'];

/** OpDebugView.usage from the frame; null when no usage frame came (unknown, never zeros — DB-028). */
export function usageOf(frame: UsageFrame | null): OpDebugView['usage'] {
  if (frame === null) return null;
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costMicroUsd } = frame.usage;
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costMicroUsd };
}

/** `$0.0143`: micro-USD with four decimals, the debug notation (not the money of fans). */
export function formatMicroUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

export interface CostLineFacts {
  readonly usage: OpDebugView['usage'];
  readonly totalMs: number | null;
  readonly model: string | null;
}

/**
 * DB-017: «in 3 412 tok • out 286 tok • cache r 3 000 / w 0 • $0.0143 • 3,8 с •
 * claude-sonnet». Technical, not translated except the number format and the
 * seconds; unknown parts are left out. Null when nothing is known.
 */
export function formatCostLine(facts: CostLineFacts, t: Translator): string | null {
  const number = new Intl.NumberFormat(t.locale, { maximumFractionDigits: 0 });
  const tokens = (n: number | null): string | null => (n === null ? null : `${number.format(n)} tok`);
  const parts: string[] = [];
  const usage = facts.usage;
  if (usage !== null) {
    const input = tokens(usage.inputTokens);
    const output = tokens(usage.outputTokens);
    if (input !== null) parts.push(`in ${input}`);
    if (output !== null) parts.push(`out ${output}`);
    const read = usage.cacheReadTokens ?? 0;
    const write = usage.cacheWriteTokens ?? 0;
    if (read > 0 || write > 0) parts.push(`cache r ${number.format(read)} / w ${number.format(write)}`);
    if (usage.costMicroUsd !== null) parts.push(formatMicroUsd(usage.costMicroUsd));
  }
  if (facts.totalMs !== null && Number.isFinite(facts.totalMs)) {
    const seconds = new Intl.NumberFormat(t.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(facts.totalMs / 1000);
    parts.push(t.text('common.seconds', { n: seconds }));
  }
  if (facts.model !== null && facts.model.length > 0) parts.push(facts.model);
  return parts.length === 0 ? null : parts.join(' • ');
}

// ── Local spend journal (DB-022, PU-016) ───────────────────────────────────

export interface SpendTotals {
  readonly runs: number;
  readonly inserts: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costMicroUsd: number;
  /** Some cost was approximate (the hub said so). */
  readonly approximate: boolean;
  /** Cache reads / all input; null with no input. */
  readonly cacheShare: number | null;
}

export interface SpendReport {
  /** The page labels it «только этот браузер». */
  readonly source: 'local-browser';
  readonly fromDay: string;
  readonly toDay: string;
  readonly total: SpendTotals;
  readonly byFeature: readonly ({ readonly feature: string } & SpendTotals)[];
}

interface MutableTotals {
  runs: number;
  inserts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  approximate: boolean;
}

const emptyTotals = (): MutableTotals => ({ runs: 0, inserts: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, approximate: false });

function finish(totals: MutableTotals): SpendTotals {
  const input = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return { ...totals, cacheShare: input === 0 ? null : totals.cacheReadTokens / input };
}

function add(into: MutableTotals, from: Readonly<MutableTotals>): void {
  into.runs += from.runs;
  into.inserts += from.inserts;
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.cacheReadTokens += from.cacheReadTokens;
  into.cacheWriteTokens += from.cacheWriteTokens;
  into.costMicroUsd += from.costMicroUsd;
  into.approximate ||= from.approximate;
}

const FEATURES: readonly FeatureId[] = FEATURE_IDS;

function isFeature(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

/** Days kept: today and the 7 before it. */
export const SPEND_DAYS_KEPT = 8;

export class LocalSpendJournal {
  /** day → feature → totals. */
  private readonly days = new Map<string, Map<string, MutableTotals>>();

  private bucket(feature: string, at: number): MutableTotals {
    const day = localDayKey(at);
    let byFeature = this.days.get(day);
    if (byFeature === undefined) {
      byFeature = new Map();
      this.days.set(day, byFeature);
      const sorted = [...this.days.keys()].sort();
      for (const old of sorted.slice(0, Math.max(0, sorted.length - SPEND_DAYS_KEPT))) this.days.delete(old);
    }
    let totals = byFeature.get(feature);
    if (totals === undefined) {
      totals = emptyTotals();
      byFeature.set(feature, totals);
    }
    return totals;
  }

  /** One generation's `usage` frame. */
  recordUsage(feature: string, usage: UsageNumbers, at: number): void {
    const totals = this.bucket(feature, at);
    totals.runs += 1;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheReadTokens += usage.cacheReadTokens;
    totals.cacheWriteTokens += usage.cacheWriteTokens;
    totals.costMicroUsd += usage.costMicroUsd;
    totals.approximate ||= usage.costApproximate;
  }

  /** An applied insert of a part of this feature. */
  recordInsert(feature: FeatureId, at: number): void {
    this.bucket(feature, at).inserts += 1;
  }

  /** `days` local days ending today (1 = today, 7 = the week). */
  report(now: number, days = 1): SpendReport {
    const span = Math.max(1, Math.min(SPEND_DAYS_KEPT, Math.floor(days)));
    const wanted: string[] = [];
    for (let i = span - 1; i >= 0; i -= 1) wanted.push(localDayKey(now - i * 86_400_000));
    const total = emptyTotals();
    const byFeature = new Map<string, MutableTotals>();
    for (const day of new Set(wanted)) {
      for (const [feature, totals] of this.days.get(day) ?? []) {
        add(total, totals);
        const into = byFeature.get(feature) ?? emptyTotals();
        add(into, totals);
        byFeature.set(feature, into);
      }
    }
    return {
      source: 'local-browser',
      fromDay: wanted[0] ?? localDayKey(now),
      toDay: wanted.at(-1) ?? localDayKey(now),
      total: finish(total),
      byFeature: [...new Set([...FEATURES, ...byFeature.keys()])].flatMap((feature) => {
        const totals = byFeature.get(feature);
        return totals === undefined ? [] : [{ feature, ...finish(totals) }];
      }),
    };
  }

  /** «AI сегодня $» of the popup in debug mode (PU-016). */
  todayCostMicroUsd(now: number): number {
    return this.report(now, 1).total.costMicroUsd;
  }

  clear(): void {
    this.days.clear();
  }

  /** Plain JSON for storage.session (survives an event-page restart). */
  snapshot(): Record<string, Record<string, MutableTotals>> {
    const out: Record<string, Record<string, MutableTotals>> = {};
    for (const [day, byFeature] of this.days) out[day] = Object.fromEntries([...byFeature].map(([feature, totals]) => [feature, { ...totals }]));
    return out;
  }

  /** Restores a snapshot; anything malformed is skipped. */
  restore(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    for (const [day, byFeature] of Object.entries(value as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || byFeature === null || typeof byFeature !== 'object') continue;
      for (const [feature, raw] of Object.entries(byFeature as Record<string, unknown>)) {
        if (!isFeature(feature) || raw === null || typeof raw !== 'object') continue;
        const record = raw as Record<string, unknown>;
        const count = (key: keyof MutableTotals): number => {
          const v = record[key];
          return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
        };
        const totals = emptyTotals();
        totals.runs = count('runs');
        totals.inserts = count('inserts');
        totals.inputTokens = count('inputTokens');
        totals.outputTokens = count('outputTokens');
        totals.cacheReadTokens = count('cacheReadTokens');
        totals.cacheWriteTokens = count('cacheWriteTokens');
        totals.costMicroUsd = count('costMicroUsd');
        totals.approximate = record['approximate'] === true;
        let days = this.days.get(day);
        if (days === undefined) {
          days = new Map();
          this.days.set(day, days);
        }
        days.set(feature, totals);
      }
    }
    const sorted = [...this.days.keys()].sort();
    for (const old of sorted.slice(0, Math.max(0, sorted.length - SPEND_DAYS_KEPT))) this.days.delete(old);
  }
}
