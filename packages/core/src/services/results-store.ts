// Operation results in storage.session (architecture.md §7 «Жизнь в фоне»,
// §9.4 «Пределы хранилищ», D-12): up to 24 per tab and 4 MiB for the whole
// extension, each kept 30 minutes after its last save. storage.session lives
// in memory for the browser session: it survives the event page unloading,
// not a browser restart, and never reaches the disk.
//
// Layout: one key per result (`result.<opId>`, the OpView) plus a small
// index (`results.index`); a save writes the result and the index in ONE
// set. Eviction drops finished results first, oldest first; the result being
// saved is never evicted. After an unload the new background restores the
// index: finished results come back, an operation that was still running is
// `interrupted` (CG-OP-INTERRUPTED) — its stream is not resumed and no new
// request is made (§7). That recovery runs once, on the first successful
// read of the index, whichever call makes it (start, or a later request
// when start's read failed); `start` is idempotent.
//
// An index that cannot be read or parsed starts over (a 30-minute cache must
// not block work), and the result keys it named are found by listing the
// area and removed, so they never sit uncounted in storage.session.
//
// Cost: every `put` validates the whole OpView, measures it and writes the
// view (≤ 512 KiB) and the index (≤ 1 MiB) in one set. Save at phase changes
// and at the end of an operation (R10), never on every 50 ms `op.update`
// batch of a stream.

import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { OP_LIMITS, STORAGE_LIMITS } from '@cg/contracts/limits';
import { OP_TERMINAL_STATES, OpViewSchema, type OpState, type OpView, type AnyOpView } from '@cg/contracts/ops';

import { RESULT_MAX_BYTES, SESSION_KEYS, isPlainRecord, jsonUtf8Bytes } from '../domain/storage';
import { NO_LOG, SYSTEM_CLOCK, createWriteChain, type Clock, type KeyValuePort, type ServiceLog, type StorageFailureCode } from './storage/ports';

export interface ResultMeta {
  readonly opId: string;
  /** The tab that started it; null — no tab (or the tab is gone and the result stays for the palette). */
  readonly tabSessionId: string | null;
  readonly chatKey: ChatKey;
  readonly pageId: number;
  readonly state: OpState;
  readonly savedAt: number;
  readonly bytes: number;
}

export interface ResultsLimits {
  readonly perTab: number;
  readonly totalBytes: number;
  readonly ttlMs: number;
  readonly listMax: number;
}

export const RESULTS_LIMITS: ResultsLimits = {
  perTab: STORAGE_LIMITS.resultsPerTab,
  totalBytes: STORAGE_LIMITS.resultsTotalBytes,
  ttlMs: OP_LIMITS.resultTtlMs,
  listMax: STORAGE_LIMITS.opListMax,
};

export type ResultsPutResult =
  | { readonly ok: true; readonly evicted: readonly string[] }
  | { readonly ok: false; readonly code: StorageFailureCode; readonly detail: string };

export interface ResultsRecovery {
  readonly restored: number;
  readonly interrupted: readonly string[];
  readonly expired: number;
  readonly readable: boolean;
}

export interface ResultsStore<V extends AnyOpView = OpView> {
  /** Load and recover; the readiness barrier runs it. Idempotent: a second call answers the first report. */
  start(): Promise<ResultsRecovery>;
  /**
   * Saves a view (and the index) in ONE set. Heavy (validation, size, up to
   * ~1.5 MiB written): call it at phase changes and at the end, not per
   * streamed batch.
   */
  put(view: V, owner: { readonly tabSessionId: string | null }): Promise<ResultsPutResult>;
  get(opId: string): Promise<V | null>;
  /** `op.list`: this tab's (≤ 24) or everything (newest first, ≤ 200, `truncated`). */
  list(query: { readonly scope: 'tab' | 'all'; readonly tabSessionId?: string | null; readonly chatKey?: ChatKey }): Promise<{ readonly ops: readonly V[]; readonly truncated: boolean }>;
  /** Persona change: the results of a page; sign-out: everything (`clear`). */
  removeWhere(predicate: (meta: ResultMeta) => boolean): Promise<number>;
  clear(): Promise<boolean>;
  /** Drops expired results (an alarm calls it). */
  sweep(): Promise<number>;
  stats(): { readonly count: number; readonly bytes: number };
}

export interface ResultsStoreDeps<V extends AnyOpView = OpView> {
  /** Strict parser from the owning site registry; the default accepts common views only. */
  readonly readView?: (value: unknown) => Promise<V | null>;
  readonly session: KeyValuePort;
  readonly clock?: Clock;
  readonly log?: ServiceLog;
  readonly limits?: Partial<ResultsLimits>;
}

