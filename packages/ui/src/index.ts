// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).

export { Dock, mountDock, type DockHandle, type DockModel } from './dock';
export { mountPagePlaceholder } from './pages/mount';
export type { PlaceholderProps } from './pages/Placeholder';
