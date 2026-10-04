// The Recap controller (architecture.md §7 «Recap: общий и досье», §8.5,
// §10.2 RecapPickerVM / RecapViewVM; AI-060…AI-071, REC-01, NEW-02;
// ui-design §4.11, §10). Recaps are shared: one full and one short recap per
// page, fan and persona for every granted chatter, kept by the hub (H-13).
// The sheet in the dock first checks what is saved («Проверяю сохранённые
// Recap…») and shows it, or offers to build one; a build is always a new
// generation (AI-064). What the tab holds are copies of the shared
// artifacts with their id and revision (the workspace's recap book). A full
// Recap also becomes the fan's dossier (H-5): «сохранено в хаб», or
// CG-RECAP-SAVE with «Сохранить ещё раз», which repeats only the link write.
//
// Actions: `Generate { feature: 'recap' | 'recap-short' }` opens the sheet
// at that length and never generates; `ShowRecap { length }` shows a saved
// slot; `RefreshRecap { length }` builds (the picker's build buttons and
// «↻ Обновить» both dispatch it); `RetryRecapSave`; `HideResult` and
// `ExpandResult` take the view's `opId`, which is always present while the
// sheet is open (the operation while it runs, the copy's local id, or the
// sheet's own id).

import { type FeatureId } from '@cg/contracts/features';
import { chatKeyOf, type ChatKey } from '@cg/contracts/ids';
import {
  type ActionButtonVM,
  type ActionReceipt,
  type HubSaveVM,
  type PartialGap,
  type ReasonVM,
  type RecapLength,
  type RecapPickerVM,
  type RecapSlotVM,
  type RecapViewVM,
  type UiAction,
  type ViewSelector,
  type VmView,
} from '@cg/contracts/vm';

import { featureGate } from '../../domain/features';
import { flagUsable, isTerminalOpState } from '../../domain/ops';
import { streamPreview } from '../../domain/output';
import { latestLength, type RecapCopy } from '../../domain/recap';
import { artifactHandle } from '../ai/handles';
import { type OpRecord } from '../ai/op-store';
import { createSurface, done, refused, type ActionHandlers, type AiController, type CauseKind } from '../ai/surface';
import { button, debugVm, errorVm, featureHotkey, isOfflineCode, msg, phaseVm, views } from '../ai/view-models';
import { isOwnSurface, type AiWorkspace, type Situation } from '../ai/workspace';

const FEATURE_OF: Readonly<Record<RecapLength, FeatureId>> = { short: 'recap-short', full: 'recap' };
const lengthOf = (feature: FeatureId): RecapLength => (feature === 'recap-short' ? 'short' : 'full');
const isRecap = (feature: FeatureId): boolean => feature === 'recap' || feature === 'recap-short';

/** Chats whose Recap sheet state (the shown length, the followed build) is remembered. */
export const RECAP_UI_CHATS_MAX = 32;

interface RecapUi {
  length: RecapLength;
  /** The generation the sheet follows (running, failed, or just finished); null — a saved slot is shown. */
  opId: string | null;
  /** The sheet's own id, for hide and expand while nothing else names it. */
  readonly sheetId: string;
}

export type RecapController = AiController;

