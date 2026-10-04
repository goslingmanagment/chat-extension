// core/services/logs — the background's log sinks (architecture.md §9.2):
// the persistent IndexedDB log behind a platform port, the second redaction
// of records from tabs and pages, and the debug journals (NF-029).

export {
  LOG_STORE_LIMITS,
  LOG_WRITE_POLICY,
  LogService,
  MemoryLogStore,
  type LogServiceOptions,
  type LogSessionInfo,
  type LogStoreFailure,
  type LogStoreLimits,
  type LogStorePort,
  type LogStoreStats,
  type StoredLog,
} from './store';
export {
  CHECK_JOURNAL_LIMITS,
  CheckJournal,
  DebugJournals,
  JOURNAL_RING_SIZE,
  JOURNAL_SCOPES,
  type CheckRunInfo,
  type JournalRead,
} from './journals';
export { acceptUiRecords, type UiRecordsOptions, type UiRecordsSender } from './ui-records';
export { type KeyValuePort, type Scheduler } from '../ports';
