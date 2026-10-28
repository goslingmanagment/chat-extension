// core/domain/telemetry — what leaves the browser with the
// `technicalAndInteraction` consent (architecture.md §5.7, §9.6; D-22):
// `ai_acceptance` lifecycle events built from the generation link, and the
// `client_health` window with fixed-bound histograms and counters. Delivery,
// the queue and consent gating are core/services/telemetry.

export {
  ACCEPTANCE_LINKS_MAX,
  AcceptanceTracker,
  type AcceptanceDeps,
  type AcceptanceOutcome,
  type AcceptanceSnapshot,
  type GenerationLink,
  type LinkSource,
  type PartPosition,
  type SentProof,
} from './acceptance';
export { Histogram, bucketIndex } from './histogram';
export {
  HEALTH_SAMPLES_PER_METRIC_MAX,
  HandlerSampler,
  HealthWindow,
  TabHealthCollector,
  hostSignature,
  hostSummary,
  type HealthClient,
  type HealthFootprint,
  type HealthWindowSnapshot,
  type HostSummary,
} from './health';
