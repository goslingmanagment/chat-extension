// Events already decided (architecture.md §9.8 «Дубли»; SN-010): a sound for
// one event rings at most once in the whole extension, whichever tab or
// source reported it. Keys are `(platform, account, event id)`; an entry
// lives 10 minutes, the newest 2000 are kept. The state is plain data so the
// one arbiter keeps it in storage.session across an event-page unload.

export const SEEN_TTL_MS = 10 * 60_000;
export const SEEN_MAX = 2000;

export type SeenEntry = readonly [key: string, expiresAt: number];

export function seenKey(platform: string, accountId: string, eventId: string): string {
  return `${platform}:${accountId}:${eventId}`;
}

export class SeenEvents {
  /** Insertion order = age: the first entry is the oldest. */
  private readonly expiries = new Map<string, number>();

  constructor(
    private readonly ttlMs: number = SEEN_TTL_MS,
    private readonly max: number = SEEN_MAX,
  ) {}

  has(key: string, now: number): boolean {
    const expiry = this.expiries.get(key);
    if (expiry === undefined) return false;
    if (expiry > now) return true;
    this.expiries.delete(key);
    return false;
  }

  /** Marks the event decided for the next 10 minutes; the oldest entries leave beyond the cap. */
  consume(key: string, now: number): void {
    this.expiries.delete(key);
    this.expiries.set(key, now + this.ttlMs);
    while (this.expiries.size > this.max) {
      const oldest = this.expiries.keys().next();
      if (oldest.done === true) break;
      this.expiries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.expiries.size;
  }

  /** Live entries, oldest first, for storage.session. */
  snapshot(now: number): SeenEntry[] {
    const out: SeenEntry[] = [];
    for (const [key, expiry] of this.expiries) if (expiry > now) out.push([key, expiry]);
    return out;
  }

  /** Reads a stored snapshot; anything malformed or expired is skipped, never trusted. */
  restore(stored: unknown, now: number): number {
    if (!Array.isArray(stored)) return 0;
    let kept = 0;
    for (const entry of stored.slice(-this.max)) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'number') continue;
      const key = entry[0];
      const expiry = entry[1];
      // An expiry further away than the TTL was not written by this code.
      if (key.length === 0 || key.length > 256 || !(expiry > now) || expiry > now + this.ttlMs) continue;
      this.expiries.delete(key);
      this.expiries.set(key, expiry);
      kept += 1;
    }
    return kept;
  }
}
