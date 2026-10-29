// The fixed lists of «Очереди»'s window (2026-10-29), apart from its view model: the actions' schema reads them, and
// the view model's module reads the view's types, which read the actions — so these live with no imports at all.

/** «Пропустить ▾»: «Не подходит», «Позже» (back in three days), «Уже общаемся», «Не предлагать» (the team's mark). */
export const QUEUE_SKIP_REASONS = ['not_fit', 'later', 'talking', 'dismiss'] as const;
export type QueueSkipReason = (typeof QUEUE_SKIP_REASONS)[number];
