import { type IngestResult } from '@cg/contracts/hub';
import { type LogRecord } from '@cg/contracts/logs';
import { type AcceptanceEvent, type ClientHealthV1 } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../domain/logging';
import { HealthWindow } from '../../domain/telemetry';
import { type KeyValuePort, type Scheduler } from '../ports';
import { TelemetryQueue, type TelemetryBinding, type TelemetryEvent } from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const HUB = 'https://hub.example.test';
const USER = 7;
const SIGNED_IN: TelemetryBinding = { hubOrigin: HUB, userId: USER, epoch: 1 };
const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GEN = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
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

describe('[TL-012] events belong to one sign-in', () => {

  it('[TL-012] an event of another user with the same epoch is never sent', async () => {
    const h = harness();
    h.kv.value = { v: 1, entries: [{ event: acceptance(), binding: { hubOrigin: HUB, userId: USER + 1, epoch: 1 }, queuedAt: T0 }] };
    await h.queue.start();
    expect(h.calls).toHaveLength(0);
    expect(h.queue.stats()).toMatchObject({ queued: 0, dropped: { 'stale-binding': 1 } });
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
