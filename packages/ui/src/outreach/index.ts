// @cg/ui/outreach — «Рассылка» (2026-10-25): its window, one on both sites (view `outreach`, the card the preview from
// `outreach`), and the chip it folds into. Lazy surfaces of the overlay host: the window in the window layer, the chip
// over the page while the window is folded.

import { createElement } from 'preact';

import { type SurfaceDefinition } from '../kit';
import { NEWCOMERS_CARD_STYLES } from '../newcomers/card.css';
import { NEWCOMERS_FRAME_STYLES } from '../newcomers/frame.css';
import { MEDIA_PICKER_CSS } from '../spenders/preview/MediaPicker';
import { WINDOW_STYLES } from '../spenders/window';
import { OutreachChip } from './chip';
import { OUTREACH_CHIP_STYLES, OUTREACH_STYLES } from './outreach.css';
import { OutreachWindow } from './window';

export { OutreachWindow, CLOSE_OUTREACH } from './window';
export { OutreachChip } from './chip';

const PICKER_STYLES = { id: 'cg-outreach-picker', css: MEDIA_PICKER_CSS };

/** What `mountSurface('outreach', root, deps)` mounts. */
export const outreachSurface: SurfaceDefinition = { view: OutreachWindow, styles: [WINDOW_STYLES, NEWCOMERS_FRAME_STYLES, NEWCOMERS_CARD_STYLES, PICKER_STYLES, OUTREACH_STYLES] };

/** The chip of a folded outreach: `rail` — beside a column of accounts at the page's left edge; `launcher` — above the page's own buttons in its corner. */
export function outreachChipSurface(place: 'rail' | 'launcher'): SurfaceDefinition {
  return { view: () => createElement(OutreachChip, { place }), styles: [OUTREACH_CHIP_STYLES] };
}
