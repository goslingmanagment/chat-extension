import { customSettings, HUB, IDS } from '@cg/contracts/fixtures';
import { DEFAULT_SETTINGS, SettingsSchema, STORAGE_KEYS, type SettingsMigrations, type SettingsV1 } from '@cg/contracts/settings';
import { describe, expect, it } from 'vitest';

import { RESULT_MAX_BYTES, SESSION_KEYS, STORAGE_KEY_BUDGETS, isPlainRecord, jsonUtf8Bytes, stableJson, storageBudgetOf } from '../storage';
import {
  SETTINGS_MIGRATIONS,
  SYSTEM_LOCALE_LAST_VERSION,
  SYSTEM_LOCALE_REWRITE,
  applySettingsPatch,
  loadStoredSettings,
  migrationChainProblems,
  oldestSupportedVersion,
  repairSettings,
  rewritesSystemLocale,
  touchesRestricted,
  withPersonaScope,
} from './index';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('[RB-012] settings load: numbered forward-only migrations', () => {
  it('nothing stored is fresh defaults; a current value is kept as it is', () => {
    expect(loadStoredSettings(undefined)).toEqual({ kind: 'fresh', settings: DEFAULT_SETTINGS });
    expect(loadStoredSettings(clone(customSettings))).toEqual({ kind: 'current', settings: customSettings, repaired: [] });
  });

  it('[ST-135] «Как в системе» stored before 1.14.0 (the old default) is a value like any other: kept, not repaired, no migration', () => {
    const stored = { ...clone(DEFAULT_SETTINGS), ui: { ...clone(DEFAULT_SETTINGS.ui), locale: 'system' } };
    const outcome = loadStoredSettings(clone(stored));
    expect(outcome).toEqual({ kind: 'current', settings: stored, repaired: [] });
    expect(loadStoredSettings(undefined)).toMatchObject({ kind: 'fresh', settings: { ui: { locale: 'ru' } } });
  });

  it('the build chain is sound: v1 is the first schema, nothing older to migrate yet', () => {
    expect(SETTINGS_MIGRATIONS).toEqual([]);
    expect(migrationChainProblems(SETTINGS_MIGRATIONS)).toEqual([]);
    expect(oldestSupportedVersion(SETTINGS_MIGRATIONS)).toBe(1);
  });

  it('runs every step in order from the stored version, then checks the result against the schema', () => {
    const seen: number[] = [];
    const chain: SettingsMigrations = [
      { from: 1, to: 2, migrate: (stored) => (seen.push(1), { ...stored, ui: { ...(stored['ui'] as object), theme: 'dark' } }) },
      { from: 2, to: 3, migrate: (stored) => (seen.push(2), { ...stored, legacyField: true }) },
    ];
    expect(migrationChainProblems(chain, 3)).toEqual([]);
    expect(oldestSupportedVersion(chain, 3)).toBe(1);
    const outcome = loadStoredSettings({ ...clone(DEFAULT_SETTINGS), schemaVersion: 1 }, chain, 3);
    expect(seen).toEqual([1, 2]);
    expect(outcome.kind).toBe('migrated');
    if (outcome.kind !== 'migrated') return;
    expect(outcome.from).toBe(1);
    expect(outcome.settings.ui.theme).toBe('dark');
    expect(SettingsSchema.safeParse(outcome.settings).success).toBe(true);
    // From version 2 only the second step runs.
    seen.length = 0;
    loadStoredSettings({ ...clone(DEFAULT_SETTINGS), schemaVersion: 2 }, chain, 3);
    expect(seen).toEqual([2]);
  });

  it('a broken chain, a missing step, a throwing step or a step without an object is unreadable — the value stays', () => {
    const value = { ...clone(DEFAULT_SETTINGS), schemaVersion: 1 };
    const gap: SettingsMigrations = [
      { from: 1, to: 2, migrate: (s) => ({ ...s }) },
      { from: 3, to: 4, migrate: (s) => ({ ...s }) },
    ];
    expect(migrationChainProblems(gap, 4)).toEqual(['step 1: starts at 3, the previous ends at 2']);
    expect(migrationChainProblems([{ from: 1, to: 3, migrate: (s) => ({ ...s }) }], 3)).toEqual(['step 0: 1 → 3 is not one version forward']);
    expect(migrationChainProblems([{ from: 1, to: 2, migrate: (s) => ({ ...s }) }], 3)).toEqual(['the chain ends at 2, the build is at 3']);
    expect(loadStoredSettings(value, gap, 4)).toEqual({ kind: 'unreadable', code: 'CG-STORAGE-READ' });
    expect(loadStoredSettings(value, [{ from: 2, to: 3, migrate: (s) => ({ ...s }) }], 3)).toEqual({ kind: 'unreadable', code: 'CG-STORAGE-READ' });
    const throwing: SettingsMigrations = [
      {
        from: 1,
        to: 2,
        migrate: () => {
          throw new Error('bad');
        },
      },
    ];
    expect(loadStoredSettings(value, throwing, 2)).toEqual({ kind: 'unreadable', code: 'CG-STORAGE-READ' });
    const notObject: SettingsMigrations = [{ from: 1, to: 2, migrate: () => [] as unknown as Record<string, unknown> }];
    expect(loadStoredSettings(value, notObject, 2)).toEqual({ kind: 'unreadable', code: 'CG-STORAGE-READ' });
  });
});

