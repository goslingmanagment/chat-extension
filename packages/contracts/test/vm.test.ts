// The UI contract (src/vm): action vocabulary, preferences against the
// settings schema, theme token names, reasons, view states and selectors.

import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod/mini';

import * as C from '../src/index';
import { UI_ACTION_SAMPLES } from './fixtures/vm';

describe('UiAction', () => {
  it('lists every action type once, in the schema order', () => {
    expect(new Set(C.UI_ACTION_TYPES).size).toBe(C.UI_ACTION_TYPES.length);
    expect(Object.keys(UI_ACTION_SAMPLES).sort()).toEqual([...C.UI_ACTION_TYPES].sort());
  });

  it('keeps the §10.2 actions', () => {
    const frozen = [
      'Generate',
      'CancelGeneration',
      'InsertPart',
      'ReplaceMyDraft',
      'RestoreMyDraft',
      'AnswerConfirm',
      'OpenAndInsertPart',
      'SendPart',
      'OpenChatToVerify',
      'Copy',
      'OpenPreview',
      'RefreshArchive',
      'Navigate',
      'OpenSettings',
      'SetPreference',
    ];
    for (const type of frozen) expect(C.UI_ACTION_TYPES).toContain(type);
  });

  it('has no send-all, auto-send or hotkey-send action', () => {
    for (const type of C.UI_ACTION_TYPES) expect(type).not.toMatch(/SendAll|AutoSend|SendNext/);
  });

  it('the hand-typed union fits the schema', () => {
    expectTypeOf<C.UiAction>().toExtend<z.infer<typeof C.UiActionSchema>>();
    expectTypeOf<C.UiActionOf<'SetPreference'>>().toExtend<{ key: 'ui.theme'; value: 'host' | 'system' | 'light' | 'dark' } | { key: C.PreferenceKey }>();
  });
});

describe('preferences', () => {
  const at = (settings: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], settings);

  it('every key is a path of SettingsV1 whose default value passes the key schema', () => {
    for (const key of C.PREFERENCE_KEYS) {
      const value = at(C.DEFAULT_SETTINGS, key);
      expect(value, key).not.toBeUndefined();
      expect(C.PREFERENCE_VALUE_SCHEMAS[key].safeParse(value).success, key).toBe(true);
    }
  });

  it('never exposes sign-in, identity or the persona map', () => {
    for (const key of C.PREFERENCE_KEYS) expect(key).not.toMatch(/^(auth|personas|accounts|schemaVersion)/);
  });

  it('carries «Вид ответа» and the keys footer (ui-design §7, §9.3)', () => {
    expect(C.DEFAULT_SETTINGS.ui.resultStyle).toBe('bare');
    expect(C.DEFAULT_SETTINGS.onboarding.keysFooter).toEqual({ shown: 0, dismissed: false });
    expect(C.PREFERENCE_KEYS).toContain('ui.resultStyle');
    expect(C.PREFERENCE_KEYS).toContain('onboarding.keysFooter.dismissed');
  });
});

describe('theme tokens', () => {
  it('are unique --cg-* names', () => {
    expect(new Set(C.THEME_TOKEN_NAMES).size).toBe(C.THEME_TOKEN_NAMES.length);
    for (const name of C.THEME_TOKEN_NAMES) expect(name).toMatch(C.THEME_TOKEN_PATTERN);
  });

  it('cover the five inks and the meaning colours', () => {
    expect(C.THEME_TOKENS.ink).toHaveLength(5);
    for (const name of ['--cg-send', '--cg-money', '--cg-danger', '--cg-accent', '--cg-focus', '--cg-cap', '--cg-gutter']) {
      expect(C.THEME_TOKEN_NAMES).toContain(name);
    }
  });
});

