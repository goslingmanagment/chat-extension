import { FreshnessDayStore, freshnessCounts } from '@cg/core/services/telemetry';
import type { PageDiagnostics } from '@cg/contracts/diagnostics';
import type { SiteAccessState } from '@cg/contracts/site-access';
// Composition root of the background event page (architecture.md §2, §4, §7
// «Фон и выгрузка»): only dependency wiring. Everything the extension owns
// lives here — storage, sign-in and the hub (the ONLY module that imports
// `@cg/hub`), operations, logs, telemetry — and reaches tabs and pages
// through the typed protocol of §5.4. This is the background CORE: what only
// one site needs lives in that site's chunk `bg/<site>.js`, loaded when the
// site needs it (docs/project-unite/architecture.md §3.3;
// background/host-modules.ts) and started with the core's ports (the kit,
// background/host-module.ts) — ChatSpace's X8 custody and the greeting leases
// of «Новые» are `bg/chatspace.js`. The core's import graph never reaches a
// chunk (.dependency-cruiser.cjs `background-core-graph`).
//
// Order (an event page is woken by a listener, so the listeners come first):
// 1. synchronously: the RPC (`runtime.onConnect` / `onMessage`), the alarm
//    listener, the lifecycle listeners (installed, browser start, suspend),
//    the consent and storage listeners, every request handler;
// 2. the readiness barrier runs the start steps in order — logs, settings,
//    the hub (it needs the hub address of the settings), results and
//    operations, the sites' modules with unfinished work stored (the X8
//    journal and coordinator, the greeting leases), the registrations of
//    human sends, presence, the sound, consent, telemetry, the WS tap
//    switch; every request waits for it (10 s at most);
// 3. nothing here talks to the hub by itself after an install or an update:
//    the facade refreshes a bootstrap only for an existing sign-in, and a
//    status surface reads the hub's health only for one. A real install
//    opens the settings once (the onboarding); a temporary one does not.
//
// One implementation of each thing (the wave-1 duplicates are gone):
// - readiness and presence: R07's barrier and presence; the RPC mints the
//   tab sessions;
// - operation results and the send journal: R07's stores are the single
//   writers, R10's scheduler and coordinator write through adapters
//   (background/ops-store.ts; the journal's, bg/chatspace/send-journal-store.ts);
// - the 503 retry of the AI stream: the facade's (the scheduler reads the
//   facade's own resolution, which says the retry is spent, and shows the
//   facade's notice as its `retry-wait` phase);
// - the prompt echo: the facade's store (`debug.prompt`, the echo token).
//
// What changes with the person (§8.2, §9.4): a sign-in, a sign-out, another
// hub or another persona of a page cancels the operations bound to the old
// one; a sign-out or another person also drops the results, the debug
// journals, the local spend, the greeting leases, the subscriber baselines,
// the preview drafts and the queued telemetry of the old binding. An expired
// bootstrap blocks new sensitive actions (background/token-gate.ts and the
// hub layer) and takes no result away.

import { SPEND_REPORT_FEATURES_MAX } from '@cg/contracts/diagnostics';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import { hostAccountKeyOf } from '@cg/contracts/settings';
import {
  ACTIVITY_LIMITS,
  CONTRACTS_VERSION,
  FAN_LABELS_MAX,
  HUB_CLIENT_CHECK_CODES,
  STORAGE_KEYS,
  hasCapability,
  isHubCallError,
  isHubCheckError,
  type Bootstrap,
  type CgCode,
  type CgErrorWire,
  type HostContractReport,
  type HubErrorResolution,
  type HubFailure,
  type HubRouteKey,
  type PersonaCatalog,
  type ResolveHubError,
  type SendAttributionComposedWith,
  type SettingsState,
  type SettingsV1,
} from '@cg/contracts';
import { TargetSchema } from '@cg/contracts/ids';
import { OpViewSchema, type AnyOpView } from '@cg/contracts/ops';
import type { FeatureSlice } from '@cg/contracts/features/types';
import { HOST_PLATFORM, type HostKind } from '@cg/contracts/hosts';
import { hashOfRoute } from '@cg/core/application/pages';
import { LOCAL_KEYS, SESSION_KEYS, SYSTEM_LOCALE_REWRITE, resolveHubError, rewritesSystemLocale, storageBudgetOf } from '@cg/core/domain';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { resolveLocale } from '@cg/core/domain/i18n/live';
import { logEvent, logStart } from '@cg/core/domain/logging';
import { currentPersona, flagsOnSomePage, followedPersonas, type OpsEnvironment, type PersonaChoice } from '@cg/core/domain/ops';
import { profileRequestOf, recapSaveAnswer } from '@cg/core/domain/recap';
import { composedWithOf, composedWithOfFeature } from '@cg/core/domain/send';
import {
  ActionTokens,
  NativeSendRegistrar,
  OpScheduler,
  SendAttributionReporter,
  ActivityBeat,
  TalkingMarksService,
  type TalkingPage,
  RecapProfileSaver,
  WsTapSwitch,
  createConsentState,
  createPresence,
  createReadinessBarrier,
  createResultsStore,
  createSettingsOwner,
  createSettingsExtOwner,
  onInstalledPlan,
  settingsChangePlan,
  settingsRequestHandlers,
  type ServiceAnswer,
  type SettingsOwner,
  type SettingsPatchRequest,
} from '@cg/core/services';
import { DiagnosticsService, SpendService, advancedAccountInfo, clearDebugData, type DiagnosticsFacts } from '@cg/core/services/diagnostics';
import { createGreetReminder, soundRequestHandlers } from '@cg/core/services/sound';
import { createSiteAccess } from '@cg/core/services/site-access';
import { createNetworkSession, legacyAccount } from '@cg/core/services/network-session';
import { HEALTH_TICK_MS } from '@cg/core/services/telemetry';
import { readVoiceOpView } from '@cg/core/services/voice';
import { ChatExtensionHub, VENDORED_CONTRACT_HASH, errorWireOf } from '@cg/hub';
import {
  createAlarms,
  createPermissionBundle,
  createScriptTabs,
  syncDynamicScripts,
  observeWebRequests,
  openBoundedStore,
  createAudioPlayer,
  createBackgroundRpc,
  createConsent,
  createExtensionPages,
  createHostPermissions,
  createKeyValueStore,
  createLifecycle,
  createTabFocus,
  defaultBrowser,
  readClientEnv,
  syncDynamicMainScript,
  type AudioPlayer,
  type BrowserApi,
  type ClientEnv,
  type DynamicMainScriptSpec,
  type InstalledDetails,
  type KeyValueStore,
  type RpcResult,
} from '@cg/platform';

import { CHATSPACE_MATCHES, CHATSPACE_STAND_MATCHES, RUNTIME_HOSTS, type PerHost, type RuntimeHostKind } from '../hosts/runtime';
import { createAccountSwitch, humanSendObservable, incomingFactUsable } from './background/account-switch';
import { ComposedWithMemory, attributionTarget } from './background/attribution';
import { hubAddressRefusal, quietFetch } from './background/hub-address';
import { hubDataHandlers, type PageLookup } from './background/hub-data';
import { type BackgroundKit, type HostRequestType, type KitSender, type SiteTabsPort, type VerifiedTabMessage } from './background/host-module';
import { createHostModules, type HostModuleSpec } from './background/host-modules';
import { LIFECYCLE_EVENT_WAIT_MS, STARTS_KEY, earlierStartsOf, startReasonOf } from './background/lifecycle';
import { createBackgroundLogging } from './background/logging';
import { readPassJournals, startPassJournal } from './background/pass-journal';
import { opsStoreOver } from './background/ops-store';
import { CLOCK, IDS, TIMERS, eventSinkOf, hubLogOf, keyOf, logSinkOf, serviceLogOf, throwingStoreOf } from './background/ports';
import { personaPatchRefusal } from './background/settings-guard';
import { createBackgroundSound } from './background/sound';
import { createTabAccountsGate } from './background/tab-accounts';
import { pickCommandTab } from './background/tab-command';
import { createBackgroundTelemetry } from './background/telemetry';
import { tokenRefusal } from './background/token-gate';
import { createBackgroundVoice } from './background/voice';
import { EGRESS_PROBE_KEY, fireEgressProbe } from './egress-probe';
import { featuresOf as coreFeaturesOf } from './features';
import { OPTIONAL_HOST, SESSION_KEY, RELOAD_KEY, SITE_TYPE_PREFIX, FANSLY_RELAY_PAGE, siteMatches, permissionSet, apiMatches, scriptSet, pageAddress, apiAddress, routeFamily } from './site-access';

/** id of the dynamically registered WS tap (§6.8 п. 10). */
export const WS_TAP_SCRIPT_ID = 'cg-ws-tap';

export function wsTapSpec(): DynamicMainScriptSpec {
  // Release taps ChatSpace. A test build taps wherever its content scripts run — ChatSpace itself and its
  // loopback stand (`127.0.0.1`, its manifest matches both; never the Fansly stand's `localhost`): the owner's dev profile (`pnpm dev`, X9) is a test build on
  // the real ChatSpace, and without the tap there it could exercise neither the incoming facts nor X8. Both
  // only while the bootstrap flag `wsTap` is on. The compile-time constant keeps loopback hosts out of the
  // release bundle. The file is ChatSpace's dynamic MAIN script of the host registry (test/hosts.test.ts pins it).
  return { id: WS_TAP_SCRIPT_ID, js: ['chatspace-ws.js'], matches: __CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...CHATSPACE_STAND_MATCHES] : CHATSPACE_MATCHES };
}

/**
 * The sites' background chunks (docs/project-unite/architecture.md §3.3): the file of each — the host registry's
 * `background.file` (test/hosts.test.ts pins it) — and the storage keys whose presence means the site has unfinished
 * work, so its module starts with the event page. ChatSpace: an X8 journal (open attempts hold their fans and owe the
 * hub their reports), a tripped fuse («Статус» shows it), greeting leases.
 */
export const HOST_MODULE_SPECS = {
  'fansly-web': { chunk: 'bg/fansly.js', pending: { local: [], session: [] }, passJournalDb: 'cg-fansly-newcomers' },
  chatspace: { chunk: 'bg/chatspace.js', pending: { local: [STORAGE_KEYS.sendJournal, LOCAL_KEYS.sendFuse], session: [SESSION_KEYS.greetingLeases] } },
} as const satisfies PerHost<HostModuleSpec>;

/** The requests each site's module answers: the core checked the sender, its session and the payload, and routes them. */
export const HOST_REQUESTS = {
  'fansly-web': [],
  chatspace: ['send.begin', 'send.status', 'send.list', 'send.report', 'send.fuse', 'send.fuseState', 'send.fuseReset', 'newcomers.claim'],
} as const satisfies PerHost<readonly HostRequestType[]>;

/**
 * storage.local, test builds only: a site's kind — the next load of that site's chunk asks for a file that is not
 * there (bg/<site>.missing.js), as a broken install would. The e2e's probe of a failed import (background-chunks).
 */
export const HOST_MODULE_FAULT_KEY = 'dev.hostModuleFault';

/** Alarms survive the event page unloading; they are armed only while a ChatSpace tab is registered. */
const ALARMS = {
  /** Expired operation results leave storage.session (30 minutes, §7). */
  resultsSweep: { name: 'cg.results.sweep', periodMs: 10 * 60_000 },
  /** Bootstrap flags are owner kill switches: read again by its ttl even while the page slept (§8.3). */
  bootstrap: { name: 'cg.hub.bootstrap', periodMs: 5 * 60_000 },
  /** What waits in the telemetry queue goes out although its timers died with the page (§9.6). */
  telemetry: { name: 'cg.telemetry.flush', periodMs: 5 * 60_000 },
  /** The `client_health` window: 15 minutes (§9.6). */
  health: { name: 'cg.telemetry.health', periodMs: HEALTH_TICK_MS },
  /** Chat Memory week 1: the beat of the hub's shift, once a minute while a tab is open. */
  activity: { name: 'cg.activity.beat', periodMs: ACTIVITY_LIMITS.beatMs },
} as const;

/**
 * storage.local, test builds only (`pnpm dev` runs one): `pageLabel → creator id` for the compat
 * bootstrap of a hub without `client/bootstrap` (docs/hub-layer.md). Never guessed by name.
 */
const DEV_COMPAT_PAGES_KEY = 'dev.compatPageAccounts';

/**
 * The platforms the sites of this build serve (the hosts' runtime table): the compat bootstrap's page of another
 * platform is `platform_unsupported` (R20 F9b — the hub layer names no platform itself).
 */
function compatPlatforms(): readonly string[] {
  return (Object.keys(RUNTIME_HOSTS) as RuntimeHostKind[]).map((kind) => HOST_PLATFORM[kind]);
}

/** Replaces the entries of the live map with the stored ones (strings only; anything else is dropped). */
function readCompatPages(target: Record<string, string>, stored: unknown): void {
  for (const key of Object.keys(target)) delete target[key];
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return;
  for (const [pageLabel, account] of Object.entries(stored)) if (typeof account === 'string' && account !== '') target[pageLabel] = account;
}
/** storage.local: the local AI spend journal of debug mode (numbers only, §9.3). */
const SPEND_KEY = 'debug.spend';
/** storage.local: this install's id for the hub's custody (`instanceId`, H-7). */
const INSTANCE_KEY = 'install.instanceId';
/** storage.local: when this version replaced an older one, and which (`runtime.onInstalled`, reason `update`; UP-009). */
export const UPDATED_KEY = 'install.updated';

