// The floating launcher of a Fansly page, drawn (decision X46; ui-design §3.13; SP-001, NF-001): host-kit's card
// (launcher-view.ts) in its `rows` look — one raised card in the bottom left corner, a row per board with its glyph and
// its label, top to bottom as the dock's chips stand. The old Fansly extension had «$» and «Новые» there (`fansly-chat`
// src/content/bootstrap.css: left 18 px, bottom 18 px, every page). One chunk of Fansly's own lazy build
// (lazy/fansly/launcher.ts), loaded once the tab is admitted (starter.ts). The same buttons, glyphs alone, stand at the
// bottom of ChatSpace's account rail (host-chatspace isolated/launcher.ts).
//
// - Where: fixed, 16 px from the bottom left corner, on our layer under Fansly's modals (mount.ts `LAUNCHER_Z`): a
//   modal of Fansly's covers it, as it covers Fansly's own page. FBuddy's toasts stand bottom right, our toasts top
//   right, the vault's entry bottom right: the corner is nobody's. «Рассылка» folded stands above the card
//   (ui outreach.css.ts `.is-launcher`).

import { drawLauncher, type LauncherViewEnv as SiteLauncherViewEnv } from '@cg/host-kit/isolated/launcher-view';

/** What Fansly's card is drawn with: host-kit's, the look being Fansly's own. */
export type LauncherViewEnv = Omit<SiteLauncherViewEnv, 'look'>;

/** Draws the card with its rows into the host's root; the answer takes it out (the host stays the mounts'). */
export function drawFanslyLauncher(env: LauncherViewEnv): () => void {
  return drawLauncher({ ...env, look: 'rows' });
}
