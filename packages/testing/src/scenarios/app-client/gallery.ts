// Any view in any of the seven states, with content that fits the state:
// the state gallery of the stand and the fallback of the fake (a view the
// scenario did not set is `loading`, toasts are `empty`).

import {
  JOURNAL_KINDS,
  PREVIEW_SOURCES,
  SETTINGS_SECTIONS,
  VIEW_NAMES,
  VM_STATE_SUPPORT,
  type CgCode,
  type DockStatus,
  type I18nKey,
  type PartialGap,
  type UiAction,
  type ViewSelector,
  type VmView,
  type VmViewState,
} from '@cg/contracts';

import { cgError, msg, views, type ScenarioCtx } from './base';
import { dock, dockOutsideChat } from './dock';
import { entry, type ScenarioViewEntry } from './fake-app-client';
import { board, newcomers, defaultNewcomerRows, defaultOnlineRows, defaultOutreachRows, defaultQueueRows, onlineWindow, outreach, preview, queuesWindow, stats } from './lists';
import { debugPrompt, journal, options, popup } from './pages';
import { cheatsheet, coach, coachTurn, fanPanel, palette, quickJump, recapPicker, recapView, toasts, toast, voiceStudio } from './panels';

/** Every selector the UI can ask for (one token for the prompt page). */
export const ALL_SELECTORS: readonly ViewSelector[] = VIEW_NAMES.flatMap((of): ViewSelector[] => {
  if (of === 'preview') return PREVIEW_SOURCES.map((from) => ({ of, from }));
  if (of === 'options') return SETTINGS_SECTIONS.map((section) => ({ of, section }));
  if (of === 'journal') return JOURNAL_KINDS.map((kind) => ({ of, journal: kind }));
  if (of === 'debug-prompt') return [{ of, token: 'snap-1' }];
  return [{ of }];
});

const DOCK_BY_STATE: Record<VmViewState, DockStatus | null> = {
  loading: 'loading-chat',
  ready: 'ready',
  empty: null,
  partial: 'host-degraded',
  error: 'reload-needed',
  forbidden: 'not-signed-in',
  offline: 'hub-down',
};

const ERROR_CODE: Partial<Record<ViewSelector['of'], CgCode>> = {
  'recap.view': 'CG-PROVIDER-STREAM',
  'quick-jump': 'CG-HOST-CONTRACT',
  cheatsheet: 'CG-UNKNOWN',
  palette: 'CG-UNKNOWN',
  popup: 'CG-RUNTIME-UNREACHABLE',
  options: 'CG-STORAGE-READ',
  journal: 'CG-STORAGE-READ',
};

const EMPTY_KEY: Partial<Record<ViewSelector['of'], I18nKey>> = {
  'recap.picker': 'common.empty',
  'recap.view': 'cg.recapNotFound.title',
  coach: 'coach.empty.title',
  'spenders.board': 'spenders.empty',
  'spenders.stats': 'stats.noData',
  preview: 'preview.feed.empty',
  newcomers: 'common.empty',
  'fan-panel': 'fanPanel.empty.title',
  palette: 'common.empty',
  'quick-jump': 'quickJump.empty',
  toasts: 'common.empty',
  popup: 'popup.pill.chatspace.closed',
  options: 'common.empty',
  'debug-prompt': 'common.empty',
  journal: 'common.empty',
  voice: 'voice.empty.title',
};

const COVERAGE_GAPS = (ctx: ScenarioCtx): PartialGap[] => [
  { kind: 'coverage', level: 'partial' },
  { kind: 'stale-cache', asOf: new Date(ctx.now - 15 * 60_000).toISOString() },
];

const PARTIAL_GAPS: Partial<Record<ViewSelector['of'], PartialGap[]>> = {
  'spenders.board': [
    { kind: 'coverage', level: 'partial' },
    { kind: 'truncated', shown: 1000, total: 1340 },
  ],
  preview: [{ kind: 'archive-lag', messages: 2, minutes: 2 }],
  'recap.view': [{ kind: 'archive-lag', messages: 2, minutes: null }],
  coach: [{ kind: 'archive-lag', messages: 2, minutes: null }],
  palette: [{ kind: 'source-failed', source: 'spenders', code: 'CG-DATA-UNAVAILABLE' }],
  cheatsheet: [{ kind: 'host-degraded', capabilities: [] }],
  popup: [{ kind: 'host-degraded', capabilities: ['insert', 'previewSend'] }],
  'debug-prompt': [{ kind: 'truncated', shown: 500, total: null }],
  journal: [{ kind: 'truncated', shown: 500, total: null }],
  'recap.picker': [{ kind: 'source-failed', source: 'recap.full', code: 'CG-DATA-UNAVAILABLE' }],
};

