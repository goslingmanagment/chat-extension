// core/application — controllers for the tab and the extension pages: surface
// state → view models (architecture.md §4, §10.2). The router is the AppClient
// every surface gets; R11, R12, R16 and R17 plug their controllers into it.

export {
  UnservedViewError,
  ViewListeners,
  createAppRouter,
  type AppRouter,
  type AppRouterOptions,
  type RouterFailure,
  type SurfaceController,
} from './router';
// TEMPORARY (M1 integration): the dock's status until R11's dock controller lands.
export {
  TEMP_DOCK_INITIAL,
  createTempDockStatus,
  type TempDockFacts,
  type TempDockSmoke,
  type TempDockStatusController,
  type TempDockStatusDeps,
} from './temp-dock-status';
// TEMPORARY (M1 integration): the action catalog without keys until R17's hotkey layer lands.
export { createUnboundCatalog } from './temp-catalog';

// The surface controllers are NOT re-exported here: each family has its own
// subpath, so a lazy entry takes one family and this barrel stays the router's
// (the `tab-app` chunk imports it and has a 30 KiB budget, §11).
//   R11 — `@cg/core/application/ai` (dock, Recap, Review, Coach);
//   R12 — `@cg/core/application/boards` (the factory) and `/spenders`,
//         `/preview`, `/newcomers`, `/fanpanel`;
//   R16 — `@cg/core/application/pages` (the extension pages' client);
//   R17 — `@cg/core/application/hotkeys`, `@cg/core/application/navigation`.
// R11, R12 and R17 were written before the router existed in their branches and
// each declares a structural `SurfaceController` of its own (`ai/ports.ts`,
// `boards/surface.ts`, `navigation/ports.ts`; looser `kinds` and snapshot
// types than the router's): the wiring step brings the three to the router's.
