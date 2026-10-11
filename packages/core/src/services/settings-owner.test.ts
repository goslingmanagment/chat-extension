import { customSettings, HUB, IDS } from '@cg/contracts/fixtures';
import { DEFAULT_SETTINGS, STORAGE_KEYS, type SettingsState } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { SESSION_KEYS } from '../domain/storage';
import { createSettingsOwner, settingsRequestHandlers, type SettingsOwnerDeps } from './settings-owner';
import type { ServiceLogEntry } from './storage/ports';
import { createMemoryKv, settle, type MemoryKv } from './test-support/memory-kv';

const KEY = STORAGE_KEYS.settings;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function setup(options: { local?: MemoryKv; session?: MemoryKv; deps?: Partial<SettingsOwnerDeps> } = {}) {
  const local = options.local ?? createMemoryKv();
  const session = options.session ?? createMemoryKv();
  const localPort = local.open();
  const sessionPort = session.open();
  const logs: ServiceLogEntry[] = [];
  const changes: SettingsState[] = [];
  const owner = createSettingsOwner({
    local: localPort,
    session: sessionPort,
    log: (entry) => logs.push(entry),
    onChange: (state) => changes.push(state),
    ...options.deps,
  });
  /** The event page unloads: its listeners and ports are gone. */
  const unload = (): void => {
    owner.dispose();
    localPort.detach();
    sessionPort.detach();
  };
  return { local, session, owner, logs, changes, unload };
}

/** Logs carry codes, counts and paths, never the values of the settings (labels are the person's text). */
function expectNoValues(logs: readonly ServiceLogEntry[]): void {
  const text = JSON.stringify(logs);
  expect(text).not.toContain('Main model');
  expect(text).not.toContain('lora');
}

