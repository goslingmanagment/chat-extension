// Composition root of the background event page (architecture.md §2, §4, §7
// «Фон и выгрузка»): only dependency wiring. Everything the extension owns
// lives here — storage, sign-in and the hub (the ONLY module that imports
// `@cg/hub`), operations, the X8 send coordinator, logs, telemetry — and
// reaches tabs and pages through the typed protocol of §5.4.
//
// Order (an event page is woken by a listener, so the listeners come first):
// 1. synchronously: the RPC (`runtime.onConnect` / `onMessage`), the alarm
//    listener, the lifecycle listeners (installed, browser start, suspend),
//    the consent and storage listeners, every request handler;
// 2. the readiness barrier runs the start steps in order — logs, settings,
//    the hub (it needs the hub address of the settings), results and
//    operations, the send journal and coordinator, presence, the greeting
//    leases, the sound, consent, telemetry, the WS tap switch; every request
//    waits for it (10 s at most);
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
//   (background/ops-store.ts, background/send-journal-store.ts);
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

import {
  AI_STREAM_CAPABILITIES,
  CONTRACTS_VERSION,
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
  type ResolveHubError,
  type SettingsV1,
} from '@cg/contracts';
import { narrowPlatform } from '@cg/contracts/ids';
import { sendLockKey } from '@cg/contracts/send';
import { hashOfRoute } from '@cg/core/application/pages';
import { resolveHubError, storageBudgetOf } from '@cg/core/domain';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { resolveLocale } from '@cg/core/domain/i18n/live';
import { logEvent, logStart } from '@cg/core/domain/logging';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { profileRequestOf, recapSaveAnswer } from '@cg/core/domain/recap';
import {
  ActionTokens,
  GreetingLeases,
  NativeSendRegistrar,
  OpScheduler,
  RecapProfileSaver,
  SendCoordinator,
  WsTapSwitch,
  createConsentState,
  createPresence,
  createReadinessBarrier,
  createResultsStore,
  createSendJournal,
  createSettingsOwner,
  onInstalledPlan,
  settingsChangePlan,
  settingsRequestHandlers,
  type SettingsOwner,
} from '@cg/core/services';
import { DiagnosticsService, SpendService, clearDebugData, type DiagnosticsFacts } from '@cg/core/services/diagnostics';
import { soundRequestHandlers } from '@cg/core/services/sound';
import { HEALTH_TICK_MS } from '@cg/core/services/telemetry';
import { ChatExtensionHub, VENDORED_CONTRACT_HASH, errorWireOf } from '@cg/hub';
import {
  createAlarms,
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
  type RpcSenderContext,
} from '@cg/platform';

import { CHATSPACE_MATCHES, LOOPBACK_MATCHES } from '../hosts';
import { hubAddressRefusal, quietFetch } from './background/hub-address';
import { hubDataHandlers, type PageLookup } from './background/hub-data';
import { LIFECYCLE_EVENT_WAIT_MS, STARTS_KEY, earlierStartsOf, startReasonOf } from './background/lifecycle';
import { createBackgroundLogging } from './background/logging';
import { opsStoreOver } from './background/ops-store';
import { CLOCK, IDS, TIMERS, eventSinkOf, hubLogOf, keyOf, logSinkOf, serviceLogOf, throwingStoreOf } from './background/ports';
import { sendJournalStoreOver } from './background/send-journal-store';
import { personaPatchRefusal } from './background/settings-guard';
import { createBackgroundSound } from './background/sound';
import { createTabAccountsGate } from './background/tab-accounts';
import { pickCommandTab } from './background/tab-command';
import { createBackgroundTelemetry } from './background/telemetry';
import { tokenRefusal } from './background/token-gate';
import { EGRESS_PROBE_KEY, fireEgressProbe } from './egress-probe';

/** id of the dynamically registered WS tap (§6.8 п. 10). */
export const WS_TAP_SCRIPT_ID = 'cg-ws-tap';

export function wsTapSpec(): DynamicMainScriptSpec {
  // Release taps ChatSpace. A test build taps wherever its content scripts run — ChatSpace itself and the
  // loopback stand (its manifest matches both): the owner's dev profile (`pnpm dev`, X9) is a test build on
  // the real ChatSpace, and without the tap there it could exercise neither the incoming facts nor X8. Both
  // only while the bootstrap flag `wsTap` is on. The compile-time constant keeps loopback hosts out of the
  // release bundle.
  return { id: WS_TAP_SCRIPT_ID, js: ['chatspace-ws.js'], matches: __CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...LOOPBACK_MATCHES] : CHATSPACE_MATCHES };
}

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
} as const;

