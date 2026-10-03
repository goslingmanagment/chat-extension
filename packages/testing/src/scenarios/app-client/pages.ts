// Extension pages for the scenarios: the popup, the options page by section,
// the prompt echo and the journals.

import {
  SETTINGS_SECTIONS,
  SOUND_TONE_IDS,
  type DebugPromptVM,
  type I18nKey,
  type JournalKind,
  type JournalVM,
  type OptionsBodyMap,
  type OptionsVM,
  type PopupVM,
  type SettingsSection,
  type StatusRowVM,
  type VmView,
} from '@cg/contracts';

import { button, cgError, CREATOR_ID, FANS, handles, HOST_ACCOUNT_ID, hotkey, iso, MIN, msg, PERSONA, uuid, type ScenarioCtx } from './base';
import { running } from './dock';

// ── popup ──

export function popup(ctx: ScenarioCtx, view: VmView, patch: Partial<PopupVM> = {}): PopupVM {
  const signedIn = view.s !== 'forbidden' && view.s !== 'error';
  return {
    view,
    version: '0.4.3',
    pills: { host: 'connected', hub: view.s === 'offline' ? 'down' : 'ok' },
    problems: view.s === 'offline' ? [cgError(ctx, 'CG-HUB-UNAVAILABLE')] : [],
    persona: signedIn ? { s: 'set', label: PERSONA.label, pageName: PERSONA.pageName } : { s: 'not-connected' },
    account: signedIn ? { login: 'chatter1', signOut: button('popup.signOut', { type: 'SignOut' }) } : null,
    chat:
      signedIn && view.s !== 'empty'
        ? { fanName: FANS.hubert.name, fanUsername: FANS.hubert.username, hostAccountLabel: `OnlyMonster ${HOST_ACCOUNT_ID}`, copyIds: { hostAccountId: HOST_ACCOUNT_ID, creatorId: CREATOR_ID } }
        : null,
    quota: signedIn ? { remaining: view.s === 'offline' ? null : 12, resetsAt: iso(ctx.now + 17 * 60 * MIN), low: true } : null,
    aiTodayLine: ctx.debug ? '$0.42 · только этот браузер' : null,
    newcomersCount: signedIn ? 3 : null,
    buttons: [
      button('popup.btn.spenders', { type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } }, { hotkey: hotkey(ctx, 'spenders') }),
      button('popup.btn.newcomers', { type: 'Navigate', to: { kind: 'surface', surface: 'newcomers', open: true } }),
      button('popup.btn.keys', { type: 'Navigate', to: { kind: 'surface', surface: 'cheatsheet', open: true } }, { hotkey: hotkey(ctx, 'cheatsheet') }),
      button('common.settings', { type: 'OpenSettings', route: { section: 'status' } }),
    ],
    links: { whatsNew: { type: 'Navigate', to: { kind: 'page', page: 'whats-new' } }, changelog: { type: 'Navigate', to: { kind: 'page', page: 'changelog' } } },
    refresh: button('popup.refreshStatus', { type: 'RecheckStatus' }),
    refreshing: view.s === 'loading',
    ...patch,
  };
}

// ── options ──

const STATUS_ROW_KEYS: Record<StatusRowVM['id'], I18nKey> = {
  extension: 'settings.status.row.extension',
  chatspace: 'settings.status.row.chatspace',
  hub: 'settings.status.row.hub',
  account: 'settings.status.row.account',
  binding: 'settings.status.row.binding',
  persona: 'settings.status.row.persona',
  quota: 'settings.status.row.quota',
  running: 'settings.status.row.running',
  'last-error': 'settings.status.row.lastError',
  spenders: 'settings.status.row.spenders',
  sound: 'settings.status.row.sound',
  contract: 'settings.status.row.contract',
  'preview-send': 'settings.status.row.previewSend',
  consent: 'settings.status.row.consent',
  support: 'settings.status.row.support',
};

const row = (id: StatusRowVM['id'], level: StatusRowVM['level'], value: string, note: string | null = null, action: StatusRowVM['action'] = null): StatusRowVM => ({
  id,
  level,
  title: msg(STATUS_ROW_KEYS[id]),
  value,
  note,
  action,
});

