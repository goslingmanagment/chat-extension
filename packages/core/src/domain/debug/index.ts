// core/domain/debug — debug mode's models (architecture.md §9.3): the stage
// profiler, usage and the local AI spend journal, a generation's proof, and
// where debug blocks show.

export {
  CLIENT_STAGES,
  PROFILE_SEGMENTS,
  SEGMENT_LABEL_KEYS,
  profileOf,
  type ClientStage,
  type Profile,
  type ProfileSegment,
  type SegmentName,
  type StageMark,
} from './profiler';
export {
  LocalSpendJournal,
  SPEND_DAYS_KEPT,
  formatCostLine,
  formatMicroUsd,
  usageHead,
  type CostLineFacts,
  type SpendReport,
  type SpendTotals,
  type UsageFrame,
  type UsageNumbers,
} from './usage';
export { showDebugBlock } from './mode';

export { generationDebug } from './op-debug';
