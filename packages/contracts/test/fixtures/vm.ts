// Fixtures of the UI contract schemas (src/vm): one sample per UiAction type
// and valid/invalid values for every exported vm schema. Synthetic ids only.

import type * as z from 'zod/mini';

import * as C from '../../src/index';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const OP = uuid(21);
const ATTEMPT = uuid(22);
const CONFIRMATION = uuid(23);
const TARGET = 'dock:t1';

/** One valid action per type; the Record makes a new action type without a sample a compile error. */
export const UI_ACTION_SAMPLES: { readonly [T in C.UiActionType]: C.UiActionOf<T> } = {
  Generate: { type: 'Generate', targetHandle: TARGET, feature: 'reply', options: { tone: 'flirty', split: true } },
  Regenerate: { type: 'Regenerate', operationId: OP },
  CancelGeneration: { type: 'CancelGeneration', operationId: OP },
  HideResult: { type: 'HideResult', operationId: OP },
  ExpandResult: { type: 'ExpandResult', operationId: OP, expanded: true },
  SetTone: { type: 'SetTone', targetHandle: TARGET, tone: null },
  InsertPart: { type: 'InsertPart', operationId: OP, part: 0 },
  ReplaceMyDraft: { type: 'ReplaceMyDraft', operationId: OP, part: 0 },
  RestoreMyDraft: { type: 'RestoreMyDraft', operationId: OP },
  AnswerConfirm: { type: 'AnswerConfirm', confirmationId: CONFIRMATION, choice: 'append' },
  OpenAndInsertPart: { type: 'OpenAndInsertPart', operationId: OP, variant: 1, part: 2 },
  SendPart: { type: 'SendPart', operationId: OP, variant: 0, part: 1 },
  OpenChatToVerify: { type: 'OpenChatToVerify', attemptId: ATTEMPT },
  Copy: { type: 'Copy', artifactHandle: 'part:1' },
  OpenPreview: { type: 'OpenPreview', targetHandle: 'spenders:f1' },
  RefreshArchive: { type: 'RefreshArchive', targetHandle: 'spenders:f1' },
  LoadOlder: { type: 'LoadOlder', targetHandle: 'spenders:f1' },
  SetPreviewDraft: { type: 'SetPreviewDraft', targetHandle: 'spenders:f1', text: 'hey, missed you' },
  ShowRecap: { type: 'ShowRecap', length: 'full' },
  RefreshRecap: { type: 'RefreshRecap', length: 'short' },
  NewCoachDialog: { type: 'NewCoachDialog' },
  RetryRecapSave: { type: 'RetryRecapSave', length: 'full' },
  SetSpendersPeriod: { type: 'SetSpendersPeriod', period: '30d' },
  SetSpendersFilter: { type: 'SetSpendersFilter', filter: 'waiting' },
  SetSpendersSort: { type: 'SetSpendersSort', sort: 'fan-age' },
  ResetFilters: { type: 'ResetFilters', list: 'spenders' },
  Search: { type: 'Search', list: 'palette', query: 'hub' },
  RevealShelf: { type: 'RevealShelf', shelfId: 'shelf-600' },
  SetStatsExpanded: { type: 'SetStatsExpanded', expanded: true },
  SetNewcomersTab: { type: 'SetNewcomersTab', tab: 'all' },
  SetNewcomersFilter: { type: 'SetNewcomersFilter', filter: 'stopped' },
  SetNewcomersWindow: { type: 'SetNewcomersWindow', hours: 48 },
  LoadMore: { type: 'LoadMore', list: 'newcomers' },
  RenewClaim: { type: 'RenewClaim', targetHandle: 'newcomers:f2' },
  ReleaseClaim: { type: 'ReleaseClaim', targetHandle: 'newcomers:f2' },
  SetFanPanelTab: { type: 'SetFanPanelTab', tab: 'recap' },
  DismissToast: { type: 'DismissToast', toastId: 'toast-1' },
  HoldToast: { type: 'HoldToast', toastId: 'toast-1', hold: true },
  Navigate: { type: 'Navigate', to: { kind: 'chat', targetHandle: TARGET } },
  OpenSettings: { type: 'OpenSettings', route: { section: 'status', code: 'CG-HUB-UNAVAILABLE' } },
  SetPreference: { type: 'SetPreference', key: 'ui.resultStyle', value: 'sheet' },
  SetAccountLabel: { type: 'SetAccountLabel', accountHandle: 'acc-1', label: 'Main' },
  SetAccountMuted: { type: 'SetAccountMuted', accountHandle: 'acc-1', muted: true },
  ChoosePersona: { type: 'ChoosePersona', pageHandle: 'page-11', personaKey: 'lora' },
  SignIn: { type: 'SignIn', login: 'chatter1', password: 'synthetic-password' },
  SignOut: { type: 'SignOut' },
  RecheckStatus: { type: 'RecheckStatus' },
  ReloadView: { type: 'ReloadView', selector: { of: 'spenders.stats' } },
  ReloadTab: { type: 'ReloadTab' },
  ReloadSurface: { type: 'ReloadSurface', surface: 'spenders' },
  CopyReport: { type: 'CopyReport', scope: 'error', code: 'CG-SEND-UNCERTAIN' },
  ExportDiagnostics: { type: 'ExportDiagnostics' },
  ClearLocalData: { type: 'ClearLocalData', confirmed: true },
  TestSound: { type: 'TestSound', which: 'subscribers' },
  RequestPermission: { type: 'RequestPermission', kind: 'data-collection' },
  RetrySettingsWrite: { type: 'RetrySettingsWrite' },
  SaveJournal: { type: 'SaveJournal', journal: 'newcomers-check' },
};

