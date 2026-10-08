// Where a side panel of ours stands (architecture.md §12 п. 6 «composer не
// перекрыт»; ui-design §3.7, §9.4 п. 1). The fan panel and Coach are 320 px
// at the right edge of ChatSpace's container, the whole height under its top
// bar. When the composer reaches under that place (ChatSpace 0.172, or 0.195
// with its own panel of the fan closed), a panel over the whole height would
// lie on ChatSpace's Send button and on our strip's Тон, Split and persona:
// with a panel open the person could not send. Then the panel ends where our
// dock begins: the composer row, the strip and an open result stay free, at
// the price of a shorter panel while a result is open («Скрыть» gives its
// height back; the panel's own content scrolls as a whole when it gets too
// short, so nothing of it is out of reach).
//
// ChatSpace 0.195 shows its own ~320 px panel of the fan next to the chat
// (third live check, 2026-10-08): the conversation and its composer end left
// of it, and our panel stands over ChatSpace's. Nothing of the composer is
// under ours there, and a cut at the dock's top only took the panel's height:
// with a full Recap open, Coach and the fan panel were ~300 px tall, the
// Coach answer out of sight. So the panel is cut only when it would lie over
// the dock — the dock is as wide as the composer it sits on.
//
// The kit's side panel takes its box from `SurfaceGeometry.container`
// (contracts, frozen): the panels get the same geometry as every other
// surface, with the container cut at the dock's top when they must give way.
// Windows (Spenders, «Новые», the palette) keep the whole container: they are
// modal on purpose.
//
// The toasts stand top right, over the place of the panels (third live check:
// «Recap сохранён в хаб» lay on Coach's header). While a side panel is open
// the stack stands left of it, 20 px off — as it keeps 20 px off ChatSpace's
// rail — and comes back when the panel closes (ui-design §3.9).

import type { SurfaceGeometry } from '@cg/contracts/vm';

/** ChatSpace's top bar, where the kit's own fallback puts a panel without a container (ui-design §3.5: 44 px in 0.172.0). */
export const PANEL_TOP_FALLBACK_PX = 44;

/** The side panel's width: the kit's `SidePanel` (ui-design §3.7), at the right edge of the container or of the window. */
export const SIDE_PANEL_WIDTH_PX = 320;

/** Where our dock is on screen, in viewport pixels: its top and its horizontal extent (the composer's). */
export interface DockBox {
  readonly top: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The geometry of the side panels: `base` — the whole container — unless
 * the panel's 320 px at the container's right edge lie over the dock; then
 * the container ends at the dock's top. `dock` null — no dock on screen, the
 * panel keeps the whole container. Never taller than the container, never
 * negative.
 */
export function panelGeometryOf(base: SurfaceGeometry, dock: DockBox | null, viewport: { readonly width: number; readonly height: number }): SurfaceGeometry {
  if (dock === null) return base;
  const container = base.container ?? { left: 0, top: PANEL_TOP_FALLBACK_PX, width: viewport.width, height: Math.max(0, viewport.height - PANEL_TOP_FALLBACK_PX) };
  const panelRight = container.left + container.width;
  const panelLeft = panelRight - SIDE_PANEL_WIDTH_PX;
  // The composer ends left of the panel (ChatSpace's own panel of the fan is open) or starts right of it: the whole height.
  if (dock.right <= panelLeft || dock.left >= panelRight) return base;
  const height = Math.max(0, Math.min(container.height, Math.floor(dock.top - container.top)));
  return { ...base, container: { ...container, height } };
}

/** The toast stack's width and its gap to what it stands beside (ui-design §3.9). */
export const TOAST_WIDTH_PX = 360;
export const TOAST_GAP_PX = 20;
/** The narrowest stack beside a panel, and its margin to the window's left edge. */
const TOAST_MIN_WIDTH_PX = 240;
const TOAST_EDGE_PX = 16;

/** Where the toast stack stands: its right edge `right` px from the window's right edge, at most `width` wide. */
export interface ToastPlace {
  readonly right: number;
  readonly width: number;
}

/**
 * The toast stack beside an open side panel: left of the panel's 320 px at the
 * right edge of the container (of the window without one), `TOAST_GAP_PX`
 * off, up to 360 px wide. null — no side panel open, or a window too narrow
 * for a stack beside it (under ~600 px): the stack keeps its own place.
 */
export function toastPlaceOf(panelOpen: boolean, base: SurfaceGeometry, viewportWidth: number): ToastPlace | null {
  if (!panelOpen) return null;
  const panelLeft = base.container === null ? viewportWidth - SIDE_PANEL_WIDTH_PX : base.container.left + base.container.width - SIDE_PANEL_WIDTH_PX;
  const room = Math.floor(panelLeft - TOAST_GAP_PX - TOAST_EDGE_PX);
  if (room < TOAST_MIN_WIDTH_PX) return null;
  return { right: Math.max(0, Math.round(viewportWidth - panelLeft)) + TOAST_GAP_PX, width: Math.min(TOAST_WIDTH_PX, room) };
}
