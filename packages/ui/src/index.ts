// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).

// The M0 spike's placeholder dock, still what the tab composition mounts
// (apps/extension/lazy/entries/dock.ts). The real surfaces are `@cg/ui/dock`
// and `@cg/ui/overlays` (R14): the composition root switches to them.
export { Dock, type DockModel } from './spike/PlaceholderDock';
export { mountDock, type DockHandle } from './spike/mount-placeholder-dock';
export { mountPagePlaceholder } from './pages/mount';
export type { PlaceholderProps } from './pages/Placeholder';
