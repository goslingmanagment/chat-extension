// A generation's result as a preview draws it (architecture.md §7 «Превью и
// «Новые»», §10.2 ResultVM / PartVM; ui-design §4.2–§4.4, §4.13): the stage
// line while it runs, the parsed parts after `done` — never before — each
// with its «Отправить» row, its order behind the other parts and «Открыть и
// вставить». The stream text is a preview without buttons. A result is a
// draft «не отправлено» until a part starts to go.

import { type CgErrorWire } from '@cg/contracts/errors';
import { type FeatureId, type Surface, type Tone } from '@cg/contracts/features';
import { type OpResult, type OpView, type Phase } from '@cg/contracts/ops';
import {
  type ActionButtonVM,
  type FixVM,
  type I18n,
  type Msg,
  type OpenInsertVM,
  type PartVM,
  type PhaseVM,
  type PreviewSendView,
  type ReasonVM,
  type ResultVM,
  type SendOrderVM,
  type StageId,
  type VariantVM,
} from '@cg/contracts/vm';
import { type I18nKey } from '@cg/contracts/errors';

import { recoveryActions } from '../../domain/errors/recovery';
import { showsStream, type OpMirror } from '../../domain/ops/mirror';
import { isTerminalOpState } from '../../domain/ops/states';
import { partHandle } from '../boards/handles';
import { button, errorOf, msg, reason } from '../boards/views';

const STAGE_KEYS: Readonly<Record<StageId, I18nKey>> = {
  context: 'result.stage.context',
  thinking: 'result.stage.thinking',
  writing: 'result.stage.writing',
  'retry-wait': 'result.stage.retry503',
  parsing: 'result.stage.parsing',
  saving: 'result.stage.saving',
};

const TONE_KEYS: Readonly<Record<Tone, I18nKey>> = {
  casual: 'dock.tone.casual',
  flirty: 'dock.tone.flirty',
  upsell: 'dock.tone.upsell',
  spicy: 'dock.tone.spicy',
};

/** The stages a phase has passed and the one it is in (ui-design §4.4: done ones with a tick, no future ones). */
function stagesOf(phase: Phase['name']): { readonly done: readonly StageId[]; readonly current: StageId } | null {
  switch (phase) {
    case 'admitted':
    case 'connecting':
    case 'awaiting-meta':
      return { done: [], current: 'context' };
    case 'retry-wait':
      return { done: [], current: 'retry-wait' };
    case 'awaiting-first-chunk':
      return { done: ['context'], current: 'thinking' };
    case 'streaming':
      return { done: ['context', 'thinking'], current: 'writing' };
    case 'parsing':
      return { done: ['context', 'thinking', 'writing'], current: 'parsing' };
    case 'saving-profile':
      return { done: ['context', 'thinking', 'writing', 'parsing'], current: 'saving' };
    case 'settled':
      return null;
  }
}

function phaseVM(mirror: OpMirror, startedAt: number, now: number): PhaseVM | null {
  if (isTerminalOpState(mirror.state)) return null;
  const stages = stagesOf(mirror.phase.name);
  if (stages === null) return null;
  const retryAt = mirror.phase.name === 'retry-wait' ? (mirror.phase.retryAt ?? null) : null;
  const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
  return {
    startedAt,
    stages: [
      ...stages.done.map((id) => ({ id, label: msg(STAGE_KEYS[id]), state: 'done' as const })),
      { id: stages.current, label: stages.current === 'retry-wait' ? msg(STAGE_KEYS[stages.current], { n: seconds }) : msg(STAGE_KEYS[stages.current]), state: 'current' as const },
    ],
    retryAt,
    cancel: { type: 'CancelGeneration', operationId: mirror.opId },
  };
}

