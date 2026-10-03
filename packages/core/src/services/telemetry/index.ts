// core/services/telemetry — delivery of what leaves the browser with the
// `technicalAndInteraction` consent (architecture.md §9.6): the persistent
// queue with batching, backoff, 400/401/403 rules, sign-in binding and the
// consent purge; the client_health reporter; acceptance outcomes → queue.

export {
  HEALTH_QUEUE_MAX,
  TELEMETRY_POLICY,
  TelemetryQueue,
  classifyIngestFailure,
  type DropReason,
  type QueueOutcome,
  type IngestFailure,
  type TelemetryBinding,
  type TelemetryEvent,
  type TelemetryQueueDeps,
  type TelemetryQueueStats,
} from './queue';
export { HEALTH_TICK_MS, HealthReporter, type HealthReporterDeps, type HealthReporterStats, type HealthSendReason } from './health';
export { AcceptanceReporter, type AcceptanceCounts } from './acceptance';
