// Mandatory log events (architecture.md §9.2 «Обязательные события»): one
// fixed scope, message and level each, so the export and the journals read
// the same words whoever writes them. Fields are machine values only — the
// redactor's allowlist would turn any text into its length anyway.
//
// - start: versions of the extension, Firefox and the OS, the ChatSpace
//   fingerprint and the contract result (LG-016);
// - sign-in and sign-out (LG-013);
// - route, inserts and their refusals, X8 attempts by state — the P1 journal
//   (LG-017, written by R10's controllers with these ids);
// - telemetry and AI failures (LG-014, LG-015), usage numbers (DB-018);
// - lifecycle and updates of the extension (LG-018).

import { type CgCode } from '@cg/contracts/errors';
import { type LogLevel, type LogRecord } from '@cg/contracts/logs';

import { type Logger, type LogOptions } from './logger';

export interface LogEventSpec {
  readonly level: LogLevel;
  readonly scope: string;
  readonly msg: string;
}

export const LOG_EVENTS = {
  // ── lifecycle and updates (LG-016, LG-018) ──
  backgroundStarted: { level: 'info', scope: 'bg.lifecycle', msg: 'background started' },
  extensionInstalled: { level: 'info', scope: 'bg.lifecycle', msg: 'extension installed' },
  extensionUpdated: { level: 'info', scope: 'bg.lifecycle', msg: 'extension updated' },
  browserStarted: { level: 'info', scope: 'bg.lifecycle', msg: 'browser session started' },
  backgroundSuspending: { level: 'info', scope: 'bg.lifecycle', msg: 'background suspending' },
  migrationApplied: { level: 'info', scope: 'bg.lifecycle', msg: 'settings migrated' },
  tabStarted: { level: 'info', scope: 'tab.lifecycle', msg: 'tab script started' },
  runtimeReloaded: { level: 'warn', scope: 'tab.lifecycle', msg: 'extension context lost' },
  hostContract: { level: 'info', scope: 'tab.host', msg: 'host contract checked' },
  hostContractChanged: { level: 'warn', scope: 'tab.host', msg: 'host contract changed' },
  // ── sign-in (LG-013) ──
  signedIn: { level: 'info', scope: 'bg.auth', msg: 'signed in' },
  signInFailed: { level: 'warn', scope: 'bg.auth', msg: 'sign-in failed' },
  signedOut: { level: 'info', scope: 'bg.auth', msg: 'signed out' },
  signInLost: { level: 'warn', scope: 'bg.auth', msg: 'sign-in lost' },
  // ── route, inserts, X8 (LG-017) ──
  routeChanged: { level: 'info', scope: 'tab.route', msg: 'route changed' },
  insertApplied: { level: 'info', scope: 'tab.insert', msg: 'insert applied' },
  insertRefused: { level: 'warn', scope: 'tab.insert', msg: 'insert refused' },
  insertUncertain: { level: 'error', scope: 'tab.insert', msg: 'insert outcome unknown' },
  sendAttemptState: { level: 'info', scope: 'bg.send', msg: 'preview send state' },
  // ── AI (LG-015, DB-018) ──
  aiStarted: { level: 'info', scope: 'bg.ai', msg: 'generation started' },
  aiDone: { level: 'info', scope: 'bg.ai', msg: 'generation done' },
  aiFailed: { level: 'warn', scope: 'bg.ai', msg: 'generation failed' },
  aiUsage: { level: 'info', scope: 'bg.ai', msg: 'generation usage' },
  acceptanceUnlinked: { level: 'warn', scope: 'bg.telemetry', msg: 'acceptance event without a generation link' },
  // ── telemetry (LG-014) ──
  telemetryDeliveryFailed: { level: 'warn', scope: 'bg.telemetry', msg: 'telemetry delivery failed' },
  telemetryBatchDropped: { level: 'warn', scope: 'bg.telemetry', msg: 'telemetry batch dropped' },
  telemetryQueueOverflow: { level: 'warn', scope: 'bg.telemetry', msg: 'telemetry queue overflow' },
  telemetryPaused: { level: 'warn', scope: 'bg.telemetry', msg: 'telemetry paused until sign-in' },
  telemetryConsentRevoked: { level: 'info', scope: 'bg.telemetry', msg: 'telemetry consent revoked, queue purged' },
  telemetryStoreFailed: { level: 'warn', scope: 'bg.telemetry', msg: 'telemetry queue not saved' },
  // ── logs and diagnostics ──
  logStoreFailed: { level: 'warn', scope: 'bg.logs', msg: 'log store write failed' },
  diagnosticsExported: { level: 'info', scope: 'bg.diagnostics', msg: 'diagnostics exported' },
  localDataCleared: { level: 'info', scope: 'bg.diagnostics', msg: 'local data cleared' },
  // ── errors caught at the edges (ER-021…ER-023) ──
  uncaughtError: { level: 'error', scope: 'runtime.error', msg: 'uncaught error' },
  unhandledRejection: { level: 'error', scope: 'runtime.error', msg: 'unhandled rejection' },
  rpcFailed: { level: 'warn', scope: 'runtime.rpc', msg: 'background call failed' },
} as const satisfies Record<string, LogEventSpec>;

