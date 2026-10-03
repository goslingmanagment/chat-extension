// core/services — background services over ports (architecture.md §4):
// op scheduler, send coordinator, telemetry queue, log sink, settings owner,
// sound arbiter, tab presence. R10, R17, R18 fill in the rest.
//
// R07: the settings owner, the readiness barrier, the results store, the X8
// send journal, tab presence and seen accounts, the consent state — all over
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
//    { chatspace: CHATSPACE_MATCHES (+ LOOPBACK_MATCHES in test builds) },
//    onTabRegistered: (i) => presence.tabRegistered(i.tabSessionId),
//    onTabGone: (i) => { presence.tabGone(i.tabSessionId); R10 cancels the
//    tab's operations (RB-010) } , … }).
// 4. settings = createSettingsOwner({ local, session, onChange: (state) =>
//    rpc.emit('settings.changed', state) }); rpc.handle each entry of
//    settingsRequestHandlers(settings). journal, results, presence and
//    consent (port: platform createConsent()) likewise.
// 5. barrier.start([settings, results, journal, presence, consent].map(…start)).
// 6. On unload nothing is needed; tests call dispose() to drop listeners.
// Results: R10 saves at phase changes and at the end, not per op.update batch.

/** Marker export so the entry exists in the package graph before R10 lands. */
export const SERVICES_LAYER = 'core/services' as const;

export {
  NO_LOG,
  SYSTEM_CLOCK,
  createWriteChain,
  type Clock,
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
  SEND_JOURNAL_LIMITS,
  SEND_JOURNAL_OPEN_STATES,
  createSendJournal,
  isOpenSendState,
  type SendJournal,
  type SendJournalAdvance,
  type SendJournalBegin,
  type SendJournalDeps,
  type SendJournalLimits,
  type SendJournalMode,
  type SendJournalRecovery,
  type SendJournalRefusal,
  type SendJournalRelease,
  type SendJournalStats,
  type SendJournalUpdate,
} from './send-journal';
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
