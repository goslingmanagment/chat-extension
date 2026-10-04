// A value that changes, as MountDeps takes it (the scheme, the geometry):
// the latest value and who wants to hear the next one. Listeners hear only a
// value that really differs.

import type { ValueSignal } from '@cg/contracts/vm';

export class Value<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(private current: T) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
