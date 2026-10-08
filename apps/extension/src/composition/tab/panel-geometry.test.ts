// Where the side panels stand (tab/panel-geometry.ts).

import type { SurfaceGeometry } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { PANEL_TOP_FALLBACK_PX, SIDE_PANEL_WIDTH_PX, panelGeometryOf, type DockBox } from './panel-geometry';

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
