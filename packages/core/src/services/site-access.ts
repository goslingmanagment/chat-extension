// The core owns optional permissions/registrations; the site chunk owns its
// later services. Every trigger joins one queue, including the startup sync.
import type { HostKind } from '@cg/contracts/hosts';
import type { SiteAccessState } from '@cg/contracts/site-access';
import { createWriteChain, type KeyValuePort } from './storage/ports';

export interface SiteAccessDeps {
  readonly host: HostKind;
  readonly key: string;
  readonly storage: KeyValuePort;
  readonly settings: {
    enabled(): Promise<boolean>;
    setEnabled(value: boolean): Promise<void>;
    onChange(listener: () => void): () => void;
  };
  readonly permissions: { has(): Promise<boolean>; onChange(listener: (added: boolean) => void): () => void };
  readonly syncScripts: (enabled: boolean) => Promise<'registered' | 'unregistered' | 'unchanged'>;
  readonly tabs: {
    list(): Promise<number[]>;
    notice(tabId: number): Promise<void>;
    reload(tabId: number): Promise<void>;
    onRemoved(listener: (tabId: number) => void): () => void;
  };
  readonly observe: { attach(): void; detach(): void };
  readonly setCaptureEnabled: (value: boolean) => Promise<void>;
  readonly startModule: () => Promise<unknown>;
  /** The site went off (its switch, or its rights taken back) while it was on: the tabs open on it let go of it. */
  readonly turnedOff?: () => void;
  readonly failed: () => void;
}
export function createSiteAccess(deps: SiteAccessDeps) {
  const chain = createWriteChain();
  const waiting = new Set<number>();
  let enabled = false;
  let granted = false;
  let registered = false;
  let synced = false;
  let loaded = false;
  async function ready(): Promise<void> {
    if (loaded) return;
    const stored = await deps.storage.get([deps.key]);
    if (!stored.ok) throw new Error(stored.code);
    const value = stored.value[deps.key];
    if (Array.isArray(value)) for (const tab of value) if (typeof tab === 'number' && Number.isInteger(tab) && tab >= 0) waiting.add(tab);
    loaded = true;
  }
  const save = async (): Promise<void> => { const result = await deps.storage.set({ [deps.key]: [...waiting] }); if (!result.ok) throw new Error(result.code); };
  const state = (): SiteAccessState => ({ host: deps.host, enabled, granted, registered, waitingReload: granted ? waiting.size : 0 });
  async function sync(notice: boolean, grant: boolean, force = false): Promise<SiteAccessState> {
    await ready();
    const nextGranted = await deps.permissions.has();
    // onAdded completes activation even when the popup closed during Firefox's permission dialog.
    let nextEnabled = await deps.settings.enabled();
    if (grant && nextGranted && !nextEnabled) { await deps.settings.setEnabled(true); nextEnabled = true; }
    const changed = !synced || enabled !== nextEnabled || granted !== nextGranted;
    const wasActive = enabled && granted && registered;
    enabled = nextEnabled;
    granted = nextGranted;
    const active = enabled && granted;
    let newlyRegistered = false;
    if (changed || force) {
      registered = false;
      synced = false;
      if (granted) deps.observe.attach(); else deps.observe.detach();
      await deps.setCaptureEnabled(active);
      newlyRegistered = await deps.syncScripts(active) === 'registered';
      registered = active;
      synced = true;
    }
    if (wasActive && !active) deps.turnedOff?.();
    if (!active && waiting.size > 0) { waiting.clear(); await save(); }
    // A startup sync can discover a grant before onAdded after event-page
    // sleep. Announce the actual registration in that same queued operation;
    // persistent, unchanged scripts on a plain restart need no new notice.
    // Install/update still refreshes notices whose old listeners are dead.
    if (active && (newlyRegistered || notice)) {
      const tabs = await deps.tabs.list();
      for (const tab of [...waiting]) if (!tabs.includes(tab)) waiting.delete(tab);
      // Persist the count before injecting: a tab may vanish between query and execution.
      for (const tab of tabs) waiting.add(tab);
      await save();
      await Promise.allSettled(tabs.map((tab) => deps.tabs.notice(tab)));
    }
    return state();
  }
  const schedule = (notice = false, grant = false, force = false): Promise<SiteAccessState> => chain(() => sync(notice, grant, force));
  /** The tabs that wait for a reload, reloaded now; those that failed keep waiting with their notice. */
  const reloadWaiting = (): Promise<SiteAccessState> =>
    chain(async () => {
      await ready();
      if (!(await deps.permissions.has())) return sync(false, false);
      const alive = await deps.tabs.list();
      const targets = [...waiting].filter((tab) => alive.includes(tab));
      const results = await Promise.allSettled(targets.map((tab) => deps.tabs.reload(tab)));
      let reloaded = 0;
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') { waiting.delete(targets[index] as number); reloaded++; }
      }
      const remaining = await deps.tabs.list();
      for (const tab of [...waiting]) if (!remaining.includes(tab)) waiting.delete(tab);
      await save();
      return { ...state(), reloaded };
    });
  deps.permissions.onChange((added) => {
    // The permission exposes webRequest immediately, before the queue's asynchronous storage work.
    if (added) deps.observe.attach();
    else deps.observe.detach();
    // The grant is the person's «Включить» (2026-10-21 audit, №9: one step, as the old extension's install): the tabs open
    // across it reload at once. Here, not on the page that asked: Firefox closes the toolbar popup while it asks.
    void schedule(false, added).then(async (next) => { if (added && next.registered) { await deps.startModule(); await reloadWaiting(); } }).catch(deps.failed);
  });
  deps.settings.onChange(() => { void schedule().catch(deps.failed); });
  deps.tabs.onRemoved((tab) => { void chain(async () => { await ready(); if (waiting.delete(tab)) await save(); }).catch(deps.failed); });
  return {
    start: () => schedule(false, false, true),
    installed: () => schedule(true, false, true),
    // A failed startup read is unknown, not off. The next request retries initialization in the same queue.
    state: () => chain(async () => synced ? state() : sync(false, false)),
    setEnabled(value: boolean): Promise<SiteAccessState> {
      return chain(async () => { if (await deps.settings.enabled() !== value) await deps.settings.setEnabled(value); return sync(false, false); });
    },
    registered(tabId: number): Promise<void> {
      return chain(async () => { await ready(); if (waiting.delete(tabId)) await save(); });
    },
    reload: reloadWaiting,
    active: () => enabled && granted && registered,
    idle: () => chain(async () => { await ready(); }),
  };
}
