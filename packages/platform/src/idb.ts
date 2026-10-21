// A bounded IndexedDB store (architecture.md §9.2, D-12; LG-004, LG-005,
// LG-023): records with a time and a group (the logger's session number),
// kept within a record count, a byte budget, an age and a number of the
// newest groups — whichever comes first. The record format inside `value`
// is R18's (LogRecord); this store only keeps, bounds and returns it.
//
// It never throws and never blocks its caller's work: a database that will
// not open, a failed write or an oversized record is counted in `stats()`
// (losses visible in diagnostics, LG-012), never raised.
//
// Writes (append, prune, clear) run one at a time: each prune counts from
// totals no other write is changing, so concurrent appends never evict more
// than the bounds require.

import { jsonBytes } from './storage';

export interface BoundedStoreLimits {
  readonly maxRecords: number;
  readonly maxBytes: number;
  readonly maxAgeMs: number;
  /** Keep only the newest N groups (current session + previous ones). */
  readonly maxGroups?: number;
  /** One record's budget; larger ones are refused. */
  readonly maxRecordBytes?: number;
}

export interface BoundedStoreOptions extends BoundedStoreLimits {
  readonly dbName: string;
  readonly storeName?: string;
  readonly idb?: IDBFactory;
  readonly now?: () => number;
}

export interface BoundedRecordInput {
  /** Epoch ms. */
  readonly at: number;
  /** Monotonic group number (newer groups are larger). */
  readonly group: number;
  readonly value: unknown;
}

export interface BoundedRecord extends BoundedRecordInput {
  readonly id: number;
  readonly bytes: number;
}

export interface BoundedStoreStats {
  readonly available: boolean;
  readonly records: number;
  readonly bytes: number;
  /** Groups present, oldest first. */
  readonly groups: readonly number[];
  /** Removed to stay within count, bytes or groups. */
  readonly evicted: number;
  /** Removed for age. */
  readonly expired: number;
  /** Refused: not JSON or over the record budget. */
  readonly rejected: number;
  /** Lost to a failed database operation. */
  readonly failed: number;
}

export interface BoundedStore {
  append(records: readonly BoundedRecordInput[]): Promise<{ readonly stored: number; readonly rejected: number }>;
  /**
   * The newest `limit` records (of one group, when given), oldest first. `since` (epoch ms): only records at or after
   * it, newest by their time — every group's.
   */
  latest(limit: number, query?: { readonly group?: number; readonly since?: number }): Promise<readonly BoundedRecord[]>;
  stats(): BoundedStoreStats;
  prune(): Promise<void>;
  clear(): Promise<boolean>;
  close(): void;
}

/** Per-record overhead on top of the value's JSON (id, at, group, bytes). */
const RECORD_OVERHEAD_BYTES = 48;

interface StoredRow {
  readonly id: number;
  readonly at: number;
  readonly group: number;
  readonly bytes: number;
  readonly value: unknown;
}

function done(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb request failed'));
  });
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb transaction aborted'));
  });
}

/** Walks a cursor with callbacks only (the transaction stays active); `visit` false stops. */
function walk(request: IDBRequest<IDBCursorWithValue | null>, visit: (cursor: IDBCursorWithValue) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (visit(cursor)) cursor.continue();
      else resolve();
    };
    request.onerror = () => reject(request.error ?? new Error('idb cursor failed'));
  });
}

function openIdb(idb: IDBFactory, name: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = idb.open(name, 1);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('idb open failed'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
        store.createIndex('at', 'at');
        store.createIndex('group', 'group');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb open failed'));
    request.onblocked = () => reject(new Error('idb open blocked'));
  });
}

