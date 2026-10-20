import { customSettings, HUB, IDS } from '@cg/contracts/fixtures';
import { STORAGE_KEYS, type SettingsState } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { stableJson } from '../domain/storage';
import { createSettingsExtOwner, createSettingsOwner, settingsRequestHandlers, type SettingsOwnerDeps } from './settings-owner';
import type { KeyValuePort, ServiceLogEntry } from './storage/ports';
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
});

describe('[RB-012] migrations run forward, at start, before the first answer', () => {
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

describe('the look of the old Fansly client, taken once (2026-10-20)', () => {
  it('a store from before moves «как на сайте» to light and the text to «Крупнее»; a choice made after that stays', async () => {
    const before = (ui: Record<string, unknown>): Record<string, unknown> => ({ ...clone(customSettings), ui });
    const load = async (stored: Record<string, unknown>): Promise<unknown> => {
      const local = createMemoryKv();
      local.data.set(KEY, stored);
      const { owner } = setup({ local });
      return (await owner.state()).ok ? (await settingsRequestHandlers(owner)['settings.get']()) : null;
    };
    const ui = (answer: unknown): unknown => (answer as { ok: true; payload: { settings: { ui: unknown } } }).payload.settings.ui;
    expect({
      siteTheme: ui(await load(before({ theme: 'host', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'normal' }))),
      chosenDark: ui(await load(before({ theme: 'dark', locale: 'ru', hints: true, resultStyle: 'bare' }))),
      takenThenChosen: ui(await load(before({ theme: 'host', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'normal', defaultsTaken: 2 }))),
    }).toEqual({
      siteTheme: { theme: 'light', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'large', defaultsTaken: 2 },
      chosenDark: { theme: 'dark', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'large', defaultsTaken: 2 },
      takenThenChosen: { theme: 'host', locale: 'ru', hints: true, resultStyle: 'bare', textSize: 'normal', defaultsTaken: 2 },
    });
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

// ── settings.ext (1.15.0, R20 FS-SET-1; host: fansly-web) ──────────────────

const EXT_KEY = STORAGE_KEYS.settingsExt;
const FANSLY = 'fansly-web';

/** A port that records the keys every write touches (`-key` — removed). */
function recorded(port: KeyValuePort & { detach(): void }): { readonly port: KeyValuePort & { detach(): void }; readonly writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    port: {
      ...port,
      set: (items) => {
        writes.push(...Object.keys(items));
        return port.set(items);
      },
      remove: (keys) => {
        writes.push(...keys.map((key) => `-${key}`));
        return port.remove(keys);
      },
    },
  };
}

describe('[RB-012] rollback acceptance (FS-SET-1, fansly-web): new build → old build → theme change → new build', () => {
  /**
   * A build of 1.15.0 or later: the v1 owner and the settings.ext owner. A build before 1.15.0: the v1 owner alone
   * — `createSettingsOwner` is that build's owner as it was (1.15.0 adds a second owner beside it and changes
   * nothing of it), so it runs here as «the old build», on the same storage, writes recorded.
   */
  function build(local: MemoryKv, session: MemoryKv, withExt: boolean) {
    const v1Port = recorded(local.open());
    const extPort = recorded(local.open());
    const sessionPort = session.open();
    const v1 = createSettingsOwner({ local: v1Port.port, session: sessionPort });
    const ext = withExt ? createSettingsExtOwner({ local: extPort.port, session: sessionPort }) : null;
    return {
      v1,
      ext,
      writes: (): string[] => [...v1Port.writes, ...extPort.writes],
      unload: (): void => {
        v1.dispose();
        ext?.dispose();
        v1Port.port.detach();
        extPort.port.detach();
        sessionPort.detach();
      },
    };
  }

  it('the Fansly settings, the depth and «Fansly включён» (the script registration) are there again; the old build’s theme stays', async () => {
    const local = createMemoryKv();
    const session = createMemoryKv();

    // 1. The new build: the person switches Fansly on, picks its settings and a depth above 3000.
    const first = build(local, session, true);
    await first.v1.start();
    await first.ext?.start();
    expect((await first.v1.patch({ sound: { volume: 70 } }, { baseRevision: null, restricted: false })).ok).toBe(true);
    const fansly = { enabled: true, viaTab: true, notesView: 'docked', sound: { messagesTone: 'drop', subscribersTone: 'bell' } } as const;
    expect((await first.ext?.patch({ hosts: { [FANSLY]: fansly }, windows: { deep: 4500 } }))?.ok).toBe(true);
    const storedExt = stableJson(local.read(EXT_KEY));
    first.unload();

    // 2. Rollback: the old build starts on the same storage; the person changes the theme and signs in again.
    const old = build(local, session, false);
    expect(await old.v1.start()).toMatchObject({ kind: 'current', repaired: [] });
    expect((await old.v1.patch({ ui: { theme: 'dark' } }, { baseRevision: null, restricted: false })).ok).toBe(true);
    expect((await old.v1.setPersonaScope({ hubOrigin: HUB, userId: 7 })).ok).toBe(true);
    await settle(20);
    expect(old.writes()).toEqual([STORAGE_KEYS.settings, STORAGE_KEYS.settings]);
    expect(stableJson(local.read(EXT_KEY))).toBe(storedExt);
    old.unload();

    // 3. Back on the new build: nothing of `settings.ext` is lost, the old build's change stays.
    const back = build(local, session, true);
    expect(await back.ext?.start()).toMatchObject({ kind: 'current', repaired: [] });
    expect(await back.ext?.state()).toMatchObject({ ok: true, state: { readOnly: false, ext: { hosts: { [FANSLY]: fansly }, windows: { deep: 4500 } } } });
    // The registration of the Fansly scripts follows «Fansly включён» at every background start (R20 §4).
    expect(back.ext?.current().hosts[FANSLY].enabled).toBe(true);
    expect(await back.v1.state()).toMatchObject({ ok: true, state: { settings: { ui: { theme: 'dark' }, sound: { volume: 70 }, personas: { scope: { hubOrigin: HUB, userId: 7 } } } } });
    expect(back.writes()).toEqual([]);
    back.unload();
  });
});
