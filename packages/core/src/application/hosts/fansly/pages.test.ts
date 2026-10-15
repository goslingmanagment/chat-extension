import type { CgCode } from '@cg/contracts/errors';
import { DEFAULT_SETTINGS_EXT, type SettingsExtState } from '@cg/contracts/settings-ext';
import type { SiteAccessControl, SiteAccessState, SiteAccessView } from '@cg/contracts/site-access';
import type { FanslyAccountsView } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import type { PageAnswer } from '../../pages/ports';
import { createFanslyPages, fanslyConcerns, fanslySteps, type FanslyPageRequestType } from './pages';

const ON: SiteAccessState = { host: 'fansly-web', enabled: true, granted: true, registered: true, waitingReload: 0 };
const OFF: SiteAccessState = { host: 'fansly-web', enabled: false, granted: false, registered: false, waitingReload: 0 };

/** `site.access` as a test sets it: `refresh` reads `next`. */
function accessOf(initial: SiteAccessState | null): SiteAccessControl & { next: SiteAccessState | null; set(state: SiteAccessState | null): void } {
  let value: SiteAccessView = { state: initial, busy: false, error: null };
  const listeners = new Set<() => void>();
  const control = {
    next: initial,
    get value() {
      return value;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(state: SiteAccessState | null) {
      value = { state, busy: false, error: null };
      for (const listener of [...listeners]) listener();
    },
    refresh() {
      control.set(control.next);
      return Promise.resolve();
    },
    enable() {
      control.next = ON;
      return control.refresh();
    },
    disable() {
      control.next = OFF;
      return control.refresh();
    },
    reload: () => Promise.resolve(),
  };
  return control;
}

const state = (revision: number, viaTab = false): SettingsExtState => ({ ext: { ...DEFAULT_SETTINGS_EXT, hosts: { 'fansly-web': { ...DEFAULT_SETTINGS_EXT.hosts['fansly-web'], enabled: true, viaTab } } }, revision, readOnly: false });

interface Call {
  readonly type: FanslyPageRequestType;
  readonly payload: unknown;
  resolve(answer: PageAnswer<unknown>): void;
}

/** Fansly's module answering by hand: each request waits for its own answer. */
function module() {
  const calls: Call[] = [];
  return {
    calls,
    request: (type: FanslyPageRequestType, payload: unknown) => new Promise<PageAnswer<never>>((resolve) => calls.push({ type, payload, resolve: resolve as (answer: PageAnswer<unknown>) => void })),
  };
}

const flush = async (): Promise<void> => {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
};
const preview = (): Promise<PageAnswer<{ readonly played: boolean; readonly code?: CgCode }>> => Promise.resolve({ ok: true, payload: { played: true } });

describe('Fansly on the settings page — its controller (R20 P14b1, FS-SET-1)', () => {
  it('off: nothing of Fansly’s part is asked; switched on: its part is read; switched off again: it is forgotten', async () => {
    const access = accessOf(OFF);
    const fansly = module();
    const pages = createFanslyPages({ access, request: fansly.request, preview });
    await pages.control.refresh();
    expect(fansly.calls).toEqual([]);
    expect(pages.control.value).toMatchObject({ on: false, settings: null });
    const enabled = pages.control.enable();
    await flush();
    expect(fansly.calls.map((call) => call.type)).toEqual(['fansly.settings.read']);
    fansly.calls[0]?.resolve({ ok: true, payload: state(3) });
    await enabled;
    expect(pages.control.value).toMatchObject({ on: true, settings: { revision: 3 } });
    await pages.control.disable();
    expect(pages.control.value).toMatchObject({ on: false, settings: null, accounts: null });
  });

  it('writes go one after another, «Сохранено» carries the answered revision; a late answer never takes back a newer one; a failure waits for «Повторить»', async () => {
    const access = accessOf(ON);
    const fansly = module();
    const pages = createFanslyPages({ access, request: fansly.request, preview });
    const refreshed = pages.control.refresh();
    await flush();
    fansly.calls[0]?.resolve({ ok: true, payload: state(5) });
    await refreshed;
    const first = pages.control.setViaTab(true);
    const second = pages.control.setTone('messagesTone', 'bell');
    await flush();
    // The second waits for the first.
    expect(fansly.calls.map((call) => call.type)).toEqual(['fansly.settings.read', 'fansly.settings.write']);
    expect(pages.control.value.save).toEqual({ s: 'saving' });
    fansly.calls[1]?.resolve({ ok: true, payload: state(6, true) });
    expect(await first).toBe(true);
    await flush();
    expect(fansly.calls[2]?.payload).toEqual({ patch: { hosts: { 'fansly-web': { sound: { messagesTone: 'bell' } } } } });
    fansly.calls[2]?.resolve({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    expect(await second).toBe(false);
    expect(pages.control.value.save).toEqual({ s: 'failed', error: { code: 'CG-STORAGE-WRITE' } });
    expect(pages.control.value.settings?.revision).toBe(6);
    // Nothing is sent again by itself; «Повторить» sends the failed one.
    await flush();
    expect(fansly.calls).toHaveLength(3);
    const retried = pages.control.retry();
    await flush();
    expect(fansly.calls[3]?.payload).toEqual(fansly.calls[2]?.payload);
    fansly.calls[3]?.resolve({ ok: true, payload: state(7, true) });
    expect(await retried).toBe(true);
    expect(pages.control.value.save).toEqual({ s: 'saved', revision: 7 });
    // An answer of an older revision read late does not replace the newer one.
    const late = pages.control.refresh();
    await flush();
    fansly.calls[4]?.resolve({ ok: true, payload: state(4) });
    await late;
    expect(pages.control.value.settings?.revision).toBe(7);
  });

  it('[ST-079] «Аккаунты»: a session goes by its creator once named, its legacy id an alias; off — nothing to add; the access read first when the page asks before it', async () => {
    const access = accessOf(null);
    access.next = ON;
    const fansly = module();
    const pages = createFanslyPages({ access, request: fansly.request, preview });
    const read = pages.accounts.read();
    await flush();
    const view: FanslyAccountsView = { sessions: [{ legacyId: '700000000000000101', canonicalId: '700000000000000001', tabs: 1, observedAt: 10 }], openTabs: 2, unattributedTabs: 1 };
    fansly.calls[0]?.resolve({ ok: true, payload: view });
    expect(await read).toEqual({ ok: true, payload: { sessions: [{ id: '700000000000000001', aliases: ['700000000000000101'], platformAccountId: '700000000000000001', tabs: 1, observedAt: 10 }] } });
    expect(pages.control.value.accounts).toEqual(view);
    access.next = OFF;
    await access.refresh();
    expect(await pages.accounts.read()).toEqual({ ok: true, payload: null });
    expect(await pages.accounts.focus('700000000000000001')).toEqual({ ok: true, payload: false });
    expect(fansly.calls).toHaveLength(1);
  });

  it('[ST-012] the steps and whom Fansly concerns', () => {
    const view = (access: SiteAccessState | null) => ({ access: { state: access, busy: false, error: null }, on: access?.enabled === true && access.granted, settings: null, settingsError: null, save: { s: 'idle' as const }, accounts: null });
    expect(fanslySteps(view(OFF), { fanslyPage: true, seenAccount: false })).toEqual([
      { id: 'fansly-enable', done: false, action: 'enable' },
      { id: 'fansly-open', done: false, action: null },
      { id: 'fansly-reload', done: false, action: null },
    ]);
    expect(fanslySteps(view({ ...ON, waitingReload: 2 }), { fanslyPage: true, seenAccount: true })).toEqual([
      { id: 'fansly-enable', done: true, action: null },
      { id: 'fansly-open', done: true, action: null },
      { id: 'fansly-reload', done: false, action: 'reload' },
    ]);
    expect(fanslyConcerns(view(OFF), { fanslyPage: false, seenAccount: false })).toBe(false);
    expect(fanslyConcerns(view(OFF), { fanslyPage: true, seenAccount: false })).toBe(true);
    expect(fanslyConcerns(view(OFF), { fanslyPage: false, seenAccount: true })).toBe(true);
    expect(fanslyConcerns(view({ ...OFF, enabled: true }), { fanslyPage: false, seenAccount: false })).toBe(true);
  });
});
