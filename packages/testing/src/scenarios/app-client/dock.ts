// DockVM for the scenarios: the strip in each status with its reasons, the
// quota slot, Tone/Split, and the sheet (a result, Recap/Review, a refusal).
// The bar's chips are the ones the dock's controller would build for the same
// actions: ChatSpace's slice of the feature manifest through core's `dockChips`.

import {
  DOCK_ACTION_IDS,
  TONES,
  type CgCode,
  type ChipVM,
  type DockActionId,
  type DockActionVM,
  type DockStatus,
  type DockVM,
  type ReasonVM,
  type RunningOpVM,
  type VmView,
} from '@cg/contracts';
import { CHATSPACE_FEATURES } from '@cg/contracts/features/chatspace';
import { FEATURES_COMMON } from '@cg/contracts/features/common';

import { dockChips, featureSlice } from '@cg/core/domain/features';

import { cgError, FANS, handles, hotkey, isHotkeyName, PERSONA, reason, translatorOf, views, type FanFixture, type ScenarioCtx } from './base';

/** The site of the scenarios and of the stand is ChatSpace: its slice of the feature manifest. */
export const SCENARIO_FEATURES = featureSlice(FEATURES_COMMON, CHATSPACE_FEATURES);

/** The bar's chips for a dock's actions, as the controller builds them (core `dockChips`, domain/features/admission.ts). */
export function dockChipsOf(ctx: ScenarioCtx, vm: Pick<DockVM, 'actions' | 'targetHandle'>): ChipVM[] {
  return dockChips(SCENARIO_FEATURES, vm.actions, vm.targetHandle, (action) => (isHotkeyName(action) ? hotkey(ctx, action) : null));
}

export interface DockActionsOptions {
  /** Every action off with this reason (status, quota, loading). */
  readonly off?: ReasonVM | null;
  /** The running feature: its button busy, the other six off with `chat-busy` (UI-008). */
  readonly busy?: DockActionId | null;
  readonly active?: DockActionId | null;
  readonly recapReady?: boolean;
  /** Per-action overrides (gates: Fix without a draft, Hi in a dialog…). */
  readonly gates?: Partial<Record<DockActionId, ReasonVM>>;
}

export function dockActions(ctx: ScenarioCtx, options: DockActionsOptions = {}): Record<DockActionId, DockActionVM> {
  const entries = DOCK_ACTION_IDS.map((id): [DockActionId, DockActionVM] => {
    const busy = options.busy === id;
    const gate = options.gates?.[id] ?? null;
    const off = options.off ?? (options.busy !== undefined && options.busy !== null && !busy ? reason('chat-busy') : null) ?? gate;
    return [
      id,
      {
        enabled: off === null,
        busy,
        active: options.active === id || busy,
        reason: off,
        hotkey: off === null ? hotkey(ctx, id) : null,
        badge: id === 'recap' && options.recapReady === true ? 'recap-ready' : null,
      },
    ];
  });
  return Object.fromEntries(entries) as Record<DockActionId, DockActionVM>;
}

const STATUS_VIEW: Record<DockStatus, (ctx: ScenarioCtx, code: CgCode | null) => VmView> = {
  ready: () => views.ready(),
  'loading-chat': (ctx) => views.loading(ctx.now - 800, { key: 'dock.status.chatLoading' }),
  'not-signed-in': (ctx) => views.forbidden(cgError(ctx, 'CG-AUTH-REQUIRED'), { type: 'OpenSettings', route: { section: 'account', code: 'CG-AUTH-REQUIRED' } }),
  'no-binding': (ctx, code) => views.forbidden(cgError(ctx, code ?? 'CG-BINDING-MISSING')),
  'no-persona': (ctx) => views.forbidden(cgError(ctx, 'CG-PERSONA-UNASSIGNED'), { type: 'OpenSettings', route: { section: 'personas', code: 'CG-PERSONA-UNASSIGNED' } }),
  'host-degraded': () => views.partial({ kind: 'host-degraded', capabilities: ['insert', 'draftRead'] }),
  'hub-down': (ctx) => views.offline(cgError(ctx, 'CG-HUB-UNAVAILABLE'), { type: 'RecheckStatus' }, ctx.now - 90_000),
  'blocked-fan': () => views.partial({ kind: 'host-degraded', capabilities: ['insert'] }),
  'reload-needed': (ctx) => views.error(cgError(ctx, 'CG-RUNTIME-RELOADED', { detail: 'old tab script detached • build 0.4.3' }), { type: 'ReloadTab' }),
};

const STATUS_REASON: Partial<Record<DockStatus, ReasonVM>> = {
  'loading-chat': reason('chat-loading'),
  'not-signed-in': reason('not-signed-in'),
  'no-binding': reason('no-binding'),
  'no-persona': reason('no-persona'),
  'hub-down': reason('hub-down'),
  'reload-needed': reason('reload-needed'),
};

