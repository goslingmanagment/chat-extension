// Synthetic profile for unit and rendered-page checks. No live data or network.
import { FANSLY_CONTRACT, FANSLY_STATUS_TEXTS } from '@cg/contracts/fansly-host';
import { FANSLY_ANCHOR_IDS } from '@cg/contracts/fansly';
import type { HostContractReport } from '@cg/contracts/host';
import type { PageSite } from '@cg/core/application/pages';
import { PAGES_NOW, PAGES_SITES, hostReport, workingState } from './world';

export const FANSLY_PAGE_SITES: readonly PageSite[] = [...PAGES_SITES, { kind: 'fansly-web', contract: FANSLY_CONTRACT, texts: FANSLY_STATUS_TEXTS }];
export function fanslyPageState(profile: 'fansly' | 'mixed' | 'chatspace' = 'mixed') {
  const state = workingState();
  state.diagnostics = { ...state.diagnostics, siteAccess: [{ host: 'fansly-web', enabled: profile !== 'chatspace', granted: profile !== 'chatspace', registered: profile !== 'chatspace', waitingReload: profile === 'chatspace' ? 0 : 2 }] };
  if (profile === 'chatspace') return state;
  const host: HostContractReport = {
    host: 'fansly-web', build: 'main.2e6b96097a4bb73b', adapterVersion: '0.1.0', checkedAt: PAGES_NOW,
    capabilities: hostReport(PAGES_NOW).capabilities,
    extensions: { 'fansly-web': { anchors: Object.fromEntries(FANSLY_ANCHOR_IDS.map((anchor) => [anchor, anchor === 'vaultUpload' ? 'notYet' : 'ok'])), capabilities: {} } },
  };
  const seen = { account: { host: 'fansly-web', hostAccountId: '70001', platform: 'fansly', platformAccountId: '70001', username: 'lora_test', displayName: 'Lora Test' }, lastSeenAt: new Date(PAGES_NOW).toISOString(), openTabs: 1, routeTabs: 1 } as const;
  const template = state.bootstrap.pages[0]!;
  const page = { ...template, pageId: 15, pageLabel: 'lora-test', platform: 'fansly', platformAccountId: '70001', title: 'Lora Test' };
  state.bootstrap = { ...state.bootstrap, pages: profile === 'fansly' ? [page] : [...state.bootstrap.pages, page] };
  state.accounts = profile === 'fansly' ? [seen] : [...state.accounts, seen];
  state.settings = { ...state.settings, personas: { ...state.settings.personas, byPageId: { ...state.settings.personas.byPageId, '15': state.settings.personas.byPageId['11']! } } };
  state.diagnostics = {
    ...state.diagnostics,
    requestModes: [{ host: 'fansly-web', mode: 'background' }],
    freshness: { since: PAGES_NOW - 23 * 3_600_000, until: PAGES_NOW, resolutionMs: 3_600_000, persisted: true, dropped: 0, rows: [{ host: 'fansly-web', build: host.build, feature: 'reply', counts: { generations: 20, marked: 3, unknown: 1, rejectedTail: 1, truncated: 1, nonLiveUnion: 2 } }] },
    tabs: [...(profile === 'fansly' ? [] : state.diagnostics.tabs), {
      tabSessionId: '00000000-0000-4000-8000-000000000905', site: 'fansly-web', host, chatKey: 'fansly-web:70001:80001', conversationRef: '90001',
      page: { observedAt: PAGES_NOW, mainAvailable: true, companion: { windowBridge: true, networkHook: true, styleFixes: true, wordFilter: true }, counters: { 'main.frames.seen': 100, 'main.frames.parsed': 98, 'main.frames.lost': 2, 'main.stream.gaps': 1, 'isolated.staleChats': 0 } },
      networkSession: { present: true, ageMs: 65_000, accountId: '70001', headerNames: ['authorization', 'fansly-client-id', 'fansly-client-ts', 'fansly-session-id', 'fansly-client-check'] },
    }],
  };
  state.prompts['prompt-token-1'] = { ...state.prompts['prompt-token-1']!, generation: {
    proof: { kind: 'tab-snapshot', conversationRef: '90001', takenAt: new Date(PAGES_NOW).toISOString(), completeness: 'complete', window: [{ id: '10001', dir: 'fan' }], knownFanMessageIds: ['10001'], deletedIds: [], tail: [{ platformMessageId: '10001', direction: 'fan', text: 'synthetic tail for visual check', sentAt: new Date(PAGES_NOW).toISOString() }], truncated: false },
    served: { source: 'live_union', servedHead: null, live: { status: 'served', accepted: 1, rejected: 0 }, coverageCheck: { window: [{ id: '10001', state: 'included' }], deleted: [] } },
  } };
  return state;
}
