// Where the side panels stand (tab/panel-geometry.ts).

import type { SurfaceGeometry } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { PANEL_TOP_FALLBACK_PX, SIDE_PANEL_WIDTH_PX, TOAST_GAP_PX, TOAST_WIDTH_PX, panelGeometryOf, toastPlaceOf, type DockBox } from './panel-geometry';

const base = (container: SurfaceGeometry['container']): SurfaceGeometry => ({ width: 853, feedHeight: null, viewportHeight: 900, container });
const VIEWPORT = { width: 1440, height: 900 };
/** A dock on a composer that reaches the container's right edge (ChatSpace 0.172, or 0.195 with its own panel closed). */
const under = (top: number, right = 1428): DockBox => ({ top, left: 396, right });

describe('a side panel over the composer ends where our dock begins (§12 п. 6: the composer is not covered)', () => {
  it('the container is cut at the dock’s top: the composer row, the strip and an open result stay free', () => {
    const container = { left: 64, top: 44, width: 1376, height: 856 };
    // The collapsed dock: the strip's top is the dock's top.
    expect(panelGeometryOf(base(container), under(790), VIEWPORT).container).toEqual({ left: 64, top: 44, width: 1376, height: 746 });
    // A result is open above the strip: the panel is shorter, the result is not covered.
    expect(panelGeometryOf(base(container), under(430.6), VIEWPORT).container).toEqual({ left: 64, top: 44, width: 1376, height: 386 });
    // Everything else of the geometry is the surfaces' common one.
    expect(panelGeometryOf(base(container), under(790), VIEWPORT)).toMatchObject({ width: 853, feedHeight: null, viewportHeight: 900 });
  });

  it('no dock on screen (no chat is open): the panel keeps the whole container', () => {
    const container = { left: 64, top: 44, width: 1376, height: 856 };
    const geometry = base(container);
    expect(panelGeometryOf(geometry, null, VIEWPORT)).toBe(geometry);
    expect(panelGeometryOf(base(null), null, VIEWPORT).container).toBeNull();
  });

  it('never taller than the container and never negative; without a container the panel is given one under ChatSpace’s top bar', () => {
    const container = { left: 0, top: 44, width: 1280, height: 400 };
    expect(panelGeometryOf(base(container), under(2000, 1270), VIEWPORT).container?.height).toBe(400);
    expect(panelGeometryOf(base(container), under(10, 1270), VIEWPORT).container?.height).toBe(0);
    expect(panelGeometryOf(base(null), under(700), VIEWPORT).container).toEqual({ left: 0, top: PANEL_TOP_FALLBACK_PX, width: 1440, height: 656 });
  });

  it('a dock that reaches a single pixel into the panel’s 320 px still cuts it: Send sits at the composer’s right end', () => {
    const container = { left: 64, top: 44, width: 1376, height: 856 };
    const panelLeft = 64 + 1376 - SIDE_PANEL_WIDTH_PX;
    expect(panelGeometryOf(base(container), under(500, panelLeft + 1), VIEWPORT).container?.height).toBe(456);
    // Without a container the panel stands at the window's right edge.
    expect(panelGeometryOf(base(null), under(500, VIEWPORT.width - SIDE_PANEL_WIDTH_PX + 1), VIEWPORT).container?.height).toBe(500 - PANEL_TOP_FALLBACK_PX);
  });
});

describe('a side panel beside the composer keeps its whole height (ChatSpace 0.195’s own panel of the fan is open; third live check)', () => {
  // The owner's window: 1728 × 930. ChatSpace 0.195: the conversation ends left of its own ~320 px panel of the fan and
  // the icon rail; the dock, as wide as the composer, ends at ~1340. A full Recap is open: the dock's top is at ~372.
  const LIVE = { width: 1728, height: 930 };

  it('[CS-031] with the full Recap open the panel is not cut to the ~300 px of the live check', () => {
    const geometry = base(null);
    expect(panelGeometryOf(geometry, { top: 372, left: 396, right: 1340 }, LIVE)).toBe(geometry);
    const fixed = base({ left: 64, top: 44, width: 1656, height: 878 });
    expect(panelGeometryOf(fixed, { top: 372, left: 396, right: 1340 }, LIVE)).toBe(fixed);
  });

  it('the dock’s right edge on the panel’s left edge is beside it, not under it', () => {
    const geometry = base(null);
    expect(panelGeometryOf(geometry, { top: 372, left: 396, right: LIVE.width - SIDE_PANEL_WIDTH_PX }, LIVE)).toBe(geometry);
  });

  it('ChatSpace’s panel closed again: the composer reaches the rail, under the panel — the cut is back', () => {
    expect(panelGeometryOf(base(null), { top: 372, left: 396, right: 1660 }, LIVE).container).toEqual({ left: 0, top: PANEL_TOP_FALLBACK_PX, width: 1728, height: 328 });
  });
});

describe('[ER-009] the toasts stand beside an open side panel, never over its header (third live check: «Recap сохранён в хаб» on Coach’s header)', () => {
  /** The panel's box and the stack's, in viewport pixels, as the kit draws them (ui-design §3.7, §3.9). */
  const boxes = (geometry: SurfaceGeometry, viewportWidth: number) => {
    const place = toastPlaceOf(true, geometry, viewportWidth);
    const panelLeft = geometry.container === null ? viewportWidth - SIDE_PANEL_WIDTH_PX : geometry.container.left + geometry.container.width - SIDE_PANEL_WIDTH_PX;
    return { place, panelLeft, stackRight: place === null ? null : viewportWidth - place.right, stackLeft: place === null ? null : viewportWidth - place.right - place.width };
  };

  it('no side panel open: the stack keeps its own place', () => {
    expect(toastPlaceOf(false, base(null), 1728)).toBeNull();
    expect(toastPlaceOf(false, base({ left: 64, top: 44, width: 1376, height: 856 }), 1440)).toBeNull();
  });

  it('the owner’s window (1728 px) and a narrow one (1100 px): the whole stack is left of the panel, 20 px off, 360 px wide', () => {
    for (const width of [1728, 1100]) {
      const { place, panelLeft, stackRight, stackLeft } = boxes(base(null), width);
      expect(place).toEqual({ right: SIDE_PANEL_WIDTH_PX + TOAST_GAP_PX, width: TOAST_WIDTH_PX });
      expect(panelLeft - (stackRight ?? Infinity)).toBe(TOAST_GAP_PX);
      expect(stackLeft).toBeGreaterThanOrEqual(16);
    }
  });

  it('ChatSpace’s fixed width: the panel stands at the container’s right edge, and the stack left of it', () => {
    const { place, panelLeft, stackRight } = boxes(base({ left: 144, top: 44, width: 1200, height: 856 }), 1440);
    expect(place).toEqual({ right: 1440 - (144 + 1200 - SIDE_PANEL_WIDTH_PX) + TOAST_GAP_PX, width: TOAST_WIDTH_PX });
    expect(panelLeft - (stackRight ?? Infinity)).toBe(TOAST_GAP_PX);
  });

  it('a window with less room than a stack beside the panel: the stack narrows down to 240 px, then keeps its own place', () => {
    // 680 px: 680 − 320 − 20 − 16 = 324 px of room.
    expect(toastPlaceOf(true, base(null), 680)).toEqual({ right: 340, width: 324 });
    expect(toastPlaceOf(true, base(null), 596)).toEqual({ right: 340, width: 240 });
    expect(toastPlaceOf(true, base(null), 595)).toBeNull();
  });
});
