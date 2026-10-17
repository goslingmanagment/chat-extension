// core/services — background services over ports (architecture.md §4, §7,
// §6.7, §14): the operation scheduler, the tab-side driver of a preview send,
// the registration of a proven human send, one-time action tokens, the
// readiness barrier, tab presence and the accounts this browser saw, the
// recap dossier save, the WS tap switch, the settings owner, the results
// store and the consent state. They import only @cg/contracts and
// core/domain; the composition roots give them the clock, storage, the hub
// facade, the tab event sink and ids. R17's sound and R18's logs, telemetry
// and diagnostics have their own entries (`@cg/core/services/sound`,
// `/logs`, `/telemetry`, `/diagnostics`).
//
// The fan custody of ChatSpace's own sends — the X8 send coordinator, its
// journal and fuse, the greeting leases of «Новые» — is `@cg/core/services/custody`:
// it runs in the background chunk `bg/chatspace.js`, never in the background
// core (docs/project-unite/architecture.md §3.3; the core's import graph is
// held to that by .dependency-cruiser.cjs `background-core-graph`).
//
// One implementation of each thing. Wave 1 brought two readiness barriers,
// two tab-presence services and two styles of ports; the background's
// composition root wired R07's barrier and presence (the platform's RPC mints
// and checks the tab sessions), and the unused twins — R10's `Readiness`,
// `TabSessions` and `AccountPresence` — are gone. What is left of the port
// styles is what a living service takes: R07's storage results and `Timers`
// (./storage/ports), R10's `Clock` with timers and the throwing key-value
// store (./ports), R18's `Scheduler` and one-key port (./ports, re-exported
// by `@cg/core/services/logs`).
//
// R07: the settings owner, the readiness barrier, the results store, tab
// presence and seen accounts, the consent state (and, in ./custody, the X8
// send journal) — all over
// the ports in ./storage/ports (the composition root passes @cg/platform's
// adapters, which have exactly those shapes).
//
// Wiring for the integrator (background composition root, top level, in
// this order — handlers synchronously before any await):
// 1. local/session = platform createKeyValueStore('local' | 'session',
//    { budgetOf: storageBudgetOf }) (core/domain): budgets refuse oversize
//    values before the browser; the default per-call timeout (5 s) keeps a
//    hung storage call from stalling the area.
// 2. barrier = createReadinessBarrier({ timers, log }) — `timers` is
//    REQUIRED ({ set: setTimeout, clear: clearTimeout }): it bounds each
//    step (5 s) and the whole barrier (10 s).
// 3. rpc = platform createBackgroundRpc({ ready: barrier.ready, tabHosts:
//    { chatspace: CHATSPACE_MATCHES (+ CHATSPACE_STAND_MATCHES in test builds) },
//    onTabRegistered: (i) => presence.tabRegistered(i.tabSessionId),
//    onTabGone: (i) => { presence.tabGone(i.tabSessionId); the scheduler
//    detaches the tab's operations (BG-006) } , … }).
// 4. settings = createSettingsOwner({ local, session, onChange: (state) =>
//    rpc.emit('settings.changed', state) }); rpc.handle each entry of
//    settingsRequestHandlers(settings). journal, results, presence and
//    consent (port: platform createConsent()) likewise.
// 5. barrier.start([settings, results, journal, presence, consent].map(…start)).
// 6. On unload nothing is needed; tests call dispose() to drop listeners.
// Results: R10 saves at phase changes and at the end, not per op.update batch.

// R07
export {
  type ConsentPortLike,
  type KeyValuePort,
  type ServiceLog,
  type ServiceLogEntry,
  type ServiceLogFields,
  type StorageChange,
  type StorageFailureCode,
  type StorageResult,
  type Timers,
} from './storage/ports';
export {
  READINESS_DEADLINE_MS,
  READINESS_STEP_TIMEOUT_MS,
  createReadinessBarrier,
  type ReadinessBarrier,
  type ReadinessOptions,
  type ReadinessReport,
  type ReadinessStep,
  type ReadinessStepReport,
} from './readiness';
export {
  createSettingsOwner,
  settingsRequestHandlers,
  type ServiceAnswer,
  type SettingsMode,
  type SettingsOwner,
  type SettingsOwnerDeps,
  type SettingsPatchRequest,
  type SettingsResult,
  type SettingsWriteResult,
} from './settings-owner';
export {
  RESULTS_LIMITS,
  createResultsStore,
  type ResultMeta,
  type ResultsLimits,
  type ResultsPutResult,
  type ResultsRecovery,
  type ResultsStore,
  type ResultsStoreDeps,
} from './results-store';
export {
  PRESENCE_REFRESH_MS,
  createPresence,
  type PresenceDeps,
  type PresenceService,
  type SeenAccountView,
  type TabPresence,
  type TabPresenceReport,
} from './presence';
export { createConsentState, type ConsentDeps, type ConsentState, type ConsentStatus } from './consent';

// R10 (./ports also holds R18's `Scheduler` and `KeyValuePort`, served by `@cg/core/services/logs`)
export { AbortSwitch, NO_LOG, WriteQueue, type Clock, type IdSource, type KeyValueStore, type LogEntry, type LogSink, type TabEventSink, type TimerHandle } from './ports';
export * from './tokens';
export { onInstalledPlan } from './install-plan';
export * from './ws-tap';
export * from './change-policy';
export * from './lazy-status';
export * from './scheduler';
export * from './profile-saver';
export * from './send-driver';
export * from './native-send';
export * from './send-attribution';

export { createSettingsExtOwner, type SettingsExtOwner } from './settings-owner';

export type { ScheduledStart, SiteOpDriver, SiteOperations } from './site-ops';
