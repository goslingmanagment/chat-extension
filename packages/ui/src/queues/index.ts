// @cg/ui/queues — «Очереди» (2026-10-29): its window, one on both sites (view `queues`, the card the preview from
// `queue`, «Онлайн»'s own). A lazy surface of the overlay host, in the window layer.

import { type SurfaceDefinition } from '../kit';
import { NEWCOMERS_CARD_STYLES } from '../newcomers/card.css';
import { NEWCOMERS_FRAME_STYLES } from '../newcomers/frame.css';
import { ONLINE_STYLES } from '../online/online.css';
import { OUTREACH_STYLES } from '../outreach/outreach.css';
import { WINDOW_STYLES } from '../spenders/window';
import { QUEUES_STYLES } from './queues.css';
import { QueuesWindow } from './window';

export { QueuesWindow, CLOSE_QUEUES, howText } from './window';

/** What `mountSurface('queues', root, deps)` mounts. */
export const queuesSurface: SurfaceDefinition = { view: QueuesWindow, styles: [WINDOW_STYLES, NEWCOMERS_FRAME_STYLES, NEWCOMERS_CARD_STYLES, OUTREACH_STYLES, ONLINE_STYLES, QUEUES_STYLES] };
