// What debug mode and the sign-in leave behind (architecture.md §9.3, §9.4):
// turning debug off or signing out clears the prompt snapshots and the
// journals; a sign-out also clears the local spend journal — everything
// that belongs to the person. Logs, counters and the telemetry queue have
// their own rules (the queue drops the old sign-in itself).

import { type DebugJournals } from '../logs';
import { type PromptSnapshotStore } from './prompts';
import { type SpendService } from './spend';

export interface DebugStores {
  readonly prompts: PromptSnapshotStore;
  readonly journals: DebugJournals;
  readonly spend: SpendService;
}

export function clearDebugData(stores: DebugStores, reason: 'debug-off' | 'sign-out'): void {
  stores.prompts.clear();
  stores.journals.clear();
  if (reason === 'sign-out') stores.spend.clear();
}
