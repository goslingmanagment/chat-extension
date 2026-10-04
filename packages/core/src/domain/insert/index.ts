// core/domain/insert — building and judging writes into the host's composer
// (architecture.md §6.4, §6.5, Б2, D-10): the draft rule, one-time consents
// bound to a revision, open and deferred intents with their guards, Fix
// «Заменить мой черновик» and the 30-second «Вернуть мой текст», the
// «Открыть и вставить» lifecycle, receipts and the insert journal. Pure, for
// the tab's controllers; the host (R09) executes the intents.

export * from './confirmations';
export * from './deferred';
export * from './draft-rule';
export * from './fix';
export * from './intent';
export * from './journal';
export * from './receipt';
