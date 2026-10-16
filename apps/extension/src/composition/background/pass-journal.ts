// The pass journal (R20 P10b3): persistent metadata in openBoundedStore, not
// the old extension's 8 large arrays. Only a small tail and a bounded write
// queue live here. A slow/unavailable IDB loses diagnostics, never pass work.
import { LOG_LIMITS } from '@cg/contracts/limits';
import type { JournalKind } from '@cg/contracts/vm';
import { STORAGE_KEYS, SettingsV1Schema } from '@cg/contracts/settings';
import type { JournalRead, PassJournal, PassJournalEvent, PassJournalFields, PassJournalRun } from '@cg/core/services/logs';
import type { BackgroundKit, JournalStore } from './host-module';

export const PASS_JOURNAL_BOUNDS = {
  maxGroups: LOG_LIMITS.newcomersJournalRuns,
  maxRecords: LOG_LIMITS.newcomersJournalEvents,
  maxBytes: LOG_LIMITS.newcomersJournalBytes,
  // Retain runs until rotation, including across event-page/browser restarts.
  maxAgeMs: Infinity,
  maxRecordBytes: 2048,
} as const;
export const PASS_JOURNAL_MEMORY = { tail: 100, pending: 128, batch: 32 } as const;

export interface PassJournalRecord extends PassJournalRun {
  readonly at: string;
  readonly offsetMs: number;
  readonly event: PassJournalEvent;
  readonly fields: PassJournalFields;
  /** Events lost to backpressure or a failed write before this event. */
  readonly omittedBefore: number;
}

interface Pending {
  readonly at: number;
  readonly ordinal: number;
  readonly value: PassJournalRecord;
}

const TOKENS = new Set(['fanRef', 'groupId', 'messageId', 'route', 'state', 'phase', 'status', 'reason', 'kind', 'code', 'classification']);
const NUMBERS = new Set(['page', 'count', 'total', 'attempt', 'httpStatus', 'durationMs', 'waitMs', 'retryAt']);
const FLAGS = new Set(['complete', 'sent']);

/** Copy only metadata keys, even if a caller accidentally passes a whole API object. */
function metadata(fields: PassJournalFields): PassJournalFields {
  return Object.fromEntries(Object.entries(fields).filter(([key, value]) =>
    (TOKENS.has(key) && typeof value === 'string' && /^[\w.:-]{1,100}$/.test(value)) ||
    (NUMBERS.has(key) && typeof value === 'number' && Number.isFinite(value)) ||
    (FLAGS.has(key) && typeof value === 'boolean'),
  ));
}

export function createPassJournal(deps: { readonly now: () => number; readonly monotonicNow: () => number; readonly open: () => Promise<JournalStore> }) {
  let enabled: boolean | null = null;
  let closed = false;
  let epoch = 0;
  let ordinal = 0;
  let groupBase = 0;
  let omitted = 0;
  let inFlight = 0;
  let opened: Promise<JournalStore> | null = null;
  let storeStats: ReturnType<JournalStore['stats']> | null = null;
  let busy: Promise<void> = Promise.resolve();
  let flushing = false;
  const pending: Pending[] = [];
  const tail: PassJournalRecord[] = [];

  const store = (): Promise<JournalStore> => (opened ??= deps.open().then(async (bounded) => {
    await bounded.prune();
    storeStats = bounded.stats();
    // Unique monotonic groups even if scans share a timestamp or the clock moved backwards.
    groupBase = (storeStats.groups.at(-1) ?? 0) + 1;
    return bounded;
  }));

  function flush(): void {
    if (flushing || pending.length === 0) return;
    flushing = true;
    const generation = epoch;
    busy = busy.then(async () => {
      const bounded = await store();
      while (generation === epoch && pending.length > 0) {
        const batch = pending.splice(0, PASS_JOURNAL_MEMORY.batch);
        inFlight = batch.length;
        try {
          const result = await bounded.append(batch.map((row) => ({ at: row.at, group: groupBase + row.ordinal, value: row.value })));
          omitted += batch.length - result.stored;
          storeStats = bounded.stats();
        } catch {
          omitted += batch.length;
        } finally {
          inFlight = 0;
        }
      }
    }).catch(() => {
      omitted += pending.length;
      pending.length = 0;
    }).finally(() => {
      flushing = false;
      flush();
    });
  }

  const idle = async (): Promise<void> => {
    do { await busy.catch(() => undefined); } while (flushing || pending.length > 0);
  };

  const journal: PassJournal = {
    start(run) {
      if (!enabled || closed) return undefined;
      const generation = epoch;
      const group = ordinal++;
      const started = deps.monotonicNow();
      // Project the run too: never retain extra properties of a caller's pass.
      const info: PassJournalRun = { passId: run.passId, hostAccountId: run.hostAccountId, startedAt: run.startedAt, windowHours: run.windowHours };
      return (event, fields = {}) => {
        if (!enabled || closed || generation !== epoch) return;
        const at = deps.now();
        const value: PassJournalRecord = { ...info, at: new Date(at).toISOString(), offsetMs: Math.max(0, deps.monotonicNow() - started), event, fields: metadata(fields), omittedBefore: omitted };
        if (new TextEncoder().encode(JSON.stringify(value)).byteLength + 48 > PASS_JOURNAL_BOUNDS.maxRecordBytes) {
          omitted += 1;
          return;
        }
        if (pending.length === PASS_JOURNAL_MEMORY.pending) {
          pending.shift();
          omitted += 1;
        }
        const kept = { ...value, omittedBefore: omitted };
        tail.push(kept);
        if (tail.length > PASS_JOURNAL_MEMORY.tail) tail.shift();
        pending.push({ at, ordinal: group, value: kept });
        flush();
      };
    },
  };

  const clear = (): Promise<void> => {
    epoch += 1;
    pending.length = 0;
    tail.length = 0;
    const erase = async (): Promise<void> => {
      const bounded = await store();
      if (!(await bounded.clear())) throw new Error('pass journal clear failed');
      omitted = 0;
      storeStats = bounded.stats();
    };
    busy = busy.then(erase, erase);
    // Keep failures observable to a clear request, without an unhandled rejection.
    busy.catch(() => undefined);
    return busy;
  };

  return {
    ...journal,
    async setEnabled(next: boolean): Promise<void> {
      if (enabled === next) return;
      enabled = next;
      if (!next) await clear();
    },
    clear,
    idle,
    async read(limit: number): Promise<JournalRead> {
      await idle();
      const bounded = await store();
      const rows = await bounded.latest(PASS_JOURNAL_BOUNDS.maxRecords);
      const runs = new Map<string, { runId: string; startedAt: string; events: number }>();
      const records = rows.map(({ id, value }) => {
        const row = value as PassJournalRecord;
        const run = runs.get(row.passId) ?? { runId: row.passId, startedAt: new Date(row.startedAt).toISOString(), events: 0 };
        run.events += 1;
        runs.set(row.passId, run);
        return { ts: row.at, seq: id, level: 'debug' as const, scope: 'bg.newcomers.pass', msg: row.event, fields: { ...row.fields, passId: row.passId, hostAccountId: row.hostAccountId, windowHours: row.windowHours, offsetMs: row.offsetMs, omittedBefore: row.omittedBefore } };
      });
      const take = Math.max(0, Math.min(Math.floor(limit), LOG_LIMITS.exportRecentRecords));
      const stats = bounded.stats();
      return { records: take === 0 ? [] : records.slice(-take), runs: [...runs.values()], truncated: records.length > take || stats.evicted > 0 || stats.expired > 0 || rows.some(({ value }) => (value as PassJournalRecord).omittedBefore > 0) };
    },
    tail: (): readonly PassJournalRecord[] => [...tail],
    stats: () => ({ tail: tail.length, pending: pending.length, inFlight, omitted, store: storeStats }),
    async dispose(): Promise<void> {
      closed = true;
      await idle();
      (await opened?.catch(() => null))?.close();
    },
  };
}

