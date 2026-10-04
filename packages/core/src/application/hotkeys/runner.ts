// What a key of ours does (architecture.md §9.1 table; HK-002…HK-013, HK-026,
// HK-027, HK-029, HK-036…HK-042): the early dispatcher hands a command, this
// runner turns it into the same UiAction a click on the matching button
// dispatches — through AppClient, so every controller's own checks apply —
// or says in a toast why nothing runs. A key never does more than a button:
// there is no key for «Отправить» and none that inserts by itself.

import { CG_REGISTRY } from '@cg/contracts/errors/registry';
import { type FeatureId, type Tone } from '@cg/contracts/features';
import { OP_TERMINAL_STATES, type OpState } from '@cg/contracts/ops';
import {
  UNAVAILABLE_REASONS,
  type ActionCatalog,
  type ActionReceipt,
  type AppClient,
  type CatalogActionId,
  type DockActionId,
  type DockActionVM,
  type DockStatus,
  type DockVM,
  type I18n,
  type OverlaySurface,
  type PreviewVM,
  type ReasonVM,
  type RecapLength,
  type ToastPort,
  type UiAction,
  type UnavailableReasonId,
} from '@cg/contracts/vm';

import { type DispatcherCommandId, type KeyCommand, type KeyRefusal, type OverlayKind } from '../../domain/hotkeys';
import { type CauseHint } from '../navigation/navigation-controller';
import { type OverlayState } from '../navigation/overlays';
import { type HotkeySink } from './dispatcher';

export interface HotkeyRunnerDeps {
  readonly client: AppClient;
  readonly catalog: ActionCatalog;
  readonly i18n: I18n;
  readonly toasts: ToastPort;
  readonly overlays: OverlayState;
  /** Tells the navigation controller that the next navigation came from a key. */
  readonly cause?: CauseHint;
  /** The dock's sheet opened or closed: the dispatcher's state and the dock host's `data-dismissible-open` follow. */
  readonly onDockSheet?: (open: boolean) => void;
}

export interface HotkeyRunner extends HotkeySink {
  /** A result, Recap or Review is open in the dock. */
  dockSheet(): boolean;
  dispose(): void;
}

const TOGGLED: Readonly<Partial<Record<DispatcherCommandId, OverlaySurface>>> = { spenders: 'spenders', palette: 'palette', cheatsheet: 'cheatsheet', 'fan-panel': 'fan-panel', coach: 'coach' };
const STATUS_REASON: Readonly<Record<DockStatus, UnavailableReasonId>> = {
  ready: 'chat-loading',
  'loading-chat': 'chat-loading',
  'not-signed-in': 'not-signed-in',
  'no-binding': 'no-binding',
  'no-persona': 'no-persona',
  'host-degraded': 'host-degraded',
  'hub-down': 'hub-down',
  'blocked-fan': 'fan-blocked',
  'reload-needed': 'reload-needed',
};

/** Commands that read the open chat's dock: they wait for its first authoritative state (HK-025). */
const NEEDS_DOCK: readonly DispatcherCommandId[] = ['reply', 'fix', 'hi', 'ping', 'review', 'recap', 'coach', 'tone', 'split'];
/** The dock has its first authoritative state: anything but «чат загружается». */
const dockSettled = (dock: DockVM): boolean => dock.status !== 'loading-chat' && dock.view.s !== 'loading';

/** A key never does more than a button and never what only a deliberate click may do: no insert, no replacement, no send. */
const NEVER_BY_KEY: readonly UiAction['type'][] = ['InsertPart', 'OpenAndInsertPart', 'ReplaceMyDraft', 'SendPart'];
const cancelsOnly = (action: UiAction): boolean => !NEVER_BY_KEY.includes(action.type) && (action.type !== 'AnswerConfirm' || action.choice === 'cancel');

const isRunning = (state: OpState | null | undefined): boolean => state !== null && state !== undefined && !(OP_TERMINAL_STATES as readonly string[]).includes(state);

/** ⌘⇧O walks the tones round: no tone → each tone → no tone (AI-008); it starts nothing. */
export function nextTone(current: Tone | null, tones: readonly Tone[]): Tone | null {
  const ring: readonly (Tone | null)[] = [null, ...tones];
  return ring[(ring.indexOf(current) + 1) % ring.length] ?? null;
}

