// Where a side panel of ours stands (architecture.md §12 п. 6 «composer не
// перекрыт»; ui-design §3.7, §9.4 п. 1). The fan panel and Coach are 320 px
// at the right edge of ChatSpace's container. Over its whole height they
// would lie on ChatSpace's own Send button and on our strip's Тон, Split and
// persona: with a panel open the person could not send. Until the live check
// settles where panels sit on the real ChatSpace, a panel ends where our
// dock begins: the composer row, the strip and an open result stay free at
// every window width. The price is a shorter panel while a result is open —
// «Скрыть» gives its height back.
//
// The kit's side panel takes its box from `SurfaceGeometry.container`
// (contracts, frozen): the panels get the same geometry as every other
// surface, with the container cut at the dock's top. Windows (Spenders,
// «Новые», the palette) keep the whole container: they are modal on purpose.

import type { SurfaceGeometry } from '@cg/contracts/vm';

/** ChatSpace's top bar, where the kit's own fallback puts a panel without a container (ui-design §3.5: 44 px in 0.172.0). */
export const PANEL_TOP_FALLBACK_PX = 44;

/**
 * The geometry of the side panels: `base` with its container ending at
 * `dockTop` (viewport pixels; null — no dock on screen, the panel keeps the
 * whole container). Never taller than the container, never negative.
 */
export function panelGeometryOf(base: SurfaceGeometry, dockTop: number | null, viewport: { readonly width: number; readonly height: number }): SurfaceGeometry {
  if (dockTop === null) return base;
  const container = base.container ?? { left: 0, top: PANEL_TOP_FALLBACK_PX, width: viewport.width, height: Math.max(0, viewport.height - PANEL_TOP_FALLBACK_PX) };
  const height = Math.max(0, Math.min(container.height, Math.floor(dockTop - container.top)));
  return { ...base, container: { ...container, height } };
}
