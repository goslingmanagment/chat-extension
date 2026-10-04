// An in-memory storage area with the shape of @cg/platform's KeyValueStore,
// for the tests of the background's adapters. Values are copied as JSON, as
// the browser clones them; a write can be made to fail.

import type { KeyValueStore, StorageChange, StorageResult } from '@cg/platform';

export interface MemoryStore extends KeyValueStore {
  readonly data: Map<string, unknown>;
  /** Number of `set` calls so far, and the keys of each. */
  readonly sets: string[][];
  /** The next `set` answers CG-STORAGE-WRITE and writes nothing. */
  failNextSet(): void;
}

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));
const done = <T>(value: T): Promise<StorageResult<T>> => Promise.resolve({ ok: true, value });

export function memoryStore(area: 'local' | 'session' = 'session', data: Map<string, unknown> = new Map()): MemoryStore {
  const listeners = new Set<(changes: Readonly<Record<string, StorageChange>>) => void>();
  const sets: string[][] = [];
  let failSet = false;
  return {
    area,
    data,
    sets,
    failNextSet() {
      failSet = true;
    },
    get(keys) {
      const value: Record<string, unknown> = {};
      for (const key of keys) if (data.has(key)) value[key] = copy(data.get(key));
      return done(value);
    },
    set(items) {
      sets.push(Object.keys(items));
      if (failSet) {
        failSet = false;
        return Promise.resolve({ ok: false, code: 'CG-STORAGE-WRITE', detail: `${area}.set failed (test)` });
      }
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: copy(data.get(key)), newValue: copy(value) };
        data.set(key, copy(value));
      }
      void Promise.resolve().then(() => listeners.forEach((listener) => listener(changes)));
      return done(undefined);
    },
    remove(keys) {
      for (const key of keys) data.delete(key);
      return done(undefined);
    },
    keys: () => done([...data.keys()]),
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
