// The telemetry queue of the background (architecture.md §9.6; TL-009…TL-012,
// LG-014). Events wait in storage.local (`telemetry.queue`), at most 500 —
// the oldest go and are counted — and leave in batches of up to 100, a
// second after the first one arrived, and at once on start. A failed batch
// is tried again after 1/2/4/8 s, five attempts in all; after the fifth the
// queue rests until the next event, sign-in or start, but not sooner than
// 16 s. A 400 drops the batch with a log record and a counter; 401/403 pause
// delivery until the sign-in changes. Every event is bound to the hub origin
// and the sign-in epoch it was observed under: after a sign-out or a new
// sign-in the old ones are dropped, never sent with another token.
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

/** Who may receive an event: the hub origin and the sign-in epoch it was observed under (TL-012). */
export interface TelemetryBinding {
  readonly hubOrigin: string;
  readonly epoch: number;
}

/** health reports kept at most (2 hours of windows); acceptance events take the rest of the 500. */
export const HEALTH_QUEUE_MAX = 8;

export const TELEMETRY_POLICY = {
  queueMax: TELEMETRY_LIMITS.queueMaxEvents,
  batchMax: TELEMETRY_LIMITS.batchMaxEvents,
  debounceMs: TELEMETRY_LIMITS.batchDebounceMs,
  /** Pauses after failed attempts 1–4; the fifth is the rest before the next cycle. */
  retryDelaysMs: TELEMETRY_LIMITS.retryDelaysMs,
  attempts: TELEMETRY_LIMITS.retryDelaysMs.length,
  /** An overflow is logged at most this often. */
  overflowLogEveryMs: 60_000,
} as const;

export type DropReason = 'overflow' | 'rejected' | 'stale-binding' | 'consent' | 'unsupported' | 'invalid';

export type EnqueueOutcome = 'queued' | 'no-consent' | 'signed-out' | 'unsupported';

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
  /** The current sign-in, or null. */
  readonly session: () => TelemetryBinding | null;
  /** `permissions.getAll().data_collection` includes `technicalAndInteraction`. */
  readonly consent: () => boolean;
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
}

const isHealth = (event: TelemetryEvent): event is ClientHealthV1 => event.kind === 'client_health';
const sameBinding = (a: TelemetryBinding, b: TelemetryBinding | null): boolean => b !== null && a.hubOrigin === b.hubOrigin && a.epoch === b.epoch;

function emptyDrops(): Record<DropReason, number> {
  return { overflow: 0, rejected: 0, 'stale-binding': 0, consent: 0, unsupported: 0, invalid: 0 };
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
  const record = value as { hubOrigin?: unknown; epoch?: unknown };
  if (typeof record.hubOrigin !== 'string' || !HUB_ORIGIN_PATTERN.test(record.hubOrigin)) return null;
  if (typeof record.epoch !== 'number' || !Number.isInteger(record.epoch) || record.epoch < 0) return null;
  return { hubOrigin: record.hubOrigin, epoch: record.epoch };
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
  private flushing: Promise<void> | null = null;
  private again = false;
  /** The sign-in a 401/403 came under: delivery waits for another one. */
  private paused: TelemetryBinding | null = null;
  private attempt = 0;
  /** No new cycle before this moment (the fifth pause). */
  private restUntil = 0;
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

  /** Loads the stored queue, drops what no longer belongs to this sign-in, and sends at once (TL-010). */
  async start(): Promise<void> {
    if (this.started) return;
    let stored: unknown;
    try {
      stored = await this.deps.store.load();
    } catch {
      stored = null;
    }
    const restored: Entry[] = [];
    if (stored !== null && typeof stored === 'object') {
      const record = stored as { entries?: unknown; dropped?: unknown };
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
    this.started = true;
    this.trim();
    this.discardForeign();
    this.persist();
    await this.flush();
  }

  /** Queues one event under the current sign-in (consent and support checked here and again at send). */
  enqueue(event: TelemetryEvent): EnqueueOutcome {
    try {
      if (!this.safe(this.deps.consent)) return 'no-consent';
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
    const session = this.safeSession();
    if (this.paused !== null && !sameBinding(this.paused, session)) this.paused = null;
    this.discardForeign();
    this.attempt = 0;
    this.restUntil = 0;
    this.persist();
    if (session !== null) this.schedule(0);
  }

  /** Consent changed. Revoked: stop and purge at once (§9.6); granted: deliver what comes next. */
  onConsentChanged(): void {
    if (this.safe(this.deps.consent)) {
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
    this.restUntil = 0;
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
      if (this.paused !== null) return;
      if (!this.safe(this.deps.consent)) {
        this.purge();
        return;
      }
      const session = this.safeSession();
      if (session === null) return;
      this.discardForeign();
      if (!this.safe(this.deps.healthSupported)) this.dropHealth();
      const now = this.deps.scheduler.now();
      if (now < this.restUntil) {
        this.schedule(this.restUntil - now);
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
        this.nextAttemptAt = null;
        this.persist();
      } catch (error) {
        const failure = classifyIngestFailure(error);
        this.lastFailure = { at: this.deps.scheduler.now(), status: failure.status, kind: failure.kind === 'transient' ? (failure.transport ?? 'http') : failure.kind };
        if (failure.kind === 'rejected') {
          this.remove(batch);
          this.dropped.rejected += batch.length;
          this.persist();
          const first = batch[0];
          const kind = first !== undefined && isHealth(first.event) ? 'client_health' : 'ai_acceptance';
          logEvent(this.deps.logger, 'telemetryBatchDropped', { fields: { status: failure.status, count: batch.length, kind } });
          continue;
        }
        if (failure.kind === 'auth') {
          this.paused = session;
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
          // Five attempts: the cycle ends; the events stay (bounded) for the next trigger, not before the last pause.
          this.cyclesExhausted += 1;
          this.attempt = 0;
          this.restUntil = this.deps.scheduler.now() + pause;
          this.nextAttemptAt = null;
          return;
        }
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

  /** Events of another sign-in are never sent with this one's token (TL-012). */
  private discardForeign(): void {
    const session = this.safeSession();
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
      const value: Persisted = { v: 1, entries: this.entries.map((entry) => ({ ...entry })), dropped: { ...this.dropped } };
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
      consent: this.safe(this.deps.consent),
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
