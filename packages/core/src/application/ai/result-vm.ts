// A draft result as the UI draws it (architecture.md §10.2 ResultVM, PartVM;
// ui-design §4.2–§4.9, §8.2–§8.3): the stage line while it runs, parts and
// Hi variants once it is done and parsed, the error card with its recovery
// buttons, the «фан написал новое» mark, the Б2 question, Fix's blocks, the
// debug footer. The stream text is a preview without actions; parts exist
// only on a finished result (§7).

import { type FeatureId, type Tone } from '@cg/contracts/features';
import { RECAP_OFF_CAPABILITY, chatKeyOf, type PartRef } from '@cg/contracts/ids';
import { type OpResult } from '@cg/contracts/ops';
import { type ConfirmVM, type FixVM, type Msg, type PartVM, type ReasonVM, type ResultVM, type UiAction, type VariantVM } from '@cg/contracts/vm';

import { usageHead } from '../../domain/debug';
import { TONE_LABEL_KEYS, isDraftFeature, policyOf } from '../../domain/features';
import { isTerminalOpState } from '../../domain/ops';
import { isUnparsedResult, streamPreview } from '../../domain/output';
import { type OpRecord } from './op-store';
import { debugVm, errorActions, errorVm, featureHotkey, msg, phaseVm } from './view-models';
import { type AiWorkspace } from './workspace';

/** One part: its text, its insert and copy state, why it cannot be inserted, and why not copied either. */
export function partVm(ws: AiWorkspace, record: OpRecord, part: PartRef, text: string, options: { readonly numbered: boolean; readonly next: boolean }): PartVM {
  const { catalog, i18n } = ws.ports;
  const opId = record.view.opId;
  const state = ws.inserts.partState(opId, part);
  const handle = ws.partHandle(opId, part);
  const copy = ws.copyState(handle);
  const block = ws.inserts.blockOf(record, part);
  const insertBlocked: ReasonVM | null = block === null ? null : (block.view ?? catalog.reason(block.reason));
  const copyBlock = ws.inserts.copyBlockOf(record, part);
  // A board's result shown in its chat's dock (§6.5): a part that is delivered reads «Отправлено», as in its preview.
  const sentAt = ws.boardPart(opId, part)?.sentAt ?? null;
  return {
    index: part.index,
    variant: part.variant ?? null,
    label: msg(sentAt === null ? 'part.aria' : 'part.ariaSent', { n: part.index + 1 }),
    numbered: options.numbered,
    text,
    next: options.next && state.insert !== 'done' && sentAt === null,
    insert: state.insert,
    insertError: state.insertError === null ? null : errorVm(state.insertError, i18n),
    insertBlocked,
    copyBlocked: copyBlock === null ? null : catalog.reason(copyBlock.reason),
    copy,
    copyError: copy === 'failed' ? errorVm({ code: 'CG-CLIPBOARD' }, i18n) : null,
    copyHandle: handle,
    // An inserted part folds into one line and frees the room for the next (ui-design §3.2); so does a sent one.
    collapsed: state.insert === 'done' || sentAt !== null,
    ...(sentAt === null ? {} : { send: { s: 'sent', at: sentAt } as const }),
  };
}

