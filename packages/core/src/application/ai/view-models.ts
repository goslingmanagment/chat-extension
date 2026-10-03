// Pieces every AI view model is built from (architecture.md §10.2;
// ui-design §4.4, §4.8, §4.12): our own words as `Msg`, errors rendered by
// the registry in the current language, the recovery buttons of an error,
// the stage line of a running generation, and the debug footer. Pure
// functions of the operation view and the clock; nothing here decides
// whether an action is allowed — that is the controllers' business.

import { type CgCode, type CgErrorView, type CgErrorWire, type I18nKey } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type OpDebugView, type OpView, type Phase } from '@cg/contracts/ops';
import {
  HANDLE_PATTERN,
  type ActionButtonVM,
  type ActionCatalog,
  type CatalogActionId,
  type HotkeyLabel,
  type I18n,
  type I18nParams,
  type Msg,
  type PhaseVM,
  type ReasonVM,
  type ResultDebugVM,
  type StageId,
  type UiAction,
  type VmView,
} from '@cg/contracts/vm';

import { SEGMENT_LABEL_KEYS, formatCostLine, profileOf, type StageMark } from '../../domain/debug';
import { errorView, recoveryActions } from '../../domain/errors';
import { createTranslator, type Translator } from '../../domain/i18n';
import { isTerminalOpState } from '../../domain/ops';
import { policyOf } from '../../domain/features';

export const msg = (key: I18nKey, params?: I18nParams): Msg => (params === undefined ? { key } : { key, params });

const translators = new Map<string, Translator>();

/** The plain translator of the port's current language (errors and technical lines are rendered with it). */
export function translatorOf(i18n: I18n): Translator {
  let translator = translators.get(i18n.language);
  if (translator === undefined) {
    translator = createTranslator(i18n.language);
    translators.set(i18n.language, translator);
  }
  return translator;
}

/** An error as the person sees it, in the current language (ER-005…ER-008). */
export function errorVm(wire: CgErrorWire, i18n: I18n): CgErrorView {
  return errorView(wire, translatorOf(i18n));
}

export function button(label: I18nKey | Msg, action: UiAction, patch: Partial<Omit<ActionButtonVM, 'label' | 'action'>> = {}): ActionButtonVM {
  return { label: typeof label === 'string' ? msg(label) : label, action, enabled: true, reason: null, hotkey: null, ...patch };
}

/** The key printed on a feature's own buttons («Ещё раз ⌘E», «↻ Обновить ⌘⇧S»). */
export function featureHotkey(catalog: ActionCatalog, feature: FeatureId): HotkeyLabel | null {
  return catalog.entry(policyOf(feature).dockAction satisfies CatalogActionId).hotkey;
}

// ── view states ─────────────────────────────────────────────────────────────

/** Codes that mean «the hub or the background does not answer»: the view is `offline`, not `error`. */
const OFFLINE_CODES: readonly CgCode[] = ['CG-HUB-UNAVAILABLE', 'CG-HUB-TIMEOUT', 'CG-NETWORK', 'CG-TIMEOUT', 'CG-RUNTIME-UNREACHABLE'];

export const isOfflineCode = (code: CgCode): boolean => OFFLINE_CODES.includes(code);

export const views = {
  loading: (since: number | null = null, stage: Msg | null = null): VmView => ({ s: 'loading', since, stage }),
  ready: (): VmView => ({ s: 'ready' }),
  empty: (why: Msg): VmView => ({ s: 'empty', why }),
  error: (error: CgErrorView, retry: UiAction | null = null): VmView => ({ s: 'error', error, retry }),
  forbidden: (error: CgErrorView, remedy: UiAction | null = null): VmView => ({ s: 'forbidden', error, remedy }),
  offline: (error: CgErrorView, retry: UiAction | null = null, lastGoodAt: number | null = null): VmView => ({ s: 'offline', error, retry, lastGoodAt }),
};

