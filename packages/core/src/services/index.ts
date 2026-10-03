// core/services — background services over ports (architecture.md §4):
// op scheduler, send coordinator, telemetry queue, log sink, settings owner,
// sound arbiter, tab presence. R10, R17, R18 fill this in.

/** Marker export so the entry exists in the package graph before R10 lands. */
export const SERVICES_LAYER = 'core/services' as const;
