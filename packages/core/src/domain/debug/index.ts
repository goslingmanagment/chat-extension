// core/domain/debug — debug mode's models (architecture.md §9.3): the prompt
// snapshot content and its view, the stage profiler and the hub's stages,
// usage and the local AI spend journal, the context card and reasoning, the
// per-operation debug builder, and the switches of debug mode.

export {
  PROMPT_VIEW_MAX_BLOCKS,
  TRUNCATED_MARK,
  cutText,
  isTruncatedText,
  promptView,
  snapshotFromFrame,
  type DebugInputFrame,
  type PromptBlock,
  type PromptSnapshotContent,
  type PromptViewState,
} from './prompt';
export {
  CLIENT_STAGES,
  HUB_STAGE_NAMES,
  PROFILE_SEGMENTS,
  SEGMENT_LABEL_KEYS,
  StageMarks,
  hubStageSummary,
  hubStagesFromManifest,
  profileOf,
  type ClientStage,
  type HubStage,
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
  usageOf,
  type CostLineFacts,
  type SpendReport,
  type SpendTotals,
  type UsageFrame,
  type UsageNumbers,
} from './usage';
export { OpDebugBuilder, REASONING_MAX_CHARS, ReasoningBuffer, contextCard, type ContextFrame } from './op-debug';
export {
  createRenderTrace,
  debugFeatures,
  maskedTail,
  showDebugBlock,
  withDebugCapability,
  type DebugFeatures,
} from './mode';

export { generationDebug } from './op-debug';
