// @cg/ui/preview — the preview's own window (CS-030, decision X24): a fan the
// palette's «Онлайн» lists, looked at without opening the chat. A lazy surface
// of the overlay host (layer 950) over `preview` from `palette`, through
// AppClient; the pane itself is the Spenders preview (`@cg/ui/spenders`).

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { PREVIEW_STYLES } from '../spenders/preview/Preview';
import { PREVIEW_WINDOW_CSS, PreviewWindow } from './PreviewWindow';

export { PreviewWindow } from './PreviewWindow';

export const PREVIEW_WINDOW_STYLES: StyleSource = { id: 'cg-preview-window', css: PREVIEW_WINDOW_CSS };

/** What `mountSurface('preview', root, deps)` mounts. */
export const previewWindowSurface: SurfaceDefinition = { view: PreviewWindow, styles: [PREVIEW_STYLES, PREVIEW_WINDOW_STYLES] };
