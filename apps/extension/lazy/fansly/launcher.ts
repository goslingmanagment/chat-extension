// The floating launcher of a Fansly tab (decision X46; ui-design §3.13; SP-001, NF-001): «Онлайн», «Spenders» and «Новые» in the
// bottom left corner of every fansly.com page, one chunk of Fansly's own build — plain DOM, no Preact, only the kit's token sheet — that
// the early bundle loads once the tab is admitted (host-fansly isolated/starter.ts). Its click asks for the application,
// which opens the window (composition/tab/hosts/fansly/app.ts). A ChatSpace tab never loads it.

import { drawFanslyLauncher as draw, type LauncherViewEnv } from '@cg/host-fansly/isolated/launcher-view';
import { THEME_CSS } from '@cg/ui/kit/tokens';

/** The buttons in the kit's own tokens: the chips by the composer, in colour and face (2026-10-20). */
export function drawFanslyLauncher(env: Omit<LauncherViewEnv, 'tokens'>): () => void {
  return draw({ ...env, tokens: THEME_CSS });
}
