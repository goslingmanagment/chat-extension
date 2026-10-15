// The AppClient of the extension pages (architecture.md §9.9, §10.2): the
// popup, the options page and the two debug pages read their view models
// here and dispatch their actions here; everything else is the page RPC to
// the background and the browser's own ports. One instance per page.
//
// Rules this controller keeps:
// - «Сохранено ✓» only with the background's revision (ST-013…ST-015);
// - the hub address changes only while it is known that nobody is signed in
//   (ST-042): it goes as its own request, checked again when it is sent, and
//   a refused one is never sent later inside another change;
// - the sign-in goes to the address on screen: one still being saved is
//   waited for, one that was not saved refuses the sign-in (§8.2);
// - a sign-in state that could not be read is «unknown», never «signed out»
//   (PU-002): no sign-in screen, no hub address change;
// - what one sign-in was told is never shown under another: late answers of
//   an earlier sign-in and older answers of the same read are dropped;
// - a prompt and the journals are gone the moment debug is switched off or
//   the person signs out (§9.3);
// - `permissions.request` is called synchronously inside the click that
//   asked for it, before anything is awaited (a custom hub address, the
//   sign-in, the consent — §3, §9.6);
// - no write is repeated by itself: what was not saved goes again only with
//   the person's next change or by «Повторить»;
// - no text of a prompt or a journal is ever logged or reported.

import { type CgCode, type CgErrorWire, type SettingsSection } from '@cg/contracts/errors';
import { type HostKind } from '@cg/contracts/hosts';
import { AI_USAGE_LIMITS } from '@cg/contracts/hub';
import { type Locale } from '@cg/contracts/i18n/keys';
import { type SessionIdentity } from '@cg/contracts/ids';
import { LOG_LIMITS } from '@cg/contracts/limits';
import { HUB_ORIGIN_PATTERN } from '@cg/contracts/primitives';
import { DEFAULT_HUB_ORIGIN, DEFAULT_SETTINGS, HOST_ACCOUNT_KEY_PATTERN, SETTINGS_RANGES, hostAccountKeyOf, type HostAccountKey, type SettingsPatch, type SettingsState, type UiTheme } from '@cg/contracts/settings';
import { type TabRequestPayload, type TabResponsePayload } from '@cg/contracts/tab-messages';
import {
  UiActionSchema,
  selectorKey,
  type ActionReceipt,
  type AppClient,
  type JournalKind,
  type PreferenceKey,
  type UiAction,
  type UiActionOf,
  type ValueSignal,
  type ViewOf,
  type ViewSelector,
} from '@cg/contracts/vm';

import { errorView } from '../../domain/errors';
import { admission, onPage } from '../../domain/features/admission';
import { createI18n, createTranslator, resolveLocale, type LiveI18n, type Translator } from '../../domain/i18n';
import { IDLE, accountKeyOf, aliasesOf, boundPageOf, currentAccountOf, isHostKind, knownAccounts, valueOf, type BindingSlot, type JournalData, type PagesModel, type SeenAccount, type SessionEnd, type Slot } from './model';
import { type OptionsLocation, type PageAnswer, type PageEnv, type PagePorts, type PageRequestType, type SiteAccountsFacts } from './ports';
import { hashOfRoute, routeOfHash } from './route';
import { SettingsWriter, settingsWithPending, type WriteMode, type WriteOutcome } from './settings-writer';
import { debugPromptView, isPromptToken, journalArtifact, journalText, journalView, promptText, PROMPT_ARTIFACT } from './view-debug';
import { optionsView } from './view-options';
import { popupView } from './view-popup';
import { pageIdOfHandle } from './view-sections';
import { errorReport, statusReport } from './view-status';
/** «Проверить всё» not more often than this (ST-033). */
export const RECHECK_MIN_INTERVAL_MS = 10_000;
/** The re-check when the page gets focus again, not more often than this (ST-038). */
export const FOCUS_RECHECK_MIN_INTERVAL_MS = 5_000;
/** How often the sound state is read while its section is on screen (ST-133). */
export const SOUND_STATE_POLL_MS = 10_000;
/** The hub's sign-in answers within 20 s (§8.2); the page waits a little longer for the background's answer. */
export const SIGN_IN_TIMEOUT_MS = 25_000;
/** The popup's count of new subscribers: the default window of «Новые», hours. */
export const POPUP_NEWCOMERS_WINDOW_HOURS = 48;
/** Running operations change in 50 ms batches; the page looks not more often than this. */
const OPS_REFRESH_MIN_INTERVAL_MS = 2_000;
/** Bindings of the seen accounts (up to `seenAccountsMax`) are asked this many at a time. */
export const BINDING_RESOLVE_CONCURRENCY = 8;

/** Runs `task` over `items`, at most `limit` at a time. */
async function pooled<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

