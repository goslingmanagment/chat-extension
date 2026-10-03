// core/services/diagnostics — debug and support data of the background
// (architecture.md §9.2, §9.3): the prompt snapshot store, the local AI
// spend journal, `diagnostics.get`, the export file and «Скопировать отчёт».

export { PROMPT_STORE_MAX_CHARS, PromptSnapshotStore, type PromptStoreDeps, type PromptStoreStats } from './prompts';
export { SpendService } from './spend';
export {
  COPY_REPORT_MAX_CHARS,
  DiagnosticsService,
  EXPORT_FORMAT,
  PREVIOUS_TAIL_RECORDS,
  copyReport,
  diagnosticsSnapshot,
  exportJson,
  exportTxt,
  redactBundle,
  settingsForExport,
  summaryLines,
  type DiagnosticsFacts,
  type DiagnosticsServiceDeps,
  type ExportBundle,
  type ExportFile,
  type ExportLogs,
} from './export';
export { clearDebugData, type DebugStores } from './lifecycle';
