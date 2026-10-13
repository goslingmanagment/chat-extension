// The dock controller (architecture.md §10.2 DockVM, §6.3, §7; ui-design
// §4.1–§4.10, §8.1): the strip above ChatSpace's composer and the draft
// sheet over it. It turns the workspace into a DockVM — status and banner,
// persona, quota, Tone and Split, the seven actions with their reasons, the
// bar's chips as data (the site's slice of the feature manifest: what has a
// chip here, in which group, with which icon), the
// result of Reply, Fix, Hi or Ping, a refused start with what runs now —
// and takes the actions of the draft features and of every part: Generate,
// «Ещё раз», cancel, hide, expand, tone, Split, insert, Fix's replace and
// restore, the Б2 answer, copy.
//
// What the strip's chips ask for is in each chip (`ChipVM.action`): for
// Reply, Fix, Hi, Ping and Review — `Generate { targetHandle, feature,
// options: {} }`, which starts a generation (or reopens the same one); Recap
// opens its sheet and Coach its panel and never generate by themselves; a
// window (Spenders, «Новые») opens.

import { TONES } from '@cg/contracts/features';
import { chatKeyOf } from '@cg/contracts/ids';
import { type ActiveOpSummary } from '@cg/contracts/ops';
import {
  DOCK_ACTION_IDS,
  type ActionReceipt,
  type CatalogActionId,
  type DockActionId,
  type DockActionVM,
  type DockVM,
  type ReasonVM,
  type RefusalVM,
  type RunningOpVM,
  type UiAction,
  type UiActionOf,
  type VmView,
} from '@cg/contracts/vm';

import { dockChips, featureGate, isDraftFeature, policyOf, toggleTone } from '../../domain/features';
import { anchorGap } from '../../domain/host';
import { flagUsable, isTerminalOpState } from '../../domain/ops';
import { targetHandle } from '../ai/handles';
import { type OpRecord } from '../ai/op-store';
import { resultVm } from '../ai/result-vm';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { errorVm, msg, views } from '../ai/view-models';
import { QUOTA_LOW_AT, isOwnSurface, type AiWorkspace, type RefusalState, type Situation } from '../ai/workspace';
import { flagReasonVm } from '../flag-reason';

/** The keys footer is shown under the first results (ui-design §4.3). */
export const KEYS_FOOTER_RESULTS = 5;

export function runningVm(ws: AiWorkspace, summary: Pick<ActiveOpSummary, 'opId' | 'feature' | 'chat' | 'fanLabel' | 'startedAt' | 'inThisTab'>): RunningOpVM {
  return {
    opId: summary.opId,
    feature: summary.feature,
    fanLabel: summary.fanLabel ?? ws.ports.host.fan(summary.chat)?.displayName ?? null,
    startedAt: summary.startedAt,
    inThisTab: summary.inThisTab,
    go: { type: 'Navigate', to: { kind: 'chat', targetHandle: targetHandle('dock', summary.chat) } },
    cancel: { type: 'CancelGeneration', operationId: summary.opId },
  };
}

export function refusalVm(ws: AiWorkspace, refusal: RefusalState): RefusalVM {
  return {
    feature: refusal.feature,
    error: errorVm(refusal.error, ws.ports.i18n),
    running: refusal.running.map((summary) => runningVm(ws, summary)),
    ...(refusal.at === undefined ? {} : { at: refusal.at }),
  };
}

function viewOf(ws: AiWorkspace, situation: Situation): VmView {
  const { i18n } = ws.ports;
  const error = situation.statusError === null ? null : errorVm(situation.statusError, i18n);
  if (situation.chat === null && situation.status === 'ready') return views.empty(msg('common.empty'));
  switch (situation.status) {
    case 'ready':
      return views.ready();
    case 'loading-chat':
      return views.loading(null, msg('dock.status.chatLoading'));
    case 'not-signed-in':
      return views.forbidden(error ?? errorVm({ code: 'CG-AUTH-REQUIRED' }, i18n), { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } });
    case 'no-binding':
      return views.forbidden(error ?? errorVm({ code: 'CG-BINDING-MISSING' }, i18n));
    case 'no-persona':
      return views.forbidden(error ?? errorVm({ code: 'CG-PERSONA-UNASSIGNED' }, i18n), { type: 'OpenSettings', route: { section: 'personas', code: situation.statusError?.code ?? 'CG-PERSONA-UNASSIGNED' } });
    case 'host-degraded':
      return { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: situation.off === null ? ['insert'] : ['identity', 'route'] }] };
    case 'blocked-fan':
      return { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: ['insert'] }] };
    case 'hub-down':
      return views.offline(error ?? errorVm({ code: 'CG-HUB-UNAVAILABLE' }, i18n), { type: 'ReloadView', selector: { of: 'dock' } });
    case 'reload-needed':
      return views.error(error ?? errorVm({ code: 'CG-RUNTIME-RELOADED' }, i18n), { type: 'ReloadTab' });
  }
}

