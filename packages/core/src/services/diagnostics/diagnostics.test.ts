import { ANCHOR_IDS, HOST_CAPABILITIES, type HostContractReport } from '@cg/contracts/host';
import { DEBUG_LIMITS, LOG_LIMITS } from '@cg/contracts/limits';
import { LogRecordFromUiSchema, LogRecordSchema, type LogRecord } from '@cg/contracts/logs';
import { OpDebugViewSchema } from '@cg/contracts/ops';
import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { DiagnosticsSnapshotSchema, PromptSnapshotViewSchema } from '@cg/contracts/tab-messages';
import { AcceptanceEventSchema, ClientHealthV1Schema, TabHealthReportSchema } from '@cg/contracts/telemetry';
import { describe, expect, it } from 'vitest';

import { OpDebugBuilder, snapshotFromFrame, type DebugInputFrame, type UsageNumbers } from '../../domain/debug';
import { CodeCounters, createLogger, createRedactor, utf8Length } from '../../domain/logging';
import { AcceptanceTracker, HealthWindow, TabHealthCollector } from '../../domain/telemetry';
import { DebugJournals, LogService, MemoryLogStore, acceptUiRecords } from '../logs';
import { type KeyValuePort, type Scheduler } from '../ports';
import { type TelemetryQueueStats } from '../telemetry';
import {
  COPY_REPORT_MAX_CHARS,
  DiagnosticsService,
  PROMPT_STORE_MAX_CHARS,
  PromptSnapshotStore,
  SpendService,
  clearDebugData,
  copyReport,
  diagnosticsSnapshot,
  exportJson,
  exportTxt,
  redactBundle,
  settingsForExport,
  type DiagnosticsFacts,
  type ExportBundle,
} from './index';

const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const HUB = 'https://hub.example.test';
const TOKEN = 'agency_hub_device_Zx81kQpLm4Rt7Vw2Yb9N';
const TAIL = TOKEN.slice(-8);
const TAB = '7d0a1c2e-3f4b-4c5d-8e6f-708192a3b4c5';
const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const FAN_TEXT = 'hey babe, are you there tonight';

