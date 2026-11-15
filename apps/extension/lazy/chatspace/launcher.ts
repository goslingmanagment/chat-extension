// The launcher at the bottom of ChatSpace's account rail (2026-11-15; ui-design §3.13): «Онлайн», «Очереди», Spenders and
// «Новые» as on Fansly's corner card, the glyphs alone, in the rail's own flow right above ChatSpace's version. One chunk
// of ChatSpace's own build — plain DOM, no Preact, only the kit's token sheet — that the early bundle loads once the host
// port is up (host-chatspace isolated/starter.ts). Its click asks for the application, which opens the window
// (composition/tab/hosts/chatspace/app.ts). The buttons are host-kit's, Fansly draws the same ones (lazy/fansly/launcher.ts).

import { drawChatSpaceLauncher as draw, type RailLauncherEnv } from '@cg/host-chatspace/isolated/launcher';
import { THEME_CSS } from '@cg/ui/kit/tokens';

/** The buttons in the kit's own tokens: the chips by the composer, in colour and face. */
export function drawChatSpaceLauncher(env: Omit<RailLauncherEnv, 'tokens'>): () => void {
  return draw({ ...env, tokens: THEME_CSS });
}
