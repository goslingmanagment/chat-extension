// The ChatSpace host as a site adapter starts it (docs/project-unite/
// architecture.md §1.3): the tab's ports in, the started host out. The
// extension's entry point assembles the ChatSpace adapter around this call —
// the adapter's type needs the application's TabEnv, which a package cannot
// import. Our hosts of a dead instance go first: an already-open tab after an
// update or a reinstall still shows them, and this instance owns the page now
// (§6.8 п. 8, UP-009). The rest is `startChatSpaceHost` (start.ts), as the
// e2e harness starts it; ChatSpace's own draft key still comes through the
// `drafts` port — the host never reads the page's storage itself (§4, §6.1).
//
// The launcher at the bottom of the account rail (2026-11-15, ui-design §3.13:
// Fansly's corner buttons, ChatSpace's place): a chunk of ChatSpace's lazy
// build (lazy/chatspace/launcher.ts), drawn once the host port is up — never
// at document_start. From its first click on the application is wanted
// (`wantsApp`), composer or not: the board it asked for comes with it.

import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import type { RailLauncherEnv } from './launcher';
import { startChatSpaceHost, type StartChatSpaceHostOptions, type StartedChatSpaceHost } from './start';

/** The launcher's chunk of ChatSpace's lazy build (lazy/chatspace/launcher.ts): the rail's slot and its buttons. */
export interface RailLauncherChunk {
  /** The chunk hands the kit's token sheet in itself (`RailLauncherEnv.tokens`). */
  drawChatSpaceLauncher(env: Omit<RailLauncherEnv, 'tokens'>): () => void;
}

export type ChatSpaceStartEnv = Pick<StartChatSpaceHostOptions, 'win' | 'redeem' | 'validation' | 'drafts' | 'navInsertTimeoutMs' | 'onDiagnostic'> & {
  /** The rail launcher's chunk; absent — no launcher (the e2e harness, tests). */
  readonly launcher?: () => Promise<RailLauncherChunk>;
};

export interface StartedChatSpaceTab extends StartedChatSpaceHost {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
  /**
   * The application is wanted without a composer: from the first click on the rail's launcher on, the window it asked
   * for comes with the application (each click says it again: a load that failed is asked for again, UP-016).
   */
  readonly wantsApp: { current(): boolean; onChange(listener: () => void): () => void };
}

export function startChatSpaceTab(env: ChatSpaceStartEnv): StartedChatSpaceTab {
  const staleHosts = removeStaleHosts(env.win.document);
  const started = startChatSpaceHost(env);
  const { launcher } = started;
  const draw = env.launcher;
  if (draw !== undefined) {
    void started.host
      .then(async (port) => {
        const chunk = await draw();
        chunk.drawChatSpaceLauncher({
          doc: env.win.document,
          registry: started.mounts.registry,
          launcher,
          platform: env.win.navigator.platform,
          onRoute: (listener) =>
            port.subscribe((event) => {
              if (event.type === 'route') listener();
            }),
          onMissing: () => env.onDiagnostic?.({ event: 'rail-missing' }),
        });
      })
      .catch((error: unknown) => {
        env.onDiagnostic?.({ event: 'launcher-failed', detail: { name: error instanceof Error ? error.name : typeof error } });
      });
  }
  const wantsApp = { current: () => launcher.wanted(), onChange: (listener: () => void) => launcher.onWanted(listener) };
  return { staleHosts, ...started, wantsApp };
}