export type DockController = AiController;

export function createDockController(ws: AiWorkspace): DockController {
  /** Results counted for the keys footer while it was still due. */
  const footerOps = new Set<string>();
  const counted = new Set<string>();

  const offOps = ws.onOpEvent((event) => {
    if (event.kind !== 'done') return;
    const { view } = event.record;
    if (view.state !== 'done' || !isDraftFeature(view.feature) || !event.record.own || counted.has(view.opId)) return;
    const settings = ws.env.settings;
    if (settings === null || settings.readOnly) return;
    const footer = settings.settings.onboarding.keysFooter;
    // Past the first results nothing is counted or kept any more.
    if (footer.dismissed || footer.shown >= KEYS_FOOTER_RESULTS) return;
    counted.add(view.opId);
    footerOps.add(view.opId);
    void ws.env.patchSettings({ onboarding: { keysFooter: { shown: footer.shown + 1, dismissed: footer.dismissed } } });
  });

  // ── the view ─────────────────────────────────────────────────────────────

  function actions(situation: Situation, running: OpRecord | null, activeAction: DockActionId | null): Record<DockActionId, DockActionVM> {
    const { catalog } = ws.ports;
    const { chat, ready } = situation;
    const quotaReason = situation.quotaZero ? catalog.reason('quota-zero', situation.quota === null ? undefined : { time: { time: situation.quota.resetsAt } }) : null;
    const allOff: ReasonVM | null = ws.offReason(situation) ?? quotaReason;
    // A Coach turn is the Coach's whichever of its steps runs: its auto-recap is a recap of the Coach surface.
    const busyAction = running === null ? null : running.view.surface === 'coach' ? 'coach' : policyOf(running.view.feature).dockAction;
    const recapReady = chat !== null && ready !== null && hasRecapCopy(ready);
    const entries = DOCK_ACTION_IDS.map((id): [DockActionId, DockActionVM] => {
      let reason: ReasonVM | null = allOff;
      if (reason === null && ready !== null) {
        // What the feature needs on THIS page to be generated; the hub's own reason picks the words («выключена», «хаб пока не умеет»…).
        const admitted = ws.admitted(situation.host, ready, id, 'generate');
        if (!admitted.usable) reason = flagReasonVm(admitted);
        // UI-008: while a generation runs in this chat only its own button works.
        else if (busyAction !== null && busyAction !== id) reason = catalog.reason('chat-busy');
        else if (busyAction === null && id !== 'recap' && id !== 'coach') {
          // Recap opens its sheet and Coach its panel: their gates sit on the build and ask buttons.
          const composer = situation.host.composer;
          // A strip action is the AI feature of its own name (`DOCK_ACTION_IDS` are feature ids).
          const gate = featureGate(id, { platform: ready.target.binding.platform, window: situation.window, draftEmpty: composer === null ? null : composer.draft.provenance === 'empty' });
          if (gate !== null) reason = catalog.reason(gate.reason);
        }
      }
      const busy = busyAction === id;
      return [
        id,
        {
          enabled: reason === null,
          busy,
          active: busy || activeAction === id,
          reason,
          // A key that does nothing is not printed on the button (ui-design §4.1).
          hotkey: reason === null ? catalog.entry(id).hotkey : null,
          badge: id === 'recap' && recapReady ? 'recap-ready' : null,
        },
      ];
    });
    return Object.fromEntries(entries) as Record<DockActionId, DockActionVM>;
  }

  /** The one status line of a page nothing of ours runs on: the master switch in its own words, an outdated build as its error reads. */
  function noticeOf(pageOff: NonNullable<Situation['pageOff']>): NonNullable<DockVM['notice']> {
    const view = errorVm(pageOff.error, ws.ports.i18n);
    return pageOff.why === 'disabled' ? { ...view, title: ws.ports.i18n.t('dock.status.pageOff'), body: '', tone: 'state' } : { ...view, tone: 'state' };
  }

  /** UI-010: a recap of this chat can be opened at once (a local copy, or the hub's status line once the chat settled). */
  function hasRecapCopy(ready: NonNullable<Situation['ready']>): boolean {
    return ws.recaps.hasAny(ws.recapOwner(ready), flagUsable(ready.bootstrap, ready.page.pageId, 'recap'));
  }

  function build(): DockVM {
    const { catalog } = ws.ports;
    const situation = ws.situation();
    const { chat } = situation;
    const settings = ws.env.settings?.settings ?? null;
    const sheet = chat === null ? null : ws.sheet(chat.key);
    const running = chat === null ? null : ws.running(chat.key);
    const shown = sheet !== null && sheet.kind === 'draft' ? ws.ops.get(sheet.opId) : null;
    // A canceled generation leaves no sheet; a result of a draft feature is the sheet.
    const result = shown !== null && shown.view.state !== 'canceled' ? resultVm(ws, shown, { regenerate: { type: 'Regenerate', operationId: shown.view.opId } }) : null;
    const activeAction: DockActionId | null = result !== null ? policyOf(result.feature).dockAction : sheet?.kind === 'recap' ? 'recap' : sheet?.kind === 'review' ? 'review' : null;
    const generating = running !== null;
    const lockReason = ws.offReason(situation) ?? (generating ? catalog.reason('locked-during-generation') : null);
    const quota = situation.quota;
    const remaining = quota?.remainingRequestsToday ?? null;
    const low = remaining !== null && remaining <= QUOTA_LOW_AT;
    const elsewhere = ws.ops
      .all()
      .filter((record) => record.own && !isTerminalOpState(record.view.state) && (chat === null || chatKeyOf(record.view.target.chat) !== chat.key))
      .map((record) => runningVm(ws, { opId: record.view.opId, feature: record.view.feature, chat: record.view.target.chat, fanLabel: null, startedAt: record.view.startedAt, inThisTab: true }));
    const contract = situation.host.contract;
    const broken = Object.values(contract.anchors).some(anchorGap);
    const handle = chat !== null && situation.ready !== null ? chat.handle : null;
    const actionVms = actions(situation, running, activeAction);
    return {
      view: viewOf(ws, situation),
      visible: chat !== null,
      mode: situation.copyOnly === null ? 'insert' : 'copy-only',
      status: situation.status,
      statusError: situation.statusError === null ? null : errorVm(situation.statusError, ws.ports.i18n),
      // The owner switched ChatGoose off, or this build is too old for the hub: one line, in place of an error card after a click.
      notice: situation.pageOff === null || chat === null ? null : noticeOf(situation.pageOff),
      targetHandle: handle,
      persona: situation.persona?.status === 'ok' && situation.persona.label !== null && situation.pageName !== null ? { label: situation.persona.label, pageName: situation.pageName } : null,
      mark: situation.off !== null || situation.quotaZero ? 'faint' : 'normal',
      // UI-031: silence is the norm — the quota shows only when it is low or gone.
      quota: quota !== null && low ? { remaining, low: remaining !== 0, resetsAt: quota.resetsAt } : null,
      options: {
        tone: chat === null ? null : ws.tone(chat.key),
        tones: TONES,
        split: settings?.generation.split ?? false,
        locked: generating,
        toneReason: lockReason,
        splitReason: lockReason,
        toneHotkey: catalog.entry('tone').hotkey,
        splitHotkey: catalog.entry('split').hotkey,
      },
      actions: actionVms,
      // The bar's chips as data: what has a chip on this site, in the manifest's order (`dockChips`, domain/features/admission.ts).
      chips: dockChips(ws.ports.features, actionVms, handle, (action) => catalog.entry(action as CatalogActionId).hotkey),
      result,
      analysis: sheet?.kind === 'recap' ? 'recap' : sheet?.kind === 'review' ? 'review' : null,
      refusal: sheet?.kind === 'refusal' ? refusalVm(ws, sheet.refusal) : null,
      runningElsewhere: elsewhere,
      statusWords: situation.status === 'loading-chat' && chat !== null,
      hints: settings?.ui.hints ?? true,
      keysFooter: result !== null && footerOps.has(result.opId) && settings?.onboarding.keysFooter.dismissed !== true,
      resultStyle: settings?.ui.resultStyle ?? 'bare',
      paletteHotkey: catalog.entry('palette').hotkey,
      debug: settings?.debug.enabled === true ? { renderTrace: settings.debug.renderTrace, contract: `${contract.build ?? '?'} · ${broken ? 'partial' : 'ok'}` } : null,
    };
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** The open chat, when the handle names it; otherwise the click was for a chat that is gone. */
  function chatOf(handle: string): NonNullable<Situation['chat']> | null {
    const chat = ws.situation().chat;
    return chat !== null && chat.handle === handle ? chat : null;
  }

  async function generate(action: UiActionOf<'Generate'>, cause: CauseKind, regenerateOf?: OpRecord): Promise<ActionReceipt> {
    const chat = regenerateOf === undefined ? chatOf(action.targetHandle) : ws.situation().chat;
    if (chat === null) return refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' });
    const running = ws.running(chat.key);
    // AI-127: a repeated click on the running feature brings its sheet back; nothing new is started.
    if (running !== null && regenerateOf === undefined && policyOf(running.view.feature).dockAction === policyOf(action.feature).dockAction) {
      ws.setSheet(chat.key, { kind: 'draft', opId: running.view.opId });
      return done(action.type, 'noop', { opId: running.view.opId });
    }
    const result = await ws.startFeature({
      feature: action.feature,
      surface: 'dock',
      options: action.options,
      cause,
      ...(regenerateOf === undefined ? {} : { regenerateOf, force: true }),
    });
    switch (result.kind) {
      case 'started':
        ws.setSheet(chat.key, { kind: 'draft', opId: result.opId });
        return done(action.type, result.reopened ? 'noop' : 'started', { opId: result.opId });
      case 'refused':
        ws.showRefusal(chat.key, result.refusal);
        return refused(
          ws,
          action.type,
          result.refusal.error,
          result.refusal.running.map((summary) => runningVm(ws, summary)),
        );
      case 'failed':
        ws.startFailed(chat.key, action.feature, result.error);
        return refused(ws, action.type, result.error);
    }
  }

  async function writeOutcome(type: UiAction['type'], opId: string, write: ReturnType<AiWorkspace['inserts']['insertPart']>): Promise<ActionReceipt> {
    const outcome = await write;
    switch (outcome.kind) {
      case 'applied':
        return done(type, 'done', { opId });
      case 'needs-confirm':
        return done(type, 'needs-confirm', { opId });
      case 'canceled':
        return done(type, 'noop', { opId });
      case 'busy':
        // A write of this operation is already on its way (a double click): this one changed nothing.
        return done(type, 'noop', { opId });
      case 'failed':
        return refused(ws, type, outcome.error);
    }
  }

  async function savePreference(action: UiActionOf<'SetPreference'>, patch: Parameters<AiWorkspace['env']['patchSettings']>[0]): Promise<ActionReceipt> {
    const answer = await ws.env.patchSettings(patch);
    return answer.ok ? done(action.type, 'done', { revision: answer.payload.revision }) : refused(ws, action.type, answer.error);
  }

  /**
   * The operation an action names, when it is the dock's to act on: known to
   * this tab and of the open chat's surfaces. A preview's or «Новые»'s
   * operation — or one this tab does not know — is not: the router asks the
   * next controller (R12's).
   */
  function own(opId: string): OpRecord | null {
    const record = ws.ops.get(opId);
    return record !== null && isOwnSurface(record.view.surface) ? record : null;
  }

  /**
   * The same, and a board's result the dock shows in its own chat (§6.5): its
   * parts are inserted, copied, expanded and hidden from here — while no
   * card shows it. «Ещё раз» and Fix's replacement stay with `own`: a new
   * answer for the open chat is the strip's buttons.
   */
  function shown(opId: string): OpRecord | null {
    const record = ws.ops.get(opId);
    return record !== null && ws.answersFor(record) ? record : null;
  }

  const handlers: ActionHandlers = {
    Generate: (action, cause) => (isDraftFeature(action.feature) ? generate(action, cause) : null),
    Regenerate(action, cause) {
      const record = own(action.operationId);
      if (record === null || !isDraftFeature(record.view.feature)) return null;
      const chat = ws.situation().chat;
      // «Ещё раз» belongs to the chat of its result.
      if (chat === null || chat.key !== chatKeyOf(record.view.target.chat)) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return generate({ type: 'Generate', targetHandle: chat.handle, feature: record.view.feature, options: {} }, cause, record).then((receipt) => ({ ...receipt, type: action.type }));
    },
    // ⌘. / «Отменить»: explicit only; the terminal view follows as an event. A cancel is by id whatever the
    // surface: «Идут сейчас» lists runs of other tabs and surfaces, and the background ends any of them the same way.
    CancelGeneration: (action) => ws.ops.cancel(action.operationId).then((answer) => (answer.ok ? done(action.type, 'done', { opId: action.operationId }) : refused(ws, action.type, answer.error))),
    HideResult(action) {
      const chat = ws.situation().chat;
      const sheet = chat === null ? null : ws.sheet(chat.key);
      if (chat === null || sheet === null) return null;
      // A board's result that a card shows as well is hidden on that card, by that card's own «Скрыть».
      const record = ws.ops.get(action.operationId);
      const mine =
        (sheet.kind === 'draft' && sheet.opId === action.operationId && (record === null || ws.answersFor(record))) ||
        (sheet.kind === 'refusal' && sheet.refusal.running.some((running) => running.opId === action.operationId));
      if (!mine) return null;
      // «Скрыть» keeps the result: the same click with the same parameters opens it again (AI-128).
      ws.setSheet(chat.key, null);
      return Promise.resolve(done(action.type));
    },
    ExpandResult(action) {
      const record = shown(action.operationId);
      if (record === null || !isDraftFeature(record.view.feature)) return null;
      ws.setExpanded(action.operationId, action.expanded);
      return Promise.resolve(done(action.type, action.expanded ? 'opened' : 'done'));
    },
    SetTone(action) {
      const chat = chatOf(action.targetHandle);
      if (chat === null) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      // AI-009: the options are frozen while a generation runs here.
      if (ws.running(chat.key) !== null) return Promise.resolve(done(action.type, 'noop'));
      ws.setTone(chat.key, toggleTone(ws.tone(chat.key), action.tone));
      return Promise.resolve(done(action.type));
    },
    InsertPart(action, cause) {
      if (shown(action.operationId) === null) return null;
      return writeOutcome(action.type, action.operationId, ws.inserts.insertPart(action.operationId, action.variant === undefined ? { index: action.part } : { variant: action.variant, index: action.part }, cause));
    },
    ReplaceMyDraft(action, cause) {
      if (own(action.operationId) === null) return null;
      return writeOutcome(action.type, action.operationId, ws.inserts.replaceMyDraft(action.operationId, action.part, cause));
    },
    RestoreMyDraft(action, cause) {
      if (own(action.operationId) === null) return null;
      return writeOutcome(action.type, action.operationId, ws.inserts.restoreMyDraft(action.operationId, cause));
    },
    AnswerConfirm(action, cause) {
      const pending = ws.ops.all().find((record) => ws.inserts.confirmation(record.view.opId)?.confirmationId === action.confirmationId);
      if (pending === undefined) return null;
      return writeOutcome(action.type, pending.view.opId, ws.inserts.answerConfirm(action.confirmationId, action.choice, cause));
    },
    Copy(action) {
      // A part of a preview's operation, or a handle that names nothing here, is not the dock's to copy.
      if (!ws.holds(action.artifactHandle)) return null;
      return ws.copy(action.artifactHandle).then((copied) => (copied.ok ? done(action.type) : refused(ws, action.type, copied.error)));
    },
    SetPreference(action) {
      if (action.key === 'generation.split') {
        const chat = ws.situation().chat;
        // AI-009: Split is frozen while a generation runs in the open chat.
        if (chat !== null && ws.running(chat.key) !== null) return Promise.resolve(done(action.type, 'noop'));
        return savePreference(action, { generation: { split: action.value } });
      }
      if (action.key === 'onboarding.keysFooter.dismissed') {
        const shown = ws.env.settings?.settings.onboarding.keysFooter.shown ?? 0;
        return savePreference(action, { onboarding: { keysFooter: { shown, dismissed: action.value } } });
      }
      return null;
    },
    ReloadView(action) {
      if (action.selector.of !== 'dock') return null;
      ws.env.reload();
      ws.recaps.retryFailedStatuses();
      return Promise.resolve(done(action.type));
    },
  };

  return createSurface(ws, {
    kinds: ['dock'],
    build,
    handlers,
    dispose: () => {
      offOps();
    },
  });
}
