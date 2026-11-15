// Workboard's screens in the frame over the site, the background's side (hub package R, 2026-11-15; contracts
// report-board.ts, R-protocol.md):
//
// - The pulse's `report` (the beat's answer): kept, and said to every tab when it changes — the launcher's fifth row
//   «Отчёт» and its dot. null — the person has no board: the row is not drawn. A sign-out forgets it at once.
// - `frame.fetch`: one API request of a frame screen, run with the device token only when the screen's allow-list has
//   it (core domain/report-board.ts). The token never leaves the background; the frame gets the status and the text.
// - `report.find`: «show on the site». The sender's own tab when its route is on the sale's page; else the newest tab
//   of that page is brought forward (no `tabs` permission: `tabs.update` + `windows.update` of a tab of ours) and gets
//   the find; no such tab — the find waits for one (30 minutes at most) and goes to it when it reports that page.
// - `report.statement`: the board asks the OnlyFans statements of its pages read again: said to every tab, ChatSpace's
//   ask the hub's poll of those accounts at once (core feed-poll.ts `onSoon`).
// - `report.sightings`: rows of Fansly's wallet list the site itself loaded, to Hub, only for a person with the board;
//   each row once, at most one report a page in SIGHTINGS_GAP_MS. Nothing is requested of Fansly for it.

import type { ReportFetchAnswer, ReportPulse, ReportSale, SaleSightingRow, WorkboardFrameScreen } from '@cg/contracts/report-board';
import type { HubFacade } from '@cg/contracts/hub';
import type { TabPresence } from '@cg/core/services';
import { frameRequestAllowed, reportPulseOf } from '@cg/core/domain/report-board';

/** A find kept for a tab of its page that is not open yet. */
export const FIND_WAIT_MS = 30 * 60_000;
/** At most one sighting report a page this often. */
export const SIGHTINGS_GAP_MS = 15_000;
/** Rows remembered as sent (by page and platform id). */
const SIGHTINGS_KEPT = 5_000;

export interface ReportBoardDeps {
  readonly hub: () => Pick<HubFacade, 'frameRelay' | 'saleSightings'> | null;
  readonly tabs: () => readonly TabPresence[];
  /** The registered tabs of ours with their browser ids. */
  readonly ports: () => readonly { readonly tabSessionId: string; readonly tabId: number }[];
  /** A page label of a host account key (`fansly:<id>`); null — not bound to a granted page. */
  readonly pageOf: (accountKey: string | null) => string | null;
  readonly focus: (tabId: number) => Promise<boolean>;
  readonly emit: (type: 'report.changed' | 'report.find' | 'report.statement', payload: unknown, tabSessionId?: string) => number;
  readonly now: () => number;
  readonly log: (message: string, fields: Readonly<Record<string, unknown>>) => void;
}

export interface ReportBoardBackground {
  /** The beat answered: its `report`, read loosely. */
  pulse(value: unknown): void;
  /** Another person or nobody: the board is forgotten. */
  sessionChanged(): void;
  /** A tab reported its route: a find waiting for its page goes to it. */
  presence(tabSessionId: string): void;
  current(): ReportPulse | null;
  fetch(request: { readonly screen: WorkboardFrameScreen; readonly method: string; readonly path: string; readonly body: string | null }): Promise<ReportFetchAnswer>;
  find(sale: ReportSale, from: string): Promise<{ readonly where: 'here' | 'tab' | 'none' }>;
  statement(pages: readonly string[]): void;
  /** `accountKey`: the tab's host account key (`fansly-web:<creator id>`). */
  sightings(accountKey: string, rows: readonly SaleSightingRow[]): Promise<boolean>;
}

const same = (a: ReportPulse | null, b: ReportPulse | null): boolean =>
  a === b || (a !== null && b !== null && a.shiftId === b.shiftId && a.phase === b.phase && a.needsMe === b.needsMe);

export function createReportBoardBackground(deps: ReportBoardDeps): ReportBoardBackground {
  let report: ReportPulse | null = null;
  const waiting = new Map<string, { readonly sale: ReportSale; readonly at: number }>();
  const sent = new Set<string>();
  const lastReport = new Map<string, number>();

  const take = (next: ReportPulse | null): void => {
    if (same(next, report)) return;
    report = next;
    deps.emit('report.changed', { report });
  };
  const pageOfTab = (tab: TabPresence): string | null => deps.pageOf(tab.routeAccount);
  const deliver = async (tabSessionId: string, sale: ReportSale): Promise<boolean> => {
    const port = deps.ports().find((candidate) => candidate.tabSessionId === tabSessionId);
    if (port === undefined || !(await deps.focus(port.tabId))) return false;
    return deps.emit('report.find', { sale }, tabSessionId) > 0;
  };

  return {
    pulse: (value) => take(reportPulseOf(value)),
    sessionChanged() {
      waiting.clear();
      sent.clear();
      lastReport.clear();
      take(null);
    },
    current: () => report,
    presence(tabSessionId) {
      if (waiting.size === 0) return;
      const tab = deps.tabs().find((candidate) => candidate.tabSessionId === tabSessionId);
      const page = tab === undefined ? null : pageOfTab(tab);
      const kept = page === null ? undefined : waiting.get(page);
      if (page === null || kept === undefined) return;
      waiting.delete(page);
      if (deps.now() - kept.at > FIND_WAIT_MS) return;
      // The tab is there now: the row is found there, as asked («строка найдётся сама»).
      if (deps.emit('report.find', { sale: kept.sale }, tabSessionId) === 0) waiting.set(page, kept);
    },
    async fetch({ screen, method, path, body }) {
      if (!frameRequestAllowed(screen, method, path)) {
        deps.log('frame request refused', { screen, method });
        return { error: 'refused' };
      }
      const hub = deps.hub();
      if (hub === null) return { error: 'signed_out' };
      return hub.frameRelay({ method, path, body });
    },
    async find(sale, from) {
      const tabs = deps.tabs();
      const own = tabs.find((tab) => tab.tabSessionId === from);
      if (own !== undefined && pageOfTab(own) === sale.pageLabel) return { where: 'here' };
      // The newest tab of the page: the one the person used last.
      const candidates = tabs.filter((tab) => tab.tabSessionId !== from && pageOfTab(tab) === sale.pageLabel).sort((a, b) => b.updatedAt - a.updatedAt);
      for (const tab of candidates) if (await deliver(tab.tabSessionId, sale)) return { where: 'tab' };
      waiting.set(sale.pageLabel, { sale, at: deps.now() });
      return { where: 'none' };
    },
    statement(pages) {
      if (pages.length > 0) deps.emit('report.statement', { pages: [...pages] });
    },
    async sightings(accountKey, rows) {
      if (report === null) return false;
      const pageLabel = deps.pageOf(accountKey);
      const hub = deps.hub();
      if (pageLabel === null || hub === null) return false;
      const now = deps.now();
      if (now - (lastReport.get(pageLabel) ?? Number.NEGATIVE_INFINITY) < SIGHTINGS_GAP_MS) return false;
      const fresh = rows.filter((row) => !sent.has(`${pageLabel}:${row.platformRef}`));
      if (fresh.length === 0) return false;
      lastReport.set(pageLabel, now);
      const recorded = await hub.saleSightings({ pageLabel, rows: fresh }).catch(() => false);
      if (recorded) {
        for (const row of fresh) sent.add(`${pageLabel}:${row.platformRef}`);
        while (sent.size > SIGHTINGS_KEPT) sent.delete(sent.values().next().value as string);
      }
      return recorded;
    },
  };
}