export type LogEventId = keyof typeof LOG_EVENTS;

/** Writes one mandatory event; returns the record (null when it was not written). */
export function logEvent(logger: Logger, id: LogEventId, options: LogOptions = {}): LogRecord | null {
  const spec: LogEventSpec = LOG_EVENTS[id];
  return logger.write(spec.level, spec.scope, spec.msg, options);
}

/** LG-016: the start record's fields. */
export interface StartFacts {
  readonly version: string;
  readonly contractsVersion: string;
  readonly browser: 'firefox';
  readonly browserMajor: number | null;
  readonly os: 'windows' | 'macos' | 'linux' | 'other';
  readonly testBuild: boolean;
  readonly reason?: 'install' | 'update' | 'browser-start' | 'wake' | 'reload';
  readonly previousVersion?: string | null;
}

export function logStart(logger: Logger, facts: StartFacts): LogRecord | null {
  return logEvent(logger, 'backgroundStarted', { fields: { ...facts } });
}

/** LG-016 in a tab: the ChatSpace fingerprint and the contract result, without any page data. */
export interface HostContractFacts {
  readonly build: string | null;
  readonly adapterVersion: string;
  readonly ok: boolean;
  readonly missing: readonly string[];
  readonly degraded: readonly string[];
  /** Anchors ChatSpace has not created yet (the composer translator store before the page's first chat): no error. */
  readonly notYet?: readonly string[];
}

/**
 * How a contract result is written: `checked` — the first result that counts (the start-up settled), `changed` — a
 * later change, `starting` — a result while ChatSpace is still starting (its stores fill one by one).
 */
export type HostContractLogKind = 'checked' | 'changed' | 'starting';

/**
 * A broken contract carries CG-HOST-CONTRACT (an error of the day) once it counts. While ChatSpace is still starting it
 * is not a fault yet: an info record without the code, marked `starting` (third live check: a reload logged the code
 * four times in its first second, and the contract was whole a second later).
 */
export function logHostContract(logger: Logger, facts: HostContractFacts, kind: HostContractLogKind = 'checked'): LogRecord | null {
  const starting = kind === 'starting';
  return logEvent(logger, kind === 'changed' ? 'hostContractChanged' : 'hostContract', {
    ...(facts.ok || starting ? {} : { code: 'CG-HOST-CONTRACT' as CgCode }),
    fields: { ...facts, missing: [...facts.missing], degraded: [...facts.degraded], ...(facts.notYet === undefined ? {} : { notYet: [...facts.notYet] }), ...(starting ? { starting: true } : {}) },
  });
}

/** DB-018: the usage numbers of a generation, always logged, shown only in debug. */
export interface UsageFacts {
  readonly feature: string;
  readonly generationRef: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheWriteTokens: number;
  readonly cacheReadTokens: number;
  readonly costMicroUsd: number;
  readonly costApproximate: boolean;
  readonly cacheHit: boolean;
}

export function logUsage(logger: Logger, facts: UsageFacts, ctx?: LogOptions['ctx']): LogRecord | null {
  return logEvent(logger, 'aiUsage', { fields: { ...facts }, ...(ctx === undefined ? {} : { ctx }) });
}