// ── the stage line (ui-design §4.4) ─────────────────────────────────────────

const STAGE_KEYS: Readonly<Record<StageId, I18nKey>> = {
  context: 'result.stage.context',
  thinking: 'result.stage.thinking',
  writing: 'result.stage.writing',
  'retry-wait': 'result.stage.retry503',
  parsing: 'result.stage.parsing',
  saving: 'result.stage.saving',
};

/** The stages already passed and the one running, by the operation's phase (AI-139). */
function stagesOf(phase: Phase['name']): { readonly done: readonly StageId[]; readonly current: StageId } | null {
  switch (phase) {
    case 'admitted':
    case 'connecting':
    case 'awaiting-meta':
      return { done: [], current: 'context' };
    case 'awaiting-first-chunk':
      return { done: ['context'], current: 'thinking' };
    case 'streaming':
      return { done: ['context', 'thinking'], current: 'writing' };
    case 'retry-wait':
      return { done: [], current: 'retry-wait' };
    case 'parsing':
      return { done: ['context', 'thinking', 'writing'], current: 'parsing' };
    case 'saving-profile':
      return { done: ['context', 'thinking', 'writing', 'parsing'], current: 'saving' };
    case 'settled':
      return null;
  }
}

/**
 * The stage line of a running generation: done stages, the current one, the
 * one transparent retry's deadline, and «Отменить». null once it ended.
 */
export function phaseVm(view: Pick<OpView, 'opId' | 'state' | 'phase' | 'startedAt'>, now: number): PhaseVM | null {
  if (isTerminalOpState(view.state)) return null;
  const stages = stagesOf(view.phase.name);
  if (stages === null) return null;
  const retryAt = view.phase.name === 'retry-wait' ? (view.phase.retryAt ?? null) : null;
  const label = (id: StageId): Msg => (id === 'retry-wait' ? msg(STAGE_KEYS[id], { n: Math.max(0, Math.ceil(((retryAt ?? now) - now) / 1000)) }) : msg(STAGE_KEYS[id]));
  return {
    startedAt: view.startedAt,
    stages: [...stages.done.map((id) => ({ id, label: label(id), state: 'done' as const })), { id: stages.current, label: label(stages.current), state: 'current' as const }],
    retryAt,
    cancel: { type: 'CancelGeneration', operationId: view.opId },
  };
}

// ── error cards (ui-design §4.8) ────────────────────────────────────────────

export interface ErrorActionContext {
  readonly catalog: ActionCatalog;
  readonly now: number;
  /** What «Повторить» / «Ещё раз» does; null — the error cannot be repeated from here. */
  readonly again: UiAction | null;
  readonly againHotkey: HotkeyLabel | null;
  /** The chat «Открыть чат» goes to; null — no such button. */
  readonly openChat: UiAction | null;
}

/**
 * The buttons of an error card by its registry entry: the recovery first,
 * the settings deep link, «Скопировать код» last. A deadline only disables
 * «Повторить» until it passes; nothing is repeated by itself.
 */
export function errorActions(wire: CgErrorWire, ctx: ErrorActionContext): ActionButtonVM[] {
  const out: ActionButtonVM[] = [];
  for (const action of recoveryActions(wire, ctx.now)) {
    if (action.label === null) continue;
    switch (action.kind) {
      case 'retry':
      case 'again': {
        if (ctx.again === null) break;
        const waiting = !action.enabled && action.availableAt !== null;
        const reason: ReasonVM | null = waiting ? ctx.catalog.reason('wait-until', { n: Math.max(0, Math.ceil(((action.availableAt ?? ctx.now) - ctx.now) / 1000)) }) : null;
        out.push(button(action.label, ctx.again, { enabled: action.enabled, reason, hotkey: action.enabled ? ctx.againHotkey : null }));
        break;
      }
      case 'sign-in':
        out.push(button(action.label, { type: 'OpenSettings', route: { section: 'account', code: wire.code } }));
        break;
      case 'open-settings':
        if (action.settings !== null) out.push(button(action.label, { type: 'OpenSettings', route: action.settings }));
        break;
      case 'reload-tab':
        out.push(button(action.label, { type: 'ReloadTab' }));
        break;
      case 'open-chat':
        if (ctx.openChat !== null) out.push(button(action.label, ctx.openChat));
        break;
      case 'copy-code':
        out.push(button(action.label, { type: 'CopyReport', scope: 'error', code: wire.code }));
        break;
      case 'update-extension':
        break;
    }
  }
  return out;
}

