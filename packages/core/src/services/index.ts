// core/services — background services over ports (architecture.md §4, §7,
// §6.7, §14): the operation scheduler, the send coordinator and its tab-side
// driver, one-time action tokens, tab sessions, the readiness barrier, the
// recap dossier save and the WS tap switch. They import only @cg/contracts
// and core/domain; the composition roots give them the clock, storage, the
// hub facade, the tab event sink and ids.

export * from './ports';
export * from './tokens';
export * from './tabs';
export * from './readiness';
export * from './ws-tap';
export * from './scheduler';
export * from './profile-saver';
export * from './send-coordinator';
export * from './send-driver';