/**
 * storage.local, test builds only (`pnpm dev` runs one): `pageLabel → creator id` for the compat
 * bootstrap of a hub without `client/bootstrap` (docs/hub-layer.md). Never guessed by name.
 */
const DEV_COMPAT_PAGES_KEY = 'dev.compatPageAccounts';

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
  const logging = createBackgroundLogging({ session, debugEnabled, ctx: () => (hubInstance?.session() ? { session: hubInstance.session()?.epoch ?? 0 } : undefined) });
  const { logger } = logging;
  const serviceLog = serviceLogOf(logger);
  const coreLog = logSinkOf(logger);

  const barrier = createReadinessBarrier({ timers: TIMERS, log: serviceLog });

  /** A refused message is counted by the RPC; the log hears each kind on its 1st, 10th, 100th… occurrence. */
  const rejects = new Map<string, number>();
  /** Which tabs have said what accounts they show: a request about a page waits for that (`pageOf`). */
  const tabAccounts = createTabAccountsGate({ setTimer: (fn, ms) => TIMERS.set(fn, ms) });
  /** The host contract as each tab last reported it (`health.report`), for diagnostics. */
  const hostReports = new Map<string, HostContractReport | null>();
  /** When a status surface last asked for the hub's health (epoch ms; 0 — ask at the next read). */
  let healthAskedAt = 0;

  const rpc = createBackgroundRpc({
    api,
    // The loopback stand counts as ChatSpace in a test build only (the constant keeps it out of release).
    tabHosts: { chatspace: __CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...LOOPBACK_MATCHES] : CHATSPACE_MATCHES },
    ready: barrier.ready,
    contractsVersion: CONTRACTS_VERSION,
    testBuild,
    onTabRegistered(info) {
      presence.tabRegistered(info.tabSessionId);
      armAlarms();
      sound.sync();
      logger.info('bg.tabs', 'tab registered', { fields: { late: info.request.lateInjection, contracts: info.request.contractsVersion }, ctx: { tabSessionId: info.tabSessionId } });
    },
    onTabGone(info) {
      // BG-006: a closed tab only detaches its surfaces; its generations go on.
      presence.tabGone(info.tabSessionId);
      tabAccounts.gone(info.tabSessionId);
      tokens.dropTab(info.tabSessionId);
      scheduler.detachTab(info.tabSessionId);
      hostReports.delete(info.tabSessionId);
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
  const results = createResultsStore({ session, log: serviceLog });
  const sendJournal = createSendJournal({ local, log: serviceLog });
  const presence = createPresence({ local, log: serviceLog });
  const consentPort = createConsent(api);
  const consent = createConsentState({ port: consentPort, log: serviceLog });

  // ── R10: tokens, operations, preview sends ─────────────────────────────────
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
   * The bootstrap as the operations read it. A request declares to the hub the stream capabilities its bootstrap
   * names (`context-v1`, `split-all-v1`), and the hub layer refuses a request that declares one its transport
   * cannot carry (CG-HUB-CAPABILITY) — the vendored SDK carries only the prompt echo until the hub's H-4 change
   * is re-vendored (docs/hub-layer.md). So a capability the stream cannot carry is not shown to the operations:
   * they run by the archive, without the fresh tail and without Split in Ping, Hi and Coach, instead of not at all.
   */
  const bootstrapForOps = (): Bootstrap | null => {
    const bootstrap = hubInstance?.cachedBootstrap()?.bootstrap ?? null;
    if (bootstrap === null || hubInstance === null) return bootstrap;
    const carried = hubInstance.streamCapabilities();
    const uncarried = AI_STREAM_CAPABILITIES.filter((capability) => capability !== 'debug-input-v1' && !carried.includes(capability)) as readonly string[];
    return bootstrap.capabilities.some((capability) => uncarried.includes(capability)) ? { ...bootstrap, capabilities: bootstrap.capabilities.filter((capability) => !uncarried.includes(capability)) } : bootstrap;
  };

  const environment = (): OpsEnvironment => {
    const current = settings.current();
    const signedIn = hubInstance?.session() ?? null;
    const scope = current.personas.scope;
    const ours = signedIn !== null && scope !== null && scope.hubOrigin === signedIn.hubOrigin && scope.userId === signedIn.userId;
    return {
      session: signedIn,
      bootstrap: bootstrapForOps(),
      persona: (pageId) => (ours ? (current.personas.byPageId[String(pageId)] ?? null) : null),
      debug: current.debug.enabled,
      settingsLoaded: settingsRead(),
    };
  };

  const saver = new RecapProfileSaver({
    clock: CLOCK,
    ids: IDS,
    hub: { profileFromGeneration: (request) => forCore('clientFanProfileFromGeneration', () => hub().profileFromGeneration(request)) },
    events,
    tabOpen: (tabSessionId) => rpc.tabs().some((tab) => tab.tabSessionId === tabSessionId),
    log: coreLog,
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
    hooks: {
      // The facade refreshes its catalog itself when it reads such a failure.
      refreshBootstrap: () => void hubInstance?.bootstrap({ force: true }).catch(() => undefined),
      recapDone: (view, ownerTab) => saver.save(view, ownerTab),
      debugInput: (opId) => hubInstance?.promptEchoTicket(opId)?.token ?? null,
      // The local spend journal exists only in debug mode (§9.3, DB-022): numbers of this browser, nothing else.
      usage: (feature, usage) => {
        if (debugEnabled()) spend.recordUsage(feature, usage, Date.now());
      },
    },
  });

  let instanceId = IDS.uuid();
  const sends: SendCoordinator = new SendCoordinator({
    clock: CLOCK,
    hub: {
      claim: (op) => forCore('clientFanClaim', () => hub().claim(op)),
      claimStatus: (pageLabel, fanRef) => forCore('clientFanClaimStatus', () => hub().claimStatus(pageLabel, fanRef)),
    },
    resolve,
    tokens,
    events,
    store: sendJournalStoreOver(sendJournal),
    ops: scheduler,
    environment,
    get instanceId() {
      return instanceId;
    },
    log: coreLog,
    onSent: (fact) =>
      void telemetry.report('sent', scheduler.view(fact.opId), fact.opId, { part: fact.part, variant: fact.variant }, { via: 'preview', platformMessageId: fact.platformMessageId, attemptId: fact.attemptId }),
  });

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

  // ── «Новые»: the greeting leases of this install (H-7) ─────────────────────
  const leases = new GreetingLeases({
    clock: CLOCK,
    ids: IDS,
    // The facade's own errors as they are: the handler reads their wire form (the claim action is among its facts).
    hub: { claim: (op) => hub().claim(op), claimStatus: (pageLabel, fanRef) => hub().claimStatus(pageLabel, fanRef) },
    instanceId: () => instanceId,
    owner: () => ownerOf(hubInstance?.session() ?? null),
    limits: () => hubInstance?.cachedBootstrap()?.bootstrap.limits ?? null,
    events,
    tabs: () => rpc.tabs().map((tab) => tab.tabSessionId),
    store: throwingStoreOf(session),
    log: coreLog,
  });

  // ── sound ──────────────────────────────────────────────────────────────────
  // The one player of the extension (§9.8; its AudioContext is created with the first tone) under R17's
  // one arbiter: a fan's message from any tab, a new subscriber from «Новые».
  const audio = deps.audio ?? createAudioPlayer();
  const hostPermissions = createHostPermissions(api);
  /** Where the content scripts of a host kind run: without the permission nothing of ours runs there. */
  const hostOrigins: Readonly<Record<string, readonly string[]>> = {
    chatspace: (__CG_TEST_HOSTS__ ? [...CHATSPACE_MATCHES, ...LOOPBACK_MATCHES] : CHATSPACE_MATCHES).map((pattern) => new URL(pattern.replace(/\*$/, '')).origin),
  };
  const sound = createBackgroundSound({
    clock: CLOCK,
    audio,
    presence,
    settings: () => (settingsRead() ? settings.current().sound : null),
    bootstrap: () => hubInstance?.cachedBootstrap()?.bootstrap ?? null,
    newcomersUsable: (pageLabel) => hubInstance?.flagState('newcomers', pageLabel).usable === true,
    hostPermission: async (host) => (await Promise.all((hostOrigins[host] ?? []).map((origin) => hostPermissions.has(origin)))).some(Boolean),
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
    chatSpaceOpen: () => rpc.tabs().length > 0,
    client: () => ({ version: env.extensionVersion, browserMajor: env.browserMajor ?? 0, os: env.os }),
    footprint: () => ({ cachesKB: Math.round(results.stats().bytes / 1024), logsKB: Math.round(logging.logs.stats().bytes / 1024) }),
    disabled() {
      const flags = hubInstance?.cachedBootstrap()?.bootstrap.flags ?? {};
      return Object.entries(flags)
        .filter(([, on]) => !on)
        .map(([flag]) => flag);
    },
  });
  const spend = new SpendService(keyOf(local, SPEND_KEY));

  /** §9.3 «Выключение отладки или выход очищают всё»: journals and the local spend; the facade drops its prompt echoes itself. */
  const clearDebug = (): void => clearDebugData({ journals: logging.journals, spend });

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
    const shown = new Map(presence.tabs().map((tab) => [tab.tabSessionId, tab.chatKey]));
    const active = scheduler.active();
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
        flags: hubInstance?.cachedBootstrap()?.bootstrap.flags ?? {},
        sdk: status?.sdk ?? { vendoredHash: VENDORED_CONTRACT_HASH, hubHash: null, compatible: null },
      },
      tabs: rpc.tabs().map((tab) => ({ tabSessionId: tab.tabSessionId, host: hostReports.get(tab.tabSessionId) ?? null, chatKey: shown.get(tab.tabSessionId) ?? null })),
      settings: settingsRead() ? current : null,
      counters: logging.counters.snapshot(now),
      logs: logging.logs.stats(),
      logger: logger.stats(),
      telemetry: telemetry.queue.stats(),
      health: telemetry.health.stats(),
      acceptance: telemetry.acceptance.stats(),
      sound: soundFacts(),
      ops: { active: active.length, snapshot: active.map((op) => ({ opId: op.opId, feature: op.feature, surface: op.surface, state: op.state, phase: op.phase.name, startedAt: op.startedAt })) },
      sends: { ...sends.counts(), journal: sendJournal.list() },
      debug: { enabled: current.debug.enabled, prompts: promptStats() },
      footprint: { cachesKB: Math.round(results.stats().bytes / 1024), logsKB: Math.round(logging.logs.stats().bytes / 1024) },
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
    }
  });
  lifecycle.onStartup(() => {
    browserStarted = true;
    lifecycleSeen();
    logEvent(logger, 'browserStarted');
  });
  lifecycle.onSuspend(() => {
    // The last word of this instance: what was logged goes to the store now, nothing later is guaranteed.
    logEvent(logger, 'backgroundSuspending', { fields: { tabs: rpc.tabs().length, ops: scheduler.active().length, sends: sends.counts().open, uptimeMs: Date.now() - started } });
    void logging.logs.flush();
  });
  lifecycle.onSuspendCanceled(() => logger.info('bg.lifecycle', 'background suspend canceled'));

  // ── the hub's events (wired when the hub exists) ───────────────────────────
  /** Who the things of a person in storage belong to now (set when the hub layer has read its sign-in). */
  let lastOwner: string | null = null;
  function wireHub(instance: ChatExtensionHub): void {
    instance.onSessionChange((change) => {
      rpc.emit('session.changed', { session: change.session, reason: change.reason });
      // §8.2 «Любая смена входа увеличивает эпоху и отменяет операции»: the old sign-in's results go with them.
      scheduler.environmentChanged({ kind: 'session', next: change.session });
      // The queue drops what was bound to the old sign-in (§9.6); a sign-out also the links and the health window.
      telemetry.onSessionChanged(change.session !== null);
      const event = change.reason === 'sign-in' ? 'signedIn' : change.reason === 'sign-out' ? 'signedOut' : 'signInLost';
      logEvent(logger, event, { ...(change.code === null ? {} : { code: change.code }), fields: { reason: change.reason, epoch: change.epoch } });
      const owner = ownerOf(change.session);
      const previous = lastOwner;
      lastOwner = owner;
      if (previous !== null && owner !== previous) {
        // Another person, or nobody (§9.4 «При выходе всё, что связано с пользователем, очищается»): the lease
        // tokens, the subscriber baselines and the preview drafts were the previous person's. A tab that is
        // open erases its own copy of the drafts; without one the key would stay on disk.
        leases.forgetAll();
        sound.forget();
        void local.remove([STORAGE_KEYS.newcomersDrafts]);
      }
      sound.sync();
      if (change.session !== null) {
        void settings.setPersonaScope({ hubOrigin: change.session.hubOrigin, userId: change.session.userId });
        return;
      }
      // §9.4: at sign-out everything that belongs to the person goes; open X8 records stay until resolved.
      clearDebug();
      void sendJournal.removeFinished();
      void wsTap.fromBootstrap(null);
    });
    instance.onBootstrapChange((entry) => {
      const { configRevision, issuedAt, flags } = entry.bootstrap;
      rpc.emit('bootstrap.changed', { configRevision, issuedAt });
      rpc.emit('flags.changed', { flags, configRevision });
      // §6.8 п. 10: the registration follows the flag for future documents; a live tab hears the flags and tells
      // its own tap to stand down (tab/host-facts.ts).
      void wsTap.fromBootstrap(entry.bootstrap);
      telemetry.onCapabilitiesChanged();
      void sends.bootstrapChanged();
      // The hub answered: what it was not told while it was silent (or before this person signed in again) goes now.
      nativeSends.resume();
      sound.sync();
    });
    instance.onCatalogChange(() => rpc.emit('catalog.changed', {}));
    instance.onQuotaChange((quota) => rpc.emit('quota.changed', { quota }));
    // §7 «Сервис недоступен, повтор через 5 с…»: the facade waits before its one retry; the operation says so.
    instance.onStreamNotice((notice) => scheduler.noteRetry(notice.clientRequestId, notice.retryAt));
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
  const pageOf = async (pageId: number, sender: RpcSenderContext): Promise<PageLookup> => {
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
  rpc.handle('tab.presence', async (report, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UNKNOWN', 'tab only');
    // «Focus» is a tab gaining it. A focused tab repeats its report every few seconds — its keepalive of
    // this event page (BG-003) — and that is not a reason to read the bootstrap again.
    const before = presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId);
    if (report.focused && before?.focused !== true) hubInstance?.notifyFocus();
    const recorded = await presence.report(sender.tabSessionId, report);
    // From here the tab's own accounts are known: a request that waited for them is answered now.
    if (report.accounts !== undefined && report.accounts.length > 0) tabAccounts.reported(sender.tabSessionId);
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
  rpc.handle('session.signOut', () => hubCall(() => hub().signOut()));
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
    const saved = await settings.patch({ personas: { byPageId: { [String(pageId)]: { key, definitionId } } } }, { baseRevision: null, restricted: false });
    return saved.ok ? ok({ revision: saved.state.revision }) : { ok: false, error: saved.error };
  });

  // operations
  rpc.handle('op.start', async (start, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    const outcome = await scheduler.start(sender.tabSessionId, start);
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
  rpc.handle('op.reportSent', ({ opId, part, platformMessageId, edited }) => {
    const view = scheduler.view(opId);
    // §6.6, §8.5: a human send proven by its receipt and echo. For a part of a preview or of a «Новые» card the
    // hub registers it (the greeting is confirmed, the part is spent); the answer does not wait for the hub —
    // the registration is journaled and stays owed until the hub answers.
    void nativeSends.register(view, part, platformMessageId);
    return ok({
      recorded: telemetry.report('sent', view, opId, { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }, { via: 'composer', platformMessageId, edited }),
    });
  });

  // X8 preview send
  rpc.handle('send.begin', async (begin, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    return ok(await sends.begin(sender.tabSessionId, begin));
  });
  rpc.handle('send.status', ({ attemptId }) => ok({ view: sends.status(attemptId) }));
  rpc.handle('send.list', async ({ pageId, fanRef }, sender) => {
    // What a tab that lost its own tracking (a reload) holds the fan by (§6.7.8): the journal of this install.
    const page = await pageOf(pageId, sender);
    if (!page.ok) return fail(page.code);
    const platform = narrowPlatform(page.page.platform);
    const signedIn = hub().session();
    if (platform === null || signedIn === null) return fail('CG-BINDING-NOT-GRANTED');
    const known = sends.attemptsOf(sendLockKey({ hubOrigin: signedIn.hubOrigin, pageId, platform, fanRef }));
    return ok({ attempts: [...known.attempts], truncated: known.truncated });
  });
  rpc.handle('send.report', async ({ view, pendingId }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    return ok({ recorded: await sends.report(sender.tabSessionId, view, pendingId) });
  });

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
  rpc.handle('newcomers.claim', async ({ pageId, fanRef, action }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    const page = await pageOf(pageId, sender);
    if (!page.ok) return fail(page.code);
    try {
      const answer = await leases.act(sender.tabSessionId, page.page, fanRef, action);
      return answer.ok ? ok(answer.state) : fail(answer.code);
    } catch (error) {
      return { ok: false, error: wireOf(error) };
    }
  });

  // settings (ST-042: the hub address changes only while signed out, never to the host platform; a release build takes an https hub only)
  const settingsHandlers = settingsRequestHandlers(settings);
  rpc.handle('settings.get', settingsHandlers['settings.get']);
  rpc.handle('settings.patch', async (request, sender) => {
    // §14: a tab changes personas only of the pages of its own binding — the same check as `persona.set`.
    const refusal = await personaPatchRefusal(request.patch, sender, pageOf);
    return refusal === null ? settingsHandlers['settings.patch'](request) : fail(refusal, 'personas');
  });
  rpc.handle('settings.patchRestricted', (request) => {
    const refusal = hubAddressRefusal({ next: request.patch.hub?.baseUrl, current: settings.current().hub.baseUrl, signedIn: hub().status().auth !== 'none', testBuild: __CG_TEST_HOSTS__ });
    return refusal === null ? settingsHandlers['settings.patchRestricted'](request) : fail('CG-HUB-URL', refusal);
  });

  // «Настройки» / «Войти» from a ChatSpace tab (ST-006, ST-007): a content script cannot open our pages itself,
  // so the background does — the open settings tab is focused and pointed at the section, otherwise one opens.
  rpc.handle('settings.open', async ({ route }) => ok({ opened: (await extensionPages.open('options', hashOfRoute(route))).ok }));

  // logs, diagnostics, debug
  rpc.handle('log.write', ({ records }, sender) => ok(logging.acceptUi(records, sender.kind === 'tab' ? sender.tabSessionId : null)));
  rpc.handle('diagnostics.get', async () => {
    // A status surface is open (the popup, «Статус»): the hub's health is read again, at most every 10 s.
    await refreshHealth();
    return ok(await diagnostics.snapshot());
  });
  rpc.handle('diagnostics.export', async ({ format }) => ok(await diagnostics.exportFile(format)));
  rpc.handle('journal.read', ({ journal, limit }) => {
    const read = logging.journals.read(journal, limit);
    return ok({ records: read.records, truncated: read.truncated, runs: read.runs === null ? null : [...read.runs] });
  });
  rpc.handle('debug.prompt', ({ token }) => ok(hub().promptEcho(token)));
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
    telemetry.mergeTab(sender.tabSessionId, report);
    return ok({ recorded: consent.granted() });
  });

  // sound (§9.8): one fact, two consumers — the freshness of results (§7 «Кэш», §6.7.5) and the arbiter.
  const soundHandlers = soundRequestHandlers(sound.arbiter);
  rpc.handle('sound.event', (request, sender) => {
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

  // «Очистить локальные данные» (ST-110): caches and logs; the sign-in, the settings, running operations and
  // open X8 attempts stay.
  rpc.handle('data.clear', async () => {
    const results = scheduler.clearFinished();
    clearDebug();
    const done = await Promise.allSettled([hubInstance?.clearCaches() ?? Promise.resolve(), logging.logs.clear(), sendJournal.removeFinished(), scheduler.idle()]);
    const cleared = done.every((step) => step.status === 'fulfilled');
    logger.info('bg.data', 'local data cleared', { fields: { results, cleared } });
    return ok({ cleared });
  });

  // action tokens (§14)
  rpc.handle('token.issue', async ({ kind, surface }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    // §8.3: an expired bootstrap blocks a new insert or navigation until it is read again; results stay.
    // Without a hub layer (its start step failed) there is no sign-in to insert a result of; ChatSpace's own
    // list still navigates.
    const refusal = hubInstance === null ? (kind === 'insert' ? { code: 'CG-HUB-UNAVAILABLE' as const } : null) : await tokenRefusal(kind, hubInstance, wireOf);
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
          ...(__CG_TEST_HOSTS__ ? { compatPageAccounts: compatPages } : {}),
        });
        wireHub(instance);
        hubInstance = instance;
        await instance.ready;
        lastOwner = ownerOf(instance.session());
        // Once after the settings load: a full token does not outlive the dev/compat mode — debug off in a test
        // build, and any release build, which has no such mode — it is erased and revoked.
        void instance.notifyDebugChanged();
      },
    },
    { name: 'results', run: () => results.start() },
    { name: 'ops', run: () => scheduler.restore() },
    { name: 'send-journal', run: () => sendJournal.start() },
    { name: 'sends', run: () => sends.restore() },
    { name: 'native-sends', run: () => nativeSends.restore() },
    { name: 'presence', run: () => presence.start() },
    { name: 'leases', run: () => leases.restore() },
    { name: 'sound', run: () => sound.start() },
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
