// @cg/ui/newcomers — the «Новые» window (R15; architecture.md §10.1, ui-design
// §3.6, §4.17): the list of new, renewed and returning subscribers with the
// greeting status, and the card — the preview pane of Spenders with Hi only.
// A lazy surface of the overlay host: `newcomers` and `preview` (from
// `newcomers`) through AppClient.

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { PREVIEW_STYLES } from '../spenders/preview/Preview';
import { WINDOW_STYLES } from '../spenders/window';
import { NEWCOMERS_CSS, NewcomersWindow } from './NewcomersWindow';

export { NewcomersWindow, windowText } from './NewcomersWindow';

export const NEWCOMERS_STYLES: StyleSource = { id: 'cg-newcomers', css: NEWCOMERS_CSS };

/** What `mountSurface('newcomers', root, deps)` mounts. */
export const newcomersSurface: SurfaceDefinition = { view: NewcomersWindow, styles: [WINDOW_STYLES, PREVIEW_STYLES, NEWCOMERS_STYLES] };
