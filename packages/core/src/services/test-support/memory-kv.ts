// Test support: an in-memory storage area behind the KeyValuePort shape, for
// the R07 services' tests. Values are copied as JSON (the browser clones
// them), `onChanged` fires after a write as the browser's does, and several
// "background instances" can open the same area — an unload and a restart
// is: drop the old instance (`detach`), open a new one over the same data.
// Failure injection: a call fails, or a set lands but its confirmation is
// lost (the write happened, the caller hears a failure). Change events can
// be held and delivered later, in order (Firefox does not promise that
// onChanged arrives before `set` resolves).

import { jsonUtf8Bytes } from '../../domain/storage';
import type { KeyValuePort, StorageChange, StorageFailureCode, StorageResult } from '../storage/ports';

type Op = 'get' | 'set' | 'remove' | 'keys';
type Failure = 'fail' | 'lost' | 'full';

export interface MemoryKv {
  readonly data: Map<string, unknown>;
  readonly calls: Record<Op, number>;
  /** A new background instance over the same data. */
  open(): KeyValuePort & { detach(): void };
  failNext(op: Op, failure?: Failure): void;
  /** Another writer («Очистить локальные данные», another build): changes the data and notifies. */
  external(key: string, value: unknown): void;
  /** A browser restart for storage.session: everything gone, without events. */
  wipe(): void;
  /** Change events wait until `releaseEvents` (late echoes). */
  holdEvents(): void;
  /** Delivers the held events in order and stops holding. */
  releaseEvents(): void;
  read<T = unknown>(key: string): T | undefined;
}

/** Answers asynchronously, as the browser does; a throw is a rejected promise. */
const later = <T>(task: () => T): Promise<T> => Promise.resolve().then(task);

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

export function createMemoryKv(options: { readonly budgetOf?: (key: string) => number | undefined } = {}): MemoryKv {
  const data = new Map<string, unknown>();
  const calls: Record<Op, number> = { get: 0, set: 0, remove: 0, keys: 0 };
  const failures: { op: Op; failure: Failure }[] = [];
  const instances = new Set<Set<(changes: Readonly<Record<string, StorageChange>>) => void>>();
  let held: (() => void)[] | null = null;

  const take = (op: Op): Failure | null => {
    const index = failures.findIndex((item) => item.op === op);
    if (index < 0) return null;
    const [item] = failures.splice(index, 1);
    return item?.failure ?? null;
  };

  const emit = (changes: Record<string, StorageChange>): void => {
    if (Object.keys(changes).length === 0) return;
    const targets = [...instances].flatMap((listeners) => [...listeners]);
    const deliver = (): void => {
      for (const listener of targets) listener(copy(changes));
    };
    if (held) held.push(deliver);
    else void Promise.resolve().then(deliver);
  };

  const fail = (code: StorageFailureCode, detail: string): StorageResult<never> => ({ ok: false, code, detail });

  const kv: MemoryKv = {
    data,
    calls,
    open() {
      const listeners = new Set<(changes: Readonly<Record<string, StorageChange>>) => void>();
      instances.add(listeners);
      let alive = true;
      return {
        get: (keys) =>
          later(() => {
          calls.get += 1;
          if (!alive) throw new Error('instance gone');
          if (take('get')) return fail('CG-STORAGE-READ', 'get failed');
          const value: Record<string, unknown> = {};
          for (const key of keys) if (data.has(key)) value[key] = copy(data.get(key));
          return { ok: true, value };
        }),
        set: (items) =>
          later(() => {
          calls.set += 1;
          if (!alive) throw new Error('instance gone');
          const failure = take('set');
          if (failure === 'fail') return fail('CG-STORAGE-WRITE', 'set failed');
          if (failure === 'full') return fail('CG-STORAGE-FULL', 'set quota');
          for (const [key, value] of Object.entries(items)) {
            const budget = options.budgetOf?.(key);
            const bytes = jsonUtf8Bytes(value);
            if (bytes === null) return fail('CG-STORAGE-WRITE', `${key}: not JSON`);
            if (budget !== undefined && bytes > budget) return fail('CG-STORAGE-FULL', `${key}: ${bytes} > ${budget}`);
          }
          const changes: Record<string, StorageChange> = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: copy(data.get(key)), newValue: copy(value) };
            data.set(key, copy(value));
          }
          emit(changes);
          return failure === 'lost' ? fail('CG-STORAGE-WRITE', 'set confirmation lost') : { ok: true, value: undefined };
        }),
        remove: (keys) =>
          later(() => {
          calls.remove += 1;
          if (!alive) throw new Error('instance gone');
          if (take('remove')) return fail('CG-STORAGE-WRITE', 'remove failed');
          const changes: Record<string, StorageChange> = {};
          for (const key of keys) {
            if (!data.has(key)) continue;
            changes[key] = { oldValue: copy(data.get(key)) };
            data.delete(key);
          }
          emit(changes);
          return { ok: true, value: undefined };
        }),
        keys: () =>
          later(() => {
          calls.keys += 1;
          if (!alive) throw new Error('instance gone');
          if (take('keys')) return fail('CG-STORAGE-READ', 'keys failed');
          return { ok: true, value: [...data.keys()] };
        }),
        onChanged(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        detach() {
          alive = false;
          instances.delete(listeners);
        },
      };
    },
    failNext(op, failure = 'fail') {
      failures.push({ op, failure });
    },
    external(key, value) {
      const change: StorageChange = value === undefined ? { oldValue: copy(data.get(key)) } : { oldValue: copy(data.get(key)), newValue: copy(value) };
      if (value === undefined) data.delete(key);
      else data.set(key, copy(value));
      emit({ [key]: change });
    },
    wipe() {
      data.clear();
    },
    holdEvents() {
      held ??= [];
    },
    releaseEvents() {
      const queue = held ?? [];
      held = null;
      for (const deliver of queue) deliver();
    },
    read: <T = unknown>(key: string) => copy(data.get(key)) as T | undefined,
  };
  return kv;
}

/** Lets pending promise callbacks (and the change events) run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/** A clock the test moves by hand. */
export function manualClock(start: number): { now(): number; advance(ms: number): void; set(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
    set(ms) {
      current = ms;
    },
  };
}
