// core/services/diagnostics — debug and support data of the background
// (architecture.md §9.2, §9.3): the local AI spend journal,
// `diagnostics.get`, the export file and «Скопировать отчёт». The prompt
// snapshots of debug mode live in the hub layer's echo store (`@cg/hub`, the
// one place that receives the echo frame); here are only their counts.

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
  type PromptStoreStats,
} from './export';
export { clearDebugData, type DebugStores } from './lifecycle';