/** The VmView of `selector` in `state`, with an error, a gap list or an empty text that fits it. */
export function viewState(ctx: ScenarioCtx, selector: ViewSelector, state: VmViewState): VmView {
  const reload: UiAction = { type: 'ReloadView', selector };
  switch (state) {
    case 'loading':
      return views.loading(ctx.now - 400, selector.of === 'newcomers' ? msg('common.loading') : selector.of === 'recap.picker' ? msg('common.loading') : null);
    case 'ready':
      return views.ready();
    case 'empty':
      return views.empty(msg(EMPTY_KEY[selector.of] ?? 'common.empty'));
    case 'partial':
      return views.partial(...(PARTIAL_GAPS[selector.of] ?? COVERAGE_GAPS(ctx)));
    case 'error':
      return views.error(cgError(ctx, ERROR_CODE[selector.of] ?? 'CG-DATA-UNAVAILABLE'), reload);
    case 'forbidden':
      return selector.of === 'debug-prompt' || selector.of === 'journal'
        ? views.forbidden(cgError(ctx, 'CG-FEATURE-DISABLED'), { type: 'OpenSettings', route: { section: 'generation' } })
        : views.forbidden(cgError(ctx, 'CG-AUTH-REQUIRED'), { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    case 'offline':
      return views.offline(cgError(ctx, 'CG-HUB-UNAVAILABLE'), reload, ctx.now - 10 * 60_000);
  }
}

/** One view of the gallery: `selector` in `state`. */
export function galleryEntry(ctx: ScenarioCtx, selector: ViewSelector, state: VmViewState): ScenarioViewEntry {
  const view = viewState(ctx, selector, state);
  switch (selector.of) {
    case 'dock': {
      const status = DOCK_BY_STATE[state];
      return entry(selector, status === null ? dockOutsideChat(ctx) : dock(ctx, status));
    }
    case 'recap.picker':
      return entry(selector, recapPicker(ctx, view));
    case 'recap.view':
      return entry(selector, recapView(ctx, view, state === 'partial' ? 'full' : 'short'));
    case 'coach':
      return entry(selector, coach(ctx, view, state === 'ready' || state === 'partial' || state === 'offline' ? [coachTurn(ctx, 1)] : []));
    case 'spenders.board':
      return entry(selector, board(ctx, view));
    case 'spenders.stats':
      return entry(selector, stats(ctx, view));
    case 'preview':
      return entry(selector, preview(ctx, selector.from, view));
    case 'newcomers':
      return entry(selector, newcomers(ctx, view, state === 'ready' || state === 'partial' || state === 'offline' ? defaultNewcomerRows(ctx) : [], state === 'partial' ? { incomplete: msg('common.coverage.partial') } : {}));
    case 'outreach':
      return entry(selector, outreach(ctx, view, state === 'ready' || state === 'partial' || state === 'offline' ? defaultOutreachRows(ctx) : []));
    case 'online':
      return entry(selector, onlineWindow(ctx, view, state === 'ready' || state === 'partial' || state === 'offline' ? defaultOnlineRows(ctx) : []));
    case 'queues':
      return entry(selector, queuesWindow(ctx, view, state === 'ready' || state === 'partial' || state === 'offline' ? defaultQueueRows(ctx) : []));
    case 'fan-panel':
      return entry(selector, fanPanel(ctx, view));
    case 'palette':
      return entry(selector, palette(ctx, view));
    case 'quick-jump':
      return entry(selector, quickJump(ctx, view));
    case 'cheatsheet':
      return entry(selector, cheatsheet(ctx, view));
    case 'toasts':
      return entry(selector, toasts(view, state === 'ready' ? [toast(ctx, 'toast-info', 'info', { title: ctx.lang === 'ru' ? 'Split включён: ответ придёт частями' : 'Split is on: the answer comes in parts' })] : []));
    // Chat Memory week 1: «в разговоре» has marks or none; the gallery's other states show none.
    case 'talking':
      return entry(selector, { view, marks: {} });
    case 'popup':
      return entry(selector, popup(ctx, view));
    case 'options':
      return entry(selector, options(ctx, selector.section, view));
    case 'debug-prompt':
      return entry(selector, debugPrompt(ctx, view));
    case 'journal':
      return entry(selector, journal(ctx, selector.journal, view));
    case 'voice':
      return entry(selector, voiceStudio(ctx, view));
  }
}

/** Every view that produces `state`, in it. */
export function gallery(ctx: ScenarioCtx, state: VmViewState): ScenarioViewEntry[] {
  return ALL_SELECTORS.filter((selector) => (VM_STATE_SUPPORT[selector.of] as readonly VmViewState[]).includes(state)).map((selector) => galleryEntry(ctx, selector, state));
}

/** The fake's answer for a selector the scenario did not set. */
export function fallbackView(ctx: ScenarioCtx, selector: ViewSelector): unknown {
  return galleryEntry(ctx, selector, selector.of === 'toasts' ? 'empty' : 'loading').vm;
}
