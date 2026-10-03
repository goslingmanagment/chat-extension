// core/services — background services over ports (architecture.md §4):
// op scheduler, send coordinator, telemetry queue, log sink, settings owner,
// sound arbiter, tab presence. R10, R17, R18 fill in the rest.
//
// R07: the settings owner and the readiness barrier — over
// the ports in ./storage/ports (the composition root passes @cg/platform's
// adapters, which have exactly those shapes).

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
  type SettingsWriteResult,
} from './settings-owner';
