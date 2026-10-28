// The dock's variant `telegram` (docs/specs/2026-10-27-telegram-site.md §6.6): the shared panel styled as Fansly's — the
// family's colours and face on every site (the kit's; X60) with the page's accent (host-telegram palette.ts). What
// differs is the dock's place: on Telegram it is the first row of the composer's pill (host-telegram mount.ts), so the
// card keeps clear of the pill's rounded edge and of the input row below it.
//
// A note here is a JS comment: a CSS one would ship in Telegram's application chunk, prose for nobody.

import { type HostSheet } from '@cg/contracts/vm';

export const TELEGRAM_DOCK_CSS = `
:host([data-dock-variant="telegram"]) .cg-root[data-cg-surface="dock"] { padding: 2px 2px 6px; }
`;

/** Telegram's profile adopts it into every root of its tab (`HostUiProfile.sheet`). */
export const TELEGRAM_DOCK_SHEET: HostSheet = { id: 'cg-telegram-dock', css: TELEGRAM_DOCK_CSS };
