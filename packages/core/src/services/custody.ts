// core/services/custody — the fan custody of ChatSpace's own sends
// (architecture.md §6.7, §6.6; docs/project-unite/architecture.md §3.3): the
// X8 send coordinator, its attempt journal (R07) and the X8 fuse of the
// browser (decision X25), and the greeting leases of «Новые» (H-7). They run
// in the background chunk `bg/chatspace.js` over the ports of the background
// core's kit; the core itself never imports this entry (the core's import
// graph is checked: .dependency-cruiser.cjs `background-core-graph`). What
// both sites need — the registration of a human send and its journal of
// debts — stays in the core (`NativeSendRegistrar`, ./native-send) and
// reaches a chunk as the kit's `nativeSends` port.

export * from './greeting-leases';
export * from './send-coordinator';
export * from './send-fuse';
export {
  SEND_JOURNAL_LIMITS,
  SEND_JOURNAL_OPEN_STATES,
  createSendJournal,
  isOpenSendState,
  type SendJournal,
  type SendJournalAdvance,
  type SendJournalBegin,
  type SendJournalDeps,
  type SendJournalLimits,
  type SendJournalMode,
  type SendJournalRecovery,
  type SendJournalRefusal,
  type SendJournalRelease,
  type SendJournalStats,
  type SendJournalUpdate,
} from './send-journal';
