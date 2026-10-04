// Ports of the background services (architecture.md §4: core has no
// browser.*, no timers of its own, no storage, no network). The composition
// root of the background (R00) wires them to @cg/platform and @cg/hub; the
// tests wire them to a fake clock, a map and the fake hub.

import { type AbortSignalLike } from '@cg/contracts/hub';
import { type LogRecord } from '@cg/contracts/logs';
import { type TabEventPayload, type TabEventType } from '@cg/contracts/tab-messages';

export type TimerHandle = number;

/** Time and timers. `now()` is epoch ms. */
export interface Clock {
  now(): number;
  setTimer(ms: number, fn: () => void): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

/** A key-value area (storage.session for operations, storage.local for the send journal). */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Fresh ids: RFC 4122 v4 UUIDs, and random action tokens (ACTION_TOKEN_PATTERN). */
export interface IdSource {
  uuid(): string;
  token(): string;
}

/** Events from the background to tabs and pages; `to: null` — every connected tab and page. */
export interface TabEventSink {
  emit<T extends TabEventType>(to: string | null, type: T, payload: TabEventPayload<T>): void;
}

/** A log record without `ts`/`seq` (the logger adds them). Never conversation text, drafts, prompts or model output. */
export type LogEntry = Omit<LogRecord, 'ts' | 'seq'>;

export interface LogSink {
  write(entry: LogEntry): void;
}

export const NO_LOG: LogSink = { write: () => undefined };

/** A one-shot abort signal (the hub facade's AbortSignalLike) without DOM types; it is its own signal. */
export class AbortSwitch implements AbortSignalLike {
  private flag = false;
  private listeners: (() => void)[] = [];

  get aborted(): boolean {
    return this.flag;
  }

  get signal(): AbortSignalLike {
    return this;
  }

  addEventListener(_type: 'abort', listener: () => void): void {
    if (this.flag) listener();
    else this.listeners.push(listener);
  }

  abort(): void {
    if (this.flag) return;
    this.flag = true;
    const listeners = this.listeners;
    this.listeners = [];
    for (const listener of listeners) listener();
  }
}

/** Serializes async writes: each runs after the previous one settled (one writer per key, BG-004). */
export class WriteQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(write: () => Promise<T>): Promise<T> {
    const next = this.tail.then(write, write);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Resolves when every write queued so far settled. */
  idle(): Promise<void> {
    return this.tail.then(() => undefined);
  }
}

// Ports the R18 services (logs, telemetry, diagnostics) take from the
// background's composition root; their packages re-export them
// (`@cg/core/services/logs`), the services barrel does not.

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