function contract(missing: readonly (typeof ANCHOR_IDS)[number][] = []): HostContractReport {
  return {
    build: 'index-DEVowLko',
    adapterVersion: '1.0.0',
    checkedAt: T0,
    anchors: Object.fromEntries(ANCHOR_IDS.map((id) => [id, missing.includes(id) ? 'missing' : 'ok'])),
    capabilities: Object.fromEntries(HOST_CAPABILITIES.map((c) => [c, { state: 'on' }])),
  } as HostContractReport;
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

describe('[LG-020] diagnostics.get', () => {
  it('[LG-020] versions, flags and states as the contract wants them, no secrets or texts', () => {
    const snapshot = diagnosticsSnapshot(facts());
    expect(DiagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.counters).toEqual({ 'CG-HUB-TIMEOUT': 3, 'CG-INSERT-MISPLACED': 1, 'p1.insert-misplaced': 1, 'insert.prevented': 2 });
    expect(snapshot.logs).toEqual({ records: 1200, bytes: 300_000, dropped: 2 });
    expect(snapshot.telemetry).toEqual({ consent: true, queued: 3, dropped: 3 });
    expect(JSON.stringify(snapshot)).not.toContain(FAN_TEXT);
  });
});

describe('[LG-021] [LG-022] [LG-023] [LG-024] [LG-025] the export file', () => {
  const logs = { recent: records(600), previous: { session: 3, records: records(300, { scope: 'bg.lifecycle' }) } };

  it('[LG-021] holds versions, settings, hub and contract status, counters, 500 records and the queue metadata', () => {
    const file = exportJson(facts(), logs, redactor());
    expect(file.fileName).toBe('chatgoose-diagnostics-20261003-120000.json');
    expect(file.mime).toBe('application/json');
    const bundle = JSON.parse(file.body) as ExportBundle;
    expect(bundle).toMatchObject({ kind: 'chatgoose-diagnostics', v: 1, extension: { version: '0.1.0' }, os: 'macos', locale: 'ru', signIn: { signedIn: true, role: 'chatter' } });
    expect(bundle.hub.flags).toEqual({ previewSend: false, recap: true });
    expect(bundle.tabs[0]?.host?.anchors.fansMap).toBe('missing');
    expect(bundle.counters.today).toEqual([
      { code: 'CG-HUB-TIMEOUT', count: 3 },
      { code: 'CG-INSERT-MISPLACED', count: 1 },
    ]);
    expect(bundle.logs.recent).toHaveLength(LOG_LIMITS.exportRecentRecords);
    expect(bundle.logs.recent.at(-1)?.seq).toBe(600);
    for (const record of bundle.logs.recent.slice(0, 3)) expect(LogRecordSchema.safeParse(record).success).toBe(true);
    expect(bundle.logs.store).toMatchObject({ logSession: 4, records: 1200, lost: 2 });
    expect(bundle.truncated).toEqual({ recent: 100, previous: 100, snapshots: false });
    expect(bundle.sound.outcomes).toEqual({ played: 4, throttled: 1 });
    expect(bundle.footprint).toEqual({ cachesKB: 120, logsKB: 290 });
  });

  it('[LG-021] the chosen settings, the person’s account labels only as a count', () => {
    const settings = settingsForExport(facts().settings);
    expect(settings).toMatchObject({ hub: { baseUrl: DEFAULT_SETTINGS.hub.baseUrl }, ui: DEFAULT_SETTINGS.ui, accounts: { labels: 1 }, sound: { mutedAccounts: 1 } });
    expect(JSON.stringify(settings)).not.toContain('Лора');
    expect(settingsForExport(null)).toBeNull();
  });

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

  it('[LG-022] the second pass keeps numbers under forbidden names and masks the rest', () => {
    const r = redactor();
    expect(redactBundle({ ctx: { session: 3 }, session: { token: TOKEN }, list: [`Bearer ${TOKEN}`], [TOKEN]: 1, n: Number.NaN, f: () => 1 }, r)).toEqual({
      ctx: { session: 3 },
      session: '[redacted]',
      list: ['Bearer [redacted]'],
      '[redacted]': 1,
      n: null,
      f: null,
    });
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 40; i += 1) {
      const next: Record<string, unknown> = {};
      cursor['x'] = next;
      cursor = next;
    }
    expect(JSON.stringify(redactBundle(deep, r))).toContain('[depth]');
  });

  it('[LG-023] the previous session’s tail is in the file: yesterday’s failure travels with today’s export', () => {
    const bundle = JSON.parse(exportJson(facts(), logs, redactor()).body) as ExportBundle;
    expect(bundle.logs.previous.logSession).toBe(3);
    expect(bundle.logs.previous.records).toHaveLength(200);
    expect(bundle.logs.previous.records[0]?.scope).toBe('bg.lifecycle');
  });

  it('[LG-024] telemetry: the queue’s metadata only, never an event', () => {
    const bundle = JSON.parse(exportJson(facts(), logs, redactor()).body) as ExportBundle;
    expect(bundle.telemetry.queue).toMatchObject({ queued: 3, droppedTotal: 3, lastFailure: { status: 503 } });
    expect(Object.keys(bundle.telemetry.queue)).not.toContain('entries');
    expect(bundle.telemetry.acceptance).toEqual({ queued: 5, unlinked: 0, duplicate: 1, invalid: 0, refused: 0 });
  });

  it('[LG-025] never more than 2 MiB: the oldest records go first and the cut is marked', () => {
    const big = { recent: records(500, { fields: { reason: 'x'.repeat(7000) } }), previous: { session: 3, records: records(200, { fields: { reason: 'y'.repeat(7000) } }) } };
    const file = exportJson(facts(), big, redactor());
    expect(utf8Length(file.body)).toBeLessThanOrEqual(LOG_LIMITS.exportMaxBytes);
    const bundle = JSON.parse(file.body) as ExportBundle;
    expect(bundle.truncated.recent).toBeGreaterThan(0);
    expect(bundle.logs.recent.at(-1)?.seq).toBe(500);
    const tiny = exportJson(facts(), big, redactor(), 3000);
    expect(JSON.parse(tiny.body)).toMatchObject({ truncated: { all: true } });
    expect(JSON.parse(exportJson(facts(), big, redactor(), 10).body)).toEqual({ kind: 'chatgoose-diagnostics', v: 1, truncated: { all: true } });
    const txt = exportTxt(facts(), big, redactor());
    expect(utf8Length(txt.body)).toBeLessThanOrEqual(LOG_LIMITS.exportMaxBytes);
    const small = exportTxt(facts(), big, redactor(), 20_000);
    expect(utf8Length(small.body)).toBeLessThanOrEqual(20_000);
    expect(small.body).toContain('[older lines cut]');
    expect(small.fileName).toBe('chatgoose-diagnostics-20261003-120000.txt');
    expect(utf8Length(exportTxt(facts(), big, redactor(), 100).body)).toBeLessThanOrEqual(100);
  });
});

