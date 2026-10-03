// Results, parts and phases for the scenarios (ResultVM, PartVM, PhaseVM,
// PreviewSendView) — the dock sheet, a preview and the «Новые» card.

import {
  type ActionButtonVM,
  type CgErrorView,
  type FeatureId,
  type Msg,
  type OpState,
  type PartVM,
  type PhaseVM,
  type PreviewSendView,
  type ResultVM,
  type StageId,
  type Surface,
  type VariantVM,
} from '@cg/contracts';

import { FANS, handles, msg, type ScenarioCtx } from './base';

const STAGE_KEYS: Record<StageId, string> = {
  context: 'result.stage.context',
  thinking: 'result.stage.thinking',
  writing: 'result.stage.writing',
  'retry-wait': 'result.stage.retry503',
  parsing: 'result.stage.parsing',
  saving: 'result.stage.saving',
};

/** Stage line: the given stages done, `current` running; `retryAt` for the one 503 retry. */
export function phase(opId: string, startedAt: number, done: readonly StageId[], current: StageId, retryAt: number | null = null): PhaseVM {
  return {
    startedAt,
    stages: [
      ...done.map((id) => ({ id, label: msg(STAGE_KEYS[id]), state: 'done' as const })),
      { id: current, label: msg(STAGE_KEYS[current], current === 'retry-wait' ? { n: 5 } : undefined), state: 'current' as const },
    ],
    retryAt,
    cancel: { type: 'CancelGeneration', operationId: opId },
  };
}

export interface PartOptions extends Partial<Omit<PartVM, 'index' | 'text' | 'label' | 'copyHandle'>> {
  readonly opId: string;
}

export function part(index: number, text: string, options: PartOptions): PartVM {
  const { opId, ...patch } = options;
  const variant = patch.variant ?? null;
  return {
    index,
    variant,
    label: msg('part.aria', { n: index + 1 }),
    numbered: true,
    text,
    next: false,
    insert: 'idle',
    insertError: null,
    insertBlocked: null,
    copy: 'idle',
    copyError: null,
    copyHandle: handles.part(opId, variant, index),
    collapsed: false,
    ...patch,
  };
}

/** Parts of one message; the first not-inserted one is «next» unless told otherwise. */
export function parts(opId: string, texts: readonly string[], patch: (index: number) => Partial<PartVM> = () => ({})): PartVM[] {
  return texts.map((text, index) => part(index, text, { opId, next: index === 0, numbered: texts.length > 1, ...patch(index) }));
}

export function variants(opId: string, groups: readonly (readonly string[])[], patch: (variant: number, index: number) => Partial<PartVM> = () => ({})): VariantVM[] {
  return groups.map((texts, v) => ({
    index: v,
    label: msg('part.variant', { n: v + 1 }),
    parts: texts.map((text, index) => part(index, text, { opId, variant: v, next: v === 0 && index === 0, ...patch(v, index) })),
  }));
}

export interface ResultOptions extends Partial<ResultVM> {
  readonly opId: string;
  readonly feature: FeatureId;
  readonly state: OpState;
}

export function result(ctx: ScenarioCtx, options: ResultOptions): ResultVM {
  const { opId, feature, state, ...patch } = options;
  const surface: Surface = patch.surface ?? 'dock';
  return {
    opId,
    feature,
    surface,
    state,
    startedAt: ctx.now - 4_000,
    phase: null,
    streamText: null,
    parts: null,
    variants: null,
    meta: [],
    splitRequested: false,
    targetName: surface === 'newcomers' ? FANS.tomasz.name : FANS.hubert.name,
    draftNotSent: state === 'done',
    sendProgress: null,
    error: null,
    errorActions: [],
    stale: null,
    toneUsed: null,
    canRegenerate: state !== 'admitted' && state !== 'requesting' && state !== 'streaming',
    regenerateReason: null,
    confirm: null,
    fix: null,
    unparsed: false,
    cachedAt: null,
    expanded: false,
    debug: null,
    ...patch,
  };
}

/** A failed result: «не выполнен», the error card and its recovery buttons. */
export function failedResult(ctx: ScenarioCtx, opId: string, feature: FeatureId, error: CgErrorView, actions: readonly ActionButtonVM[], surface: Surface = 'dock'): ResultVM {
  return result(ctx, { opId, feature, state: 'failed', surface, error, errorActions: actions, meta: [msg('result.meta.failed')], draftNotSent: false });
}

export const meta = {
  parts: (n: number): Msg => msg('result.meta.parts', { n }),
  tone: (tone: string): Msg => msg('result.meta.tone', { tone }),
  inserted: (done: number, total: number): Msg => msg('result.meta.inserted', { done, total }),
  single: (): Msg => msg('result.meta.single'),
  onePart: (): Msg => msg('result.meta.onePart'),
  forFan: (name: string): Msg => msg('result.meta.forFan', { name }),
  variants: (n: number, m: number): Msg => msg('result.meta.variants', { n, m }),
  byDraft: (): Msg => msg('result.meta.byYourDraft'),
  unparsed: (): Msg => msg('result.meta.unparsed'),
  sent: (sent: number, total: number): Msg => msg('result.meta.sentProgress', { sent, total }),
};

/** Send rows of a preview result, one PreviewSendView per part. */
export function sendParts(opId: string, texts: readonly string[], states: readonly PreviewSendView[]): PartVM[] {
  const firstOpen = states.findIndex((s) => s.s === 'available' || s.s === 'unavailable' || s.s === 'held-stale' || s.s === 'rejected');
  const uncertain = states.findIndex((s) => s.s === 'uncertain');
  const inWork = states.findIndex((s) => s.s === 'queued' || s.s === 'sending' || s.s === 'accepted');
  return texts.map((text, index) => {
    const send = states[index] ?? { s: 'available' };
    const blockedBy = uncertain >= 0 && index > uncertain ? { kind: 'held' as const, part: uncertain + 1 } : null;
    const behind = blockedBy ?? (inWork >= 0 && index > inWork ? { kind: 'after' as const, part: inWork + 1 } : firstOpen >= 0 && index > firstOpen && send.s === 'available' ? { kind: 'after' as const, part: firstOpen + 1 } : null);
    return part(index, text, {
      opId,
      numbered: texts.length > 1,
      next: index === firstOpen && behind === null,
      send,
      sendOrder: behind,
      collapsed: send.s === 'sent',
      openInsert:
        send.s === 'uncertain' || send.s === 'sent' || send.s === 'queued' || send.s === 'sending' || send.s === 'accepted'
          ? { s: 'hidden' }
          : { s: 'available' },
    });
  });
}
