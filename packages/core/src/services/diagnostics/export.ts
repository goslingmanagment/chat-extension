// Diagnostics for the person and for support (architecture.md §9.2
// «Выгрузка»; LG-020…LG-025, ST-110, TL-011, SN-015 data): the
// `diagnostics.get` snapshot, the «Выгрузить диагностику» file (JSON or a
// short TXT, at most 2 MiB) and the «Скопировать отчёт» text.
//
// The file holds versions and flags, the chosen settings (local account
// labels only as a count), hub and host contract status, counters, the last
// 500 log records and the previous session's tail, telemetry queue metadata
// (never the events), sound diagnostics and a snapshot of operations and X8
// attempts with every text turned into its length. The whole bundle is then
// redacted once more with the live secrets (LG-022): the token and its tail
// cannot survive in any corner. Too large — the oldest records go first, the
// cut is marked. Prompt snapshots never enter it.

import { LOG_LIMITS } from '@cg/contracts/limits';
import { isRedactedLogField, type LogRecord } from '@cg/contracts/logs';
import { type SettingsV1 } from '@cg/contracts/settings';
import { HEALTH_CODE_PATTERN } from '@cg/contracts/telemetry';
import { type DiagnosticsSnapshot } from '@cg/contracts/tab-messages';

import { anchorGap, anchorsNotYet } from '../../domain/host';
import {
  REDACTED,
  formatRecordLine,
  logEvent,
  sanitizeValue,
  truncateText,
  utf8Length,
  type CodeCountersSnapshot,
  type Logger,
  type LoggerStats,
  type Redactor,
} from '../../domain/logging';
import { type LogStoreStats } from '../logs';
import { type AcceptanceCounts, type HealthReporterStats, type TelemetryQueueStats } from '../telemetry';

/** Prompt snapshots held now, as counts (the snapshots themselves live in the hub layer's echo store and never enter a file). */
export interface PromptStoreStats {
  readonly count: number;
  readonly chars: number;
}

/** Everything the background knows about itself, gathered by the composition root. */
export interface DiagnosticsFacts {
  readonly now: number;
  readonly extension: DiagnosticsSnapshot['extension'];
  readonly browser: { readonly major: number | null };
  readonly os: DiagnosticsSnapshot['os'];
  /** The language in use (`ru` / `en`). */
  readonly locale: string;
  readonly session: DiagnosticsSnapshot['session'];
  readonly hub: DiagnosticsSnapshot['hub'];
  readonly tabs: DiagnosticsSnapshot['tabs'];
  readonly settings: SettingsV1 | null;
  /** The logger's per-code counters (LG-010). */
  readonly counters: CodeCountersSnapshot;
  /** P1, safety and other counters by their client_health names. */
  readonly healthCounters?: Readonly<Record<string, number>>;
  readonly logs: LogStoreStats;
  readonly logger?: LoggerStats;
  readonly telemetry: TelemetryQueueStats;
  readonly health?: HealthReporterStats;
  readonly acceptance?: AcceptanceCounts;
  readonly sound: DiagnosticsSnapshot['sound'];
  /** Operations: how many run, and a snapshot of their states (any text in it becomes its length). */
  readonly ops: { readonly active: number; readonly snapshot?: unknown };
  /** X8 attempts: open and uncertain counts, the journal without text. */
  readonly sends: { readonly open: number; readonly uncertain: number; readonly journal?: unknown };
  readonly debug: { readonly enabled: boolean; readonly prompts: PromptStoreStats };
  /** Sizes of our caches and logs (ST-110). */
  readonly footprint?: { readonly cachesKB: number; readonly logsKB: number };
}

const MAX_COUNT = 1_000_000_000;

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(MAX_COUNT, value) : null;
}

/** `counters` of the snapshot: today's errors by code, plus P1 and safety counters. */
function snapshotCounters(facts: DiagnosticsFacts): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, count] of Object.entries(facts.counters.today)) {
    const n = countOf(count);
    if (n !== null && HEALTH_CODE_PATTERN.test(code)) out[code] = n;
  }
  for (const [name, count] of Object.entries(facts.healthCounters ?? {})) {
    const n = countOf(count);
    if (n !== null && HEALTH_CODE_PATTERN.test(name)) out[name] = n;
  }
  return out;
}