/** The moment a waiting «Повторить» becomes available, if the error has one (the view is rebuilt then). */
export function retryDeadline(wire: CgErrorWire | undefined, now: number): number | null {
  if (wire === undefined || wire.retryAt === undefined || wire.retryAt <= now) return null;
  return wire.retryAt;
}

// ── the debug footer (ui-design §4.12; DB-011, DB-012, DB-016, DB-017, DB-020) ──

/**
 * The scheduler's marks in the profiler's words: the admission is the click,
 * the `requesting` state is the request leaving, and the parse ends when the
 * operation settles. Marks already in the profiler's words pass as they are.
 */
const MARK_NAMES: Readonly<Record<string, string>> = {
  admitted: 'click',
  requesting: 'request',
  meta: 'meta',
  'first-chunk': 'firstChunk',
  done: 'done',
  settled: 'parse',
};

function profilerMarks(stages: OpDebugView['stages']): StageMark[] {
  const seen = new Set<string>();
  const marks: StageMark[] = [];
  for (const stage of stages) {
    const name = MARK_NAMES[stage.name] ?? stage.name;
    if (seen.has(name)) continue;
    seen.add(name);
    marks.push({ name, at: stage.at });
  }
  return marks;
}

export interface DebugContext {
  /** `debug.enabled`; false — no debug block at all. */
  readonly enabled: boolean;
  readonly expanded: boolean;
  readonly now: number;
  readonly i18n: I18n;
}

/**
 * The debug footer of a result: the cost line, the stage profile, the hub's
 * stages, the prompt snapshot's opaque token, reasoning and the context
 * card. Only in debug mode; while the generation runs only the live timer
 * (every 100 ms, and only in the expanded view) is known.
 */
export function debugVm(view: OpView, ctx: DebugContext): ResultDebugVM | null {
  if (!ctx.enabled) return null;
  const running = !isTerminalOpState(view.state);
  const debug = view.debug;
  if (debug === undefined) {
    if (!running) return null;
    return { costLine: null, stages: [], totalMs: Math.max(0, ctx.now - view.startedAt), hubStages: [], prompt: null, reasoning: null, context: null, liveTimer: ctx.expanded };
  }
  const t = translatorOf(ctx.i18n);
  const profile = profileOf(profilerMarks(debug.stages), running ? 'running' : view.state === 'done' ? 'done' : 'failed', ctx.now);
  const token = debug.promptToken;
  return {
    costLine: formatCostLine({ usage: debug.usage, totalMs: profile.totalMs, model: debug.model ?? null }, t),
    stages: profile.segments.flatMap((segment) => (segment.ms === null ? [] : [{ name: t.text(SEGMENT_LABEL_KEYS[segment.name]), ms: segment.ms }])),
    totalMs: profile.totalMs,
    hubStages: (debug.hubStages ?? []).map((stage) => ({ name: stage.name, ms: stage.ms })),
    // The token is opaque: it opens debug-prompt.html, the prompt itself never reaches a tab (DB-006).
    prompt: token !== null && HANDLE_PATTERN.test(token) ? { type: 'Navigate', to: { kind: 'debug-prompt', promptHandle: token } } : null,
    reasoning: debug.reasoning,
    context: debug.context,
    liveTimer: running && ctx.expanded,
  };
}
