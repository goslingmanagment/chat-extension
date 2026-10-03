// storage.local / storage.session wrappers (architecture.md §5.6, §9.4, D-12).
//
// - Never throws: every call answers a result with a CG-STORAGE-* code.
//   A read failure is CG-STORAGE-READ and returns nothing, so a caller can
//   never mistake it for "empty" and overwrite what is stored (§9.4 «Сбой
//   чтения не стирает настройки»).
// - One `set` of the browser per `set` call: a change of several keys is one
//   write, never a series (§9.4 «одним storage.local.set»).
// - Calls run in the order they were issued (RB-011): a read issued after a
//   write sees that write.
// - Size budgets per key (§9.4 «Пределы хранилищ»): a value over its budget
//   is refused with CG-STORAGE-FULL before the browser is asked; a browser
//   quota error is CG-STORAGE-FULL too, any other failure CG-STORAGE-WRITE.
//   `unlimitedStorage` is not requested (§3), so the budgets are ours.
// - Values are plain JSON. Error details name keys and sizes only, never values.

import { defaultBrowser, type BrowserApi, type StorageAreaApi, type StorageChangeApi } from './browser-api';

export type StorageAreaName = 'local' | 'session';
export type StorageFailureCode = 'CG-STORAGE-READ' | 'CG-STORAGE-WRITE' | 'CG-STORAGE-FULL';

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StorageFailureCode; readonly detail: string };

export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}

/** The key-value port the background services get (core/services `KeyValuePort` has the same shape). */
export interface KeyValueStore {
  readonly area: StorageAreaName;
  get(keys: readonly string[]): Promise<StorageResult<Readonly<Record<string, unknown>>>>;
  set(items: Readonly<Record<string, unknown>>): Promise<StorageResult<void>>;
  remove(keys: readonly string[]): Promise<StorageResult<void>>;
  /** Changes of this area, from any context (another writer, «Очистить локальные данные»). */
  onChanged(listener: (changes: Readonly<Record<string, StorageChange>>) => void): () => void;
}

export interface KeyValueStoreOptions {
  readonly api?: BrowserApi;
  /** Byte budget of one key's value (UTF-8 JSON); undefined — only the area cap. */
  readonly budgetOf?: (key: string) => number | undefined;
  /** Cap of one write, all keys together. */
  readonly maxWriteBytes?: number;
}

const MiB = 1024 * 1024;

/**
 * Default cap of one write per area: Firefox's storage.session quota is
 * 10 MiB for everything; storage.local has no fixed quota without
 * `unlimitedStorage`, our largest local value is far below 8 MiB.
 */
export const DEFAULT_MAX_WRITE_BYTES: Readonly<Record<StorageAreaName, number>> = { local: 8 * MiB, session: 10 * MiB };

/** UTF-8 bytes of the JSON form of a value; null when it is not JSON (cycle, BigInt, function). */
export function jsonBytes(value: unknown): number | null {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    return null;
  }
  if (text === undefined) return null;
  return utf8Length(text);
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** A quota failure of the browser (`QuotaExceededError` or a message about the quota). */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  const message = (error as { message?: unknown }).message;
  return name === 'QuotaExceededError' || (typeof message === 'string' && /quota/i.test(message));
}

const fail = (code: StorageFailureCode, detail: string): StorageResult<never> => ({ ok: false, code, detail });

/** Error class name only: browser messages may echo paths or values. */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name)) return name;
  }
  return 'Error';
}

export function createKeyValueStore(area: StorageAreaName, options: KeyValueStoreOptions = {}): KeyValueStore {
  const api = options.api ?? defaultBrowser();
  const maxWriteBytes = options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES[area];
  const areaApi = (): StorageAreaApi => api.storage[area];
  let tail: Promise<unknown> = Promise.resolve();

  /** Run in issue order; a failure of one call never blocks the next. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    area,
    get(keys) {
      return serial(async () => {
        if (keys.length === 0) return { ok: true, value: {} };
        try {
          const raw = await areaApi().get([...keys]);
          const value: Record<string, unknown> = {};
          for (const key of keys) {
            if (raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, key)) value[key] = raw[key];
          }
          return { ok: true, value };
        } catch (error) {
          return fail('CG-STORAGE-READ', `${area}.get ${errorName(error)}`);
        }
      });
    },
    set(items) {
      return serial(async () => {
        const keys = Object.keys(items);
        if (keys.length === 0) return { ok: true, value: undefined };
        let total = 0;
        for (const key of keys) {
          const bytes = jsonBytes(items[key]);
          if (bytes === null) return fail('CG-STORAGE-WRITE', `${area}.set ${key}: not JSON`);
          const budget = options.budgetOf?.(key);
          if (budget !== undefined && bytes > budget) return fail('CG-STORAGE-FULL', `${area}.set ${key}: ${bytes} > ${budget} bytes`);
          total += bytes;
        }
        if (total > maxWriteBytes) return fail('CG-STORAGE-FULL', `${area}.set: ${total} > ${maxWriteBytes} bytes`);
        try {
          await areaApi().set({ ...items });
          return { ok: true, value: undefined };
        } catch (error) {
          return isQuotaError(error) ? fail('CG-STORAGE-FULL', `${area}.set quota`) : fail('CG-STORAGE-WRITE', `${area}.set ${errorName(error)}`);
        }
      });
    },
    remove(keys) {
      return serial(async () => {
        if (keys.length === 0) return { ok: true, value: undefined };
        try {
          await areaApi().remove([...keys]);
          return { ok: true, value: undefined };
        } catch (error) {
          return fail('CG-STORAGE-WRITE', `${area}.remove ${errorName(error)}`);
        }
      });
    },
    onChanged(listener) {
      const wrapped = (changes: Record<string, StorageChangeApi>, areaName: string): void => {
        if (areaName !== area) return;
        listener(changes);
      };
      api.storage.onChanged.addListener(wrapped);
      return () => api.storage.onChanged.removeListener(wrapped);
    },
  };
}
