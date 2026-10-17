import { describe, expect, it } from 'vitest';

import * as C from '../src/index';
import { SCHEMA_FIXTURES } from './fixtures/index';

/** Every exported `*Schema` value of @cg/contracts. */
function exportedSchemas(): Array<[string, unknown]> {
  return Object.entries(C).filter(([name]) => name.endsWith('Schema'));
}

describe('contract schemas: one valid and one invalid fixture at least', () => {
  it('every exported schema has fixtures', () => {
    const covered = new Set<unknown>(SCHEMA_FIXTURES.map((entry) => entry.schema));
    const missing = exportedSchemas()
      .filter(([, schema]) => !covered.has(schema))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('every fixture entry has both verdicts', () => {
    const thin = SCHEMA_FIXTURES.filter((entry) => entry.valid.length === 0 || entry.invalid.length === 0).map((entry) => entry.name);
    expect(thin).toEqual([]);
  });

  for (const entry of SCHEMA_FIXTURES) {
    it(`${entry.name}: valid fixtures pass, invalid ones fail`, () => {
      entry.valid.forEach((value, index) => {
        const result = entry.schema.safeParse(value);
        expect(result.success, `${entry.name} valid[${index}]: ${result.success ? '' : JSON.stringify(result.error.issues)}`).toBe(true);
      });
      entry.invalid.forEach((value, index) => {
        expect(entry.schema.safeParse(value).success, `${entry.name} invalid[${index}] passed`).toBe(false);
      });
    });
  }
});

describe('identities', () => {
  it('chatKeyOf builds the one key form that ChatKeySchema accepts', () => {
    const key = C.chatKeyOf({ host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' });
    expect(key).toBe('chatspace:1001:2002');
    expect(C.ChatKeySchema.safeParse(key).success).toBe(true);
  });

  it('narrows open hub tokens instead of failing (critic item 14)', () => {
    expect(C.narrowPlatform('onlyfans')).toBe('onlyfans');
    expect(C.narrowPlatform('patreon')).toBeNull();
    expect(C.narrowRole('team_lead')).toBe('team_lead');
    expect(C.narrowRole('auditor')).toBe('unknown');
  });

  it('uses one id form for every native id', () => {
    for (const id of ['1', '18446744073709551617', '9'.repeat(30)]) expect(C.NativeIdSchema.safeParse(id).success).toBe(true);
    for (const id of ['0', '007', '1e3', ' 1', '1 ']) expect(C.NativeIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('settings', () => {
  it('defaults are valid v1 settings and stay inside the ranges', () => {
    expect(C.SettingsV1Schema.parse(C.DEFAULT_SETTINGS)).toEqual(C.DEFAULT_SETTINGS);
    expect(C.DEFAULT_SETTINGS.schemaVersion).toBe(C.SETTINGS_SCHEMA_VERSION);
    expect(C.DEFAULT_SETTINGS.hub.baseUrl).toBe(C.DEFAULT_HUB_ORIGIN);
    expect(C.SettingsSchema).toBe(C.SettingsV1Schema);
  });

  it('[ST-135] [I18-001] a fresh install is Russian, whatever the browser says (1.14.0, X29); «Как в системе» and English stay values of the setting', () => {
    expect(C.DEFAULT_SETTINGS.ui.locale).toBe('ru');
    expect(C.DEFAULT_SETTINGS.ui.locale).toBe(C.DEFAULT_LOCALE);
    expect(C.UI_LOCALES).toEqual(['system', 'ru', 'en']);
  });

  it('[AI-003] «Помнить тон в чате» (1.18.0, X45): on by default, optional in the store — a store from before reads, a non-boolean does not', () => {
    expect(C.DEFAULT_SETTINGS.generation.rememberTone).toBe(true);
    const { rememberTone: _dropped, ...older } = C.DEFAULT_SETTINGS.generation;
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, generation: older }).success).toBe(true);
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, generation: { ...older, rememberTone: false } }).success).toBe(true);
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, generation: { ...older, rememberTone: 'yes' } }).success).toBe(false);
    expect(C.SettingsPatchSchema.safeParse({ generation: { rememberTone: false } }).success).toBe(true);
    expect(C.SettingsPatchSchema.safeParse({ generation: { rememberTone: 1 } }).success).toBe(false);
    expect(C.PREFERENCE_KEYS).toContain('generation.rememberTone');
  });

  it('[X49] «Размер текста» (1.22.0): optional in the store — a store from before reads (normal), the two sizes read, anything else does not', () => {
    expect(C.UI_TEXT_SIZES).toEqual(['normal', 'large']);
    expect(C.DEFAULT_SETTINGS.ui.textSize).toBe('normal');
    const { textSize: _dropped, ...older } = C.DEFAULT_SETTINGS.ui;
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, ui: older }).success).toBe(true);
    for (const textSize of C.UI_TEXT_SIZES) expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, ui: { ...C.DEFAULT_SETTINGS.ui, textSize } }).success).toBe(true);
    expect(C.SettingsV1Schema.safeParse({ ...C.DEFAULT_SETTINGS, ui: { ...C.DEFAULT_SETTINGS.ui, textSize: 'huge' } }).success).toBe(false);
    expect(C.SettingsPatchSchema.safeParse({ ui: { textSize: 'large' } }).success).toBe(true);
    expect(C.SettingsPatchSchema.safeParse({ ui: { textSize: 15 } }).success).toBe(false);
    expect(C.PREFERENCE_KEYS).toContain('ui.textSize');
    expect(C.TEXT_SIZE_ATTRIBUTE).toBe('data-text-size');
    for (const token of ['--cg-text-ai', '--cg-leading-ai', '--cg-text-kbd'] as const) expect(C.THEME_TOKEN_NAMES).toContain(token);
  });

  it('a forward migration chain is typed from one version to the next', () => {
    const toV1: C.SettingsMigrationStep = {
      from: 0,
      to: 1,
      migrate: (stored) => ({ ...C.DEFAULT_SETTINGS, ui: { ...C.DEFAULT_SETTINGS.ui, hints: stored['showToolbarHints'] !== false } }),
    };
    const chain: C.SettingsMigrations = [toV1];
    const migrated = chain.reduce<Record<string, unknown>>((stored, step) => step.migrate(stored), { showToolbarHints: false });
    expect(C.SettingsSchema.parse(migrated).ui.hints).toBe(false);
    expect(chain.every((step) => step.to === step.from + 1)).toBe(true);
  });

  it('the unreadable outcome carries a registered code', () => {
    const outcome: C.SettingsLoadOutcome = { kind: 'unreadable', code: 'CG-STORAGE-READ' };
    expect(C.isCgCode(outcome.kind === 'unreadable' ? outcome.code : null)).toBe(true);
  });
});
