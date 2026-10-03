// Dynamic MAIN-world content script registration (§6.8 п. 10): the WS tap is
// registered by the background only while the `wsTap` flag is on, with
// persistAcrossSessions so it is there at document_start after a restart
// (Firefox 128+: `world: 'MAIN'`). Flag off → unregister for future
// documents (the running copy is told to stand down by the bridge, R09).

import { defaultBrowser, type BrowserApi, type RegisteredContentScriptApi } from './browser-api';

export interface DynamicMainScriptSpec {
  readonly id: string;
  readonly js: readonly string[];
  readonly matches: readonly string[];
}

export type DynamicScriptSync = 'registered' | 'unregistered' | 'unchanged';

/** Registers (or re-registers when anything differs) or unregisters; rejects when the browser refuses. */
export async function syncDynamicMainScript(spec: DynamicMainScriptSpec, enabled: boolean, api: BrowserApi = defaultBrowser()): Promise<DynamicScriptSync> {
  const existing = await api.scripting.getRegisteredContentScripts({ ids: [spec.id] });
  const current = existing[0];
  if (!enabled) {
    if (!current) return 'unchanged';
    await api.scripting.unregisterContentScripts({ ids: [spec.id] });
    return 'unregistered';
  }
  if (current !== undefined && sameRegistration(current, spec)) return 'unchanged';
  if (current) await api.scripting.unregisterContentScripts({ ids: [spec.id] });
  await api.scripting.registerContentScripts([mainScriptRegistration(spec)]);
  return 'registered';
}

/** MAIN world, document_start, top frame only, kept across browser restarts. */
export function mainScriptRegistration(spec: DynamicMainScriptSpec): RegisteredContentScriptApi {
  return {
    id: spec.id,
    js: [...spec.js],
    matches: [...spec.matches],
    world: 'MAIN',
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true,
  };
}

function sameRegistration(current: RegisteredContentScriptApi, spec: DynamicMainScriptSpec): boolean {
  return (
    current.world === 'MAIN' &&
    current.runAt === 'document_start' &&
    current.allFrames !== true &&
    current.persistAcrossSessions !== false &&
    sameList(current.js, spec.js) &&
    sameList(current.matches, spec.matches)
  );
}

function sameList(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const sorted = [...expected].sort();
  return [...actual].sort().every((value, index) => value === sorted[index]);
}
