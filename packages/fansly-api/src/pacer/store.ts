import * as z from 'zod/mini';
import type { PacerStorage } from '../ports';
import { FanslyApiError } from '../errors';

const time = z.number().check(z.minimum(0), z.maximum(Number.MAX_SAFE_INTEGER));
const route = z.object({ spacingMs: time, lastStartAt: time, badMs: time, badAt: time });
export const LaneSchema = z.object({
  nextAt: time, cooldownUntil: time, level: time, gapLevel: time, answered: time,
  healFrom: time, clean: time, usedAt: time, routes: z.record(z.string(), route),
});
export type SavedLane = z.infer<typeof LaneSchema>;
const SnapshotSchema = z.object({
  v: z.literal(1), lanes: z.record(z.string(), LaneSchema),
  seen: z.record(z.string(), z.object({ at: time, retryUntil: time })),
  aliases: z.optional(z.record(z.string(), z.string())),
});
export type PacerSnapshot = z.infer<typeof SnapshotSchema> & { aliases: Record<string, string> };
export const PACER_KEY = 'fansly.pacer.v1';

/** Atomic lane + dedup checkpoint. A failed restore/write closes admission. */
export class PacerStore {
  private writes = Promise.resolve();
  private failed = false;
  constructor(private readonly storage: PacerStorage) {}
  async load(): Promise<PacerSnapshot> {
    try {
      const value = await this.storage.get(PACER_KEY);
      if (value === undefined) return { v: 1, lanes: {}, seen: {}, aliases: {} };
      const saved = SnapshotSchema.parse(value);
      return { ...saved, aliases: saved.aliases ?? {} };
    } catch { this.failed = true; throw new FanslyApiError('CG-FAN-SESSION', 'before-dispatch'); }
  }
  save(snapshot: PacerSnapshot): Promise<void> {
    this.check();
    const copy = structuredClone(snapshot);
    this.writes = this.writes.then(() => this.storage.set(PACER_KEY, copy)).catch(() => {
      this.failed = true;
      throw new FanslyApiError('CG-FAN-SESSION', 'before-dispatch');
    });
    void this.writes.catch(() => undefined);
    return this.writes;
  }
  check(): void { if (this.failed) throw new FanslyApiError('CG-FAN-SESSION', 'before-dispatch'); }
}