/** `diagnostics.get` (LG-020): versions, flags and states without secrets or texts. */
export function diagnosticsSnapshot(facts: DiagnosticsFacts): DiagnosticsSnapshot {
  return {
    generatedAt: new Date(facts.now).toISOString(),
    extension: { ...facts.extension },
    browser: { name: 'firefox', major: facts.browser.major },
    os: facts.os,
    session: { ...facts.session },
    hub: facts.hub,
    tabs: facts.tabs.slice(0, 32),
    counters: snapshotCounters(facts),
    logs: { records: facts.logs.records, bytes: facts.logs.bytes, dropped: facts.logs.lost },
    telemetry: { consent: facts.telemetry.consent, queued: facts.telemetry.queued, dropped: facts.telemetry.droppedTotal },
    sound: facts.sound,
    ops: { active: facts.ops.active },
    sends: { open: facts.sends.open, uncertain: facts.sends.uncertain },
    // ST-110: the sizes of our caches and logs for the options page, when the background measures them.
    ...(facts.footprint === undefined ? {} : { footprint: { cachesKB: countOf(Math.round(facts.footprint.cachesKB)) ?? 0, logsKB: countOf(Math.round(facts.footprint.logsKB)) ?? 0 } }),
  };
}

/** The chosen settings as support needs them: local account labels are the person's words — only their count. */
export function settingsForExport(settings: SettingsV1 | null): Record<string, unknown> | null {
  if (settings === null) return null;
  return {
    schemaVersion: settings.schemaVersion,
    hub: { ...settings.hub },
    ui: { ...settings.ui },
    generation: settings.generation,
    sound: { messages: settings.sound.messages, subscribers: settings.sound.subscribers, volume: settings.sound.volume, mutedAccounts: settings.sound.mutedAccounts.length },
    personas: { scope: settings.personas.scope, byPageId: settings.personas.byPageId },
    accounts: { labels: Object.keys(settings.accounts.labels).length },
    debug: { ...settings.debug },
    onboarding: settings.onboarding,
  };
}

// ── The second pass over the whole bundle (LG-022) ─────────────────────────

const BUNDLE_MAX_DEPTH = 32;

/**
 * Every string and key scrubbed with the live secrets and shapes; a
 * forbidden field name loses a string or structured value (a number or a
 * flag under such a name — a sign-in epoch — is not a secret and stays).
 * Plain JSON in, plain JSON out; never throws.
 */
export function redactBundle(value: unknown, redactor: Pick<Redactor, 'text'>): unknown {
  const seen = new WeakSet<object>();
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === 'string') return redactor.text(current);
    if (current === null || typeof current === 'number' || typeof current === 'boolean') return typeof current === 'number' && !Number.isFinite(current) ? null : current;
    if (typeof current !== 'object') return null;
    if (seen.has(current) || depth >= BUNDLE_MAX_DEPTH) return '[depth]';
    seen.add(current);
    try {
      if (Array.isArray(current)) return (current as readonly unknown[]).map((item) => walk(item, depth + 1));
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
        const safeKey = redactor.text(key);
        const scalar = item === null || typeof item === 'number' || typeof item === 'boolean';
        out[safeKey] = isRedactedLogField(key) && !scalar ? REDACTED : walk(item, depth + 1);
      }
      return out;
    } catch {
      return '[unreadable]';
    } finally {
      seen.delete(current);
    }
  };
  try {
    return walk(value, 0);
  } catch {
    return null;
  }
}

// ── The bundle ─────────────────────────────────────────────────────────────

export const EXPORT_FORMAT = 'chatgoose-diagnostics' as const;
/** Records of the previous session's tail at most (LG-023). */
export const PREVIOUS_TAIL_RECORDS = 200;

/** Ops and X8 snapshots: machine values only, any text becomes its length. */
const SNAPSHOT_LIMITS = { maxDepth: 8, maxArrayLength: 200, maxObjectKeys: 100, maxStringLength: 2000 } as const;

export interface ExportLogs {
  readonly recent: readonly LogRecord[];
  readonly previous: { readonly session: number | null; readonly records: readonly LogRecord[] };
}

interface Shape {
  readonly recent: number;
  readonly previous: number;
  readonly snapshots: boolean;
}

/** Tighter and tighter until the file fits 2 MiB; the cut is written into the file. */
const SHAPES: readonly Shape[] = [
  { recent: LOG_LIMITS.exportRecentRecords, previous: PREVIOUS_TAIL_RECORDS, snapshots: true },
  { recent: 250, previous: 100, snapshots: true },
  { recent: 100, previous: 50, snapshots: true },
  { recent: 50, previous: 20, snapshots: false },
  { recent: 0, previous: 0, snapshots: false },
];

