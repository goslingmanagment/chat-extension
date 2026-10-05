// A draft result as the UI draws it (architecture.md §10.2 ResultVM, PartVM;
// ui-design §4.2–§4.9, §8.2–§8.3): the stage line while it runs, parts and
// Hi variants once it is done and parsed, the error card with its recovery
// buttons, the «фан написал новое» mark, the Б2 question, Fix's blocks, the
// debug footer. The stream text is a preview without actions; parts exist
// only on a finished result (§7).

import { type FeatureId, type Tone } from '@cg/contracts/features';
import { chatKeyOf, type PartRef } from '@cg/contracts/ids';
import { type OpResult } from '@cg/contracts/ops';
import { type ConfirmVM, type FixVM, type Msg, type PartVM, type ReasonVM, type ResultVM, type UiAction, type VariantVM } from '@cg/contracts/vm';

import { TONE_LABEL_KEYS, isDraftFeature, policyOf } from '../../domain/features';
import { isTerminalOpState } from '../../domain/ops';
import { isUnparsedResult, streamPreview } from '../../domain/output';
import { type OpRecord } from './op-store';
import { debugVm, errorActions, errorVm, featureHotkey, msg, phaseVm } from './view-models';
import { type AiWorkspace } from './workspace';

/** One part: its text, its insert and copy state, and why it can only be copied. */
export function partVm(ws: AiWorkspace, record: OpRecord, part: PartRef, text: string, options: { readonly numbered: boolean; readonly next: boolean }): PartVM {
  const { catalog, i18n } = ws.ports;
  const opId = record.view.opId;
  const state = ws.inserts.partState(opId, part);
  const handle = ws.partHandle(opId, part);
  const copy = ws.copyState(handle);
  const block = ws.inserts.blockOf(record, part);
  const insertBlocked: ReasonVM | null = block === null ? null : (block.view ?? catalog.reason(block.reason));
  return {
    index: part.index,
    variant: part.variant ?? null,
    label: msg('part.aria', { n: part.index + 1 }),
    numbered: options.numbered,
    text,
    next: options.next && state.insert !== 'done',
    insert: state.insert,
    insertError: state.insertError === null ? null : errorVm(state.insertError, i18n),
    insertBlocked,
    copy,
    copyError: copy === 'failed' ? errorVm({ code: 'CG-CLIPBOARD' }, i18n) : null,
    copyHandle: handle,
    // An inserted part folds into one line and frees the room for the next (ui-design §3.2).
    collapsed: state.insert === 'done',
  };
}

/** The parts of one message; the first not yet inserted is «следующая». */
export function partVms(ws: AiWorkspace, record: OpRecord, texts: readonly string[], variant: number | null, mayBeNext: boolean): PartVM[] {
  const opId = record.view.opId;
  const refs = texts.map((_, index): PartRef => (variant === null ? { index } : { variant, index }));
  const nextIndex = mayBeNext ? refs.findIndex((ref) => ws.inserts.partState(opId, ref).insert !== 'done') : -1;
  return texts.map((text, index) => partVm(ws, record, refs[index] as PartRef, text, { numbered: texts.length > 1, next: index === nextIndex }));
}

function variantVms(ws: AiWorkspace, record: OpRecord, variants: readonly (readonly string[])[]): VariantVM[] {
  // Until the person picks a variant the first one leads; then the picked one does.
  const chosen = ws.inserts.chosenVariant(record.view.opId) ?? 0;
  return variants.map((texts, index) => ({
    index,
    label: msg('part.variant', { n: index + 1 }),
    parts: partVms(ws, record, texts, index, index === chosen),
  }));
}

const insertedCount = (ws: AiWorkspace, opId: string, texts: readonly string[], variant: number | null): number =>
  texts.filter((_, index) => ws.inserts.partState(opId, variant === null ? { index } : { variant, index }).insert === 'done').length;

function metaOf(ws: AiWorkspace, record: OpRecord, result: OpResult | undefined, unparsed: boolean, toneUsed: Tone | null): Msg[] {
  const { i18n } = ws.ports;
  const { view } = record;
  const meta: Msg[] = [];
  if (view.state === 'failed' || view.state === 'interrupted') return [msg('result.meta.failed')];
  if (view.feature === 'fix') meta.push(msg('result.meta.byYourDraft'));
  if (toneUsed !== null) meta.push(msg('result.meta.tone', { tone: i18n.t(TONE_LABEL_KEYS[toneUsed]) }));
  if (result === undefined) return meta;
  if (unparsed) return [...meta, msg('result.meta.unparsed')];
  if (result.kind === 'parts') {
    const total = result.parts.length;
    if (total > 1) {
      meta.push(msg('result.meta.parts', { n: total }));
      const done = insertedCount(ws, view.opId, result.parts, null);
      if (done > 0) meta.push(msg('result.meta.inserted', { done, total }));
    } else meta.push(msg(result.splitRequested ? 'result.meta.onePart' : 'result.meta.single'));
  }
  if (result.kind === 'variants') {
    meta.push(msg('result.meta.variants', { n: result.variants.length }));
    const longest = Math.max(...result.variants.map((parts) => parts.length));
    if (longest > 1) meta.push(msg('result.meta.partsEach', { n: longest }));
  }
  return meta;
}

