// @cg/ui/online — «Онлайн» (2026-10-26): its window, one on both sites (view `online`, the card the preview from
// `online`). A lazy surface of the overlay host, in the window layer.

import { type SurfaceDefinition } from '../kit';
import { NEWCOMERS_CARD_STYLES } from '../newcomers/card.css';
import { NEWCOMERS_FRAME_STYLES } from '../newcomers/frame.css';
import { OUTREACH_STYLES } from '../outreach/outreach.css';
import { WINDOW_STYLES } from '../spenders/window';
import { ONLINE_STYLES } from './online.css';
import { OnlineWindow } from './window';

export { OnlineWindow, CLOSE_ONLINE } from './window';

/** What `mountSurface('online', root, deps)` mounts. */
export const onlineSurface: SurfaceDefinition = { view: OnlineWindow, styles: [WINDOW_STYLES, NEWCOMERS_FRAME_STYLES, NEWCOMERS_CARD_STYLES, OUTREACH_STYLES, ONLINE_STYLES] };
