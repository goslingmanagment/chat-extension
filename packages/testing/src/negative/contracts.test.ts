// Negative checks over the frozen contracts (R02; docs/parity,
// PARITY_EXCEPTIONS): what the owner removed and what the new client does not
// need has no code, no setting, no action, no hotkey and no hub error of its
// own — and no shipped source brings it back by name.

import {
  CG_CODES,
  DEFAULT_SETTINGS,
  DraftSnapshotSchema,
  FEATURE_IDS,
  HUB_AI_FEATURES,
  HUB_ERROR_STATUSES,
  HUB_FEATURE_MAP,
  HUB_HTTP_ERROR_RULES,
  HubBindingSchema,
  PREFERENCE_KEYS,
  STORAGE_KEYS,
  UI_ACTION_TYPES,
  UiActionSchema,
} from '@cg/contracts';
import { PARITY_EXCEPTIONS } from '@cg/contracts/parity/exceptions';
import { HOTKEYS } from '@chatgoose/hotkeys';
import { describe, expect, it } from 'vitest';

import { findInClientSources } from './sources';

const settingPaths = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.entries(value).flatMap(([key, inner]) => [`${prefix}${key}`, ...settingPaths(inner, `${prefix}${key}.`)]) : [];
const SETTING_PATHS = settingPaths(DEFAULT_SETTINGS);
const rowsOf = (id: string): readonly string[] => PARITY_EXCEPTIONS.find((exception) => exception.id === id)?.rows ?? [];
const REGISTRIES = ['packages/contracts/src/parity/exceptions.ts'];

describe('[ER-069] [ER-083] [ER-084] NEG-OLD-CODES', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-OLD-CODES')).toEqual(['ER-069', 'ER-083', 'ER-084']);
  });

  it('every code is CG-<AREA>-<NAME> without numbers; there is no password-change code anywhere', () => {
    expect(CG_CODES.filter((code) => !/^CG-[A-Z]+(?:-[A-Z]+)*$/.test(code))).toEqual([]);
    expect(CG_CODES.filter((code) => /PASSWORD|PASS-CHANGE/.test(code))).toEqual([]);
    expect(Object.keys(HUB_ERROR_STATUSES).filter((error) => /password/i.test(error))).toEqual([]);
    expect(HUB_HTTP_ERROR_RULES.filter((rule) => /password/i.test(String(rule.error)))).toEqual([]);
    expect(findInClientSources(/password_change_required|mustChangePassword\s*[=:]\s*true|\bCG-\d|\bE\d{3,}\b/, REGISTRIES)).toEqual([]);
  });
});

describe('[ER-082] [LG-019] [RB-029] [CS-027] NEG-MESSAGE-GUARD', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-MESSAGE-GUARD')).toEqual(['ER-082', 'LG-019', 'RB-029', 'CS-027']);
  });

  it('no own Message Guard: no CG-GUARD codes (ChatSpace’s refusal is CG-SEND-GUARD), nothing in settings, storage or the draft', () => {
    expect(CG_CODES.filter((code) => code.startsWith('CG-GUARD'))).toEqual([]);
    expect(CG_CODES).toContain('CG-SEND-GUARD');
    expect([...SETTING_PATHS, ...PREFERENCE_KEYS, ...Object.values(STORAGE_KEYS), ...Object.keys(DraftSnapshotSchema.shape)].filter((key) => /guard/i.test(key))).toEqual([]);
    expect(findInClientSources(/\b(?:messageGuard|guardRules?|guardWords?|guardList|bannedWords?|forbiddenWords?)\b/i, REGISTRIES)).toEqual([]);
  });
});

describe('[AI-149] [ER-037] NEG-COMPARE', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-COMPARE')).toEqual(['AI-149', 'ER-037']);
  });

  it('no compare/multi feature, hub feature, action or error code', () => {
    const compare = /compare|multi/i;
    expect([...FEATURE_IDS, ...HUB_AI_FEATURES, ...Object.keys(HUB_FEATURE_MAP), ...UI_ACTION_TYPES, ...CG_CODES].filter((name) => compare.test(name))).toEqual([]);
    expect(findInClientSources(/\b(?:compareModels?|multiModel|multi-model|feature:\s*'compare')\b/i, REGISTRIES)).toEqual([]);
  });
});

describe('[UI-028] [HK-043] [CS-025] NEG-INSERT-ALL', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-INSERT-ALL')).toEqual(['UI-028', 'HK-043', 'CS-025']);
  });

  it('no «insert all» or «send all» action: parts are inserted and sent one at a time', () => {
    expect(UI_ACTION_TYPES.filter((type) => /all/i.test(type) && !/^(?:Set|Reset)/.test(type))).toEqual([]);
    const sendTwo = { type: 'SendPart', operationId: '00000000-0000-4000-8000-000000000001', variant: 0, part: [0, 1] };
    expect(UiActionSchema.safeParse(sendTwo).success).toBe(false);
    expect(UiActionSchema.safeParse({ ...sendTwo, part: 0 }).success).toBe(true);
    expect(UiActionSchema.safeParse({ type: 'InsertPart', operationId: sendTwo.operationId, variant: 0, part: 0, next: true }).success).toBe(false);
  });

  it('⌘0 / Ctrl+0 is not assigned', () => {
    expect(HOTKEYS.filter((hotkey) => /^(?:Digit0|Numpad0)$/.test(hotkey.code))).toEqual([]);
  });

  it('no shipped source chains parts or inserts them all', () => {
    expect(findInClientSources(/\b(?:insertAll|sendAll|InsertAll|SendAll|insert-all|send-all)\b/, REGISTRIES)).toEqual([]);
  });
});

describe('[ST-081] NEG-MANUAL-BINDING', () => {
  it('lists exactly this row', () => {
    expect(rowsOf('NEG-MANUAL-BINDING')).toEqual(['ST-081']);
  });

  it('no binding in settings: the binding is the hub’s, by platform account id, never by name', () => {
    expect([...SETTING_PATHS, ...PREFERENCE_KEYS].filter((key) => /bind|pageId|pageLabel|platformAccount/i.test(key) && !key.startsWith('personas.'))).toEqual([]);
    const keys = Object.keys(HubBindingSchema.shape);
    expect(keys).toContain('platformAccountId');
    expect(keys.filter((key) => /name|title|label/i.test(key) && key !== 'pageLabel')).toEqual([]);
  });
});

describe('[SN-023] [HK-044] [ST-107] [ST-111] [ER-024] [DB-030] [RB-028] [UP-017] [UP-018] [CS-004] [CS-039] NEG-ELECTRON', () => {
  it('lists exactly these rows', () => {
    expect(rowsOf('NEG-ELECTRON')).toEqual(['SN-023', 'HK-044', 'ST-107', 'ST-111', 'ER-024', 'DB-030', 'RB-028', 'UP-017', 'UP-018', 'CS-004', 'CS-039']);
  });

  it('no zoom, update, autostart, tray, badge, menu or window settings', () => {
    expect([...SETTING_PATHS, ...PREFERENCE_KEYS].filter((key) => /zoom|scale|update|autostart|launch|tray|badge|menu|window(?!s)|minimi[sz]e/i.test(key))).toEqual([]);
  });

  it('no shipped source draws a badge, an app menu or a zoom of its own', () => {
    expect(findInClientSources(/\b(?:setBadgeText|setBadgeBackgroundColor|contextMenus|menus\.create|setZoom|getZoom)\b/, REGISTRIES)).toEqual([]);
  });
});