/** The parts of one message; the first not yet inserted is «следующая». */
export function partVms(ws: AiWorkspace, record: OpRecord, texts: readonly string[], variant: number | null, mayBeNext: boolean): PartVM[] {
  const opId = record.view.opId;
  const refs = texts.map((_, index): PartRef => (variant === null ? { index } : { variant, index }));
  const nextIndex = mayBeNext ? refs.findIndex((ref) => ws.inserts.partState(opId, ref).insert !== 'done' && (ws.boardPart(opId, ref)?.sentAt ?? null) === null) : -1;
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

/** «отправлено N из M» of a board's result the dock shows (§6.5): the variant in work, or the only message; null — nothing of it is delivered. */
function sentProgress(ws: AiWorkspace, opId: string, result: OpResult | undefined): { readonly sent: number; readonly total: number } | null {
  if (result === undefined || !ws.isBoardResult(opId)) return null;
  const variants = result.kind === 'parts' ? [result.parts] : result.kind === 'variants' ? result.variants : [];
  for (const [variant, texts] of variants.entries()) {
    const sent = texts.filter((_, index) => (ws.boardPart(opId, result.kind === 'parts' ? { index } : { variant, index })?.sentAt ?? null) !== null).length;
    if (sent > 0) return { sent, total: texts.length };
  }
  return null;
}

function metaOf(ws: AiWorkspace, record: OpRecord, result: OpResult | undefined, unparsed: boolean, toneUsed: Tone | null): Msg[] {
  const { i18n } = ws.ports;
  const { view } = record;
  const meta: Msg[] = [];
  if (view.state === 'failed' || view.state === 'interrupted') return [msg('result.meta.failed')];
  // The head says no norm (ui-design §1 п. 7, X57): a Fix is always by the draft, one message is what Split off means.
  if (toneUsed !== null) meta.push(msg('result.meta.tone', { tone: i18n.t(TONE_LABEL_KEYS[toneUsed]) }));
  if (result === undefined) return meta;
  if (unparsed) return [...meta, msg('result.meta.unparsed')];
  if (result.kind === 'parts') {
    const total = result.parts.length;
    if (total > 1) {
      meta.push(msg('result.meta.parts', { n: total }));
      const done = insertedCount(ws, view.opId, result.parts, null);
      if (done > 0) meta.push(msg('result.meta.inserted', { done, total }));
    } else if (result.splitRequested) meta.push(msg('result.meta.onePart'));
  }
  if (result.kind === 'variants') {
    meta.push(msg('result.meta.variants', { n: result.variants.length }));
    const longest = Math.max(...result.variants.map((parts) => parts.length));
    if (longest > 1) meta.push(msg('result.meta.partsEach', { n: longest }));
  }
  // What the answer stood on, as the hub says it (a Reply's or a Ping's dossier — the latest saved full Recap):
  // «с Recap · 3 д назад». Nothing when the fan has none or the hub did not say: most chats have no Recap. «с Recap»
  // unticked says so: «Recap выключен».
  const recap = view.recapsUsed?.full ?? null;
  if (recap !== null) meta.push(msg('result.meta.recap', { age: { age: recap } }));
  else if (view.recapsUsed?.off === true) meta.push(msg('result.meta.recapOff'));
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
  // A board's result in the dock (§6.5) is the rest of an answer to insert: its parts, never Fix's «Заменить мой
  // черновик» (its source was the preview's own field) and never «Ещё раз» — a new answer is the strip's buttons.
  const board = ws.isBoardResult(view.opId);
  const fix = board ? null : fixVm(ws, record);
  const sent = sentProgress(ws, view.opId, result);
  // «с Recap» in the head (1.48.0): the dock's own answer in the open chat, to a hub that can leave the Recap out, that
  // stood on a Recap or went without one because the tick is off. Its words then leave the meta.
  const used = view.recapsUsed;
  const recap =
    !board && sameChat && used !== undefined && (used.full !== null || used.off === true) && situation.ready?.bootstrap.capabilities.includes(RECAP_OFF_CAPABILITY) === true
      ? { on: used.off !== true, at: used.full }
      : null;
  const meta = metaOf(ws, record, result, unparsed, view.toneUsed).filter((item) => recap === null || (item.key !== 'result.meta.recap' && item.key !== 'result.meta.recapOff'));
  const wire = view.state === 'failed' ? view.error : view.state === 'interrupted' ? (view.error ?? { code: 'CG-OP-INTERRUPTED' as const }) : undefined;

  // «Повторить» waits for its deadline (the hub's quota refusal carries it). On a page nothing of ours runs on
  // (the owner's master switch, an outdated build) «Ещё раз» is off like every other AI action, with that reason:
  // the hub would refuse it after the click.
  const waiting = wire?.retryAt !== undefined && wire.retryAt > now;
  const pageOff = sameChat ? (situation.pageOff?.reason ?? null) : null;
  const regenerateReason: ReasonVM | null = running
    ? null
    : pageOff !== null
      ? pageOff
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
    // Once a part is delivered the head counts the delivered ones — «вставлено N из M» would say the lesser thing next to it.
    meta: sent === null ? meta : [...meta.filter((item) => item.key !== 'result.meta.inserted'), msg('result.meta.sentProgress', sent)],
    splitRequested: result?.kind === 'parts' ? result.splitRequested : record.memo.split,
    targetName: sameChat ? situation.fanName : (ws.ports.host.fan(view.target.chat)?.displayName ?? null),
    // A draft is never mistaken for a sent message; after Fix replaced the draft it is in the field already.
    draftNotSent: result !== undefined && isDraftFeature(feature) && fix?.replaced !== true && sent === null,
    sendProgress: sent,
    error: wire === undefined ? null : errorVm(wire, i18n),
    errorActions:
      wire === undefined
        ? []
        : errorActions(wire, { catalog, now, again: options.regenerate, againHotkey: featureHotkey(catalog, feature), openChat: null, againOff: pageOff }),
    // The mark is the site's verdict on this result, read against what the tab kept of the start's proof (R20 F10).
    stale: ws.ports.policy.verdict(view, record.memo.fingerprint),
    toneUsed: view.toneUsed,
    canRegenerate: !running && regenerateReason === null && fix?.replaced !== true && !board,
    regenerateReason,
    confirm: confirmVm(ws, view.opId),
    fix,
    unparsed,
    cachedAt: record.reopenedAt === null ? null : (view.endedAt ?? null),
    expanded,
    // The sheet is the opened result (ui-design §4.12): its footer is there in debug mode, window or not.
    debug: debugVm(view, { enabled: debugOn, opened: true, now, i18n }),
    // The old Fansly extension's cost line, the last quiet word of the head (2026-10-22).
    usage: view.state === 'done' ? usageHead(view.usage) : null,
    recap,
  };
}