describe('[ST-016] a store newer than the build', () => {
  it('reads what it can and says so; nothing is migrated', () => {
    const future = { ...clone(customSettings), schemaVersion: 7, ui: { ...customSettings.ui, density: 'tight' }, newSection: { x: 1 } };
    const outcome = loadStoredSettings(future);
    expect(outcome.kind).toBe('newer');
    if (outcome.kind !== 'newer') return;
    expect(outcome.storedVersion).toBe(7);
    expect(outcome.settings.ui.theme).toBe('dark');
    expect(outcome.settings.sound.volume).toBe(35);
    expect(outcome.settings.schemaVersion).toBe(1);
  });
});

describe('broken optional settings fall back to defaults, by path (§9.4)', () => {
  it('resets only what fails its schema, keeps the rest, drops unknown keys', () => {
    const stored = clone(customSettings) as unknown as Record<string, Record<string, unknown>>;
    stored['ui'] = { ...stored['ui'], theme: 'neon', unknownKey: 1 };
    stored['sound'] = { ...stored['sound'], volume: 7 };
    (stored as Record<string, unknown>)['extra'] = { a: 1 };
    const outcome = loadStoredSettings(stored);
    expect(outcome.kind).toBe('current');
    if (outcome.kind !== 'current') return;
    expect(outcome.repaired).toEqual(['ui.theme', 'sound.volume']);
    expect(outcome.settings.ui).toEqual({ ...customSettings.ui, theme: 'host' });
    expect(outcome.settings.sound.volume).toBe(DEFAULT_SETTINGS.sound.volume);
    expect(outcome.settings.accounts).toEqual(customSettings.accounts);
    expect(outcome.settings).not.toHaveProperty('extra');
  });

  it('trims a list and a map item by item', () => {
    const stored = clone(customSettings) as unknown as Record<string, Record<string, unknown>>;
    stored['sound'] = { ...stored['sound'], mutedAccounts: [`chatspace:${IDS.acc}`, 'nonsense', `chatspace:${IDS.otherAcc}`] };
    stored['accounts'] = { labels: { [`chatspace:${IDS.acc}`]: 'Main', 'bad key': 'x', [`chatspace:${IDS.otherAcc}`]: 'y'.repeat(200) } };
    const { settings, repaired } = repairSettings(stored);
    expect(settings.sound.mutedAccounts).toEqual([`chatspace:${IDS.acc}`, `chatspace:${IDS.otherAcc}`]);
    expect(settings.accounts.labels).toEqual({ [`chatspace:${IDS.acc}`]: 'Main' });
    expect(repaired).toEqual(['sound.mutedAccounts', 'accounts.labels']);
  });

  it('a whole section that is not an object is its default; a value that is not an object at all is all defaults', () => {
    const stored = { ...clone(customSettings), generation: 'oops' };
    const { settings, repaired } = repairSettings(stored);
    expect(settings.generation).toEqual(DEFAULT_SETTINGS.generation);
    expect(repaired).toEqual(['generation']);
    expect(repairSettings('junk')).toEqual({ settings: DEFAULT_SETTINGS, repaired: ['settings'] });
    expect(loadStoredSettings(['junk'])).toEqual({ kind: 'current', settings: DEFAULT_SETTINGS, repaired: ['settings'] });
    const noVersion: Record<string, unknown> = clone(customSettings);
    delete noVersion['schemaVersion'];
    const outcome = loadStoredSettings(noVersion);
    expect(outcome).toMatchObject({ kind: 'current', repaired: ['schemaVersion'] });
  });

  it('identity is never guessed: a broken persona scope drops the persona choices it scoped', () => {
    const stored = clone(customSettings) as unknown as Record<string, Record<string, unknown>>;
    stored['personas'] = { ...stored['personas'], scope: { hubOrigin: 'not a url', userId: 7 } };
    const { settings, repaired } = repairSettings(stored);
    expect(settings.personas).toEqual({ scope: null, byPageId: {} });
    expect(repaired).toEqual(['personas.scope', 'personas.byPageId']);
    const whole = repairSettings({ ...clone(customSettings), personas: 5 });
    expect(whole.settings.personas).toEqual({ scope: null, byPageId: {} });
    expect(whole.repaired).toEqual(['personas']);
  });
});