export function createHotkeyRunner(deps: HotkeyRunnerDeps): HotkeyRunner {
  const { client, catalog, i18n, toasts, overlays } = deps;
  let sheet = false;

  const dockView = (): DockVM => client.getSnapshot({ of: 'dock' });
  const previewView = (): PreviewVM | null => {
    const from = overlays.previewFrom();
    return from === null ? null : client.getSnapshot({ of: 'preview', from });
  };
  const sheetOf = (dock: DockVM): boolean => dock.result !== null || dock.analysis !== null || dock.refusal !== null;
  const syncSheet = (dock: DockVM): void => {
    const open = dock.visible && sheetOf(dock);
    if (open === sheet) return;
    sheet = open;
    deps.onDockSheet?.(open);
  };
  syncSheet(dockView());

  // HK-025: until the dock's first authoritative state arrives, a key of the dock is not judged against «чат
  // загружается» — the dispatcher keeps it and asks again when this fires. Later loads say the reason at once.
  let settled = dockSettled(dockView());
  const readyListeners = new Set<() => void>();
  const unsubscribeDock = client.subscribe({ of: 'dock' }, (dock) => {
    syncSheet(dock);
    if (settled || !dockSettled(dock)) return;
    settled = true;
    for (const listener of [...readyListeners]) listener();
  });

  const reasonOf = (id: UnavailableReasonId): ReasonVM => catalog.reason(id);
  const labelOf = (id: CatalogActionId): string => i18n.t(catalog.entry(id).label);

  /** HK-026: a key of an action that cannot run says why, in the words of the button's tooltip. */
  const unavailable = (id: CatalogActionId, reason: ReasonVM): void => {
    toasts.show({ kind: 'warning', code: reason.code, scope: `hotkey.${id}`, title: { key: 'dock.action.unavailable', params: { action: labelOf(id), reason: i18n.text(reason.text) } }, body: null });
  };

  const send = (action: UiAction, key = false): void => {
    if (key) deps.cause?.mark('key');
    void client.dispatch(action).then(
      (receipt: ActionReceipt) => {
        // A refused generation shows in its own place (the dock's refusal card); a failed switch or navigation only here.
        if (receipt.ok || action.type === 'Generate') return;
        const entry = CG_REGISTRY[receipt.code];
        toasts.show({ kind: entry.severity === 'error' ? 'error' : 'warning', code: receipt.code, scope: `hotkey.${action.type}`, title: { key: entry.title }, body: { key: entry.body } });
      },
      () => toasts.show({ kind: 'error', code: 'CG-UI-FAILED', scope: 'hotkey', title: { key: CG_REGISTRY['CG-UI-FAILED'].title }, body: { key: CG_REGISTRY['CG-UI-FAILED'].body } }),
    );
  };

  const toggle = (surface: OverlaySurface): void => send({ type: 'Navigate', to: { kind: 'surface', surface, open: !overlays.isOpen(surface) } });

  /** The button of the open chat's dock, or the reason the whole strip is off. */
  const dockAction = (id: DockActionId): { readonly dock: DockVM; readonly state: DockActionVM; readonly target: string } | null => {
    const dock = dockView();
    const state = dock.actions[id];
    if (!dock.visible || dock.targetHandle === null) {
      unavailable(id, state.reason ?? reasonOf(STATUS_REASON[dock.status]));
      return null;
    }
    // Its own generation runs: the key does nothing (Cancel is ⌘.).
    if (state.busy) return null;
    if (!state.enabled) {
      unavailable(id, state.reason ?? reasonOf(STATUS_REASON[dock.status]));
      return null;
    }
    return { dock, state, target: dock.targetHandle };
  };

  const generate = (id: Extract<FeatureId, DockActionId>, where: KeyCommand['target']): void => {
    if (where === 'preview') {
      const preview = previewView();
      const state = preview?.bar.actions[id as keyof PreviewVM['bar']['actions']];
      if (preview === null || preview.handle === null || state === undefined) {
        unavailable(id, reasonOf('feature-disabled'));
        return;
      }
      if (state.busy) return;
      if (!state.enabled) {
        unavailable(id, state.reason ?? reasonOf('feature-disabled'));
        return;
      }
      send({ type: 'Generate', targetHandle: preview.handle, feature: id, options: {} });
      return;
    }
    const found = dockAction(id);
    if (found !== null) send({ type: 'Generate', targetHandle: found.target, feature: id, options: {} });
  };

  const recap = (): void => {
    const found = dockAction('recap');
    if (found === null) return;
    if (found.dock.analysis === 'recap') {
      // The sheet is open: the key is its «↻ Обновить» (ui-design §4.11).
      const length: RecapLength = client.getSnapshot({ of: 'recap.view' }).length;
      send({ type: 'RefreshRecap', length });
      return;
    }
    const slots = client.getSnapshot({ of: 'recap.picker' }).slots;
    send({ type: 'ShowRecap', length: slots.full === null && slots.short !== null ? 'short' : 'full' });
  };

  const tone = (where: KeyCommand['target']): void => {
    const options = where === 'preview' ? previewView()?.bar : dockView().options;
    const target = where === 'preview' ? (previewView()?.handle ?? null) : dockView().targetHandle;
    if (options === undefined || target === null) {
      unavailable('tone', reasonOf(where === 'preview' ? 'feature-disabled' : STATUS_REASON[dockView().status]));
      return;
    }
    if (options.locked || options.toneReason !== null) {
      unavailable('tone', options.toneReason ?? reasonOf('locked-during-generation'));
      return;
    }
    send({ type: 'SetTone', targetHandle: target, tone: nextTone(options.tone, options.tones) });
  };

  const split = (where: KeyCommand['target']): void => {
    const options = where === 'preview' ? previewView()?.bar : dockView().options;
    if (options === undefined) {
      unavailable('split', reasonOf('feature-disabled'));
      return;
    }
    if (options.locked || options.splitReason !== null) {
      unavailable('split', options.splitReason ?? reasonOf('locked-during-generation'));
      return;
    }
    const value = !options.split;
    // HK-011: a switch with a toast — the strip may be out of sight or too narrow to show it.
    void client.dispatch({ type: 'SetPreference', key: 'generation.split', value }).then(
      (receipt) => {
        if (receipt.ok) toasts.show({ kind: 'info', code: null, scope: 'hotkey.split', title: { key: value ? 'toast.splitOn' : 'toast.splitOff' }, body: null });
        else toasts.show({ kind: 'warning', code: receipt.code, scope: 'hotkey.split', title: { key: CG_REGISTRY[receipt.code].title }, body: { key: CG_REGISTRY[receipt.code].body } });
      },
      () => undefined,
    );
  };

  /** ⌘.: the generation that runs where the person looks — the preview's, else the dock's, Recap, Review or Coach. */
  const cancel = (where: KeyCommand['target']): void => {
    if (where === 'preview') {
      const result = previewView()?.result ?? null;
      if (result !== null && isRunning(result.state)) send({ type: 'CancelGeneration', operationId: result.opId });
      return;
    }
    const dock = dockView();
    if (dock.result !== null && isRunning(dock.result.state)) {
      send({ type: 'CancelGeneration', operationId: dock.result.opId });
      return;
    }
    const analysis = dock.analysis === 'recap' ? client.getSnapshot({ of: 'recap.view' }) : dock.analysis === 'review' ? client.getSnapshot({ of: 'review' }) : null;
    if (analysis !== null && analysis.opId !== null && isRunning(analysis.state)) {
      send({ type: 'CancelGeneration', operationId: analysis.opId });
      return;
    }
    if (overlays.isOpen('coach')) {
      const turns = client.getSnapshot({ of: 'coach' }).turns;
      const last = turns[turns.length - 1];
      if (last !== undefined && last.opId !== null && isRunning(last.state)) send({ type: 'CancelGeneration', operationId: last.opId });
    }
  };

  /** HK-029: Esc closes the top of ours — the newest window first, the dock's sheet last. */
  const close = (): void => {
    const top: OverlayKind | null = overlays.top();
    if (top === 'preview') {
      const preview = previewView();
      if (preview !== null) send(preview.close);
      return;
    }
    if (top === 'result-expanded') {
      const opId = dockView().result?.opId ?? null;
      if (opId !== null) send({ type: 'ExpandResult', operationId: opId, expanded: false });
      return;
    }
    if (top === 'dialog') {
      // Esc is the dialog's «Отмена» wherever the focus is (ui-design §6.3, Б2) — a dialog that took the key inside
      // its own root never gets here. What its owner registered, else the confirmation on screen; never an answer
      // that inserts, replaces or sends.
      const registered = overlays.closeAction('dialog');
      const asked = previewView()?.result?.confirm ?? dockView().result?.confirm ?? null;
      if (registered !== null) {
        if (cancelsOnly(registered)) send(registered);
      } else if (asked !== null) send({ type: 'AnswerConfirm', confirmationId: asked.confirmationId, choice: 'cancel' });
      return;
    }
    if (top !== null) {
      send({ type: 'Navigate', to: { kind: 'surface', surface: top, open: false } });
      return;
    }
    const dock = dockView();
    const opId = dock.result?.opId ?? (dock.analysis === 'recap' ? client.getSnapshot({ of: 'recap.view' }).opId : dock.analysis === 'review' ? client.getSnapshot({ of: 'review' }).opId : null);
    if (opId !== null) send({ type: 'HideResult', operationId: opId });
  };

  const run = (command: KeyCommand): void => {
    const id = command.id;
    if (id === 'reply' || id === 'fix' || id === 'hi' || id === 'ping' || id === 'review') return generate(id, command.target);
    if (id === 'recap') return recap();
    if (id === 'tone') return tone(command.target);
    if (id === 'split') return split(command.target);
    if (id === 'cancel') return cancel(command.target);
    if (id === 'close') return close();
    if (id === 'coach') {
      // Opening Coach needs the chat's Coach to be available; closing it never does.
      if (overlays.isOpen('coach') || dockAction('coach') !== null) toggle('coach');
      return;
    }
    if (id === 'settings') return send({ type: 'OpenSettings', route: { section: 'status' } });
    if (id === 'chat-next' || id === 'chat-previous') return send({ type: 'Navigate', to: { kind: 'chat-step', direction: id === 'chat-next' ? 'next' : 'previous' } }, true);
    if (id === 'next-unread') return send({ type: 'Navigate', to: { kind: 'next-unread' } }, true);
    if (id === 'quick-jump') {
      if (command.slot === null) return;
      if (overlays.isOpen('quick-jump')) {
        // Under the open popup the digit is the row the person sees there — the row's own action, which names
        // the chat — not whatever is N-th in ChatSpace's list by now. An empty row opens nothing.
        const row = client.getSnapshot({ of: 'quick-jump' }).items.find((item) => item.slot === command.slot);
        if (row !== undefined && row.action.type === 'Navigate') send(row.action, true);
        return;
      }
      send({ type: 'Navigate', to: { kind: 'chat-slot', slot: command.slot } }, true);
      return;
    }
    const surface = TOGGLED[id];
    if (surface !== undefined) toggle(surface);
    // `help` never runs: the dispatcher refuses it (Б3).
  };

  return {
    run,
    refuse(command: DispatcherCommandId, refusal: KeyRefusal) {
      if (refusal === 'help-removed') {
        toasts.show({ kind: 'info', code: UNAVAILABLE_REASONS['help-removed'].code, scope: 'hotkey.help', title: { key: 'dock.helpRemoved' }, body: null });
        return;
      }
      if (refusal === 'in-field') {
        // «{action} недоступен: курсор в поле, где это сочетание не работает» — the same sentence as every other reason.
        toasts.show({ kind: 'warning', code: null, scope: `hotkey.${command}`, title: { key: 'dock.action.unavailable', params: { action: labelOf(command), reason: i18n.t('dock.reason.keyInField') } }, body: null });
        return;
      }
      unavailable(command, reasonOf(refusal === 'chat-loading' ? 'chat-loading' : 'overlay-open'));
    },
    ready: (command: KeyCommand) => settled || command.target !== 'dock' || !NEEDS_DOCK.includes(command.id),
    onReady(listener: () => void) {
      readyListeners.add(listener);
      return () => {
        readyListeners.delete(listener);
      };
    },
    quickJump(open: boolean) {
      send({ type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open } });
    },
    dockSheet: () => sheet,
    dispose() {
      unsubscribeDock();
      readyListeners.clear();
    },
  };
}
