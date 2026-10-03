// core/domain/logging — structured logs of every context (architecture.md
// §5.7, §9.2; D-21): redaction shared before the console, the disk and the
// export, record limits, the ring, per-code daily counters, the tab-to-
// background forwarder, the mandatory events and the error capture helpers.
// Texts of conversations, drafts, prompts and model output are never logged.

export {
  REDACTED,
  MIN_SECRET_LENGTH,
  TOKEN_TAIL_LENGTH,
  LOG_VALUE_LIMITS,
  createRedactor,
  isAllowedStringField,
  lengthMark,
  sanitizeFields,
  sanitizeValue,
  scrubText,
  serializeError,
  tokenSecrets,
  truncateText,
  type Redactor,
  type SanitizeLimits,
  type SanitizeOptions,
} from './redact';
export { MSG_MAX_CHARS, buildRecord, cleanCtx, formatRecordLine, normalizeScope, recordBytes, type LogCtx, type RecordEnvironment, type RecordInput } from './record';
export { Ring } from './ring';
export { CodeCounters, localDayKey, type CodeCount, type CodeCountersSnapshot } from './counters';
export { createLogger, type ConsolePort, type LogOptions, type LogSink, type Logger, type LoggerOptions, type LoggerStats } from './logger';
export { FORWARDER_BACKLOG_MAX, createLogForwarder, type ForwarderOptions, type ForwarderStats, type LogForwarder } from './forwarder';
export {
  LOG_EVENTS,
  logEvent,
  logHostContract,
  logStart,
  logUsage,
  type HostContractFacts,
  type LogEventId,
  type LogEventSpec,
  type StartFacts,
  type UsageFacts,
} from './events';
export {
  CAPTURE_LIMITS,
  describeErrorEvent,
  describeRejection,
  installErrorCapture,
  logRpcFailure,
  type CaptureScope,
  type CapturedError,
  type ErrorCapture,
  type ErrorEventLike,
  type ErrorEventTargetLike,
  type RejectionEventLike,
  type RpcFailure,
} from './capture';