describe('[ST-013] applying a settings change', () => {
  const base: SettingsV1 = clone(customSettings);

  it('merges field by field; null removes a map key; the muted list is replaced and deduplicated', () => {
    const outcome = applySettingsPatch(
      base,
      {
        ui: { theme: 'light' },
        generation: { windows: { quick: 50 }, coach: { autoRecap: 'short' } },
        sound: { messages: { tone: 'bell' }, mutedAccounts: [`chatspace:${IDS.acc}`, `chatspace:${IDS.acc}`] },
        personas: { byPageId: { '11': null, '12': { key: 'ari', definitionId: 'pdef_0123456789abcdef' } } },
        accounts: { labels: { [`chatspace:${IDS.acc}`]: null, [`chatspace:${IDS.otherAcc}`]: 'Second' } },
        onboarding: { keysFooter: { shown: 1, dismissed: true } },
      },
      { restricted: false },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.changed).toBe(true);
    expect(outcome.hubChanged).toBe(false);
    expect(outcome.settings.ui).toEqual({ ...base.ui, theme: 'light' });
    expect(outcome.settings.generation.windows).toEqual({ ...base.generation.windows, quick: 50 });
    expect(outcome.settings.generation.coach).toEqual({ historyLimit: 10, autoRecap: 'short' });
    expect(outcome.settings.sound.messages).toEqual({ on: true, tone: 'bell' });
    expect(outcome.settings.sound.mutedAccounts).toEqual([`chatspace:${IDS.acc}`]);
    expect(outcome.settings.personas).toEqual({ scope: base.personas.scope, byPageId: { '12': { key: 'ari', definitionId: 'pdef_0123456789abcdef' } } });
    expect(outcome.settings.accounts.labels).toEqual({ [`chatspace:${IDS.otherAcc}`]: 'Second' });
  });

  it('the hub address and debug only from the options page; a new hub drops the persona choices', () => {
    expect(touchesRestricted({ debug: { enabled: true } })).toBe(true);
    expect(touchesRestricted({ ui: { hints: true } })).toBe(false);
    expect(applySettingsPatch(base, { debug: { enabled: true } }, { restricted: false })).toEqual({ ok: false, reason: 'restricted' });
    const debug = applySettingsPatch(base, { debug: { enabled: true } }, { restricted: true });
    expect(debug).toMatchObject({ ok: true, changed: true, hubChanged: false });
    const moved = applySettingsPatch(base, { hub: { baseUrl: 'https://other.example.test' } }, { restricted: true });
    expect(moved.ok && moved.hubChanged).toBe(true);
    if (moved.ok) expect(moved.settings.personas).toEqual({ scope: null, byPageId: {} });
  });

  it('a change that breaks the schema is refused whole; the same values again change nothing', () => {
    expect(applySettingsPatch(base, { sound: { volume: 7 } }, { restricted: false })).toEqual({ ok: false, reason: 'invalid' });
    expect(applySettingsPatch(base, { ui: { theme: base.ui.theme } }, { restricted: false })).toMatchObject({ ok: true, changed: false });
  });

  it('the persona scope belongs to one hub and one user', () => {
    const scope = { hubOrigin: HUB, userId: 7 };
    expect(withPersonaScope(base, scope)).toBe(base);
    expect(withPersonaScope(base, { hubOrigin: HUB, userId: 8 }).personas).toEqual({ scope: { hubOrigin: HUB, userId: 8 }, byPageId: {} });
    expect(withPersonaScope(base, null).personas).toEqual({ scope: null, byPageId: {} });
    const empty = clone(DEFAULT_SETTINGS);
    expect(withPersonaScope(empty, null)).toBe(empty);
  });
});