export interface VmSchemaFixture {
  readonly name: string;
  readonly schema: z.ZodMiniType;
  readonly valid: readonly unknown[];
  readonly invalid: readonly unknown[];
}

const fixture = (name: string, schema: z.ZodMiniType, valid: readonly unknown[], invalid: readonly unknown[]): VmSchemaFixture => ({
  name,
  schema,
  valid,
  invalid,
});

export const VM_SCHEMA_FIXTURES: readonly VmSchemaFixture[] = [
  fixture('Handle', C.HandleSchema, [TARGET, 'part:1', 'spenders:f1.v2'], ['', ' x', 'a b', 'x'.repeat(129), 7]),
  fixture(
    'ViewSelector',
    C.ViewSelectorSchema,
    [
      { of: 'dock' },
      { of: 'preview', from: 'newcomers' },
      { of: 'options', section: 'appearance' },
      { of: 'debug-prompt', token: 'snap-1' },
      { of: 'journal', journal: 'send-attempts' },
    ],
    [{ of: 'preview' }, { of: 'dock', fan: '2002' }, { of: 'billing' }, { of: 'options', section: 'advanced' }, { of: 'debug-prompt', token: '' }],
  ),
  fixture('PreferenceKey', C.PreferenceKeySchema, ['ui.theme', 'onboarding.keysFooter.dismissed', 'sound.volume'], ['ui', 'auth.token', 'personas.byPageId']),
  fixture(
    'UserOptions',
    C.UserOptionsSchema,
    [{}, { tone: 'flirty', split: true }, { tone: null }, { variants: 3 }, { window: 3000 }, { question: 'Что ему предложить?', attachMyDraft: true, preset: 'situation' }],
    [
      { persona: 'lora' },
      { model: 'claude-sonnet' },
      { providerUrl: 'https://x.test' },
      { variants: 2 },
      { window: 0 },
      { window: 4 },
      { question: '' },
      { question: 'q'.repeat(2001) },
      { tone: 'rude' },
    ],
  ),
  fixture(
    'NavigationTarget',
    C.NavigationTargetSchema,
    [
      { kind: 'chat', targetHandle: TARGET },
      { kind: 'chat-step', direction: 'previous' },
      { kind: 'next-unread' },
      { kind: 'chat-slot', slot: 9 },
      { kind: 'account', accountHandle: 'acc-1' },
      { kind: 'surface', surface: 'cheatsheet', open: true },
      { kind: 'page', page: 'changelog' },
      { kind: 'debug-prompt', promptHandle: 'snap-1' },
      { kind: 'journal', journal: 'operations' },
    ],
    [{ kind: 'chat' }, { kind: 'chat-slot', slot: 10 }, { kind: 'url', href: 'https://example.test' }, { kind: 'surface', surface: 'spenders' }],
  ),
  fixture(
    'UiAction',
    C.UiActionSchema,
    Object.values(UI_ACTION_SAMPLES),
    [
      { type: 'Generate', targetHandle: TARGET, feature: 'reply', options: { persona: 'lora' } },
      { type: 'Generate', targetHandle: TARGET, feature: 'hi', options: { tone: 'flirty' } },
      { type: 'Generate', targetHandle: TARGET, feature: 'reply', options: { variants: 3 } },
      { type: 'Generate', targetHandle: TARGET, feature: 'recap', options: { split: true } },
      { type: 'Generate', targetHandle: TARGET, feature: 'fix', options: { question: 'why?' } },
      { type: 'Generate', target: { fanRef: '2002' }, feature: 'reply', options: {} },
      { type: 'SendPart', operationId: OP, part: 10 },
      { type: 'SendPart', operationId: OP, part: 0, auto: true },
      { type: 'InsertPart', operationId: 'op-1', part: 0 },
      { type: 'SetPreference', key: 'ui.theme', value: 'neon' },
      { type: 'SetPreference', key: 'sound.volume', value: 7 },
      { type: 'SetPreference', key: 'auth.token', value: 'x' },
      { type: 'ClearLocalData', confirmed: false },
      { type: 'SendAll', operationId: OP },
      { type: 'Navigate', to: { kind: 'chat-slot', slot: 0 } },
    ],
  ),
];

