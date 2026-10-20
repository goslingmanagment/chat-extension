import { ANCHOR_IDS, HOST_CAPABILITIES, type ChatSpaceContractReport } from '@cg/contracts/host';
import { type LogRecord } from '@cg/contracts/logs';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { CodeCounters, createRedactor } from '../../domain/logging';
import { type TelemetryQueueStats } from '../telemetry';
import { exportJson, exportTxt, type DiagnosticsFacts, type ExportBundle } from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const HUB = 'https://hub.example.test';
const TOKEN = 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N';
const TAIL = TOKEN.slice(-8);
const TAB = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';
const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FAN_TEXT = 'hey babe, are you there tonight';

function contract(missing: readonly (typeof ANCHOR_IDS)[number][] = []): ChatSpaceContractReport {
  return {
    build: 'index-DEVowLko',
    adapterVersion: '1.0.0',
    checkedAt: T0,
    anchors: Object.fromEntries(ANCHOR_IDS.map((id) => [id, missing.includes(id) ? 'missing' : 'ok'])),
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])),
  } as ChatSpaceContractReport;
}

const telemetryStats: TelemetryQueueStats = {
  consent: true,
  queued: 3,
  queuedHealth: 1,
  inFlight: false,
  paused: null,
  attempt: 0,
  nextAttemptAt: null,
  sent: 40,
  duplicates: 1,
  dropped: { overflow: 2, rejected: 0, exhausted: 0, 'stale-binding': 1, consent: 0, unsupported: 0, invalid: 0 },
  droppedTotal: 3,
  cyclesExhausted: 0,
  lastFailure: { at: T0 - 1000, status: 503, kind: 'http' },
  lastSentAt: T0 - 500,
};

function facts(over: Partial<DiagnosticsFacts> = {}): DiagnosticsFacts {
  const counters = new CodeCounters(T0);
  counters.count('CG-HUB-TIMEOUT', T0, 3);
  counters.count('CG-INSERT-MISPLACED', T0);
  return {
    now: T0,
    extension: { version: '0.1.0', contractsVersion: '1.1.0', testBuild: false },
    browser: { major: 157 },
    os: 'macos',
    locale: 'ru',
    session: { signedIn: true, hubOrigin: HUB, role: 'chatter' },
    hub: {
      reachable: true,
      lastCheckedAt: new Date(T0 - 60_000).toISOString(),
      lastError: { code: 'CG-HUB-TIMEOUT', detail: `HTTP 504 • tail ${TAIL}`, httpStatus: 504 },
      flags: { previewSend: false, recap: true },
      sdk: { vendoredHash: 'a'.repeat(64), hubHash: 'b'.repeat(64), compatible: true },
    },
    tabs: [{ tabSessionId: TAB, host: contract(['fansMap']), chatKey: null }],
    settings: { ...DEFAULT_SETTINGS, accounts: { labels: { 'chatspace:36408': 'Лора основной' } }, sound: { ...DEFAULT_SETTINGS.sound, mutedAccounts: ['chatspace:36408'] } },
    counters: counters.snapshot(T0),
    healthCounters: { 'p1.insert-misplaced': 1, 'insert.prevented': 2, 'bad name!': 4 },
    logs: { available: true, session: 4, records: 1200, bytes: 300_000, sessions: 3, pending: 0, written: 1200, lost: 2, pruned: 0, failures: 0 },
    telemetry: telemetryStats,
    health: { windowFrom: T0 - 60_000, lastSentAt: null, sent: 0, skipped: 1, earlyPending: false },
    acceptance: { queued: 5, unlinked: 0, duplicate: 1, invalid: 0, refused: 0 },
    sound: { listeningTabs: 1, lastIncomingAt: new Date(T0 - 5000).toISOString(), outcomes: { played: 4, throttled: 1 } },
    ops: { active: 1, snapshot: [{ opId: OP, state: 'streaming', feature: 'reply', text: FAN_TEXT, draft: FAN_TEXT }] },
    sends: { open: 1, uncertain: 0, journal: [{ attemptId: OP, state: 'held', reason: 'CG-SEND-STALE', partText: FAN_TEXT, token: TOKEN }] },
    debug: { enabled: true, prompts: { count: 2, chars: 1234 } },
    footprint: { cachesKB: 120, logsKB: 290 },
    ...over,
  };
}

function records(n: number, extra: Partial<LogRecord> = {}): LogRecord[] {
  return Array.from({ length: n }, (_, i) => ({ ts: new Date(T0 - (n - i) * 1000).toISOString(), seq: i + 1, level: i % 7 === 0 ? 'warn' : 'info', scope: 'bg.ops', msg: 'op state', ...extra }));
}

function redactor() {
  const r = createRedactor();
  r.setToken(TOKEN);
  return r;
}

describe('[LG-022] [LG-024] the export file leaks no secret, text or telemetry event', () => {
  const logs = { recent: records(600), previous: { session: 3, records: records(300, { scope: 'bg.lifecycle' }) } };

  it('[LG-022] redacted as a whole: no token, no tail, no conversation text anywhere', () => {
    const r = redactor();
    for (const file of [exportJson(facts(), logs, r), exportTxt(facts(), logs, r)]) {
      expect(file.body).not.toContain(TOKEN);
      expect(file.body).not.toContain(TAIL);
      expect(file.body).not.toContain(FAN_TEXT);
    }
    const bundle = JSON.parse(exportJson(facts(), logs, r).body) as ExportBundle;
    expect((bundle.ops.snapshot as unknown[])[0]).toEqual({ opId: OP, state: 'streaming', feature: 'reply', text: `[text len=${FAN_TEXT.length}]`, draft: `[text len=${FAN_TEXT.length}]` });
    expect((bundle.sends.journal as unknown[])[0]).toMatchObject({ state: 'held', reason: 'CG-SEND-STALE', token: '[redacted]' });
    expect(bundle.hub.lastError?.detail).toBe('HTTP 504 • tail [redacted]');
  });

  it('[LG-022] a snapshot shaped as bare strings reaches the file as lengths only', () => {
    const bundle = JSON.parse(
      exportJson(facts({ ops: { active: 1, snapshot: [FAN_TEXT, { text: 'x' }] }, sends: { open: 0, uncertain: 0, journal: FAN_TEXT } }), logs, redactor()).body,
    ) as ExportBundle;
    expect(bundle.ops.snapshot).toEqual([`[text len=${FAN_TEXT.length}]`, { text: '[text len=1]' }]);
    expect(bundle.sends.journal).toBe(`[text len=${FAN_TEXT.length}]`);
  });

  it('[LG-022] the TXT is redacted as a whole: a record that names the live token loses it', () => {
    const leaky = { recent: [...records(3), ...records(1, { msg: `retry with ${TOKEN}`, scope: 'bg.hub' })], previous: { session: null, records: [] } };
    const body = exportTxt(facts(), leaky, redactor()).body;
    expect(body).toContain('retry with [redacted]');
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain(TAIL);
  });

  it('[LG-024] telemetry: the queue’s metadata only, never an event', () => {
    const bundle = JSON.parse(exportJson(facts(), logs, redactor()).body) as ExportBundle;
    expect(bundle.telemetry.queue).toMatchObject({ queued: 3, droppedTotal: 3, lastFailure: { status: 503 } });
    expect(Object.keys(bundle.telemetry.queue)).not.toContain('entries');
    expect(bundle.telemetry.acceptance).toEqual({ queued: 5, unlinked: 0, duplicate: 1, invalid: 0, refused: 0 });
  });
});
