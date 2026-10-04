// @cg/ui — Preact surfaces (architecture.md §10). Data comes only through
// AppClient (§10.2, R01); no host-*, platform or hub imports, no browser.*,
// fetch or timers in idle (§4). Function components and hooks only — the
// common subset of Preact 10 and 11 (D-05).
//
// The surfaces have their own subpaths — `@cg/ui/dock`, `@cg/ui/overlays`,
// `@cg/ui/spenders`, `@cg/ui/newcomers`, `@cg/ui/fanpanel`, `@cg/ui/palette`,
// `@cg/ui/pages` — and the kit all of them use is `@cg/ui/kit`. What this root
// entry still exports is the TEMPORARY scaffolding of the M1 integration step
// the extension pages mount until R16's pages are wired: minimal options and
// popup pages.

export { mountPagePlaceholder, mountTempPage } from './pages/mount';
export { TEMP_PAGES_STYLES, TempOptions, TempPopup, type TempPagePort, type TempPageStatus } from './pages/TempPages';
export type { PlaceholderProps } from './pages/Placeholder';
