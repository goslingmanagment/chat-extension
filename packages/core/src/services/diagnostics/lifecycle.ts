// What debug mode and the sign-in leave behind (architecture.md §9.3, §9.4):
// «Выключение отладки или выход очищают всё» — turning debug off or signing
// out clears the prompt snapshots, the journals and the local spend journal
// (DB-022 data is debug data). Logs, counters and the telemetry queue have
// their own rules (the queue drops the old sign-in itself).

import { type DebugJournals } from '../logs';
import { type PromptSnapshotStore } from './prompts';
import { type SpendService } from './spend';

export interface DebugStores {
  readonly prompts: PromptSnapshotStore;
  readonly journals: DebugJournals;
  readonly spend: SpendService;
}

/** Debug turned off, or signed out: both clear the same. */
export function clearDebugData(stores: DebugStores): void {
  stores.prompts.clear();
  stores.journals.clear();
  stores.spend.clear();
}
