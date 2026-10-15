// Local 24h freshness, independent of consent. Only numbers, host/build/feature;
// no operation, account or message ids. At most 128 groups × 24 hour buckets.
import { FRESHNESS_COUNTS, FreshnessDaySchema, type FreshnessDay } from '@cg/contracts/diagnostics';
import type { FeatureId } from '@cg/contracts/features';
import type { HostKind } from '@cg/contracts/hosts';
import { coverageCheckVerdict, type CoverageProof, type ServedContext } from '@cg/contracts/ops';
import type { KeyValuePort } from '../ports';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Row = FreshnessDay['rows'][number];
type Counts = Row['counts'];
const empty = (): Counts => ({ generations: 0, marked: 0, unknown: 0, rejectedTail: 0, truncated: 0, nonLiveUnion: 0 });
const keyOf = (r: Pick<Row, 'host' | 'build' | 'feature'>): string => JSON.stringify([r.host, r.build, r.feature]);

export function freshnessCounts(proof: CoverageProof | undefined, served: ServedContext | null | undefined): Counts {
  const truncated = proof?.kind === 'tab-snapshot' && proof.truncated;
  const hasTail = proof?.kind === 'tab-snapshot' && (proof.tail?.length ?? 0) > 0;
  const tailMissing = hasTail && (served?.live.status !== 'served' || (served?.live.rejected ?? 0) > 0);
  const unknown = proof === undefined || proof.completeness === 'unknown';
  const marked = unknown || truncated || tailMissing || proof === undefined || coverageCheckVerdict(proof, served?.coverageCheck) !== 'fresh';
  return { generations: 1, marked: Number(marked), unknown: Number(unknown), rejectedTail: Number(served?.live.status === 'rejected' || (served?.live.rejected ?? 0) > 0), truncated: Number(truncated), nonLiveUnion: Number(served?.source !== 'live_union') };
}

export class FreshnessDayStore {
  private buckets = new Map<number, Map<string, Row>>();
  private since: number;
  private dropped = 0;
  private persisted = false;
  private saving: Promise<void> = Promise.resolve();
  constructor(private readonly now: () => number, private readonly store?: KeyValuePort) { this.since = now(); }

  async start(): Promise<void> {
    if (this.store === undefined) return;
    const raw: unknown = await this.store.load().catch(() => null);
    if (!Array.isArray(raw) || raw.length > 25) return;
    for (const item of raw) {
      const parsed = FreshnessDaySchema.safeParse(item);
      if (!parsed.success) continue;
      const day = parsed.data;
      if (day.since % HOUR !== 0 || day.since > this.now() || day.since < this.now() - DAY) continue;
      const known = new Set([...this.buckets.values()].flatMap((bucket) => [...bucket.keys()]));
      const rows = day.rows.filter((row) => { const key = keyOf(row); if (!known.has(key) && known.size >= 128) { this.dropped++; return false; } known.add(key); return true; });
      this.buckets.set(day.since, new Map(rows.map((row) => [keyOf(row), row])));
      this.since = Math.min(this.since, day.since);
      this.dropped = Math.max(this.dropped, day.dropped);
    }
    this.prune();
    this.persisted = true;
  }

  record(host: HostKind, build: string | null, feature: FeatureId, counts: Counts): void {
    this.prune();
    const at = Math.floor(this.now() / HOUR) * HOUR;
    const groups = new Set([...this.buckets.values()].flatMap((bucket) => [...bucket.keys()]));
    const row = { host, build: build?.slice(0, 80) ?? null, feature, counts };
    const key = keyOf(row);
    if (!groups.has(key) && groups.size >= 128) { this.dropped++; this.save(); return; }
    const bucket = this.buckets.get(at) ?? new Map<string, Row>();
    const previous = bucket.get(key)?.counts ?? empty();
    const next = empty();
    for (const name of FRESHNESS_COUNTS) next[name] = Math.min(1_000_000_000, previous[name] + counts[name]);
    bucket.set(key, { ...row, counts: next });
    this.buckets.set(at, bucket);
    this.save();
  }

  snapshot(): FreshnessDay {
    this.prune();
    const rows = new Map<string, Row>();
    for (const bucket of this.buckets.values()) for (const [key, row] of bucket) {
      const previous = rows.get(key)?.counts ?? empty();
      const counts = empty();
      for (const name of FRESHNESS_COUNTS) counts[name] = previous[name] + row.counts[name];
      rows.set(key, { ...row, counts });
    }
    return { since: Math.max(this.since, Math.ceil((this.now() - DAY) / HOUR) * HOUR), until: this.now(), resolutionMs: HOUR, persisted: this.persisted, dropped: this.dropped, rows: [...rows.values()] };
  }
  idle(): Promise<void> { return this.saving; }
  private prune(): void {
    const cutoff = this.now() - DAY;
    for (const at of this.buckets.keys()) if (at < cutoff || at > this.now()) this.buckets.delete(at);
  }
  private save(): void {
    if (this.store === undefined) return;
    this.persisted = false;
    // Serialized writes; queued tasks read the latest bounded state, not a retained copy per generation.
    this.saving = this.saving.then(async () => {
      this.prune();
      await this.store?.save([...this.buckets].map(([since, rows]) => ({ since, until: this.now(), resolutionMs: HOUR, persisted: true, dropped: this.dropped, rows: [...rows.values()] })));
      this.persisted = true;
    }).catch(() => { this.persisted = false; });
  }
}
