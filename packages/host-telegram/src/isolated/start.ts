// The Telegram host as a site adapter starts it (docs/specs/2026-10-27-telegram-site.md §4, §6.5): synchronous, at
// document_start, in the isolated world only — Telegram has no MAIN script. Our hosts of a dead instance go first
// (an update injects the new script into an open tab), then the keys of our roots are held on `window` (keys.ts;
// before the tab's own dispatcher starts), then the mounts, the theme and the port, which follows the page from its
// first moment and places the dock once a person's chat is open.

import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import type { SessionRead } from './account';
import { createTelegramHostPort, type TelegramDiagnostic, type TelegramPort, type TokenRedeemer } from './host-port';
import { isolateOurKeys, type KeyIsolation } from './keys';
import { createTelegramMounts, type TelegramMounts } from './mount';
import { createTelegramTheme, type TelegramTheme } from './theme';

export interface TelegramStartEnv {
  readonly win: Window;
  /** The page's storage as the entry point reads it: the active slot's session entry only. */
  readonly session: SessionRead;
  readonly redeem: TokenRedeemer;
  readonly onDiagnostic?: (diagnostic: TelegramDiagnostic) => void;
}

export interface StartedTelegramTab {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
  readonly mounts: TelegramMounts;
  readonly theme: TelegramTheme;
  readonly keys: KeyIsolation;
  /** No MAIN world on Telegram. */
  readonly bridge: Promise<null>;
  readonly host: Promise<TelegramPort>;
}

export function startTelegramTab(env: TelegramStartEnv): StartedTelegramTab {
  const doc = env.win.document;
  const staleHosts = removeStaleHosts(doc);
  const mounts = createTelegramMounts(doc);
  // Before the tab's dispatcher: a key of our roots never reaches Telegram's listener on `document`.
  const keys = isolateOurKeys(env.win, mounts.registry);
  const theme = createTelegramTheme(doc);
  const port = createTelegramHostPort({ win: env.win, mounts, theme, session: env.session, redeem: env.redeem, ...(env.onDiagnostic === undefined ? {} : { onDiagnostic: env.onDiagnostic }) });
  const withKeys: TelegramMounts = {
    ...mounts,
    dispose() {
      keys.dispose();
      mounts.dispose();
    },
  };
  return { staleHosts, mounts: withKeys, theme, keys, bridge: Promise.resolve(null), host: Promise.resolve(port) };
}

/** The route by the address alone, for a key pressed before the host reported one: a person's chat is `#<id>`. */
export function routeOfLocation(location: Pick<Location, 'pathname' | 'hash'>): { readonly kind: 'chat' | 'account' | 'other'; readonly epoch: string } {
  return { kind: /^#[1-9]\d{0,19}$/.test(location.hash) ? 'chat' : 'other', epoch: `${location.pathname}${location.hash}` };
}