function fixVm(ws: AiWorkspace, record: OpRecord): FixVM | null {
  if (record.view.feature !== 'fix' || record.view.state !== 'done') return null;
  const { catalog } = ws.ports;
  const fix = ws.inserts.fix(record);
  const blocked = ws.inserts.blockOf(record, { index: 0 }) !== null;
  const observed = ws.situation().host.contract.capabilities.draftRead.state === 'on';
  // Without a verified editor or the source revision there is no CAS: copy is the way (§6.4).
  const canReplace = !blocked && observed && fix.sourceDraft !== null && !fix.replaced;
  return {
    sourceDraft: fix.sourceDraft ?? '',
    canReplace,
    replaceReason: canReplace || fix.replaced ? null : catalog.reason('draft-unverifiable'),
    replaced: fix.replaced,
    restoreUntil: fix.restoreUntil,
    restoreExpired: fix.restoreExpired,
  };
}

/** Б2 of an operation: the question about one of its parts the person must answer first; null — nothing is asked. */
export function confirmVm(ws: AiWorkspace, opId: string): ConfirmVM | null {
  const pending = ws.inserts.confirmation(opId);
  return pending === null ? null : { confirmationId: pending.confirmationId, kind: pending.kind, part: pending.part, formatLoss: pending.formatLoss };
}

export interface ResultVmOptions {
  /** «Ещё раз»: what it dispatches (the feature's own controller handles it). */
  readonly regenerate: UiAction;
}

export function resultVm(ws: AiWorkspace, record: OpRecord, options: ResultVmOptions): ResultVM {
  const { catalog, clock, i18n } = ws.ports;
  const now = clock.now();
  const { view } = record;
  const feature: FeatureId = view.feature;
  const running = !isTerminalOpState(view.state);
  const result = view.state === 'done' ? view.result : undefined;
  const unparsed = result !== undefined && isUnparsedResult(result);
  const situation = ws.situation();
  const sameChat = situation.chat !== null && situation.chat.key === chatKeyOf(view.target.chat);
  const expanded = ws.isExpanded(view.opId);
  const debugOn = situation.ready?.settings.debug.enabled ?? ws.env.settings?.settings.debug.enabled ?? false;
  const fix = fixVm(ws, record);
  const wire = view.state === 'failed' ? view.error : view.state === 'interrupted' ? (view.error ?? { code: 'CG-OP-INTERRUPTED' as const }) : undefined;

  // «Повторить» waits for its deadline; a quota of zero waits for the day to turn.
  const waiting = wire?.retryAt !== undefined && wire.retryAt > now;
  const regenerateReason: ReasonVM | null = running
    ? null
    : situation.quotaZero && sameChat
      ? catalog.reason('quota-zero', situation.quota === null ? undefined : { time: { time: situation.quota.resetsAt } })
      : waiting
        ? catalog.reason('wait-until', { n: Math.ceil(((wire?.retryAt ?? now) - now) / 1000) })
        : null;
  const preview = running && policyOf(feature).streamShown && view.text !== undefined ? streamPreview(feature, view.text) : '';

  return {
    opId: view.opId,
    feature,
    surface: view.surface,
    state: view.state,
    startedAt: view.startedAt,
    phase: phaseVm(view, now),
    streamText: preview.length > 0 ? preview : null,
    parts: result?.kind === 'parts' ? partVms(ws, record, result.parts, null, true) : null,
    variants: result?.kind === 'variants' ? variantVms(ws, record, result.variants) : null,
    meta: metaOf(ws, record, result, unparsed, view.toneUsed),
    splitRequested: result?.kind === 'parts' ? result.splitRequested : record.memo.split,
    targetName: sameChat ? situation.fanName : (ws.ports.host.fan(view.target.chat)?.displayName ?? null),
    // A draft is never mistaken for a sent message; after Fix replaced the draft it is in the field already.
    draftNotSent: result !== undefined && isDraftFeature(feature) && fix?.replaced !== true,
    sendProgress: null,
    error: wire === undefined ? null : errorVm(wire, i18n),
    errorActions:
      wire === undefined
        ? []
        : errorActions(wire, { catalog, now, again: options.regenerate, againHotkey: featureHotkey(catalog, feature), openChat: null }),
    stale: view.stale ?? null,
    toneUsed: view.toneUsed,
    canRegenerate: !running && regenerateReason === null && fix?.replaced !== true,
    regenerateReason,
    confirm: confirmVm(ws, view.opId),
    fix,
    unparsed,
    cachedAt: record.reopenedAt === null ? null : (view.endedAt ?? null),
    expanded,
    // The sheet is the opened result (ui-design §4.12): its footer is there in debug mode, window or not.
    debug: debugVm(view, { enabled: debugOn, opened: true, now, i18n }),
  };
}