describe('[RB-011] the settings owner is the single writer', () => {
  it('runs changes one at a time, each ONE storage.local.set of the whole value; «Сохранено» carries the revision', async () => {
    const { local, owner, changes } = setup();
    await owner.start();
    expect(local.calls.set).toBe(0);
    const results = await Promise.all([
      owner.patch({ ui: { theme: 'dark' } }, { baseRevision: 0, restricted: false }),
      owner.patch({ sound: { volume: 35 } }, { baseRevision: 0, restricted: false }),
      owner.patch({ generation: { split: true } }, { baseRevision: 0, restricted: false }),
    ]);
    expect(results.map((result) => (result.ok ? result.state.revision : -1))).toEqual([1, 2, 3]);
    expect(local.calls.set).toBe(3);
    const stored = local.read<typeof DEFAULT_SETTINGS>(KEY);
    expect(stored?.ui.theme).toBe('dark');
    expect(stored?.sound.volume).toBe(35);
    expect(stored?.generation.split).toBe(true);
    expect(changes.map((state) => state.revision)).toEqual([1, 2, 3]);
    expect(changes.every((state) => !state.readOnly)).toBe(true);
  });

  it('[ST-018] broadcasts every confirmed change (settings.changed) to the emitter and to in-process listeners', async () => {
    const { owner, changes } = setup();
    const heard: number[] = [];
    const off = owner.onChange((state) => heard.push(state.revision));
    owner.onChange(() => {
      throw new Error('a listener bug');
    });
    await owner.patch({ ui: { hints: false } }, { baseRevision: null, restricted: false });
    off();
    await owner.patch({ ui: { hints: true } }, { baseRevision: null, restricted: false });
    expect(changes.map((state) => state.settings.ui.hints)).toEqual([false, true]);
    expect(heard).toEqual([1]);
  });

  it('refuses the restricted sections to a tab and a value the schema refuses (defensive: CG-UNKNOWN, never a retry text); a patch on an older revision merges', async () => {
    const { owner, local, logs } = setup();
    expect(await owner.patch({ hub: { baseUrl: 'https://evil.example.test' } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'restricted section' } });
    expect(await owner.patch({ sound: { volume: 7 } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN', detail: 'invalid settings' } });
    expect(local.calls.set).toBe(0);
    await owner.patch({ ui: { theme: 'dark' } }, { baseRevision: 0, restricted: false });
    const merged = await owner.patch({ ui: { hints: false } }, { baseRevision: 0, restricted: false });
    expect(merged.ok && merged.state.settings.ui).toMatchObject({ theme: 'dark', hints: false });
    expect(logs.some((entry) => entry.msg.includes('older revision'))).toBe(true);
  });

  it('[ST-013] a resent change after a lost confirmation answers the same state without a second write', async () => {
    const { owner, local } = setup();
    const first = await owner.patch({ sound: { volume: 70 } }, { baseRevision: 0, restricted: false });
    expect(first.ok).toBe(true);
    // The answer never reached the page; it sends the same change again.
    const again = await owner.patch({ sound: { volume: 70 } }, { baseRevision: 0, restricted: false });
    expect(again).toEqual(first);
    expect(local.calls.set).toBe(1);
  });

  it('[ST-013] a write whose confirmation was lost is read back: the value landed — confirmed, adopted and broadcast', async () => {
    const { owner, local, changes, logs } = setup();
    await owner.start();
    local.failNext('set', 'lost');
    const result = await owner.patch({ ui: { locale: 'en' } }, { baseRevision: 0, restricted: false });
    expect(result).toMatchObject({ ok: true, state: { revision: 1, settings: { ui: { locale: 'en' } } } });
    expect(owner.current().ui.locale).toBe('en');
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui.locale).toBe('en');
    expect(changes.map((state) => state.settings.ui.locale)).toEqual(['en']);
    expect(logs.some((entry) => entry.msg === 'settings write confirmed by reading it back')).toBe(true);
    // The next unrelated patch keeps it.
    await owner.patch({ ui: { hints: false } }, { baseRevision: 1, restricted: false });
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui).toMatchObject({ locale: 'en', hints: false });
  });

  it('[ST-014] a write that did not land is «не сохранено» and changes nothing; «Повторить» writes it', async () => {
    const { owner, local, changes } = setup();
    await owner.start();
    local.failNext('set');
    expect(await owner.patch({ ui: { locale: 'en' } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    expect(owner.current().ui.locale).toBe(DEFAULT_SETTINGS.ui.locale);
    expect(local.read(KEY)).toBeUndefined();
    expect(changes).toEqual([]);
    const retry = await owner.patch({ ui: { locale: 'en' } }, { baseRevision: 0, restricted: false });
    expect(retry.ok).toBe(true);
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui.locale).toBe('en');
  });

  it('[ST-015] a lost confirmation that cannot be read back: the next patch reads first, so the landed field is never reverted', async () => {
    const { owner, local, changes } = setup();
    await owner.start();
    local.holdEvents();
    local.failNext('set', 'lost');
    local.failNext('get');
    expect(await owner.patch({ ui: { locale: 'en' } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-WRITE' } });
    // Unknown whether it landed (it did): memory keeps the old value until a read succeeds.
    expect(owner.current().ui.locale).toBe(DEFAULT_SETTINGS.ui.locale);
    const next = await owner.patch({ ui: { hints: false } }, { baseRevision: 0, restricted: false });
    expect(next.ok && next.state.settings.ui).toMatchObject({ locale: 'en', hints: false });
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui).toMatchObject({ locale: 'en', hints: false });
    // The landed value was adopted (and broadcast) before the patch applied on top of it.
    expect(changes.map((state) => [state.revision, state.settings.ui.locale, state.settings.ui.hints])).toEqual([
      [1, 'en', true],
      [2, 'en', false],
    ]);
    local.releaseEvents();
    await settle(10);
    expect(owner.current().ui).toMatchObject({ locale: 'en', hints: false });
    expect(changes).toHaveLength(2);
  });

  it('[ST-015] a read-back that fails blocks the next write until a read succeeds (never written over an unread value)', async () => {
    const { owner, local } = setup();
    await owner.start();
    local.failNext('set', 'lost');
    local.failNext('get');
    local.failNext('get');
    await owner.patch({ ui: { locale: 'en' } }, { baseRevision: 0, restricted: false });
    expect(await owner.patch({ ui: { hints: false } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui).toMatchObject({ locale: 'en', hints: true });
  });

  it('a quota failure is CG-STORAGE-FULL and changes nothing', async () => {
    const { owner, local } = setup();
    local.failNext('set', 'full');
    expect(await owner.patch({ ui: { hints: false } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-FULL' }, state: { revision: 0 } });
    expect(local.read(KEY)).toBeUndefined();
  });

  it('[ST-018] a late echo of the owner\'s own earlier write is not an outside change (no revert, no stale broadcast)', async () => {
    const { owner, local, changes } = setup();
    await owner.start();
    // Firefox does not promise that onChanged arrives before set() resolves.
    local.holdEvents();
    await owner.patch({ ui: { theme: 'dark' } }, { baseRevision: 0, restricted: false });
    await owner.patch({ ui: { theme: 'light' } }, { baseRevision: 1, restricted: false });
    local.releaseEvents();
    await settle(20);
    expect(owner.current().ui.theme).toBe('light');
    expect(changes.map((state) => [state.revision, state.settings.ui.theme])).toEqual([
      [1, 'dark'],
      [2, 'light'],
    ]);
    const next = await owner.patch({ ui: { hints: false } }, { baseRevision: 2, restricted: false });
    expect(next).toMatchObject({ ok: true, state: { revision: 3 } });
    expect(local.read<typeof DEFAULT_SETTINGS>(KEY)?.ui).toMatchObject({ theme: 'light', hints: false });
  });

  it('[ST-018] a late echo arriving after an outside change does not hide it: the store is read again', async () => {
    const { owner, local, changes } = setup();
    await owner.start();
    local.holdEvents();
    await owner.patch({ ui: { theme: 'dark' } }, { baseRevision: 0, restricted: false });
    local.external(KEY, { ...clone(DEFAULT_SETTINGS), ui: { ...DEFAULT_SETTINGS.ui, theme: 'light', hints: false } });
    local.releaseEvents();
    await settle(20);
    expect(owner.current().ui).toMatchObject({ theme: 'light', hints: false });
    expect(changes.at(-1)).toMatchObject({ revision: 2, settings: { ui: { theme: 'light', hints: false } } });
  });

  it('the request handlers answer the RPC shape', async () => {
    const { owner } = setup();
    const handlers = settingsRequestHandlers(owner);
    expect(await handlers['settings.get']()).toMatchObject({ ok: true, payload: { revision: 0, readOnly: false } });
    expect(await handlers['settings.patch']({ patch: { ui: { theme: 'light' } }, baseRevision: 0 })).toMatchObject({ ok: true, payload: { revision: 1 } });
    expect(await handlers['settings.patch']({ patch: { debug: { enabled: true } }, baseRevision: 1 })).toMatchObject({ ok: false, error: { code: 'CG-UNKNOWN' } });
    expect(await handlers['settings.patchRestricted']({ patch: { debug: { enabled: true } }, baseRevision: 1 })).toMatchObject({
      ok: true,
      payload: { revision: 2, settings: { debug: { enabled: true } } },
    });
  });
});

describe('[RB-012] migrations run forward, at start, before the first answer', () => {
  it('migrates once, writes the result back, and only then answers', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { ...clone(customSettings), schemaVersion: 1, ui: { theme: 'dark', locale: 'ru', hints: false } });
    const steps: string[] = [];
    const { owner, logs } = setup({
      local,
      deps: { schemaVersion: 2, migrations: [{ from: 1, to: 2, migrate: (stored) => (steps.push('1→2'), { ...stored, ui: { ...(stored['ui'] as object), resultStyle: 'sheet' } }) }] },
    });
    const answer = owner.state();
    expect(owner.mode()).toBe('loading');
    const result = await answer;
    if (!result.ok) throw new Error('not loaded');
    const state = result.state;
    expect(steps).toEqual(['1→2']);
    expect(local.calls.set).toBe(1);
    expect(state.settings.ui).toEqual({ theme: 'dark', locale: 'ru', hints: false, resultStyle: 'sheet' });
    expect(state.readOnly).toBe(false);
    expect(logs.find((entry) => entry.msg === 'settings migrated')?.fields).toEqual({ from: 1, saved: true });
    // A second start is the same promise.
    expect(await owner.start()).toMatchObject({ kind: 'migrated' });
    expect(steps).toEqual(['1→2']);
  });

  it('a migrated value that could not be written back is used now and migrated again next start', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { ...clone(DEFAULT_SETTINGS), schemaVersion: 1 });
    local.failNext('set');
    const { owner, logs } = setup({ local, deps: { schemaVersion: 2, migrations: [{ from: 1, to: 2, migrate: (stored) => ({ ...stored }) }] } });
    expect(await owner.state()).toMatchObject({ ok: true, state: { readOnly: false } });
    expect(logs.find((entry) => entry.msg === 'settings migrated')).toMatchObject({ level: 'warn', code: 'CG-STORAGE-WRITE', fields: { from: 1, saved: false } });
  });

  it('[ST-017] an unreadable chain leaves the stored value untouched and the settings unavailable (CG-STORAGE-READ)', async () => {
    const local = createMemoryKv();
    const stored = { ...clone(customSettings), schemaVersion: 1 };
    local.data.set(KEY, stored);
    const { owner, changes } = setup({ local, deps: { schemaVersion: 3, migrations: [{ from: 1, to: 2, migrate: (s) => ({ ...s }) }] } });
    expect(await owner.state()).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(await settingsRequestHandlers(owner)['settings.get']()).toEqual({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    // Asking again reads again, but neither bumps the revision nor broadcasts.
    expect(await owner.state()).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(changes).toEqual([]);
    expect(await owner.patch({ ui: { hints: true } }, { baseRevision: null, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(local.read(KEY)).toEqual(stored);
    expect(local.calls.set).toBe(0);
  });
});

describe('[ST-016] a store written by a newer build is read-only (CG-STORAGE-VERSION)', () => {
  it('answers what it can read, flags read-only, writes nothing — not even the persona scope', async () => {
    const local = createMemoryKv();
    const future = { ...clone(customSettings), schemaVersion: 9, brandNew: { x: 1 } };
    local.data.set(KEY, future);
    const { owner, logs } = setup({ local });
    const result = await owner.state();
    expect(result).toMatchObject({ ok: true, state: { readOnly: true, settings: { ui: { theme: 'dark' } } } });
    expect(owner.mode()).toBe('newer');
    // ST-016, not ST-017: the RPC answers the readable settings, read-only.
    expect(await settingsRequestHandlers(owner)['settings.get']()).toMatchObject({ ok: true, payload: { readOnly: true, settings: { ui: { theme: 'dark' } } } });
    expect(await owner.patch({ ui: { hints: true } }, { baseRevision: 0, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-VERSION' } });
    expect(await owner.setPersonaScope({ hubOrigin: HUB, userId: 99 })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-VERSION' } });
    expect(local.read(KEY)).toEqual(future);
    expect(local.calls.set).toBe(0);
    expect(logs.find((entry) => entry.code === 'CG-STORAGE-VERSION')?.fields).toEqual({ storedVersion: 9 });
  });
});

describe('[ST-017] broken values, failed reads', () => {
  it('a broken optional value falls back to its default and is logged by path, never by value', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, { ...clone(customSettings), ui: { ...customSettings.ui, theme: 'neon' } });
    const { owner, logs } = setup({ local });
    const result = await owner.state();
    if (!result.ok) throw new Error('not loaded');
    const state = result.state;
    expect(state.settings.ui.theme).toBe('host');
    expect(state.settings.accounts).toEqual(customSettings.accounts);
    expect(state.readOnly).toBe(false);
    expect(logs.find((entry) => entry.msg === 'broken settings reset to defaults')?.fields).toEqual({ paths: 'ui.theme', count: 1 });
    expectNoValues(logs);
  });

  it('a failed read never erases: nothing is written until a read succeeds, then the stored values are kept', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, clone(customSettings));
    local.failNext('get');
    local.failNext('get');
    local.failNext('get');
    const { owner, logs, changes } = setup({ local });
    expect(await owner.start()).toEqual({ kind: 'unreadable', code: 'CG-STORAGE-READ' });
    expect(owner.mode()).toBe('unreadable');
    // «Settings Unavailable»: settings.get is an error, never defaults posing as the person's values.
    expect(await settingsRequestHandlers(owner)['settings.get']()).toEqual({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    // The next request reads again (fails again): nothing written, nothing broadcast.
    expect(await owner.patch({ sound: { volume: 90 } }, { baseRevision: null, restricted: false })).toMatchObject({ ok: false, error: { code: 'CG-STORAGE-READ' } });
    expect(local.calls.set).toBe(0);
    expect(local.read(KEY)).toEqual(customSettings);
    expect(changes).toEqual([]);
    // The read works now: the person's values come back (broadcast once) and the change lands on top of them.
    const saved = await owner.patch({ sound: { volume: 90 } }, { baseRevision: null, restricted: false });
    expect(saved.ok).toBe(true);
    expect(changes.map((state) => [state.revision, state.settings.sound.volume])).toEqual([
      [1, customSettings.sound.volume],
      [2, 90],
    ]);
    expect(local.read(KEY)).toEqual({ ...customSettings, sound: { ...customSettings.sound, volume: 90 } });
    expect(logs.filter((entry) => entry.code === 'CG-STORAGE-READ').length).toBeGreaterThanOrEqual(2);
    expectNoValues(logs);
  });

  it('a value written by someone else («Очистить локальные данные») is read like a load and broadcast', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, clone(customSettings));
    const { owner, changes } = setup({ local });
    await owner.start();
    local.external(KEY, undefined);
    await settle(10);
    expect(owner.current()).toEqual(DEFAULT_SETTINGS);
    expect(changes.at(-1)).toMatchObject({ revision: 1, readOnly: false });
    // Our own write is not mistaken for someone else's.
    await owner.patch({ ui: { hints: false } }, { baseRevision: 1, restricted: false });
    await settle(10);
    expect(changes.map((state) => state.revision)).toEqual([1, 2]);
    // A newer build wrote it: read-only from now on.
    local.external(KEY, { ...clone(DEFAULT_SETTINGS), schemaVersion: 4 });
    await settle(10);
    expect(owner.mode()).toBe('newer');
    expect(changes.at(-1)?.readOnly).toBe(true);
  });
});

describe('persona scope (§5.6): set by the background on sign-in, never guessed', () => {
  it('another hub user clears the persona choices; the same user keeps them without a write', async () => {
    const local = createMemoryKv();
    local.data.set(KEY, clone(customSettings));
    const { owner } = setup({ local });
    expect(await owner.setPersonaScope({ hubOrigin: HUB, userId: 7 })).toMatchObject({ ok: true, state: { revision: 0 } });
    expect(local.calls.set).toBe(0);
    const other = await owner.setPersonaScope({ hubOrigin: HUB, userId: 8 });
    expect(other.ok && other.state.settings.personas).toEqual({ scope: { hubOrigin: HUB, userId: 8 }, byPageId: {} });
    expect(other.ok && other.state.settings.accounts.labels[`chatspace:${IDS.acc}`]).toBe('Main model');
  });
});

describe('[BG-004] background unload and restart', () => {
  it('a new event page restores the settings and continues the revision kept in storage.session', async () => {
    const first = setup();
    await first.owner.patch({ ui: { theme: 'dark' } }, { baseRevision: 0, restricted: false });
    await first.owner.patch({ ui: { hints: false } }, { baseRevision: 1, restricted: false });
    expect(first.session.read(SESSION_KEYS.settingsRevision)).toBe(2);
    first.unload();

    const second = setup({ local: first.local, session: first.session });
    expect(await second.owner.state()).toMatchObject({ ok: true, state: { revision: 2, readOnly: false, settings: { ui: { theme: 'dark', hints: false } } } });
    const next = await second.owner.patch({ ui: { theme: 'light' } }, { baseRevision: 2, restricted: false });
    expect(next.ok && next.state.revision).toBe(3);
    second.unload();

    // A browser restart: storage.session is empty, storage.local is not.
    first.session.wipe();
    const third = setup({ local: first.local, session: first.session });
    expect(await third.owner.state()).toMatchObject({ ok: true, state: { revision: 0, settings: { ui: { theme: 'light', hints: false } } } });
  });

  it('an outside change before `start` never resets the revision kept in storage.session', async () => {
    const local = createMemoryKv();
    const session = createMemoryKv();
    session.data.set(SESSION_KEYS.settingsRevision, 57);
    const { owner, changes } = setup({ local, session });
    local.external(KEY, { ...clone(DEFAULT_SETTINGS), ui: { ...DEFAULT_SETTINGS.ui, theme: 'dark' } });
    await settle(10);
    expect(changes).toEqual([]);
    expect(await owner.state()).toMatchObject({ ok: true, state: { revision: 57, settings: { ui: { theme: 'dark' } } } });
    const next = await owner.patch({ ui: { hints: false } }, { baseRevision: 57, restricted: false });
    expect(next).toMatchObject({ ok: true, state: { revision: 58 } });
    expect(session.read(SESSION_KEYS.settingsRevision)).toBe(58);
  });

  it('a revision that could not be kept is logged and the change still lands', async () => {
    const { owner, session, logs } = setup();
    session.failNext('set');
    expect((await owner.patch({ ui: { hints: false } }, { baseRevision: 0, restricted: false })).ok).toBe(true);
    expect(logs.some((entry) => entry.msg === 'revision not kept')).toBe(true);
  });
});
