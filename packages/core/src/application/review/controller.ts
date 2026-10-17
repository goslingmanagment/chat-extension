// The Review controller (architecture.md §10.2 ReviewVM; AI-050…AI-054,
// NEW-02; ui-design §4.11). Review grades how the chatter handles the
// conversation, over the deep window of the hub archive. It opens in the
// dock sheet: N/10, the blocks «Вердикт / Деньги / Персона / Ошибки / Что
// работает» with «Как надо было», then the recommendations. Nothing of it
// is a message to the fan: no Split, nothing insertable; Copy writes the
// formatted text. An answer whose frame does not read is shown raw, not as
// an error (AI-052).
//
// Actions: `Generate { feature: 'review' }` starts the review of the open
// chat or reopens the same one; `Regenerate` («Ещё раз ⌘⇧B») asks again past
// the cache; `HideResult` / `ExpandResult` take the review's operation id.
//
// Where it opens (decision X49): in the «Развернуть ↗» window, as the old
// Fansly extension's large overlay showed it — six blocks do not read in a
// sheet of `--cg-cap`. «Свернуть Esc» puts it into the dock's sheet, which
// keeps it; «Ещё раз» rates anew where the Review stands (the window or the
// sheet), the next start or reopen opens the window again.

import { type I18nKey } from '@cg/contracts/errors';
import { chatKeyOf } from '@cg/contracts/ids';
import { COVERAGE_LEVELS, type CoverageLevel, type ReviewDoc } from '@cg/contracts/ops';
import { type ActionReceipt, type Msg, type PartialGap, type ReviewItemVM, type ReviewSectionVM, type ReviewVM, type UiAction, type VmView } from '@cg/contracts/vm';

import { flagRefusal, flagStateOf, isTerminalOpState } from '../../domain/ops';
import { streamPreview } from '../../domain/output';
import { analysisMark } from '../../domain/recap';
import { artifactHandle } from '../ai/handles';
import { type OpRecord } from '../ai/op-store';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { button, debugVm, errorVm, featureHotkey, msg, phaseVm, views } from '../ai/view-models';
import { isOwnSurface, type AiWorkspace } from '../ai/workspace';

const SECTION_TITLES: Readonly<Record<ReviewSectionVM['kind'], I18nKey>> = {
  verdict: 'review.section.verdict',
  money: 'review.section.money',
  persona: 'review.section.persona',
  mistakes: 'review.section.mistakes',
  works: 'review.section.works',
  recommendations: 'review.section.recommendations',
};

/** «Сделан только что» for this long after the review ended. */
const JUST_MADE_MS = 60_000;

const itemVm = (item: ReviewDoc['sections'][number]['items'][number]): ReviewItemVM => ({ body: item.body, example: item.fix, exampleWhere: item.fixWhere, afterExample: item.afterFix });

function sectionsOf(doc: ReviewDoc): ReviewSectionVM[] {
  const sections: ReviewSectionVM[] = doc.sections.map((section) => ({ kind: section.kind, title: msg(SECTION_TITLES[section.kind]), body: section.body, items: section.items.map(itemVm) }));
  const recommendations = doc.recommendations;
  if (recommendations !== null && (recommendations.lead.length > 0 || recommendations.items.length > 0)) {
    sections.push({ kind: 'recommendations', title: msg(SECTION_TITLES.recommendations), body: recommendations.lead, items: recommendations.items.map(itemVm) });
  }
  return sections;
}

export type ReviewController = AiController;