const INDEX_KEY = SESSION_KEYS.resultsIndex;
const keyOf = (opId: string): string => `${SESSION_KEYS.resultPrefix}${opId}`;
const TERMINAL: readonly OpState[] = OP_TERMINAL_STATES;
const isTerminal = (state: OpState): boolean => TERMINAL.includes(state);
const SCOPE = 'bg.results';

function readIndex(raw: unknown): ResultMeta[] | null {
  if (raw === undefined) return [];
  if (!isPlainRecord(raw) || raw['v'] !== 1 || !Array.isArray(raw['entries'])) return null;
  return (raw['entries'] as unknown[]).filter(
    (entry): entry is ResultMeta =>
      isPlainRecord(entry) &&
      typeof entry['opId'] === 'string' &&
      (entry['tabSessionId'] === null || typeof entry['tabSessionId'] === 'string') &&
      typeof entry['chatKey'] === 'string' &&
      typeof entry['pageId'] === 'number' &&
      typeof entry['state'] === 'string' &&
      typeof entry['savedAt'] === 'number' &&
      typeof entry['bytes'] === 'number',
  );
}

export function createResultsStore<V extends AnyOpView = OpView>(deps: ResultsStoreDeps<V>): ResultsStore<V> {
  const readView = async (value: unknown): Promise<V | null> => {
    if (deps.readView !== undefined) return deps.readView(value);
    const parsed = OpViewSchema.safeParse(value);
    return parsed.success ? parsed.data as V : null;
  };
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const log = deps.log ?? NO_LOG;
  const limits: ResultsLimits = { ...RESULTS_LIMITS, ...deps.limits };
  const chain = createWriteChain();
  /** Newest last. */
  let index: ResultMeta[] = [];
  let loaded = false;
  /** Result keys an index no longer names but storage may still hold (a failed remove). */
  const orphans = new Set<string>();
  /** The index started over: result keys it named are still in storage until a listing finds them. */
  let unlisted = false;
  /** The recovery of the first successful load (whichever call made it). */
  let recovery: ResultsRecovery | null = null;
  let started: Promise<ResultsRecovery> | null = null;

  const indexValue = (entries: readonly ResultMeta[]): { v: 1; entries: readonly ResultMeta[] } => ({ v: 1, entries });
  const totalBytes = (entries: readonly ResultMeta[]): number => entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const expired = (entry: ResultMeta, now: number): boolean => now - entry.savedAt > limits.ttlMs;

  async function removeKeys(keys: readonly string[]): Promise<void> {
    const all = [...new Set([...keys, ...orphans])];
    if (all.length === 0) return;
    const removed = await deps.session.remove(all);
    if (removed.ok) orphans.clear();
    else {
      for (const key of all) orphans.add(key);
      log({ level: 'warn', scope: SCOPE, msg: 'results not removed', code: removed.code, fields: { count: all.length } });
    }
  }

  /** The index could not be read or parsed: start over; its result keys are found later by a listing. */
  function startOver(reason: string, code?: 'CG-STORAGE-READ'): void {
    log({ level: 'warn', scope: SCOPE, msg: `results index ${reason}: starting empty`, ...(code ? { code } : {}) });
    index = [];
    loaded = true;
    unlisted = true;
  }

  /** Removes `result.*` keys the index does not name (after it started over); stays pending when the listing fails. */
  async function sweepUnlisted(): Promise<void> {
    if (!unlisted) return;
    const listed = await deps.session.keys();
    if (!listed.ok) {
      log({ level: 'warn', scope: SCOPE, msg: 'results keys not listed: orphans swept later', code: listed.code });
      return;
    }
    const named = new Set(index.map((entry) => keyOf(entry.opId)));
    const stray = listed.value.filter((key) => key.startsWith(SESSION_KEYS.resultPrefix) && !named.has(key));
    for (const key of stray) orphans.add(key);
    unlisted = false;
    if (stray.length > 0) log({ level: 'info', scope: SCOPE, msg: 'results the lost index named are removed', fields: { count: stray.length } });
    await removeKeys([]);
  }

  /** What a previous background left: expired results go, running ones become `interrupted` (never resumed). */
  async function recover(): Promise<ResultsRecovery> {
    const now = clock.now();
    const stale = index.filter((entry) => expired(entry, now));
    const live = index.filter((entry) => !expired(entry, now));
    const running = live.filter((entry) => !isTerminal(entry.state));
    const updates: Record<string, unknown> = {};
    const interrupted: string[] = [];
    if (running.length > 0) {
      const read = await deps.session.get(running.map((entry) => keyOf(entry.opId)));
      for (const entry of running) {
        const parsed = read.ok ? await readView(read.value[keyOf(entry.opId)]) : null;
        if (parsed === null) continue;
        const view = {
          ...parsed,
          state: 'interrupted',
          phase: { name: 'settled', since: now },
          endedAt: now,
          error: { code: 'CG-OP-INTERRUPTED' },
        };
        delete view.text;
        updates[keyOf(entry.opId)] = view;
        interrupted.push(entry.opId);
      }
    }
    const next = live
      .filter((entry) => isTerminal(entry.state) || interrupted.includes(entry.opId))
      .map((entry) => (interrupted.includes(entry.opId) ? { ...entry, state: 'interrupted' as const, savedAt: now } : entry));
    const dropped = live.filter((entry) => !next.some((kept) => kept.opId === entry.opId)).map((entry) => entry.opId);
    if (stale.length > 0 || interrupted.length > 0 || dropped.length > 0) {
      const saved = await deps.session.set({ ...updates, [INDEX_KEY]: indexValue(next) });
      if (saved.ok) {
        index = next;
        await removeKeys([...stale, ...live.filter((entry) => dropped.includes(entry.opId))].map((entry) => keyOf(entry.opId)));
      } else log({ level: 'error', scope: SCOPE, msg: 'results recovery not saved', code: saved.code });
    }
    if (interrupted.length > 0) log({ level: 'warn', scope: SCOPE, msg: 'running operations interrupted by a restart', code: 'CG-OP-INTERRUPTED', fields: { count: interrupted.length } });
    return { restored: index.length, interrupted, expired: stale.length, readable: true };
  }

  /** Reads the index once; the first successful read runs the recovery. False — the read failed. */
  async function ensureLoaded(): Promise<boolean> {
    if (loaded) return true;
    const read = await deps.session.get([INDEX_KEY]);
    if (!read.ok) return false;
    const entries = readIndex(read.value[INDEX_KEY]);
    if (entries === null) {
      startOver('unreadable');
      recovery = { restored: 0, interrupted: [], expired: 0, readable: true };
      await sweepUnlisted();
      return true;
    }
    index = entries;
    loaded = true;
    recovery = await recover();
    return true;
  }

  /** Evictions for a new index: expired, then per tab, then total bytes; finished results first, oldest first. */
  function evict(entries: ResultMeta[], keep: string, now: number): { kept: ResultMeta[]; evicted: string[] } {
    const evicted: string[] = [];
    let kept = entries.filter((entry) => {
      if (entry.opId !== keep && expired(entry, now)) {
        evicted.push(entry.opId);
        return false;
      }
      return true;
    });
    const victimOrder = (list: readonly ResultMeta[]): ResultMeta[] =>
      [...list].filter((entry) => entry.opId !== keep).sort((a, b) => Number(isTerminal(b.state)) - Number(isTerminal(a.state)) || a.savedAt - b.savedAt);
    const tabs = new Set(kept.map((entry) => entry.tabSessionId).filter((tab): tab is string => tab !== null));
    for (const tab of tabs) {
      const own = kept.filter((entry) => entry.tabSessionId === tab);
      const excess = own.length - limits.perTab;
      if (excess <= 0) continue;
      const drop = new Set(victimOrder(own).slice(0, excess).map((entry) => entry.opId));
      kept = kept.filter((entry) => !drop.has(entry.opId));
      evicted.push(...drop);
    }
    let bytes = totalBytes(kept);
    for (const victim of victimOrder(kept)) {
      if (bytes <= limits.totalBytes) break;
      bytes -= victim.bytes;
      kept = kept.filter((entry) => entry.opId !== victim.opId);
      evicted.push(victim.opId);
    }
    return { kept, evicted };
  }

  return {
    start() {
      started ??= chain(async (): Promise<ResultsRecovery> => {
        if (!(await ensureLoaded())) {
          log({ level: 'error', scope: SCOPE, msg: 'results index read failed', code: 'CG-STORAGE-READ' });
          return { restored: 0, interrupted: [], expired: 0, readable: false };
        }
        return recovery ?? { restored: index.length, interrupted: [], expired: 0, readable: true };
      });
      return started;
    },
    put(view, owner) {
      return chain(async (): Promise<ResultsPutResult> => {
        const checked = await readView(view);
        if (checked === null) return { ok: false, code: 'CG-STORAGE-WRITE', detail: 'results.put: invalid view' };
        const bytes = jsonUtf8Bytes(checked);
        if (bytes === null) return { ok: false, code: 'CG-STORAGE-WRITE', detail: 'results.put: not JSON' };
        if (bytes > RESULT_MAX_BYTES) return { ok: false, code: 'CG-STORAGE-FULL', detail: `results.put: ${bytes} > ${RESULT_MAX_BYTES} bytes` };
        // Results are a 30-minute cache: an index that cannot be read starts over rather than blocking the work.
        if (!(await ensureLoaded())) startOver('read failed', 'CG-STORAGE-READ');
        const now = clock.now();
        const previous = index.find((entry) => entry.opId === view.opId);
        const meta: ResultMeta = {
          opId: view.opId,
          tabSessionId: previous ? previous.tabSessionId : owner.tabSessionId,
          chatKey: chatKeyOf(view.target.chat),
          pageId: view.target.binding.pageId,
          state: view.state,
          savedAt: now,
          bytes,
        };
        const { kept, evicted } = evict([...index.filter((entry) => entry.opId !== view.opId), meta], view.opId, now);
        const saved = await deps.session.set({ [keyOf(view.opId)]: checked, [INDEX_KEY]: indexValue(kept) });
        if (!saved.ok) return { ok: false, code: saved.code, detail: saved.detail };
        index = kept;
        await removeKeys(evicted.map(keyOf));
        await sweepUnlisted();
        return { ok: true, evicted };
      });
    },
    get(opId) {
      return chain(async () => {
        if (!(await ensureLoaded()) || !index.some((entry) => entry.opId === opId)) return null;
        const read = await deps.session.get([keyOf(opId)]);
        if (!read.ok) return null;
        return readView(read.value[keyOf(opId)]);
      });
    },
    list(query) {
      return chain(async () => {
        if (!(await ensureLoaded())) return { ops: [], truncated: false };
        const now = clock.now();
        const matching = index
          .filter((entry) => !expired(entry, now))
          .filter((entry) => query.scope === 'all' || entry.tabSessionId === (query.tabSessionId ?? null))
          .filter((entry) => query.chatKey === undefined || entry.chatKey === query.chatKey)
          .sort((a, b) => b.savedAt - a.savedAt);
        const cap = query.scope === 'all' ? limits.listMax : limits.perTab;
        const chosen = matching.slice(0, cap);
        if (chosen.length === 0) return { ops: [], truncated: false };
        const read = await deps.session.get(chosen.map((entry) => keyOf(entry.opId)));
        if (!read.ok) return { ops: [], truncated: false };
        const ops: V[] = [];
        for (const entry of chosen) {
          const parsed = await readView(read.value[keyOf(entry.opId)]);
          if (parsed !== null) ops.push(parsed);
        }
        return { ops, truncated: matching.length > cap };
      });
    },
    removeWhere(predicate) {
      return chain(async () => {
        if (!(await ensureLoaded())) return 0;
        const gone = index.filter(predicate);
        if (gone.length === 0) return 0;
        const next = index.filter((entry) => !predicate(entry));
        const saved = await deps.session.set({ [INDEX_KEY]: indexValue(next) });
        if (!saved.ok) return 0;
        index = next;
        await removeKeys(gone.map((entry) => keyOf(entry.opId)));
        return gone.length;
      });
    },
    clear() {
      return chain(async () => {
        await ensureLoaded();
        // Every result key the area holds, not only the ones a (maybe unread) index names.
        const listed = await deps.session.keys();
        const stray = listed.ok ? listed.value.filter((key) => key.startsWith(SESSION_KEYS.resultPrefix)) : [];
        const keys = [...new Set([INDEX_KEY, ...index.map((entry) => keyOf(entry.opId)), ...orphans, ...stray])];
        const removed = await deps.session.remove(keys);
        if (!removed.ok) return false;
        orphans.clear();
        index = [];
        loaded = true;
        unlisted = !listed.ok;
        return true;
      });
    },
    sweep() {
      return chain(async () => {
        if (!(await ensureLoaded())) return 0;
        const now = clock.now();
        const stale = index.filter((entry) => expired(entry, now));
        await sweepUnlisted();
        if (stale.length === 0) {
          await removeKeys([]);
          return 0;
        }
        const next = index.filter((entry) => !expired(entry, now));
        const saved = await deps.session.set({ [INDEX_KEY]: indexValue(next) });
        if (!saved.ok) return 0;
        index = next;
        await removeKeys(stale.map((entry) => keyOf(entry.opId)));
        return stale.length;
      });
    },
    stats: () => ({ count: index.length, bytes: totalBytes(index) }),
  };
}
