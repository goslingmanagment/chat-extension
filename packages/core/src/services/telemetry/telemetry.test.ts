import { ANCHOR_IDS, HOST_CAPABILITIES, type HostContractReport, type SiteContractReport } from '@cg/contracts/host';
import { type HostKind } from '@cg/contracts/hosts';
import { type IngestResult } from '@cg/contracts/hub';
import { TELEMETRY_LIMITS } from '@cg/contracts/limits';
import { type LogRecord } from '@cg/contracts/logs';
import { ClientHealthV1Schema, TabHealthReportSchema, type AcceptanceEvent, type ClientHealthV1 } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../domain/logging';
import { AcceptanceTracker, HealthWindow, TabHealthCollector } from '../../domain/telemetry';
import { type KeyValuePort, type Scheduler } from '../ports';
import {
  AcceptanceReporter,
  HEALTH_QUEUE_MAX,
  HEALTH_WINDOWS_MAX,
  HealthReporter,
  TELEMETRY_POLICY,
  TelemetryQueue,
  classifyIngestFailure,
  type TelemetryBinding,
  type TelemetryEvent,
} from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const HUB = 'https://hub.example.test';
const USER = 7;
const SIGNED_IN: TelemetryBinding = { hubOrigin: HUB, userId: USER, epoch: 1 };
const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GEN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const TAB = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';
const CLIENT = { version: '0.1.0', browserMajor: 157, os: 'macos' } as const;

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function clock(start = T0) {
  let now = start;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const scheduler: Scheduler = {
    now: () => now,
    after: (ms, fn) => {
      const id = ++ids;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
  };
  return {
    scheduler,
    get now() {
      return now;
    },
    async tick(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        timers = timers.filter((t) => t.id !== due.id);
        now = Math.max(now, due.at);
        due.fn();
        await settle();
      }
      now = end;
      await settle();
    },
    get timers() {
      return timers.map((t) => t.at - now);
    },
  };
}

class MemoryKv implements KeyValuePort {
  value: unknown = null;
  saves = 0;
  failSave = false;
  load(): Promise<unknown> {
    return Promise.resolve(this.value);
  }
  save(value: unknown): Promise<void> {
    if (this.failSave) return Promise.reject(new Error('quota'));
    this.saves += 1;
    this.value = JSON.parse(JSON.stringify(value)) as unknown;
    return Promise.resolve();
  }
}

/** Shaped like the facade's HubCallError: the route and the failure facts. */
class FakeHubCallError extends Error {
  override readonly name = 'HubCallError';
  readonly route = 'ingestObservations';
  readonly epoch = 1;
  constructor(readonly failure: unknown) {
    super('hub call failed');
  }
}

function hubError(status: number, retryAfterMs: number | null = null): FakeHubCallError {
  return new FakeHubCallError({ kind: 'http', status, error: null, reason: null, retryAfterMs });
}

let uuidCounter = 0;
function acceptance(n = 0): AcceptanceEvent {
  uuidCounter += 1;
  return {
    clientEventId: `00000000-0000-4000-8000-${String(uuidCounter * 1000 + n).padStart(12, '0')}`,
    kind: 'ai_acceptance',
    observedAt: new Date(T0).toISOString(),
    pageLabel: 'lora-of',
    payload: { generationRef: GEN, lifecycle: 'shown', opId: OP, feature: 'reply', surface: 'dock' },
  };
}

function health(at = T0): ClientHealthV1 {
  return new HealthWindow(at).build(at + 1000, 'chatspace', CLIENT, { cachesKB: 1, logsKB: 1 });
}

function harness(options: { consent?: boolean | null; supported?: boolean; session?: TelemetryBinding | null } = {}) {
  const c = clock();
  const kv = new MemoryKv();
  const records: LogRecord[] = [];
  const logger = createLogger({ now: () => c.now, debugEnabled: () => false, sinks: [(r) => records.push(r)] });
  const state: { consent: boolean | null; supported: boolean; session: TelemetryBinding | null } = {
    consent: options.consent === undefined ? true : options.consent,
    supported: options.supported ?? true,
    session: options.session === undefined ? SIGNED_IN : options.session,
  };
  const calls: TelemetryEvent[][] = [];
  let answer: (events: readonly TelemetryEvent[]) => Promise<IngestResult> = (events) => Promise.resolve({ accepted: events.length, duplicates: 0 });
  const queue = new TelemetryQueue({
    scheduler: c.scheduler,
    store: kv,
    logger,
    ingest: (events) => {
      calls.push([...events]);
      return answer(events);
    },
    session: () => state.session,
    consent: () => state.consent,
    healthSupported: () => state.supported,
  });
  return {
    c,
    kv,
    queue,
    records,
    state,
    calls,
    answerWith(fn: typeof answer) {
      answer = fn;
    },
    messages: () => records.map((r) => r.msg),
  };
}