export function optionsBody<S extends SettingsSection>(ctx: ScenarioCtx, section: S, variant: 'full' | 'empty' | 'partial' = 'full'): OptionsBodyMap[S] {
  const bodies: OptionsBodyMap = {
    status: {
      section: 'status',
      readiness: variant === 'partial' ? { s: 'unknown' } : { s: 'ready', warnings: [msg('dock.quota.low', { n: 12 })] },
      lastCheckedAt: ctx.now - 2 * MIN,
      recheck: button('settings.status.checkAll', { type: 'RecheckStatus' }),
      copyReport: button('settings.status.copyReport', { type: 'CopyReport', scope: 'status' }),
      rows: [
        row('extension', 'ok', '0.4.3'),
        row('chatspace', variant === 'partial' ? 'unknown' : 'ok', 'index-0000test'),
        row('hub', 'ok', 'hub.example.test', '180 ms'),
        row('binding', 'ok', `OnlyMonster ${HOST_ACCOUNT_ID} → ${PERSONA.pageName}`, null, button('common.go', { type: 'OpenSettings', route: { section: 'accounts' } })),
        row('quota', 'warn', '12'),
        row('preview-send', 'ok', 'off'),
        row('consent', 'warn', 'off', null, button('settings.status.consentAsk', { type: 'RequestPermission', kind: 'data-collection' })),
      ],
      running: [running(ctx, FANS.theodore, 'reply', 14, uuid(901))],
      note: msg('settings.status.reportNote'),
    },
    account: {
      section: 'account',
      hub: { origin: 'https://hub.example.test', hostPermission: 'granted', requestPermission: null },
      connection: { s: 'ok', latencyMs: 180, checkedAt: ctx.now - MIN },
      user: { login: 'chatter1', role: 'chatter', deviceSince: iso(ctx.now - 2 * 24 * 60 * MIN) },
      pages: [{ pageName: PERSONA.pageName, platform: 'onlyfans', persona: PERSONA.label }],
      sdk: { contractHash: 'abc123', compatible: true },
      hubErrorsToday: [{ code: 'CG-PROVIDER-RATE-LIMIT', count: 1 }],
      lastDossierSave: iso(ctx.now - 24 * 60 * MIN),
      signOut: button('common.signOut', { type: 'SignOut' }),
      signInAgain: null,
    },
    personas: {
      section: 'personas',
      catalog: variant === 'empty' ? [] : [{ key: 'lora', label: PERSONA.label, archived: false }, { key: 'lora-old', label: 'Лора · старая', archived: true }],
      pages:
        variant === 'empty'
          ? []
          : [
              {
                pageHandle: 'page-11',
                pageName: PERSONA.pageName,
                persona: PERSONA.label,
                replacementNeeded: false,
                choices: [{ key: 'lora', label: PERSONA.label, choose: { type: 'ChoosePersona', pageHandle: 'page-11', personaKey: 'lora' } }],
              },
            ],
      syncedAt: iso(ctx.now - 5 * MIN),
    },
    accounts: {
      section: 'accounts',
      rows:
        variant === 'empty'
          ? []
          : [
              {
                accountHandle: 'acc-1',
                title: 'LoraVie',
                username: 'loravie_vip',
                localLabel: 'Main',
                status: 'working',
                pageName: PERSONA.pageName,
                persona: PERSONA.label,
                muted: false,
                goTo: button('settings.accounts.toTab', { type: 'Navigate', to: { kind: 'account', accountHandle: 'acc-1' } }),
              },
            ],
    },
    generation: {
      section: 'generation',
      windows: { quick: 100, ping: 100, improve: 25, deep: 3000, deepMax: 3000, savedAs: null },
      split: false,
      coach: { historyLimit: 10, autoRecap: 'off' },
      debug: { enabled: ctx.debug, renderTrace: false },
    },
    hotkeys: {
      section: 'hotkeys',
      platform: ctx.platform,
      rows: [
        { id: 'reply', label: msg('dock.action.reply'), hotkey: hotkey(ctx, 'reply'), outsideScheme: false },
        { id: 'next-unread', label: msg('cheatsheet.row.nextUnread'), hotkey: hotkey(ctx, 'nextUnread'), outsideScheme: true },
        { id: 'send', label: msg('send.button'), hotkey: null, outsideScheme: false },
      ],
    },
    appearance: {
      section: 'appearance',
      theme: 'host',
      systemScheme: 'light',
      locale: 'system',
      hints: true,
      resultStyle: 'bare',
      sound: {
        messages: { on: true, tone: 'chime' },
        subscribers: { on: true, tone: 'double' },
        volume: 50,
        tones: SOUND_TONE_IDS,
        test: { messages: button('settings.appearance.testSound', { type: 'TestSound', which: 'messages' }), subscribers: button('settings.appearance.testSound', { type: 'TestSound', which: 'subscribers' }) },
        status: { listeningTabs: 1, lastIncomingAt: ctx.now - 7 * MIN, outcomes: { played: 4, suppressed: 9 }, error: null },
      },
    },
    diagnostics: {
      section: 'diagnostics',
      cachesKB: 412,
      logsKB: 1_280,
      export: button('settings.diagnostics.export', { type: 'ExportDiagnostics' }),
      clear: button('settings.diagnostics.clear', { type: 'ClearLocalData', confirmed: true }),
      counters: [{ code: 'CG-INSERT-UNCERTAIN', count: 0 }],
      journals: ctx.debug ? [{ journal: 'operations', open: { type: 'Navigate', to: { kind: 'journal', journal: 'operations' } } }] : null,
    },
  };
  return bodies[section];
}

