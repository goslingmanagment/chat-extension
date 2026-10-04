// The hub-data requests of the tab protocol (architecture.md §5.4 «данные
// хаба», §8.5) routed to the hub facade. The tab names a page by its hub
// `pageId` and a fan by the platform id; the facade takes the page label. A
// tab may ask only about pages its own ChatSpace accounts are bound to — the
// background checks that itself (§5.4 «Правила отправителей»); an extension
// page may ask about any granted page. Controllers of R11/R12 own what the
// answers mean; this is the plain route.

import { type CgCode, type CgErrorWire } from '@cg/contracts/errors';
import { type HubFacade, type HubSpenderPeriod, type SpendersBoard } from '@cg/contracts/hub';
import { narrowPlatform } from '@cg/contracts/ids';
import { type RpcResult, type RpcSenderContext, type TabRequestHandler } from '@cg/platform';

/** A granted page of the current bootstrap, as the routes need it. */
export interface GrantedPage {
  readonly pageId: number;
  readonly pageLabel: string;
  readonly platform: string;
}

export type PageLookup = { readonly ok: true; readonly page: GrantedPage } | { readonly ok: false; readonly code: CgCode };

export interface HubDataDeps {
  readonly hub: () => HubFacade & {
    spendersBoard(request: { readonly pageLabel: string; readonly period: HubSpenderPeriod; readonly force?: boolean }): Promise<SpendersBoard>;
  };
  /** The page of a `pageId` for this sender, or why not (no bootstrap, not granted, not this tab's binding). */
  readonly page: (pageId: number, sender: RpcSenderContext) => PageLookup;
  /** The wire form of whatever a facade call rejected with. */
  readonly errorOf: (error: unknown) => CgErrorWire;
  readonly debugEnabled: () => boolean;
}

type DataRequest = 'recap.status' | 'recap.read' | 'spenders.board' | 'spenders.stats' | 'spenders.queue' | 'feed.read' | 'fan.card' | 'fan.dossier' | 'newcomers.list' | 'usage.get';

export type HubDataHandlers = { readonly [T in DataRequest]: TabRequestHandler<T> };

/** Codes that mean «no such report here» for `usage.get`, whose answer is null rather than an error. */
const NO_USAGE: readonly CgCode[] = ['CG-FEATURE-DISABLED', 'CG-HUB-CAPABILITY'];

export function hubDataHandlers(deps: HubDataDeps): HubDataHandlers {
  /** Looks the page up, runs the facade call, and turns a rejection into its wire error. */
  async function onPage<T>(pageId: number, sender: RpcSenderContext, run: (page: GrantedPage) => Promise<T>): Promise<RpcResult<T>> {
    const found = deps.page(pageId, sender);
    if (!found.ok) return { ok: false, error: { code: found.code } };
    try {
      return { ok: true, payload: await run(found.page) };
    } catch (error) {
      return { ok: false, error: deps.errorOf(error) };
    }
  }

  return {
    'recap.status': (request, sender) =>
      onPage(request.pageId, sender, (page) =>
        // On OnlyFans the conversation is the fan (§8.4 «conversationRef = fanRef»).
        deps.hub().recapStatus({ pageLabel: page.pageLabel, conversationRef: request.fanRef, fanRef: request.fanRef, personaDefinitionId: request.personaDefinitionId }),
      ),
    'recap.read': (request, sender) =>
      onPage(request.pageId, sender, (page) => deps.hub().recaps({ pageLabel: page.pageLabel, fanRef: request.fanRef, personaDefinitionId: request.personaDefinitionId })),
    'spenders.board': (request, sender) =>
      onPage(request.pageId, sender, (page) =>
        deps.hub().spendersBoard({ pageLabel: page.pageLabel, period: request.period, ...(request.force === undefined ? {} : { force: request.force }) }),
      ),
    'spenders.stats': (request, sender) =>
      onPage(request.pageId, sender, (page) => deps.hub().spendersStats({ pageLabel: page.pageLabel, windowDays: request.windowDays, timeZone: request.timeZone })),
    'spenders.queue': (request, sender) =>
      onPage(request.pageId, sender, (page) =>
        deps.hub().awaitingReply({ pageLabel: page.pageLabel, limit: request.limit, ...(request.cursor === null ? {} : { cursor: request.cursor }) }),
      ),
    'feed.read': (request, sender) =>
      onPage(request.pageId, sender, (page) =>
        deps.hub().feed({
          pageLabel: page.pageLabel,
          fanRef: request.fanRef,
          limit: request.limit,
          ...(request.cursor === null ? {} : { cursor: request.cursor }),
          ...(request.summaryWindow === undefined ? {} : { summaryWindow: request.summaryWindow }),
        }),
      ),
    'fan.card': (request, sender) =>
      onPage(request.pageId, sender, (page) => {
        const platform = narrowPlatform(page.platform);
        if (platform === null) return Promise.reject(new Error('unknown platform'));
        return deps.hub().spenderDetail({ platform, platformUserId: request.fanRef, scope: 'page', pageLabel: page.pageLabel, period: request.period });
      }),
    'fan.dossier': (request, sender) =>
      onPage(request.pageId, sender, async (page) => ({ dossier: await deps.hub().dossier({ pageLabel: page.pageLabel, fanRef: request.fanRef }) })),
    'newcomers.list': (request, sender) =>
      onPage(request.pageId, sender, (page) =>
        deps.hub().audienceNew({ pageLabel: page.pageLabel, windowHours: request.windowHours, ...(request.cursor === null ? {} : { cursor: request.cursor }) }),
      ),
    async 'usage.get'(request, sender) {
      // Б4: the person's AI spend is a debug surface; outside debug mode the answer is «no report», not an error.
      const usage = deps.hub().aiUsage?.bind(deps.hub());
      if (!deps.debugEnabled() || usage === undefined) return { ok: true, payload: { report: null } };
      const answer = await onPage(request.pageId, sender, (page) => usage({ pageLabel: page.pageLabel, date: request.date, ...(request.days === undefined ? {} : { days: request.days }) }));
      if (answer.ok) return { ok: true, payload: { report: answer.payload } };
      return NO_USAGE.includes(answer.error.code) ? { ok: true, payload: { report: null } } : answer;
    },
  };
}
