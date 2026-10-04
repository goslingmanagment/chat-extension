// The tab's side of client_health (R18; architecture.md §9.6): perf marks and
// counters into a window, reported to the background. Loaded once the dock is
// on screen — nothing of it is needed to draw anything.

export { startTabHealth, type TabHealth, type TabHealthEnv } from '../../src/composition/tab/health';
