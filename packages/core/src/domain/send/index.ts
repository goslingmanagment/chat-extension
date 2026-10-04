// core/domain/send — the rules of the X8 preview send (architecture.md §6.7):
// the attempt machine with id-linked receipts and echoes, locks per fan and
// per generation part, hub custody bodies and reports, Split groups,
// freshness and the served-context hold, the attempt journal and its
// restart rules, and the background's send conditions. Pure; the send
// coordinator (core/services) applies them, MAIN calls the queue.

export * from './attempt';
export * from './conditions';
export * from './custody';
export * from './freshness';
export * from './groups';
export * from './journal';
export * from './locks';
