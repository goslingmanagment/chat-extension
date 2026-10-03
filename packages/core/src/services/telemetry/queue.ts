// The telemetry queue of the background (architecture.md §9.6; TL-009…TL-012,
// LG-014). Events wait in storage.local (`telemetry.queue`), at most 500 —
// the oldest go and are counted — and leave in batches of up to 100, a
// second after the first one arrived, and at once on start. A failed batch
// is tried again after 1/2/4/8 s, five attempts in all; after the fifth
// failure the batch is dropped with a log record and a counter (as both
// predecessors did), and the rest of the queue waits 16 s. A 400 drops the
// batch the same way; 401/403 pause delivery until the sign-in changes (the
// pause is stored with the queue). Every event is bound to the hub origin,
// the user and the sign-in epoch it was observed under: after a sign-out or
// a new sign-in the old ones are dropped, never sent with another token. A
// failure that comes back after the sign-in changed counts against nothing.
//
// Start-up order: the sign-in and the consent are read from callbacks that
// may not know yet (the event page restores them asynchronously). A null
// sign-in before the first `onSessionChanged()` means «not restored yet»:
// stored events stay. A `null` consent means «not read yet»: nothing is
// queued or sent, nothing is purged; only a definite `false` purges.
//
// Consent: nothing is queued or sent without `technicalAndInteraction`;
// revoking it stops delivery and purges the queue at once (local diagnostics
// stay). `client_health` goes only while bootstrap advertises
// `client-health-perf-v1`, in a batch of its own. No content of the events
// ever reaches a log or the diagnostics — counts and states only.

import { HUB_ORIGIN_PATTERN } from '@cg/contracts/primitives';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import { type IngestResult } from '@cg/contracts/hub';
import { AcceptanceEventSchema, ClientHealthV1Schema, type AcceptanceEvent, type ClientHealthV1 } from '@cg/contracts/telemetry';

import { logEvent, type Logger } from '../../domain/logging';
import { type KeyValuePort, type Scheduler } from '../ports';

export type TelemetryEvent = AcceptanceEvent | ClientHealthV1;

/** Who may receive an event: the hub origin, the user and the sign-in epoch it was observed under (TL-012, §6.7.4). */
export interface TelemetryBinding {
  readonly hubOrigin: string;
  /** SessionIdentity.userId. */
  readonly userId: number;
  readonly epoch: number;
}

/** health reports kept at most (2 hours of windows); acceptance events take the rest of the 500. */
export const HEALTH_QUEUE_MAX = 8;

export const TELEMETRY_POLICY = {
  queueMax: TELEMETRY_LIMITS.queueMaxEvents,
  batchMax: TELEMETRY_LIMITS.batchMaxEvents,
  debounceMs: TELEMETRY_LIMITS.batchDebounceMs,
  /** Pauses after failed attempts 1–4; after the fifth the batch is dropped and the rest waits the last one. */
  retryDelaysMs: TELEMETRY_LIMITS.retryDelaysMs,
  attempts: TELEMETRY_LIMITS.retryDelaysMs.length,
  /** An overflow is logged at most this often. */
  overflowLogEveryMs: 60_000,
} as const;

export type DropReason = 'overflow' | 'rejected' | 'exhausted' | 'stale-binding' | 'consent' | 'unsupported' | 'invalid';

export type QueueOutcome = 'queued' | 'no-consent' | 'signed-out' | 'unsupported';

export interface TelemetryQueueStats {
  readonly consent: boolean;
  readonly queued: number;
  readonly queuedHealth: number;
  readonly inFlight: boolean;
  readonly paused: 'auth' | null;
  /** Failed attempts of the current cycle. */
  readonly attempt: number;
  readonly nextAttemptAt: number | null;
  readonly sent: number;
  readonly duplicates: number;
  readonly dropped: Readonly<Record<DropReason, number>>;
  /** All drops together (`diagnostics.get` telemetry.dropped). */
  readonly droppedTotal: number;
  /** Batches dropped after five failed attempts. */
  readonly cyclesExhausted: number;
  /** The last failure, by its facts only. */
  readonly lastFailure: { readonly at: number; readonly status: number | null; readonly kind: string } | null;
  readonly lastSentAt: number | null;
}

