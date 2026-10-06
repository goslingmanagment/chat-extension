// core/application/ai — the AI controllers of the tab (R11; architecture.md
// §10.2, §16): the dock, Recap, Review and Coach over one shared workspace.
// The integrator plugs the controllers into the tab's AppClient router and
// hands the ports in; nothing here touches browser.*, the DOM, the network
// or storage.
//
// - `createAiSurfaces(ports)` builds the workspace and the four controllers
//   and starts them. Each controller is a router `SurfaceController`
//   (`kinds`, `getSnapshot`, `subscribe`, `dispatch` → null when the action
//   is not its own). Recap, Review and Coach may also be created later from
//   the same workspace (lazy chunks): `createRecapController(workspace)`.
// - `command(id)` is for the early hotkey dispatcher (§9.1): the key of an
//   AI action pressed in a chat either becomes the action, or — when the
//   action is off — is swallowed with its reason as a toast (HK-026). ⌘⇧H is
//   always swallowed: Help is removed (Б3).
// - `resultShown(opId)` is for `RenderMarks.resultShown`: telemetry `shown`
//   only when the result was really visible (§9.6).

import { type ActionReceipt, type CatalogActionId, type DockVM, type Msg, type ReasonVM, type RecapViewVM, type UiAction } from '@cg/contracts/vm';

import { HELP_REMOVED, nextTone } from '../../domain/features';
import { createCoachController, type CoachController } from '../coach/controller';
import { createDockController, type DockController } from '../dock/controller';
import { createRecapController, type RecapController } from '../recap/controller';
import { createReviewController, type ReviewController } from '../review/controller';
import { type AiPorts } from './ports';
import { type AiController } from './surface';
import { msg } from './view-models';
import { AiWorkspace } from './workspace';

export type CommandOutcome =
  /** The key did its action. */
  | { readonly kind: 'dispatched'; readonly action: UiAction; readonly receipt: ActionReceipt }
  /** The key is ours but does nothing now: it is swallowed and the reason is shown (HK-026, Б3). */
  | { readonly kind: 'hint'; readonly reason: ReasonVM }
  /** Not a command of the AI controllers: the dispatcher asks elsewhere. */
  | { readonly kind: 'ignored' };

export interface AiSurfaces {
  readonly workspace: AiWorkspace;
  readonly dock: DockController;
  readonly recap: RecapController;
  readonly review: ReviewController;
  readonly coach: CoachController;
  /** For the router, in asking order. */
  readonly controllers: readonly AiController[];
  command(id: CatalogActionId): Promise<CommandOutcome>;
  resultShown(opId: string): void;
  dispose(): void;
}

const AI_ACTIONS = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach'] as const;
type AiAction = (typeof AI_ACTIONS)[number];
const isAiAction = (id: CatalogActionId): id is AiAction => (AI_ACTIONS as readonly string[]).includes(id);

