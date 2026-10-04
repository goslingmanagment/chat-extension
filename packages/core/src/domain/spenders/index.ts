// core/domain/spenders — the Spenders board, its statistics and the archive
// feed of a preview as pure models (architecture.md §8.5, §8.7; SP-*,
// AI-038): rows and shelves from the hub's ranked board and tier buckets,
// search, filters and sorting, the «ждут ответа» queue, statistics with
// honest unknowns, feed pages with coverage and lag, and the board's keys.
// The controllers of core/application apply them.

export * from './board';
export * from './feed';
export * from './filters';
export * from './keyboard';
export * from './queue';
export * from './rows';
export * from './shelves';
export * from './stats';