export interface TelemetryQueueDeps {
  readonly scheduler: Scheduler;
  /** storage.local `telemetry.queue`. */
  readonly store: KeyValuePort;
  /** HubFacade.ingest. */
  readonly ingest: (events: readonly TelemetryEvent[]) => Promise<IngestResult>;
  readonly logger: Logger;
  /** The current sign-in, or null (signed out, or not restored yet before the first `onSessionChanged()`). */
  readonly session: () => TelemetryBinding | null;
  /** `permissions.getAll().data_collection` includes `technicalAndInteraction`; `null` while not read yet. */
  readonly consent: () => boolean | null;
  /** Bootstrap advertises `client-health-perf-v1`. */
  readonly healthSupported: () => boolean;
}

interface Entry {
  readonly event: TelemetryEvent;
  readonly binding: TelemetryBinding;
  readonly queuedAt: number;
}

interface Persisted {
  readonly v: 1;
  readonly entries: readonly Entry[];
  readonly dropped: Readonly<Record<DropReason, number>>;
  /** The sign-in a 401/403 came under, so a restarted event page does not try it again. */
  readonly paused: TelemetryBinding | null;
}

const isHealth = (event: TelemetryEvent): event is ClientHealthV1 => event.kind === 'client_health';
const sameBinding = (a: TelemetryBinding, b: TelemetryBinding | null): boolean =>
  b !== null && a.hubOrigin === b.hubOrigin && a.userId === b.userId && a.epoch === b.epoch;

function emptyDrops(): Record<DropReason, number> {
  return { overflow: 0, rejected: 0, exhausted: 0, 'stale-binding': 0, consent: 0, unsupported: 0, invalid: 0 };
}

/** How a failed ingest call is treated, by the HubCallError facts only (never its message). */
export type IngestFailure =
  | { readonly kind: 'rejected'; readonly status: number }
  | { readonly kind: 'auth'; readonly status: number }
  | { readonly kind: 'transient'; readonly status: number | null; readonly transport: string | null; readonly retryAfterMs: number | null };

export function classifyIngestFailure(error: unknown): IngestFailure {
  const failure = error !== null && typeof error === 'object' ? (error as { failure?: unknown }).failure : undefined;
  if (failure !== null && typeof failure === 'object') {
    const facts = failure as { kind?: unknown; status?: unknown; failure?: unknown; retryAfterMs?: unknown };
    if (facts.kind === 'http' && typeof facts.status === 'number') {
      if (facts.status === 400) return { kind: 'rejected', status: 400 };
      if (facts.status === 401 || facts.status === 403) return { kind: 'auth', status: facts.status };
      const retryAfterMs = typeof facts.retryAfterMs === 'number' && Number.isFinite(facts.retryAfterMs) && facts.retryAfterMs >= 0 ? facts.retryAfterMs : null;
      return { kind: 'transient', status: facts.status, transport: null, retryAfterMs };
    }
    if (facts.kind === 'transport' && typeof facts.failure === 'string') return { kind: 'transient', status: null, transport: facts.failure, retryAfterMs: null };
  }
  return { kind: 'transient', status: null, transport: 'unknown', retryAfterMs: null };
}

function readBinding(value: unknown): TelemetryBinding | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as { hubOrigin?: unknown; userId?: unknown; epoch?: unknown };
  if (typeof record.hubOrigin !== 'string' || !HUB_ORIGIN_PATTERN.test(record.hubOrigin)) return null;
  if (typeof record.userId !== 'number' || !Number.isInteger(record.userId) || record.userId < 1) return null;
  if (typeof record.epoch !== 'number' || !Number.isInteger(record.epoch) || record.epoch < 0) return null;
  return { hubOrigin: record.hubOrigin, userId: record.userId, epoch: record.epoch };
}

function readEvent(value: unknown): TelemetryEvent | null {
  const acceptance = AcceptanceEventSchema.safeParse(value);
  if (acceptance.success) return acceptance.data;
  const health = ClientHealthV1Schema.safeParse(value);
  return health.success ? health.data : null;
}