export interface OptionsOptions {
  readonly body?: 'full' | 'empty' | 'partial' | 'none';
  readonly patch?: Partial<OptionsVM>;
}

export function options<S extends SettingsSection>(ctx: ScenarioCtx, section: S, view: VmView, opts: OptionsOptions = {}): OptionsVM<S> {
  const kind = opts.body ?? (view.s === 'loading' || view.s === 'error' || view.s === 'forbidden' ? 'none' : view.s === 'empty' ? 'empty' : view.s === 'partial' ? 'partial' : 'full');
  const vm = {
    view,
    section,
    version: '0.4.3',
    nav: SETTINGS_SECTIONS.map((s) => ({ section: s, label: msg(`settings.section.${s}`), problem: s === 'status' && view.s === 'partial' })),
    highlight: null,
    save: { s: 'idle' },
    readOnly: false,
    signIn: view.s === 'forbidden' ? { hubOrigin: 'https://hub.example.test', login: '', busy: false, error: null } : null,
    checklist: null,
    body: kind === 'none' ? null : optionsBody(ctx, section, kind),
    ...opts.patch,
  };
  return vm as OptionsVM<S>;
}

// ── debug pages ──

export function debugPrompt(ctx: ScenarioCtx, view: VmView): DebugPromptVM {
  const has = view.s === 'ready' || view.s === 'partial';
  return {
    view,
    source: has ? 'echo' : null,
    createdAt: has ? ctx.now - MIN : null,
    expiresAt: has ? ctx.now + 11 * MIN : null,
    blocks: has
      ? [
          { name: 'system', text: 'You are Lora…', truncated: false },
          { name: 'history', text: '[fan] are you there?', truncated: view.s === 'partial' },
        ]
      : [],
    manifest: has ? { text: '{"blocks":2}', truncated: false } : null,
    copyHandle: has ? handles.artifact('prompt', 1) : null,
  };
}

export function journal(ctx: ScenarioCtx, kind: JournalKind, view: VmView): JournalVM {
  const has = view.s === 'ready' || view.s === 'partial' || view.s === 'offline';
  return {
    view,
    journal: kind,
    entries: has
      ? [
          { at: ctx.now - 30_000, level: 'info', scope: 'op.reply', text: 'admitted → done, 3.8 s, 3 parts', code: null },
          { at: ctx.now - 10_000, level: 'warn', scope: 'insert', text: 'rejected: draft changed', code: 'CG-DRAFT-CHANGED' },
        ]
      : [],
    truncated: view.s === 'partial',
    runs: kind === 'newcomers-check' && has ? [{ id: 'run-1', startedAt: ctx.now - 5 * MIN, events: 214 }] : null,
    copyHandle: has ? handles.artifact('journal', 1) : null,
    save: button('common.save', { type: 'SaveJournal', journal: kind }, { enabled: has }),
  };
}
