// The always-on ChatSpace tab's report (hub `clientChatspaceTabState`, `chatspace-tab-state-v1`; hub
// apps/chatspace-browser): a Firefox on the agency's server keeps ChatSpace open with the OnlyFans accounts, so its
// socket — the hub's OnlyFans feed — goes on at night. Its enterprise policy tells the extension so (`serverTab`).
//
// - Once a minute (the background's own alarm, armed only in that Firefox, with or without a ChatSpace tab): the view
//   the ChatSpace tabs sit on and, for each OnlyMonster account ChatSpace loaded, whether its socket covers it now (the
//   tap's `coverage`, as the tabs reported it with their presence).
// - No ChatSpace tab is a report too (`none`): OnlyMonster's sign-in lives on onlymonster.ai, where the extension does
//   not run, so a signed-out tab looks like no tab at all — the hub pages the owner either way.
// - A report of what is, never owed: nothing is journaled or repeated; a lost report is just lost. Only the server's
//   own hub user's reports are kept by the hub, which judges them and pages the owner.

import { SERVER_TAB_LIMITS, type HubFacade, type ServerTabRoute, type ServerTabStateRequest } from '@cg/contracts/hub';

import { NO_LOG, type Clock, type LogSink } from './ports';

/** A ChatSpace tab as presence knows it. */
export interface ServerTabSeen {
  /** A fan's chat is open in it. */
  readonly chatOpen: boolean;
  /** The account its route is on (an OnlyMonster id); null — none (the Accounts Overview, another view). */
  readonly routeAccount: string | null;
  readonly routeName: 'chat' | 'accounts-overview' | 'other' | null;
  /** OnlyMonster ids of the accounts its ChatSpace loaded. */
  readonly accounts: readonly string[];
  /** The socket's coverage of each account the tap reported, and since when (this browser's clock). */
  readonly coverage: readonly { readonly hostAccountId: string; readonly covered: boolean; readonly since: number }[];
}

const ROUTE_ORDER: readonly ServerTabRoute[] = ['chat', 'list', 'overview', 'other'];

function routeOf(tab: ServerTabSeen): ServerTabRoute {
  if (tab.chatOpen) return 'chat';
  if (tab.routeAccount !== null) return 'list';
  return tab.routeName === 'accounts-overview' ? 'overview' : 'other';
}

/**
 * The report's view and accounts. Pure. The view of the tab that matters most wins (a fan's chat in any tab is said);
 * an account is covered when a tab covers it, since the earliest time a tab says so; an account no tab's tap spoke of
 * is not covered, since now.
 */
export function serverTabReportOf(
  tabs: readonly ServerTabSeen[],
  pageOf: (hostAccountId: string) => string | null,
  now: number,
): Pick<ServerTabStateRequest, 'route' | 'accounts'> {
  if (tabs.length === 0) return { route: 'none', accounts: [] };
  const routes = new Set(tabs.map(routeOf));
  const route = ROUTE_ORDER.find((candidate) => routes.has(candidate)) ?? 'other';
  const accounts = new Map<string, { covered: boolean; since: number }>();
  for (const tab of tabs) {
    for (const coverage of tab.coverage) {
      const known = accounts.get(coverage.hostAccountId);
      if (known === undefined || (coverage.covered && !known.covered) || (coverage.covered === known.covered && coverage.since < known.since)) {
        accounts.set(coverage.hostAccountId, { covered: coverage.covered, since: coverage.since });
      }
    }
  }
  for (const tab of tabs) for (const id of tab.accounts) if (!accounts.has(id)) accounts.set(id, { covered: false, since: now });
  return {
    route,
    accounts: [...accounts.entries()]
      .filter(([id]) => /^[0-9]{1,30}$/.test(id))
      .slice(0, SERVER_TAB_LIMITS.maxAccounts)
      .map(([hostAccountId, state]) => ({
        hostAccountId,
        pageLabel: pageOf(hostAccountId),
        covered: state.covered,
        since: new Date(Math.min(state.since, now)).toISOString(),
      })),
  };
}

export interface ServerTabReportDeps {
  readonly clock: Pick<Clock, 'now'>;
  readonly hub: () => Pick<HubFacade, 'serverTabState'> | null;
  /** This Firefox is the server's tab (its policy) and signed in; the facade checks `chatspace-tab-state-v1`. */
  readonly enabled: () => Promise<boolean>;
  readonly instanceId: () => string;
  readonly version: () => string;
  readonly tabs: () => readonly ServerTabSeen[];
  readonly pageOf: (hostAccountId: string) => string | null;
  readonly log?: LogSink;
}

export class ServerTabReport {
  private readonly log: LogSink;

  constructor(private readonly deps: ServerTabReportDeps) {
    this.log = deps.log ?? NO_LOG;
  }

  /** The alarm's report; nothing when this is not the server's tab. */
  async report(): Promise<void> {
    if (!(await this.deps.enabled())) return;
    const hub = this.deps.hub();
    if (hub === null) return;
    const body: ServerTabStateRequest = {
      instanceId: this.deps.instanceId(),
      extensionVersion: this.deps.version().slice(0, 32) || '0.0.0',
      ...serverTabReportOf(this.deps.tabs(), this.deps.pageOf, this.deps.clock.now()),
    };
    try {
      await hub.serverTabState(body);
    } catch {
      // Lost: the next minute reports again; the hub pages the owner only after five silent minutes.
      this.log.write({ level: 'info', scope: 'bg.server-tab', msg: 'report lost', fields: { route: body.route, accounts: body.accounts.length } });
    }
  }
}