describe('[ST-135] «Как в системе» of an install made before Russian became the default', () => {
  it('[ST-135] an update from 0.2.2 or older rewrites a stored «Как в системе», once, to Russian', () => {
    expect(SYSTEM_LOCALE_LAST_VERSION).toBe('0.2.2');
    for (const previous of ['0.1.0', '0.1.1', '0.2.0', '0.2.1', '0.2.2', '0.2', '0.2.2.0', ' 0.2.0 ']) expect([previous, rewritesSystemLocale(previous, 'system')]).toEqual([previous, true]);
    // What it writes: the language alone, Russian, through the ordinary patch.
    const stored = { ...clone(DEFAULT_SETTINGS), ui: { ...clone(DEFAULT_SETTINGS.ui), locale: 'system' as const } };
    const outcome = applySettingsPatch(stored, SYSTEM_LOCALE_REWRITE, { restricted: false });
    expect(outcome).toMatchObject({ ok: true, changed: true, hubChanged: false });
    expect(outcome.ok && outcome.settings).toEqual({ ...stored, ui: { ...stored.ui, locale: 'ru' } });
  });

  it('[ST-135] an update from a later build leaves it: what is stored then was chosen after the rewrite had its one chance', () => {
    for (const previous of ['0.2.3', '0.2.2.1', '0.3.0', '1.0', '10.0.0']) expect([previous, rewritesSystemLocale(previous, 'system')]).toEqual([previous, false]);
  });

  it('[ST-135] a version that is not one, or none, rewrites nothing', () => {
    for (const previous of ['', 'x', '0.2.1-beta', 'v0.2.1', '0.2.1.0.0', '0..1', '0.2.1b1', null, undefined]) expect([previous, rewritesSystemLocale(previous, 'system')]).toEqual([previous, false]);
  });

  it('[ST-135] Russian or English chosen by the person is never touched, whatever the version', () => {
    for (const previous of ['0.1.0', '0.2.1', '0.3.0']) {
      expect(rewritesSystemLocale(previous, 'ru')).toBe(false);
      expect(rewritesSystemLocale(previous, 'en')).toBe(false);
    }
  });
});

describe('storage budgets and JSON measures (§9.4)', () => {
  it('[NF-012] every stored key has a budget; results have one each', () => {
    for (const key of Object.values(STORAGE_KEYS)) expect(storageBudgetOf(key)).toBeGreaterThan(0);
    expect(storageBudgetOf(`${SESSION_KEYS.resultPrefix}abc`)).toBe(RESULT_MAX_BYTES);
    expect(storageBudgetOf(SESSION_KEYS.resultsIndex)).toBe(STORAGE_KEY_BUDGETS[SESSION_KEYS.resultsIndex]);
    expect(storageBudgetOf('somethingElse')).toBeUndefined();
  });

  it('measures UTF-8 JSON, sorts keys for comparison, recognizes plain records', () => {
    expect(jsonUtf8Bytes({ a: 'я' })).toBe(10);
    expect(jsonUtf8Bytes('😀')).toBe(6);
    expect(jsonUtf8Bytes('\ud800')).toBe(8);
    expect(jsonUtf8Bytes(undefined)).toBeNull();
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    expect(jsonUtf8Bytes(cycle)).toBeNull();
    expect(stableJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
    expect(stableJson(undefined)).toBe('undefined');
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
  });
});