export async function openBoundedStore(options: BoundedStoreOptions): Promise<BoundedStore> {
  const storeName = options.storeName ?? 'records';
  const now = options.now ?? (() => Date.now());
  const maxRecordBytes = options.maxRecordBytes ?? options.maxBytes;
  const groups = new Map<number, { count: number; bytes: number }>();
  let records = 0;
  let bytes = 0;
  let evicted = 0;
  let expired = 0;
  let rejected = 0;
  let failed = 0;
  let db: IDBDatabase | null = null;

  const idb = options.idb ?? globalThis.indexedDB;
  try {
    if (!idb) throw new Error('no indexedDB');
    db = await openIdb(idb, options.dbName, storeName);
  } catch {
    db = null;
  }

  // A sweep accounts whole groups at once: `bytes` is their sum, `count` their row count.
  const account = (row: Pick<StoredRow, 'group' | 'bytes'>, sign: 1 | -1, count = 1): void => {
    records += sign * count;
    bytes += sign * row.bytes;
    const entry = groups.get(row.group) ?? { count: 0, bytes: 0 };
    entry.count += sign * count;
    entry.bytes += sign * row.bytes;
    if (entry.count <= 0) groups.delete(row.group);
    else groups.set(row.group, entry);
  };

  /** A transaction and its completion, watched from the start (never an unhandled rejection). */
  const transaction = (mode: IDBTransactionMode): { tx: IDBTransaction; store: IDBObjectStore; finished: Promise<void> } | null => {
    if (!db) return null;
    try {
      const tx = db.transaction(storeName, mode);
      const finished = completion(tx);
      finished.catch(() => undefined);
      return { tx, store: tx.objectStore(storeName), finished };
    } catch {
      return null;
    }
  };

  // Totals of what an earlier session left.
  if (db) {
    const scan = transaction('readonly');
    try {
      if (!scan) throw new Error('no transaction');
      await walk(scan.store.openCursor(), (cursor) => {
        account(cursor.value as StoredRow, 1);
        return true;
      });
    } catch {
      failed += 1;
    }
  }

  /** Serializes the writes (append + its prune, prune, clear): a failure of one never blocks the next. */
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  /** Deletes rows the cursor visits while `pick` says so; stops when it says stop. */
  async function sweep(open: (store: IDBObjectStore) => IDBRequest<IDBCursorWithValue | null>, pick: (row: StoredRow) => 'delete' | 'skip' | 'stop'): Promise<number> {
    const t = transaction('readwrite');
    if (!t) return 0;
    let removed = 0;
    // Retain totals only, never the removed journal values (up to 100 000
    // events). Accounting is still committed only when the transaction is.
    const gone = new Map<number, { count: number; bytes: number }>();
    try {
      await walk(open(t.store), (cursor) => {
        const row = cursor.value as StoredRow;
        const verdict = pick(row);
        if (verdict === 'stop') return false;
        if (verdict === 'delete') {
          cursor.delete();
          const group = gone.get(row.group) ?? { count: 0, bytes: 0 };
          group.count += 1;
          group.bytes += row.bytes;
          gone.set(row.group, group);
          removed += 1;
        }
        return true;
      });
      await t.finished;
    } catch {
      failed += 1;
      return 0;
    }
    for (const [group, totals] of gone) account({ group, bytes: totals.bytes }, -1, totals.count);
    return removed;
  }

  async function pruneNow(): Promise<void> {
    if (!db) return;
    const cutoff = now() - options.maxAgeMs;
    expired += await sweep((store) => store.index('at').openCursor(), (row) => (row.at < cutoff ? 'delete' : 'stop'));
    if (options.maxGroups !== undefined && groups.size > options.maxGroups) {
      const ordered = [...groups.keys()].sort((a, b) => a - b);
      const dropped = new Set(ordered.slice(0, ordered.length - options.maxGroups));
      const last = Math.max(...dropped);
      evicted += await sweep((store) => store.index('group').openCursor(), (row) => (row.group > last ? 'stop' : dropped.has(row.group) ? 'delete' : 'skip'));
    }
    if (records > options.maxRecords || bytes > options.maxBytes) {
      let count = records;
      let size = bytes;
      evicted += await sweep(
        (store) => store.openCursor(),
        (row) => {
          if (count <= options.maxRecords && size <= options.maxBytes) return 'stop';
          count -= 1;
          size -= row.bytes;
          return 'delete';
        },
      );
    }
  }

  async function appendNow(input: readonly BoundedRecordInput[]): Promise<{ readonly stored: number; readonly rejected: number }> {
    const rows: Omit<StoredRow, 'id'>[] = [];
    let refused = 0;
    for (const record of input) {
      const size = jsonBytes(record.value);
      if (size === null || size + RECORD_OVERHEAD_BYTES > maxRecordBytes) {
        refused += 1;
        continue;
      }
      rows.push({ at: record.at, group: record.group, bytes: size + RECORD_OVERHEAD_BYTES, value: record.value });
    }
    rejected += refused;
    if (rows.length === 0) return { stored: 0, rejected: refused };
    const t = transaction('readwrite');
    if (!t) {
      failed += rows.length;
      return { stored: 0, rejected: refused };
    }
    try {
      for (const row of rows) t.store.add(row);
      await t.finished;
    } catch {
      failed += rows.length;
      return { stored: 0, rejected: refused };
    }
    for (const row of rows) account(row, 1);
    await pruneNow();
    return { stored: rows.length, rejected: refused };
  }

  return {
    append: (input) => serial(() => appendNow(input)),
    async latest(limit, query) {
      const t = transaction('readonly');
      if (!t || limit <= 0) return [];
      const found: BoundedRecord[] = [];
      try {
        const since = query?.since;
        const cursor = since === undefined ? t.store.openCursor(null, 'prev') : t.store.index('at').openCursor(IDBKeyRange.lowerBound(since), 'prev');
        await walk(cursor, (cursor) => {
          const row = cursor.value as StoredRow;
          if (query?.group === undefined || row.group === query.group) found.push({ id: row.id, at: row.at, group: row.group, bytes: row.bytes, value: row.value });
          return found.length < limit;
        });
      } catch {
        failed += 1;
        return [];
      }
      return found.reverse();
    },
    stats() {
      return {
        available: db !== null,
        records,
        bytes,
        groups: [...groups.keys()].sort((a, b) => a - b),
        evicted,
        expired,
        rejected,
        failed,
      };
    },
    prune: () => serial(pruneNow),
    clear: () =>
      serial(async () => {
        const t = transaction('readwrite');
        if (!t) return false;
        try {
          await done(t.store.clear());
          await t.finished;
        } catch {
          failed += 1;
          return false;
        }
        groups.clear();
        records = 0;
        bytes = 0;
        return true;
      }),
    close() {
      db?.close();
      db = null;
    },
  };
}