describe('[TL-009] the telemetry queue', () => {
  it('[TL-009] batches of up to 100, a second after the first event', async () => {
    const h = harness();
    await h.queue.start();
    for (let i = 0; i < 150; i += 1) expect(h.queue.add(acceptance(i))).toBe('queued');
    await h.c.tick(TELEMETRY_POLICY.debounceMs - 1);
    expect(h.calls).toHaveLength(0);
    await h.c.tick(1);
    expect(h.calls.map((b) => b.length)).toEqual([100, 50]);
    expect(h.queue.stats()).toMatchObject({ queued: 0, sent: 150, attempt: 0 });
    expect(h.queue.stats().lastSentAt).toBe(T0 + 1000);
  });

  it('[TL-009] at most 500 events: the oldest go, counted and logged once a minute', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    for (let i = 0; i < 520; i += 1) h.queue.add(acceptance(i));
    expect(h.queue.stats()).toMatchObject({ queued: 500, dropped: { overflow: 20 } });
    expect(h.messages().filter((m) => m === 'telemetry queue overflow')).toHaveLength(1);
    expect(TELEMETRY_POLICY.queueMax).toBe(TELEMETRY_LIMITS.queueMaxEvents);
  });

  it('[TL-009] five attempts with pauses 1/2/4/8 s, then the batch is dropped and the rest waits 16 s; failures logged (LG-014)', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(new FakeHubCallError({ kind: 'transport', failure: 'network' })));
    for (let i = 0; i < 101; i += 1) h.queue.add(acceptance(i));
    await h.c.tick(1000);
    expect(h.calls).toHaveLength(1);
    for (const pause of [1000, 2000, 4000, 8000]) {
      await h.c.tick(pause - 1);
      const before = h.calls.length;
      await h.c.tick(1);
      expect(h.calls.length).toBe(before + 1);
    }
    expect(h.calls.map((b) => b.length)).toEqual([100, 100, 100, 100, 100]);
    expect(h.queue.stats()).toMatchObject({ queued: 1, cyclesExhausted: 1, attempt: 0, dropped: { exhausted: 100 }, lastFailure: { kind: 'network', status: null } });
    expect(h.messages().filter((m) => m === 'telemetry delivery failed')).toHaveLength(5);
    expect(h.records.find((r) => r.msg === 'telemetry batch dropped')?.fields).toEqual({ status: null, count: 100, kind: 'ai_acceptance', reason: 'exhausted' });
    // The rest goes after the 16 s rest by itself; a new event does not cut the rest short.
    h.answerWith((events) => Promise.resolve({ accepted: events.length, duplicates: 1 }));
    h.queue.add(acceptance());
    await h.c.tick(15_999);
    expect(h.calls).toHaveLength(5);
    await h.c.tick(1);
    expect(h.calls.map((b) => b.length)).toEqual([100, 100, 100, 100, 100, 2]);
    expect(h.queue.stats()).toMatchObject({ queued: 0, sent: 2, duplicates: 1 });
  });

  it('[TL-009] a new event does not cut a retry pause short', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    expect(h.calls).toHaveLength(1);
    // Fails at t+1 s: the next attempt is due at t+2 s. An event at t+1.5 s schedules a send at t+2.5 s at the earliest.
    h.answerWith(() => Promise.reject(hubError(503)));
    await h.c.tick(500);
    h.queue.add(acceptance());
    await h.c.tick(499);
    expect(h.calls).toHaveLength(1);
    await h.c.tick(1);
    expect(h.calls).toHaveLength(2);
    // Attempt 2 failed: the pause is 2 s, the debounce of the new event (1 s) waits for it.
    await h.c.tick(1999);
    expect(h.calls).toHaveLength(2);
    await h.c.tick(1);
    expect(h.calls).toHaveLength(3);
  });

  it('[TL-009] a new event during the 8 s pause after the fourth attempt waits for all of it', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    await h.c.tick(1000 + 1000 + 2000 + 4000);
    expect(h.calls).toHaveLength(4);
    expect(h.queue.stats()).toMatchObject({ attempt: 4, nextAttemptAt: h.c.now + 8000 });
    await h.c.tick(500);
    h.queue.add(acceptance());
    await h.c.tick(7499);
    expect(h.calls).toHaveLength(4);
    await h.c.tick(1);
    expect(h.calls).toHaveLength(5);
  });

  it('[TL-009] a 429 waits at least its Retry-After', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(429, 30_000)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    expect(h.queue.stats().nextAttemptAt).toBe(h.c.now + 30_000);
    expect(classifyIngestFailure(hubError(502))).toEqual({ kind: 'transient', status: 502, transport: null, retryAfterMs: null });
    expect(classifyIngestFailure(new Error('weird'))).toEqual({ kind: 'transient', status: null, transport: 'unknown', retryAfterMs: null });
  });

  it('[TL-009] a 400 drops the batch with a log record and a counter, and the rest goes on', async () => {
    const h = harness();
    await h.queue.start();
    let first = true;
    h.answerWith((events) => {
      if (first) {
        first = false;
        return Promise.reject(hubError(400));
      }
      return Promise.resolve({ accepted: events.length, duplicates: 0 });
    });
    for (let i = 0; i < 130; i += 1) h.queue.add(acceptance(i));
    await h.c.tick(1000);
    expect(h.calls.map((b) => b.length)).toEqual([100, 30]);
    expect(h.queue.stats()).toMatchObject({ queued: 0, sent: 30, dropped: { rejected: 100 } });
    const dropped = h.records.find((r) => r.msg === 'telemetry batch dropped');
    expect(dropped?.fields).toEqual({ status: 400, count: 100, kind: 'ai_acceptance', reason: 'rejected' });
  });

  it('[TL-009] the queue survives a restart in storage.local; junk is dropped and counted', async () => {
    const h = harness();
    h.answerWith(() => Promise.reject(hubError(503)));
    await h.queue.start();
    h.queue.add(acceptance(1));
    h.queue.add(acceptance(2));
    await h.queue.saved();
    const stored = h.kv.value as { entries: unknown[] };
    expect(stored.entries).toHaveLength(2);
    const again = harness();
    again.kv.value = { v: 1, entries: [...stored.entries, { event: { kind: 'ai_acceptance' }, binding: SIGNED_IN }, 'junk'], dropped: { overflow: 3, bogus: 9 } };
    await again.queue.start();
    expect(again.calls.map((b) => b.length)).toEqual([2]);
    expect(again.queue.stats().dropped).toMatchObject({ invalid: 2, overflow: 3 });
  });

  it('[TL-009] a failed save is logged and the queue goes on in memory', async () => {
    const h = harness();
    h.kv.failSave = true;
    await h.queue.start();
    await h.queue.saved();
    expect(h.messages()).toContain('telemetry queue not saved');
  });
});