/** The parts of one variant of a finished result; null — the result is not a draft for the fan. */
export function partsOfResult(result: OpResult | undefined, variant: number): readonly string[] | null {
  if (result === undefined) return null;
  if (result.kind === 'parts') return variant === 0 ? result.parts : null;
  if (result.kind === 'variants') return result.variants[variant] ?? null;
  return null;
}

export interface PartRows {
  readonly send?: PreviewSendView;
  readonly order: SendOrderVM | null;
  readonly openInsert: OpenInsertVM;
}

export interface PreviewResultInput {
  readonly mirror: OpMirror;
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly startedAt: number;
  readonly now: number;
  readonly targetName: string | null;
  readonly toneUsed: Tone | null;
  readonly splitRequested: boolean;
  readonly expanded: boolean;
  readonly cachedAt: number | null;
  /** Fix: the local draft the result was made from. */
  readonly fixSource: string | null;
  /** The parts cannot be sent as they are (NF-017): shown copy-only as «ответ не разобран». */
  readonly unusable: boolean;
  readonly i18n: I18n;
  rows(variant: number | null, index: number): PartRows;
  copy(variant: number | null, index: number): PartVM['copy'];
  /** «отправлено N из M» of the group in work; null — nothing started. */
  readonly progress: { readonly sent: number; readonly total: number } | null;
  /** A part started to go: the draft is no longer «не отправлено». */
  readonly sendStarted: boolean;
  readonly regenerate: { readonly allowed: boolean; readonly reason: ReasonVM | null };
}

function partVM(input: PreviewResultInput, opId: string, variant: number | null, index: number, text: string, count: number, firstOpen: number): PartVM {
  const rows = input.rows(variant, index);
  const sent = rows.send?.s === 'sent';
  return {
    index,
    variant,
    label: msg(sent ? 'part.ariaSent' : 'part.aria', { n: index + 1 }),
    numbered: count > 1,
    text,
    next: index === firstOpen && rows.order === null,
    // A preview has no composer to insert into: «Открыть и вставить» is its own row.
    insert: 'idle',
    insertError: null,
    insertBlocked: null,
    copyBlocked: null,
    copy: input.copy(variant, index),
    copyError: input.copy(variant, index) === 'failed' ? errorOf({ code: 'CG-CLIPBOARD' }, input.i18n) : null,
    copyHandle: partHandle(opId, variant, index),
    collapsed: sent,
    ...(rows.send === undefined ? {} : { send: rows.send }),
    sendOrder: rows.order,
    openInsert: rows.openInsert,
  };
}

function partList(input: PreviewResultInput, opId: string, variant: number | null, texts: readonly string[]): PartVM[] {
  // The first part that is not on its way and not delivered is the next one to act on.
  const states = texts.map((_, index) => input.rows(variant, index).send?.s);
  const firstOpen = states.findIndex((s) => s === undefined || s === 'available' || s === 'unavailable' || s === 'held-stale' || s === 'rejected');
  return texts.map((text, index) => partVM(input, opId, variant, index, text, texts.length, firstOpen));
}

function errorActions(wire: CgErrorWire, opId: string, now: number, canRegenerate: boolean): ActionButtonVM[] {
  const out: ActionButtonVM[] = [];
  for (const action of recoveryActions(wire, now)) {
    if (action.label === null) continue;
    if (action.kind === 'retry' || action.kind === 'again') {
      out.push(button(action.label, { type: 'Regenerate', operationId: opId }, { enabled: action.enabled && canRegenerate, reason: action.availableAt === null ? null : reason('send-unavailable') }));
    } else if (action.kind === 'open-settings' && action.settings !== null) out.push(button(action.label, { type: 'OpenSettings', route: action.settings }));
    else if (action.kind === 'sign-in') out.push(button(action.label, { type: 'OpenSettings', route: { section: 'account' } }));
    else if (action.kind === 'reload-tab') out.push(button(action.label, { type: 'ReloadTab' }));
  }
  return out;
}