/**
 * ToastVM (a type, no schema): valid samples and values the type refuses.
 * 1.1.0 — the error toast's technical line and retry deadline (ER-010).
 */
const TOAST_BASE: C.ToastVM = {
  id: 'toast-1',
  kind: 'error',
  code: 'CG-PROVIDER-RATE-LIMIT',
  title: 'AI перегружен',
  body: 'Повторите вручную.',
  actions: [],
  copyCode: true,
  expiresAt: 6_500,
};

export const TOAST_VM_SAMPLES: { readonly valid: readonly C.ToastVM[]; readonly invalid: readonly unknown[] } = {
  valid: [TOAST_BASE, { ...TOAST_BASE, detail: 'HTTP 429 • retry-after 24', retryAt: 30_000 }, { ...TOAST_BASE, kind: 'info', code: null, copyCode: false }],
  invalid: [
    // @ts-expect-error the technical line is text, not a status number
    { ...TOAST_BASE, detail: 429 } satisfies C.ToastVM,
    // @ts-expect-error the retry deadline is epoch ms, not an ISO string
    { ...TOAST_BASE, retryAt: '2026-10-03T06:21:00.000Z' } satisfies C.ToastVM,
  ],
};

/**
 * Cents of an amount on its shelf's bound (1.2.0, SP-013): the row says so,
 * the port's format prints it. Both are optional: without them whole dollars.
 */
const ROW_BASE: C.SpenderRowVM = {
  handle: 'spenders:11:5001',
  name: 'Fan 1',
  username: 'fan_1',
  lifetime: 599_600,
  period: 25_000,
  isNew: false,
  deleted: false,
  weWroteAt: null,
  fanWroteAt: null,
  waiting: false,
  lastMessage: null,
  selected: false,
};
export const MONEY_CENTS_SAMPLES: {
  readonly rows: readonly C.SpenderRowVM[];
  readonly formats: readonly C.MoneyFormat[];
  readonly invalid: readonly unknown[];
} = {
  rows: [ROW_BASE, { ...ROW_BASE, lifetimeCents: true }],
  formats: [{}, { cents: true }, { cents: true, sign: 'plus' }],
  invalid: [
    // @ts-expect-error the mark is a boolean, not the formatted amount
    { ...ROW_BASE, lifetimeCents: '$599.60' } satisfies C.SpenderRowVM,
    // @ts-expect-error cents is a switch, not a number of digits
    { cents: 2 } satisfies C.MoneyFormat,
  ],
};

/**
 * The I18n port's spoken money (1.1.0, ui-design §6.2): optional, so a port
 * without it still is an I18n; when present it returns words, not a number.
 */
type SpokenMoney = NonNullable<C.I18n['formatMoneySpoken']>;
export const SPOKEN_MONEY_SAMPLES: { readonly valid: readonly SpokenMoney[]; readonly invalid: readonly unknown[] } = {
  valid: [(mills, format) => (mills === null ? 'неизвестно' : `${format?.sign === 'plus' ? 'плюс ' : ''}${Math.round(mills / 1000)} долларов`)],
  invalid: [
    // @ts-expect-error the spoken form is words for aria-label, not the amount
    ((mills: number | null) => mills ?? 0) satisfies SpokenMoney,
  ],
};
