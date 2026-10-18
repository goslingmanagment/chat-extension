// The dock's variant `fansly` (docs/project-unite/architecture.md §1.5, R20 P8d; ui-design §3.1 «Вариант Fansly»):
// the rules our roots on a Fansly page take after the kit's and the surface's sheets, keyed on the variant the
// mount puts on the host (`data-dock-variant`). The panel itself is the shared one in the family look (FS-DOCK-1);
// the colours are the family's warm palette with the page's blue (host-fansly isolated/palette.ts), so what differs
// here is the dock's place and the face.
//
// On ChatSpace the dock is the top of the composer's own frame. On Fansly it stands in the message container right
// before `app-group-message-input`, which spans the column edge to edge and keeps its controls 0.25em in from
// both edges, under a hairline: the card keeps to that line, 4 px in from the column on each side, and stands
// 4 px clear of the hairline below it. Widths need nothing else: the shared container queries fold the bar by the
// dock's own width — 622 px in a 1728 px window, 381 px beside a neighbour's panel (ui-design §3.3).
//
// The face is the old Fansly extension's (decision X57): the system UI font, smoothed as it smoothed it — not the
// page's Roboto, whose 600 read heavy beside our serif drafts. Every root of ours on a Fansly page wears it.
//
// A note here is a JS comment: a CSS one would ship in Fansly's application chunk, prose for nobody.

import { type HostSheet } from '@cg/contracts/vm';

export const FANSLY_DOCK_CSS = `
:host([data-dock-variant="fansly"]) .cg-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
:host([data-dock-variant="fansly"]) .cg-root[data-cg-surface="dock"] { padding: 0 4px 4px; }
`;

/** Fansly's profile adopts it into every root of its tab (`HostUiProfile.sheet`); the overlays have nothing of it to match. */
export const FANSLY_DOCK_SHEET: HostSheet = { id: 'cg-fansly-dock', css: FANSLY_DOCK_CSS };
