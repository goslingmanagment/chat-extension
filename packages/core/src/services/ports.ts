// Ports the R18 services take from the background's composition root
// (architecture.md §4: core has no timers, no storage and no browser.*).

/** The background's clock and one-shot timers (setTimeout under the hood). */
export interface Scheduler {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/** One `storage.local` / `storage.session` key as a port: read whatever is there, write a whole value. */
export interface KeyValuePort {
  load(): Promise<unknown>;
  save(value: unknown): Promise<void>;
}
