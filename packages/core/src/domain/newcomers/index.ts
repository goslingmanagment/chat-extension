// core/domain/newcomers — «Новые» as pure rules (architecture.md §8.5, hub
// H-7; NF-*): the window and its cursor pass, rows and greeting statuses,
// the greeting lease, polling and «news once», the checks around a
// greeting, and local preview drafts. The controllers of core/application
// apply them.

export * from './claim';
export * from './drafts';
export * from './greeting';
export * from './poll';
export * from './rows';
export * from './window';
