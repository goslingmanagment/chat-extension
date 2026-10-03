// The X8 send journal `send.journal` in storage.local (architecture.md §6.7.7
// п. 3, §6.7.8, §9.4; X8-07, RB-007). R10's send coordinator owns the
// decisions; this store keeps the proof:
//
// - A record is written BEFORE the command goes to MAIN, in ONE set: a
//   record that did not save means no `enqueue` (`begin` answers a failure,
//   the coordinator holds). No text ever: ids, states, times.
// - One open attempt per (hubOrigin, pageId, platform, fanRef): a second
//   one is CG-SEND-BUSY, or CG-SEND-UNCERTAIN while an unresolved attempt
//   to that fan exists.
// - States move only along SEND_ATTEMPT_TRANSITIONS: never back to `ready`,
//   `uncertain` only to `sentObserved`. An observed fact is kept in memory
//   even when its write fails, and written with the next change.
// - After the event page unloads (or the browser restarts), an attempt left
//   in `preparing`, `nativeEnqueued` or `nativeAccepted` has an unknown
//   outcome: it becomes `uncertain` (§6.7.7 п. 6: the absence of a record is
//   no proof, neither is a record that stopped half-way).
// - Uncertain records live until resolved: the late linked pair
//   (`sentObserved`) or the hub's `resolve` (`release`, which refuses any
//   other state: a live attempt may still be in flight, §6.7.7 п. 6). No
//   TTL, no cap and no sign-out removes them; finished records are kept for
//   diagnostics, bounded by count and age.
// - A finished record is final: no same-state rewrite; an id once observed
//   (`pendingId`, `platformMessageId`) is never replaced by another.
// - The key is watched: when something outside the journal removes or
//   overwrites it («Очистить локальные данные», storage.local.clear) and the
//   stored value no longer holds the open records, the journal writes its
//   memory back at once — the local fan lock survives the next unload.
// - A value this build cannot interpret is never overwritten: the journal
//   is unavailable (every `begin` refused) until a read succeeds; records it
//   cannot parse are kept verbatim and hold their fan (or every fan, when
//   even the fan is unreadable).

import { STORAGE_KEYS } from '@cg/contracts/settings';
import { SEND_ATTEMPT_TRANSITIONS, type SendAttemptState } from '@cg/contracts/send-rules';
import { SendJournalEntrySchema, sendLockKey, type SendJournalEntry, type SendLockKey } from '@cg/contracts/send';

import { isPlainRecord, stableJson } from '../domain/storage';
import { NO_LOG, SYSTEM_CLOCK, createWriteChain, type Clock, type KeyValuePort, type ServiceLog, type StorageFailureCode } from './storage/ports';

/** States in which the attempt may still reach the fan: they hold the fan and are never dropped. */
export const SEND_JOURNAL_OPEN_STATES = ['preparing', 'nativeEnqueued', 'nativeAccepted', 'uncertain'] as const satisfies readonly SendAttemptState[];
/** Open states whose outcome a restart can no longer observe. */
const LIVE_STATES: readonly SendAttemptState[] = ['preparing', 'nativeEnqueued', 'nativeAccepted'];
const OPEN: readonly SendAttemptState[] = SEND_JOURNAL_OPEN_STATES;

export const isOpenSendState = (state: SendAttemptState): boolean => OPEN.includes(state);

export interface SendJournalLimits {
  /** Finished records kept for diagnostics (open ones are never counted or dropped). */
  readonly finishedKept: number;
  readonly finishedTtlMs: number;
}

export const SEND_JOURNAL_LIMITS: SendJournalLimits = { finishedKept: 200, finishedTtlMs: 24 * 60 * 60 * 1000 };

export type SendJournalRefusal = 'CG-SEND-BUSY' | 'CG-SEND-UNCERTAIN' | 'CG-STORAGE-VERSION' | StorageFailureCode;

export type SendJournalBegin =
  | { readonly ok: true; readonly entry: SendJournalEntry }
  | { readonly ok: false; readonly code: SendJournalRefusal; readonly detail: string; readonly holder?: string };

export interface SendJournalUpdate {
  readonly state: SendAttemptState;
  readonly code?: SendJournalEntry['code'];
  readonly pendingId?: SendJournalEntry['pendingId'];
  readonly platformMessageId?: SendJournalEntry['platformMessageId'];
}

export type SendJournalRelease =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unknown-attempt' | 'not-uncertain' | 'unavailable' | StorageFailureCode };

