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
//    operations, the send journal and coordinator, presence, consent,
//    telemetry, the WS tap switch; every request waits for it (10 s at most);
// 3. nothing here talks to the hub by itself after an install or an update:
//    the facade refreshes a bootstrap only for an existing sign-in.
//
// Where two wave-1 packages brought the same thing, one is wired and the
// other is not (the report of the integration step lists them):
// - readiness and presence: R07's barrier and presence (R10's `Readiness`,
//   `TabSessions` and `AccountPresence` are not used — the RPC mints the tab
//   sessions);
// - operation results and the send journal: R07's stores are the single
//   writers, R10's scheduler and coordinator write through adapters
//   (background/ops-store.ts, background/send-journal-store.ts);
// - the 503 retry of the AI stream: the facade's (the scheduler reads the
//   facade's own resolution, which says the retry is spent);
// - the prompt echo: the facade's store (`debug.prompt`, the echo token).

import {
  CONTRACTS_VERSION,
  HUB_CLIENT_CHECK_CODES,
  STORAGE_KEYS,
  hasCapability,
  isHubCallError,
  isHubCheckError,
  type CgCode,
  type CgErrorWire,
  type HostContractReport,
  type HubErrorResolution,
  type HubFailure,
  type HubRouteKey,
  type ResolveHubError,
  type SettingsV1,
  type TabRequestType,
} from '@cg/contracts';
import { resolveHubError, storageBudgetOf } from '@cg/core/domain';
import { resolveLocale } from '@cg/core/domain/i18n/live';
import { logEvent, logStart } from '@cg/core/domain/logging';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import {
  ActionTokens,
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
import { DiagnosticsService, SpendService, type DiagnosticsFacts } from '@cg/core/services/diagnostics';
import { HEALTH_TICK_MS } from '@cg/core/services/telemetry';
import { ChatExtensionHub, VENDORED_CONTRACT_HASH, errorWireOf } from '@cg/hub';
import {
  createAlarms,
  createAudioPlayer,
  createBackgroundRpc,
  createConsent,
  createKeyValueStore,
  createLifecycle,
  defaultBrowser,
  readClientEnv,
  syncDynamicMainScript,
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
import { CLOCK, IDS, TIMERS, eventSinkOf, hubLogOf, keyOf, logSinkOf, serviceLogOf } from './background/ports';
import { sendJournalStoreOver } from './background/send-journal-store';
import { personaPatchRefusal } from './background/settings-guard';
import { createBackgroundTelemetry } from './background/telemetry';
import { EGRESS_PROBE_KEY, fireEgressProbe } from './egress-probe';

/** id of the dynamically registered WS tap (§6.8 п. 10). */
export const WS_TAP_SCRIPT_ID = 'cg-ws-tap';

export function wsTapSpec(): DynamicMainScriptSpec {
  // Release taps ChatSpace; a test build taps only the loopback stand. Both
  // only while the bootstrap flag `wsTap` is on. The compile-time constant
  // keeps loopback hosts out of the release bundle.
  return { id: WS_TAP_SCRIPT_ID, js: ['chatspace-ws.js'], matches: __CG_TEST_HOSTS__ ? LOOPBACK_MATCHES : CHATSPACE_MATCHES };
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

/** A status surface reads the hub's health again when the last read is older than this («Проверить всё» — at most every 10 s). */
const HEALTH_FRESH_MS = 10_000;
/** How long `diagnostics.get` waits for that read before it answers with what is known. */
const HEALTH_WAIT_MS = 5_000;

/** Requests of the frozen protocol that have no implementation behind them yet (the answer names the type). */
export const NOT_IMPLEMENTED_REQUESTS = ['newcomers.claim', 'sound.preview'] as const satisfies readonly TabRequestType[];

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
}

export function composeBackground(deps: BackgroundDeps = {}): void {
  const testBuild = __CG_TEST_HOSTS__;

  // ── platform ───────────────────────────────────────────────────────────────
  const api = deps.api ?? defaultBrowser();
  const hubFetch = deps.fetch ?? ((input: string, init?: RequestInit): Promise<Response> => fetch(input, init));
  const local = createKeyValueStore('local', { api, budgetOf: storageBudgetOf });
  const session = createKeyValueStore('session', { api, budgetOf: storageBudgetOf });
  const alarms = createAlarms(api);
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
  /** The host contract as each tab last reported it (`health.report`), for diagnostics. */
  const hostReports = new Map<string, HostContractReport | null>();
  let lastIncomingAt: string | null = null;
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
      logger.info('bg.tabs', 'tab registered', { fields: { late: info.request.lateInjection, contracts: info.request.contractsVersion }, ctx: { tabSessionId: info.tabSessionId } });
    },
    onTabGone(info) {
      // BG-006: a closed tab only detaches its surfaces; its generations go on.
      presence.tabGone(info.tabSessionId);
      tokens.dropTab(info.tabSessionId);
      scheduler.detachTab(info.tabSessionId);
      hostReports.delete(info.tabSessionId);
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
        if (!state.settings.debug.enabled) clearDebugData();
      }
    },
  });

  settingsOwner = settings;

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

  const environment = (): OpsEnvironment => {
    const current = settings.current();
    const signedIn = hubInstance?.session() ?? null;
    const scope = current.personas.scope;
    const ours = signedIn !== null && scope !== null && scope.hubOrigin === signedIn.hubOrigin && scope.userId === signedIn.userId;
    return {
      session: signedIn,
      bootstrap: hubInstance?.cachedBootstrap()?.bootstrap ?? null,
      persona: (pageId) => (ours ? (current.personas.byPageId[String(pageId)] ?? null) : null),
      debug: current.debug.enabled,
      settingsLoaded: settings.mode() === 'ok',
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
    hooks: {
      // The facade refreshes its catalog itself when it reads such a failure.
      refreshBootstrap: () => void hubInstance?.bootstrap({ force: true }).catch(() => undefined),
      recapDone: (view, ownerTab) => saver.save(view, ownerTab),
      debugInput: (opId) => hubInstance?.promptEchoTicket(opId)?.token ?? null,
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

  // ── sound ──────────────────────────────────────────────────────────────────
  // The one player of the extension (§9.8; its AudioContext is created with the first tone). The policy
  // that decides when a tone plays, and the tone tables, are R17's: until then nothing plays.
  const audio = createAudioPlayer();

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
  function clearDebugData(): void {
    logging.journals.clear();
    spend.clear();
  }

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

  const facts = (): DiagnosticsFacts => {
    const now = Date.now();
    const status = hubInstance?.status() ?? null;
    const current = settings.current();
    const shown = new Map(presence.tabs().map((tab) => [tab.tabSessionId, tab.chatKey]));
    const active = scheduler.active();
    return {
      now,
      extension: { version: env.extensionVersion, contractsVersion: CONTRACTS_VERSION, testBuild },
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
      settings: settings.mode() === 'ok' ? current : null,
      counters: logging.counters.snapshot(now),
      logs: logging.logs.stats(),
      logger: logger.stats(),
      telemetry: telemetry.queue.stats(),
      health: telemetry.health.stats(),
      acceptance: telemetry.acceptance.stats(),
      sound: { listeningTabs: presence.listeningTabs(), lastIncomingAt, outcomes: { played: audio.stats().played, blocked: audio.stats().blocked } },
      ops: { active: active.length, snapshot: active.map((op) => ({ opId: op.opId, feature: op.feature, surface: op.surface, state: op.state, phase: op.phase.name, startedAt: op.startedAt })) },
      sends: { ...sends.counts(), journal: sendJournal.list() },
      debug: { enabled: current.debug.enabled, prompts: promptStats() },
      footprint: { cachesKB: Math.round(results.stats().bytes / 1024), logsKB: Math.round(logging.logs.stats().bytes / 1024) },
    };
  };
  const diagnostics = new DiagnosticsService({ facts, logs: logging.logs, redactor: logging.redactor, logger });

  /** `health` for a status surface: unauthenticated, bounded, and never an error of the status itself. */
  async function refreshHealth(): Promise<void> {
    if (hubInstance === null || Date.now() - healthAskedAt < HEALTH_FRESH_MS) return;
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
    if (details.reason === 'install') logEvent(logger, 'extensionInstalled', { fields: { temporary: details.temporary, onboarding: plan.openOnboarding } });
    else if (details.reason === 'update') logEvent(logger, 'extensionUpdated', { fields: { previousVersion: details.previousVersion, temporary: details.temporary } });
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
  function wireHub(instance: ChatExtensionHub): void {
    instance.onSessionChange((change) => {
      rpc.emit('session.changed', { session: change.session, reason: change.reason });
      scheduler.environmentChanged({ kind: 'session', next: change.session });
      telemetry.onSessionChanged(change.session !== null);
      const event = change.reason === 'sign-in' ? 'signedIn' : change.reason === 'sign-out' ? 'signedOut' : 'signInLost';
      logEvent(logger, event, { ...(change.code === null ? {} : { code: change.code }), fields: { reason: change.reason, epoch: change.epoch } });
      if (change.session !== null) {
        void settings.setPersonaScope({ hubOrigin: change.session.hubOrigin, userId: change.session.userId });
        return;
      }
      // §9.4: at sign-out everything that belongs to the person goes; open X8 records stay until resolved.
      clearDebugData();
      void sendJournal.removeFinished();
      void wsTap.fromBootstrap(null);
    });
    instance.onBootstrapChange((entry) => {
      const { configRevision, issuedAt, flags } = entry.bootstrap;
      rpc.emit('bootstrap.changed', { configRevision, issuedAt });
      rpc.emit('flags.changed', { flags, configRevision });
      void wsTap.fromBootstrap(entry.bootstrap);
      telemetry.onCapabilitiesChanged();
      void sends.bootstrapChanged();
    });
    instance.onCatalogChange(() => rpc.emit('catalog.changed', {}));
    instance.onQuotaChange((quota) => rpc.emit('quota.changed', { quota }));
  }

  // ── request handlers (all registered now; each runs after the barrier) ─────

  /** The page of a `pageId` for a sender: granted in the bootstrap, and for a tab — one of its own bindings. */
  const pageOf = (pageId: number, sender: RpcSenderContext): PageLookup => {
    const cached = hubInstance?.cachedBootstrap() ?? null;
    if (hubInstance === null || hubInstance.session() === null) return { ok: false, code: 'CG-AUTH-REQUIRED' };
    if (cached === null) return { ok: false, code: 'CG-HUB-UNAVAILABLE' };
    const page = cached.bootstrap.pages.find((candidate) => candidate.pageId === pageId);
    if (page === undefined) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
    if (sender.kind === 'tab') {
      const own = presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId)?.accounts ?? [];
      const bound = presence
        .seenAccounts()
        .filter((seen) => own.includes(`${seen.account.host}:${seen.account.hostAccountId}`))
        .some((seen) => {
          const resolution = hubInstance?.resolveBinding(seen.account);
          return resolution?.state === 'bound' && resolution.binding.pageId === pageId;
        });
      if (!bound) return { ok: false, code: 'CG-BINDING-NOT-GRANTED' };
    }
    return { ok: true, page: { pageId: page.pageId, pageLabel: page.pageLabel, platform: page.platform } };
  };

  const notImplemented = (type: (typeof NOT_IMPLEMENTED_REQUESTS)[number]) => (): { readonly ok: false; readonly error: CgErrorWire } => fail('CG-FEATURE-DISABLED', `not implemented yet: ${type}`);

  // tab lifecycle
  rpc.handle('tab.presence', async (report, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UNKNOWN', 'tab only');
    // «Focus» is a tab gaining it. A focused tab repeats its report every few seconds — its keepalive of
    // this event page (BG-003) — and that is not a reason to read the bootstrap again.
    const before = presence.tabs().find((tab) => tab.tabSessionId === sender.tabSessionId);
    if (report.focused && before?.focused !== true) hubInstance?.notifyFocus();
    return ok(await presence.report(sender.tabSessionId, report));
  });

  // sign-in and bootstrap
  rpc.handle('session.get', () => ok({ session: hub().session() }));
  rpc.handle('session.signIn', async ({ login, password }) => {
    // The password is in memory for this call only; neither it nor the login is logged.
    const answer = await hubCall(async () => ({ session: await hub().signIn(login, password) }));
    if (!answer.ok) logEvent(logger, 'signInFailed', { code: answer.error.code });
    return answer;
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
    const page = pageOf(pageId, sender);
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
  rpc.handle('op.reportSent', ({ opId, part, platformMessageId, edited }) =>
    ok({
      recorded: telemetry.report('sent', scheduler.view(opId), opId, { part: part.index, ...(part.variant === undefined ? {} : { variant: part.variant }) }, { via: 'composer', platformMessageId, edited }),
    }),
  );

  // X8 preview send
  rpc.handle('send.begin', async (begin, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    return ok(await sends.begin(sender.tabSessionId, begin));
  });
  rpc.handle('send.status', ({ attemptId }) => ok({ view: sends.status(attemptId) }));
  rpc.handle('send.report', async ({ view, pendingId }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
    return ok({ recorded: await sends.report(sender.tabSessionId, view, pendingId) });
  });

  // hub data
  const data = hubDataHandlers({ hub, page: pageOf, errorOf: wireOf, debugEnabled });
  rpc.handle('recap.status', data['recap.status']);
  rpc.handle('recap.read', data['recap.read']);
  rpc.handle('spenders.board', data['spenders.board']);
  rpc.handle('spenders.stats', data['spenders.stats']);
  rpc.handle('spenders.queue', data['spenders.queue']);
  rpc.handle('feed.read', data['feed.read']);
  rpc.handle('fan.card', data['fan.card']);
  rpc.handle('fan.dossier', data['fan.dossier']);
  rpc.handle('newcomers.list', data['newcomers.list']);
  rpc.handle('usage.get', data['usage.get']);
  rpc.handle('newcomers.claim', notImplemented('newcomers.claim'));

  // settings (ST-042: the hub address changes only while signed out, never to the host platform; a release build takes an https hub only)
  const settingsHandlers = settingsRequestHandlers(settings);
  rpc.handle('settings.get', settingsHandlers['settings.get']);
  rpc.handle('settings.patch', (request, sender) => {
    // §14: a tab changes personas only of the pages of its own binding — the same check as `persona.set`.
    const refusal = personaPatchRefusal(request.patch, sender, pageOf);
    return refusal === null ? settingsHandlers['settings.patch'](request) : fail(refusal, 'personas');
  });
  rpc.handle('settings.patchRestricted', (request) => {
    const refusal = hubAddressRefusal({ next: request.patch.hub?.baseUrl, current: settings.current().hub.baseUrl, signedIn: hub().status().auth !== 'none', testBuild: __CG_TEST_HOSTS__ });
    return refusal === null ? settingsHandlers['settings.patchRestricted'](request) : fail('CG-HUB-URL', refusal);
  });

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
  rpc.handle('health.report', ({ report }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UNKNOWN', 'tab only');
    hostReports.set(sender.tabSessionId, report.host);
    telemetry.mergeTab(sender.tabSessionId, report);
    return ok({ recorded: consent.granted() });
  });

  // sound: the arbiter is R17's. The fact already feeds the freshness of results (§7 «Кэш»), nothing plays yet.
  rpc.handle('sound.event', ({ fact }) => {
    lastIncomingAt = new Date().toISOString();
    scheduler.incoming(fact);
    return ok({ played: false, reason: 'policy_not_wired' });
  });
  rpc.handle('sound.preview', notImplemented('sound.preview'));

  // action tokens (§14)
  rpc.handle('token.issue', ({ kind, surface }, sender) => {
    if (sender.kind !== 'tab') return fail('CG-UI-FAILED', 'tab only');
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
        const [client, counted] = await Promise.all([readClientEnv(api), session.get([STARTS_KEY])]);
        env = client;
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
        previousSettings = settings.mode() === 'ok' ? settings.current() : null;
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
        // Once after the settings load: a full token of the dev/compat mode does not outlive debug mode in a release build.
        void instance.notifyDebugChanged();
      },
    },
    { name: 'results', run: () => results.start() },
    { name: 'ops', run: () => scheduler.restore() },
    { name: 'send-journal', run: () => sendJournal.start() },
    { name: 'sends', run: () => sends.restore() },
    { name: 'presence', run: () => presence.start() },
    { name: 'consent', run: () => consent.start() },
    { name: 'telemetry', run: () => Promise.all([telemetry.start(), spend.start()]) },
    { name: 'ws-tap', run: () => wsTap.fromBootstrap(hubInstance?.cachedBootstrap()?.bootstrap ?? null) },
  ]).then((report) => {
    logger.info('bg.ready', 'start steps', { fields: { ms: Date.now() - started, starts, deadline: report.deadline, late: report.steps.filter((step) => step.outcome !== 'ok').map((step) => `${step.name}:${step.outcome}`) } });
    // What the tabs counted while the page was away goes out now (the queue's own start flushed what was stored).
    if (rpc.tabs().length > 0) armAlarms();
  });
}