function codeList(record: Readonly<Partial<Record<string, number>>>): { code: string; count: number }[] {
  return Object.entries(record)
    .flatMap(([code, count]) => (countOf(count) === null ? [] : [{ code, count: countOf(count) ?? 0 }]))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
}

/** The JSON file's shape (before the second redaction pass, which keeps it). */
export interface ExportBundle {
  readonly kind: typeof EXPORT_FORMAT;
  readonly v: 1;
  readonly generatedAt: string;
  readonly extension: DiagnosticsFacts['extension'];
  readonly browser: { readonly name: 'firefox'; readonly major: number | null };
  readonly os: DiagnosticsFacts['os'];
  readonly locale: string;
  readonly signIn: DiagnosticsFacts['session'];
  readonly hub: DiagnosticsFacts['hub'];
  readonly tabs: DiagnosticsFacts['tabs'];
  readonly settings: Record<string, unknown> | null;
  readonly counters: {
    readonly day: string;
    readonly today: readonly { readonly code: string; readonly count: number }[];
    readonly previousDay: string | null;
    readonly previous: readonly { readonly code: string; readonly count: number }[];
    readonly sinceStart: readonly { readonly code: string; readonly count: number }[];
    readonly health: Readonly<Record<string, number>>;
  };
  readonly footprint: DiagnosticsFacts['footprint'] | null;
  readonly logs: {
    readonly store: Omit<LogStoreStats, 'session'> & { readonly logSession: number | null };
    readonly logger: LoggerStats | null;
    readonly recent: readonly LogRecord[];
    readonly previous: { readonly logSession: number | null; readonly records: readonly LogRecord[] };
  };
  readonly telemetry: { readonly queue: TelemetryQueueStats; readonly health: HealthReporterStats | null; readonly acceptance: AcceptanceCounts | null };
  readonly sound: DiagnosticsFacts['sound'];
  readonly ops: { readonly active: number; readonly snapshot: unknown };
  readonly sends: { readonly open: number; readonly uncertain: number; readonly journal: unknown };
  readonly debug: DiagnosticsFacts['debug'];
  readonly truncated: { readonly recent: number; readonly previous: number; readonly snapshots: boolean };
}

function buildBundle(facts: DiagnosticsFacts, logs: ExportLogs, redactor: Pick<Redactor, 'text'>, shape: Shape): ExportBundle {
  const recent = shape.recent === 0 ? [] : logs.recent.slice(-shape.recent);
  const previous = shape.previous === 0 ? [] : logs.previous.records.slice(-shape.previous);
  const { session: logSession, ...store } = facts.logs;
  const snapshot = (value: unknown): unknown => (value === undefined ? null : sanitizeValue(value, redactor, { limits: SNAPSHOT_LIMITS, allowlist: true }));
  return {
    kind: EXPORT_FORMAT,
    v: 1,
    generatedAt: new Date(facts.now).toISOString(),
    extension: facts.extension,
    browser: { name: 'firefox', major: facts.browser.major },
    os: facts.os,
    locale: facts.locale,
    signIn: facts.session,
    hub: facts.hub,
    tabs: facts.tabs,
    settings: settingsForExport(facts.settings),
    counters: {
      day: facts.counters.day,
      today: codeList(facts.counters.today),
      previousDay: facts.counters.previousDay,
      previous: codeList(facts.counters.previous),
      sinceStart: codeList(facts.counters.session),
      health: facts.healthCounters ?? {},
    },
    footprint: facts.footprint ?? null,
    logs: {
      store: { ...store, logSession },
      logger: facts.logger ?? null,
      recent,
      previous: { logSession: logs.previous.session, records: previous },
    },
    telemetry: { queue: facts.telemetry, health: facts.health ?? null, acceptance: facts.acceptance ?? null },
    sound: facts.sound,
    ops: { active: facts.ops.active, snapshot: shape.snapshots ? snapshot(facts.ops.snapshot) : '[cut]' },
    sends: { open: facts.sends.open, uncertain: facts.sends.uncertain, journal: shape.snapshots ? snapshot(facts.sends.journal) : '[cut]' },
    debug: { enabled: facts.debug.enabled, prompts: facts.debug.prompts },
    truncated: {
      recent: Math.max(0, logs.recent.length - recent.length),
      previous: Math.max(0, logs.previous.records.length - previous.length),
      snapshots: !shape.snapshots,
    },
  };
}