/** The stored update record, when it is one. */
function updateRecordOf(value: unknown): { readonly at: string; readonly from: string } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { at, from } = value as { readonly at?: unknown; readonly from?: unknown };
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) && typeof from === 'string' && from !== '' && from.length <= 32 ? { at, from } : null;
}

/**
 * A status surface that merely reads the diagnostics (the popup opened, «Статус» polling its live state every
 * 10 s) asks the hub's `health` again only when the last read is older than this. Not every poll: a settings tab
 * left open on «Статус» would otherwise ask the hub six times a minute for as long as it stays open. «Проверить
 * всё» and opening the settings read the health themselves, at once (`catalog.get` with `force`).
 */
export const HEALTH_FRESH_MS = 60_000;
/** How long `diagnostics.get` waits for that read before it answers with what is known. */
const HEALTH_WAIT_MS = 5_000;

const ok = <T>(payload: T): RpcResult<T> => ({ ok: true, payload });
const fail = (code: CgCode, detail?: string): { readonly ok: false; readonly error: CgErrorWire } => ({ ok: false, error: detail === undefined ? { code } : { code, detail } });

/** Whatever a facade call rejected with, as a wire error; never a hub message text. */
function wireOf(error: unknown): CgErrorWire {
  return errorWireOf(error) ?? { code: 'CG-HUB-UNKNOWN' };
}

async function hubCall<T>(run: () => Promise<T>): Promise<RpcResult<T>> {
  try {
    return ok(await run());
  } catch (error) {
    return { ok: false, error: wireOf(error) };
  }
}

/** The hub's storage port with a tap on the sign-in record: the redactor learns the live token, nothing else sees it (LG-003). */
function withTokenTap(store: KeyValueStore, onToken: (token: string) => void): Pick<KeyValueStore, 'get' | 'set' | 'remove'> {
  const key = STORAGE_KEYS.authToken;
  const feed = (value: unknown): void => {
    const token = typeof value === 'object' && value !== null ? (value as { readonly token?: unknown }).token : undefined;
    if (typeof token === 'string') onToken(token);
  };
  return {
    async get(keys) {
      const read = await store.get(keys);
      if (read.ok && keys.includes(key)) feed(read.value[key]);
      return read;
    },
    set(items) {
      if (Object.prototype.hasOwnProperty.call(items, key)) feed(items[key]);
      return store.set(items);
    },
    remove: (keys) => store.remove(keys),
  };
}

/**
 * What the composition root takes from outside. The extension passes nothing: the real `browser` and the
 * real `fetch`. A test hands in a fake browser context and a fake hub, one pair per instance of the event page.
 */
export interface BackgroundDeps {
  readonly api?: BrowserApi;
  readonly fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  /** The sound player (the event page's AudioContext otherwise): a test hears what would have rung. */
  readonly audio?: Pick<AudioPlayer, 'prepare' | 'play' | 'stats'>;
  /** Loads a site's background chunk by its address (`import(url)` otherwise): a test hands in the module source. */
  readonly loadHostModule?: (url: string) => Promise<unknown>;
}

