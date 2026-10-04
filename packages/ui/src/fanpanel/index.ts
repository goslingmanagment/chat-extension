// @cg/ui/fanpanel — the fan panel (R15; architecture.md §10.1, ui-design §3.7,
// §4.18): a 320 px side panel of the overlay host, layer 900. It renders
// `fan-panel` and, on its Recap tab, `recap.view`, through AppClient.

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { FAN_PANEL_CSS, FanPanel } from './FanPanel';

export { FanPanel } from './FanPanel';

export const FAN_PANEL_STYLES: StyleSource = { id: 'cg-fanpanel', css: FAN_PANEL_CSS };

/** What `mountSurface('fan-panel', root, deps)` mounts. */
export const fanPanelSurface: SurfaceDefinition = { view: FanPanel, styles: [FAN_PANEL_STYLES] };
