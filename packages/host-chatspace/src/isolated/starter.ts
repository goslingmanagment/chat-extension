// The ChatSpace host as a site adapter starts it (docs/project-unite/
// architecture.md §1.3): the tab's ports in, the started host out. The
// extension's entry point assembles the ChatSpace adapter around this call —
// the adapter's type needs the application's TabEnv, which a package cannot
// import. Our hosts of a dead instance go first: an already-open tab after an
// update or a reinstall still shows them, and this instance owns the page now
// (§6.8 п. 8, UP-009). The rest is `startChatSpaceHost` (start.ts), as the
// e2e harness starts it; ChatSpace's own draft key still comes through the
// `drafts` port — the host never reads the page's storage itself (§4, §6.1).

import { removeStaleHosts } from '@cg/host-kit/isolated/hosts';

import { startChatSpaceHost, type StartChatSpaceHostOptions, type StartedChatSpaceHost } from './start';

export type ChatSpaceStartEnv = Pick<StartChatSpaceHostOptions, 'win' | 'redeem' | 'validation' | 'drafts' | 'navInsertTimeoutMs' | 'onDiagnostic'>;

export interface StartedChatSpaceTab extends StartedChatSpaceHost {
  /** Our hosts of a dead instance this start took out of the page. */
  readonly staleHosts: number;
}

export function startChatSpaceTab(env: ChatSpaceStartEnv): StartedChatSpaceTab {
  const staleHosts = removeStaleHosts(env.win.document);
  return { staleHosts, ...startChatSpaceHost(env) };
}
