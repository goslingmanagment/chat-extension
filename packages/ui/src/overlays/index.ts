// @cg/ui/overlays — the overlays R14 owns (architecture.md §10.1; ui-design
// §3.4, §9.1 (б)): the toast host (not lazy), and three lazy surfaces — the
// Coach side panel (layer 900), the cheatsheet «?» and the «Развернуть ↗»
// window (layer 950). Each is a surface of the kit's MountPort with its own
// subpath (`@cg/ui/overlays/coach`…), so a composition root can make it a
// lazy entry with its own budget line; `lazyOverlays` gives the same
// surfaces through dynamic imports the bundler splits by itself. An overlay
// is on screen while it is mounted: the composition root mounts it when the
// controller opens the surface and unmounts it when it closes.

import { type MountSurfaceKind } from '@cg/contracts/vm';

import { type SurfaceDefinition } from '../kit';

export { overlayRootCss } from './layer';
export {
  TOASTS_STYLE,
  TOAST_LIFETIME_MS,
  TOAST_LIMIT,
  ToastsView,
  createToastHost,
  createToastsSurface,
  mountToasts,
  toastsSurface,
  type LocalToast,
  type ToastHost,
  type ToastHostOptions,
  type ToastsViewProps,
} from './toasts/index';

/** The lazy overlays of R14 by the surface they mount as. */
export const LAZY_OVERLAY_KINDS = ['coach', 'cheatsheet', 'result-expanded'] as const satisfies readonly MountSurfaceKind[];
export type LazyOverlayKind = (typeof LAZY_OVERLAY_KINDS)[number];

/** Loads an overlay's chunk and answers with its surface definition. */
export const lazyOverlays: Readonly<Record<LazyOverlayKind, () => Promise<SurfaceDefinition>>> = {
  coach: () => import('./coach/index').then((module) => module.coachSurface),
  cheatsheet: () => import('./cheatsheet/index').then((module) => module.cheatsheetSurface),
  'result-expanded': () => import('./expanded/index').then((module) => module.expandedSurface),
};
