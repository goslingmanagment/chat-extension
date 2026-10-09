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
  ShowAnalysis: { type: 'ShowAnalysis', view: 'recap', mode: 'expanded' },
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
  // 1.9.0: the palette's preview window is a surface of its own, and «Перезагрузить панель» reaches it.
  fixture(
    'ReloadSurface',
    C.UiActionSchema,
    [
      { type: 'ReloadSurface', surface: 'preview' },
      { type: 'ReloadSurface', surface: 'palette' },
    ],
    [
      { type: 'ReloadSurface', surface: 'online' },
      { type: 'ReloadSurface', surface: 'preview-window' },
      { type: 'ReloadSurface' },
    ],
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
      { type: 'ShowAnalysis', view: 'coach', mode: 'sheet' },
      { type: 'ShowAnalysis', view: 'recap', mode: 'generate' },
      { type: 'ShowAnalysis', view: 'review', mode: 'hidden', operationId: OP },
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
 * Two numbers of §8.7 the statistics may carry (1.2.0): «ждёт ответа;
 * прочтение неизвестно» and the lifetime spend of fans silent for more than
 * 21 days (SP-046). Both optional: a model without them is as before.
 */
const STAMP: C.DataStamp = { asOf: '2026-10-03T06:18:00.000Z', coverage: 'complete' };
const ATTENTION_BASE: C.SpendersStatsVM['attention'] = {
  awaiting: { count: 12, stamp: STAMP },
  newPayers: { count: 3, stamp: STAMP, firstObserved: false },
  silent8to21: { count: 10, stamp: STAMP },
  silentOver21: { count: 6, stamp: STAMP },
  noData: { count: 4, stamp: STAMP },
};
export const STATS_ATTENTION_SAMPLES: { readonly valid: readonly C.SpendersStatsVM['attention'][]; readonly invalid: readonly unknown[] } = {
  valid: [
    ATTENTION_BASE,
    { ...ATTENTION_BASE, awaitingUnknown: { count: 2, stamp: STAMP }, silentOver21: { count: 6, stamp: STAMP, lifetime: 1_840_000 } },
    { ...ATTENTION_BASE, awaitingUnknown: { count: null, stamp: STAMP }, silentOver21: { count: null, stamp: STAMP, lifetime: null } },
  ],
  invalid: [
    // @ts-expect-error the unknown-read category is a count with its stamp, not a bare number
    { ...ATTENTION_BASE, awaitingUnknown: 2 } satisfies C.SpendersStatsVM['attention'],
    // @ts-expect-error the sum is integer mills, never a formatted amount
    { ...ATTENTION_BASE, silentOver21: { count: 6, stamp: STAMP, lifetime: '$1,840' } } satisfies C.SpendersStatsVM['attention'],
  ],
};

/**
 * The remainder rows of the statistics' tier table (1.4.0): the hub sends two
 * tiers without bounds — `untiered` and `unattributed` — and they are told
 * apart by `remainder`, never by the missing bounds. Optional: a row without
 * it is a tier with its bounds, as before.
 */
type StatsShelf = C.SpendersStatsVM['shelves'][number];
const SHELF_BASE: StatsShelf = { id: 'shelf-600-plus', range: { fromMills: 600_000, toMills: null }, fans: 31, lifetime: 52_000_000, period: 40_000_000, share: 0.42 };
const NO_BOUNDS = { fromMills: null, toMills: null } as const;
export const STATS_REMAINDER_SAMPLES: { readonly valid: readonly StatsShelf[]; readonly invalid: readonly unknown[] } = {
  valid: [
    SHELF_BASE,
    { ...SHELF_BASE, id: 'shelf-outside', range: NO_BOUNDS, remainder: 'untiered', fans: 109, lifetime: null, period: 0, share: 0 },
    { ...SHELF_BASE, id: 'shelf-unattributed', range: NO_BOUNDS, remainder: 'unattributed', fans: 0, lifetime: null, period: 1_250_000, share: 0.04 },
  ],
  invalid: [
    // @ts-expect-error a remainder is one of the hub's two keys, not any tier key
    { ...SHELF_BASE, remainder: '600-plus' } satisfies StatsShelf,
    // @ts-expect-error nor a flag
    { ...SHELF_BASE, range: NO_BOUNDS, remainder: true } satisfies StatsShelf,
  ],
};

/**
 * «Ждут ответа» whose hub queue could not be read (1.5.0): the board shows
 * its own filter over the loaded rows and says so — the read's error with
 * its code and «Повторить». Optional: a board without the field (or with
 * null) shows what its filter says.
 */
type WaitingFallback = NonNullable<C.SpendersBoardVM['waitingFallback']>;
const QUEUE_ERROR: C.CgErrorView = { code: 'CG-HUB-TIMEOUT', title: 'Хаб не ответил вовремя', body: 'Попробуйте ещё раз.' };
export const WAITING_FALLBACK_SAMPLES: { readonly valid: readonly (WaitingFallback | null | undefined)[]; readonly invalid: readonly unknown[] } = {
  valid: [undefined, null, { error: QUEUE_ERROR, retry: { type: 'ReloadView', selector: { of: 'spenders.board' } } }],
  invalid: [
    // @ts-expect-error the failure is a rendered error with its code, never a bare code
    { error: 'CG-HUB-TIMEOUT', retry: { type: 'ReloadView', selector: { of: 'spenders.board' } } } satisfies WaitingFallback,
    // @ts-expect-error «Повторить» is an action of the board, not a flag
    { error: QUEUE_ERROR, retry: true } satisfies WaitingFallback,
  ],
};

/**
 * The footer of the options page (1.2.0, ST-005): optional, so a view without
 * it still is an OptionsVM; a link the build does not know is null, not a
 * made-up address.
 */
type OptionsFooter = NonNullable<C.OptionsVM['footer']>;
export const OPTIONS_FOOTER_SAMPLES: { readonly valid: readonly OptionsFooter[]; readonly invalid: readonly unknown[] } = {
  valid: [
    { whatsNew: { type: 'Navigate', to: { kind: 'page', page: 'whats-new' } }, changelog: { type: 'Navigate', to: { kind: 'page', page: 'changelog' } }, unseenNotes: true },
    { whatsNew: null, changelog: null, unseenNotes: false },
  ],
  invalid: [
    // @ts-expect-error a link is an action of the page, never a bare address
    { whatsNew: 'https://example.test/whats-new', changelog: null, unseenNotes: false } satisfies OptionsFooter,
    // @ts-expect-error whether the notes were opened is a flag, not the version
    { whatsNew: null, changelog: null, unseenNotes: '0.4.3' } satisfies OptionsFooter,
  ],
};

/**
 * A lease of ours whose last renewal failed (1.2.0, NF-021): the card may
 * say so while the lease still runs. Optional: without it the card is as before.
 */
const CLAIM_MINE: Extract<C.ClaimVM, { s: 'mine' }> = {
  s: 'mine',
  until: 1_790_000_119_000,
  renew: { label: { key: 'newcomers.claim.renew' }, action: { type: 'RenewClaim', targetHandle: 'newcomers:11:2010' }, enabled: true, reason: null, hotkey: null },
  release: { label: { key: 'newcomers.claim.release' }, action: { type: 'ReleaseClaim', targetHandle: 'newcomers:11:2010' }, enabled: true, reason: null, hotkey: null },
};
const RENEW_ERROR: C.CgErrorView = { code: 'CG-HUB-TIMEOUT', title: 'Хаб не ответил', body: 'Повторите позже.' };
export const CLAIM_RENEW_SAMPLES: { readonly valid: readonly C.ClaimVM[]; readonly invalid: readonly unknown[] } = {
  valid: [CLAIM_MINE, { ...CLAIM_MINE, renewError: RENEW_ERROR }],
  invalid: [
    // @ts-expect-error the failed renewal is an error view with its code, not a flag
    { ...CLAIM_MINE, renewError: true } satisfies C.ClaimVM,
  ],
};

/**
 * The fan panel's bio with its source (1.2.0, CS-035): the hub's profile of
 * the fan, or ChatSpace's own «О себе» while the hub has none. Optional: a
 * panel without `bioSource` draws as before.
 */
const FAN_PANEL_BASE: C.FanPanelVM = {
  view: { s: 'ready' },
  tab: 'fan',
  personaLabel: 'Лора · VIP',
  fan: { name: 'Hubert', username: 'hubert_pl', initials: 'H', lastSeenAt: null, online: null },
  spent: null,
  subscription: null,
  host: null,
  bio: null,
  lists: [],
  footer: { stamp: STAMP, archiveMessages: null },
  close: { type: 'Navigate', to: { kind: 'surface', surface: 'fan-panel', open: false } },
};
export const FAN_PANEL_BIO_SAMPLES: { readonly valid: readonly C.FanPanelVM[]; readonly invalid: readonly unknown[] } = {
  valid: [
    FAN_PANEL_BASE,
    { ...FAN_PANEL_BASE, bio: '## Fan\nLikes short replies.', bioSource: 'hub' },
    { ...FAN_PANEL_BASE, bio: 'Works shifts, writes in the evening.', bioSource: 'host' },
  ],
  invalid: [
    // @ts-expect-error the source is one of the two, not a free word
    { ...FAN_PANEL_BASE, bio: 'x', bioSource: 'fansMap' } satisfies C.FanPanelVM,
  ],
};

/**
 * Host access to the hub address in «Аккаунт» (1.2.0, ST-043): three words —
 * the browser's yes, its no, and «unknown» while it has not answered for the
 * address on screen. A missing answer is never a yes.
 */
type AccountHub = C.AccountBodyVM['hub'];
export const ACCOUNT_HUB_SAMPLES: { readonly valid: readonly AccountHub[]; readonly invalid: readonly unknown[] } = {
  valid: [
    { origin: 'https://hub.example.test', hostPermission: 'granted', requestPermission: null },
    { origin: 'https://hub.example.test', hostPermission: 'unknown', requestPermission: null },
    {
      origin: 'https://hub.example.test',
      hostPermission: 'missing',
      requestPermission: { label: { key: 'settings.account.grantAccess' }, action: { type: 'RequestPermission', kind: 'hub-host' }, enabled: true, reason: null, hotkey: null },
    },
  ],
  invalid: [
    // @ts-expect-error an unanswered check is 'unknown', not null
    { origin: 'https://hub.example.test', hostPermission: null, requestPermission: null } satisfies AccountHub,
    // @ts-expect-error the access is one of three words, not a flag
    { origin: 'https://hub.example.test', hostPermission: true, requestPermission: null } satisfies AccountHub,
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

/**
 * The I18n port's time in a named zone (1.2.0, ui-design §4.1): optional, so
 * a port without it still is an I18n; when present it takes the zone by its
 * IANA name and returns the printed time.
 */
type ZonedTime = NonNullable<C.I18n['formatTimeIn']>;
export const ZONED_TIME_SAMPLES: { readonly valid: readonly ZonedTime[]; readonly invalid: readonly unknown[] } = {
  valid: [(at, timeZone) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone })],
  invalid: [
    // @ts-expect-error the zone is an IANA name, not an offset in minutes
    ((at: number | string, offsetMinutes: number) => `${at}+${offsetMinutes}`) satisfies ZonedTime,
  ],
};

/**
 * RefusalVM (a type, no schema), 1.2.0: `at` tells one refused start from the
 * next, so a refusal hidden with «Скрыть» shows again when a start is refused
 * anew — by a key as well as by a click.
 */
const REFUSAL_BASE: C.RefusalVM = {
  feature: 'reply',
  error: { code: 'CG-OP-TAB-LIMIT', title: 'Уже идут три генерации', body: 'Очереди нет.', tone: 'state' },
  running: [],
};

export const REFUSAL_VM_SAMPLES: { readonly valid: readonly C.RefusalVM[]; readonly invalid: readonly unknown[] } = {
  valid: [REFUSAL_BASE, { ...REFUSAL_BASE, at: 1_790_000_000_000 }],
  invalid: [
    // @ts-expect-error the moment of the refused start is epoch ms, not an ISO string
    { ...REFUSAL_BASE, at: '2026-10-04T00:00:00.000Z' } satisfies C.RefusalVM,
  ],
};

/**
 * CoachTurnVM (a type, no schema), 1.2.0: a turn may carry the Б2 question of
 * one of its draft parts (AI-086) and its debug footer (DB-019).
 */
const COACH_TURN_BASE: C.CoachTurnVM = {
  id: 'turn-1',
  opId: OP,
  question: 'how do I bring him back?',
  askedAt: 1_790_000_000_000,
  state: 'done',
  phase: null,
  sentToCoach: false,
  streamText: null,
  attachedDraft: false,
  outsideMemory: false,
  answer: { prose: 'Warm up first.', blocks: null, drafts: [] },
  error: null,
  errorActions: [],
};

const COACH_TURN_DEBUG: C.ResultDebugVM = {
  costLine: 'in 3 412 tok • out 286 tok',
  stages: [{ name: 'request', ms: 38 }],
  totalMs: 38,
  hubStages: [],
  prompt: null,
  reasoning: null,
  context: null,
  liveTimer: false,
};

export const COACH_TURN_VM_SAMPLES: { readonly valid: readonly C.CoachTurnVM[]; readonly invalid: readonly unknown[] } = {
  valid: [
    COACH_TURN_BASE,
    { ...COACH_TURN_BASE, confirm: null, debug: null },
    { ...COACH_TURN_BASE, confirm: { confirmationId: CONFIRMATION, kind: 'human-draft', part: { index: 0 }, formatLoss: false }, debug: COACH_TURN_DEBUG },
  ],
  invalid: [
    // @ts-expect-error a confirmation is the whole ConfirmVM, not its id
    { ...COACH_TURN_BASE, confirm: CONFIRMATION } satisfies C.CoachTurnVM,
    // @ts-expect-error the debug footer is a ResultDebugVM, not a cost line
    { ...COACH_TURN_BASE, debug: '$0.0143' } satisfies C.CoachTurnVM,
  ],
};

/**
 * The i18n keys of 1.2.0 (R15: Spenders, the preview, «Новые», the fan panel,
 * the palette): texts ui-design.md draws or §10 asks for that 1.1.0 had no
 * key for. Keys are the contract; the texts live in core/domain/i18n.
 */
export const BOARDS_I18N_KEYS: { readonly text: readonly C.UiTextKey[]; readonly plural: readonly C.UiPluralKey[]; readonly invalid: readonly unknown[] } = {
  text: [
    'spenders.col.lifetimeShort',
    'spenders.shelf.from',
    'spenders.shelf.range',
    'spenders.shelf.none',
    'spenders.truncated',
    'spenders.truncatedNoTotal',
    'stats.newPayersObserved',
    'stats.regionLabel',
    'preview.metaOurUnknown',
    'preview.notOpenedAfterSendTooltip',
    'preview.feed.label',
    'preview.feed.fanPrefix',
    'preview.feed.deleted',
    'preview.feed.automatic',
    'preview.feed.priced',
    'preview.feed.notBought',
    'preview.feed.older',
    'preview.ping.segment',
    'preview.ping.segmentNoDays',
    'preview.ping.active',
    'preview.ping.unknown',
    'send.unavailableReason',
    'newcomers.claim.mine',
    'newcomers.incomplete',
    'newcomers.draft',
    'newcomers.draftStale',
    'newcomers.scanProgress',
    'newcomers.window.label',
    'newcomers.greetingDraft.placeholder',
    'newcomers.greetingDraft.aria',
    'fanPanel.subscribedLabel',
    'fanPanel.subscribedValue',
    'fanPanel.subscribedMonths',
    'fanPanel.subscribedSince',
    'fanPanel.churn.low',
    'fanPanel.churn.medium',
    'fanPanel.churn.high',
    'fanPanel.churn.unknown',
    'fanPanel.byKind.posts',
    'fanPanel.byKind.other',
    'fanPanel.subOnline',
    'fanPanel.lastSeen',
    'fanPanel.online',
    'fanPanel.buyingPower',
    'fanPanel.recap.archivePartial',
    'palette.partial',
  ],
  plural: ['spenders.footerNoTotal', 'fanPanel.footerCoverage', 'quickJump.unread'],
  invalid: [
    // @ts-expect-error the shelf label is built from its bounds: there is no one-piece key
    'spenders.shelf' satisfies C.I18nKey,
    // @ts-expect-error a colleague's lease has no countdown and no name (ui-design §12 п. 5)
    'newcomers.claim.other' satisfies C.I18nKey,
    // @ts-expect-error «Отправить» has no «send all» text
    'send.all' satisfies C.I18nKey,
    // @ts-expect-error the greeting draft field has a placeholder and a label, each under its own key
    'newcomers.greetingDraft' satisfies C.I18nKey,
  ],
};

/**
 * «Результат неполный» in «Новые» (1.2.0, NF-025; the wave-2 merge): the
 * window prints the title itself (`newcomers.incomplete`), the view model
 * carries why. The reason has a key of its own, so the title is not said twice.
 */
type NewcomersIncomplete = NonNullable<C.NewcomersVM['incomplete']>;
export const NEWCOMERS_INCOMPLETE_SAMPLES: { readonly valid: readonly NewcomersIncomplete[]; readonly invalid: readonly unknown[] } = {
  valid: [{ key: 'newcomers.incomplete.body' }, { key: 'common.coverage.partial' }],
  invalid: [
    // @ts-expect-error the reason is a catalog message, not a ready text
    'Показана часть списка' satisfies NewcomersIncomplete,
    // @ts-expect-error there is no key of this name: the reason is `newcomers.incomplete.body`
    { key: 'newcomers.incomplete.reason' } satisfies NewcomersIncomplete,
  ],
};

/**
 * The dock's status line (1.3.0): optional, so a dock without it still is a
 * DockVM; when present it is an error view with its code — the owner switched
 * ChatGoose off for the page — or null.
 */
type DockNotice = C.DockVM['notice'];
export const DOCK_NOTICE_SAMPLES: { readonly valid: readonly DockNotice[]; readonly invalid: readonly unknown[] } = {
  valid: [undefined, null, { code: 'CG-FEATURE-DISABLED', title: 'ChatGoose выключен владельцем', body: '', detail: 'disabled', tone: 'state' }],
  invalid: [
    // @ts-expect-error the line is an error view with its code, not a bare text
    'ChatGoose выключен владельцем' satisfies DockNotice,
    // @ts-expect-error nor a flag
    true satisfies DockNotice,
  ],
};

/**
 * What tells two pages of one title apart (1.3.0): the platform and the hub's
 * page label, next to the title wherever pages are listed or chosen. Optional
 * everywhere: a list without it prints titles as before.
 */
type PersonaPageRow = C.PersonasBodyVM['pages'][number];
const PERSONA_PAGE_BASE: PersonaPageRow = { pageHandle: 'page-11', pageName: 'Lora Vie', persona: null, replacementNeeded: false, choices: [] };
export const PAGE_TAG_SAMPLES: {
  readonly valid: readonly C.PageTagVM[];
  readonly rows: readonly PersonaPageRow[];
  readonly popup: readonly C.PopupVM['persona'][];
  readonly accountPages: readonly C.AccountBodyVM['pages'][number][];
  readonly invalid: readonly unknown[];
} = {
  valid: [
    { platform: 'onlyfans', pageLabel: 'lora-vip' },
    { platform: 'fansly', pageLabel: 'lora-fansly' },
    // An open token: a platform this build does not know is printed as it is.
    { platform: 'somewhere-new', pageLabel: 'lora-new' },
  ],
  rows: [PERSONA_PAGE_BASE, { ...PERSONA_PAGE_BASE, page: { platform: 'onlyfans', pageLabel: 'lora-vip' } }],
  popup: [
    { s: 'set', label: 'Лора · VIP', pageName: 'Lora Vie' },
    { s: 'set', label: 'Лора · VIP', pageName: 'Lora Vie', page: { platform: 'onlyfans', pageLabel: 'lora-vip' } },
    { s: 'no-persona', pageName: 'Lora Vie', page: { platform: 'fansly', pageLabel: 'lora-fansly' } },
    { s: 'not-connected' },
  ],
  accountPages: [
    { pageName: 'Lora Vie', platform: 'onlyfans', persona: null },
    { pageName: 'Lora Vie', platform: 'onlyfans', persona: 'Лора · VIP', pageLabel: 'lora-vip' },
  ],
  invalid: [
    // @ts-expect-error the tag names both: a platform alone does not tell «Lora Vie» VIP from «Lora Vie» free
    { platform: 'onlyfans' } satisfies C.PageTagVM,
    // @ts-expect-error the label is the hub's key of the page, a string — not the page id
    { platform: 'onlyfans', pageLabel: 11 } satisfies C.PageTagVM,
    // @ts-expect-error a row's tag is the pair, not a ready-made text
    { ...PERSONA_PAGE_BASE, page: 'OnlyFans · lora-vip' } satisfies PersonaPageRow,
  ],
};