export type SendJournalAdvance =
  /** `persisted: false` — kept in memory, written with the next change; a restart sees the older state. */
  | { readonly ok: true; readonly entry: SendJournalEntry; readonly persisted: boolean }
  | { readonly ok: false; readonly code: 'unknown-attempt' | 'transition' | 'CG-STORAGE-VERSION'; readonly detail: string };

export interface SendJournalRecovery {
  readonly readable: boolean;
  readonly records: number;
  /** Attempts a previous background left half-way: now `uncertain`. */
  readonly madeUncertain: readonly string[];
  readonly uncertain: number;
  readonly unparsed: number;
}

export interface SendJournalStats {
  readonly available: boolean;
  readonly mode: SendJournalMode;
  readonly records: number;
  readonly open: number;
  readonly uncertain: number;
  readonly unparsed: number;
  readonly dirty: boolean;
}

export type SendJournalMode = 'loading' | 'ok' | 'newer' | 'unreadable';

export interface SendJournal {
  /** Load and recover; the readiness barrier runs it. Idempotent. */
  start(): Promise<SendJournalRecovery>;
  /** Journal a new attempt in `preparing` BEFORE anything goes to MAIN; a failure means: do not enqueue. */
  begin(entry: SendJournalEntry): Promise<SendJournalBegin>;
  advance(attemptId: string, update: SendJournalUpdate): Promise<SendJournalAdvance>;
  /**
   * The hub resolved an uncertain attempt (H-7 `resolve`, audited there): the
   * record leaves the journal. Only `uncertain`: a live attempt
   * (preparing, nativeEnqueued, nativeAccepted) may still reach the fan.
   */
  release(attemptId: string): Promise<SendJournalRelease>;
  get(attemptId: string): SendJournalEntry | null;
  /** Open attempts, of one fan when a lock key is given. */
  open(lockKey?: SendLockKey): readonly SendJournalEntry[];
  list(): readonly SendJournalEntry[];
  /** Drops finished records (sign-out, «Очистить локальные данные»); open ones stay. */
  removeFinished(): Promise<number>;
  stats(): SendJournalStats;
  /** The event page unloads: stop watching the key. */
  dispose(): void;
}

export interface SendJournalDeps {
  readonly local: KeyValuePort;
  readonly clock?: Clock;
  readonly log?: ServiceLog;
  readonly limits?: Partial<SendJournalLimits>;
}

const KEY = STORAGE_KEYS.sendJournal;
const VERSION = 1;
const SCOPE = 'bg.sendJournal';

/** A record this build cannot parse, kept verbatim; it holds its fan, or every fan. */
interface Unparsed {
  readonly raw: unknown;
  readonly lockKey: SendLockKey | null;
}

function rawLockKey(raw: unknown): SendLockKey | null {
  if (!isPlainRecord(raw)) return null;
  const { hubOrigin, pageId, platform, fanRef } = raw;
  if (typeof hubOrigin !== 'string' || typeof pageId !== 'number' || typeof platform !== 'string' || typeof fanRef !== 'string') return null;
  return sendLockKey({ hubOrigin, pageId, platform: platform as SendJournalEntry['platform'], fanRef });
}