class Signal<T> implements ValueSignal<T> {
  private readonly listeners = new Set<(value: T) => void>();
  constructor(
    private current: T,
    private readonly same: (a: T, b: T) => boolean = Object.is,
  ) {}
  get value(): T {
    return this.current;
  }
  set(next: T): void {
    if (this.same(next, this.current)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** `gosling-agency.ru/x`, ` https://Hub.Example:8443/ ` → `https://hub.example:8443`; null — not an address (ST-041). */
export function normalizeHubOrigin(input: string): string | null {
  let text = input.trim();
  if (text === '') return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  const match = /^(https?):\/\/([A-Za-z0-9.-]+)(:\d{1,5})?(?:[/?#].*)?$/i.exec(text);
  if (match === null) return null;
  const origin = `${(match[1] ?? '').toLowerCase()}://${(match[2] ?? '').toLowerCase()}${match[3] ?? ''}`;
  return HUB_ORIGIN_PATTERN.test(origin) && origin.length <= 256 ? origin : null;
}

/** Settings a person types or drags: they wait 300 ms after the last change; every other one is a switch. */
const DEBOUNCED_KEYS: readonly PreferenceKey[] = [
  'generation.windows.quick',
  'generation.windows.ping',
  'generation.windows.improve',
  'generation.windows.deep',
  'generation.coach.historyLimit',
  'sound.volume',
];

/** Sections only the options page may write (`settings.patchRestricted`). */
const RESTRICTED_KEYS: readonly PreferenceKey[] = ['hub.baseUrl', 'debug.enabled', 'debug.renderTrace'];

export interface PagesClient extends AppClient {
  /** Where the options page is: the UI subscribes to the section it names. */
  readonly location: ValueSignal<OptionsLocation>;
  /** `ui.theme`, for the page's scheme (PU-012). */
  readonly theme: ValueSignal<UiTheme>;
  /** `ui.hints` (ST-125). */
  readonly hints: ValueSignal<boolean>;
  /** Loads what the page shows and subscribes to the background's events. */
  start(): void;
  dispose(): void;
}

type Listener = (view: unknown) => void;

const UNREACHABLE: CgErrorWire = { code: 'CG-RUNTIME-UNREACHABLE' };

export function createPagesClient(env: PageEnv, ports: PagePorts): PagesClient {
  const { rpc, clock, timers } = ports;

  // ── state ──
  let unreachable = false;
  let settings: Slot<SettingsState> = IDLE;
  let session: Slot<SessionIdentity | null> = IDLE;
  /** The sign-in state was read at least once: until then «nobody» is unknown, not signed out. */
  let sessionKnown = false;
  /** Grows with every sign-in state set and every `session.get` sent: a late answer of an older read is dropped. */
  let sessionSeq = 0;
  let sessionEnd: SessionEnd = null;
  let sessionGeneration = 0;
  let signIn: PagesModel['signIn'] = { busy: false, login: '', error: null };
  let bootstrap: PagesModel['bootstrap'] = IDLE;
  let catalog: PagesModel['catalog'] = IDLE;
  let diagnostics: PagesModel['diagnostics'] = IDLE;
  let accounts: Slot<readonly SeenAccount[]> = IDLE;
  /** R20 P14b1: what each site's background told «Аккаунты» (the options page reads it). */
  let siteAccounts = new Map<HostKind, Slot<SiteAccountsFacts | null>>();
  let bindings = new Map<HostAccountKey, BindingSlot>();
  /** What the bindings on screen were resolved for (the sign-in, the hub config, the accounts): unchanged — not asked again. */
  let bindingsKey: string | null = null;
  let bindingsRun = 0;
  let quotas: PagesModel['quotas'] = new Map();
  let ops: PagesModel['ops'] = IDLE;
  let consent: boolean | null = null;
  let hubAccess: boolean | null = null;
  /** The address `hubAccess` was answered for: for any other one the access is unknown. */
  let hubAccessOrigin: string | null = null;
  let hostAccess: boolean | null = null;
  let check: PagesModel['check'] = { running: false, lastAt: null, allowedAt: 0, latencyMs: null };
  let sound: PagesModel['sound'] = { tested: false, error: null };
  let deepSavedAs: number | null = null;
  let deepRun = 0;
  /** The hub address write still on its way: a sign-in clicked meanwhile waits for it and learns how it ended. */
  let addressWrite: Promise<WriteOutcome> | null = null;
  let newcomers: number | null = null;
  let aiTodayMicroUsd: number | null = null;
  const prompts = new Map<string, Slot<TabResponsePayload<'debug.prompt'>>>();
  const journals = new Map<JournalKind, Slot<JournalData>>();
  /** The number of the latest request of each read: only its answer is applied. */
  const readSeq = new Map<string, number>();
  let locationSeq = 0;
  const location = new Signal<OptionsLocation>({ ...routeOfHash(ports.window.hash()), seq: locationSeq }, (a, b) => a.seq === b.seq);
  const theme = new Signal<UiTheme>('system');
  const hints = new Signal<boolean>(true);

  // Until the settings are read: the default's language, as a fresh install has it.
  let locale: Locale = resolveLocale(DEFAULT_SETTINGS.ui.locale, env.systemLanguages());
  let translator: Translator = createTranslator(locale, env.phrases);
  const i18n: LiveI18n = createI18n({ language: locale, now: () => clock.now(), phrases: env.phrases, ...(env.timeZone === undefined ? {} : { timeZone: env.timeZone }) });

  /** The events' channel is parked (the background sleeps): its next opening is followed by a re-read. */
  let eventsParked = false;
  let version = 0;
  let cachedModel: { readonly version: number; readonly model: PagesModel } | null = null;
  const views = new Map<string, { readonly version: number; readonly vm: unknown }>();
  const listeners = new Map<string, { readonly selector: ViewSelector; readonly set: Set<Listener> }>();
  const offs: (() => void)[] = [];
  let started = false;
  let disposed = false;
  let recheckTimer: unknown = null;
  let pollTimer: unknown = null;
  let opsTimer: unknown = null;
  let lastFocusCheck = 0;

  const report = (scope: string, code: string, error: unknown): void => {
    try {
      ports.report?.({ scope, code, name: error instanceof Error ? error.name : typeof error });
    } catch {
      // a failing reporter never breaks the page
    }
  };

  // ── settings writes ──
  const writer = new SettingsWriter({
    send: (patch, baseRevision, restricted) =>
      restricted && env.page === 'options' ? rpc.request('settings.patchRestricted', { patch, baseRevision }) : rpc.request('settings.patch', { patch, baseRevision }),
    timers,
    onConfirmed: (state) => adoptSettings(state),
    onChange: () => emit(),
  });

  function effectiveSettings(): SettingsState['settings'] | null {
    const confirmed = valueOf(settings);
    return confirmed === null ? null : settingsWithPending(confirmed.settings, writer.pending());
  }

  /** Nobody is signed in — read, not assumed: an unread or failed sign-in state is not «signed out». */
  const signedOut = (): boolean => session.s === 'ok' && session.value === null;

  /** Debug data may be on this page: debug is on and the person has not signed out (§9.3). */
  const debugOpen = (): boolean => effectiveSettings()?.debug.enabled === true && !(sessionKnown && valueOf(session) === null);

  /** §9.3 «выключение отладки или выход очищают всё»: what was read is dropped, and an answer still on its way with it. */
  function syncDebug(): void {
    if (debugOpen()) {
      for (const entry of listeners.values()) if (entry.set.size > 0) ensureLoaded(entry.selector);
      return;
    }
    dropDebug();
  }

  function dropDebug(): void {
    prompts.clear();
    journals.clear();
    for (const [key, seq] of readSeq) if (key.startsWith('prompt:') || key.startsWith('journal:')) readSeq.set(key, seq + 1);
  }

  function applyPreferences(): void {
    const effective = effectiveSettings();
    if (effective === null) return;
    theme.set(effective.ui.theme);
    hints.set(effective.ui.hints);
    const next = resolveLocale(effective.ui.locale, env.systemLanguages());
    if (next !== locale) {
      locale = next;
      translator = createTranslator(locale, env.phrases);
      i18n.setLanguage(locale);
    }
    try {
      ports.language.setLanguage(locale);
    } catch (error) {
      report('pages.language', 'CG-UI-FAILED', error);
    }
  }

  function adoptSettings(state: SettingsState): void {
    const before = valueOf(settings);
    if (before !== null && settings.s === 'ok' && state.revision < before.revision) return;
    settings = { s: 'ok', value: state, at: clock.now() };
    unreachable = false;
    writer.adoptRevision(state.revision);
    if (before === null || before.settings.hub.baseUrl !== state.settings.hub.baseUrl) void checkAccess();
    applyPreferences();
    syncDebug();
  }

  // ── the model and the views ──
  function model(): PagesModel {
    if (cachedModel !== null && cachedModel.version === version) return cachedModel.model;
    const built: PagesModel = {
      env,
      now: clock.now(),
      locale,
      t: translator,
      unreachable,
      settings,
      effective: effectiveSettings(),
      save: writer.status(),
      session,
      sessionKnown,
      sessionEnd,
      signIn,
      bootstrap,
      catalog,
      diagnostics,
      accounts,
      siteAccounts,
      bindings,
      quotas,
      ops,
      consent,
      // An answer for another address says nothing about this one.
      hubAccess: hubAccessOrigin === (effectiveSettings()?.hub.baseUrl ?? null) ? hubAccess : null,
      hostAccess,
      check,
      sound,
      deepSavedAs,
      location: location.value,
      systemScheme: ports.systemScheme.value,
      newcomers,
      aiTodayMicroUsd,
      prompts,
      journals,
    };
    cachedModel = { version, model: built };
    return built;
  }

  function build(selector: ViewSelector): unknown {
    if (selector.of === 'popup') return popupView(model(), ports);
    if (selector.of === 'options') return optionsView(model(), ports, selector.section);
    if (selector.of === 'debug-prompt') return debugPromptView(model(), selector.token);
    if (selector.of === 'journal') return journalView(model(), selector.journal);
    throw new Error(`pages client: no «${selector.of}» view on an extension page`);
  }

  function snapshot(selector: ViewSelector): unknown {
    const key = selectorKey(selector);
    const cached = views.get(key);
    if (cached !== undefined && cached.version === version) return cached.vm;
    const vm = build(selector);
    views.set(key, { version, vm });
    return vm;
  }

  function emit(): void {
    if (disposed) return;
    version += 1;
    applyPreferences();
    for (const [, entry] of [...listeners]) {
      if (entry.set.size === 0) continue;
      let vm: unknown;
      try {
        vm = snapshot(entry.selector);
      } catch (error) {
        report('pages.view', 'CG-UI-FAILED', error);
        continue;
      }
      for (const listener of [...entry.set]) listener(vm);
    }
  }

  // ── reads ──
  async function ask<T extends PageRequestType>(type: T, payload: TabRequestPayload<T>, options?: { readonly timeoutMs?: number }): Promise<PageAnswer<TabResponsePayload<T>>> {
    try {
      return await rpc.request(type, payload, options);
    } catch (error) {
      report(`pages.rpc.${type}`, 'CG-RUNTIME-UNREACHABLE', error);
      return { ok: false, error: UNREACHABLE };
    }
  }

  /**
   * Runs one read into a slot. Only the latest request of a slot is applied —
   * an older answer that comes late never overwrites a newer one — and a
   * result that belongs to an earlier sign-in is dropped.
   */
  async function read<T>(key: string, get: () => Slot<T>, set: (slot: Slot<T>) => void, load: () => Promise<PageAnswer<T>>, scoped = false): Promise<T | null> {
    const generation = sessionGeneration;
    const seq = (readSeq.get(key) ?? 0) + 1;
    readSeq.set(key, seq);
    const last = valueOf(get());
    set({ s: 'loading', since: clock.now(), last });
    emit();
    const answer = await load();
    if (disposed || readSeq.get(key) !== seq || (scoped && generation !== sessionGeneration)) return null;
    set(answer.ok ? { s: 'ok', value: answer.payload, at: clock.now() } : { s: 'error', error: answer.error, at: clock.now(), last });
    emit();
    return answer.ok ? answer.payload : null;
  }

  async function loadSettings(): Promise<void> {
    const answer = await ask('settings.get', {});
    if (disposed) return;
    if (answer.ok) adoptSettings(answer.payload);
    else {
      unreachable = answer.error.code === 'CG-RUNTIME-UNREACHABLE';
      settings = { s: 'error', error: answer.error, at: clock.now(), last: valueOf(settings) };
    }
    emit();
  }

  async function loadSession(): Promise<void> {
    sessionSeq += 1;
    const seq = sessionSeq;
    const answer = await ask('session.get', {});
    // A newer read, or a `session.changed` that came meanwhile, already said more than this answer.
    if (disposed || seq !== sessionSeq) return;
    if (!answer.ok) {
      // A failed read is not a sign-out (PU-002): what was known stays known, what was not stays unknown.
      session = { s: 'error', error: answer.error, at: clock.now(), last: valueOf(session) };
      emit();
      return;
    }
    setSession(answer.payload.session);
    emit();
  }

  /** Adopts a sign-in state the background stated; true — it is another sign-in (or none) than before. */
  function setSession(next: SessionIdentity | null): boolean {
    const before = valueOf(session);
    const first = !sessionKnown;
    sessionSeq += 1;
    sessionKnown = true;
    session = { s: 'ok', value: next, at: clock.now() };
    const same = before?.epoch === next?.epoch && before?.userId === next?.userId && (before === null) === (next === null);
    if (!same) {
      // Another sign-in (or none): what the hub said for the previous one is not this one's.
      sessionGeneration += 1;
      bootstrap = IDLE;
      catalog = IDLE;
      bindings = new Map();
      bindingsKey = null;
      quotas = new Map();
      newcomers = null;
      aiTodayMicroUsd = null;
      if (next !== null) sessionEnd = null;
      // The prompt and the journals of the previous sign-in are not this one's either (§9.3).
      if (!first) dropDebug();
    }
    syncDebug();
    return !same;
  }

  const loadBootstrap = (force: boolean): Promise<unknown> =>
    read(
      'bootstrap',
      () => bootstrap,
      (slot) => {
        bootstrap = slot;
      },
      () => ask('bootstrap.get', force ? { force: true } : {}),
      true,
    );

  const loadCatalog = (force: boolean): Promise<unknown> =>
    read(
      'catalog',
      () => catalog,
      (slot) => {
        catalog = slot;
      },
      () => ask('catalog.get', force ? { force: true } : {}),
      true,
    );

  const loadDiagnostics = (): Promise<unknown> =>
    read(
      'diagnostics',
      () => diagnostics,
      (slot) => {
        diagnostics = slot;
      },
      () => ask('diagnostics.get', {}),
    );

  const loadAccounts = (): Promise<unknown> =>
    read(
      'accounts',
      () => accounts,
      (slot) => {
        accounts = slot;
      },
      async () => {
        const answer = await ask('accounts.seen', {});
        return answer.ok ? { ok: true, payload: answer.payload.accounts } : answer;
      },
    );

  /** R20 P14b1: the sites that tell «Аккаунты» more than their tabs' reports (sessions, tabs without an account); the options page only. */
  const loadSiteAccounts = (): Promise<unknown> =>
    env.page !== 'options'
      ? Promise.resolve()
      : Promise.all(
          (ports.siteAccounts ?? []).map((site) =>
            read(
              `site-accounts:${site.host}`,
              () => siteAccounts.get(site.host) ?? IDLE,
              (slot) => {
                siteAccounts = new Map(siteAccounts).set(site.host, slot);
              },
              () => site.read().catch((error: unknown): PageAnswer<SiteAccountsFacts | null> => {
                report(`pages.site.${site.host}`, 'CG-RUNTIME-UNREACHABLE', error);
                return { ok: false, error: UNREACHABLE };
              }),
            ),
          ),
        );

  const loadOps = (): Promise<unknown> =>
    read(
      'ops',
      () => ops,
      (slot) => {
        ops = slot;
      },
      async () => {
        const answer = await ask('op.list', { scope: 'all' });
        return answer.ok ? { ok: true, payload: answer.payload.ops } : answer;
      },
    );

  /**
   * The hub page of every seen account, then the quota of every bound page.
   * The background answers a binding from the bootstrap it already holds, so
   * the same sign-in, hub config and accounts give the same answers: without
   * `force` they are not asked again (a focus re-check costs nothing here),
   * and a first resolve of many accounts goes a few at a time.
   */
  async function loadBindings(force: boolean): Promise<void> {
    if (valueOf(session) === null) return;
    const generation = sessionGeneration;
    // The reported accounts and the sites' sessions none of them names (R20 P14b1): a session-only account binds too —
    // once its platform's id is known; before that there is nothing to bind it by, and it is not a problem of «Аккаунты».
    const reported = new Set((valueOf(accounts) ?? []).map((entry) => accountKeyOf(entry.account)));
    const seen = knownAccounts(model()).filter((entry) => entry.account.platformAccountId !== null || reported.has(accountKeyOf(entry.account)));
    const key = [String(generation), String(valueOf(bootstrap)?.configRevision ?? '?'), ...seen.map((entry) => `${accountKeyOf(entry.account)}>${entry.account.platformAccountId ?? '?'}`).sort()].join('|');
    // An answer that was a passing failure (the background not reached) is asked again; a binding the hub does not have is an answer.
    const answered = [...bindings.values()].every((slot) => slot.ok || slot.error.code.startsWith('CG-BINDING-'));
    if (!force && key === bindingsKey && answered) return;
    bindingsRun += 1;
    const run = bindingsRun;
    const next = new Map<HostAccountKey, BindingSlot>();
    await pooled(seen, BINDING_RESOLVE_CONCURRENCY, async (entry) => {
      const answer = await ask('binding.resolve', { account: entry.account });
      next.set(accountKeyOf(entry.account), answer.ok ? { ok: true, binding: answer.payload.binding } : { ok: false, error: answer.error });
    });
    if (disposed || generation !== sessionGeneration || run !== bindingsRun) return;
    bindings = next;
    bindingsKey = key;
    emit();
    const pageIds = [...new Set([...next.values()].flatMap((slot) => (slot.ok ? [slot.binding.pageId] : [])))];
    const read = new Map<number, TabResponsePayload<'quota.get'>['quota']>();
    await pooled(pageIds, BINDING_RESOLVE_CONCURRENCY, async (pageId) => {
      const answer = await ask('quota.get', { pageId });
      if (answer.ok) read.set(pageId, answer.payload.quota);
    });
    if (disposed || generation !== sessionGeneration || run !== bindingsRun) return;
    quotas = read;
    emit();
  }

  /** The popup's own extras for the page of the open chat: new subscribers, and in debug today's own AI spend. */
  async function loadPopupExtras(): Promise<void> {
    if (env.page !== 'popup') return;
    const generation = sessionGeneration;
    const current = currentAccountOf(model());
    const bound = current === null ? null : boundPageOf(model(), current.account);
    if (current === null || bound === null) return;
    const pageId = bound.binding.pageId;
    const debug = effectiveSettings()?.debug.enabled === true;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: AI_USAGE_LIMITS.defaultTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock.now()));
    // «Новые» of the page the open chat's account is bound to: the feature of the site's manifest decides — the
    // page's own switch — and only a site whose «Новые» are the hub's list has one to count here.
    const slice = env.features(current.account.host);
    const read = valueOf(bootstrap);
    const page = read?.pages.find((candidate) => candidate.pageId === pageId);
    const listed = slice?.['newcomers']?.source === 'hub' && admission(slice, 'newcomers', null, onPage(read, page)).state === 'on';
    const [audience, usage] = await Promise.all([
      listed ? ask('newcomers.list', { pageId, windowHours: POPUP_NEWCOMERS_WINDOW_HOURS, cursor: null }) : Promise.resolve(null),
      debug ? ask('usage.get', { pageId, date, days: 1 }) : Promise.resolve(null),
    ]);
    if (disposed || generation !== sessionGeneration) return;
    newcomers = audience !== null && audience.ok ? audience.payload.items.length : null;
    const day = usage !== null && usage.ok ? (usage.payload.report?.days.at(-1) ?? null) : null;
    aiTodayMicroUsd = day === null ? null : day.totals.costMicroUsd;
    emit();
  }

  async function checkAccess(): Promise<void> {
    const origin = effectiveSettings()?.hub.baseUrl ?? null;
    // The browser not answering is «unknown» (null), never «not allowed».
    const [hub, host, granted] = await Promise.all([
      origin === null ? Promise.resolve(null) : ports.permissions.has(origin).catch(() => null),
      ports.permissions.has(env.hostOrigin).catch(() => null),
      ports.consent.check().catch(() => null),
    ]);
    if (disposed) return;
    // The address may have changed while the browser answered: the answer belongs to the one asked.
    if ((effectiveSettings()?.hub.baseUrl ?? null) === origin) {
      hubAccess = hub;
      hubAccessOrigin = origin;
    }
    hostAccess = host;
    consent = granted;
    emit();
  }

  /**
   * Everything the page shows, in the order the answers depend on each other.
   * `force` goes past the hub caches of the background; `fresh` asks the
   * bindings and quotas again even when nothing they depend on has changed
   * (the page was opened, or the person asked) — a focus re-check does not.
   */
  async function loadAll(force: boolean, fresh: boolean = force): Promise<void> {
    const needsHost = env.page === 'popup' || env.page === 'options';
    if (!needsHost) return;
    const signedIn = valueOf(session) !== null;
    const askedAt = clock.now();
    await Promise.all([
      loadDiagnostics(),
      loadAccounts(),
      loadSiteAccounts(),
      env.page === 'options' ? loadOps() : Promise.resolve(),
      checkAccess(),
      signedIn
        ? loadBootstrap(force).then(() => {
            if (force && bootstrap.s === 'ok') check = { ...check, latencyMs: Math.max(0, clock.now() - askedAt) };
          })
        : Promise.resolve(),
      signedIn ? loadCatalog(force) : Promise.resolve(),
    ]);
    // What the background says about the connection was read before the hub answered this check: read it again.
    if (force && signedIn) await loadDiagnostics();
    if (signedIn) {
      await loadBindings(fresh);
      await loadPopupExtras();
    }
  }

  /** Everything again, then the time of this check. */
  async function refresh(force: boolean): Promise<void> {
    await loadAll(force);
    if (disposed) return;
    check = { ...check, lastAt: clock.now() };
    emit();
  }

  async function open(): Promise<void> {
    await Promise.all([loadSettings(), loadSession()]);
    if (disposed) return;
    // The settings page checks the connection every time it is opened (ST-058): access, the hub, then the catalog.
    await loadAll(env.page === 'options', true);
    if (disposed) return;
    check = { ...check, lastAt: clock.now() };
    emit();
  }

  async function recheck(): Promise<void> {
    check = { ...check, running: true, allowedAt: clock.now() + RECHECK_MIN_INTERVAL_MS };
    emit();
    if (recheckTimer !== null) timers.clear(recheckTimer);
    recheckTimer = timers.set(() => {
      recheckTimer = null;
      emit();
    }, RECHECK_MIN_INTERVAL_MS);
    await Promise.all([loadSettings(), loadSession()]);
    await loadAll(true);
    if (disposed) return;
    check = { ...check, running: false, lastAt: clock.now() };
    emit();
  }

  async function loadPrompt(token: string): Promise<void> {
    await read(
      `prompt:${token}`,
      () => prompts.get(token) ?? IDLE,
      (slot) => {
        prompts.set(token, slot);
      },
      () => ask('debug.prompt', { token }),
    );
  }

  async function loadJournal(journal: JournalKind): Promise<void> {
    await read(
      `journal:${journal}`,
      () => journals.get(journal) ?? IDLE,
      (slot) => {
        journals.set(journal, slot);
      },
      () => ask('journal.read', { journal, limit: LOG_LIMITS.exportRecentRecords }),
    );
  }

  /** A debug page reads its data once debug is known to be on — never while it is off or after a sign-out (DB-001, §9.3). */
  function ensureLoaded(selector: ViewSelector): void {
    if (!started || !debugOpen()) return;
    if (selector.of === 'debug-prompt' && isPromptToken(selector.token) && (prompts.get(selector.token)?.s ?? 'idle') === 'idle') void loadPrompt(selector.token);
    if (selector.of === 'journal' && (journals.get(selector.journal)?.s ?? 'idle') === 'idle') void loadJournal(selector.journal);
  }

  // ── polling while a section that shows live state is on screen ──
  const LIVE_SECTIONS: readonly SettingsSection[] = ['status', 'appearance'];
  function watchingLive(): boolean {
    return [...listeners.values()].some((entry) => entry.set.size > 0 && entry.selector.of === 'options' && LIVE_SECTIONS.includes(entry.selector.section));
  }
  /** A tab nobody looks at reads nothing: its requests would also keep the event page from ever going idle. */
  const onScreen = (): boolean => ports.window.visible?.() !== false;
  function armPoll(): void {
    if (pollTimer !== null || disposed || env.page !== 'options' || !watchingLive() || !onScreen()) return;
    pollTimer = timers.set(() => {
      pollTimer = null;
      // Hidden meanwhile: the polling stops, and starts again when the page is back on screen (`onFocus`).
      if (disposed || !watchingLive() || !onScreen()) return;
      void loadDiagnostics().then(armPoll);
    }, SOUND_STATE_POLL_MS);
  }

  // ── actions ──
  const done = (type: UiAction['type'], extra: { readonly revision?: number; readonly outcome?: 'done' | 'opened' | 'noop' | 'started' } = {}): ActionReceipt => ({
    ok: true,
    type,
    outcome: extra.outcome ?? 'done',
    ...(extra.revision === undefined ? {} : { revision: extra.revision }),
  });
  const fail = (type: UiAction['type'], wire: CgErrorWire): ActionReceipt => ({ ok: false, type, code: wire.code, error: errorView(wire, translator) });
  const code = (type: UiAction['type'], cgCode: CgCode, detail?: string): ActionReceipt => fail(type, detail === undefined ? { code: cgCode } : { code: cgCode, detail });
  const receiptOf = (type: UiAction['type'], outcome: WriteOutcome): ActionReceipt => (outcome.ok ? done(type, { revision: outcome.revision }) : fail(type, outcome.error));

  /** A settings write, refused before it starts when the store is read-only or not read yet. */
  async function write(type: UiAction['type'], patch: SettingsPatch, mode: WriteMode): Promise<ActionReceipt> {
    const state = valueOf(settings);
    if (state === null) return code(type, 'CG-STORAGE-READ');
    if (state.readOnly) return code(type, 'CG-STORAGE-VERSION');
    return receiptOf(type, await writer.write(patch, mode));
  }

  /** The patch of one preference, by its path in the settings; each value keeps the type of its key. */
  function preferencePatch(action: UiActionOf<'SetPreference'>): SettingsPatch {
    switch (action.key) {
      case 'hub.baseUrl':
        return { hub: { baseUrl: action.value } };
      case 'ui.theme':
        return { ui: { theme: action.value } };
      case 'ui.locale':
        return { ui: { locale: action.value } };
      case 'ui.hints':
        return { ui: { hints: action.value } };
      case 'ui.resultStyle':
        return { ui: { resultStyle: action.value } };
      case 'generation.split':
        return { generation: { split: action.value } };
      case 'generation.windows.quick':
        return { generation: { windows: { quick: action.value } } };
      case 'generation.windows.ping':
        return { generation: { windows: { ping: action.value } } };
      case 'generation.windows.improve':
        return { generation: { windows: { improve: action.value } } };
      case 'generation.windows.deep':
        return { generation: { windows: { deep: action.value } } };
      case 'generation.coach.historyLimit':
        return { generation: { coach: { historyLimit: action.value } } };
      case 'generation.coach.autoRecap':
        return { generation: { coach: { autoRecap: action.value } } };
      case 'sound.messages.on':
        return { sound: { messages: { on: action.value } } };
      case 'sound.messages.tone':
        return { sound: { messages: { tone: action.value } } };
      case 'sound.subscribers.on':
        return { sound: { subscribers: { on: action.value } } };
      case 'sound.subscribers.tone':
        return { sound: { subscribers: { tone: action.value } } };
      case 'sound.volume':
        return { sound: { volume: action.value } };
      case 'debug.enabled':
        return { debug: { enabled: action.value } };
      case 'debug.renderTrace':
        return { debug: { renderTrace: action.value } };
      case 'onboarding.checklistDismissed':
        return { onboarding: { checklistDismissed: action.value } };
      case 'onboarding.keysFooter.dismissed':
        return { onboarding: { keysFooter: { ...(effectiveSettings()?.onboarding.keysFooter ?? { shown: 0 }), dismissed: action.value } } };
    }
  }

  async function setPreference(action: UiActionOf<'SetPreference'>): Promise<ActionReceipt> {
    const { key } = action;
    if (RESTRICTED_KEYS.includes(key) && env.page !== 'options') return code('SetPreference', 'CG-UNKNOWN', 'restricted section');
    if (key === 'hub.baseUrl') {
      // ST-042: the address changes only while it is known that nobody is signed in — «unknown» is not «signed out».
      if (valueOf(session) !== null) return code('SetPreference', 'CG-HUB-URL', 'signed in');
      if (!signedOut()) {
        // The sign-in state could not be read: the form says so with that read's own code, and the address stays.
        const unread: CgErrorWire = session.s === 'error' ? session.error : { code: 'CG-HUB-URL', detail: 'sign-in state unknown' };
        signIn = { ...signIn, error: unread };
        emit();
        return fail('SetPreference', unread);
      }
      const state = valueOf(settings);
      if (state === null) return code('SetPreference', 'CG-STORAGE-READ');
      if (state.readOnly) return code('SetPreference', 'CG-STORAGE-VERSION');
      const origin = normalizeHubOrigin(action.value);
      if (origin === null) {
        signIn = { ...signIn, error: { code: 'CG-HUB-URL' } };
        emit();
        return code('SetPreference', 'CG-HUB-URL');
      }
      // A custom address needs host access, asked inside this click (§3); the stock one is in the manifest.
      // The browser not answering about the stock one is «unknown»; a prompt that failed is «not allowed».
      const access: Promise<boolean | null> = origin === DEFAULT_HUB_ORIGIN ? ports.permissions.has(origin).catch(() => null) : ports.permissions.request(origin).catch(() => false);
      signIn = { ...signIn, error: null };
      // The address goes alone and is checked again when it is sent: a sign-in that came meanwhile refuses it,
      // and a refused address is never sent later inside another change.
      const saving = writer.writeAlone({ hub: { baseUrl: origin } }, () => (signedOut() ? null : { code: 'CG-HUB-URL', detail: 'signed in' }));
      addressWrite = saving;
      const outcome = await saving;
      if (addressWrite === saving) addressWrite = null;
      // Not saved: the form says so with the code, and the field shows the address that is stored.
      if (!outcome.ok) signIn = { ...signIn, error: outcome.error };
      emit();
      const granted = await access;
      if ((effectiveSettings()?.hub.baseUrl ?? null) === origin) {
        hubAccess = granted;
        hubAccessOrigin = origin;
        emit();
      }
      return receiptOf('SetPreference', outcome);
    }
    const mode: WriteMode = DEBOUNCED_KEYS.includes(key) ? 'debounced' : 'now';
    if (key === 'generation.windows.deep') {
      // The hub takes no more than its `deepMax` (Б5): a larger window is cut, and the page says so —
      // once the background confirmed the write that carried the cut value, not before.
      const deepMax = valueOf(bootstrap)?.limits.deepMax ?? null;
      const cut = deepMax !== null && action.value > deepMax;
      const stored = cut ? Math.max(SETTINGS_RANGES.windowDeep.min, deepMax) : action.value;
      deepRun += 1;
      const run = deepRun;
      deepSavedAs = null;
      const receipt = await write('SetPreference', preferencePatch({ ...action, value: stored }), mode);
      if (run === deepRun && receipt.ok && cut) {
        deepSavedAs = stored;
        emit();
      }
      return receipt;
    }
    return write('SetPreference', preferencePatch(action), mode);
  }

  function accountKeyOfHandle(handle: string): HostAccountKey | null {
    return HOST_ACCOUNT_KEY_PATTERN.test(handle) ? (handle as HostAccountKey) : null;
  }

  /** The keys of an account's other ids (R20 P14b1, ST-079): its site's sessions name them. */
  function aliasKeysOf(key: HostAccountKey): HostAccountKey[] {
    const [host, hostAccountId] = key.split(':');
    if (!isHostKind(host) || hostAccountId === undefined) return [];
    return aliasesOf(model(), host, hostAccountId).map((alias) => hostAccountKeyOf(host, alias));
  }

  async function doSignIn(action: UiActionOf<'SignIn'>): Promise<ActionReceipt> {
    // One sign-in at a time (AU-009): a second submit while the first is on its way sends nothing.
    if (signIn.busy) return done('SignIn', { outcome: 'noop' });
    // The address on screen: the stored one, or the one being saved right now.
    const origin = effectiveSettings()?.hub.baseUrl ?? null;
    if (origin === null) return code('SignIn', 'CG-STORAGE-READ');
    // Host access first, inside this click, before anything is awaited (ST-046).
    const access = hubAccess === true && hubAccessOrigin === origin ? Promise.resolve(true) : ports.permissions.request(origin).catch(() => false);
    // The password goes to the background once; here only the login stays for the form.
    signIn = { busy: true, login: action.login, error: null };
    emit();
    const refuse = (wire: CgErrorWire): ActionReceipt => {
      signIn = { busy: false, login: action.login, error: wire };
      emit();
      return fail('SignIn', wire);
    };
    // An address still being saved is waited for (and what waits for its pause goes now): the background signs in
    // against the address it has stored, so the sign-in is sent only once that is the address on screen (§8.2).
    const saving = addressWrite;
    writer.flush();
    await writer.settled();
    const saved = saving === null ? null : await saving;
    if (disposed) return done('SignIn');
    // Not the address on screen: it was not saved (the reason is the write's own), or it changed elsewhere meanwhile.
    if ((valueOf(settings)?.settings.hub.baseUrl ?? null) !== origin) return refuse(saved !== null && !saved.ok ? saved.error : { code: 'CG-HUB-URL', detail: 'the hub address is not the one on screen' });
    if (!(await access)) {
      hubAccess = false;
      hubAccessOrigin = origin;
      return refuse({ code: 'CG-HUB-HOST-PERMISSION' });
    }
    hubAccess = true;
    hubAccessOrigin = origin;
    const answer = await ask('session.signIn', { login: action.login, password: action.password }, { timeoutMs: SIGN_IN_TIMEOUT_MS });
    if (disposed) return done('SignIn');
    if (!answer.ok) return refuse(answer.error);
    signIn = { busy: false, login: '', error: null };
    sessionEnd = null;
    // `session.changed` usually comes first and has started the load already: one load per sign-in.
    const changed = setSession(answer.payload.session);
    emit();
    if (changed) void refresh(false);
    return done('SignIn');
  }

  async function doSignOut(): Promise<ActionReceipt> {
    const answer = await ask('session.signOut', {});
    if (disposed) return done('SignOut');
    if (!answer.ok) {
      // Unknown whether the sign-in is still there: ask instead of guessing.
      await loadSession();
      return fail('SignOut', answer.error);
    }
    const revoked = answer.payload.serverRevoked === true;
    sessionEnd = revoked ? 'signed-out' : 'sign-out-unconfirmed';
    setSession(null);
    signIn = { busy: false, login: '', error: null };
    emit();
    // The local sign-in is gone either way; the hub not confirming the revoke is said, not hidden (ST-051).
    return revoked ? done('SignOut') : code('SignOut', 'CG-HUB-UNAVAILABLE', 'signed out here; the hub did not confirm the revoke');
  }

  async function tabCommand(type: UiAction['type'], command: TabRequestPayload<'tab.command'>['command']): Promise<ActionReceipt> {
    const answer = await ask('tab.command', { command });
    if (!answer.ok) return fail(type, answer.error);
    if (!answer.payload.delivered) return code(type, 'CG-HOST-NOT-READY');
    // The popup has handed the click to the tab: it gets out of the way.
    if (env.page === 'popup') ports.window.close?.();
    return done(type, { outcome: 'opened' });
  }

  async function navigate(action: UiActionOf<'Navigate'>): Promise<ActionReceipt> {
    const to = action.to;
    if (to.kind === 'page') {
      const url = to.page === 'whats-new' ? env.links.whatsNew : env.links.changelog;
      if (url === null || !/^https:\/\//i.test(url) || !ports.openLink(url)) return code('Navigate', 'CG-NAV-FAILED');
      // The notes of this version have been opened: the «нов.» mark goes (ST-005).
      if (to.page === 'whats-new' && effectiveSettings()?.onboarding.lastSeenVersion !== env.version) void write('Navigate', { onboarding: { lastSeenVersion: env.version } }, 'now');
      return done('Navigate', { outcome: 'opened' });
    }
    if (to.kind === 'surface') {
      if (!to.open || (to.surface !== 'spenders' && to.surface !== 'newcomers' && to.surface !== 'cheatsheet')) return code('Navigate', 'CG-NAV-FAILED');
      return tabCommand('Navigate', { kind: 'surface', surface: to.surface });
    }
    if (to.kind === 'account') {
      const key = accountKeyOfHandle(to.accountHandle);
      const [host, hostAccountId] = (key ?? '').split(':');
      if (key === null || !isHostKind(host) || hostAccountId === undefined) return code('Navigate', 'CG-NAV-FAILED');
      // A site with its own way to a tab of an account (R20 P14b1, ST-076): its tab to the front, no command sent to it.
      const site = ports.siteAccounts?.find((entry) => entry.host === host);
      if (site !== undefined) {
        const answer = await site.focus(hostAccountId).catch((): PageAnswer<boolean> => ({ ok: false, error: UNREACHABLE }));
        if (!answer.ok) return fail('Navigate', answer.error);
        return answer.payload ? done('Navigate', { outcome: 'opened' }) : code('Navigate', 'CG-HOST-NOT-READY');
      }
      return tabCommand('Navigate', { kind: 'account', host, hostAccountId });
    }
    if (to.kind === 'journal') {
      const opened = await ports.pages.open('debug-journal', to.journal);
      return opened.ok ? done('Navigate', { outcome: 'opened' }) : code('Navigate', 'CG-NAV-FAILED');
    }
    // A chat, a chat step or a prompt snapshot is opened from a ChatSpace tab, never from a page.
    return code('Navigate', 'CG-NAV-FAILED');
  }

  async function copy(type: UiAction['type'], text: string | null): Promise<ActionReceipt> {
    if (text === null || text === '') return code(type, 'CG-CLIPBOARD');
    const result = await ports.clipboard.writeText(text).catch((): { ok: false; code: 'CG-CLIPBOARD' } => ({ ok: false, code: 'CG-CLIPBOARD' }));
    return result.ok ? done(type) : code(type, 'CG-CLIPBOARD');
  }

  function artifactText(handle: string): string | null {
    if (handle === PROMPT_ARTIFACT) {
      // The one prompt this page shows; the text goes to the clipboard and nowhere else — and not at all once debug is off or the person signed out.
      if (!debugOpen()) return null;
      for (const slot of prompts.values()) if (slot.s === 'ok' && slot.value.state === 'ok') return promptText(slot.value);
      return null;
    }
    for (const [journal, slot] of journals) {
      const data = valueOf(slot);
      if (handle === journalArtifact(journal)) return data !== null && debugOpen() ? journalText(data) : null;
    }
    const id = /^account-id:(?:chatspace|fansly-web):([1-9]\d{0,29})$/.exec(handle)?.[1];
    return id ?? null;
  }

  const stamp = (): string => new Date(clock.now()).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

  async function exportDiagnostics(): Promise<ActionReceipt> {
    // JSON for support, the short TXT for a quick look (§9.2); both through a Blob, no `downloads` right.
    const json = await ask('diagnostics.export', { format: 'json' });
    if (!json.ok) return fail('ExportDiagnostics', json.error);
    if (!ports.download(json.payload)) return code('ExportDiagnostics', 'CG-UNKNOWN', 'download refused');
    const txt = await ask('diagnostics.export', { format: 'txt' });
    if (txt.ok) ports.download(txt.payload);
    return done('ExportDiagnostics');
  }

  async function testSound(action: UiActionOf<'TestSound'>): Promise<ActionReceipt> {
    const effective = effectiveSettings();
    if (effective === null) return code('TestSound', 'CG-STORAGE-READ');
    const answer = await ask('sound.preview', { tone: effective.sound[action.which].tone, volume: effective.sound.volume });
    const error: CgErrorWire | null = !answer.ok ? answer.error : answer.payload.played ? null : { code: answer.payload.code ?? 'CG-AUDIO-BLOCKED' };
    sound = { tested: sound.tested || error === null, error };
    emit();
    return error === null ? done('TestSound') : fail('TestSound', error);
  }

  async function requestPermission(action: UiActionOf<'RequestPermission'>): Promise<ActionReceipt> {
    // Called synchronously from the click: the browser shows its prompt only inside a gesture.
    if (action.kind === 'data-collection') {
      const granted = await ports.consent.request().catch(() => false);
      consent = granted ? true : await ports.consent.check().catch(() => null);
      emit();
      return granted ? done('RequestPermission') : done('RequestPermission', { outcome: 'noop' });
    }
    const origin = action.kind === 'hub-host' ? (effectiveSettings()?.hub.baseUrl ?? null) : env.hostOrigin;
    if (origin === null) return code('RequestPermission', 'CG-STORAGE-READ');
    const granted = await ports.permissions.request(origin).catch(() => false);
    if (action.kind === 'hub-host') {
      hubAccess = granted;
      hubAccessOrigin = origin;
    } else hostAccess = granted;
    emit();
    if (granted && action.kind === 'hub-host' && valueOf(session) !== null) void loadAll(false);
    return granted ? done('RequestPermission') : code('RequestPermission', action.kind === 'hub-host' ? 'CG-HUB-HOST-PERMISSION' : 'CG-HOST-NOT-READY');
  }

  async function handle(action: UiAction): Promise<ActionReceipt> {
    if (action.type === 'SetPreference') return setPreference(action);
    if (action.type === 'SetAccountLabel') {
      const key = accountKeyOfHandle(action.accountHandle);
      if (key === null) return code('SetAccountLabel', 'CG-UNKNOWN', 'not an account');
      const label = action.label === null ? '' : action.label.trim();
      // The account's own id carries it; one an alias carried goes (ST-079: the canonical id wins).
      const cleared = Object.fromEntries(aliasKeysOf(key).map((alias) => [alias, null]));
      return write('SetAccountLabel', { accounts: { labels: { ...cleared, [key]: label === '' ? null : label } } }, 'debounced');
    }
    if (action.type === 'SetAccountMuted') {
      const key = accountKeyOfHandle(action.accountHandle);
      const effective = effectiveSettings();
      if (key === null || effective === null) return code('SetAccountMuted', 'CG-UNKNOWN', 'not an account');
      // The model's sound is one switch for all its ids (ST-075, ST-079): whichever id a sound names, it stays quiet.
      const ids = [key, ...aliasKeysOf(key)];
      const muted = effective.sound.mutedAccounts.filter((entry) => !ids.includes(entry));
      return write('SetAccountMuted', { sound: { mutedAccounts: action.muted ? [...muted, ...ids] : muted } }, 'now');
    }
    if (action.type === 'ChoosePersona') {
      const pageId = pageIdOfHandle(action.pageHandle);
      const persona = valueOf(catalog)?.personas.find((entry) => entry.key === action.personaKey && entry.status === 'active');
      if (pageId === null || persona === undefined) return code('ChoosePersona', 'CG-PERSONA-UNAVAILABLE');
      // A reference, never a prompt body (§8.2); the background cancels that page's operations on the change.
      return write('ChoosePersona', { personas: { byPageId: { [String(pageId)]: { key: persona.key, definitionId: persona.definitionId } } } }, 'now');
    }
    if (action.type === 'RetrySettingsWrite') {
      const retried = writer.retry();
      return retried === null ? done('RetrySettingsWrite', { outcome: 'noop' }) : receiptOf('RetrySettingsWrite', await retried);
    }
    if (action.type === 'SignIn') return doSignIn(action);
    if (action.type === 'SignOut') return doSignOut();
    if (action.type === 'RecheckStatus') {
      if (check.running || clock.now() < check.allowedAt) return done('RecheckStatus', { outcome: 'noop' });
      await recheck();
      return done('RecheckStatus');
    }
    if (action.type === 'ReloadView') {
      const { selector } = action;
      if (selector.of === 'debug-prompt' || selector.of === 'journal') {
        // Whether debug is on is read first: with it off nothing of a prompt or a journal is asked (DB-001).
        await Promise.all([loadSettings(), sessionKnown ? Promise.resolve() : loadSession()]);
        if (!debugOpen()) return done('ReloadView', { outcome: 'noop' });
        if (selector.of === 'debug-prompt') await loadPrompt(selector.token);
        else await loadJournal(selector.journal);
      } else await open();
      return done('ReloadView');
    }
    if (action.type === 'ReloadTab') {
      await open();
      return done('ReloadTab');
    }
    if (action.type === 'ReloadSurface') {
      emit();
      return done('ReloadSurface');
    }
    if (action.type === 'OpenSettings') {
      const hash = hashOfRoute(action.route);
      if (env.page === 'options') {
        ports.window.setHash(hash);
        moved();
        return done('OpenSettings', { outcome: 'opened' });
      }
      const opened = await ports.pages.open('options', hash);
      if (!opened.ok) return code('OpenSettings', 'CG-NAV-FAILED');
      if (env.page === 'popup') ports.window.close?.();
      return done('OpenSettings', { outcome: 'opened' });
    }
    if (action.type === 'Navigate') return navigate(action);
    if (action.type === 'CopyReport') {
      return copy('CopyReport', action.scope === 'status' ? statusReport(model(), i18n) : action.code === undefined ? null : errorReport(model(), i18n, action.code));
    }
    if (action.type === 'Copy') return copy('Copy', artifactText(action.artifactHandle));
    if (action.type === 'ExportDiagnostics') return exportDiagnostics();
    if (action.type === 'ClearLocalData') {
      const answer = await ask('data.clear', { confirmed: true });
      if (!answer.ok) return fail('ClearLocalData', answer.error);
      await loadDiagnostics();
      return done('ClearLocalData');
    }
    if (action.type === 'ResetSendFuse') {
      // «Сбросить предохранитель» (decision X25): the background clears the fuse and tells the tabs; «Статус» reads it again.
      const answer = await ask('send.fuseReset', {});
      if (!answer.ok) return fail('ResetSendFuse', answer.error);
      await loadDiagnostics();
      return done('ResetSendFuse');
    }
    if (action.type === 'TestSound') return testSound(action);
    if (action.type === 'RequestPermission') return requestPermission(action);
    if (action.type === 'SaveJournal') {
      if (!debugOpen()) return code('SaveJournal', 'CG-FEATURE-DISABLED');
      const data = valueOf(journals.get(action.journal) ?? IDLE);
      if (data === null) return code('SaveJournal', 'CG-DATA-NOT-READY');
      const saved = ports.download({ fileName: `chatgoose-journal-${action.journal}-${stamp()}.txt`, mime: 'text/plain', body: journalText(data) });
      return saved ? done('SaveJournal') : code('SaveJournal', 'CG-UNKNOWN', 'download refused');
    }
    if (action.type === 'CancelGeneration') {
      const answer = await ask('op.cancel', { opId: action.operationId });
      void loadOps();
      return answer.ok ? done('CancelGeneration') : fail('CancelGeneration', answer.error);
    }
    // Everything else belongs to a ChatSpace tab (generations, inserts, sends, lists).
    return code(action.type, 'CG-UNKNOWN', 'not a page action');
  }

  function moved(): void {
    locationSeq += 1;
    location.set({ ...routeOfHash(ports.window.hash()), seq: locationSeq });
    emit();
  }

  function onSessionChanged(next: SessionIdentity | null, reason: string): void {
    const changed = setSession(next);
    if (next === null && (reason === 'revoked' || reason === 'expired')) sessionEnd = reason;
    emit();
    if (changed && next !== null) void refresh(false);
  }

  function scheduleOps(): void {
    if (opsTimer !== null || env.page !== 'options') return;
    opsTimer = timers.set(() => {
      opsTimer = null;
      void loadOps();
    }, OPS_REFRESH_MIN_INTERVAL_MS);
  }

  return {
    location,
    theme,
    hints,
    getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>> {
      return snapshot(selector) as ViewOf<S>;
    },
    subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void {
      const key = selectorKey(selector);
      let entry = listeners.get(key);
      if (entry === undefined) {
        entry = { selector, set: new Set() };
        listeners.set(key, entry);
      }
      const wrapped: Listener = (view) => listener(view as ViewOf<S>);
      entry.set.add(wrapped);
      ensureLoaded(selector);
      armPoll();
      return () => {
        entry.set.delete(wrapped);
      };
    },
    dispatch(action: UiAction): Promise<ActionReceipt> {
      const parsed = UiActionSchema.safeParse(action);
      if (!parsed.success) {
        // What a person typed may be no address at all: that is theirs to fix, not a broken contract.
        if ((action as { type?: unknown }).type === 'SetPreference' && (action as { key?: unknown }).key === 'hub.baseUrl') {
          const value = (action as { value?: unknown }).value;
          return setPreference({ type: 'SetPreference', key: 'hub.baseUrl', value: typeof value === 'string' ? value : '' });
        }
        return Promise.reject(new Error('pages client: the action does not fit UiActionSchema'));
      }
      return handle(action).catch((error: unknown) => {
        report(`pages.action.${action.type}`, 'CG-UNKNOWN', error);
        return code(action.type, 'CG-UNKNOWN');
      });
    },
    start(): void {
      if (started || disposed) return;
      started = true;
      offs.push(
        rpc.onEvent('settings.changed', (state) => {
          adoptSettings(state);
          emit();
        }),
        rpc.onEvent('session.changed', (payload) => onSessionChanged(payload.session, payload.reason)),
        rpc.onEvent('bootstrap.changed', () => void loadBootstrap(false).then(() => loadBindings(true))),
        rpc.onEvent('flags.changed', () => void loadBootstrap(false)),
        rpc.onEvent('catalog.changed', () => void loadCatalog(false)),
        rpc.onEvent('quota.changed', (payload) => {
          quotas = new Map(quotas).set(payload.quota.pageId, payload.quota);
          emit();
        }),
        rpc.onEvent('op.update', scheduleOps),
        rpc.onEvent('op.done', scheduleOps),
        ports.window.onHashChange(moved),
        ports.window.onFocus(() => {
          // Back on screen: the live state is polled again (it stopped while the tab was hidden).
          armPoll();
          if (clock.now() - lastFocusCheck < FOCUS_RECHECK_MIN_INTERVAL_MS) return;
          lastFocusCheck = clock.now();
          void Promise.all([loadSession(), refresh(false)]);
        }),
        ports.window.onPageHide(() => writer.flush()),
        ports.permissions.onChange(() => void checkAccess()),
        ports.consent.onChange((granted) => {
          consent = granted;
          emit();
        }),
        ports.systemScheme.subscribe(() => emit()),
        // The events' channel was parked while the background slept, and is open again: whatever another page or
        // a tab changed meanwhile was announced to nobody here. The settings and the sign-in — what every page
        // shows or hides its data by (§9.3: debug off or a sign-out clears a debug page) — are read anew.
        ports.rpc.onEventsState?.((state) => {
          if (state === 'parked') eventsParked = true;
          else if (state === 'open' && eventsParked) {
            eventsParked = false;
            void Promise.all([loadSettings(), loadSession()]);
          }
        }) ?? ((): void => undefined),
      );
      lastFocusCheck = clock.now();
      for (const entry of listeners.values()) ensureLoaded(entry.selector);
      void open().then(armPoll);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const off of offs.splice(0)) off();
      for (const timer of [recheckTimer, pollTimer, opsTimer]) if (timer !== null) timers.clear(timer);
      writer.dispose();
      listeners.clear();
    },
  };
}
