// Where the side panels stand (tab/panel-geometry.ts).

import type { SurfaceGeometry } from '@cg/contracts/vm';
import { describe, expect, it } from 'vitest';

import { PANEL_TOP_FALLBACK_PX, panelGeometryOf } from './panel-geometry';

const base = (container: SurfaceGeometry['container']): SurfaceGeometry => ({ width: 853, feedHeight: null, viewportHeight: 900, container });
const VIEWPORT = { width: 1440, height: 900 };

describe('a side panel ends where our dock begins (§12 п. 6: the composer is not covered)', () => {
  it('the container is cut at the dock’s top: the composer row, the strip and an open result stay free', () => {
    const container = { left: 64, top: 44, width: 1376, height: 856 };
    // The collapsed dock: the strip's top is the dock's top.
    expect(panelGeometryOf(base(container), 790, VIEWPORT).container).toEqual({ left: 64, top: 44, width: 1376, height: 746 });
    // A result is open above the strip: the panel is shorter, the result is not covered.
    expect(panelGeometryOf(base(container), 430.6, VIEWPORT).container).toEqual({ left: 64, top: 44, width: 1376, height: 386 });
    // Everything else of the geometry is the surfaces' common one.
    expect(panelGeometryOf(base(container), 790, VIEWPORT)).toMatchObject({ width: 853, feedHeight: null, viewportHeight: 900 });
  });

  it('no dock on screen (no chat is open): the panel keeps the whole container', () => {
    const container = { left: 64, top: 44, width: 1376, height: 856 };
    const geometry = base(container);
    expect(panelGeometryOf(geometry, null, VIEWPORT)).toBe(geometry);
    expect(panelGeometryOf(base(null), null, VIEWPORT).container).toBeNull();
  });

  it('never taller than the container and never negative; without a container the panel is given one under ChatSpace’s top bar', () => {
    const container = { left: 0, top: 44, width: 1280, height: 400 };
    expect(panelGeometryOf(base(container), 2000, VIEWPORT).container?.height).toBe(400);
    expect(panelGeometryOf(base(container), 10, VIEWPORT).container?.height).toBe(0);
    expect(panelGeometryOf(base(null), 700, VIEWPORT).container).toEqual({ left: 0, top: PANEL_TOP_FALLBACK_PX, width: 1440, height: 656 });
  });
});
