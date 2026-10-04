// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).
//
// What is here now is TEMPORARY scaffolding of the M1 integration step: a
// status row for the dock (R14 builds the dock) and minimal options and popup
// pages (R16 builds the pages). The kit they are made of is `@cg/ui/kit`.

export { TEMP_DOCK_STYLES, TempDockStatus, mountTempDock, type TempDockSmokeModel, type TempDockStatusProps } from './dock';
export { mountPagePlaceholder, mountTempPage } from './pages/mount';
export { TEMP_PAGES_STYLES, TempOptions, TempPopup, type TempPagePort, type TempPageStatus } from './pages/TempPages';
export type { PlaceholderProps } from './pages/Placeholder';