describe('[LG-020] «Скопировать отчёт»', () => {
  it('[LG-020] a short text without secrets: the summary and the last problems', () => {
    const recent = [...records(30), { ts: new Date(T0).toISOString(), seq: 99, level: 'error', scope: 'tab.insert', msg: `insert failed ${TOKEN}`, code: 'CG-INSERT-FAILED' } satisfies LogRecord];
    const text = copyReport(facts(), recent, redactor());
    expect(text.length).toBeLessThanOrEqual(COPY_REPORT_MAX_CHARS);
    expect(text).toContain('version: 0.1.0 (contracts 1.1.0)');
    expect(text).toContain('errors today: CG-HUB-TIMEOUT ×3, CG-INSERT-MISPLACED ×1');
    expect(text).toContain('p1: p1.insert-misplaced ×1');
    expect(text).toContain('chatspace tabs: 1 · index-DEVowLko missing fansMap');
    expect(text).toContain('error [tab.insert] CG-INSERT-FAILED insert failed [redacted]');
    expect(text).not.toContain(TOKEN);
    const quiet = copyReport(
      facts({
        tabs: [{ tabSessionId: TAB, host: null, chatKey: null }],
        session: { signedIn: false, hubOrigin: null, role: null },
        hub: { ...facts().hub, lastError: null, reachable: null, sdk: { vendoredHash: 'a'.repeat(64), hubHash: null, compatible: null } },
        healthCounters: {},
        logs: { ...facts().logs, available: false },
        telemetry: { ...telemetryStats, paused: 'auth' },
        extension: { version: '0.1.0', contractsVersion: '1.1.0', testBuild: true },
        browser: { major: null },
        sound: { listeningTabs: 0, lastIncomingAt: null, outcomes: {} },
        debug: { enabled: false, prompts: { count: 0, chars: 0 } },
      }),
      [],
      redactor(),
    );
    expect(quiet).toContain('signed in: no');
    expect(quiet).toContain('chatspace tabs: 1 · no-report');
    expect(quiet).toContain('store unavailable');
    expect(quiet).toContain('paused until sign-in');
    expect(quiet).toContain('test build');
    expect(quiet).toContain('last incoming never');
    expect(quiet).not.toContain('last problems');
  });
});

describe('[LG-020] the diagnostics service', () => {
  it('[LG-020] export and report over the log store, with the export logged', async () => {
    const scheduler: Scheduler = { now: () => T0, after: () => () => undefined };
    const r = redactor();
    const sunk: LogRecord[] = [];
    const logs = new LogService({ store: new MemoryLogStore(), scheduler });
    await logs.open(null);
    const logger = createLogger({ now: () => T0, debugEnabled: () => false, redactor: r, sinks: [logs.sink, (rec) => sunk.push(rec)] });
    logger.warn('bg.hub', 'hub call failed', { code: 'CG-HUB-TIMEOUT', fields: { reason: `token=${TOKEN}` } });
    await logs.flush();
    const service = new DiagnosticsService({ facts: () => Promise.resolve(facts()), logs, redactor: r, logger });
    expect(DiagnosticsSnapshotSchema.safeParse(await service.snapshot()).success).toBe(true);
    const json = await service.exportFile('json');
    expect((JSON.parse(json.body) as ExportBundle).logs.recent).toHaveLength(1);
    const txt = await service.exportFile('txt');
    expect(txt.body).toContain('hub call failed');
    expect(txt.body).not.toContain(TOKEN);
    expect(await service.copyReport()).toContain('[bg.hub] CG-HUB-TIMEOUT hub call failed');
    expect(sunk.filter((rec) => rec.msg === 'diagnostics exported').map((rec) => rec.fields?.['format'])).toEqual(['json', 'txt']);
    const quiet = new DiagnosticsService({ facts: () => facts(), logs, redactor: r });
    expect((await quiet.exportFile('json')).mime).toBe('application/json');
  });
});

function frame(text: string): DebugInputFrame {
  return { type: 'debug_input_v1', systemBlocks: [{ text, cache: 'none' }], userBlocks: [{ text: 'u', cache: 'none' }], contextManifest: null };
}