export function composeBackground(deps: BackgroundDeps = {}): void {
  const testBuild = __CG_TEST_HOSTS__;

  // ── platform ───────────────────────────────────────────────────────────────
  const api = deps.api ?? defaultBrowser();
  const hubFetch = deps.fetch ?? ((input: string, init?: RequestInit): Promise<Response> => fetch(input, init));
  const local = createKeyValueStore('local', { api, budgetOf: storageBudgetOf });
  const session = createKeyValueStore('session', { api, budgetOf: storageBudgetOf });
  const alarms = createAlarms(api);
  /** Our own pages in a tab: the one settings tab is focused and pointed at a section, else opened (ST-006). */
  const extensionPages = createExtensionPages(api);
  /** When this instance of the event page began. */
  const started = Date.now();
  let env: ClientEnv = { extensionVersion: '0.0.0', browser: 'firefox', browserMajor: null, os: 'other' };

  // The hub exists once the settings are read (it takes its address from them).
  let hubInstance: ChatExtensionHub | null = null;
  const hub = (): ChatExtensionHub => {
    if (hubInstance === null) throw new Error('the hub layer has not started');
    return hubInstance;
  };

  // ── settings and logs ──────────────────────────────────────────────────────
  let previousSettings: SettingsV1 | null = null;
  // The settings owner needs the logger and the logger reads debug mode from the settings: the owner arrives second.
  let settingsOwner: SettingsOwner | null = null;
  const debugEnabled = (): boolean => settingsOwner?.current().debug.enabled ?? false;
  const logging = createBackgroundLogging({ session, local, debugEnabled, ctx: () => (hubInstance?.session() ? { session: hubInstance.session()?.epoch ?? 0 } : undefined) });
  const { logger } = logging;
  const serviceLog = serviceLogOf(logger);
  const coreLog = logSinkOf(logger);
  const passJournals = new Map<HostKind, NonNullable<ReturnType<typeof startPassJournal>>>();
  for (const [host, spec] of Object.entries(HOST_MODULE_SPECS) as [HostKind, HostModuleSpec][]) {
    if (spec.passJournalDb === undefined) continue;
    const journal = startPassJournal({ storage: { local, session, localKeys: throwingStoreOf(local), sessionKeys: throwingStoreOf(session), journal: openBoundedStore }, clock: CLOCK }, spec.passJournalDb);
    if (journal !== null) passJournals.set(host, journal);
  }
  const clearPassJournals = (): Promise<void[]> => Promise.all([...passJournals.values()].map((journal) => journal.clear()));

  const extSettings = createSettingsExtOwner({ local, session, log: serviceLog });
  const accessFailed = (): void => serviceLog({ level: 'warn', scope: 'bg.site-access', msg: 'site access or observation unavailable' });
  let observations: Promise<void> = Promise.resolve();
  const networkSession = createNetworkSession({
    storage: session, key: SESSION_KEY, now: () => Date.now(),
    pageRequest: (fact) => fact.tabId >= 0 && fact.frameId === 0 && pageAddress(fact.documentUrl) && pageAddress(fact.originUrl),
    apiRequest: apiAddress, ownOrigin: api.runtime.getURL(''),
    requiredHeaders: ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id'],
    materialHeaders: ['authorization', 'fansly-client-id', 'fansly-session-id'],
    requestIdHeader: 'x-cg-request-id',
    settleObservations: async () => {
      let seen: Promise<void>;
      do { seen = observations; await seen; } while (seen !== observations);
    },
    checkHeader: 'fansly-client-check', accountOf: legacyAccount, familyOf: routeFamily,
  });
  const observation = observeWebRequests(apiMatches(), (fact) => {
    observations = observations.then(async () => { await siteAccess.idle(); await networkSession.accept(fact); }).catch(accessFailed);
  }, api);
  const scriptTabs = createScriptTabs(siteMatches(), 'fansly-notice.js', api);
  scriptTabs.onRemoved((tab) => { void networkSession.forget(tab).catch(accessFailed); });

  const barrier = createReadinessBarrier({ timers: TIMERS, log: serviceLog });

  /** A refused message is counted by the RPC; the log hears each kind on its 1st, 10th, 100th… occurrence. */
  const rejects = new Map<string, number>();
  /** Which tabs have said what accounts they show: a request about a page waits for that (`pageOf`). */
  const tabAccounts = createTabAccountsGate({ setTimer: (fn, ms) => TIMERS.set(fn, ms) });
  /** The host contract as each tab last reported it (`health.report`), for diagnostics. */
  const hostReports = new Map<string, HostContractReport | null>();
  const pageReports = new Map<string, PageDiagnostics>();
  let accessSnapshot: SiteAccessState | undefined;
  let requestMode: 'background' | 'relay' | undefined;
  const freshness = new FreshnessDayStore(() => Date.now(), keyOf(session, 'diagnostics.freshnessDay'));
  const freshnessReady = freshness.start();
  /** When a status surface last asked for the hub's health (epoch ms; 0 — ask at the next read). */
  let healthAskedAt = 0;

  const rpc = createBackgroundRpc({
    api,
    // ChatSpace's loopback stand counts as ChatSpace in a test build only (the constant keeps it out of release).
    tabHosts: { chatspace: __CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...CHATSPACE_STAND_MATCHES] : CHATSPACE_MATCHES, 'fansly-web': siteMatches() } satisfies PerHost<readonly string[]>,
    // R20 P9c: the relay frame of «Fansly через вкладку» (`cg-relay`), from the site's row of the host table.
    relayPages: { [OPTIONAL_HOST]: FANSLY_RELAY_PAGE },
    ready: barrier.ready,
    contractsVersion: CONTRACTS_VERSION,
    testBuild,
    allowTab: siteOn,
    // R20 P14b1: the settings page speaks to Fansly's module (its part of `settings.ext`, its sessions and tabs) while
    // Fansly is on; the module comes up for it. Off — the page hears so at once.
    pageSite: {
      hostOf: (type) => (type.startsWith(SITE_TYPE_PREFIX) ? OPTIONAL_HOST : null),
      active: (host) => host === OPTIONAL_HOST && siteAccess.active(),
      async open(host) {
        await accessReady.catch(() => undefined);
        if (host !== OPTIONAL_HOST || !siteAccess.active()) return false;
        await barrier.ready;
        void hostModules.ensure(host).catch(accessFailed);
        return true;
      },
    },
    onTabRegistered(info) {
      presence.tabRegistered(info.tabSessionId);
      armAlarms();
      sound.sync();
      // The site's own services come up with its first tab (its requests wait for them).
      if (info.request.host !== OPTIONAL_HOST || siteAccess.active()) void hostModules.ensure(info.request.host).then(() => sound.arbiter.rememberAccounts());
      if (info.request.host === OPTIONAL_HOST) {
        void siteAccess.registered(info.tabId).catch(accessFailed);
        void networkSession.register(info.tabId).catch(accessFailed);
      }
      logger.info('bg.tabs', 'tab registered', { fields: { late: info.request.lateInjection, contractsVersion: info.request.contractsVersion }, ctx: { tabSessionId: info.tabSessionId } });
    },
    onTabGone(info) {
      // BG-006: a closed tab only detaches its surfaces; its generations go on.
      presence.tabGone(info.tabSessionId);
      tabAccounts.gone(info.tabSessionId);
      tokens.dropTab(info.tabSessionId);
      scheduler.detachTab(info.tabSessionId);
      hostReports.delete(info.tabSessionId);
      pageReports.delete(info.tabSessionId);
      // Its next facts are a first snapshot again; without a tab nobody is asked about subscribers.
      sound.arbiter.tabGone(info.tabSessionId);
      sound.sync();
    },
    onReject(reason, facts) {
      const key = `${reason}|${facts.type ?? ''}|${facts.sender}`;
      const count = (rejects.get(key) ?? 0) + 1;
      rejects.set(key, count);
      if (/^10*$/.test(String(count))) logger.warn('bg.rpc', 'message refused', { fields: { reason, type: facts.type, sender: facts.sender, count } });
    },
  });
  const events = eventSinkOf((type, payload, target) => rpc.emit(type, payload, target));

  const settings: SettingsOwner = createSettingsOwner({
    local,
    session,
    log: serviceLog,
    onChange(state) {
      rpc.emit('settings.changed', state);
      const before = previousSettings;
      previousSettings = state.settings;
      // A new hub address or another persona of a page cancels the operations bound to the old one (§7 «Отмена»).
      for (const change of settingsChangePlan(before, state.settings).environment) scheduler.environmentChanged(change);
      if (before === null || hubInstance === null) return;
      if (before.hub.baseUrl !== state.settings.hub.baseUrl) {
        void hubInstance.notifyHubOriginChanged();
        // What the status knew was the old hub's health: the next status read asks the new one at once.
        healthAskedAt = 0;
      }
      if (before.debug.enabled !== state.settings.debug.enabled) {
        void hubInstance.notifyDebugChanged();
        if (!state.settings.debug.enabled) clearDebug();
      }
    },
  });

  settingsOwner = settings;
  /**
   * The settings are read. A store written by a newer build (a rollback of the extension) is read-only, and
   * read: its personas, its sound and its debug switch are the person's own, so generations, the sound and the
   * status go on as before — only a write is refused (CG-STORAGE-VERSION, RB-012). Only settings that could not
   * be read at all stop a generation (CG-STORAGE-READ).
   */
  const settingsRead = (): boolean => settings.mode() === 'ok' || settings.mode() === 'newer';

  // ── R07 stores ─────────────────────────────────────────────────────────────
  const results = createResultsStore<AnyOpView>({ session, log: serviceLog, readView: async (value) => {
    const common = OpViewSchema.safeParse(value);
    if (common.success) return common.data;
    // 1.47.0: the voice script is every site's, its view the core's own.
    const voiceView = readVoiceOpView(value);
    if (voiceView !== null) return voiceView;
    const target = TargetSchema.safeParse((value as { target?: unknown } | null)?.target);
    if (!target.success || !(await moduleUnderSameSignIn(target.data.binding.host))) return null;
    return hostModules.running(target.data.binding.host)?.operations?.readView(value) ?? null;
  } });
  const presence = createPresence({ local, log: serviceLog });
  const consentPort = createConsent(api);
  const consent = createConsentState({ port: consentPort, log: serviceLog });

  // ── R10: tokens, operations ────────────────────────────────────────────────
  const tokens = new ActionTokens(CLOCK, IDS);

  /** What the facade read from a failure, kept for the R10 services (they resolve a failure by its object). */
  const readings = new WeakMap<object, HubErrorResolution>();
  /**
   * A facade call for an R10 service. The facade's own reading of a failure
   * goes with it (it knows the one 503 retry of the stream is spent), and a
   * refusal of the hub layer itself (HubCheckError: a flag off, a page not
   * granted, a foreign persona…) becomes a failure the services can carry,
   * with its own code — nothing reached the hub, so nothing may be «unknown».
   */
  async function forCore<T>(route: HubRouteKey, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isHubCallError(error)) {
        if (error.resolution !== undefined) readings.set(error.failure, error.resolution);
        throw error;
      }
      if (isHubCheckError(error)) {
        const failure: HubFailure = { kind: 'http', status: 409, error: null, reason: null, retryAfterMs: null };
        readings.set(failure, { code: error.code, disposition: 'show', retryAt: null, httpStatus: null });
        throw Object.assign(new Error(`${route}: ${error.check}`), { name: 'HubCallError', route, failure, epoch: error.epoch });
      }
      throw error;
    }
  }
  const resolve: ResolveHubError = (failure, context) => readings.get(failure) ?? resolveHubError(failure, context);

  /**
   * The bootstrap as the operations read it: the hub's own. A request announces to the hub only the stream
   * capabilities this bootstrap declares (`context-v1`, `split-all-v1`), and the vendored SDK carries all of
   * them. A hub older than the SDK simply declares fewer: what depends on a missing one reads «хаб не готов»
   * (`hub_not_ready`) — nothing is announced that the hub did not offer.
   */
  const bootstrapForOps = (): Bootstrap | null => hubInstance?.cachedBootstrap()?.bootstrap ?? null;

  /** The persona choices of the settings belong to whoever is signed in now (they hold pageIds of one hub and user). */
  const personasOurs = (current: SettingsV1): boolean => {
    const signedIn = hubInstance?.session() ?? null;
    const scope = current.personas.scope;
    return signedIn !== null && scope !== null && scope.hubOrigin === signedIn.hubOrigin && scope.userId === signedIn.userId;
  };
  /**
   * The scope of the persona choices is written at the sign-in, and again — when it is not the signed-in person's —
   * at the start of an event page with a sign-in and before a persona choice: one write that failed at the sign-in
   * (or a broken scope the repair of the settings dropped) would refuse every generation (CG-PERSONA-UNASSIGNED)
   * until a sign-out, while the pages show the choice as made. The same scope is no write. The error: the scope is
   * not the person's, and a choice made now would not be theirs either.
   */
  const scopePersonas = async (signedIn: { readonly hubOrigin: string; readonly userId: number } | null = hubInstance?.session() ?? null): Promise<CgErrorWire | null> => {
    if (signedIn === null) return null;
    const scope = settings.current().personas.scope;
    if (scope !== null && scope.hubOrigin === signedIn.hubOrigin && scope.userId === signedIn.userId) return null;
    const saved = await settings.setPersonaScope({ hubOrigin: signedIn.hubOrigin, userId: signedIn.userId });
    if (saved.ok) return null;
    logger.warn('bg.personas', 'persona scope not saved', { code: saved.error.code });
    return saved.error;
  };

  const environment = (): OpsEnvironment => {
    const current = settings.current();
    const ours = personasOurs(current);
    return {
      session: hubInstance?.session() ?? null,
      bootstrap: bootstrapForOps(),
      persona: (pageId) => (ours ? (current.personas.byPageId[String(pageId)] ?? null) : null),
      debug: current.debug.enabled,
      settingsLoaded: settingsRead(),
      // What a feature needs on the chat's site: the site's slice of the feature manifest (./features; Fansly's — from
      // its running module, R20 P7i).
      features: (host) => featuresOf(host),
    };
  };

  /**
   * The person chooses a persona, not one version of it. The owner edits a persona on the hub: its key stays, its
   * definition changes — and the choice of every page follows here as soon as the catalog says so. Otherwise each
   * generation of such a page would name the old definition and the hub would refuse it for ever
   * (CG-PERSONA-CHANGED, «Ещё раз» included). A store that cannot be written keeps the old one: the next
   * refusal follows the catalog for that request alone (`personaNow`). The patch is made when its turn among the
   * writes comes: a persona the person chose meanwhile is never put back.
   */
  const followPersonas = async (catalog: PersonaCatalog): Promise<void> => {
    if (settings.mode() !== 'ok') return;
    let pages = 0;
    const saved = await settings.patchWith((current) => {
      const followed = personasOurs(current) ? followedPersonas(current.personas.byPageId, catalog) : null;
      pages = followed === null ? 0 : Object.keys(followed).length;
      return followed === null ? null : { personas: { byPageId: followed } };
    }, { restricted: false });
    if (!saved.ok) logger.warn('bg.personas', 'persona definition not followed', { code: saved.error.code });
    else if (pages > 0) logger.info('bg.personas', 'persona definition followed', { fields: { pages } });
  };
  /** The page's persona as the hub has it now: the catalog read again (the refusal already asked for it), the choice following it. */
  const personaNow = async (pageId: number): Promise<PersonaChoice | null> => {
    const catalog = await hub().catalog();
    await followPersonas(catalog);
    const choice = environment().persona(pageId);
    return choice === null ? null : currentPersona(choice, catalog);
  };

  const saver = new RecapProfileSaver({
    clock: CLOCK,
    ids: IDS,
    hub: { profileFromGeneration: (request) => forCore('clientFanProfileFromGeneration', () => hub().profileFromGeneration(request)) },
    events,
    tabOpen: (tabSessionId) => rpc.tabs().some((tab) => tab.tabSessionId === tabSessionId),
    log: coreLog,
  });

  // 1.47.0: voice notes — the sessions of the chats and their paid takes; the voice script runs in the scheduler below.
  const voice = createBackgroundVoice({
    hub,
    store: local,
    page: (pageId, sender) => pageOf(pageId, sender),
    pageLabel: (pageId) => hubInstance?.cachedBootstrap()?.bootstrap.pages.find((page) => page.pageId === pageId)?.pageLabel ?? null,
    tokens,
    scheduler: { start: (tab, start) => scheduler.start(tab, start), siteView: (opId, host) => scheduler.siteView(opId, host) },
    siteActive: (tabSessionId) => siteActive(hostOfTab(tabSessionId)),
    owner: () => {
      const signedIn = hubInstance?.session() ?? null;
      return signedIn === null ? null : { hubOrigin: signedIn.hubOrigin, userId: signedIn.userId };
    },
    emit: (change) => rpc.emit('voice.changed', change),
    errorOf: wireOf,
    ids: IDS,
    log: serviceLog,
  });

  const scheduler: OpScheduler = new OpScheduler({
    clock: CLOCK,
    ids: IDS,
    hub: { stream: (request, sink, signal) => forCore('aiFeatureStream', () => hub().stream(request, sink, signal)) },
    resolve,
    environment,
    tokens,
    events,
    store: opsStoreOver(results, session),
    presence: (tabSessionId) => presence.tabs().find((tab) => tab.tabSessionId === tabSessionId) ?? null,
    log: coreLog,
    // R11: how each feature's start becomes the hub's request and its answer a result ([NEXT] parts, Hi variants,
    // the Review frame, Recap blocks, Coach drafts).
    drivers: AI_FEATURE_DRIVERS,
    // A site's own operations come with its running module (Fansly's «Заполнить из чата»); the voice script is every
    // site's (1.47.0), so a site without a module of operations still has it.
    siteOps: async (host) => {
      if (!(await moduleUnderSameSignIn(host))) return null;
      return voice.withVoice(host, hostModules.running(host)?.operations ?? null);
    },
    // «Нет связи» vs «хаб не ответил вовремя» at a deadline: what the browser itself says about the connection.
    online: () => navigator.onLine,
    personaNow,
    hooks: {
      settled(view, start, ownerTab) {
        if (view.target.chat.host !== OPTIONAL_HOST) return;
        const counts = freshnessCounts(start.proof, view.servedContext);
        const report = ownerTab === null ? null : hostReports.get(ownerTab);
        void freshnessReady.then(() => freshness.record(view.target.chat.host, report?.build ?? null, view.feature, counts));
        // The existing consent gate in HealthReporter is the only path to the hub.
        telemetry.health.onHost(view.target.chat.host, report ?? null);
        for (const [name, count] of Object.entries(counts)) if (count > 0) telemetry.health.count(view.target.chat.host, `freshness.${view.feature}.${name}`, count);
      },
      // The facade refreshes its catalog itself when it reads such a failure.
      refreshBootstrap: () => void hubInstance?.bootstrap({ force: true }).catch(() => undefined),
      recapDone: (view, ownerTab) => saver.save(view, ownerTab),
      promptToken: (opId) => hubInstance?.promptEchoTicket(opId)?.token ?? null,
      debugInput: (opId) => hubInstance?.promptEchoTicket(opId)?.token ?? null,
      // The local spend journal exists only in debug mode (§9.3, DB-022): numbers of this browser, nothing else.
      usage: (feature, usage) => {
        if (debugEnabled()) spend.recordUsage(feature, usage, Date.now());
      },
    },
  });

  let instanceId = IDS.uuid();

  /** Who is signed in, as the things that belong to a person are marked. */
  const ownerOf = (signedIn: { readonly hubOrigin: string; readonly userId: number } | null): string | null => (signedIn === null ? null : `${signedIn.hubOrigin}|${signedIn.userId}`);

  // A part of a preview or of a «Новые» card the person sent from ChatSpace's own composer (§6.6): the hub is
  // told, so the greeting counts for everyone and the part is never offered for a second send (H-7). What the
  // hub has not answered is owed and journaled (storage.local, ids only): the next instance of the event page
  // and the next word of the hub deliver it again, with the same attempt id.
  const nativeSends = new NativeSendRegistrar({
    clock: CLOCK,
    ids: IDS,
    hub: { claim: (op) => hub().claim(op) },
    instanceId: () => instanceId,
    owner: () => ownerOf(hubInstance?.session() ?? null),
    store: throwingStoreOf(local),
    log: coreLog,
  });

  // Who sent each message (decision X48): every send of the person that the page's own response named — in the
  // composer (`attribution.report` of a tab) or from a preview (`kit.attributions` of the site's module) — goes to the
  // hub under their sign-in. What the hub has not answered is owed and journaled (storage.local, ids only): the next
  // instance of the event page and the next word of the hub deliver it again; the hub takes a repeat as `duplicate`.
  /** Chat Memory week 1: the button behind a message, for the who-sent fact of the same send. */
  const composed = new ComposedWithMemory(CLOCK);
  const attributions = new SendAttributionReporter({
    clock: CLOCK,
    hub: { sendAttributions: (request) => hub().sendAttributions(request) },
    owner: () => ownerOf(hubInstance?.session() ?? null),
    store: throwingStoreOf(local),
    log: coreLog,
  });
  /** The page a host account of this browser is bound to now; null — it cannot be told. */
  const boundPageOf = (host: HostKind, hostAccountId: string): number | null => {
    const seen = presence.seenAccounts().find((entry) => entry.account.host === host && entry.account.hostAccountId === hostAccountId);
    const resolution = seen === undefined ? null : (hubInstance?.resolveBinding(seen.account) ?? null);
    return resolution?.state === 'bound' ? resolution.binding.pageId : null;
  };
  // Chat Memory week 1: the beat of the hub's shift (core/services/activity-beat.ts) — every bound page of the open tabs
  // and the person's last input there, once a minute; `closed` when the last such tab goes or the person signs out.
  const pageOfAccount = (key: string | null): { readonly pageId: number; readonly pageLabel: string } | null => {
    const cut = key === null ? -1 : key.indexOf(':');
    if (key === null || cut < 0) return null;
    const host = key.slice(0, cut) as HostKind;
    const pageId = HOST_PLATFORM[host] === undefined ? null : boundPageOf(host, key.slice(cut + 1));
    const page = pageId === null ? undefined : hubInstance?.cachedBootstrap()?.bootstrap.pages.find((candidate) => candidate.pageId === pageId);
    return page === undefined ? null : { pageId: page.pageId, pageLabel: page.pageLabel };
  };
  const pageLabelOfAccount = (key: string | null): string | null => pageOfAccount(key)?.pageLabel ?? null;
  const servesNow = (capability: 'chatter-activity-v1' | 'in-conversation-v1'): boolean => {
    const bootstrap = hubInstance?.session() ? (hubInstance.cachedBootstrap()?.bootstrap ?? null) : null;
    return bootstrap !== null && hasCapability(bootstrap.capabilities, capability);
  };
  const activity = new ActivityBeat({
    clock: CLOCK,
    hub: () => hubInstance,
    enabled: () => servesNow('chatter-activity-v1'),
    instanceId: () => instanceId,
    tabs: () => presence.tabs().map((tab) => ({ pageLabel: pageLabelOfAccount(tab.routeAccount), lastInputAt: tab.lastInputAt })),
    log: coreLog,
  });
  // «В разговоре» (core/services/talking.ts): the hub's answer for every page an open tab shows, others only, to the tabs.
  const talkingPages = (): TalkingPage[] => {
    const pages = new Map<string, { readonly pageId: number; readonly accounts: Map<string, { host: string; hostAccountId: string }> }>();
    for (const tab of presence.tabs()) {
      for (const key of new Set([tab.routeAccount, ...tab.accounts])) {
        const page = pageOfAccount(key);
        if (key === null || page === null) continue;
        const cut = key.indexOf(':');
        const known = pages.get(page.pageLabel) ?? { pageId: page.pageId, accounts: new Map<string, { host: string; hostAccountId: string }>() };
        known.accounts.set(key, { host: key.slice(0, cut), hostAccountId: key.slice(cut + 1) });
        pages.set(page.pageLabel, known);
      }
    }
    return [...pages.entries()].map(([pageLabel, page]) => ({ pageLabel, pageId: page.pageId, accounts: [...page.accounts.values()] }));
  };
  const talking = new TalkingMarksService({
    clock: CLOCK,
    hub: () => hubInstance,
    enabled: () => servesNow('in-conversation-v1'),
    pages: talkingPages,
    emit: (marks) => rpc.emit('talk.changed', marks),
    log: coreLog,
  });
  presence.onChange(() => {
    void activity.tabsChanged();
    talking.tabsChanged();
  });
  /** One send for the hub's record (background/attribution.ts); the reason when there is nothing to owe. */
  const attribute = (
    host: HostKind,
    pageId: number | null,
    fact: {
      readonly platformMessageId: string;
      readonly fanRef: string;
      readonly observedAt: string;
      readonly priced: boolean;
      readonly withMedia: boolean;
      readonly conversationRef?: string;
      readonly composedWith?: SendAttributionComposedWith;
      readonly edited?: boolean;
    },
  ): { readonly queued: boolean; readonly reason?: string } => {
    const target = attributionTarget(host, pageId, hubInstance?.cachedBootstrap()?.bootstrap ?? null, featuresOf);
    const outcome = target.ok ? attributions.report({ pageLabel: target.pageLabel, source: target.source, ...fact }) : null;
    const verdict = !target.ok ? { queued: false, reason: target.reason } : outcome === 'signed-out' ? { queued: false, reason: 'signed_out' } : outcome === 'invalid' ? { queued: false, reason: 'invalid' } : { queued: true };
    if (!verdict.queued) logger.info('bg.attribution', 'send not attributed', { fields: { reason: verdict.reason ?? null } });
    return verdict;
  };

  // ── owner switches for what has no page of its own ─────────────────────────
  // An owner switch as it stands for a host account (background/account-switch.ts): the feature of the page the
  // account is bound to; only an account the hub definitely binds to no page follows the owner's `"*"` value;
  // an account whose binding cannot be told fails closed. null — no bootstrap.
  const accountFlag = createAccountSwitch({
    bootstrap: () => hubInstance?.cachedBootstrap()?.bootstrap ?? null,
    seenAccounts: () => presence.seenAccounts(),
    resolveBinding: (account) => hubInstance?.resolveBinding(account) ?? { state: 'signed-out' },
  });

  // ── sound ──────────────────────────────────────────────────────────────────
  // The one player of the extension (§9.8; its AudioContext is created with the first tone) under R17's
  // one arbiter: a fan's message from any tab, a new subscriber from «Новые».
  const audio = deps.audio ?? createAudioPlayer();
  const hostPermissions = createHostPermissions(api);
  /** Where the content scripts of a host kind run: without the permission nothing of ours runs there. */
  const hostOrigins: Readonly<Record<string, readonly string[]>> = {
    'fansly-web': siteMatches().map((pattern) => new URL(pattern.replace(/\*$/, '')).origin),
    chatspace: (__CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...CHATSPACE_STAND_MATCHES] : CHATSPACE_MATCHES).map((pattern) => new URL(pattern.replace(/\*$/, '')).origin),
  } satisfies PerHost<readonly string[]>;
  // 2026-10-24: a fan of «Новые» nobody greeted ten minutes after subscribing — a toast with «Hi» in the tab of their creator.
  const greetings = createGreetReminder({
    ids: IDS,
    presence,
    events,
    enabled: () => (hubInstance?.cachedBootstrap() ?? null) !== null,
    session: throwingStoreOf(session),
    log: coreLog,
  });
  const sound = createBackgroundSound({
    greetings,
    local: throwingStoreOf(local),
    stream: {
      policy: (host, accountId) => hostModules.running(host)?.sound?.(accountId) ?? null,
      listening: (tabSessionId, batch) => hostOfTab(tabSessionId) === batch.host && presence.tabs().some((tab) => tab.tabSessionId === tabSessionId && tab.routeAccount === hostAccountKeyOf(batch.host, batch.hostAccountId)),
      focused: (batch, conversationRef) => presence.tabs().some((tab) => tab.routeAccount === hostAccountKeyOf(batch.host, batch.hostAccountId) && tab.conversationRef === conversationRef && tab.visible && tab.focused),
    },
    clock: CLOCK,
    audio,
    presence,
    settings: () => (settingsRead() ? settings.current().sound : null),
    bootstrap: () => hubInstance?.cachedBootstrap()?.bootstrap ?? null,
    newcomersUsable: (pageLabel) => hubInstance?.flagState('newcomers', pageLabel).usable === true,
    accountFlag,
    hostPermission: async (host) => siteActive(host) && (await Promise.all((hostOrigins[host] ?? []).map((origin) => hostPermissions.has(origin)))).some(Boolean),
    read: (pageLabel, windowHours) => hub().audienceNew({ pageLabel, windowHours }),
    online: () => navigator.onLine,
    events,
    tabs: () => rpc.tabs().map((tab) => tab.tabSessionId),
    session: throwingStoreOf(session),
    log: coreLog,
  });

  // ── R18: telemetry, debug, diagnostics ─────────────────────────────────────
  const capabilities = (): readonly string[] => hubInstance?.cachedBootstrap()?.bootstrap.capabilities ?? [];
  const telemetry = createBackgroundTelemetry({
    local,
    session,
    logger,
    ingest: (list) => hub().ingest(list),
    binding() {
      const signedIn = hubInstance?.session() ?? null;
      return signedIn === null ? null : { hubOrigin: signedIn.hubOrigin, userId: signedIn.userId, epoch: signedIn.epoch };
    },
    consent: () => (consent.status() === 'unknown' ? null : consent.granted()),
    healthSupported: () => hasCapability(capabilities(), 'client-health-perf-v1'),
    // «This site's tab is open» (R20 F7): a site's windows are reported while one of its tabs is registered.
    hostOpen: (site) => rpc.tabs().some((tab) => tab.request.host === site),
    client: () => ({ version: env.extensionVersion, browserMajor: env.browserMajor ?? 0, os: env.os }),
    footprint: () => ({ cachesKB: Math.round(results.stats().bytes / 1024), logsKB: Math.round((logging.logs.stats().bytes + logging.countersBytes()) / 1024) }),
    // What is off for this install: the switches usable on none of its pages (never the top-level `"*"` flags).
    disabled() {
      const bootstrap = hubInstance?.cachedBootstrap()?.bootstrap ?? null;
      return bootstrap === null
        ? []
        : Object.entries(flagsOnSomePage(bootstrap))
            .filter(([, on]) => !on)
            .map(([flag]) => flag);
    },
  });
  const spend = new SpendService(keyOf(local, SPEND_KEY));

  // ── the sites' background modules (docs/project-unite/architecture.md §3.3) ──
  // The ports of the core a site's chunk is started with: one owner of each thing stays here.
  const kit: Omit<BackgroundKit, 'telemetry' | 'attributions'> = {
    settingsExt: extSettings,
    sound: { batch: async (tabSessionId, batch) => {
      await tabAccounts.known(tabSessionId);
      await sound.arbiter.handleBatch(tabSessionId, batch);
    } },
    hub: {
      // The facade is read at each call: it exists once the settings are read.
      facade: { claim: (op, check) => hub().claim(op, check), claimStatus: (pageLabel, fanRef) => hub().claimStatus(pageLabel, fanRef) },
      call: forCore,
      resolve,
      errorWire: wireOf,
      session: () => hubInstance?.session() ?? null,
      bootstrap: () => hubInstance?.cachedBootstrap()?.bootstrap ?? null,
      page: (pageId, sender) => pageOf(pageId, sender),
    },
    storage: { local, session, localKeys: throwingStoreOf(local), sessionKeys: throwingStoreOf(session), journal: openBoundedStore },
    clock: CLOCK,
    ids: IDS,
    log: { sink: coreLog, service: serviceLog },
    router: { events, tabs: () => rpc.tabs().map((tab) => tab.tabSessionId) },
    ops: { start: (tab, start) => scheduler.start(tab, start), siteView: (id, host) => scheduler.siteView(id, host), siteList: (tab, host, key) => scheduler.siteList(tab, host, key), cancel: (id) => scheduler.cancel(id), forSend: (opId) => scheduler.forSend(opId), view: (opId) => scheduler.view(opId), environment },
    tokens,
    install: { instanceId: () => instanceId, owner: () => ownerOf(hubInstance?.session() ?? null) },
    networkSession,
    nativeSends: { register: (view, part, platformMessageId) => nativeSends.register(view, part, platformMessageId) },
  };
  /** The kit of a site's module: what it counts goes to its site's `client_health` window (R20 F7). */
  const kitOf = (host: HostKind): BackgroundKit => ({
    ...kit,
    log: { ...kit.log, ...(passJournals.has(host) ? { passJournal: passJournals.get(host)! } : {}) },
    telemetry: { report: (kind, view, opId, position, proof) => telemetry.report(kind, view, opId, position, proof), countCode: (code) => telemetry.health.countCode(host, code) },
    // The site's own registry (`fansly.*`, R20 P13b): its module plugs it, the core keeps checking sender and envelope;
    // its events to the site's receivers, or one tab session — the tab or its relay frames (R20 P9c).
    site: { plug: (registry) => rpc.site({ ...registry, host }), emit: (type, payload, target) => rpc.emitSite(host, type, payload, target) },
    // R20 P14b1: `settings.ext` through its one owner; the site's tabs by its addresses and registrations, no `tabs` right.
    siteTabs: siteTabsOf(host),
    // R20 P14c: switched off or its rights taken back, the module's tabs finish what they started and begin nothing (FS-PERM-5).
    siteActive: () => siteActive(host),
    // 1.21.0 (X48): who sent a message the site's module proved — a preview's send the person clicked.
    // Chat Memory week 1: Fansly's sends of a person's click too («Новые», «Рассылка»), with their chat and button.
    attributions: {
      sent: ({ pageId, hostAccountId, platformMessageId, ...rest }) =>
        void attribute(host, pageId ?? (hostAccountId === undefined ? null : boundPageOf(host, hostAccountId)), { platformMessageId, observedAt: new Date(CLOCK.now()).toISOString(), ...rest }),
    },
  });
  /** The site's tabs as the core knows them: open by its granted addresses (Fansly's), registered with their reported accounts. */
  function siteTabsOf(host: HostKind): SiteTabsPort {
    const prefix = `${host}:`;
    return {
      open: () => (host === OPTIONAL_HOST ? scriptTabs.list().catch(() => null) : Promise.resolve(null)),
      registered() {
        const reported = new Map(presence.tabs().map((tab) => [tab.tabSessionId, tab.accounts]));
        return rpc
          .tabs()
          .filter((tab) => tab.request.host === host)
          .map((tab) => ({ tabSessionId: tab.tabSessionId, tabId: tab.tabId, accounts: (reported.get(tab.tabSessionId) ?? []).filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)) }));
      },
      focus: (tabId) => tabFocus.focus(tabId),
    };
  }
  const hostModules = createHostModules({
    specs: HOST_MODULE_SPECS,
    kit: kitOf,
    url: (path) => api.runtime.getURL(path),
    async load(url) {
      let address = url;
      if (__CG_TEST_HOSTS__) {
        // The e2e's probe of a failed import: the site's file is asked for under a name that is not in the build.
        const stored = await local.get([HOST_MODULE_FAULT_KEY]);
        const fault = stored.ok ? stored.value[HOST_MODULE_FAULT_KEY] : undefined;
        if (typeof fault === 'string' && /^[a-z-]+$/.test(fault)) address = address.replace(`/bg/${fault}.js`, `/bg/${fault}.missing.js`);
      }
      if (deps.loadHostModule !== undefined) return deps.loadHostModule(address);
      const loaded: unknown = await import(/* @vite-ignore */ address);
      return loaded;
    },
    now: () => Date.now(),
    log: coreLog,
  });
  const siteAccess = createSiteAccess({
    host: OPTIONAL_HOST, key: RELOAD_KEY, storage: session,
    settings: {
      async enabled() { const state = await extSettings.state(); return state.ok && state.state.ext.hosts[OPTIONAL_HOST].enabled; },
      async setEnabled(enabled) { const result = await extSettings.patch({ hosts: { [OPTIONAL_HOST]: { enabled } } }); if (!result.ok) throw new Error(result.error.code); },
      onChange: (listener) => extSettings.onChange(listener),
    },
    permissions: createPermissionBundle(permissionSet(), api),
    syncScripts: (enabled) => syncDynamicScripts(scriptSet(), enabled, api),
    tabs: scriptTabs, observe: observation,
    setCaptureEnabled: (enabled) => networkSession.setEnabled(enabled),
    startModule: async () => { await barrier.ready; return hostModules.ensure(OPTIONAL_HOST); },
    // Its open tabs connect again at once and hear that the site is off (`allowTab`): they take our UI off the page.
    turnedOff: () => rpc.dropTabs(OPTIONAL_HOST),
    failed: accessFailed,
  });
  // Starts immediately, independent of the hub's readiness/availability.
  const accessReady = siteAccess.start();
  void accessReady.catch(accessFailed);
  /** Where the storage keys of a site's unfinished work hold anything (a store that cannot be read may: the module reads it itself). */
  async function workPending(spec: HostModuleSpec): Promise<boolean> {
    const [stored, held] = await Promise.all([local.get(spec.pending.local), session.get(spec.pending.session)]);
    if (!stored.ok || !held.ok) return true;
    return spec.pending.local.some((key) => stored.value[key] !== undefined) || spec.pending.session.some((key) => held.value[key] !== undefined);
  }
  /** The site of a registered tab session; null — not a registered tab. */
  const hostOfTab = (tabSessionId: string): HostKind | null => rpc.tabs().find((tab) => tab.tabSessionId === tabSessionId)?.request.host ?? null;
  /** The same activity port shared starts and tokens use as the site's own module; sites without a switch stay on. */
  function siteActive(host: HostKind | null): boolean {
    return host !== OPTIONAL_HOST || siteAccess.active();
  }
  /**
   * The same, as the site's access stands once a change of it in flight is over (a forced sync after an update reads
   * as off while it runs): what refuses a tab, a start or a token with `CG-SITE-OFF`, never a passing state.
   */
  async function siteOn(host: HostKind | null): Promise<boolean> {
    if (host !== OPTIONAL_HOST) return true;
    await siteAccess.state().catch(() => undefined);
    return siteAccess.active();
  }
  /**
   * A site's slice of the feature manifest (§1.4): the core's own (ChatSpace's), else the one the site's running module
   * brought (Fansly's, R20 P7i: its file is not in the core's graph). Null until that module runs: nothing of the site is
   * admitted, and a request of the site's tab that needs the slice starts the module first (`moduleUnderSameSignIn`).
   */
  function featuresOf(host: HostKind): FeatureSlice | null {
    return coreFeaturesOf(host, (site) => hostModules.running(site)?.features);
  }
  /** Who is signed in, to the sign-in (its epoch moves with every sign-in and sign-out); null — nobody. */
  const signInNow = (): string | null => {
    const signedIn = hubInstance?.session() ?? null;
    return signedIn === null ? null : `${signedIn.hubOrigin}|${signedIn.userId}|${signedIn.epoch}`;
  };
  /**
   * Brings the site's module up for a request of the site's own tab (the background this request woke may not have
   * started it yet) and says whether the sign-in the request came under still stands. The wait can be long — a load,
   * a start —, and a sign-out or another person's sign-in in it leaves the request nothing to act for: the caller
   * refuses, and reads anew whatever it held from before the wait (an operation the sign-out took away).
   */
  async function moduleUnderSameSignIn(host: HostKind): Promise<boolean> {
    const before = signInNow();
    await hostModules.ensure(host);
    return signInNow() === before;
  }

  /** §9.3 «Выключение отладки или выход очищают всё»: journals and the local spend; the facade drops its prompt echoes itself. */
  const clearDebug = (): void => { scheduler.clearDebug(); clearDebugData({ journals: logging.journals, spend }); };

  /** Prompt snapshots held now, by the facade's own tickets (counts only). */
  const promptStats = (): { count: number; chars: number } => {
    let count = 0;
    let chars = 0;
    if (hubInstance === null) return { count, chars };
    for (const op of scheduler.list('', 'all').ops) {
      const ticket = hubInstance.promptEchoTicket(op.opId);
      if (ticket === null || ticket.state !== 'ok') continue;
      count += 1;
      chars += ticket.chars;
    }
    return { count, chars };
  };

  /** SN-015, ST-133: the arbiter's decisions by name, and the tones the browser would not play. */
  const soundFacts = (): DiagnosticsFacts['sound'] => {
    const known = sound.arbiter.diagnostics();
    const blocked = audio.stats().blocked;
    return { listeningTabs: known.listeningTabs, lastIncomingAt: known.lastIncomingAt, outcomes: blocked > 0 ? { ...known.outcomes, 'audio.blocked': blocked } : known.outcomes };
  };

  const facts = (): DiagnosticsFacts => {
    const now = Date.now();
    const status = hubInstance?.status() ?? null;
    const current = settings.current();
    const shown = new Map(presence.tabs().map((tab) => [tab.tabSessionId, tab]));
    const active = scheduler.activeAll();
    const modules = hostModules.facts();
    return {
      now,
      extension: {
        version: env.extensionVersion,
        contractsVersion: CONTRACTS_VERSION,
        testBuild,
        // UP-009: tabs that were open before this version got its scripts late and wait for a reload.
        ...(updated === null ? {} : { updated: { at: updated.at, from: updated.from, staleTabs: rpc.tabs().filter((tab) => tab.request.lateInjection).length } }),
      },
      browser: { major: env.browserMajor },
      os: env.os,
      locale: resolveLocale(current.ui.locale, navigator.languages),
      session: { signedIn: (status?.session ?? null) !== null, hubOrigin: status?.session?.hubOrigin ?? null, role: status?.session?.role ?? null },
      hub: {
        reachable: status?.reachable ?? null,
        lastCheckedAt: status?.lastCheckedAt ?? null,
        lastError: status?.lastError ?? null,
        // Each switch as «usable on at least one granted page»: the top-level `flags` are the owner's `"*"` row alone.
        flags: hubInstance?.cachedBootstrap() ? flagsOnSomePage(hubInstance.cachedBootstrap()?.bootstrap ?? null) : {},
        sdk: status?.sdk ?? { vendoredHash: VENDORED_CONTRACT_HASH, hubHash: null, compatible: null },
      },
      tabs: rpc.tabs().map((tab) => {
        const present = shown.get(tab.tabSessionId);
        const page = pageReports.get(tab.tabSessionId);
        return { tabSessionId: tab.tabSessionId, site: tab.request.host, host: hostReports.get(tab.tabSessionId) ?? null, chatKey: present?.chatKey ?? null,
          ...(present?.conversationRef === undefined ? {} : { conversationRef: present.conversationRef }),
          ...(page === undefined ? {} : { page }),
          ...(tab.request.host !== OPTIONAL_HOST ? {} : { networkSession: networkSession.diagnostics(tab.tabId) }),
        };
      }),
      ...(accessSnapshot === undefined ? {} : { siteAccess: [accessSnapshot] }),
      ...(requestMode === undefined ? {} : { requestModes: [{ host: OPTIONAL_HOST, mode: requestMode }] }),
      freshness: freshness.snapshot(),
      settings: settingsRead() ? current : null,
      counters: logging.counters.snapshot(now),
      logs: logging.logs.stats(),
      logger: logger.stats(),
      telemetry: telemetry.queue.stats(),
      health: telemetry.health.stats(),
      acceptance: telemetry.acceptance.stats(),
      sound: soundFacts(),
      ops: { active: active.length, snapshot: active.map((op) => ({ opId: op.opId, feature: op.feature, surface: op.surface, state: op.state, phase: op.phase.name, startedAt: op.startedAt })) },
      // X8 (bg/chatspace): what its module knows while it runs; a module that never started has no records.
      sends: modules.sends ?? { open: 0, uncertain: 0, journal: [] },
      ...(modules.sendFuse === undefined ? {} : { sendFuse: modules.sendFuse }),
      hostModules: [...hostModules.states()],
      debug: { enabled: current.debug.enabled, prompts: promptStats() },
      footprint: { cachesKB: Math.round(results.stats().bytes / 1024), logsKB: Math.round((logging.logs.stats().bytes + logging.countersBytes()) / 1024) },
    };
  };
  const diagnostics = new DiagnosticsService({ facts, logs: logging.logs, redactor: logging.redactor, logger });

  /**
   * `health` for a status surface: unauthenticated, bounded, and never an error of the status itself. Only
   * while somebody is signed in: without a sign-in the settings are the sign-in screen and the popup says
   * «Войдите» — neither shows the hub's health — and nothing talks to the hub before a person signs in
   * (UP-008; after an install the settings open by themselves).
   */
  async function refreshHealth(): Promise<void> {
    if (hubInstance === null || hubInstance.session() === null || Date.now() - healthAskedAt < HEALTH_FRESH_MS) return;
    healthAskedAt = Date.now();
    const asked = hubInstance.health().then(
      () => undefined,
      () => undefined,
    );
    await Promise.race([asked, new Promise<void>((done) => TIMERS.set(done, HEALTH_WAIT_MS))]);
  }

  // ── WS tap switch ──────────────────────────────────────────────────────────
  // The tap script itself is R09 part B's; the switch already follows the owner's `wsTap` flag (§6.8 п. 10).
  const wsTap = new WsTapSwitch({ sync: (enabled) => syncDynamicMainScript(wsTapSpec(), enabled, api).then(() => undefined) }, coreLog);

  // ── alarms ─────────────────────────────────────────────────────────────────
  let armed = false;
  function armAlarms(): void {
    if (armed) return;
    armed = true;
    for (const alarm of Object.values(ALARMS)) {
      void alarms.next(alarm.name).then((due) => (due === null ? alarms.set(alarm.name, { delayMs: alarm.periodMs, periodMs: alarm.periodMs }) : true));
    }
  }
  function disarmAlarms(): void {
    armed = false;
    for (const alarm of Object.values(ALARMS)) void alarms.clear(alarm.name);
  }
  alarms.onAlarm((name) => {
    void barrier.ready.then(async () => {
      // With no ChatSpace tab left (they re-register within a second of a wake) the page may sleep for good.
      if (rpc.tabs().length === 0) await new Promise<void>((done) => TIMERS.set(done, 2000));
      if (rpc.tabs().length === 0 && telemetry.queue.stats().queued === 0) {
        disarmAlarms();
        return;
      }
      armed = true;
      switch (name) {
        case ALARMS.resultsSweep.name:
          await results.sweep();
          break;
        case ALARMS.bootstrap.name:
          if (hubInstance !== null && hubInstance.session() !== null) await hubInstance.bootstrap().catch(() => undefined);
          break;
        case ALARMS.telemetry.name:
          await telemetry.queue.flush();
          break;
        case ALARMS.health.name:
          telemetry.health.tick();
          break;
        case ALARMS.activity.name:
          await activity.beat();
          break;
        default:
          break;
      }
    });
  });

  consent.onChange((granted) => telemetry.onConsentChanged(granted));

  // ── lifecycle (LG-016, LG-018, UP-008) ─────────────────────────────────────
  const lifecycle = createLifecycle(api);
  let installed: InstalledDetails | null = null;
  /** When this version replaced an older one, and which: «Обновилось сегодня в 09:02 с 0.4.2» of «Статус». */
  let updated: { readonly at: string; readonly from: string } | null = null;
  let browserStarted = false;
  let lifecycleSeen: () => void = () => undefined;
  /** Settles with the first `onInstalled` / `onStartup`: the start record waits a moment for it. */
  const lifecycleEvent = new Promise<void>((resolve) => {
    lifecycleSeen = resolve;
  });
  lifecycle.onInstalled((details) => {
    installed = details;
    if (details.reason === 'install' || details.reason === 'update') void siteAccess.installed().catch(accessFailed);
    lifecycleSeen();
    // UP-008: an install or an update only logs — nothing talks to the hub until a human signs in or opens ChatSpace.
    const plan = onInstalledPlan(details.reason);
    if (details.reason === 'install') {
      // §9.9 «Онбординг»: a first run starts on the settings page — the sign-in screen with the first-run
      // checklist (ST-011, ST-012). A temporary install is a developer's (`pnpm dev`, the e2e), not a first run.
      const onboarding = plan.openOnboarding && !details.temporary;
      logEvent(logger, 'extensionInstalled', { fields: { temporary: details.temporary, onboarding } });
      updated = null;
      void local.remove([UPDATED_KEY]);
      if (onboarding) void extensionPages.open('options');
    } else if (details.reason === 'update') {
      logEvent(logger, 'extensionUpdated', { fields: { previousVersion: details.previousVersion, temporary: details.temporary } });
      if (details.previousVersion !== null) {
        updated = { at: new Date().toISOString(), from: details.previousVersion.slice(0, 32) };
        void local.set({ [UPDATED_KEY]: updated });
      }
      // A temporary install is a developer's reload (`pnpm dev`, the e2e), not a chatter's update.
      if (!details.temporary) void russianAfterUpdate(details.previousVersion);
    }
  });
  /**
   * ST-135: every build up to 0.2.0 stored «Как в системе» at its first run, chosen or not, 0.2.1 and 0.2.2 kept it,
   * and an English browser showed English. The first update from one of them sets Russian, once, through the settings owner's ordinary
   * patch: its revision and `settings.changed`, so open pages and tabs switch at once. A later update, a fresh
   * install and a language the person chose leave it. A failure is logged by its code and class and stops nothing.
   */
  async function russianAfterUpdate(previousVersion: string | null): Promise<void> {
    try {
      await settings.start();
      if (settings.mode() !== 'ok' || !rewritesSystemLocale(previousVersion, settings.current().ui.locale)) return;
      const saved = await settings.patch(SYSTEM_LOCALE_REWRITE, { baseRevision: null, restricted: false });
      if (saved.ok) logger.info('bg.settings', 'language set to Russian after the update', { fields: { previousVersion, revision: saved.state.revision } });
      else logger.warn('bg.settings', 'language not set to Russian after the update', { code: saved.error.code });
    } catch (error) {
      logger.warn('bg.settings', 'language not set to Russian after the update', { code: 'CG-UNKNOWN', fields: { error: error instanceof Error ? error.name : typeof error } });
    }
  }
  lifecycle.onStartup(() => {
    browserStarted = true;
    lifecycleSeen();
    logEvent(logger, 'browserStarted');
  });
  lifecycle.onSuspend(() => {
    // The last word of this instance: what was logged goes to the store now. The write is handed to Firefox, which
    // unloads the page only once it is done (at most 5 s): started here and not handed over, it was cut by the unload
    // whenever the store was slower than the unload, and the record of this very suspend was lost (LG-018).
    logEvent(logger, 'backgroundSuspending', { fields: { tabs: rpc.tabs().length, ops: scheduler.activeAll().length, sends: hostModules.facts().sends?.open ?? 0, uptimeMs: Date.now() - started } });
    return Promise.allSettled([logging.logs.flush(), ...[...passJournals.values()].map((journal) => journal.idle()), observations.then(() => networkSession.idle()), siteAccess.idle()]).then(() => undefined);
  });
  lifecycle.onSuspendCanceled(() => logger.info('bg.lifecycle', 'background suspend canceled'));

  // ── the hub's events (wired when the hub exists) ───────────────────────────
  /** Who the things of a person in storage belong to now (set when the hub layer has read its sign-in). */
  let lastOwner: string | null = null;
  function wireHub(instance: ChatExtensionHub): void {
    instance.onSessionChange((change) => {
      rpc.emit('session.changed', { session: change.session, reason: change.reason });
      // Another person, or nobody: no mark of the old sign-in stays; the next tab report asks again.
      talking.stop();
      // §8.2 «Любая смена входа увеличивает эпоху и отменяет операции»: the old sign-in's results go with them.
      scheduler.environmentChanged({ kind: 'session', next: change.session });
      // The queue drops what was bound to the old sign-in (§9.6); a sign-out also the links and the health window.
      telemetry.onSessionChanged(change.session !== null);
      const event = change.reason === 'sign-in' ? 'signedIn' : change.reason === 'sign-out' ? 'signedOut' : 'signInLost';
      logEvent(logger, event, { ...(change.code === null ? {} : { code: change.code }), fields: { reason: change.reason, epoch: change.epoch } });
      const owner = ownerOf(change.session);
      const previous = lastOwner;
      lastOwner = owner;
      const ownerChanged = previous !== null && owner !== previous;
      if (ownerChanged) {
        // Another person, or nobody (§9.4 «При выходе всё, что связано с пользователем, очищается»): the lease
        // tokens (bg/chatspace), the subscriber baselines and the preview drafts were the previous person's. A tab
        // that is open erases its own copy of the drafts; without one the key would stay on disk.
        sound.forget();
        greetings.forget();
        void local.remove([STORAGE_KEYS.newcomersDrafts]);
      }
      // §9.4: at sign-out what is finished of the X8 journal goes; open records stay until resolved.
      if (ownerChanged || change.session === null) {
        void clearPassJournals().catch(() => undefined);
        void hostModules.notify({ kind: 'session', ownerChanged, signedOut: change.session === null }).catch(() => undefined);
      }
      sound.sync();
      if (change.session !== null) {
        void scopePersonas(change.session);
        return;
      }
      // §9.4: at sign-out everything that belongs to the person goes (the sites' modules heard it above).
      clearDebug();
      void wsTap.fromBootstrap(null);
    });
    instance.onBootstrapChange((entry) => {
      const { configRevision, issuedAt, flags } = entry.bootstrap;
      rpc.emit('bootstrap.changed', { configRevision, issuedAt });
      // The top-level flags are the owner's `"*"` row; what a page may do travels with the bootstrap itself, which
      // a tab reads again on `bootstrap.changed`.
      rpc.emit('flags.changed', { flags, configRevision });
      // §6.8 п. 10: the registration follows the switch (on for at least one page) for future documents; a live tab
      // reads the bootstrap again and tells its own tap to stand down (tab/host-facts.ts).
      void wsTap.fromBootstrap(entry.bootstrap);
      telemetry.onCapabilitiesChanged();
      void hostModules.notify({ kind: 'bootstrap' }).catch(() => undefined);
      // The hub answered: what it was not told while it was silent (or before this person signed in again) goes now.
      nativeSends.resume();
      attributions.resume();
      sound.sync();
    });
    instance.onCatalogChange(() => {
      rpc.emit('catalog.changed', {});
      void instance.catalog().then(followPersonas).catch(() => undefined);
    });
    instance.onQuotaChange((quota) => rpc.emit('quota.changed', { quota }));
    // §7 «Сервис недоступен, повтор через 5 с…»: the facade waits before its one retry; the operation says so.
    instance.onStreamNotice((notice) => {
      if (notice.kind === 'retrying') scheduler.noteRetry(notice.clientRequestId, notice.retryAt);
      // Where the request stands: a deadline that fires later says whether the hub had answered at all.
      else scheduler.noteWire(notice.clientRequestId, notice.kind === 'sent' ? { kind: 'sent' } : { kind: 'answered', status: notice.status });
    });
  }

  // ── request handlers (all registered now; each runs after the barrier) ─────

  /** One of the tab's own ChatSpace accounts is bound to the page — by what the tab reported so far. */
  const tabBoundTo = (pageId: number, tabSessionId: string): boolean => {
    const own = presence.tabs().find((tab) => tab.tabSessionId === tabSessionId)?.accounts ?? [];
    return presence
      .seenAccounts()
      .filter((seen) => own.includes(`${seen.account.host}:${seen.account.hostAccountId}`))
      .some((seen) => {
        const resolution = hubInstance?.resolveBinding(seen.account);
        return resolution?.state === 'bound' && resolution.binding.pageId === pageId;
      });
  };

  /**
   * The page of a `pageId` for a sender: granted in the bootstrap, and for a tab — one of its own bindings.
   * A tab that has not said yet which accounts it shows is waited for (background/tab-accounts.ts): its
   * request is answered by its report, never by the report's absence.
   */
  const pageOf = async (pageId: number, sender: KitSender): Promise<PageLookup> => {
    const cached = hubInstance?.cachedBootstrap() ?? null;
    if (hubInstance === null || hubInstance.session() === null) return { ok: false, code: 'CG-AUTH-REQUIRED' };
    if (cached === null) return { ok: false, code: 'CG-HUB-UNAVAILABLE' };
    const page = cached.bootstrap.pages.find((candidate) => candidate.pageId === pageId);
    if (page === undefined) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
    if (sender.kind === 'tab' && !tabBoundTo(pageId, sender.tabSessionId)) {
      if (tabAccounts.has(sender.tabSessionId)) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
      await tabAccounts.known(sender.tabSessionId);
      if (!tabBoundTo(pageId, sender.tabSessionId)) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
    }
    return { ok: true, page: { pageId: page.pageId, pageLabel: page.pageLabel, platform: page.platform } };
  };

  // tab lifecycle
  /**
   * 1.20.0 (decision X47): the fans' names the tabs already told — the open chats' first, then the operations' — for
   * the popup and «Идут сейчас», with the @handle an open chat's tab knows (2026-10-22). Memory alone; nobody signed
   * in — none.
   */
  function fanLabels(): { readonly chatKey: ChatKey; readonly label: string; readonly username?: string }[] {
    if ((hubInstance?.session() ?? null) === null) return [];
    const fans = new Map<string, { readonly label: string; readonly username?: string }>();
    for (const tab of presence.tabs()) if (tab.chatKey !== null && tab.fanLabel !== null && !fans.has(tab.chatKey)) fans.set(tab.chatKey, { label: tab.fanLabel, ...(tab.fanUsername === null ? {} : { username: tab.fanUsername }) });
    for (const entry of scheduler.fanLabels(FAN_LABELS_MAX)) if (!fans.has(entry.chatKey)) fans.set(entry.chatKey, { label: entry.label });
    return [...fans].slice(0, FAN_LABELS_MAX).map(([chatKey, fan]) => ({ chatKey: chatKey as ChatKey, ...fan }));
  }
  const fanLabelsSignature = (): string => JSON.stringify(fanLabels());

  rpc.handle('talk.read', () => ok(talking.current()));
  rpc.handle('tab.presence', async (report, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UNKNOWN', 'tab only');
    // «Focus» is a tab gaining it. A focused tab repeats its report every few seconds — its keepalive of
    // this event page (BG-003) — and that is not a reason to read the bootstrap again.
    const before = presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId);
    if (report.focused && before?.focused !== true) hubInstance?.notifyFocus();
    const namesBefore = fanLabelsSignature();
    const recorded = await presence.report(sender.tabSessionId, report);
    // 1.20.0 (X47): an open page shows the name as soon as the tab tells it, not only when it is opened next.
    if (fanLabelsSignature() !== namesBefore) rpc.emit('fans.changed', {});
    // From here the tab's own accounts are known: a request that waited for them is answered now.
    if (report.accounts !== undefined && report.accounts.length > 0) tabAccounts.reported(sender.tabSessionId);
    // A keepalive never waits behind audio or recomputes the site's aliases.
    if (recorded.recorded && (report.accounts !== undefined || before?.routeAccount !== presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId)?.routeAccount)) void sound.arbiter.rememberAccounts();
    return ok(recorded);
  });

  // sign-in and bootstrap
  rpc.handle('session.get', () => ok({ session: hub().session() }));
  rpc.handle('session.signIn', async ({ login, password }) => {
    // The password is in memory for this call only; neither it nor the login is logged.
    try {
      return ok({ session: await hub().signIn(login, password) });
    } catch (error) {
      const wire = wireOf(error);
      // One failure is one count in «Ошибки хаба за сегодня» (ST-056): a call the hub refused is already in the
      // log with its code (the hub layer's own record of the call); a refusal before any call is counted here.
      logEvent(logger, 'signInFailed', isHubCallError(error) ? { fields: { code: wire.code } } : { code: wire.code });
      return { ok: false, error: wire };
    }
  });
  rpc.handle('session.signOut', () =>
    hubCall(async () => {
      // Chat Memory week 1: the shift ends here — the closing beat goes while the token still works.
      await activity.close();
      const outcome = await hub().signOut();
      await clearPassJournals();
      return outcome;
    }),
  );
  rpc.handle('bootstrap.get', ({ force }) => hubCall(() => hub().bootstrap(force === true ? { force: true } : undefined)));
  rpc.handle('binding.resolve', ({ account }) => {
    const resolution = hub().resolveBinding(account);
    switch (resolution.state) {
      case 'bound':
        return ok({ binding: resolution.binding });
      case 'signed-out':
        return fail('CG-AUTH-REQUIRED');
      case 'refused':
        return fail(HUB_CLIENT_CHECK_CODES[resolution.check]);
      case 'loading':
        // Either the bootstrap has not arrived (its own failure says why) or ChatSpace has not loaded the creator id yet.
        return hub().cachedBootstrap() === null ? { ok: false, error: hub().status().lastError ?? { code: 'CG-DATA-NOT-READY', detail: 'bootstrap' } } : fail('CG-DATA-NOT-READY', 'account');
    }
  });
  rpc.handle('catalog.get', ({ force }) =>
    hubCall(async () => {
      // The facade has one public refresh of the catalog: «Проверить связь».
      if (force === true) await hub().checkConnection();
      return hub().catalog();
    }),
  );
  rpc.handle('quota.get', ({ pageId }) => ok({ quota: hub().quotaOf(pageId) ?? scheduler.quota(pageId) }));
  rpc.handle('accounts.seen', () => ok({ accounts: [...presence.seenAccounts()] }));
  rpc.handle('persona.set', async ({ pageId, key, definitionId }, sender) => {
    const page = await pageOf(pageId, sender);
    if (!page.ok) return fail(page.code);
    // A choice is kept only under the signed-in person's scope (scopePersonas).
    const unscoped = await scopePersonas();
    if (unscoped !== null) return { ok: false, error: unscoped };
    const saved = await settings.patch({ personas: { byPageId: { [String(pageId)]: { key, definitionId } } } }, { baseRevision: null, restricted: false });
    return saved.ok ? ok({ revision: saved.state.revision }) : { ok: false, error: saved.error };
  });

  // operations
  rpc.handle('op.start', async (start, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    // The start is judged by the slice of its chat's site: a site whose slice its module brings has it up first.
    const site = start.target.binding.host;
    const tabSite = hostOfTab(sender.tabSessionId);
    if (!(await siteOn(tabSite))) return fail('CG-SITE-OFF');
    if (featuresOf(site) === null && tabSite === site && !(await moduleUnderSameSignIn(site))) return fail('CG-CONTEXT-CHANGED', 'the sign-in changed');
    // Still no slice: the site's module did not start (it is tried again after a pause, `host-modules.ts`). Its services
    // do not answer, as every other request of the site hears then — not «выключено для страницы», which no switch says.
    if (featuresOf(site) === null) return fail('CG-RUNTIME-UNREACHABLE', `${site} services`);
    // The fan's name is display only (1.20.0): it rides beside the start, never inside the request.
    const { fanLabel, ...op } = start;
    const shown = presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId);
    const label = fanLabel ?? (shown !== undefined && shown.chatKey === chatKeyOf(op.target.chat) ? shown.fanLabel : null);
    const namesBefore = fanLabelsSignature();
    const outcome = await scheduler.start(sender.tabSessionId, op, { fanLabel: label });
    if (fanLabelsSignature() !== namesBefore) rpc.emit('fans.changed', {});
    return outcome.kind === 'admission' ? ok(outcome.admission) : fail(outcome.code);
  });
  rpc.handle('op.cancel', ({ opId }) => {
    const state = scheduler.cancel(opId);
    return state === null ? fail('CG-OP-INTERRUPTED', 'unknown operation') : ok({ state });
  });
  rpc.handle('op.list', ({ scope, chatKey }, sender) => ok(scheduler.list(sender.kind === 'tab' ? sender.tabSessionId : '', scope, chatKey)));
  rpc.handle('op.reportShown', ({ opId, part }) =>
    ok({ recorded: telemetry.report('shown', scheduler.view(opId), opId, part === undefined ? {} : { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }) }),
  );
  rpc.handle('op.reportCopy', ({ opId, part }) =>
    ok({ recorded: telemetry.report('copied', scheduler.view(opId), opId, part === undefined ? {} : { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }) }),
  );
  rpc.handle('op.reportInsert', ({ opId, part, receipt }) => {
    // `inserted` only for an applied insert (§9.6); a refusal or an unknown outcome is the tab's log, not telemetry.
    if (receipt.state !== 'applied') return ok({ recorded: false });
    const view = scheduler.view(opId);
    if (view !== null) spend.recordInsert(view.feature, Date.now());
    return ok({ recorded: telemetry.report('inserted', view, opId, { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }) });
  });
  rpc.handle('op.reportSent', async ({ opId, part, platformMessageId, edited }, sender) => {
    let view = scheduler.view(opId);
    // Chat Memory week 1: the button behind this very message, for the hub's record of who sent it.
    if (view !== null) composed.learn(platformMessageId, { composedWith: composedWithOfFeature(view.feature), edited });
    // How a human send is seen is the operation's site's, its slice of the manifest says when (`human-send`): on
    // ChatSpace its socket tells it, and whose socket may be listened to is the PAGE's own `wsTap` (the tab keeps one
    // tap while any page has it); Fansly's MAIN sees it with no switch. Not observable on the operation's page: the
    // send is not ours to know — nothing is registered and no `sent` is reported, as on a tab that has no tap at all.
    // A site whose slice its module brings has the module up first (a background this report woke).
    // After that wait the operation is read anew: a sign-out in it took the operation away, and nothing of it is
    // recorded — least of all under the next person's sign-in.
    const site = view?.target.binding.host ?? null;
    if (site !== null && featuresOf(site) === null && sender.kind === 'tab' && hostOfTab(sender.tabSessionId) === site) {
      const same = await moduleUnderSameSignIn(site);
      view = scheduler.view(opId);
      if (!same || view === null) {
        logger.info('bg.sends', 'human send not recorded: the sign-in or the operation changed while the site module started', { fields: { operation: view !== null } });
        return ok({ recorded: false });
      }
    }
    if (!humanSendObservable(view, hubInstance?.cachedBootstrap()?.bootstrap ?? null, featuresOf)) {
      logger.info('bg.sends', 'human send not recorded: not observable on the page', { fields: { pageId: view?.target.binding.pageId ?? null } });
      return ok({ recorded: false });
    }
    // §6.6, §8.5: a human send proven by its receipt and echo. For a part of a preview or of a «Новые» card the
    // hub registers it (the greeting is confirmed, the part is spent); the answer does not wait for the hub —
    // the registration is journaled and stays owed until the hub answers.
    void nativeSends.register(view, part, platformMessageId);
    // The same fact for this install's own tabs: the site's module journals the part as delivered, so the preview
    // that made it shows it «Отправлено» and offers the group's next part (`send.list`, `send.state`). Never a send
    // of ours.
    const host = sender.kind === 'tab' ? hostOfTab(sender.tabSessionId) : null;
    if (view !== null && host !== null) void hostModules.notify({ kind: 'native-sent', attemptId: IDS.uuid(), view, part, platformMessageId }, host).catch(() => undefined);
    return ok({
      recorded: telemetry.report('sent', view, opId, { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }, { via: 'composer', platformMessageId, edited }),
    });
  });

  // Who sent a message (decision X48): a human send of the composer whose own response named it, a draft of ours or
  // the person's own. A tab speaks for its own site; the account's page is known once the tab said which accounts it
  // shows. The answer does not wait for the hub: the fact is journaled and owed until the hub answers.
  rpc.handle('attribution.report', async ({ fact }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    if (hostOfTab(sender.tabSessionId) !== fact.chat.host) return ok({ queued: false, reason: 'site' });
    await tabAccounts.known(sender.tabSessionId);
    // How the text was written: a draft of ours names its button once `op.reportSent` of the same message is heard.
    const learned = fact.wrote === 'ours' ? await composed.wait(fact.platformMessageId) : null;
    return ok(
      attribute(fact.chat.host, boundPageOf(fact.chat.host, fact.chat.hostAccountId), {
        platformMessageId: fact.platformMessageId,
        fanRef: fact.chat.platformFanId,
        observedAt: fact.observedAt,
        priced: fact.priced,
        withMedia: fact.media,
        ...(fact.conversationRef === undefined ? {} : { conversationRef: fact.conversationRef }),
        composedWith: composedWithOf(fact.wrote, learned?.composedWith ?? null),
        ...(learned === null ? {} : { edited: learned.edited }),
      }),
    );
  });

  // a site's own requests: its module answers them (X8 and the greeting leases of «Новые» — bg/chatspace)
  for (const [host, types] of Object.entries(HOST_REQUESTS) as Array<[HostKind, readonly HostRequestType[]]>) {
    for (const type of types) rpc.handle(type, (payload, sender) => hostModules.request(host, { type, payload, sender } as VerifiedTabMessage) as Promise<RpcResult<never>>);
  }

  // hub data
  const data = hubDataHandlers({ hub, page: pageOf, errorOf: wireOf, debugEnabled });
  rpc.handle('recap.status', data['recap.status']);
  rpc.handle('recap.read', data['recap.read']);
  rpc.handle('recap.save', async (request, sender) => {
    // «Сохранить ещё раз» and the late save of a recap opened from the hub (AI-068): one idempotent link write
    // by the generation (H-5), never a new generation; the tab repeats a `not-ready` on the §7 schedule.
    const page = await pageOf(request.pageId, sender);
    if (!page.ok) return fail(page.code);
    return hubCall(async () => recapSaveAnswer(await hub().profileFromGeneration(profileRequestOf(request, page.page.pageLabel))));
  });
  rpc.handle('spenders.board', data['spenders.board']);
  rpc.handle('spenders.stats', data['spenders.stats']);
  rpc.handle('spenders.queue', data['spenders.queue']);
  rpc.handle('feed.read', data['feed.read']);
  rpc.handle('fan.card', data['fan.card']);
  rpc.handle('fan.dossier', data['fan.dossier']);
  rpc.handle('fan.memory', data['fan.memory']);
  rpc.handle('fan.memory.link', data['fan.memory.link']);
  rpc.handle('fan.memory.fact', data['fan.memory.fact']);
  rpc.handle('queue.winback', data['queue.winback']);
  rpc.handle('queue.winback.pick', data['queue.winback.pick']);
  rpc.handle('queue.handoff', data['queue.handoff']);
  // 1.47.0: voice notes, both sites.
  rpc.handle('voice.read', voice.handlers['voice.read']);
  rpc.handle('voice.allowance', voice.handlers['voice.allowance']);
  rpc.handle('voice.script', voice.handlers['voice.script']);
  rpc.handle('voice.edit', voice.handlers['voice.edit']);
  rpc.handle('voice.take', voice.handlers['voice.take']);
  rpc.handle('voice.check', voice.handlers['voice.check']);
  rpc.handle('voice.audio', voice.handlers['voice.audio']);
  rpc.handle('voice.attached', voice.handlers['voice.attached']);
  rpc.handle('voice.discard', voice.handlers['voice.discard']);
  rpc.handle('newcomers.list', async (request, sender) => {
    const answer = await data['newcomers.list'](request, sender);
    // The newest rows a tab read for its open window are the same the subscriber sound is decided by (SN-012).
    if (answer.ok && request.cursor === null && sender.kind === 'tab') {
      const page = hubInstance?.cachedBootstrap()?.bootstrap.pages.find((candidate) => candidate.pageId === request.pageId);
      if (page !== undefined) sound.fed(page, answer.payload, sender.tabSessionId);
    }
    return answer;
  });
  rpc.handle('usage.get', data['usage.get']);
  // 1.20.0 (DB-022, Б4): this browser's own spend journal by feature; a debug surface — off, the answer is «no report».
  rpc.handle('usage.local', ({ days }) => {
    if (!debugEnabled()) return ok({ report: null });
    const report = spend.report(Date.now(), days);
    return ok({ report: { ...report, byFeature: report.byFeature.slice(0, SPEND_REPORT_FEATURES_MAX) } });
  });
  // 1.20.0 (DB-027): «Аккаунт → Дополнительно» in debug mode. The key's display prefix, never the secret.
  rpc.handle('account.advanced', () => {
    if (!debugEnabled() || (hubInstance?.session() ?? null) === null) return ok({ info: null });
    const token = hub().status().token;
    return ok({
      info: advancedAccountInfo({
        token: token === null ? null : { keyPrefix: token.keyPrefix, issuedAt: token.issuedAt, expiresAt: token.expiresAt },
        hosts: rpc.tabs().map((tab) => ({ host: tab.request.host, report: hostReports.get(tab.tabSessionId) ?? null })),
        version: env.extensionVersion,
        browserMajor: env.browserMajor ?? null,
        os: env.os,
      }),
    });
  });
  // 1.20.0 (decision X47): the names the tabs already told — the open chats', then the operations' — for the popup and
  // «Идут сейчас». Memory alone; nobody signed in — none.
  rpc.handle('fans.labels', () => ok({ fans: fanLabels() }));

  // settings (ST-042: the hub address changes only while signed out, never to the host platform; a release build takes an https hub only)
  const settingsHandlers = settingsRequestHandlers(settings);
  rpc.handle('site.access', async (request) => {
    // The build's own site has no switch; the popup's «Перезагрузить вкладку» (X61, UP-009) reloads its tabs that got
    // our scripts late — opened before this version — so the page's own run starts with ours.
    if (request.host !== OPTIONAL_HOST && request.enabled === undefined) {
      const stale = rpc.tabs().filter((tab) => tab.request.host === request.host && tab.request.lateInjection);
      const results = request.reload === true ? await Promise.allSettled(stale.map((tab) => api.tabs.reload(tab.tabId))) : [];
      const reloaded = results.filter((result) => result.status === 'fulfilled').length;
      if (request.reload === true) logger.info('bg.tabs', 'stale tabs reloaded', { fields: { asked: stale.length, reloaded } });
      return ok({ host: request.host, enabled: true, granted: true, registered: true, waitingReload: stale.length - reloaded, ...(request.reload === true ? { reloaded } : {}) });
    }
    if (request.host !== OPTIONAL_HOST) return fail('CG-UNKNOWN', 'not an optional site');
    try {
      if (request.enabled !== undefined) await siteAccess.setEnabled(request.enabled);
      return ok(request.reload === true ? await siteAccess.reload() : await siteAccess.state());
    } catch { return fail('CG-RUNTIME-UNREACHABLE'); }
  });
  /** A patch that chooses personas is written only under the signed-in person's scope (scopePersonas), as `persona.set` is. */
  const scopedPatch = async (request: SettingsPatchRequest, write: (request: SettingsPatchRequest) => Promise<ServiceAnswer<SettingsState>>): Promise<ServiceAnswer<SettingsState>> => {
    const unscoped = request.patch.personas === undefined ? null : await scopePersonas();
    return unscoped === null ? write(request) : { ok: false, error: unscoped };
  };
  rpc.handle('settings.get', settingsHandlers['settings.get']);
  rpc.handle('settings.patch', async (request, sender) => {
    // §14: a tab changes personas only of the pages of its own binding — the same check as `persona.set`.
    const refusal = await personaPatchRefusal(request.patch, sender, pageOf);
    return refusal === null ? scopedPatch(request, settingsHandlers['settings.patch']) : fail(refusal, 'personas');
  });
  rpc.handle('settings.patchRestricted', (request) => {
    const refusal = hubAddressRefusal({ next: request.patch.hub?.baseUrl, current: settings.current().hub.baseUrl, signedIn: hub().status().auth !== 'none', testBuild: __CG_TEST_HOSTS__ });
    return refusal === null ? scopedPatch(request, settingsHandlers['settings.patchRestricted']) : fail('CG-HUB-URL', refusal);
  });

  // «Настройки» / «Войти» from a ChatSpace tab (ST-006, ST-007): a content script cannot open our pages itself,
  // so the background does — the open settings tab is focused and pointed at the section, otherwise one opens.
  rpc.handle('settings.open', async ({ route }) => ok({ opened: (await extensionPages.open('options', hashOfRoute(route))).ok }));

  // logs, diagnostics, debug
  rpc.handle('log.write', ({ records }, sender) => ok(logging.acceptUi(records, sender.kind === 'tab' ? sender.tabSessionId : null)));
  rpc.handle('diagnostics.get', async () => {
    // A status surface is open (the popup, «Статус»): the hub's health is read again, at most every 10 s.
    await refreshHealth();
    await freshnessReady;
    accessSnapshot = await siteAccess.state().catch(() => undefined);
    const ext = await extSettings.state();
    requestMode = ext.ok ? (ext.state.ext.hosts[OPTIONAL_HOST].viaTab ? 'relay' : 'background') : undefined;
    // A site's module that is starting adds its records in a moment (its X8 journal, its fuse).
    await hostModules.settled(HEALTH_WAIT_MS);
    return ok(await diagnostics.snapshot());
  });
  // «Скачать лог» of a tab names the file by the tab's own site; the popup names its site itself (2026-10-21).
  rpc.handle('diagnostics.export', async ({ format, site }, sender) => ok(await diagnostics.exportFile(format, (sender.kind === 'tab' ? hostOfTab(sender.tabSessionId) : null) ?? site ?? null)));
  rpc.handle('journal.read', async ({ journal, limit }) => {
    const read = await readPassJournals(logging.journals.read(journal, limit), journal, limit, [...passJournals.values()]);
    return ok({ records: read.records, truncated: read.truncated, runs: read.runs === null ? null : [...read.runs] });
  });
  rpc.handle('debug.prompt', ({ token }) => {
    const echo = hub().promptEcho(token);
    const generation = debugEnabled() && (echo.state === 'ok' || echo.state === 'echo-off') ? scheduler.generationDebug(token) : undefined;
    return ok(generation === undefined ? echo : { ...echo, generation });
  });
  // «Промпт» of a result's debug block (DB-007): the page is ours and a content script cannot open it. Only the
  // opaque token goes into the page's address, and only while debug mode is on (§9.3).
  rpc.handle('debug.open', async ({ token }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    if (!debugEnabled()) return ok({ opened: false });
    return ok({ opened: (await extensionPages.open('debug-prompt', undefined, { t: token })).ok });
  });
  rpc.handle('health.report', ({ report }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UNKNOWN', 'tab only');
    hostReports.set(sender.tabSessionId, report.host);
    if (report.page === undefined) pageReports.delete(sender.tabSessionId);
    else pageReports.set(sender.tabSessionId, report.page);
    // The tab's site is its registration's, never the report's word (R20 F7: a window per site and build).
    const site = hostOfTab(sender.tabSessionId);
    if (site !== null) telemetry.mergeTab(sender.tabSessionId, site, report);
    return ok({ recorded: consent.granted() });
  });

  // sound (§9.8): one fact, two consumers — the freshness of results (§7 «Кэш», §6.7.5) and the arbiter.
  const soundHandlers = soundRequestHandlers(sound.arbiter);
  rpc.handle('sound.event', (request, sender) => {
    // The tap script is registered while ANY page has `wsTap`; whose facts are heard is the account's own answer
    // (background/account-switch.ts). A fact of an account whose tap is off is not ours to use: it marks nothing
    // stale and rings nothing. Signed out there is no switch to ask — the message sound needs no hub.
    if (!incomingFactUsable(request.fact, accountFlag)) return ok({ played: false, reason: 'disabled' });
    scheduler.incoming(request.fact);
    return soundHandlers['sound.event'](request, sender);
  });
  rpc.handle('sound.preview', soundHandlers['sound.preview']);

  // a click on an extension page that acts in ChatSpace (§9.9; PU-017, ST-076)
  const tabFocus = createTabFocus(api);
  rpc.handle('tab.command', async ({ command }) => {
    const target = pickCommandTab(command, rpc.tabs(), presence.tabs());
    // The tab comes to the front first: the command is the person's click, seen where it acts.
    if (target === null || !(await tabFocus.focus(target.tabId))) return ok({ delivered: false });
    const delivered = rpc.emit('tab.command', { command }, { tabSessionId: target.tabSessionId }) > 0;
    logger.info('bg.tabs', 'page command', { fields: { kind: command.kind, surface: command.kind === 'surface' ? command.surface : null, delivered }, ctx: { tabSessionId: target.tabSessionId } });
    return ok({ delivered });
  });

  // «Очистить локальные данные» (ST-110): caches and logs; the sign-in, the settings, running operations, open X8
  // attempts and the voice sessions with a paid take not in the field yet stay.
  rpc.handle('data.clear', async () => {
    const results = scheduler.clearFinished();
    clearDebug();
    const done = await Promise.allSettled([hubInstance?.clearCaches() ?? Promise.resolve(), logging.logs.clear(), logging.clearCounters(), clearPassJournals(), hostModules.notify({ kind: 'clear-finished' }), scheduler.idle(), voice.service.clear()]);
    const cleared = done.every((step) => step.status === 'fulfilled');
    logger.info('bg.data', 'local data cleared', { fields: { results, cleared } });
    return ok({ cleared });
  });

  // action tokens (§14)
  rpc.handle('token.issue', async ({ kind, surface }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    // §8.3: an expired bootstrap blocks a new insert or navigation until it is read again; results stay.
    // Without a hub layer (its start step failed) there is no sign-in to insert a result of; ChatSpace's own
    // list still navigates. Whose switch a navigation asks is its surface's: ours (`navigation`) or a board's own.
    // An insert is admitted by the feature manifest of the site the tab is on.
    // Only an insert reads the site's slice; a site whose slice its module brings has the module up first.
    const site = hostOfTab(sender.tabSessionId);
    if (!(await siteOn(site))) return fail('CG-SITE-OFF');
    if (kind === 'insert' && site !== null && featuresOf(site) === null && !(await moduleUnderSameSignIn(site))) return fail('CG-CONTEXT-CHANGED', 'the sign-in changed');
    // The module of the site did not start: its services do not answer (op.start says the same).
    if (kind === 'insert' && site !== null && featuresOf(site) === null) return fail('CG-RUNTIME-UNREACHABLE', `${site} services`);
    const siteFeatures = site === null ? null : featuresOf(site);
    const refusal = hubInstance === null ? (kind === 'insert' ? { code: 'CG-HUB-UNAVAILABLE' as const } : null) : await tokenRefusal(kind, surface, hubInstance, wireOf, siteFeatures);
    if (refusal !== null) {
      logger.warn('bg.tokens', 'action token not issued', { code: refusal.code, fields: { kind, surface, reason: refusal.detail ?? null }, ctx: { tabSessionId: sender.tabSessionId } });
      return { ok: false, error: refusal };
    }
    return ok(tokens.issue(sender.tabSessionId, kind, surface));
  });
  rpc.handle('token.redeem', ({ kind, surface, actionToken }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    const refusal = tokens.check({ tabSessionId: sender.tabSessionId, kind, surface, actionToken });
    if (refusal !== null) logger.warn('bg.tokens', 'action token refused', { fields: { kind, surface, refusal }, ctx: { tabSessionId: sender.tabSessionId } });
    return ok({ redeemed: refusal === null });
  });

  // ── test builds only ───────────────────────────────────────────────────────
  // The dev map of the compat bootstrap (the facade keeps this very object and reads it at each synthesis).
  const compatPages: Record<string, string> = {};
  if (__CG_TEST_HOSTS__) {
    local.onChanged((changes) => {
      // The e2e's proof that the egress sink sees background requests.
      if (changes[EGRESS_PROBE_KEY]?.newValue !== undefined) fireEgressProbe();
      const compat = changes[DEV_COMPAT_PAGES_KEY];
      if (compat !== undefined) readCompatPages(compatPages, compat.newValue);
    });
  }

  // ── start ──────────────────────────────────────────────────────────────────
  /** Starts of the event page since the extension was loaded, this one included (0 — not counted yet). */
  let starts = 0;
  void barrier.start([
    {
      name: 'logs',
      async run() {
        const [client, counted, stored] = await Promise.all([readClientEnv(api), session.get([STARTS_KEY]), local.get([UPDATED_KEY])]);
        env = client;
        // An update this instance did not hear itself (the page was unloaded since): the stored record.
        if (updated === null && installed === null && stored.ok) updated = updateRecordOf(stored.value[UPDATED_KEY]);
        await logging.start();
        const earlierStarts = earlierStartsOf(counted.ok ? { ok: true, value: counted.value[STARTS_KEY] } : { ok: false });
        starts = (earlierStarts ?? 0) + 1;
        if (earlierStarts !== null) void session.set({ [STARTS_KEY]: starts });
        // The first start after a load: `onInstalled` / `onStartup` say why, and they come right behind the first run.
        if (earlierStarts === 0 && installed === null && !browserStarted) await Promise.race([lifecycleEvent, new Promise<void>((done) => TIMERS.set(done, LIFECYCLE_EVENT_WAIT_MS))]);
        const reason = startReasonOf({ earlierStarts, installed: installed?.reason ?? null, browserStarted });
        logStart(logger, {
          version: env.extensionVersion,
          contractsVersion: CONTRACTS_VERSION,
          browser: 'firefox',
          browserMajor: env.browserMajor,
          os: env.os,
          testBuild,
          reason,
          ...(reason === 'update' ? { previousVersion: installed?.previousVersion ?? null } : {}),
        });
      },
    },
    {
      name: 'settings',
      async run() {
        await settings.start();
        await Promise.all([...passJournals.values()].map((journal) => journal.ready));
        previousSettings = settingsRead() ? settings.current() : null;
      },
    },
    {
      name: 'hub',
      async run() {
        if (__CG_TEST_HOSTS__) {
          const compat = await local.get([DEV_COMPAT_PAGES_KEY]);
          if (compat.ok) readCompatPages(compatPages, compat.value[DEV_COMPAT_PAGES_KEY]);
        }
        const stored = await local.get([INSTANCE_KEY]);
        const known = stored.ok ? stored.value[INSTANCE_KEY] : undefined;
        if (typeof known === 'string' && /^[0-9a-f-]{36}$/.test(known)) instanceId = known;
        else void local.set({ [INSTANCE_KEY]: instanceId });
        const instance = new ChatExtensionHub({
          env: { extensionVersion: env.extensionVersion, testBuild, os: env.os, hubOrigin: () => settings.current().hub.baseUrl, debugEnabled },
          local: withTokenTap(local, (token) => logging.redactor.setToken(token)),
          session,
          // Quiet mode (§2, X3): whatever the settings say, no request of the hub layer goes to the host platform.
          fetch: quietFetch(
            hubFetch,
            () => logger.warn('bg.hub', 'request to the host platform refused', { code: 'CG-HUB-URL' }),
          ),
          log: hubLogOf(logger),
          ...(__CG_TEST_HOSTS__ ? { compatPageAccounts: compatPages, compatPlatforms: compatPlatforms() } : {}),
        });
        wireHub(instance);
        hubInstance = instance;
        await instance.ready;
        lastOwner = ownerOf(instance.session());
        // A scope the sign-in could not write (or the repair of the settings dropped) is written now (scopePersonas).
        if (lastOwner !== null) void scopePersonas();
        // A choice made before the owner's last edit of its persona follows it now (the catalog of the previous
        // event page, or the read that starts with this one), not only at the next change of the catalog.
        if (lastOwner !== null) void instance.catalog().then(followPersonas).catch(() => undefined);
        if (lastOwner === null) void clearPassJournals().catch(() => undefined);
        // Once after the settings load: a full token does not outlive the dev/compat mode — debug off in a test
        // build, and any release build, which has no such mode — it is erased and revoked.
        void instance.notifyDebugChanged();
      },
    },
    { name: 'site-access', run: () => accessReady },
    { name: 'results', run: () => results.start() },
    { name: 'ops', run: () => scheduler.restore() },
    // After the operations: a voice script an earlier event page was writing is read from them. Takes in flight go on.
    { name: 'voice', run: () => voice.service.resume() },
    // A site with unfinished work stored starts its module now (bg/chatspace: the X8 journal is restored, its open
    // attempts hold their fans and owe the hub their reports); the others start with their first tab or request.
    { name: 'hosts', run: () => hostModules.resume(workPending) },
    { name: 'native-sends', run: () => nativeSends.restore() },
    { name: 'send-attributions', run: () => attributions.restore() },
    { name: 'presence', run: () => presence.start() },
    { name: 'sound', run: () => Promise.all([sound.start(), greetings.restore()]) },
    { name: 'consent', run: () => consent.start() },
    { name: 'telemetry', run: () => Promise.all([telemetry.start(), spend.start()]) },
    { name: 'ws-tap', run: () => wsTap.fromBootstrap(hubInstance?.cachedBootstrap()?.bootstrap ?? null) },
  ]).then((report) => {
    logger.info('bg.ready', 'start steps', { fields: { ms: Date.now() - started, starts, deadline: report.deadline, late: report.steps.filter((step) => step.outcome !== 'ok').map((step) => `${step.name}:${step.outcome}`) } });
    // What the tabs counted while the page was away goes out now (the queue's own start flushed what was stored).
    if (rpc.tabs().length > 0) armAlarms();
    sound.sync();
  });
}