export function createReviewController(ws: AiWorkspace): ReviewController {
  const { catalog, clock, i18n } = ws.ports;

  /**
   * The review the open chat's sheet follows: the newest one of that chat
   * made under the persona its page has now. A review of another persona, or
   * one whose persona this tab does not know, is never shown as the current
   * one (AI-126); the same click reopens a cached review of this persona.
   */
  function current(): OpRecord | null {
    const chat = ws.situation().chat;
    if (chat === null) return null;
    return (
      ws.ops.ofChat(chat.key).find((record) => {
        if (record.view.feature !== 'review' || record.view.state === 'canceled') return false;
        const persona = record.memo.personaDefinitionId;
        return persona !== null && persona === ws.env.assignedDefinition(record.view.target.binding.pageId);
      }) ?? null
    );
  }

  function build(): ReviewVM {
    const situation = ws.situation();
    const { chat, ready } = situation;
    const now = clock.now();
    const record = current();
    const view = record?.view ?? null;
    const running = view !== null && !isTerminalOpState(view.state);
    const result = view?.state === 'done' && view.result?.kind === 'review' ? view.result : null;
    const doc = result?.doc ?? null;
    const expanded = view !== null && ws.isExpanded(view.opId);
    const wire = view === null ? undefined : view.state === 'failed' ? view.error : view.state === 'interrupted' ? (view.error ?? { code: 'CG-OP-INTERRUPTED' as const }) : undefined;

    // What the review was built from: the served head of its generation (context_v1).
    const head = view?.servedContext?.servedHead ?? null;
    const lag = chat === null || result === null || head === null ? null : ws.archiveLag({ messageRef: head.messageRef, at: head.at }, chat.key);
    const context = view?.debug?.context ?? null;
    const coverage: CoverageLevel = context !== null && (COVERAGE_LEVELS as readonly string[]).includes(context.coverage) ? (context.coverage as CoverageLevel) : 'unknown';

    // The owner's `review` switch of this chat's page (its own feature).
    const flag = ready === null ? null : flagStateOf(ready.bootstrap, ready.page.pageId, 'review');
    let state: VmView;
    if (chat === null) state = views.empty(msg('common.empty'));
    else if (ready === null && view === null) {
      const error = errorVm(ws.blockedError(situation), i18n);
      state = situation.status === 'loading-chat' ? views.loading(null, msg('dock.status.chatLoading')) : situation.status === 'hub-down' ? views.offline(error, { type: 'ReloadView', selector: { of: 'dock' } }) : views.forbidden(error);
    } else if (flag !== null && !flag.usable) state = views.forbidden(errorVm(flagRefusal(flag), i18n));
    else if (view === null) state = views.empty(msg('common.empty'));
    else if (running) state = views.loading(view.startedAt, null);
    else if (wire !== undefined) state = views.error(errorVm(wire, i18n), { type: 'Regenerate', operationId: view.opId });
    else {
      const gaps: PartialGap[] = [];
      if (coverage === 'partial') gaps.push({ kind: 'coverage', level: 'partial' });
      if (lag !== null) gaps.push({ kind: 'archive-lag', messages: lag.messages, minutes: null });
      state = gaps.length === 0 ? views.ready() : { s: 'partial', gaps };
    }

    // The window actually served is known only from the hub's context frame (debug); never guessed from the request.
    const window = result !== null && context !== null ? { messages: context.windowServed } : null;
    const targetName = chat === null ? null : situation.fanName;
    const meta: Msg[] = window !== null && targetName !== null ? [msg('review.meta', { n: window.messages, name: targetName })] : [];
    const facts: Msg[] = [];
    if (result !== null && view?.endedAt !== undefined) facts.push(now - view.endedAt < JUST_MADE_MS ? msg('review.madeNow') : msg('recap.madeAgo', { age: { age: view.endedAt } }));
    if (result !== null && head !== null) facts.push(msg('review.archiveAsOf', { time: { time: head.at } }));

    const chatBusy = chat !== null && ws.running(chat.key) !== null;
    const reason =
      ws.offReason(situation) ??
      (situation.quotaZero ? catalog.reason('quota-zero', situation.quota === null ? undefined : { time: { time: situation.quota.resetsAt } }) : chatBusy ? catalog.reason('chat-busy') : null);
    // Without a review yet (or without a chat) the button has nothing to repeat and is off.
    const again: UiAction =
      view !== null ? { type: 'Regenerate', operationId: view.opId } : chat !== null ? { type: 'Generate', targetHandle: chat.handle, feature: 'review', options: {} } : { type: 'ReloadView', selector: { of: 'review' } };
    const preview = running && view.text !== undefined ? streamPreview('review', view.text) : '';
    const debugOn = ws.env.settings?.settings.debug.enabled ?? false;
    return {
      view: state,
      opId: view?.opId ?? null,
      state: view?.state ?? null,
      phase: view === null ? null : phaseVm(view, now),
      streamText: preview.length > 0 ? preview : null,
      rating: doc?.rating ?? null,
      window,
      targetName,
      meta,
      lead: doc === null ? null : doc.lead.length > 0 ? doc.lead : null,
      sections: doc === null ? [] : sectionsOf(doc),
      raw: result?.raw ?? null,
      // AI-052: no frame — the raw text is shown as it is.
      unparsed: result !== null && doc === null,
      copyHandle: result === null || view === null ? null : artifactHandle({ kind: 'review', opId: view.opId }),
      regenerate: button('common.again', again, { enabled: reason === null && chat !== null, reason, hotkey: reason === null ? featureHotkey(catalog, 'review') : null }),
      facts,
      stamp: { asOf: head?.at ?? null, coverage },
      splitReason: catalog.reason('not-a-message'),
      expanded,
      // The sheet is the opened result: the same footer in the sheet and in the window, so unfolding moves nothing.
      debug: view === null ? null : debugVm(view, { enabled: debugOn, opened: true, now, i18n }),
      // The site's verdict over the finished Review (R20 P8c): its «Ещё раз» is `regenerate`.
      stale: result === null || record === null ? null : analysisMark(ws.ports.policy.verdict(record.view, record.memo.fingerprint)),
    };
  }

  async function generate(type: UiAction['type'], cause: CauseKind, original: OpRecord | null): Promise<ActionReceipt> {
    const chat = ws.situation().chat;
    if (chat === null) return refused(ws, type, { code: 'CG-CONTEXT-CHANGED' });
    const running = ws.running(chat.key);
    // AI-127: the review of this chat is already running — bring it back, in its window (X49).
    if (running !== null && running.view.feature === 'review') {
      ws.setSheet(chat.key, { kind: 'review' });
      ws.setExpanded(running.view.opId, true);
      return done(type, 'noop', { opId: running.view.opId });
    }
    const result = await ws.startFeature({ feature: 'review', surface: 'dock', options: {}, cause, ...(original === null ? {} : { regenerateOf: original, force: true }) });
    switch (result.kind) {
      case 'started':
        ws.setSheet(chat.key, { kind: 'review' });
        // X49: a review — new, or the same one reopened — opens in the window; the sheet keeps it under. «Ещё раз» rates
        // anew where the person keeps it: in the window, or in the sheet they folded it into.
        ws.setExpanded(result.opId, original === null || ws.isExpanded(original.view.opId));
        return done(type, result.reopened ? 'noop' : 'started', { opId: result.opId });
      case 'refused':
        ws.showRefusal(chat.key, result.refusal);
        return refused(ws, type, result.refusal.error);
      case 'failed':
        ws.startFailed(chat.key, 'review', result.error, original === null ? { type: 'Generate', targetHandle: chat.handle, feature: 'review', options: {} } : { type: 'Regenerate', operationId: original.view.opId });
        return refused(ws, type, result.error);
    }
  }

  const handlers: ActionHandlers = {
    Generate(action, cause) {
      if (action.feature !== 'review') return null;
      const chat = ws.situation().chat;
      if (chat === null || chat.handle !== action.targetHandle) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return generate(action.type, cause, null);
    },
    Regenerate(action, cause) {
      const record = ws.ops.get(action.operationId);
      if (record === null || record.view.feature !== 'review' || !isOwnSurface(record.view.surface)) return null;
      const chat = ws.situation().chat;
      if (chat === null || chat.key !== chatKeyOf(record.view.target.chat)) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return generate(action.type, cause, record);
    },
    // Where the Review of the open chat is shown (ui-contract.md, decision 13): the sheet, the «Развернуть ↗»
    // window, or hidden — kept, the same button opens it again. Never a generation.
    ShowAnalysis(action) {
      if (action.view !== 'review') return null;
      const chat = ws.situation().chat;
      if (chat === null) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      const record = current();
      const shown = ws.sheet(chat.key)?.kind === 'review';
      if (action.mode === 'hidden') {
        if (!shown) return Promise.resolve(done(action.type, 'noop'));
        if (record !== null) ws.setExpanded(record.view.opId, false);
        ws.setSheet(chat.key, null);
        return Promise.resolve(done(action.type));
      }
      if (!shown) ws.setSheet(chat.key, { kind: 'review' });
      // The window is the review's own: without one there is only the sheet.
      if (record !== null) ws.setExpanded(record.view.opId, action.mode === 'expanded');
      return Promise.resolve(done(action.type, 'opened'));
    },
    HideResult(action) {
      const record = ws.ops.get(action.operationId);
      const chat = ws.situation().chat;
      if (record === null || record.view.feature !== 'review' || chat === null || ws.sheet(chat.key)?.kind !== 'review') return null;
      ws.setSheet(chat.key, null);
      return Promise.resolve(done(action.type));
    },
    ExpandResult(action) {
      const record = ws.ops.get(action.operationId);
      if (record === null || record.view.feature !== 'review') return null;
      ws.setExpanded(action.operationId, action.expanded);
      return Promise.resolve(done(action.type, action.expanded ? 'opened' : 'done'));
    },
    ReloadView(action) {
      if (action.selector.of !== 'review') return null;
      ws.env.reload();
      return Promise.resolve(done(action.type));
    },
  };

  return createSurface(ws, { kinds: ['review'], build, handlers });
}
