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
