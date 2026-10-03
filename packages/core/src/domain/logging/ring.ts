// In-memory ring of the last records of one context (LG-006): 1000 by
// default. The oldest record is overwritten; how many were is a counter the
// diagnostics show.

import { LOG_LIMITS } from '@cg/contracts/limits';

export class Ring<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private length = 0;
  private overwrittenCount = 0;

  constructor(readonly capacity: number = LOG_LIMITS.ringSize) {
    this.items = new Array<T | undefined>(Math.max(1, Math.floor(capacity)));
  }

  push(item: T): void {
    const size = this.items.length;
    if (this.length < size) {
      this.items[(this.start + this.length) % size] = item;
      this.length += 1;
      return;
    }
    this.items[this.start] = item;
    this.start = (this.start + 1) % size;
    this.overwrittenCount += 1;
  }

  /** Oldest first. */
  toArray(): T[] {
    const out: T[] = [];
    const size = this.items.length;
    for (let i = 0; i < this.length; i += 1) {
      const item = this.items[(this.start + i) % size];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  /** The newest `count`, oldest first. */
  tail(count: number): T[] {
    const all = this.toArray();
    return count >= all.length ? all : all.slice(all.length - Math.max(0, count));
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.length = 0;
  }

  get size(): number {
    return this.length;
  }

  /** Records pushed out by newer ones since the start. */
  get overwritten(): number {
    return this.overwrittenCount;
  }
}