export function createRecapController(ws: AiWorkspace): RecapController {
  const { catalog, clock, i18n, ids } = ws.ports;
  const book = ws.recaps;
  const uis = new Map<ChatKey, RecapUi>();

  function uiOf(key: ChatKey): RecapUi {
    let ui = uis.get(key);
    if (ui === undefined) {
      ui = { length: 'full', opId: null, sheetId: ids.uuid() };
      uis.set(key, ui);
      // The sheet state of the chats visited longest ago goes: a shift opens hundreds of chats.
      while (uis.size > RECAP_UI_CHATS_MAX) {
        const oldest = uis.keys().next().value;
        if (oldest === undefined) break;
        uis.delete(oldest);
      }
    }
    return ui;
  }

  function saveVm(copy: RecapCopy | null): HubSaveVM {
    if (copy === null) return { s: 'not-applicable' };
    const state = book.saveState(copy);
    switch (state.s) {
      case 'not-applicable':
        return { s: 'not-applicable' };
      case 'saving':
        return { s: 'saving' };
      case 'saved':
        return { s: 'saved', at: state.at };
      case 'failed':
        // Only the idempotent link write repeats, never the AI.
        return { s: 'failed', error: errorVm({ code: 'CG-RECAP-SAVE' }, i18n), retry: { type: 'RetryRecapSave', length: 'full' } };
    }
  }

  // ── views ────────────────────────────────────────────────────────────────

  /** Why a view of the open chat cannot show recaps at all; null — it can. */
  function blockedView(situation: Situation): VmView | null {
    if (situation.chat === null) return views.empty(msg('common.empty'));
    const ready = situation.ready;
    if (ready === null) {
      const error = errorVm(situation.statusError ?? { code: 'CG-GATE-CHAT-LOADING' }, i18n);
      if (situation.status === 'loading-chat') return views.loading(null, msg('dock.status.chatLoading'));
      if (situation.status === 'hub-down') return views.offline(error, { type: 'ReloadView', selector: { of: 'dock' } });
      return views.forbidden(error);
    }
    if (!flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) return views.forbidden(errorVm({ code: 'CG-FEATURE-DISABLED' }, i18n));
    return null;
  }

  function buildReason(situation: Situation, length: RecapLength): ReasonVM | null {
    const { chat, ready } = situation;
    if (situation.off !== null) return catalog.reason(situation.off);
    if (chat === null || ready === null) return catalog.reason('chat-loading');
    if (!flagUsable(ready.bootstrap, ready.page.pageId, 'recap')) return catalog.reason('feature-disabled');
    if (situation.quotaZero) return catalog.reason('quota-zero', situation.quota === null ? undefined : { time: { time: situation.quota.resetsAt } });
    if (ws.running(chat.key) !== null) return catalog.reason('chat-busy');
    // AI-051: the full recap needs history; the short one is the hub's to judge.
    const gate = featureGate(FEATURE_OF[length], { platform: ready.target.binding.platform, window: situation.window, draftEmpty: null });
    return gate === null ? null : catalog.reason(gate.reason);
  }

  function buildButton(situation: Situation, length: RecapLength, label: 'recap.build.short' | 'recap.build.full' | 'recap.refresh'): ActionButtonVM {
    const reason = buildReason(situation, length);
    // Enter builds the full one; «↻ Обновить» carries the Recap key.
    const keyed = reason === null && label !== 'recap.build.short';
    return button(label, { type: 'RefreshRecap', length }, { enabled: reason === null, reason, hotkey: keyed ? featureHotkey(catalog, 'recap') : null });
  }

  function slotVm(copy: RecapCopy): RecapSlotVM {
    return {
      length: copy.length,
      generatedAt: copy.revision,
      stamp: { asOf: copy.revision, coverage: copy.coverage.level },
      saved: saveVm(copy),
      open: button('recap.openLast', { type: 'ShowRecap', length: copy.length }),
    };
  }

  function picker(): RecapPickerVM {
    const situation = ws.situation();
    const { chat, ready } = situation;
    const blocked = blockedView(situation);
    const key = ready === null ? null : ws.slotKey(ready);
    const slots = key === null ? { short: null, full: null } : book.both(key);
    const read = key === null ? null : book.read(key);
    const any = slots.short !== null || slots.full !== null;
    let view: VmView;
    if (blocked !== null) view = blocked;
    else if (read === null || read.state === 'loading') view = any ? views.ready() : views.loading(read?.at ?? null, msg('recap.checking'));
    else if (read.state === 'error' && read.error !== null) {
      const error = errorVm(read.error, i18n);
      const retry: UiAction = { type: 'ReloadView', selector: { of: 'recap.picker' } };
      // What the tab already holds is still shown; the failed read is named, never hidden behind an empty state.
      if (any) view = { s: 'partial', gaps: [{ kind: 'source-failed', source: 'recap.read', code: read.error.code }] };
      else view = isOfflineCode(read.error.code) ? views.offline(error, retry) : views.error(error, retry);
    } else view = any ? views.ready() : views.empty(msg('cg.recapNotFound.title'));
    return {
      view,
      targetName: chat === null ? null : situation.fanName,
      slots: { short: slots.short === null ? null : slotVm(slots.short), full: slots.full === null ? null : slotVm(slots.full) },
      build: { short: buildButton(situation, 'short', 'recap.build.short'), full: buildButton(situation, 'full', 'recap.build.full') },
      splitReason: catalog.reason('not-a-message'),
    };
  }

  function viewVm(): RecapViewVM {
    const situation = ws.situation();
    const { chat, ready } = situation;
    const now = clock.now();
    const ui = chat === null ? null : uiOf(chat.key);
    const length: RecapLength = ui?.length ?? 'full';
    const blocked = blockedView(situation);
    const key = ready === null ? null : ws.slotKey(ready);
    const slots = key === null ? { short: null, full: null } : book.both(key);
    const record: OpRecord | null = ui === null || ui.opId === null ? null : ws.ops.get(ui.opId);
    // A canceled build leaves nothing behind: the sheet shows what is saved again.
    const op = record !== null && record.view.state !== 'canceled' && isRecap(record.view.feature) && lengthOf(record.view.feature) === length ? record : null;
    const running = op !== null && !isTerminalOpState(op.view.state);
    const failed = op !== null && (op.view.state === 'failed' || op.view.state === 'interrupted');
    const copy = running || failed ? null : slots[length];
    const id = op?.view.opId ?? copy?.localId ?? ui?.sheetId ?? null;
    const expanded = id !== null && ws.isExpanded(id);

    // The archive point this recap stands on: the served head of its generation, else the moment it was made.
    const head = op?.view.state === 'done' ? (op.view.servedContext?.servedHead ?? null) : null;
    const point = copy === null ? null : head !== null ? { messageRef: head.messageRef, at: head.at } : { messageRef: null, at: copy.revision };
    const lag = chat === null || copy === null ? null : ws.archiveLag(point, chat.key);

    let view: VmView;
    if (blocked !== null) view = blocked;
    else if (running && op !== null) view = views.loading(op.view.startedAt, null);
    else if (failed && op !== null) view = views.error(errorVm(op.view.error ?? { code: 'CG-OP-INTERRUPTED' }, i18n), { type: 'RefreshRecap', length });
    else if (copy === null) {
      const read = key === null ? null : book.read(key);
      // AI-065: nothing saved at this length — the build buttons are the way.
      view = read === null || read.state === 'loading' ? views.loading(read?.at ?? null, msg('recap.checking')) : views.empty(msg('cg.recapNotFound.title'));
    } else {
      const gaps: PartialGap[] = [];
      // An unknown coverage is said by the stamp; only a known cut makes the recap partial.
      if (copy.coverage.level === 'partial') gaps.push({ kind: 'coverage', level: 'partial' });
      if (lag !== null) gaps.push({ kind: 'archive-lag', messages: lag.messages, minutes: null });
      view = gaps.length === 0 ? views.ready() : { s: 'partial', gaps };
    }
    const debugOn = ws.env.settings?.settings.debug.enabled ?? false;
    const preview = running && op.view.text !== undefined ? streamPreview(op.view.feature, op.view.text) : '';
    const canBuild = (which: RecapLength): boolean => buildReason(situation, which) === null;
    return {
      view,
      length,
      lengths: { short: slots.short !== null || canBuild('short'), full: slots.full !== null || canBuild('full') },
      targetName: chat === null ? null : situation.fanName,
      opId: id,
      state: op?.view.state ?? null,
      phase: op === null ? null : phaseVm(op.view, now),
      streamText: preview.length > 0 ? preview : null,
      markdown: copy?.markdown ?? null,
      blocks: copy?.blocks ?? null,
      generatedAt: copy?.revision ?? null,
      saved: saveVm(copy),
      stamp: { asOf: point?.at ?? null, coverage: copy?.coverage.level ?? 'unknown' },
      archiveLag: lag,
      copyHandle: copy === null ? null : artifactHandle({ kind: 'recap', localId: copy.localId }),
      refresh: buildButton(situation, length, 'recap.refresh'),
      splitReason: catalog.reason('not-a-message'),
      expanded,
      debug: op === null ? null : debugVm(op.view, { enabled: debugOn, expanded, now, i18n }),
    };
  }

  function build(selector: ViewSelector): unknown {
    return selector.of === 'recap.picker' ? picker() : viewVm();
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** Opens the sheet at a length and checks what is saved; never generates. */
  function open(type: UiAction['type'], length: RecapLength | null): ActionReceipt {
    const { chat, ready } = ws.situation();
    if (chat === null) return refused(ws, type, { code: 'CG-CONTEXT-CHANGED' });
    const ui = uiOf(chat.key);
    const key = ready === null ? null : ws.slotKey(ready);
    if (key !== null) book.loadShared(key);
    // The person asked to see recaps: a status read that failed may be asked again.
    book.retryFailedStatuses();
    const slots = key === null ? { short: null, full: null } : book.both(key);
    // AI-065: when the asked length has nothing saved, the slot that exists opens.
    ui.length = length !== null && slots[length] !== null ? length : (latestLength(slots) ?? length ?? 'full');
    const running = ws.running(chat.key);
    // A recap being built for this chat is what the sheet shows.
    if (running !== null && isRecap(running.view.feature)) {
      ui.length = lengthOf(running.view.feature);
      ui.opId = running.view.opId;
    } else ui.opId = null;
    ws.setSheet(chat.key, { kind: 'recap' });
    return done(type, 'opened');
  }

  async function generate(type: UiAction['type'], length: RecapLength, cause: CauseKind): Promise<ActionReceipt> {
    const chat = ws.situation().chat;
    if (chat === null) return refused(ws, type, { code: 'CG-CONTEXT-CHANGED' });
    const ui = uiOf(chat.key);
    const running = ws.running(chat.key);
    // AI-127: the same build is already running — show it.
    if (running !== null && isRecap(running.view.feature) && lengthOf(running.view.feature) === length) {
      ui.length = length;
      ui.opId = running.view.opId;
      ws.setSheet(chat.key, { kind: 'recap' });
      return done(type, 'noop', { opId: running.view.opId });
    }
    const previous = ui.opId === null ? null : ws.ops.get(ui.opId);
    // AI-064: a build is always a new generation — the cache is bypassed.
    const result = await ws.startFeature({
      feature: FEATURE_OF[length],
      surface: 'dock',
      options: {},
      cause,
      force: true,
      ...(previous !== null && previous.view.feature === FEATURE_OF[length] && isTerminalOpState(previous.view.state) ? { regenerateOf: previous } : {}),
    });
    switch (result.kind) {
      case 'started':
        ui.length = length;
        ui.opId = result.opId;
        ws.setSheet(chat.key, { kind: 'recap' });
        return done(type, 'started', { opId: result.opId });
      case 'refused':
        ws.showRefusal(chat.key, result.refusal);
        return refused(ws, type, result.refusal.error);
      case 'failed':
        return refused(ws, type, result.error);
    }
  }

  /** The id names what the recap sheet of this chat shows (its own id, its operation, or a copy). */
  function sheetOwns(key: ChatKey, id: string): boolean {
    const ui = uis.get(key);
    return ui !== undefined && (ui.sheetId === id || ui.opId === id || book.slots.byLocalId(id) !== null);
  }

  const handlers: ActionHandlers = {
    Generate(action) {
      if (!isRecap(action.feature)) return null;
      const chat = ws.situation().chat;
      // The click was for a chat that is gone: its sheet is not opened over another one.
      if (chat === null || chat.handle !== action.targetHandle) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return Promise.resolve(open(action.type, lengthOf(action.feature)));
    },
    ShowRecap(action) {
      const { chat, ready } = ws.situation();
      if (chat === null) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      const ui = uiOf(chat.key);
      ui.length = action.length;
      ui.opId = null;
      const key = ready === null ? null : ws.slotKey(ready);
      if (key !== null) book.loadShared(key);
      ws.setSheet(chat.key, { kind: 'recap' });
      return Promise.resolve(done(action.type, key !== null && book.get(key, action.length) !== null ? 'opened' : 'noop'));
    },
    RefreshRecap: (action, cause) => generate(action.type, action.length, cause),
    // Where the Recap of the open chat is shown (ui-contract.md, decision 13): the strip's button and the window's
    // «Свернуть» ask for the sheet, «Развернуть ↗» for the window, «Скрыть» hides — the recap stays. Never a
    // generation (AI-060): a sheet with nothing saved shows the build buttons.
    ShowAnalysis(action) {
      if (action.view !== 'recap') return null;
      const chat = ws.situation().chat;
      if (chat === null) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      const shown = ws.sheet(chat.key)?.kind === 'recap';
      if (action.mode === 'hidden') {
        if (!shown) return Promise.resolve(done(action.type, 'noop'));
        const id = viewVm().opId;
        if (id !== null) ws.setExpanded(id, false);
        ws.setSheet(chat.key, null);
        return Promise.resolve(done(action.type));
      }
      // A sheet that is already open keeps the length the person chose.
      const opened = shown ? null : open(action.type, null);
      if (opened !== null && !opened.ok) return Promise.resolve(opened);
      const id = viewVm().opId;
      if (id !== null) ws.setExpanded(id, action.mode === 'expanded');
      return Promise.resolve(done(action.type, 'opened'));
    },
    Regenerate(action, cause) {
      const record = ws.ops.get(action.operationId);
      if (record === null || !isRecap(record.view.feature) || !isOwnSurface(record.view.surface)) return null;
      const chat = ws.situation().chat;
      // A build is paid: «Ещё раз» of another chat's recap never builds one for the chat that is open.
      if (chat === null || chat.key !== chatKeyOf(record.view.target.chat)) return Promise.resolve(refused(ws, action.type, { code: 'CG-CONTEXT-CHANGED' }));
      return generate(action.type, lengthOf(record.view.feature), cause);
    },
    RetryRecapSave(action) {
      const ready = ws.situation().ready;
      const key = ready === null ? null : ws.slotKey(ready);
      const copy = key === null ? null : book.get(key, 'full');
      if (key === null || copy === null || action.length !== 'full') return Promise.resolve(refused(ws, action.type, { code: 'CG-RECAP-NOT-FOUND' }));
      return book.save(key, copy, true).then((state) => (state.s === 'failed' ? refused(ws, action.type, { code: 'CG-RECAP-SAVE' }) : done(action.type, state.s === 'saved' ? 'done' : 'started')));
    },
    HideResult(action) {
      const chat = ws.situation().chat;
      if (chat === null || ws.sheet(chat.key)?.kind !== 'recap' || !sheetOwns(chat.key, action.operationId)) return null;
      ws.setSheet(chat.key, null);
      return Promise.resolve(done(action.type));
    },
    ExpandResult(action) {
      const chat = ws.situation().chat;
      if (chat === null || ws.sheet(chat.key)?.kind !== 'recap' || !sheetOwns(chat.key, action.operationId)) return null;
      ws.setExpanded(action.operationId, action.expanded);
      return Promise.resolve(done(action.type, action.expanded ? 'opened' : 'done'));
    },
    ReloadView(action) {
      if (action.selector.of !== 'recap.picker' && action.selector.of !== 'recap.view') return null;
      const ready = ws.situation().ready;
      if (ready !== null) book.loadShared(ws.slotKey(ready), true);
      return Promise.resolve(done(action.type));
    },
  };

  // A recap finished for a chat whose sheet follows it: the sheet keeps showing that length.
  const offOps = ws.onOpEvent((event) => {
    if (event.kind === 'done' && isRecap(event.record.view.feature)) ws.bump();
  });

  return createSurface(ws, { kinds: ['recap.picker', 'recap.view'], build, handlers, dispose: offOps });
}