export function createSendJournal(deps: SendJournalDeps): SendJournal {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const log = deps.log ?? NO_LOG;
  const limits: SendJournalLimits = { ...SEND_JOURNAL_LIMITS, ...deps.limits };
  const chain = createWriteChain();
  let mode: SendJournalMode = 'loading';
  /** Oldest first. */
  let entries: SendJournalEntry[] = [];
  let unparsed: Unparsed[] = [];
  /** Memory holds facts storage does not have yet. */
  let dirty = false;
  let started: Promise<SendJournalRecovery> | null = null;

  const value = (list: readonly SendJournalEntry[]): { v: number; entries: unknown[] } => ({ v: VERSION, entries: [...list, ...unparsed.map((item) => item.raw)] });

  /** Finished records beyond the count or older than the TTL go; open ones always stay. */
  function bounded(list: readonly SendJournalEntry[], now: number): SendJournalEntry[] {
    const finished = list.filter((entry) => !isOpenSendState(entry.state) && now - entry.updatedAt <= limits.finishedTtlMs);
    const keep = new Set(finished.slice(Math.max(0, finished.length - limits.finishedKept)));
    return list.filter((entry) => isOpenSendState(entry.state) || keep.has(entry));
  }

  async function persist(next: SendJournalEntry[]): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: StorageFailureCode; readonly detail: string }> {
    const saved = await deps.local.set({ [KEY]: value(next) });
    if (!saved.ok) return saved;
    return { ok: true };
  }

  /** Reads the key; never writes over what it could not read. */
  async function load(): Promise<{ readonly madeUncertain: string[] }> {
    const read = await deps.local.get([KEY]);
    if (!read.ok) {
      mode = 'unreadable';
      log({ level: 'error', scope: SCOPE, msg: 'send journal read failed: sends refused', code: 'CG-STORAGE-READ' });
      return { madeUncertain: [] };
    }
    const raw = read.value[KEY];
    if (raw === undefined) {
      mode = 'ok';
      entries = [];
      unparsed = [];
      return { madeUncertain: [] };
    }
    if (!isPlainRecord(raw) || typeof raw['v'] !== 'number' || !Array.isArray(raw['entries'])) {
      mode = 'unreadable';
      log({ level: 'error', scope: SCOPE, msg: 'send journal not interpretable: left untouched, sends refused', code: 'CG-STORAGE-READ' });
      return { madeUncertain: [] };
    }
    if (raw['v'] > VERSION) {
      mode = 'newer';
      log({ level: 'warn', scope: SCOPE, msg: 'send journal written by a newer build: read-only, sends refused', code: 'CG-STORAGE-VERSION', fields: { storedVersion: raw['v'] } });
      return { madeUncertain: [] };
    }
    if (raw['v'] !== VERSION) {
      mode = 'unreadable';
      log({ level: 'error', scope: SCOPE, msg: 'send journal version unknown: left untouched, sends refused', code: 'CG-STORAGE-READ' });
      return { madeUncertain: [] };
    }
    const parsed: SendJournalEntry[] = [];
    const kept: Unparsed[] = [];
    for (const item of raw['entries'] as unknown[]) {
      const entry = SendJournalEntrySchema.safeParse(item);
      if (entry.success) parsed.push(entry.data);
      else kept.push({ raw: item, lockKey: rawLockKey(item) });
    }
    mode = 'ok';
    unparsed = kept;
    if (kept.length > 0) log({ level: 'warn', scope: SCOPE, msg: 'send journal records not parsed: kept, their fans held', fields: { count: kept.length } });
    const now = clock.now();
    const madeUncertain: string[] = [];
    entries = parsed.map((entry) => {
      if (!LIVE_STATES.includes(entry.state)) return entry;
      madeUncertain.push(entry.attemptId);
      return { ...entry, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', updatedAt: Math.max(now, entry.updatedAt) };
    });
    if (madeUncertain.length > 0) {
      log({ level: 'warn', scope: SCOPE, msg: 'attempts left half-way by a previous background are uncertain', code: 'CG-SEND-UNCERTAIN', fields: { count: madeUncertain.length } });
    }
    const next = bounded(entries, now);
    if (madeUncertain.length > 0 || next.length !== entries.length) {
      entries = next;
      const saved = await persist(entries);
      dirty = !saved.ok;
      if (!saved.ok) log({ level: 'error', scope: SCOPE, msg: 'send journal recovery not saved', code: saved.code });
    }
    return { madeUncertain };
  }

  const ensureStarted = (): Promise<SendJournalRecovery> => (started ??= journal.start());

  async function retryIfUnreadable(): Promise<void> {
    if (mode === 'unreadable') await load();
  }

  const find = (attemptId: string): SendJournalEntry | undefined => entries.find((entry) => entry.attemptId === attemptId);
  const copy = (entry: SendJournalEntry): SendJournalEntry => ({ ...entry, group: { ...entry.group } });

  /** Whether a stored value still holds every open record and every unparsed one this journal keeps. */
  function holdsOpen(raw: unknown): boolean {
    if (!isPlainRecord(raw) || raw['v'] !== VERSION || !Array.isArray(raw['entries'])) return false;
    const items = raw['entries'] as unknown[];
    const ids = new Set(items.map((item) => (isPlainRecord(item) && typeof item['attemptId'] === 'string' ? item['attemptId'] : null)));
    if (!entries.every((entry) => !isOpenSendState(entry.state) || ids.has(entry.attemptId))) return false;
    if (unparsed.length === 0) return true;
    const texts = new Set(items.map((item) => stableJson(item)));
    return unparsed.every((item) => texts.has(stableJson(item.raw)));
  }

  /** Someone else changed the key: read it again; open records it lost are written back from memory. */
  async function guard(): Promise<void> {
    if (mode !== 'ok') return;
    const read = await deps.local.get([KEY]);
    if (!read.ok) {
      dirty = true;
      log({ level: 'warn', scope: SCOPE, msg: 'send journal changed outside: read failed, rewritten with the next change', code: 'CG-STORAGE-READ' });
      return;
    }
    const raw = read.value[KEY];
    if (holdsOpen(raw)) return;
    if (isPlainRecord(raw) && typeof raw['v'] === 'number' && raw['v'] > VERSION) {
      // A newer build took the key: never overwritten, sends refused; memory keeps holding its fans.
      mode = 'newer';
      log({ level: 'warn', scope: SCOPE, msg: 'send journal replaced by a newer build: read-only, sends refused', code: 'CG-STORAGE-VERSION', fields: { storedVersion: raw['v'] } });
      return;
    }
    if (raw !== undefined && !(isPlainRecord(raw) && raw['v'] === VERSION && Array.isArray(raw['entries']))) {
      mode = 'unreadable';
      log({ level: 'error', scope: SCOPE, msg: 'send journal replaced by a value this build cannot read: left untouched, sends refused', code: 'CG-STORAGE-READ' });
      return;
    }
    const saved = await persist(entries);
    dirty = !saved.ok;
    log({
      level: saved.ok ? 'warn' : 'error',
      scope: SCOPE,
      msg: 'send journal removed outside: open records written back',
      ...(saved.ok ? {} : { code: saved.code }),
      fields: { open: entries.filter((entry) => isOpenSendState(entry.state)).length + unparsed.length, saved: saved.ok },
    });
  }

  const unsubscribe = deps.local.onChanged((changes) => {
    const change = changes[KEY];
    if (change === undefined || started === null || mode !== 'ok') return;
    // Cheap filter on the event's value; the decision is a fresh read in the chain (a late echo is not a removal).
    if (holdsOpen(change.newValue)) return;
    void chain(guard);
  });

  const journal: SendJournal = {
    start() {
      started ??= chain(async () => {
        const { madeUncertain } = await load();
        return {
          readable: mode === 'ok' || mode === 'newer',
          records: entries.length,
          madeUncertain,
          uncertain: entries.filter((entry) => entry.state === 'uncertain').length,
          unparsed: unparsed.length,
        };
      });
      return started;
    },
    async begin(input) {
      await ensureStarted();
      return chain(async (): Promise<SendJournalBegin> => {
        await retryIfUnreadable();
        if (mode === 'unreadable') return { ok: false, code: 'CG-STORAGE-READ', detail: 'send journal unreadable' };
        if (mode === 'newer') return { ok: false, code: 'CG-STORAGE-VERSION', detail: 'send journal of a newer build' };
        const checked = SendJournalEntrySchema.safeParse(input);
        if (!checked.success || checked.data.state !== 'preparing') return { ok: false, code: 'CG-STORAGE-WRITE', detail: 'send journal: invalid new record' };
        const entry = checked.data;
        const existing = find(entry.attemptId);
        if (existing) {
          // The same attempt journaled twice (a repeated call): one record, never a second enqueue permit.
          return { ok: false, code: existing.state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY', detail: 'attempt already journaled', holder: existing.attemptId };
        }
        const lock = sendLockKey(entry);
        const holder = entries.find((other) => isOpenSendState(other.state) && sendLockKey(other) === lock);
        if (holder) {
          return { ok: false, code: holder.state === 'uncertain' ? 'CG-SEND-UNCERTAIN' : 'CG-SEND-BUSY', detail: 'an open attempt holds this fan', holder: holder.attemptId };
        }
        if (unparsed.some((item) => item.lockKey === null || item.lockKey === lock)) {
          return { ok: false, code: 'CG-SEND-UNCERTAIN', detail: 'an unparsed record holds this fan' };
        }
        const next = bounded([...entries, entry], clock.now());
        const saved = await persist(next);
        if (!saved.ok) {
          log({ level: 'error', scope: SCOPE, msg: 'send journal record not saved: no queue call', code: saved.code });
          return { ok: false, code: saved.code, detail: saved.detail };
        }
        entries = next;
        dirty = false;
        return { ok: true, entry: copy(entry) };
      });
    },
    async advance(attemptId, update) {
      await ensureStarted();
      return chain(async (): Promise<SendJournalAdvance> => {
        if (mode === 'newer') return { ok: false, code: 'CG-STORAGE-VERSION', detail: 'send journal of a newer build' };
        const current = find(attemptId);
        if (!current) return { ok: false, code: 'unknown-attempt', detail: 'no such attempt' };
        const allowed: readonly SendAttemptState[] = SEND_ATTEMPT_TRANSITIONS[current.state];
        // The same state again only adds facts, and only while the attempt is open: a finished record is final.
        const same = update.state === current.state && isOpenSendState(current.state);
        if (!same && !allowed.includes(update.state)) {
          log({ level: 'warn', scope: SCOPE, msg: 'send state transition refused', fields: { from: current.state, to: update.state } });
          return { ok: false, code: 'transition', detail: `${current.state} → ${update.state}` };
        }
        // An observed id is never replaced: another id is another message, not this attempt's.
        for (const field of ['pendingId', 'platformMessageId'] as const) {
          const known = current[field];
          const next = update[field];
          if (known !== undefined && next !== undefined && next !== known) {
            log({ level: 'warn', scope: SCOPE, msg: 'send journal id change refused', fields: { field, state: current.state } });
            return { ok: false, code: 'transition', detail: `${field} already set` };
          }
        }
        const candidate: SendJournalEntry = {
          ...current,
          state: update.state,
          ...(update.code !== undefined ? { code: update.code } : {}),
          ...(update.pendingId !== undefined ? { pendingId: update.pendingId } : {}),
          ...(update.platformMessageId !== undefined ? { platformMessageId: update.platformMessageId } : {}),
          updatedAt: Math.max(clock.now(), current.updatedAt),
        };
        const checked = SendJournalEntrySchema.safeParse(candidate);
        if (!checked.success) return { ok: false, code: 'transition', detail: 'invalid record after the update' };
        const next = bounded(
          entries.map((entry) => (entry.attemptId === attemptId ? checked.data : entry)),
          clock.now(),
        );
        // The fact happened: memory keeps it even if the disk does not (a restart then sees the older, open state → uncertain).
        entries = next;
        if (mode !== 'ok') {
          dirty = true;
          return { ok: true, entry: copy(checked.data), persisted: false };
        }
        const saved = await persist(next);
        dirty = !saved.ok;
        if (!saved.ok) log({ level: 'error', scope: SCOPE, msg: 'send state not saved', code: saved.code, fields: { state: update.state } });
        return { ok: true, entry: copy(checked.data), persisted: saved.ok };
      });
    },
    async release(attemptId) {
      await ensureStarted();
      return chain(async (): Promise<SendJournalRelease> => {
        if (mode !== 'ok') return { ok: false, reason: 'unavailable' };
        const current = find(attemptId);
        if (!current) return { ok: false, reason: 'unknown-attempt' };
        // Custody is lifted only on positive knowledge (§6.7.7 п. 6): the hub's resolve is for an uncertain attempt.
        if (current.state !== 'uncertain') {
          log({ level: 'warn', scope: SCOPE, msg: 'release refused: the attempt is not uncertain', fields: { state: current.state } });
          return { ok: false, reason: 'not-uncertain' };
        }
        const next = entries.filter((entry) => entry.attemptId !== attemptId);
        const saved = await persist(next);
        if (!saved.ok) {
          log({ level: 'error', scope: SCOPE, msg: 'resolved attempt not released', code: saved.code });
          return { ok: false, reason: saved.code };
        }
        entries = next;
        dirty = false;
        log({ level: 'info', scope: SCOPE, msg: 'attempt resolved by the hub: released' });
        return { ok: true };
      });
    },
    get(attemptId) {
      const entry = find(attemptId);
      return entry ? copy(entry) : null;
    },
    open(lockKey) {
      return entries.filter((entry) => isOpenSendState(entry.state) && (lockKey === undefined || sendLockKey(entry) === lockKey)).map(copy);
    },
    list: () => entries.map(copy),
    async removeFinished() {
      await ensureStarted();
      return chain(async () => {
        if (mode !== 'ok') return 0;
        const next = entries.filter((entry) => isOpenSendState(entry.state));
        const removed = entries.length - next.length;
        if (removed === 0) return 0;
        const saved = await persist(next);
        if (!saved.ok) return 0;
        entries = next;
        dirty = false;
        return removed;
      });
    },
    stats: () => ({
      available: mode === 'ok',
      mode,
      records: entries.length,
      open: entries.filter((entry) => isOpenSendState(entry.state)).length + unparsed.length,
      uncertain: entries.filter((entry) => entry.state === 'uncertain').length,
      unparsed: unparsed.length,
      dirty,
    }),
    dispose() {
      unsubscribe();
    },
  };
  return journal;
}
