// Debug mode (architecture.md §9.3; ST-097, DB-001, DB-020, DB-027, LG-027).
// One switch, `debug.enabled` (off by default), turns on: console debug logs,
// the prompt echo request, the stage profiler and its live timer, the usage
// line, the model's reasoning, the context card, the journals, the host
// contract details, the AI spend by feature and «AI сегодня $» in the popup.
// The render trace has its own switch under it and is stored by us, never in
// the page's localStorage. Turning debug off or signing out clears every
// debug store (core/services/diagnostics). In a collapsed dock there are no
// debug blocks: they show only when the result is expanded.

import { type AiStreamCapability } from '@cg/contracts/hub';
import { type SettingsV1 } from '@cg/contracts/settings';

import { type Logger } from '../logging/logger';

export interface DebugFeatures {
  readonly enabled: boolean;
  readonly consoleDebug: boolean;
  /** Ask the hub for `debug-input-v1` (it answers only in a window the owner opened, DB-003). */
  readonly promptEcho: boolean;
  readonly profiler: boolean;
  readonly usageLine: boolean;
  readonly reasoning: boolean;
  readonly contextCard: boolean;
  readonly journals: boolean;
  readonly hostContractDetails: boolean;
  readonly spendJournal: boolean;
  readonly popupCost: boolean;
  readonly renderTrace: boolean;
}

export function debugFeatures(settings: Pick<SettingsV1, 'debug'>): DebugFeatures {
  const on = settings.debug.enabled;
  return {
    enabled: on,
    consoleDebug: on,
    promptEcho: on,
    profiler: on,
    usageLine: on,
    reasoning: on,
    contextCard: on,
    journals: on,
    hostContractDetails: on,
    spendJournal: on,
    popupCost: on,
    renderTrace: on && settings.debug.renderTrace,
  };
}

/** DB-002: the stream header capabilities with the echo added in debug mode. */
export function withDebugCapability(capabilities: readonly AiStreamCapability[], debug: boolean): AiStreamCapability[] {
  const out: AiStreamCapability[] = capabilities.filter((capability) => capability !== 'debug-input-v1');
  if (debug) out.push('debug-input-v1');
  return out;
}

/** DB-020: debug blocks of a result appear only once it is expanded. */
export function showDebugBlock(debug: boolean, expanded: boolean): boolean {
  return debug && expanded;
}

/** LG-027: a render trace writer — debug-level records `ui.render`, only while both switches are on. */
export function createRenderTrace(logger: Logger, enabled: () => boolean): (surface: string, ms: number, nodes?: number) => void {
  return (surface, ms, nodes) => {
    try {
      if (!enabled()) return;
      logger.debug('ui.render', 'rendered', { fields: { surface, ms, ...(nodes === undefined ? {} : { nodes }) } });
    } catch {
      // A trace never breaks a render.
    }
  };
}

/** DB-027: «…a1b2» — the last four characters of the sign-in, for «Аккаунт → Дополнительно». */
export function maskedTail(secret: string | null, keep = 4): string | null {
  if (secret === null || secret.length < keep * 3) return null;
  return `…${secret.slice(-keep)}`;
}

export interface AdvancedAccountInfo {
  readonly signIn: { readonly tail: string | null; readonly issuedAt: string | null; readonly expiresAt: string | null } | null;
  /** «Поток»: the ChatSpace build and the contract result. */
  readonly host: { readonly build: string | null; readonly contractOk: boolean | null };
  /** «Приложение»: version · browser · OS. */
  readonly app: string;
}

export function advancedAccountInfo(facts: {
  readonly token: string | null;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly hostBuild: string | null;
  readonly contractOk: boolean | null;
  readonly version: string;
  readonly browserMajor: number | null;
  readonly os: string;
}): AdvancedAccountInfo {
  return {
    signIn: facts.token === null ? null : { tail: maskedTail(facts.token), issuedAt: facts.issuedAt, expiresAt: facts.expiresAt },
    host: { build: facts.hostBuild, contractOk: facts.contractOk },
    app: [facts.version, facts.browserMajor === null ? 'Firefox' : `Firefox ${facts.browserMajor}`, facts.os].join(' · '),
  };
}
