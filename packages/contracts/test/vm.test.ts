// The UI contract (src/vm): action vocabulary, preferences against the
// settings schema, theme token names, reasons, view states and selectors.

import { describe, expect, expectTypeOf, it } from 'vitest';
import type * as z from 'zod/mini';

import * as C from '../src/index';
import {
  BOARDS_I18N_KEYS,
  CLAIM_RENEW_SAMPLES,
  COACH_TURN_VM_SAMPLES,
  FAN_PANEL_BIO_SAMPLES,
  MONEY_CENTS_SAMPLES,
  REFUSAL_VM_SAMPLES,
  SPOKEN_MONEY_SAMPLES,
  STATS_ATTENTION_SAMPLES,
  TOAST_VM_SAMPLES,
  UI_ACTION_SAMPLES,
  ZONED_TIME_SAMPLES,
} from './fixtures/vm';

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

describe('«Отправить» row (previewSendStateOf)', () => {
  const ok: C.PreviewSendPreflight = { ok: true };
  const attempt = (state: C.SendAttemptState, code?: C.CgCode): C.SendAttemptView => ({ attemptId: '00000000-0000-4000-8000-000000000005', state, ...(code ? { code } : {}) });

  it('every §6.7.4 condition but the stale hold has a reason text', () => {
    for (const code of C.PREVIEW_SEND_CONDITION_CODES) {
      if (code === 'CG-SEND-STALE') continue;
      expect(C.isSendReasonCode(code), code).toBe(true);
    }
    for (const code of C.SEND_HOLD_CODES_WITHOUT_RETRY) if (code !== 'CG-SEND-STALE') expect(C.isSendReasonCode(code), code).toBe(true);
  });

  it('is total over the attempt states', () => {
    for (const state of C.SEND_ATTEMPT_STATES) {
      const view = C.previewSendStateOf(attempt(state), ok);
      expect((C.PREVIEW_SEND_STATES as readonly string[]).includes(view.s), state).toBe(true);
    }
  });

  it('maps the attempt machine onto the row (ui-design §4.13)', () => {
    expect(C.previewSendStateOf(null, ok)).toEqual({ s: 'available' });
    expect(C.previewSendStateOf(null, { ok: false, code: 'CG-SEND-HISTORY' })).toEqual({ s: 'unavailable', code: 'CG-SEND-HISTORY' });
    expect(C.previewSendStateOf(null, { ok: false, code: 'CG-SEND-STALE' })).toEqual({ s: 'held-stale' });
    expect(C.previewSendStateOf(attempt('preparing'), ok).s).toBe('queued');
    expect(C.previewSendStateOf(attempt('nativeEnqueued'), ok).s).toBe('sending');
    expect(C.previewSendStateOf(attempt('nativeAccepted'), ok).s).toBe('accepted');
    expect(C.previewSendStateOf(attempt('sentObserved'), ok).s).toBe('sent');
    expect(C.previewSendStateOf(attempt('uncertain', 'CG-SEND-UNCERTAIN'), ok).s).toBe('uncertain');
    expect(C.previewSendStateOf(attempt('rejected', 'CG-SEND-GUARD'), ok)).toEqual({ s: 'rejected', code: 'CG-SEND-GUARD', canRetry: false });
    expect(C.previewSendStateOf(attempt('notEnqueued', 'CG-SEND-QUEUE'), ok)).toEqual({ s: 'rejected', code: 'CG-SEND-QUEUE', canRetry: true });
  });

  it('a hold: stale stays held, a final code stays off, a cleared condition frees the button, a failed dispatch may be clicked again', () => {
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-STALE'), ok)).toEqual({ s: 'held-stale' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-PART'), ok)).toEqual({ s: 'unavailable', code: 'CG-SEND-PART' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-UNCERTAIN'), ok)).toEqual({ s: 'unavailable', code: 'CG-SEND-UNCERTAIN' });
    expect(C.previewSendStateOf(attempt('held', 'CG-CLAIM-BUSY'), ok)).toEqual({ s: 'unavailable', code: 'CG-CLAIM-BUSY' });
    expect(C.previewSendStateOf(attempt('held', 'CG-HUB-RATE-LIMIT'), ok)).toEqual({ s: 'unavailable', code: 'CG-HUB-RATE-LIMIT' });
    expect(C.previewSendStateOf(attempt('held', 'CG-CLAIM-EXPIRED'), ok)).toEqual({ s: 'unavailable', code: 'CG-CLAIM-EXPIRED' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-BUSY'), ok)).toEqual({ s: 'available' });
    expect(C.previewSendStateOf(attempt('held', 'CG-SEND-BUSY'), { ok: false, code: 'CG-SEND-MIMIC' })).toEqual({ s: 'unavailable', code: 'CG-SEND-MIMIC' });
    expect(C.previewSendStateOf(attempt('held', 'CG-NETWORK'), ok)).toEqual({ s: 'rejected', code: 'CG-NETWORK', canRetry: true });
    expect(C.previewSendStateOf(attempt('held', 'CG-TIMEOUT'), ok)).toEqual({ s: 'rejected', code: 'CG-TIMEOUT', canRetry: true });
  });
});

describe('lease holders and the fan panel', () => {
  it('every hub lease holder has its own greeting and claim state', () => {
    for (const holder of C.LEASE_HOLDERS) {
      const states = C.LEASE_HOLDER_STATES[holder];
      expect(C.GREETING_STATUSES as readonly string[]).toContain(states.greeting);
      expect(C.CLAIM_STATES as readonly string[]).toContain(states.claim);
    }
  });

  it('every retention status reads as a churn risk', () => {
    expect(Object.keys(C.CHURN_RISK_BY_RETENTION).sort()).toEqual([...C.SPENDER_RETENTION_STATUSES].sort());
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

describe('toasts (1.1.0)', () => {
  it('[ER-010] an error toast may carry the technical line and the fixed retry deadline', () => {
    expectTypeOf<C.ToastVM['detail']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<C.ToastVM['retryAt']>().toEqualTypeOf<number | undefined>();
    const [plain, detailed] = TOAST_VM_SAMPLES.valid;
    expect(plain?.detail).toBeUndefined();
    expect(detailed?.detail).toMatch(/^HTTP 429/);
    expect(detailed?.detail?.length ?? 0).toBeLessThanOrEqual(C.CG_DETAIL_MAX_CHARS);
    expect(TOAST_VM_SAMPLES.invalid).toHaveLength(2);
  });
});

describe('spoken money (1.1.0)', () => {
  it('the I18n port may say an amount in words; the catalog has the words', () => {
    expectTypeOf<C.I18n['formatMoneySpoken']>().toEqualTypeOf<((mills: C.MoneyMills | null, format?: C.MoneyFormat) => string) | undefined>();
    expect(C.UI_TEXT_KEYS).toContain('common.money.plus');
    expect(C.UI_TEXT_KEYS).toContain('common.money.minus');
    expect(C.isPluralKey('common.money.dollars')).toBe(true);
    expect(SPOKEN_MONEY_SAMPLES.valid[0]?.(320_000, { sign: 'plus' })).toBe('плюс 320 долларов');
    expect(SPOKEN_MONEY_SAMPLES.invalid).toHaveLength(1);
  });
});

describe('cents on a shelf bound (1.2.0)', () => {
  it('[SP-013] a board row may ask for cents and the money format may print them; both are optional', () => {
    expectTypeOf<C.SpenderRowVM['lifetimeCents']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<C.MoneyFormat['cents']>().toEqualTypeOf<boolean | undefined>();
    const [plain, exact] = MONEY_CENTS_SAMPLES.rows;
    expect(plain?.lifetimeCents).toBeUndefined();
    expect(exact?.lifetimeCents).toBe(true);
    expect(MONEY_CENTS_SAMPLES.formats.filter((format) => format.cents === true)).toHaveLength(2);
    expect(MONEY_CENTS_SAMPLES.invalid).toHaveLength(2);
  });

  it('the catalog has the keys footer label of the board, its «Сбросить фильтры» and the «Результат неполный» text', () => {
    expect(C.UI_TEXT_KEYS).toContain('spenders.keys.row');
    expect(C.UI_TEXT_KEYS).toContain('spenders.resetFilters');
    expect(C.UI_TEXT_KEYS).toContain('newcomers.incomplete');
  });
});

describe('the statistics\' attention block (1.2.0)', () => {
  it('[SP-046] may carry «ждёт ответа; прочтение неизвестно» and the lifetime spend of fans silent for more than 21 days; both are optional', () => {
    type Attention = C.SpendersStatsVM['attention'];
    expectTypeOf<Attention['awaitingUnknown']>().toEqualTypeOf<C.CountStat | undefined>();
    expectTypeOf<Attention['silentOver21']['lifetime']>().toEqualTypeOf<C.MoneyMills | null | undefined>();
    const [plain, full, unknown] = STATS_ATTENTION_SAMPLES.valid;
    expect(plain?.awaitingUnknown).toBeUndefined();
    expect(plain?.silentOver21.lifetime).toBeUndefined();
    expect(full?.awaitingUnknown?.count).toBe(2);
    expect(full?.silentOver21.lifetime).toBe(1_840_000);
    // Unknown stays unknown, never zero.
    expect(unknown?.awaitingUnknown?.count).toBeNull();
    expect(unknown?.silentOver21.lifetime).toBeNull();
    expect(STATS_ATTENTION_SAMPLES.invalid).toHaveLength(2);
  });
});

describe('a lease whose renewal failed (1.2.0)', () => {
  it('[NF-021] the card of a lease of ours may carry the error of its last renewal; the lease itself is unchanged', () => {
    type Mine = Extract<C.ClaimVM, { s: 'mine' }>;
    expectTypeOf<Mine['renewError']>().toEqualTypeOf<C.CgErrorView | undefined>();
    const [plain, failed] = CLAIM_RENEW_SAMPLES.valid;
    expect(plain?.s === 'mine' && plain.renewError).toBeUndefined();
    expect(failed?.s === 'mine' && failed.renewError?.code).toBe('CG-HUB-TIMEOUT');
    expect(failed?.s === 'mine' && C.CgErrorViewSchema.safeParse(failed.renewError).success).toBe(true);
    // The deadline and the buttons are the lease's own, with or without the error.
    expect(failed).toMatchObject({ s: 'mine', until: 1_790_000_119_000, renew: { action: { type: 'RenewClaim' } }, release: { action: { type: 'ReleaseClaim' } } });
    expect(CLAIM_RENEW_SAMPLES.invalid).toHaveLength(1);
  });
});

describe('the fan panel\'s bio names its source (1.2.0)', () => {
  it('[CS-035] the bio is the hub profile or ChatSpace\'s own «О себе», and the panel may say which', () => {
    expectTypeOf<C.FanPanelVM['bioSource']>().toEqualTypeOf<'hub' | 'host' | undefined>();
    const [none, hub, host] = FAN_PANEL_BIO_SAMPLES.valid;
    expect(none).toMatchObject({ bio: null });
    expect(none?.bioSource).toBeUndefined();
    expect(hub).toMatchObject({ bio: '## Fan\nLikes short replies.', bioSource: 'hub' });
    expect(host).toMatchObject({ bioSource: 'host' });
    expect(FAN_PANEL_BIO_SAMPLES.invalid).toHaveLength(1);
  });
});

describe('the dock and Coach (1.2.0)', () => {
  it('[UI-031] the I18n port may print a time in a named zone: the quota resets «в 03:00 по Москве» for every viewer', () => {
    expectTypeOf<C.I18n['formatTimeIn']>().toEqualTypeOf<((at: number | C.IsoTimestamp, timeZone: string, style?: C.TimeStyle) => string) | undefined>();
    expect(C.UI_TEXT_KEYS).toContain('dock.quota.zeroTooltip');
    expect(ZONED_TIME_SAMPLES.valid[0]?.('2026-10-04T00:00:00Z', 'Europe/Moscow')).toBe('03:00');
    expect(ZONED_TIME_SAMPLES.invalid).toHaveLength(1);
  });

  it('[UI-015] a refusal may say when its start was refused, so a second one is told from the first', () => {
    expectTypeOf<C.RefusalVM['at']>().toEqualTypeOf<number | undefined>();
    const [plain, timed] = REFUSAL_VM_SAMPLES.valid;
    expect(plain?.at).toBeUndefined();
    expect(timed?.at).toBeGreaterThan(0);
    expect(REFUSAL_VM_SAMPLES.invalid).toHaveLength(1);
  });

  it('[AI-086] [DB-019] a Coach turn may carry the Б2 question of a draft part and its debug footer', () => {
    expectTypeOf<C.CoachTurnVM['confirm']>().toEqualTypeOf<C.ConfirmVM | null | undefined>();
    expectTypeOf<C.CoachTurnVM['debug']>().toEqualTypeOf<C.ResultDebugVM | null | undefined>();
    const [plain, , asking] = COACH_TURN_VM_SAMPLES.valid;
    expect(plain?.confirm).toBeUndefined();
    expect(asking?.confirm?.kind).toBe('human-draft');
    expect(asking?.debug?.stages).toHaveLength(1);
    expect(COACH_TURN_VM_SAMPLES.invalid).toHaveLength(2);
  });

  it('[ER-005] an error view may carry the dot of its card: a failure or a state', () => {
    expect(C.CG_ERROR_TONES).toEqual(['failure', 'state']);
    expectTypeOf<C.CgErrorView['tone']>().toEqualTypeOf<C.CgErrorTone | undefined>();
    const base = { code: 'CG-QUOTA-DAILY', title: 'Дневная квота AI исчерпана', body: 'Квота обновится в 03:00 по Москве.' };
    expect(C.CgErrorViewSchema.safeParse(base).success).toBe(true);
    expect(C.CgErrorViewSchema.safeParse({ ...base, tone: 'state' }).success).toBe(true);
    expect(C.CgErrorViewSchema.safeParse({ ...base, tone: 'ring' }).success).toBe(false);
  });

  it('the live region and the failed Recap save have their words in the catalog', () => {
    for (const key of ['result.announce.stage', 'result.announce.canRetry', 'cg.recapSave.line', 'cg.recapSave.action', 'cg.recapSave.actionTooltip'] as const) {
      expect(C.UI_TEXT_KEYS).toContain(key);
    }
    expect(C.isPluralKey('result.announce.ready')).toBe(true);
    expect(C.isPluralKey('result.announce.retryIn')).toBe(true);
  });
});

describe('boards, preview, «Новые», fan panel and palette texts (1.2.0)', () => {
  it('[SP-012] [NF-025] [CS-032] the catalog names every text those surfaces draw', () => {
    expect(new Set(BOARDS_I18N_KEYS.text).size).toBe(BOARDS_I18N_KEYS.text.length);
    for (const key of BOARDS_I18N_KEYS.text) {
      expect(C.UI_TEXT_KEYS, key).toContain(key);
      expect(C.isPluralKey(key), key).toBe(false);
    }
    for (const key of BOARDS_I18N_KEYS.plural) expect(C.isPluralKey(key), key).toBe(true);
    for (const key of BOARDS_I18N_KEYS.invalid) expect(C.I18N_KEYS as readonly unknown[]).not.toContain(key);
    // The narrow list column prints «Всего» for «Всё время» (ui-design §3.5).
    expect(C.UI_TEXT_KEYS).toContain('spenders.col.lifetimeShort');
    // The statistics region is named «Статистика Spenders» (ui-design §6.1); the greeting draft of «Новые»
    // is a field of its own, not the Fix draft (NF-012).
    expect(BOARDS_I18N_KEYS.text).toEqual(expect.arrayContaining(['stats.regionLabel', 'newcomers.greetingDraft.placeholder', 'newcomers.greetingDraft.aria']));
  });
});