describe('catalog', () => {
  it('every reason with a code names a registered CG code', () => {
    for (const id of C.UNAVAILABLE_REASON_IDS) {
      const { code } = C.UNAVAILABLE_REASONS[id];
      if (code !== null) expect(C.isCgCode(code), id).toBe(true);
    }
  });

  it('every reason text and every «Отправить» reason is a catalog key; send reasons cover send.reason.* exactly', () => {
    const keys = new Set<string>(C.I18N_KEYS);
    for (const reason of Object.values(C.UNAVAILABLE_REASONS)) expect(keys.has(reason.key), reason.key).toBe(true);
    const sendReasonKeys = C.I18N_KEYS.filter((key) => key.startsWith('send.reason.'));
    expect(Object.values(C.SEND_REASON_KEYS).sort()).toEqual([...sendReasonKeys].sort());
    for (const code of Object.keys(C.SEND_REASON_KEYS)) expect(C.isCgCode(code), code).toBe(true);
  });

  it('names every dock action and «Отправить»', () => {
    for (const id of C.DOCK_ACTION_IDS) expect(C.CATALOG_ACTION_IDS).toContain(id);
    expect(C.CATALOG_ACTION_IDS).toContain('send');
  });
});

describe('views', () => {
  it('declares the produced states of every view', () => {
    expect(Object.keys(C.VM_STATE_SUPPORT).sort()).toEqual([...C.VIEW_NAMES].sort());
    for (const states of Object.values(C.VM_STATE_SUPPORT)) {
      for (const state of states) expect(C.VM_VIEW_STATES).toContain(state);
    }
  });

  it('data views produce all seven states', () => {
    const hostOnly = new Set(['quick-jump', 'cheatsheet', 'toasts']);
    for (const name of C.VIEW_NAMES) {
      if (hostOnly.has(name)) continue;
      expect([...C.VM_STATE_SUPPORT[name]].sort(), name).toEqual([...C.VM_VIEW_STATES].sort());
    }
  });

  it('has a distinct key per selector', () => {
    const selectors: C.ViewSelector[] = [
      ...C.VIEW_NAMES.filter((name) => !['preview', 'options', 'debug-prompt', 'journal'].includes(name)).map((of) => ({ of }) as C.ViewSelector),
      ...C.PREVIEW_SOURCES.map((from) => ({ of: 'preview', from }) as const),
      ...C.SETTINGS_SECTIONS.map((section) => ({ of: 'options', section }) as const),
      ...C.JOURNAL_KINDS.map((journal) => ({ of: 'journal', journal }) as const),
      { of: 'debug-prompt', token: 'a' },
      { of: 'debug-prompt', token: 'b' },
    ];
    for (const selector of selectors) expect(C.ViewSelectorSchema.safeParse(selector).success).toBe(true);
    const keys = selectors.map(C.selectorKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('narrows an options selector to its section', () => {
    expectTypeOf<C.ViewOf<{ of: 'options'; section: 'status' }>['body']>().toEqualTypeOf<C.StatusBodyVM | null>();
    expectTypeOf<C.ViewOf<{ of: 'dock' }>>().toEqualTypeOf<C.DockVM>();
    expectTypeOf<C.ViewOf<{ of: 'preview'; from: 'spenders' }>>().toEqualTypeOf<C.PreviewVM>();
  });

  it('has the nine «Отправить» states of ui-design §4.13', () => {
    expect(C.PREVIEW_SEND_STATES).toHaveLength(9);
  });
});

describe('result cap (ui-design §3.2)', () => {
  it('matches the measured examples in both result styles', () => {
    expect(C.resultCap({ feedHeight: 574, viewportHeight: 900 }, 'bare')).toBe(360);
    expect(C.resultCap({ feedHeight: 574, viewportHeight: 900 }, 'sheet')).toBe(360);
    expect(C.resultCap({ feedHeight: 474, viewportHeight: 800 }, 'bare')).toBe(314);
    expect(C.resultCap({ feedHeight: 474, viewportHeight: 800 }, 'sheet')).toBe(312);
  });

  it('never goes below 112 px and ignores an unknown feed height', () => {
    expect(C.resultCap({ feedHeight: 200, viewportHeight: 800 }, 'bare')).toBe(112);
    expect(C.resultCap({ feedHeight: null, viewportHeight: 600 }, 'sheet')).toBe(270);
  });
});

describe('lists', () => {
  it('the board periods of SetSpendersPeriod are the spenders.board request periods', () => {
    for (const period of C.SPENDERS_PERIODS) expect(C.UiActionSchema.safeParse({ type: 'SetSpendersPeriod', period }).success).toBe(true);
    expect(C.UiActionSchema.safeParse({ type: 'SetSpendersPeriod', period: '90d' }).success).toBe(false);
  });
});