const STATUS_ERROR: Partial<Record<DockStatus, CgCode>> = {
  'not-signed-in': 'CG-AUTH-REQUIRED',
  'no-binding': 'CG-BINDING-MISSING',
  'no-persona': 'CG-PERSONA-UNASSIGNED',
  'host-degraded': 'CG-HOST-CONTRACT',
  'hub-down': 'CG-HUB-UNAVAILABLE',
  'blocked-fan': 'CG-GATE-FAN-BLOCKED',
  'reload-needed': 'CG-RUNTIME-RELOADED',
};

export interface DockOptions extends Partial<DockVM> {
  readonly fan?: FanFixture;
  /** Overrides the code of the status (no-binding vs not-granted, composer missing). */
  readonly code?: CgCode;
  readonly actionsOptions?: DockActionsOptions;
}

/** A dock in the open chat of `fan`, in `status`; the rest from `patch`. */
export function dock(ctx: ScenarioCtx, status: DockStatus = 'ready', options: DockOptions = {}): DockVM {
  const { fan = FANS.hubert, code, actionsOptions, ...patch } = options;
  const errorCode = code ?? STATUS_ERROR[status] ?? null;
  const off = status === 'no-binding' && code === 'CG-BINDING-NOT-GRANTED' ? reason('not-granted') : (STATUS_REASON[status] ?? null);
  const allOff = off !== null;
  const generating = actionsOptions?.busy !== undefined && actionsOptions.busy !== null;
  const optionReason = off ?? (generating ? reason('locked-during-generation') : null);
  const copyOnly = status === 'host-degraded' || status === 'blocked-fan';
  const vm: DockVM = {
    view: STATUS_VIEW[status](ctx, errorCode),
    visible: true,
    mode: copyOnly ? 'copy-only' : 'insert',
    status,
    statusError: errorCode === null ? null : cgError(ctx, errorCode),
    targetHandle: status === 'loading-chat' ? null : handles.dock(fan),
    persona: status === 'not-signed-in' || status === 'no-binding' || status === 'no-persona' ? null : PERSONA,
    mark: allOff ? 'faint' : 'normal',
    quota: null,
    options: {
      tone: null,
      tones: TONES,
      split: false,
      locked: generating,
      toneReason: optionReason,
      splitReason: optionReason,
      toneHotkey: hotkey(ctx, 'tone'),
      splitHotkey: hotkey(ctx, 'split'),
    },
    actions: dockActions(ctx, { off, ...actionsOptions }),
    result: null,
    analysis: null,
    refusal: null,
    runningElsewhere: [],
    statusWords: status === 'loading-chat',
    hints: true,
    keysFooter: false,
    resultStyle: 'bare',
    paletteHotkey: hotkey(ctx, 'palette'),
    debug: ctx.debug ? { renderTrace: false, contract: 'index-0000test · ok' } : null,
    ...patch,
  };
  // The chips follow the actions the scenario ended up with, unless it names its own.
  return patch.chips === undefined ? { ...vm, chips: dockChipsOf(ctx, vm) } : vm;
}

/** Why every AI action is off on a page the owner switched off: the existing reason id with the page's own words (1.3.0). */
export const PAGE_OFF_REASON: ReasonVM = { id: 'feature-disabled', code: 'CG-FEATURE-DISABLED', text: { key: 'dock.reason.pageOff' } };

/**
 * The owner switched ChatGoose off — the hub's master switch, one for every page (1.3.0): the dock stays `ready`, says so in one
 * status line, every AI action and option carries that reason, and what was generated before can only be copied.
 */
export function dockPageOff(ctx: ScenarioCtx, options: DockOptions = {}): DockVM {
  const t = translatorOf(ctx);
  const base = dock(ctx, 'ready', { actionsOptions: { off: PAGE_OFF_REASON }, ...options });
  return {
    ...base,
    mode: 'copy-only',
    mark: 'faint',
    options: { ...base.options, toneReason: PAGE_OFF_REASON, splitReason: PAGE_OFF_REASON },
    notice: 'notice' in options ? (options.notice ?? null) : { code: 'CG-FEATURE-DISABLED', title: t.text('dock.status.pageOff'), body: '', detail: 'disabled', tone: 'state' },
  };
}

/** Outside a chat: no strip at all (UI-012). */
export function dockOutsideChat(ctx: ScenarioCtx): DockVM {
  return dock(ctx, 'ready', { view: views.empty({ key: 'common.empty' }), visible: false, targetHandle: null });
}

export function running(ctx: ScenarioCtx, fan: FanFixture, feature: RunningOpVM['feature'], secondsAgo: number, opId: string, inThisTab = true): RunningOpVM {
  return {
    opId,
    feature,
    fanLabel: fan.name,
    startedAt: ctx.now - secondsAgo * 1000,
    inThisTab,
    go: { type: 'Navigate', to: { kind: 'chat', targetHandle: handles.dock(fan) } },
    cancel: { type: 'CancelGeneration', operationId: opId },
  };
}