function promptStore(debug = { on: true }) {
  let now = T0;
  let n = 0;
  const store = new PromptSnapshotStore({ now: () => now, token: () => `tok-${String(++n).padStart(8, '0')}`, debugEnabled: () => debug.on });
  return {
    store,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('[DB-004] [DB-006] [DB-007] [DB-008] the prompt snapshot store', () => {
  it('[DB-004] only in memory: 12 minutes, at most 10, the oldest goes first', () => {
    const p = promptStore();
    const tokens = Array.from({ length: 11 }, (_, i) => p.store.put(snapshotFromFrame(frame(`prompt ${i}`), { feature: 'reply', capturedAt: T0 })));
    expect(p.store.stats().count).toBe(DEBUG_LIMITS.promptSnapshotsKept);
    expect(p.store.view(tokens[0] ?? '').state).toBe('expired');
    expect(p.store.view(tokens[10] ?? '').state).toBe('ok');
    p.advance(DEBUG_LIMITS.promptSnapshotTtlMs);
    expect(p.store.view(tokens[10] ?? '').state).toBe('expired');
    expect(p.store.stats()).toEqual({ count: 0, chars: 0 });
  });

  it('[DB-004] a total budget keeps a few huge prompts from filling the event page', () => {
    const p = promptStore();
    const huge = 'x'.repeat(DEBUG_LIMITS.promptBlockMaxChars);
    const big = { ...frame(huge), userBlocks: Array.from({ length: 4 }, () => ({ text: huge, cache: 'none' as const })) };
    for (let i = 0; i < 5; i += 1) p.store.put(snapshotFromFrame(big, { feature: 'review', capturedAt: T0 }));
    expect(p.store.stats().chars).toBeLessThanOrEqual(PROMPT_STORE_MAX_CHARS);
    expect(p.store.stats().count).toBeGreaterThanOrEqual(1);
  });

  it('[DB-006] [DB-007] the tab gets an opaque token; the text comes back only by it, valid for debug-prompt.html', () => {
    const p = promptStore();
    const token = p.store.put(snapshotFromFrame(frame('synthetic system prompt'), { feature: 'fix', capturedAt: T0 })) ?? '';
    expect(token).toMatch(/^tok-/);
    expect(token).not.toContain('synthetic');
    const view = p.store.view(token);
    expect(PromptSnapshotViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ state: 'ok', feature: 'fix', blocks: [{ name: 'system 1 · cache none', text: 'synthetic system prompt', truncated: false }, { text: 'u' }] });
    expect(p.store.view('<script>').state).toBe('not-found');
    expect(p.store.view('tok-unknown-123').state).toBe('expired');
  });

  it('[DB-008] echo off and from cache are explained; outside debug nothing is kept', () => {
    const debug = { on: true };
    const p = promptStore(debug);
    const token = p.store.putNoEcho({ feature: 'reply', capturedAt: T0, fromCache: true }) ?? '';
    expect(p.store.view(token)).toMatchObject({ state: 'echo-off', fromCache: true, feature: 'reply', capturedAt: '2026-10-03T12:00:00.000Z' });
    debug.on = false;
    expect(p.store.put(snapshotFromFrame(frame('p'), { feature: 'reply', capturedAt: T0 }))).toBeNull();
    expect(p.store.putNoEcho({ feature: null, capturedAt: T0, fromCache: false })).toBeNull();
    expect(p.store.view(token).state).toBe('debug-off');
    debug.on = true;
    expect(p.store.view(token).state).toBe('expired');
    const broken = new PromptSnapshotStore({
      now: () => T0,
      token: () => {
        throw new Error('no crypto');
      },
      debugEnabled: () => {
        throw new Error('settings');
      },
    });
    expect(broken.put(snapshotFromFrame(frame('p'), { feature: 'reply', capturedAt: T0 }))).toBeNull();
    const junkToken = new PromptSnapshotStore({ now: () => T0, token: () => 'x', debugEnabled: () => true });
    expect(junkToken.put(snapshotFromFrame(frame('p'), { feature: 'reply', capturedAt: T0 }))).toBeNull();
    const failingToken = new PromptSnapshotStore({
      now: () => T0,
      token: () => {
        throw new Error('no crypto');
      },
      debugEnabled: () => true,
    });
    expect(failingToken.putNoEcho({ feature: null, capturedAt: T0, fromCache: false })).toBeNull();
  });
});

class MemoryKv implements KeyValuePort {
  value: unknown = null;
  fail = false;
  load(): Promise<unknown> {
    return this.fail ? Promise.reject(new Error('read')) : Promise.resolve(this.value);
  }
  save(value: unknown): Promise<void> {
    if (this.fail) return Promise.reject(new Error('write'));
    this.value = JSON.parse(JSON.stringify(value)) as unknown;
    return Promise.resolve();
  }
}

const usage: UsageNumbers = { inputTokens: 100, outputTokens: 20, cacheWriteTokens: 0, cacheReadTokens: 50, costMicroUsd: 1500, costApproximate: false };

describe('[DB-022] [DB-018] the local spend journal service', () => {
  it('[DB-022] counts usage by feature, survives an event-page restart, clears on sign-out', async () => {
    const kv = new MemoryKv();
    const spend = new SpendService(kv);
    await spend.start();
    spend.recordUsage('reply', usage, T0);
    spend.recordInsert('reply', T0);
    await spend.saved();
    const again = new SpendService(kv);
    await again.start();
    expect(again.report(T0).total).toMatchObject({ runs: 1, inserts: 1, costMicroUsd: 1500 });
    expect(again.report(T0).source).toBe('local-browser');
    expect(again.todayCostMicroUsd(T0)).toBe(1500);
    again.clear();
    await again.saved();
    expect(again.report(T0).total.runs).toBe(0);
    kv.fail = true;
    const failing = new SpendService(kv);
    await failing.start();
    failing.recordUsage('fix', usage, T0);
    await failing.saved();
    expect(failing.saveFailures).toBe(2);
  });
});

describe('[DB-001] debug off and sign-out clear the debug data', () => {
  it('[DB-001] debug off: prompts and journals; sign-out: the spend journal too', async () => {
    const p = promptStore();
    const token = p.store.put(snapshotFromFrame(frame('p'), { feature: 'reply', capturedAt: T0 })) ?? '';
    const journals = new DebugJournals(() => true);
    journals.sink({ ts: new Date(T0).toISOString(), seq: 1, level: 'info', scope: 'bg.ops', msg: 'op' });
    const spend = new SpendService(new MemoryKv());
    spend.recordUsage('reply', usage, T0);
    clearDebugData({ prompts: p.store, journals, spend }, 'debug-off');
    expect(p.store.view(token).state).toBe('expired');
    expect(journals.read('operations', 10).records).toEqual([]);
    expect(spend.report(T0).total.runs).toBe(1);
    clearDebugData({ prompts: p.store, journals, spend }, 'sign-out');
    expect(spend.report(T0).total.runs).toBe(0);
    await spend.saved();
  });
});

describe('[DB-029] what crosses a runtime boundary passes its contract schema', () => {
  it('[DB-029] tab records, stored records, snapshots, prompt views, op debug views, health and acceptance', () => {
    const r = redactor();
    const tabLogger = createLogger({ now: () => T0, debugEnabled: () => true, maxRecordBytes: LOG_LIMITS.maxRecordBytesFromUi });
    const fromTab = tabLogger.error('tab.dock', 'surface failed', { code: 'CG-UI-FAILED', error: new Error('x'.repeat(30_000)), fields: { list: Array.from({ length: 300 }, (_, i) => i) } });
    expect(LogRecordFromUiSchema.safeParse(fromTab).success).toBe(true);
    const stored: LogRecord[] = [];
    acceptUiRecords(fromTab === null ? [] : [fromTab], { tabSessionId: TAB }, { redactor: r, sinks: [(rec) => stored.push(rec)], debugEnabled: () => false });
    expect(stored.every((rec) => LogRecordSchema.safeParse(rec).success)).toBe(true);
    expect(DiagnosticsSnapshotSchema.safeParse(diagnosticsSnapshot(facts())).success).toBe(true);
    const p = promptStore();
    const token = p.store.put(snapshotFromFrame(frame('p'), { feature: 'reply', capturedAt: T0 })) ?? '';
    for (const t of [token, 'tok-missing-1', '!']) expect(PromptSnapshotViewSchema.safeParse(p.store.view(t)).success).toBe(true);
    const builder = new OpDebugBuilder(T0);
    builder.setPromptToken(token);
    expect(OpDebugViewSchema.safeParse(builder.view()).success).toBe(true);
    const window = new HealthWindow(T0);
    window.recordPerf('ttfcMs', 1200);
    expect(ClientHealthV1Schema.safeParse(window.build(T0 + 1, { version: '0.1.0', browserMajor: 157, os: 'linux' }, { cachesKB: 0, logsKB: 0 })).success).toBe(true);
    expect(TabHealthReportSchema.safeParse(new TabHealthCollector(() => T0).takeReport(null, { cachesKB: 0, domNodes: 0 })).success).toBe(true);
    const tracker = new AcceptanceTracker({ now: () => T0, uuid: () => '00000000-0000-4000-8000-000000000001' });
    tracker.link({ opId: OP, generationRef: OP, feature: 'hi', surface: 'newcomers', pageLabel: 'lora-of' });
    const shown = tracker.shown(OP, { variant: 1 });
    expect(shown.ok && AcceptanceEventSchema.safeParse(shown.event).success).toBe(true);
  });
});