/** Read-only observer of the existing debug setting; no settings writer or new UI. */
export function startPassJournal(kit: Pick<BackgroundKit, 'storage' | 'clock'>, dbName: string) {
  const open = kit.storage.journal;
  if (open === undefined) return null;
  const journal = createPassJournal({ now: () => kit.clock.now(), monotonicNow: () => performance.now(), open: () => open({ dbName, ...PASS_JOURNAL_BOUNDS, now: () => kit.clock.now() }) });
  const local = kit.storage.local;
  let revision = 0;
  const apply = async (value: unknown): Promise<void> => {
    const parsed = SettingsV1Schema.shape.debug.safeParse((value as { debug?: unknown } | null)?.debug);
    await journal.setEnabled(parsed.success && parsed.data.enabled).catch(() => undefined);
  };
  const off = local.onChanged((changes) => {
    if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_KEYS.settings)) return;
    revision += 1;
    void apply(changes[STORAGE_KEYS.settings]?.newValue).catch(() => undefined);
  });
  const readRevision = revision;
  const ready = local.get([STORAGE_KEYS.settings]).then((settings) => {
    // Select synchronously; slow/unavailable diagnostic storage never holds up the background.
    if (revision === readRevision) void apply(settings.ok ? settings.value[STORAGE_KEYS.settings] : undefined).catch(() => undefined);
  });
  return { ...journal, ready, async dispose() { off(); await journal.dispose(); } };
}

/** The existing debug page/copy/export use this same bounded journal.read answer. */
export async function readPassJournals(base: JournalRead, kind: JournalKind, limit: number, journals: readonly ReturnType<typeof createPassJournal>[]): Promise<JournalRead> {
  if (kind !== 'newcomers-check' || journals.length === 0) return base;
  const reads = await Promise.all(journals.map((journal) => journal.read(limit)));
  const runs = [...(base.runs ?? []), ...reads.flatMap((read) => read.runs ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const retained = runs.slice(-LOG_LIMITS.newcomersJournalRuns);
  const ids = new Set(retained.map((run) => run.runId));
  const baseRetained = (base.runs ?? []).every((run) => ids.has(run.runId));
  const records = [...(baseRetained ? base.records : []), ...reads.flatMap((read) => read.records).filter((record) => ids.has(String(record.fields?.passId)))].sort((a, b) => a.ts.localeCompare(b.ts) || a.seq - b.seq);
  const take = Math.max(0, Math.min(Math.floor(limit), LOG_LIMITS.exportRecentRecords));
  return { records: take === 0 ? [] : records.slice(-take), runs: retained, truncated: base.truncated || reads.some((read) => read.truncated) || records.length > take || retained.length < runs.length };
}
