// @cg/ui/palette — the ⌘K palette and the ⌘1–9 quick-jump popup (R15;
// architecture.md §9.1, §10.1; ui-design §3.8, §4.20, §10). Lazy surfaces of
// the overlay host over `palette` and `quick-jump`, through AppClient.

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { PALETTE_CSS, Palette } from './Palette';
import { QUICK_JUMP_CSS, QuickJump } from './QuickJump';

export { Palette, matchPieces, paletteRows, resolveSelection, type PaletteRow, type PaletteSelection } from './Palette';
export { QuickJump } from './QuickJump';

export const PALETTE_STYLES: StyleSource = { id: 'cg-palette', css: PALETTE_CSS };
export const QUICK_JUMP_STYLES: StyleSource = { id: 'cg-quick-jump', css: QUICK_JUMP_CSS };

/** What `mountSurface('palette', root, deps)` mounts. */
export const paletteSurface: SurfaceDefinition = { view: Palette, styles: [PALETTE_STYLES] };
/** What `mountSurface('quick-jump', root, deps)` mounts; it shares the palette's row styles. */
export const quickJumpSurface: SurfaceDefinition = { view: QuickJump, styles: [PALETTE_STYLES, QUICK_JUMP_STYLES] };
