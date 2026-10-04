// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).
//
// What this root entry exports is the TEMPORARY scaffolding of the M1
// integration step, still what the composition roots mount: a status row for
// the dock and minimal options and popup pages. The real surfaces have their
// own subpaths — `@cg/ui/dock` and `@cg/ui/overlays` (R14) — and the
// composition roots switch to them in the wiring step; the temporary dock row
// lives next to the real dock (`./dock/TempDockStatus`, `./dock/mount`) but is
// not part of the `@cg/ui/dock` entry. The kit all of them use is `@cg/ui/kit`.

export { TEMP_DOCK_STYLES, TempDockStatus, type TempDockSmokeModel, type TempDockStatusProps } from './dock/TempDockStatus';
export { mountTempDock } from './dock/mount';
export { mountPagePlaceholder, mountTempPage } from './pages/mount';
export { TEMP_PAGES_STYLES, TempOptions, TempPopup, type TempPagePort, type TempPageStatus } from './pages/TempPages';
export type { PlaceholderProps } from './pages/Placeholder';