export function previewResult(input: PreviewResultInput): ResultVM {
  const { mirror, i18n } = input;
  const opId = mirror.opId;
  const view: OpView | null = mirror.done;
  const terminal = isTerminalOpState(mirror.state);
  const result = view?.state === 'done' ? view.result : undefined;

  let parts: PartVM[] | null = null;
  let variants: VariantVM[] | null = null;
  const meta: Msg[] = [];
  if (input.toneUsed !== null) meta.push(msg('result.meta.tone', { tone: i18n.t(TONE_KEYS[input.toneUsed]) }));
  if (input.feature === 'fix' && input.fixSource !== null) meta.push(msg('result.meta.byYourDraft'));

  if (result !== undefined && result.kind === 'parts') {
    parts = partList(input, opId, null, result.parts);
    if (result.parts.length > 1) meta.push(msg('result.meta.parts', { n: result.parts.length }));
    // One message is what Split off means: no word for the norm (X57); one part where Split was asked is news.
    else if (result.splitRequested) meta.push(msg('result.meta.onePart'));
  } else if (result !== undefined && result.kind === 'variants') {
    const first = result.variants[0] ?? [];
    if (result.variants.length === 1) {
      parts = partList(input, opId, 0, first);
      meta.push(msg('result.meta.variants', { n: 1 }));
      meta.push(msg('result.meta.parts', { n: first.length }));
    } else {
      variants = result.variants.map((texts, v) => ({ index: v, label: msg('part.variant', { n: v + 1 }), parts: partList(input, opId, v, texts) }));
      meta.push(msg('result.meta.variants', { n: result.variants.length }));
      if (first.length > 1) meta.push(msg('result.meta.partsEach', { n: first.length }));
    }
  }
  if (input.unusable) meta.push(msg('result.meta.unparsed'));
  if (input.progress !== null) meta.push(msg('result.meta.sentProgress', { sent: input.progress.sent, total: input.progress.total }));

  let errorWire: CgErrorWire | null = null;
  if (mirror.state === 'failed') errorWire = view?.error ?? { code: 'CG-UNKNOWN' };
  else if (mirror.state === 'interrupted') errorWire = view?.error ?? { code: 'CG-OP-INTERRUPTED' };
  else if (mirror.state === 'done' && result === undefined) errorWire = { code: 'CG-OUTPUT-UNUSABLE' };
  if (errorWire !== null) meta.push(msg('result.meta.failed'));

  const fix: FixVM | null =
    input.feature === 'fix' && input.fixSource !== null
      ? { sourceDraft: input.fixSource, canReplace: false, replaceReason: reason('draft-unverifiable'), replaced: false, restoreUntil: null, restoreExpired: false }
      : null;

  return {
    opId,
    feature: input.feature,
    surface: input.surface,
    state: mirror.state,
    startedAt: input.startedAt,
    phase: phaseVM(mirror, input.startedAt, input.now),
    streamText: !terminal && showsStream(input.feature) && mirror.text.length > 0 ? mirror.text : null,
    parts,
    variants,
    meta,
    splitRequested: input.splitRequested,
    targetName: input.targetName,
    draftNotSent: mirror.state === 'done' && result !== undefined && !input.sendStarted,
    sendProgress: input.progress,
    error: errorWire === null ? null : errorOf(errorWire, i18n),
    errorActions: errorWire === null ? [] : errorActions(errorWire, opId, input.now, input.regenerate.allowed),
    stale: view?.stale === undefined ? null : { reason: view.stale.reason, at: view.stale.at },
    toneUsed: input.toneUsed,
    canRegenerate: terminal && input.regenerate.allowed,
    regenerateReason: terminal ? input.regenerate.reason : reason('locked-during-generation'),
    confirm: null,
    fix,
    unparsed: input.unusable,
    cachedAt: input.cachedAt,
    expanded: input.expanded,
    // The debug footer of a result belongs to the dock's expanded sheet (DB-020); a preview shows none.
    debug: null,
  };
}
