// The persistent log behind R18's `LogStorePort`, on R07's bounded IndexedDB
// store (`cg-logs`, architecture.md §9.2: three log sessions, 20 000 records,
// 10 MiB, 7 days — whichever comes first).
//
// The two were written against each other's sketch, so the shapes differ:
// R18's service prunes through the port (`dropOldest`, `dropBefore`,
// `dropSessionsBefore`) from totals it reads with `sessions()`; R07's store
// keeps its own bounds on every append and reports only its totals and the
// groups present. The adapter lets the store be the one that prunes:
// - a log session is the store's group; ids are the store's own;
// - every drop is the store's `prune()` (its bounds are the same numbers);
// - `sessions()` reports the groups with the totals on the newest one: the
//   service needs the sum, the newest session and whether an older one
//   exists, never the split. `firstTs` is 0 for groups older than the newest,
//   so the service's age prune always asks the store, which knows the ages.
// The store opens lazily and at most once; a store that will not open (a
// private window) is «unavailable»: the service keeps its ring and counts.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { LogRecordSchema } from '@cg/contracts/logs';
import { type LogSessionInfo, type LogStorePort, type StoredLog } from '@cg/core/services/logs';
import { type BoundedStore } from '@cg/platform';

/** The bounds handed to `openBoundedStore` — the same limits the log service enforces (LG-004…LG-006, LG-023). */
export const LOG_STORE_BOUNDS = {
  maxRecords: LOG_LIMITS.idbMaxRecords,
  maxBytes: LOG_LIMITS.idbMaxBytes,
  maxAgeMs: LOG_LIMITS.idbMaxAgeMs,
  maxGroups: LOG_LIMITS.sessionsKept,
  maxRecordBytes: LOG_LIMITS.maxRecordBytes + 1024,
} as const;

export function logStoreOver(open: () => Promise<BoundedStore>): LogStorePort {
  let opened: Promise<BoundedStore> | null = null;
  const store = async (): Promise<BoundedStore> => {
    const bounded = await (opened ??= open());
    if (!bounded.stats().available) throw new Error('log store unavailable');
    return bounded;
  };

  return {
    async append(rows) {
      if (rows.length === 0) return;
      const bounded = await store();
      const result = await bounded.append(rows.map((row) => ({ at: row.ts, group: row.session, value: row.record })));
      // The store never throws; what it could not keep is the service's «lost».
      if (result.stored + result.rejected < rows.length) throw new Error('log store write failed');
    },
    async sessions() {
      const bounded = await store();
      const stats = bounded.stats();
      const newest = stats.groups.at(-1);
      return stats.groups.map(
        (group): LogSessionInfo =>
          group === newest
            ? { session: group, count: stats.records, bytes: stats.bytes, firstTs: stats.groups.length > 1 ? 0 : Date.now(), lastTs: Date.now(), lastId: 0 }
            : { session: group, count: 0, bytes: 0, firstTs: 0, lastTs: 0, lastId: 0 },
      );
    },
    async tail(session, limit) {
      const bounded = await store();
      const rows = await bounded.latest(limit, { group: session });
      const out: StoredLog[] = [];
      for (const row of rows) {
        // Our own database, but a record is shown and exported: it is read through its schema.
        const record = LogRecordSchema.safeParse(row.value);
        if (record.success) out.push({ id: row.id, session: row.group, ts: row.at, bytes: row.bytes, record: record.data });
      }
      return out;
    },
    async dropOldest() {
      await (await store()).prune();
    },
    async dropSessionsBefore() {
      await (await store()).prune();
    },
    async dropBefore() {
      await (await store()).prune();
    },
    async clear() {
      if (!(await (await store()).clear())) throw new Error('log store clear failed');
    },
  };
}
