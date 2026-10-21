// core/application/journal — the chatter's log (2026-10-21, «Скачать лог»): what the person pressed, what our
// surfaces decided and why, the toasts, the configuration; written by the tab's composition, read in the file the
// chatter sends the owner. Facts only — ids, codes, states, our own sentences; never a text of a conversation.

export { actionFacts, handleFacts, isQuietAction, receiptFacts } from './actions';
export {
  AVAILABLE,
  PASSING_REASONS,
  diffAvailability,
  dockAvailability,
  newcomersAvailability,
  previewAvailability,
  sameAvailability,
  spendersAvailability,
  type Availability,
  type AvailabilityChange,
  type AvailabilityMap,
  type Say,
} from './availability';
export { changedFields, configFacts, flattenMachine, settingsWords, type ConfigInput } from './config';
export {
  ACTION_JOIN_MS,
  DECISIONS_PER_RECORD,
  JOURNAL_SCOPES,
  createActionJournal,
  createConfigWatch,
  createDecisionWatch,
  logToast,
  type ActionContext,
  type ActionInput,
  type ActionJournal,
  type ConfigWatch,
  type DecisionWatch,
  type JournalLog,
  type ToastFacts,
} from './watch';
