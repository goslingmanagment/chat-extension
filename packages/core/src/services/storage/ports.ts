// Ports the R07 background services run on (architecture.md §4: core never
// touches browser.* — the composition root passes @cg/platform's adapters,
// which have exactly these shapes: `KeyValuePort` = platform `KeyValueStore`,
// `ConsentPortLike` = platform `ConsentPort`).

import type { CgCode } from '@cg/contracts/errors';

export type StorageFailureCode = 'CG-STORAGE-READ' | 'CG-STORAGE-WRITE' | 'CG-STORAGE-FULL';

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StorageFailureCode; readonly detail: string };

export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/** storage.local or storage.session: never throws, one browser write per `set`, calls in issue order. */
export interface KeyValuePort {
  get(keys: readonly string[]): Promise<StorageResult<Readonly<Record<string, unknown>>>>;
  set(items: Readonly<Record<string, unknown>>): Promise<StorageResult<void>>;
  remove(keys: readonly string[]): Promise<StorageResult<void>>;
  /** Every key of the area (rare: finding keys an index lost track of). */
  keys(): Promise<StorageResult<readonly string[]>>;
  onChanged(listener: (changes: Readonly<Record<string, StorageChange>>) => void): () => void;
}

export interface Clock {
  /** Epoch ms. */
  now(): number;
}

export const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/** Timers from the composition root (core compiles against the ES lib only: no setTimeout of its own). */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Log fields are numbers, flags, codes and keys — never texts of conversations, drafts, prompts or model output. */
export type ServiceLogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface ServiceLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly scope: string;
  readonly msg: string;
  readonly code?: CgCode;
  readonly fields?: ServiceLogFields;
}

/** The R18 logger behind a function; the services call it and never wait on it. */
export type ServiceLog = (entry: ServiceLogEntry) => void;

export const NO_LOG: ServiceLog = () => undefined;

/** Firefox's technicalAndInteraction consent (platform `ConsentPort`). */
export interface ConsentPortLike {
  /** null — the browser could not tell (a failed check, never a revoke). */
  check(): Promise<boolean | null>;
  onChange(listener: (granted: boolean) => void): () => void;
}

/** Serializes a service's writes: each starts after the previous settled (RB-011). */
export function createWriteChain(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
