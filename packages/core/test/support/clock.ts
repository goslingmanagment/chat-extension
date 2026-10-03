// Test doubles of the service ports: a manual clock whose timers fire only
// when the test advances it, a map-backed store that can be told to fail,
// an event recorder and deterministic ids. Only @cg/contracts and core.

import { type TabEventPayload, type TabEventType } from '@cg/contracts';
import { type Clock, type IdSource, type KeyValueStore, type LogEntry, type LogSink, type TabEventSink, type TimerHandle } from '@cg/core/services';

/** Lets every pending promise chain settle (microtasks and one macrotask turn). */
export async function settle(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

export class FakeClock implements Clock {
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;

  constructor(public t: number) {}

  now(): number {
    return this.t;
  }

  setTimer(ms: number, fn: () => void): TimerHandle {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimer(handle: TimerHandle): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward, firing due timers in order and letting promises settle after each. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await settle();
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer.id !== due.id);
      this.t = due.at;
      due.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, unknown>();
  failWrites = false;
  failReads = false;
  writes = 0;

  get(key: string): Promise<unknown> {
    if (this.failReads) return Promise.reject(new Error('read failed'));
    const value = this.data.get(key);
    return Promise.resolve(value === undefined ? undefined : structuredClone(value));
  }

  set(key: string, value: unknown): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('write failed'));
    this.writes += 1;
    this.data.set(key, structuredClone(value));
    return Promise.resolve();
  }
}

export interface RecordedEvent {
  readonly to: string | null;
  readonly type: TabEventType;
  readonly payload: unknown;
}

export class EventLog implements TabEventSink {
  readonly events: RecordedEvent[] = [];

  emit<T extends TabEventType>(to: string | null, type: T, payload: TabEventPayload<T>): void {
    this.events.push({ to, type, payload });
  }

  of<T extends TabEventType>(type: T): { readonly to: string | null; readonly payload: TabEventPayload<T> }[] {
    return this.events.filter((event) => event.type === type).map((event) => ({ to: event.to, payload: event.payload as TabEventPayload<T> }));
  }

  clear(): void {
    this.events.length = 0;
  }
}

export class LogRecorder implements LogSink {
  readonly entries: LogEntry[] = [];

  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

/** UUIDs counting up from `start`, tokens `tok_…` counting up. */
export function sequentialIds(start: number, prefix = '00000000-0000-4000-8000-'): IdSource & { readonly issued: string[] } {
  let n = start;
  let t = 0;
  const issued: string[] = [];
  return {
    issued,
    uuid: () => {
      const id = `${prefix}${(n++).toString(16).padStart(12, '0')}`;
      issued.push(id);
      return id;
    },
    token: () => `tok_${(t++).toString().padStart(20, '0')}`,
  };
}
