// The launcher on ChatSpace (2026-11-15, the owner: «боковые эти кнопочки слева снизу на чатспейс … чтобы помещались
// очень так аккуратно там слева в панели снизу, чтобы не было разницы между фансли и чатспейсом»; ui-design §3.13):
// Fansly's corner card in ChatSpace's own place for it, the bottom of the account rail — the same boards in the same
// order, the same asks and keys, the glyphs alone (host-kit launcher-view.ts, look `icons`). Drawn by ChatSpace's
// `launcher` chunk (lazy/chatspace/launcher.ts) once the host port is up (starter.ts); its click asks for the
// application, which opens the window as the popup's command does (composition/tab/hosts/chatspace/app.ts).
//
// Where: the rail slot (rail-slot.ts) — in the rail's flow right before the version, or nowhere when the rail is not
// found; the port's route changes look for the rail again.

import type { SiteLauncher } from '@cg/host-kit/isolated/launcher';
import { drawLauncher } from '@cg/host-kit/isolated/launcher-view';
import type { ShadowRootRegistry } from '@cg/host-kit/isolated/shadow-registry';

import { createRailSlot, type RailSlotOptions } from './rail-slot';

export interface RailLauncherEnv {
  readonly doc: Document;
  /** The mount manager's registry: the slot's closed root is ours for the keys and the action gate. */
  readonly registry: ShadowRootRegistry;
  readonly launcher: SiteLauncher;
  /** The kit's token sheet (`THEME_CSS`), handed in by the chunk. */
  readonly tokens: string;
  /** `navigator.platform`, for the key in the tooltip. */
  readonly platform: string;
  /** ChatSpace's route changes (the port's `route` events): the rail is looked for again. */
  onRoute(listener: () => void): () => void;
  /** The first search ended without the rail (said once). */
  readonly onMissing?: RailSlotOptions['onMissing'];
}

/** The buttons in the rail's slot; the answer takes them and the slot out of the page. */
export function drawChatSpaceLauncher(env: RailLauncherEnv): () => void {
  const slot = createRailSlot(env.doc, env.registry, env.onMissing === undefined ? {} : { onMissing: env.onMissing });
  const erase = drawLauncher({ host: slot, launcher: env.launcher, tokens: env.tokens, platform: env.platform, look: 'icons' });
  const offRoute = env.onRoute(() => slot.sync());
  return () => {
    offRoute();
    erase();
    slot.dispose();
  };
}