describe('[TL-010] [TL-011] start and stats', () => {
  it('[TL-010] what was stored is sent at once on start', async () => {
    const h = harness();
    h.kv.value = { v: 1, entries: [{ event: acceptance(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await h.queue.start();
    expect(h.calls).toHaveLength(1);
    expect(h.queue.stats().queued).toBe(0);
    await h.queue.start();
    expect(h.calls).toHaveLength(1);
  });

  it('[TL-010] events queued before start wait for it', async () => {
    const h = harness();
    h.queue.add(acceptance());
    await h.c.tick(5000);
    expect(h.calls).toHaveLength(0);
    await h.queue.start();
    expect(h.calls).toHaveLength(1);
  });

  it('[TL-010] a restart before the sign-in is restored keeps the stored events', async () => {
    const h = harness({ session: null });
    h.kv.value = { v: 1, entries: [{ event: acceptance(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await h.queue.start();
    await h.queue.saved();
    expect(h.queue.stats()).toMatchObject({ queued: 1, dropped: { 'stale-binding': 0 } });
    expect((h.kv.value as { entries: unknown[] }).entries).toHaveLength(1);
    // The sign-in comes back: the stored event goes with it.
    h.state.session = SIGNED_IN;
    h.queue.onSessionChanged();
    await h.c.tick(0);
    expect(h.calls).toHaveLength(1);
    expect(h.queue.stats()).toMatchObject({ queued: 0, sent: 1 });
    // Restored as signed out: the old events go, never sent.
    const out = harness({ session: null });
    out.kv.value = { v: 1, entries: [{ event: acceptance(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await out.queue.start();
    out.queue.onSessionChanged();
    expect(out.queue.stats()).toMatchObject({ queued: 0, dropped: { 'stale-binding': 1 } });
    expect(out.calls).toHaveLength(0);
  });

  it('[TL-010] start() called twice at once loads the stored queue once', async () => {
    const h = harness();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.kv.value = { v: 1, entries: [{ event: health(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await Promise.all([h.queue.start(), h.queue.start()]);
    expect(h.queue.stats().queued).toBe(1);
    expect(h.calls.map((b) => b.length)).toEqual([1]);
  });

  it('[TL-011] stats are metadata only: counts, states, the last status', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    const stats = h.queue.stats();
    expect(stats).toMatchObject({ consent: true, queued: 1, queuedHealth: 0, paused: null, attempt: 1, lastFailure: { status: 503, kind: 'http' } });
    const json = JSON.stringify(stats);
    expect(json).not.toContain(GEN);
    expect(json).not.toContain(OP);
    expect(json).not.toContain('lora-of');
  });
});

describe('[TL-012] events belong to one sign-in', () => {
  it('[TL-012] 401/403 pause delivery until the sign-in changes', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(401)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    expect(h.queue.stats().paused).toBe('auth');
    h.queue.add(acceptance());
    await h.c.tick(60_000);
    expect(h.calls).toHaveLength(1);
    expect(h.messages()).toContain('telemetry paused until sign-in');
    // The same sign-in again changes nothing.
    h.queue.onSessionChanged();
    expect(h.queue.stats().paused).toBe('auth');
    // A new sign-in: the old events are dropped, never sent with the new token.
    h.answerWith((events) => Promise.resolve({ accepted: events.length, duplicates: 0 }));
    h.state.session = { hubOrigin: HUB, userId: USER, epoch: 2 };
    h.queue.onSessionChanged();
    await h.c.tick(0);
    expect(h.queue.stats()).toMatchObject({ paused: null, queued: 0, dropped: { 'stale-binding': 2 } });
    h.queue.add(acceptance());
    await h.c.tick(1000);
    expect(h.calls).toHaveLength(2);
    expect(classifyIngestFailure(hubError(403))).toEqual({ kind: 'auth', status: 403 });
  });

  it('[TL-012] a 401 that comes back after the sign-in changed does not pause the new sign-in', async () => {
    const h = harness();
    await h.queue.start();
    const late: { fail: () => void } = { fail: () => undefined };
    h.answerWith(
      () =>
        new Promise((_resolve, reject) => {
          late.fail = () => reject(hubError(401));
        }),
    );
    h.queue.add(acceptance());
    await h.c.tick(1000);
    expect(h.queue.stats().inFlight).toBe(true);
    // The token is revoked, the person signs out and in again while the old request is on its way.
    h.state.session = null;
    h.queue.onSessionChanged();
    h.state.session = { hubOrigin: HUB, userId: USER, epoch: 2 };
    h.queue.onSessionChanged();
    h.answerWith((events) => Promise.resolve({ accepted: events.length, duplicates: 0 }));
    late.fail();
    await h.c.tick(0);
    expect(h.queue.stats()).toMatchObject({ paused: null, attempt: 0, dropped: { 'stale-binding': 1 } });
    expect(h.messages()).not.toContain('telemetry paused until sign-in');
    h.queue.add(acceptance());
    await h.c.tick(60_000);
    expect(h.calls).toHaveLength(2);
    expect(h.queue.stats()).toMatchObject({ queued: 0, sent: 1 });
  });

  it('[TL-012] an event of another user with the same epoch is never sent', async () => {
    const h = harness();
    h.kv.value = { v: 1, entries: [{ event: acceptance(), binding: { hubOrigin: HUB, userId: USER + 1, epoch: 1 }, queuedAt: T0 }] };
    await h.queue.start();
    expect(h.calls).toHaveLength(0);
    expect(h.queue.stats()).toMatchObject({ queued: 0, dropped: { 'stale-binding': 1 } });
  });

  it('[TL-012] the 401/403 pause survives an event-page restart', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(403)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    await h.queue.saved();
    const again = harness();
    again.kv.value = h.kv.value;
    await again.queue.start();
    expect(again.queue.stats()).toMatchObject({ paused: 'auth', queued: 1 });
    expect(again.calls).toHaveLength(0);
    // A new sign-in lifts it.
    again.state.session = { hubOrigin: HUB, userId: USER, epoch: 2 };
    again.queue.onSessionChanged();
    expect(again.queue.stats().paused).toBeNull();
  });

  it('[TL-012] sign-out drops the queue; nothing is queued while signed out', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    h.state.session = null;
    h.queue.onSessionChanged();
    expect(h.queue.stats().queued).toBe(0);
    expect(h.queue.add(acceptance())).toBe('signed-out');
    h.state.session = { hubOrigin: 'https://other.example.test', userId: USER, epoch: 1 };
    expect(h.queue.add(acceptance())).toBe('queued');
  });
});

describe('§9.6 consent', () => {
  it('[TL-009] nothing is queued without technicalAndInteraction; revoking purges at once', async () => {
    const h = harness({ consent: false });
    await h.queue.start();
    expect(h.queue.add(acceptance())).toBe('no-consent');
    h.state.consent = true;
    h.queue.onConsentChanged();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    h.queue.add(health());
    h.state.consent = false;
    h.queue.onConsentChanged();
    expect(h.queue.stats()).toMatchObject({ consent: false, queued: 0, dropped: { consent: 2 } });
    expect(h.records.find((r) => r.msg === 'telemetry consent revoked, queue purged')?.fields).toEqual({ purged: 2 });
    await h.c.tick(60_000);
    expect(h.calls).toHaveLength(0);
    await h.queue.saved();
    expect((h.kv.value as { entries: unknown[] }).entries).toEqual([]);
  });

  it('[TL-009] consent not read yet: nothing is purged or sent; a definite «no» purges', async () => {
    const h = harness({ consent: null });
    h.kv.value = { v: 1, entries: [{ event: acceptance(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await h.queue.start();
    expect(h.queue.stats()).toMatchObject({ consent: false, queued: 1, dropped: { consent: 0 } });
    expect(h.calls).toHaveLength(0);
    expect(h.queue.add(acceptance())).toBe('no-consent');
    h.queue.onConsentChanged();
    expect(h.queue.stats().queued).toBe(1);
    h.state.consent = true;
    h.queue.onConsentChanged();
    await h.c.tick(0);
    expect(h.calls).toHaveLength(1);
    const no = harness({ consent: null });
    no.kv.value = { v: 1, entries: [{ event: acceptance(), binding: SIGNED_IN, queuedAt: T0 - 5000 }] };
    await no.queue.start();
    no.state.consent = false;
    no.queue.onConsentChanged();
    expect(no.queue.stats()).toMatchObject({ queued: 0, dropped: { consent: 1 } });
  });

  it('[TL-009] consent revoked while a batch waits for its retry: the retry never happens', async () => {
    const h = harness();
    await h.queue.start();
    h.answerWith(() => Promise.reject(hubError(503)));
    h.queue.add(acceptance());
    await h.c.tick(1000);
    h.state.consent = false;
    await h.c.tick(10_000);
    expect(h.calls).toHaveLength(1);
    expect(h.queue.stats().queued).toBe(0);
  });
});

describe('[NEW-03] client_health delivery', () => {
  it('[NEW-03] never queued or sent before bootstrap advertises client-health-perf-v1', async () => {
    const h = harness({ supported: false });
    await h.queue.start();
    expect(h.queue.add(health())).toBe('unsupported');
    h.state.supported = true;
    h.queue.add(health());
    h.state.supported = false;
    h.queue.onCapabilitiesChanged();
    expect(h.queue.stats()).toMatchObject({ queued: 0, dropped: { unsupported: 1 } });
  });

  it('[NEW-03] goes in a batch of its own, after the acceptance events; at most 8 wait', async () => {
    const h = harness();
    await h.queue.start();
    h.queue.add(health());
    h.queue.add(acceptance());
    h.queue.add(health(T0 + 1));
    await h.c.tick(1000);
    expect(h.calls.map((b) => b.map((e) => e.kind))).toEqual([['ai_acceptance'], ['client_health', 'client_health']]);
    h.answerWith(() => Promise.reject(hubError(503)));
    for (let i = 0; i < HEALTH_QUEUE_MAX + 3; i += 1) h.queue.add(health(T0 + i));
    expect(h.queue.stats()).toMatchObject({ queuedHealth: HEALTH_QUEUE_MAX, dropped: { overflow: 3 } });
  });
});

function contract(missing: readonly (typeof ANCHOR_IDS)[number][] = [], build: string | null = 'index-DEVowLko'): HostContractReport {
  return {
    build,
    adapterVersion: '1.0.0',
    checkedAt: T0,
    anchors: Object.fromEntries(ANCHOR_IDS.map((id) => [id, missing.includes(id) ? 'missing' : 'ok'])),
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])),
  } as HostContractReport;
}

/** A report of the second site (R20 F7): its own block, a test's anchors. */
function siteContract(missing: readonly string[] = [], build: string | null = 'main.2e6b96097a4bb73b'): HostContractReport {
  return {
    host: 'fansly-web',
    build,
    adapterVersion: '1.0.0',
    checkedAt: T0,
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])) as SiteContractReport['capabilities'],
    extensions: { 'fansly-web': { anchors: Object.fromEntries(['conversationRoute', 'textarea', 'socket'].map((id) => [id, missing.includes(id) ? 'missing' : 'ok'])), capabilities: { freshness: { state: 'on' } } } },
  };
}

const CS: HostKind = 'chatspace';
const FANSLY: HostKind = 'fansly-web';
const TAB2 = '8e1b2d3f-4a5c-4d6e-9f70-8192a3b4c5d6';

function reporterHarness(store?: KeyValuePort, c = clock()) {
  const queued: TelemetryEvent[] = [];
  const state = { consent: true, supported: true, open: [CS] as HostKind[], accept: true };
  const reporter = new HealthReporter({
    scheduler: c.scheduler,
    submit: (event) => {
      if (!state.accept) return 'no-consent';
      queued.push(event);
      return 'queued';
    },
    consent: () => state.consent,
    supported: () => state.supported,
    hostOpen: (site) => state.open.includes(site),
    client: () => CLIENT,
    footprint: () => ({ cachesKB: 10, logsKB: 200 }),
    disabled: () => ['flag:previewSend'],
    ...(store === undefined ? {} : { store }),
  });
  return { c, queued, state, reporter };
}

/** Nothing measured or counted in any window of the period. */
const allEmpty = (reporter: HealthReporter): boolean => reporter.currentWindows().every((slot) => slot.window.isEmpty());

describe('[NEW-03] [DB-031] the client_health reporter', () => {
  it('[NEW-03] every 15 minutes while ChatSpace is open: a valid report of the window, a fresh window after it', async () => {
    const h = reporterHarness();
    const tab = new TabHealthCollector(() => h.c.now);
    tab.record('routeToDockMs', 9);
    h.reporter.mergeTab(TAB, CS, tab.takeReport(contract(['fansMap']), { cachesKB: 300, domNodes: 900 }));
    h.reporter.recordPerf(CS, 'insertMs', 40);
    h.reporter.countCode(CS, 'CG-HUB-UNAVAILABLE');
    h.reporter.count(CS, 'send.held');
    await h.c.tick(TELEMETRY_LIMITS.healthWindowMs);
    expect(h.reporter.tick()).toBe(true);
    const report = h.queued[0] as ClientHealthV1;
    expect(ClientHealthV1Schema.safeParse(report).success).toBe(true);
    expect(report.window).toEqual({ from: '2026-10-03T12:00:00.000Z', to: '2026-10-03T12:15:00.000Z' });
    expect(report.perf.map((p) => p.metric)).toEqual(['routeToDockMs', 'insertMs']);
    expect(report.counters).toMatchObject({ 'CG-HUB-UNAVAILABLE': 1, 'send.held': 1 });
    expect(report.host).toEqual({ kind: 'chatspace', build: 'index-DEVowLko', contractOk: false, missing: ['fansMap'] });
    expect(report.disabled).toEqual(['flag:previewSend']);
    expect(report.footprint).toEqual({ kind: 'owned-estimate', cachesKB: 310, logsKB: 200 });
    // The next window still names the contract, with nothing measured yet.
    expect(h.reporter.tick()).toBe(true);
    const next = h.queued[1] as ClientHealthV1;
    expect(next.perf).toEqual([]);
    expect(next.host.missing).toEqual(['fansMap']);
    expect(h.reporter.stats()).toMatchObject({ sent: 2, skipped: 0 });
  });

  it('[NEW-03] nothing without consent, support, an open tab of the site or anything to say', () => {
    const h = reporterHarness();
    expect(h.reporter.tick()).toBe(false);
    h.reporter.recordPerf(CS, 'insertMs', 1);
    h.state.open = [FANSLY];
    expect(h.reporter.tick()).toBe(false);
    h.state.open = [CS];
    h.state.supported = false;
    h.reporter.recordPerf(CS, 'insertMs', 1);
    expect(h.reporter.tick()).toBe(false);
    h.state.supported = true;
    h.state.consent = false;
    h.reporter.recordPerf(CS, 'insertMs', 1);
    h.reporter.count(CS, 'x');
    h.reporter.countCode(CS, 'CG-NETWORK');
    h.reporter.mergeTab(TAB, CS, new TabHealthCollector(() => T0).takeReport(contract(), { cachesKB: 0, domNodes: 0 }));
    h.reporter.onHost(CS, contract());
    expect(h.reporter.currentWindows()).toEqual([]);
    h.state.consent = true;
    h.reporter.recordPerf(CS, 'insertMs', 1);
    h.state.accept = false;
    expect(h.reporter.tick()).toBe(false);
    expect(h.queued).toHaveLength(0);
    expect(h.reporter.stats().skipped).toBe(3);
  });

  it('[NEW-03] [TL-007] [host:fansly] [host:chatspace] a window per site and build: two tabs of two sites make two reports of one period, each its own site, build and metrics (HF-13)', async () => {
    const h = reporterHarness();
    h.state.open = [CS, FANSLY];
    const chatspace = new TabHealthCollector(() => h.c.now);
    chatspace.record('insertMs', 30);
    const fansly = new TabHealthCollector(() => h.c.now);
    fansly.record('frameParseMs', 0.04);
    fansly.record('snapshotRoundTripMs', 40);
    h.reporter.mergeTab(TAB, CS, chatspace.takeReport(contract(), { cachesKB: 100, domNodes: 50 }));
    h.reporter.mergeTab(TAB2, FANSLY, fansly.takeReport(siteContract(['socket']), { cachesKB: 20, domNodes: 70 }));
    // What a site's background chunk counts goes to the window of the build its tabs are on.
    h.reporter.countCode(FANSLY, 'CG-HUB-TIMEOUT');
    await h.c.tick(TELEMETRY_LIMITS.healthWindowMs);
    expect(h.reporter.tick()).toBe(true);
    const reports = h.queued as ClientHealthV1[];
    expect(reports).toHaveLength(2);
    for (const report of reports) expect(ClientHealthV1Schema.safeParse(report).success).toBe(true);
    const [first, second] = reports;
    expect(first?.host).toEqual({ kind: 'chatspace', build: 'index-DEVowLko', contractOk: true, missing: [] });
    expect(first?.perf.map((p) => p.metric)).toEqual(['insertMs']);
    expect(first?.counters['CG-HUB-TIMEOUT']).toBeUndefined();
    expect(second?.host).toEqual({ kind: 'fansly-web', build: 'main.2e6b96097a4bb73b', contractOk: false, missing: ['socket'] });
    expect(second?.perf.map((p) => p.metric)).toEqual(['frameParseMs', 'snapshotRoundTripMs']);
    expect(second?.counters['CG-HUB-TIMEOUT']).toBe(1);
    // One period: the same window, two reports (the hub layer's id names the site and the build).
    expect(first?.window).toEqual(second?.window);
    // A site whose tabs are gone reports nothing; the other goes on.
    h.state.open = [FANSLY];
    expect(h.reporter.tick()).toBe(true);
    expect((h.queued[2] as ClientHealthV1).host.kind).toBe('fansly-web');
    expect(h.queued).toHaveLength(3);
  });

  it('[R20 F7] a build of its own is a window of its own; the page\'s first report, before its build is read, is no broken contract', () => {
    const h = reporterHarness();
    // Every tab's first report: the bridge is not up, the build not read, the anchors not found.
    h.reporter.mergeTab(TAB, CS, new TabHealthCollector(() => h.c.now).takeReport(contract(['app', 'router'], null), { cachesKB: 1, domNodes: 1 }));
    const tab = new TabHealthCollector(() => h.c.now);
    tab.record('insertMs', 12);
    h.reporter.mergeTab(TAB, CS, tab.takeReport(contract(), { cachesKB: 2, domNodes: 2 }));
    // A second tab on a newer ChatSpace build: its window is its own.
    const newer = new TabHealthCollector(() => h.c.now);
    newer.record('insertMs', 14);
    h.reporter.mergeTab(TAB2, CS, newer.takeReport(contract(['fansMap'], 'index-NEW'), { cachesKB: 3, domNodes: 3 }));
    // Its next report before its build is read (a reload) joins the build the site's tabs are on, without its contract.
    h.reporter.mergeTab(TAB2, CS, new TabHealthCollector(() => h.c.now).takeReport(contract(['app'], null), { cachesKB: 4, domNodes: 4 }));
    // The period closes (the tick takes over the early send the contract changes asked for).
    h.reporter.tick();
    const reports = h.queued as ClientHealthV1[];
    expect(reports.map((report) => [report.host.build, report.host.contractOk, report.host.missing])).toEqual([
      ['index-DEVowLko', true, []],
      ['index-NEW', false, ['fansMap']],
    ]);
  });

  it('[R20 F7] with no build of the site known, its contract stands for it; once one is, that window joins the build', () => {
    const h = reporterHarness();
    h.reporter.countCode(CS, 'CG-SEND-FUSE');
    h.reporter.mergeTab(TAB, CS, new TabHealthCollector(() => h.c.now).takeReport(contract(['app'], null), { cachesKB: 1, domNodes: 1 }));
    expect(h.reporter.currentWindows().map((slot) => [slot.site, slot.build])).toEqual([['chatspace', null]]);
    h.reporter.mergeTab(TAB, CS, new TabHealthCollector(() => h.c.now).takeReport(contract(), { cachesKB: 1, domNodes: 1 }));
    h.reporter.tick();
    expect(h.queued).toHaveLength(1);
    expect((h.queued[0] as ClientHealthV1).host).toMatchObject({ build: 'index-DEVowLko', contractOk: true });
    expect((h.queued[0] as ClientHealthV1).counters['CG-SEND-FUSE']).toBe(1);
    // A site whose build is never read (a page that changed beyond the adapter): its window of «no build» is reported.
    const broken = reporterHarness();
    broken.reporter.mergeTab(TAB, CS, new TabHealthCollector(() => broken.c.now).takeReport(contract(['app'], null), { cachesKB: 1, domNodes: 1 }));
    broken.reporter.tick();
    expect((broken.queued[0] as ClientHealthV1).host).toEqual({ kind: 'chatspace', build: null, contractOk: false, missing: ['app'] });
  });

  it('[R20 F7] a tab\'s word about another site\'s contract is not its contract: its numbers count, the contract does not', () => {
    const h = reporterHarness();
    const tab = new TabHealthCollector(() => h.c.now);
    tab.record('insertMs', 3);
    h.reporter.mergeTab(TAB, CS, tab.takeReport(siteContract(), { cachesKB: 1, domNodes: 1 }));
    h.reporter.onHost(CS, siteContract());
    expect(h.reporter.currentWindows().map((slot) => [slot.site, slot.build, slot.window.hostSummary])).toEqual([['chatspace', null, null]]);
    h.reporter.tick();
    expect((h.queued[0] as ClientHealthV1).counters['health.host-mismatch']).toBe(1);
  });

  it('[R20 F7] a contract change of one site sends the period early; the other site\'s does not count against it', async () => {
    const h = reporterHarness();
    h.state.open = [CS, FANSLY];
    h.reporter.onHost(CS, contract());
    h.reporter.onHost(FANSLY, siteContract());
    expect(h.reporter.stats().earlyPending).toBe(false);
    h.reporter.onHost(FANSLY, siteContract(['textarea']));
    expect(h.reporter.stats().earlyPending).toBe(true);
    await h.c.tick(0);
    expect((h.queued as ClientHealthV1[]).map((report) => [report.host.kind, report.host.missing])).toEqual([
      ['chatspace', []],
      ['fansly-web', ['textarea']],
    ]);
  });

  it('[DB-031] a changed host contract sends early, at most once per 60 s', async () => {
    const h = reporterHarness();
    h.reporter.onHost(CS, contract());
    h.reporter.onHost(CS, contract());
    expect(h.reporter.stats().earlyPending).toBe(false);
    h.reporter.onHost(CS, contract(['app']));
    expect(h.reporter.stats().earlyPending).toBe(true);
    await h.c.tick(0);
    expect(h.queued).toHaveLength(1);
    expect((h.queued[0] as ClientHealthV1).host.missing).toEqual(['app']);
    h.reporter.onHost(CS, contract([], 'index-NEW'));
    await h.c.tick(59_999);
    expect(h.queued).toHaveLength(1);
    await h.c.tick(1);
    // The site is on the new build now: the old build's window, carried over with nothing new, is not reported again.
    expect((h.queued as ClientHealthV1[]).slice(1).map((report) => report.host.build)).toEqual(['index-NEW']);
    h.reporter.onHost(CS, contract(['app'], 'index-NEW'));
    h.reporter.reset();
    await h.c.tick(120_000);
    expect(h.queued).toHaveLength(2);
    expect(h.reporter.stats().earlyPending).toBe(false);
  });

  it('[DB-031] the 15-minute tick takes over a pending early send: no second report seconds later', async () => {
    const h = reporterHarness();
    h.reporter.onHost(CS, contract());
    h.reporter.recordPerf(CS, 'insertMs', 5);
    expect(h.reporter.tick()).toBe(true);
    await h.c.tick(30_000);
    h.reporter.onHost(CS, contract(['app']));
    expect(h.reporter.stats().earlyPending).toBe(true);
    await h.c.tick(10_000);
    expect(h.reporter.tick()).toBe(true);
    expect(h.reporter.stats().earlyPending).toBe(false);
    expect((h.queued[1] as ClientHealthV1).host.missing).toEqual(['app']);
    await h.c.tick(120_000);
    expect(h.queued).toHaveLength(2);
  });

  it('[NEW-03] the windows survive an event-page unload through storage.session', async () => {
    const kv = new MemoryKv();
    const h = reporterHarness(kv);
    h.state.open = [CS, FANSLY];
    await h.reporter.start();
    h.reporter.onHost(CS, contract(['fansMap']));
    h.reporter.recordPerf(CS, 'insertMs', 40);
    h.reporter.countCode(CS, 'CG-INSERT-MISPLACED');
    const tab = new TabHealthCollector(() => h.c.now);
    tab.record('routeToDockMs', 9);
    h.reporter.mergeTab(TAB, CS, tab.takeReport(contract(['fansMap']), { cachesKB: 300, domNodes: 900 }));
    h.reporter.mergeTab(TAB2, FANSLY, new TabHealthCollector(() => h.c.now).takeReport(siteContract(), { cachesKB: 5, domNodes: 5 }));
    await h.reporter.saved();
    expect(h.reporter.stats().earlyPending).toBe(false);

    // A new event page: one measurement before start(), then the stored windows join it.
    await h.c.tick(60_000);
    const woken = reporterHarness(kv, h.c);
    woken.state.open = [CS, FANSLY];
    woken.reporter.recordPerf(CS, 'insertMs', 60);
    await woken.reporter.start();
    await woken.reporter.start();
    expect(woken.reporter.stats().windowFrom).toBe(T0);
    await woken.c.tick(TELEMETRY_LIMITS.healthWindowMs - 60_000);
    expect(woken.reporter.tick()).toBe(true);
    const [report, other] = woken.queued as ClientHealthV1[];
    expect(report && ClientHealthV1Schema.safeParse(report).success).toBe(true);
    expect(report?.window.from).toBe('2026-10-03T12:00:00.000Z');
    expect(report?.perf.find((p) => p.metric === 'insertMs')?.count).toBe(2);
    expect(report?.perf.find((p) => p.metric === 'routeToDockMs')?.count).toBe(1);
    expect(report?.counters).toMatchObject({ 'CG-INSERT-MISPLACED': 1, 'p1.insert-misplaced': 1, 'footprint.dom-nodes-max': 900 });
    expect(report?.host.missing).toEqual(['fansMap']);
    expect(report?.footprint.cachesKB).toBe(310);
    expect(other?.host).toMatchObject({ kind: 'fansly-web', build: 'main.2e6b96097a4bb73b', contractOk: true });
    // The time of the last report is stored too: the 60 s limit of early sends holds across a wake.
    await woken.reporter.saved();
    const again = reporterHarness(kv, woken.c);
    await again.reporter.start();
    expect(again.reporter.stats().lastSentAt).toBe(woken.c.now);
    again.reporter.onHost(CS, contract(['app']));
    await again.c.tick(59_999);
    expect(again.queued).toHaveLength(0);
    await again.c.tick(1);
    expect(again.queued).toHaveLength(1);
    // A reset (consent revoked, signed out) stores no window.
    again.reporter.recordPerf(CS, 'insertMs', 1);
    again.reporter.reset();
    await again.reporter.saved();
    const empty = reporterHarness(kv, again.c);
    await empty.reporter.start();
    expect(allEmpty(empty.reporter)).toBe(true);
  });

  it('[NEW-03] stored windows that are not ones are ignored; junk inside them is counted, never trusted', async () => {
    const kv = new MemoryKv();
    const window = { v: 1, from: T0 } as const;
    for (const junk of [
      null,
      'junk',
      { v: 1, window, lastSentAt: null, lastSignature: null },
      { v: 2, from: -1, windows: [] },
      { v: 2, from: T0, windows: 'x' },
      { v: 2, from: T0, windows: [{ site: 'onlyfans', build: null, window }, { site: CS, build: 7, window }, { site: CS, build: null, window: { v: 2, from: T0 } }, null] },
    ]) {
      kv.value = junk;
      const h = reporterHarness(kv);
      await h.reporter.start();
      expect(h.reporter.currentWindows(), JSON.stringify(junk)).toEqual([]);
    }
    kv.value = {
      v: 2,
      from: T0 - 1000,
      windows: [
        {
          site: CS,
          build: 'index-DEVowLko',
          window: {
            v: 1,
            from: T0 - 1000,
            perf: [{ metric: 'insertMs', unit: 'ms', schemaVersion: 99, bounds: [1], counts: [1, 0], count: 1, sum: 1, max: 1 }, 'x'],
            counters: { 'CG-NETWORK': 2, 'bad name with spaces': 3, n: 'x' },
            host: { build: 'x'.repeat(200), contractOk: true, missing: [], degraded: [] },
            disabled: ['flag:recap', 5],
            domNodesMax: -3,
            tabCachesKB: { [TAB]: 12, 'bad tab id!': 5, other: -1 },
          },
        },
      ],
      builds: { chatspace: 'index-DEVowLko', onlyfans: 'x', 'fansly-web': 5 },
      lastSentAt: 'x',
      signatures: { chatspace: 5 },
    };
    const h = reporterHarness(kv);
    await h.reporter.start();
    const [slot] = h.reporter.currentWindows();
    expect(slot).toMatchObject({ site: 'chatspace', build: 'index-DEVowLko' });
    expect(slot?.window.snapshot()).toMatchObject({ from: T0 - 1000, perf: [], host: null, disabled: ['flag:recap'], domNodesMax: 0, tabCachesKB: { [TAB]: 12 } });
    expect(slot?.window.snapshot().counters).toEqual({ 'perf.rejected': 2, 'CG-NETWORK': 2, 'health.bad-counter': 3 });
    expect(h.reporter.stats().lastSentAt).toBeNull();
    // The stored build of the site is where its next measurement goes.
    h.reporter.recordPerf(CS, 'insertMs', 1);
    expect(h.reporter.currentWindows()).toHaveLength(1);
    // A store that fails to load or save never breaks the reporter.
    const broken: KeyValuePort = { load: () => Promise.reject(new Error('x')), save: () => Promise.reject(new Error('y')) };
    const b = reporterHarness(broken);
    await b.reporter.start();
    b.reporter.recordPerf(CS, 'insertMs', 1);
    await b.reporter.saved();
    expect(allEmpty(b.reporter)).toBe(false);
  });

  it('[R20 F7] at most HEALTH_WINDOWS_MAX windows a period: more builds join their site\'s window, counted', () => {
    const h = reporterHarness();
    for (let i = 0; i < HEALTH_WINDOWS_MAX + 3; i += 1) h.reporter.onHost(CS, contract([], `index-${String(i).padStart(8, '0')}`));
    expect(h.reporter.currentWindows()).toHaveLength(HEALTH_WINDOWS_MAX);
    expect(h.reporter.currentWindows().reduce((sum, slot) => sum + (slot.window.snapshot().counters['health.windows-capped'] ?? 0), 0)).toBe(3);
  });

  it('[NEW-03] a tab measures, samples handlers 1 in 20 and reports deltas', () => {
    let now = T0;
    const tab = new TabHealthCollector(() => now);
    expect(tab.isEmpty()).toBe(true);
    let ran = 0;
    for (let i = 0; i < 40; i += 1) {
      tab.handler(() => {
        ran += 1;
        now += 1;
      });
    }
    expect(ran).toBe(40);
    tab.count('insert.prevented');
    tab.countCode('CG-INSERT-MISPLACED');
    expect(() =>
      tab.handler(() => {
        throw new Error('handler');
      }),
    ).toThrow('handler');
    const report = tab.takeReport(null, { cachesKB: 12.4, domNodes: 300 });
    expect(TabHealthReportSchema.safeParse(report).success).toBe(true);
    expect(report.perf.find((p) => p.metric === 'handlerMs')?.count).toBe(3);
    expect(report.counters).toMatchObject({ 'insert.prevented': 1, 'CG-INSERT-MISPLACED': 1, 'p1.insert-misplaced': 1 });
    expect(report.footprint).toEqual({ cachesKB: 12, domNodes: 300 });
    expect(tab.isEmpty()).toBe(true);
    expect(tab.takeReport(null, { cachesKB: 0, domNodes: 0 }).windowFrom).toBe(now);
  });
});

describe('[TL-008] [LG-015] acceptance outcomes', () => {
  it('[LG-015] an unlinked operation is logged, duplicates and invalid ones only counted', async () => {
    const h = harness();
    await h.queue.start();
    const logger = createLogger({ now: () => T0, debugEnabled: () => false, sinks: [(r) => h.records.push(r)] });
    const reporter = new AcceptanceReporter((event) => h.queue.add(event), logger);
    let n = 0;
    const tracker = new AcceptanceTracker({ now: () => T0, uuid: () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}` });
    tracker.link({ opId: OP, generationRef: GEN, feature: 'reply', surface: 'dock', pageLabel: 'lora-of' });
    expect(reporter.report(tracker.shown(OP, { part: 0 }), { lifecycle: 'shown', opId: OP })).toBe('queued');
    expect(reporter.report(tracker.shown(OP, { part: 0 }), { lifecycle: 'shown', opId: OP })).toBeNull();
    expect(reporter.report(tracker.shown(OP, { part: 11 }), { lifecycle: 'shown', opId: OP })).toBeNull();
    const other = '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    expect(reporter.report(tracker.copied(other), { lifecycle: 'copied', opId: other })).toBeNull();
    h.state.consent = false;
    expect(reporter.report(tracker.copied(OP), { lifecycle: 'copied', opId: OP })).toBe('no-consent');
    expect(reporter.stats()).toEqual({ queued: 1, unlinked: 1, duplicate: 1, invalid: 1, refused: 1 });
    const unlinked = h.records.find((r) => r.msg === 'acceptance event without a generation link');
    expect(unlinked).toMatchObject({ level: 'warn', fields: { lifecycle: 'copied' }, ctx: { opId: other } });
  });
});
