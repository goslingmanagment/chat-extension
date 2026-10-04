// Which ChatSpace tab runs a click made on an extension page (`tab.command`,
// architecture.md §9.9; PU-017, ST-076, Б13). The popup's «Spenders»,
// «Новые» and «Клавиши» open a window of ours in the tab the person works in;
// «к вкладке» of an account goes to a tab whose ChatSpace has that account
// loaded — its own router opens it, nothing is loaded for the sake of it.
// Pure: the background brings the chosen tab to the front and hands it the
// command.

import { type PageCommand } from '@cg/contracts/tab-messages';
import { hostAccountKeyOf } from '@cg/contracts/settings';
import { type TabPresence } from '@cg/core/services';

/** A registered tab as the RPC knows it. */
export interface CommandTab {
  readonly tabSessionId: string;
  readonly tabId: number;
  readonly registeredAt: number;
}

/**
 * The tab for `command`, or null — no ChatSpace tab can run it. In front
 * first (focused, then visible), then the one that reported last, then the
 * newest registration. An account command needs a tab that has the account.
 */
export function pickCommandTab(command: PageCommand, tabs: readonly CommandTab[], presence: readonly TabPresence[]): CommandTab | null {
  const reported = new Map(presence.map((tab) => [tab.tabSessionId, tab]));
  const wanted = command.kind === 'account' ? hostAccountKeyOf(command.host, command.hostAccountId) : null;
  const able = wanted === null ? [...tabs] : tabs.filter((tab) => reported.get(tab.tabSessionId)?.accounts.includes(wanted) === true);
  const rank = (tab: CommandTab): readonly [number, number, number] => {
    const seen = reported.get(tab.tabSessionId);
    return [seen?.focused === true && seen.visible ? 2 : seen?.visible === true ? 1 : 0, seen?.updatedAt ?? 0, tab.registeredAt];
  };
  able.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
  });
  return able[0] ?? null;
}
