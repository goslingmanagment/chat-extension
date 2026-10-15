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

export interface DynamicScriptSpec extends DynamicMainScriptSpec {
  readonly world: 'MAIN' | 'ISOLATED';
}

/** One queue for every registration mutation in this background (including different sites). */
const queues = new WeakMap<BrowserApi, Promise<unknown>>();
function serialized<T>(api: BrowserApi, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(api) ?? Promise.resolve()).then(run, run);
  queues.set(api, next.catch(() => undefined));
  return next;
}

/** The whole ordered set is replaced together: MAIN must precede ISOLATED even after a partial registration. */
export function syncDynamicScripts(specs: readonly DynamicScriptSpec[], enabled: boolean, api: BrowserApi = defaultBrowser()): Promise<DynamicScriptSync> {
  return serialized(api, async () => {
    const ids = specs.map((spec) => spec.id);
    const existing = await api.scripting.getRegisteredContentScripts({ ids });
    if (!enabled && existing.length === 0) return 'unchanged';
    if (enabled && existing.length === specs.length && specs.every((spec, index) => {
      const current = existing[index];
      return current?.id === spec.id && current.world === spec.world && sameRegistration({ ...current, world: 'MAIN' }, spec);
    })) return 'unchanged';
    if (existing.length > 0) await api.scripting.unregisterContentScripts({ ids: existing.map((script) => script.id) });
    if (!enabled) return 'unregistered';
    await api.scripting.registerContentScripts(specs.map((spec) => ({ ...mainScriptRegistration(spec), world: spec.world })));
    return 'registered';
  });
}

/** Address permission is enough: no tabs permission, no reload without a human action. */
export function createScriptTabs(matches: readonly string[], notice: string, api: BrowserApi = defaultBrowser()) {
  return {
    list: async () => (await api.tabs.query({ url: [...matches] })).flatMap((tab) => tab.id === undefined ? [] : [tab.id]),
    notice: async (tabId: number): Promise<void> => { await api.scripting.executeScript({ target: { tabId }, files: [notice], world: 'ISOLATED' }); },
    reload: (tabId: number) => api.tabs.reload(tabId),
    onRemoved(listener: (tabId: number) => void): () => void {
      api.tabs.onRemoved.addListener(listener);
      return () => api.tabs.onRemoved.removeListener(listener);
    },
  };
}

/** Registers (or re-registers when anything differs) or unregisters; rejects when the browser refuses. */
export async function syncDynamicMainScript(spec: DynamicMainScriptSpec, enabled: boolean, api: BrowserApi = defaultBrowser()): Promise<DynamicScriptSync> {
  return syncDynamicScripts([{ ...spec, world: 'MAIN' }], enabled, api);
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