function stamp(now: number): string {
  const iso = new Date(Number.isFinite(now) ? now : 0).toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export interface ExportFile {
  readonly fileName: string;
  readonly mime: 'application/json' | 'text/plain';
  readonly body: string;
}

/** «Выгрузить диагностику» as JSON: within 2 MiB, redacted as a whole (LG-020…LG-023, LG-025). */
export function exportJson(facts: DiagnosticsFacts, logs: ExportLogs, redactor: Pick<Redactor, 'text'>, maxBytes: number = LOG_LIMITS.exportMaxBytes): ExportFile {
  const fileName = `chatgoose-diagnostics-${stamp(facts.now)}.json`;
  for (const shape of SHAPES) {
    const body = JSON.stringify(redactBundle(buildBundle(facts, logs, redactor, shape), redactor), null, 1);
    if (utf8Length(body) <= maxBytes) return { fileName, mime: 'application/json', body };
  }
  const minimal = JSON.stringify(redactBundle({ kind: EXPORT_FORMAT, v: 1, generatedAt: new Date(facts.now).toISOString(), snapshot: diagnosticsSnapshot(facts), truncated: { all: true } }, redactor));
  return { fileName, mime: 'application/json', body: utf8Length(minimal) <= maxBytes ? minimal : '{"kind":"chatgoose-diagnostics","v":1,"truncated":{"all":true}}' };
}

// ── Short texts ────────────────────────────────────────────────────────────

function yesNo(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

/** The header lines of the TXT and of «Скопировать отчёт»: machine words, no secrets, no texts. */
export function summaryLines(facts: DiagnosticsFacts): string[] {
  const contract = facts.tabs.map((tab) => {
    const host = tab.host;
    if (host === null) return 'no-report';
    const missing = Object.entries(host.anchors).filter(([, state]) => anchorGap(state)).map(([anchor]) => anchor);
    const later = anchorsNotYet(host);
    const head = missing.length === 0 ? `${host.build ?? '?'} ok` : `${host.build ?? '?'} missing ${missing.join(',')}`;
    // Anchors ChatSpace creates with the page's first chat: not missing, but not there either.
    return later.length === 0 ? head : `${head} notYet ${later.join(',')}`;
  });
  const today = codeList(facts.counters.today).slice(0, 10).map(({ code, count }) => `${code} ×${count}`);
  const health = Object.entries(facts.healthCounters ?? {})
    .filter(([name, count]) => name.startsWith('p1.') && (countOf(count) ?? 0) > 0)
    .map(([name, count]) => `${name} ×${String(count)}`);
  return [
    `ChatGoose diagnostics ${new Date(facts.now).toISOString()}`,
    `version: ${facts.extension.version} (contracts ${facts.extension.contractsVersion}${facts.extension.testBuild ? ', test build' : ''})`,
    `browser: Firefox ${facts.browser.major ?? '?'} · ${facts.os} · ${facts.locale}`,
    `signed in: ${yesNo(facts.session.signedIn)}${facts.session.hubOrigin === null ? '' : ` · ${facts.session.hubOrigin}`}${facts.session.role === null ? '' : ` · ${facts.session.role}`}`,
    `hub: reachable ${yesNo(facts.hub.reachable)}${facts.hub.lastError === null ? '' : ` · last error ${facts.hub.lastError.code}`} · sdk compatible ${yesNo(facts.hub.sdk.compatible)}`,
    `chatspace tabs: ${facts.tabs.length}${contract.length === 0 ? '' : ` · ${contract.join(' | ')}`}`,
    `errors today: ${today.length === 0 ? 'none' : today.join(', ')}`,
    `p1: ${health.length === 0 ? 'none' : health.join(', ')}`,
    `logs: ${facts.logs.records} records, ${Math.round(facts.logs.bytes / 1024)} KiB, lost ${facts.logs.lost}${facts.logs.available ? '' : ', store unavailable'}`,
    `telemetry: consent ${yesNo(facts.telemetry.consent)}, queued ${facts.telemetry.queued}, dropped ${facts.telemetry.droppedTotal}${facts.telemetry.paused === null ? '' : ', paused until sign-in'}`,
    `sound: listening tabs ${facts.sound.listeningTabs}, last incoming ${facts.sound.lastIncomingAt ?? 'never'}`,
    `operations: active ${facts.ops.active} · preview sends: open ${facts.sends.open}, uncertain ${facts.sends.uncertain}`,
    `debug: ${facts.debug.enabled ? 'on' : 'off'}`,
  ];
}

/** The short TXT of «Выгрузить диагностику»: the summary and the record lines, newest last, within 2 MiB. */
export function exportTxt(facts: DiagnosticsFacts, logs: ExportLogs, redactor: Pick<Redactor, 'text'>, maxBytes: number = LOG_LIMITS.exportMaxBytes): ExportFile {
  const lines = [...summaryLines(facts), '', `records (last ${Math.min(logs.recent.length, LOG_LIMITS.exportRecentRecords)}):`];
  lines.push(...logs.recent.slice(-LOG_LIMITS.exportRecentRecords).map(formatRecordLine));
  if (logs.previous.records.length > 0) {
    lines.push('', `previous session ${logs.previous.session ?? '?'} (last ${Math.min(logs.previous.records.length, PREVIOUS_TAIL_RECORDS)}):`);
    lines.push(...logs.previous.records.slice(-PREVIOUS_TAIL_RECORDS).map(formatRecordLine));
  }
  let body = redactor.text(lines.join('\n'));
  // Over the limit: the oldest lines after the summary go, a mark says so.
  if (utf8Length(body) > maxBytes) {
    const head = summaryLines(facts).length;
    const all = body.split('\n');
    let keep = all.length;
    while (keep > head && utf8Length(body) > maxBytes) {
      keep = Math.max(head, Math.floor(keep * 0.8));
      body = [...all.slice(0, head), '[older lines cut]', ...all.slice(all.length - (keep - head))].join('\n');
    }
    if (utf8Length(body) > maxBytes) body = truncateText(body, Math.floor(maxBytes / 4));
  }
  return { fileName: `chatgoose-diagnostics-${stamp(facts.now)}.txt`, mime: 'text/plain', body };
}

/** «Скопировать отчёт»: the summary and the last warnings and errors, at most 4000 characters, no secrets. */
export const COPY_REPORT_MAX_CHARS = 4000;

export function copyReport(facts: DiagnosticsFacts, recent: readonly LogRecord[], redactor: Pick<Redactor, 'text'>): string {
  const problems = recent.filter((record) => record.level === 'warn' || record.level === 'error').slice(-10);
  const lines = [
    ...summaryLines(facts),
    ...(problems.length === 0 ? [] : ['', 'last problems:', ...problems.map((r) => `${r.ts} ${r.level} [${r.scope}]${r.code === undefined ? '' : ` ${r.code}`} ${r.msg}`)]),
  ];
  return truncateText(redactor.text(lines.join('\n')), COPY_REPORT_MAX_CHARS);
}

// ── The service ────────────────────────────────────────────────────────────

export interface DiagnosticsServiceDeps {
  /** Gathers the facts now (the composition root reads its services). */
  readonly facts: () => DiagnosticsFacts | Promise<DiagnosticsFacts>;
  readonly logs: {
    recent(limit: number): Promise<LogRecord[]>;
    previousTail(limit: number): Promise<{ readonly session: number | null; readonly records: LogRecord[] }>;
  };
  readonly redactor: Pick<Redactor, 'text'>;
  readonly logger?: Logger;
}

/** `diagnostics.get`, `diagnostics.export` and «Скопировать отчёт» over the background's services. */
export class DiagnosticsService {
  constructor(private readonly deps: DiagnosticsServiceDeps) {}

  async snapshot(): Promise<DiagnosticsSnapshot> {
    return diagnosticsSnapshot(await this.deps.facts());
  }

  async exportFile(format: 'json' | 'txt'): Promise<ExportFile> {
    const facts = await this.deps.facts();
    const [recent, previous] = await Promise.all([this.deps.logs.recent(LOG_LIMITS.exportRecentRecords), this.deps.logs.previousTail(PREVIOUS_TAIL_RECORDS)]);
    const file = format === 'json' ? exportJson(facts, { recent, previous }, this.deps.redactor) : exportTxt(facts, { recent, previous }, this.deps.redactor);
    if (this.deps.logger !== undefined) logEvent(this.deps.logger, 'diagnosticsExported', { fields: { format, bytes: utf8Length(file.body) } });
    return file;
  }

  async copyReport(): Promise<string> {
    const facts = await this.deps.facts();
    return copyReport(facts, await this.deps.logs.recent(100), this.deps.redactor);
  }
}