export function createAiSurfaces(ports: AiPorts): AiSurfaces {
  const workspace = new AiWorkspace(ports);
  const dock = createDockController(workspace);
  const recap = createRecapController(workspace);
  const review = createReviewController(workspace);
  const coach = createCoachController(workspace);
  const controllers: readonly AiController[] = [dock, recap, review, coach];
  workspace.start();

  /** A hotkey's action goes to the controller that takes it, as a `key` cause. */
  async function run(action: UiAction): Promise<CommandOutcome> {
    for (const controller of controllers) {
      const receipt = controller.handle(action, 'key');
      if (receipt !== null) return { kind: 'dispatched', action, receipt: await receipt };
    }
    return { kind: 'ignored' };
  }

  function hint(reason: ReasonVM, title: Msg): CommandOutcome {
    ports.toasts?.show({ kind: 'info', code: reason.code, scope: 'dock.hotkey', title, body: null });
    return { kind: 'hint', reason };
  }

  async function command(id: CatalogActionId): Promise<CommandOutcome> {
    const { catalog, i18n } = ports;
    // Б3: Help is removed — its key never reaches ChatSpace and says so.
    if (id === HELP_REMOVED.catalogAction) return hint(catalog.reason(HELP_REMOVED.reason), msg('dock.helpRemoved'));
    const vm = dock.getSnapshot({ of: 'dock' }) as DockVM;
    // Outside a chat the AI keys are not ours (§9.1 «вне чата — только глобальные»).
    if (!vm.visible) return { kind: 'ignored' };
    const handle = workspace.situation().chat?.handle ?? null;
    if (isAiAction(id)) {
      const state = vm.actions[id];
      const name = i18n.t(catalog.entry(id).label);
      if (!state.enabled || handle === null) {
        const reason = state.reason ?? catalog.reason('chat-loading');
        return hint(reason, msg('dock.action.unavailable', { action: name, reason: i18n.text(reason.text) }));
      }
      if (id === 'recap' && vm.analysis === 'recap') {
        // ⌘⇧S with the Recap sheet open is «↻ Обновить»: a new one of the shown length.
        const shown = recap.getSnapshot({ of: 'recap.view' }) as RecapViewVM;
        if (shown.refresh.enabled) return run(shown.refresh.action);
        const reason = shown.refresh.reason ?? catalog.reason('chat-busy');
        return hint(reason, msg('dock.action.unavailable', { action: name, reason: i18n.text(reason.text) }));
      }
      return run({ type: 'Generate', targetHandle: handle, feature: id, options: {} });
    }
    if (id === 'tone') {
      const chat = workspace.situation().chat;
      if (chat === null) return { kind: 'ignored' };
      const reason = vm.options.toneReason;
      if (reason !== null) return hint(reason, msg('dock.option.toneUnavailable', { reason: i18n.text(reason.text) }));
      // AI-008: the key walks the tones and starts nothing. A walk sets the tone; it is not the menu's toggle.
      const next = nextTone(vm.options.tone);
      workspace.setTone(chat.key, next);
      return { kind: 'dispatched', action: { type: 'SetTone', targetHandle: chat.handle, tone: next }, receipt: { ok: true, type: 'SetTone', outcome: 'done' } };
    }
    if (id === 'split') {
      const reason = vm.options.splitReason;
      if (reason !== null) return hint(reason, msg('dock.option.splitUnavailable', { reason: i18n.text(reason.text) }));
      return run({ type: 'SetPreference', key: 'generation.split', value: !vm.options.split });
    }
    if (id === 'cancel') {
      // ⌘. / Ctrl+.: the generation running in the open chat.
      const chat = workspace.situation().chat;
      const running = chat === null ? null : workspace.running(chat.key);
      return running === null ? { kind: 'ignored' } : run({ type: 'CancelGeneration', operationId: running.view.opId });
    }
    return { kind: 'ignored' };
  }

  return {
    workspace,
    dock,
    recap,
    review,
    coach,
    controllers,
    command,
    resultShown: (opId) => workspace.resultShown(opId),
    dispose() {
      for (const controller of controllers) controller.dispose();
      workspace.dispose();
    },
  };
}

export { COACH_ARCHIVES_MAX, createCoachController, type CoachController } from '../coach/controller';
export { type BoardHandover, type BoardPartFacts, type BoardResults } from '../board-handover';
export { KEYS_FOOTER_RESULTS, createDockController, type DockController } from '../dock/controller';
export { RECAP_UI_CHATS_MAX, createRecapController, type RecapController } from '../recap/controller';
export { createReviewController, type ReviewController } from '../review/controller';
export { TabEnvironment, type EnvironmentChange, type Loaded, type PersonaState } from './environment';
export { artifactHandle, readArtifactHandle, readTargetHandle, targetHandle, type Artifact, type TargetSurface } from './handles';
export { OpStore, RESYNC_RETRY_MS, WATCHED_CHATS_MAX, type OpRecord, type OpStoreEvent, type StartMemo, type StartOutcome } from './op-store';
export {
  type AiPorts,
  type IdPort,
  type JournalSink,
  type OverlaySwitch,
  type RpcAnswer,
  type RpcConnection,
  type SurfaceController as AiSurfaceController,
  type TabRequestName,
  type TabRpcPort,
  type TimerClock,
  type ToastSink,
} from './ports';
export { RECAP_STATUS, SHARED_RECAPS_TTL_MS, RecapBook, type RecapOwner, type SharedRead } from './recap-book';
export { sameView, type AiController, type CauseKind } from './surface';
export { AiWorkspace, BOARD_QUESTION_STEP_MS, BOARD_QUESTION_WAIT_MS, CHAT_UI_MAX, COPIED_MARK_MS, QUOTA_LOW_AT, SENT_REPORT_TRIES, isOwnSurface, type ReadyTarget, type RefusalState, type Sheet, type Situation, type StartRequest, type StartResult } from './workspace';