export class TelemetryQueue {
  private entries: Entry[] = [];
  private dropped = emptyDrops();
  private started = false;
  private starting: Promise<void> | null = null;
  /** The sign-in state is known: `onSessionChanged()` ran or `session()` named one. Before, a null sign-in is «not restored yet». */
  private sessionKnown = false;
  private flushing: Promise<void> | null = null;
  private again = false;
  /** The sign-in a 401/403 came under: delivery waits for another one. */
  private paused: TelemetryBinding | null = null;
  private attempt = 0;
  /** No send before this moment: the pause after a failed attempt, or the rest after a dropped batch. */
  private notBefore = 0;
  private nextAttemptAt: number | null = null;
  private cancelTimer: (() => void) | null = null;
  private sent = 0;
  private duplicates = 0;
  private cyclesExhausted = 0;
  private lastFailure: TelemetryQueueStats['lastFailure'] = null;
  private lastSentAt: number | null = null;
  private lastOverflowLog = Number.NEGATIVE_INFINITY;
  private saveQueued = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TelemetryQueueDeps) {}

  /** Loads the stored queue, drops what no longer belongs to this sign-in, and sends at once (TL-010). Runs once, however often it is called. */
  start(): Promise<void> {
    this.starting ??= this.load();
    return this.starting;
  }

  private async load(): Promise<void> {
    let stored: unknown;
    try {
      stored = await this.deps.store.load();
    } catch {
      stored = null;
    }
    const restored: Entry[] = [];
    let paused: TelemetryBinding | null = null;
    if (stored !== null && typeof stored === 'object') {
      const record = stored as { entries?: unknown; dropped?: unknown; paused?: unknown };
      paused = readBinding(record.paused);
      if (Array.isArray(record.entries)) {
        for (const raw of record.entries as unknown[]) {
          const item = raw !== null && typeof raw === 'object' ? (raw as { event?: unknown; binding?: unknown; queuedAt?: unknown }) : {};
          const event = readEvent(item.event);
          const binding = readBinding(item.binding);
          if (event === null || binding === null) {
            this.dropped.invalid += 1;
            continue;
          }
          restored.push({ event, binding, queuedAt: typeof item.queuedAt === 'number' && Number.isFinite(item.queuedAt) ? item.queuedAt : 0 });
        }
      }
      if (record.dropped !== null && typeof record.dropped === 'object') {
        for (const reason of Object.keys(this.dropped) as DropReason[]) {
          const count = (record.dropped as Record<string, unknown>)[reason];
          if (typeof count === 'number' && Number.isInteger(count) && count > 0) this.dropped[reason] += count;
        }
      }
    }
    // Events queued while start() was loading are newer than the stored ones.
    this.entries = [...restored, ...this.entries];
    // A pause set while loading is newer than the stored one.
    this.paused ??= paused;
    this.started = true;
    this.trim();
    this.discardForeign();
    this.persist();
    await this.flush();
  }

  /** Queues one event under the current sign-in (consent and support checked here and again at send). */
  add(event: TelemetryEvent): QueueOutcome {
    try {
      if (this.consent() !== true) return 'no-consent';
      const binding = this.safeSession();
      if (binding === null) return 'signed-out';
      if (isHealth(event) && !this.safe(this.deps.healthSupported)) return 'unsupported';
      this.entries.push({ event, binding, queuedAt: this.deps.scheduler.now() });
      this.trim();
      this.persist();
      this.schedule(TELEMETRY_POLICY.debounceMs);
      return 'queued';
    } catch {
      return 'no-consent';
    }
  }

  /** Sign-in changed (a new epoch or origin) or signed out: old bindings are dropped, a pause lifts. */
  onSessionChanged(): void {
    this.sessionKnown = true;
    const session = this.safeSession();
    if (this.paused !== null && !sameBinding(this.paused, session)) this.paused = null;
    this.discardForeign();
    this.attempt = 0;
    this.notBefore = 0;
    this.persist();
    if (session !== null) this.schedule(0);
  }

  /** Consent changed. Revoked: stop and purge at once (§9.6); granted: deliver what waits; still unknown: nothing. */
  onConsentChanged(): void {
    const consent = this.consent();
    if (consent === null) return;
    if (consent) {
      this.schedule(0);
      return;
    }
    const purged = this.purge();
    logEvent(this.deps.logger, 'telemetryConsentRevoked', { fields: { purged } });
  }

  /** Without consent nothing waits: the queue goes, its timers too. */
  private purge(): number {
    this.cancel();
    const purged = this.entries.length;
    this.entries = [];
    this.dropped.consent += purged;
    this.attempt = 0;
    this.notBefore = 0;
    if (purged > 0) this.persist();
    return purged;
  }

  /** Bootstrap changed: health events without support go, the rest is tried. */
  onCapabilitiesChanged(): void {
    if (!this.safe(this.deps.healthSupported)) this.dropHealth();
    this.schedule(0);
  }

  /** Sends what can be sent now; resolves when the queue is idle. Never rejects. */
  flush(): Promise<void> {
    if (this.flushing !== null) {
      this.again = true;
      return this.flushing;
    }
    const run = this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.flushing = null;
        if (this.again) {
          this.again = false;
          void this.flush();
        }
      });
    this.flushing = run;
    return run;
  }

  private async drain(): Promise<void> {
    if (!this.started) return;
    for (;;) {
      const consent = this.consent();
      // Not read yet: wait for onConsentChanged(), purge nothing.
      if (consent === null) return;
      if (!consent) {
        this.purge();
        return;
      }
      const session = this.safeSession();
      // A pause of another sign-in is over (onSessionChanged may have run before the 401 came back).
      if (this.paused !== null && session !== null && !sameBinding(this.paused, session)) {
        this.paused = null;
        this.persist();
      }
      if (this.paused !== null) return;
      if (session === null) return;
      this.discardForeign();
      if (!this.safe(this.deps.healthSupported)) this.dropHealth();
      const now = this.deps.scheduler.now();
      if (now < this.notBefore) {
        this.schedule(this.notBefore - now);
        return;
      }
      const acceptance = this.entries.filter((entry) => !isHealth(entry.event));
      const batch = (acceptance.length > 0 ? acceptance : this.entries.filter((entry) => isHealth(entry.event))).slice(0, TELEMETRY_POLICY.batchMax);
      if (batch.length === 0) {
        this.attempt = 0;
        return;
      }
      try {
        const result = await this.deps.ingest(batch.map((entry) => entry.event));
        this.remove(batch);
        this.sent += Math.max(0, result.accepted);
        this.duplicates += Math.max(0, result.duplicates);
        this.lastSentAt = this.deps.scheduler.now();
        this.attempt = 0;
        this.notBefore = 0;
        this.nextAttemptAt = null;
        this.persist();
      } catch (error) {
        const failure = classifyIngestFailure(error);
        this.lastFailure = { at: this.deps.scheduler.now(), status: failure.status, kind: failure.kind === 'transient' ? (failure.transport ?? 'http') : failure.kind };
        // The sign-in changed while the batch was on its way: its events belong to the old one and go
        // on the next turn; the failure counts against nothing (no pause, no attempt of the new sign-in).
        if (!sameBinding(session, this.safeSession())) continue;
        if (failure.kind === 'rejected') {
          this.dropBatch(batch, 'rejected', failure.status);
          continue;
        }
        if (failure.kind === 'auth') {
          this.paused = session;
          this.persist();
          logEvent(this.deps.logger, 'telemetryPaused', { fields: { status: failure.status, queued: this.entries.length } });
          return;
        }
        this.attempt += 1;
        const delays = TELEMETRY_POLICY.retryDelaysMs;
        const pause = Math.max(delays[Math.min(this.attempt, delays.length) - 1] ?? 0, failure.retryAfterMs ?? 0);
        logEvent(this.deps.logger, 'telemetryDeliveryFailed', {
          fields: { status: failure.status, failure: failure.transport, attempt: this.attempt, queued: this.entries.length },
        });
        if (this.attempt >= TELEMETRY_POLICY.attempts) {
          // Five attempts: the batch goes (TL-009); the rest of the queue waits the last pause.
          this.cyclesExhausted += 1;
          this.attempt = 0;
          this.dropBatch(batch, 'exhausted', failure.status);
          this.notBefore = this.deps.scheduler.now() + pause;
          this.cancel();
          if (this.entries.length > 0) this.schedule(pause);
          return;
        }
        // A new event does not cut the pause short.
        this.notBefore = this.deps.scheduler.now() + pause;
        this.cancel();
        this.schedule(pause);
        return;
      }
    }
  }

  private schedule(ms: number): void {
    if (!this.started) return;
    const at = this.deps.scheduler.now() + Math.max(0, ms);
    if (this.cancelTimer !== null && this.nextAttemptAt !== null && this.nextAttemptAt <= at) return;
    this.cancel();
    this.nextAttemptAt = at;
    this.cancelTimer = this.deps.scheduler.after(Math.max(0, ms), () => {
      this.cancelTimer = null;
      this.nextAttemptAt = null;
      void this.flush();
    });
  }

  private cancel(): void {
    if (this.cancelTimer === null) return;
    try {
      this.cancelTimer();
    } catch {
      // Already fired.
    }
    this.cancelTimer = null;
    this.nextAttemptAt = null;
  }

  private remove(batch: readonly Entry[]): void {
    const gone = new Set(batch);
    this.entries = this.entries.filter((entry) => !gone.has(entry));
  }

  /** A batch given up (400, or five failed attempts): counted and logged by its kind, never by its content. */
  private dropBatch(batch: readonly Entry[], reason: 'rejected' | 'exhausted', status: number | null): void {
    this.remove(batch);
    this.dropped[reason] += batch.length;
    this.persist();
    const first = batch[0];
    const kind = first !== undefined && isHealth(first.event) ? 'client_health' : 'ai_acceptance';
    logEvent(this.deps.logger, 'telemetryBatchDropped', { fields: { status, count: batch.length, kind, reason } });
  }

  /** Oldest out beyond 500 events, and beyond 8 health reports. */
  private trim(): void {
    let overflow = 0;
    const health = this.entries.filter((entry) => isHealth(entry.event));
    if (health.length > HEALTH_QUEUE_MAX) {
      const drop = new Set(health.slice(0, health.length - HEALTH_QUEUE_MAX));
      this.entries = this.entries.filter((entry) => !drop.has(entry));
      overflow += drop.size;
    }
    if (this.entries.length > TELEMETRY_POLICY.queueMax) {
      const over = this.entries.length - TELEMETRY_POLICY.queueMax;
      this.entries.splice(0, over);
      overflow += over;
    }
    if (overflow === 0) return;
    this.dropped.overflow += overflow;
    const now = this.deps.scheduler.now();
    if (now - this.lastOverflowLog >= TELEMETRY_POLICY.overflowLogEveryMs) {
      this.lastOverflowLog = now;
      logEvent(this.deps.logger, 'telemetryQueueOverflow', { fields: { dropped: overflow, queued: this.entries.length } });
    }
  }

  /** Events of another sign-in are never sent with this one's token (TL-012). Before the sign-in is known, nothing is judged. */
  private discardForeign(): void {
    const session = this.safeSession();
    if (session !== null) this.sessionKnown = true;
    if (!this.sessionKnown) return;
    const keep = this.entries.filter((entry) => sameBinding(entry.binding, session));
    const stale = this.entries.length - keep.length;
    if (stale === 0) return;
    this.entries = keep;
    this.dropped['stale-binding'] += stale;
  }

  private dropHealth(): void {
    const keep = this.entries.filter((entry) => !isHealth(entry.event));
    const gone = this.entries.length - keep.length;
    if (gone === 0) return;
    this.entries = keep;
    this.dropped.unsupported += gone;
    this.persist();
  }

  /** One save per turn of the event loop, in order; a failed save is logged and the queue goes on in memory. */
  private persist(): void {
    if (!this.started || this.saveQueued) return;
    this.saveQueued = true;
    this.saving = this.saving.then(async () => {
      this.saveQueued = false;
      const value: Persisted = { v: 1, entries: this.entries.map((entry) => ({ ...entry })), dropped: { ...this.dropped }, paused: this.paused };
      try {
        await this.deps.store.save(value);
      } catch {
        logEvent(this.deps.logger, 'telemetryStoreFailed', { fields: { queued: value.entries.length } });
      }
    });
  }

  /** Resolves when the last save finished (tests, suspend). */
  saved(): Promise<void> {
    return this.saving;
  }

  private safe(read: () => boolean): boolean {
    try {
      return read();
    } catch {
      return false;
    }
  }

  /** true / false, or null while not read yet; a throwing reader is a «no». */
  private consent(): boolean | null {
    try {
      const value = this.deps.consent();
      return value === null ? null : value === true;
    } catch {
      return false;
    }
  }

  private safeSession(): TelemetryBinding | null {
    try {
      return this.deps.session();
    } catch {
      return null;
    }
  }

  /** Metadata only (TL-011): counts, states, the last failure's status. */
  stats(): TelemetryQueueStats {
    const dropped = { ...this.dropped };
    return {
      consent: this.consent() === true,
      queued: this.entries.length,
      queuedHealth: this.entries.filter((entry) => isHealth(entry.event)).length,
      inFlight: this.flushing !== null,
      paused: this.paused === null ? null : 'auth',
      attempt: this.attempt,
      nextAttemptAt: this.nextAttemptAt,
      sent: this.sent,
      duplicates: this.duplicates,
      dropped,
      droppedTotal: Object.values(dropped).reduce((a, b) => a + b, 0),
      cyclesExhausted: this.cyclesExhausted,
      lastFailure: this.lastFailure,
      lastSentAt: this.lastSentAt,
    };
  }
}
