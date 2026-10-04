// Pure rules of the dock (ui-design §3.3, §4.1, §4.2, §4.8, §4.10): no DOM,
// no Preact. What the strip and the sheet decide from a DockVM: whether the
// strip is crowded, which dot an error carries, how header meta reads, what a
// strip button dispatches, and when two view models differ only by streamed
// text.

import { type CgErrorTone, type CgErrorView, type I18nKey } from '@cg/contracts/errors';
import { type FeatureId } from '@cg/contracts/features';
import { type DockActionId, type DockVM, type I18n, type Msg, type ResultVM, type UiAction } from '@cg/contracts/vm';

/** Structural equality of plain view-model data; `skip` names a key ignored at every depth. */
export function deepEqual(a: unknown, b: unknown, skip?: string): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Readonly<Record<string, unknown>>;
  const right = b as Readonly<Record<string, unknown>>;
  const keys = Object.keys(left).filter((key) => key !== skip);
  if (keys.length !== Object.keys(right).filter((key) => key !== skip).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !deepEqual(left[key], right[key], skip)) return false;
  }
  return true;
}

/** The key whose changes repaint one text node and nothing else (architecture.md §10.1 «Поток текста»). */
export const STREAM_KEY = 'streamText';

/**
 * «Полоса занята» (ui-design §3.3): a tone is chosen, a generation runs, the
 * quota or the status words show. Below 900 px the persona gives its place away.
 */
export function isCrowded(vm: DockVM): boolean {
  return vm.options.tone !== null || vm.options.locked || quotaSlot(vm) !== null || vm.statusWords;
}

/**
 * The zone the zero-quota tooltip names: «Обновится в 03:00 по Москве»
 * (ui-design §4.1). The quota resets at 00:00 UTC; said «по Москве», the time
 * is printed in this zone, not in the chatter's own.
 */
export const QUOTA_RESET_TIME_ZONE = 'Europe/Moscow';

/** The quota slot (UI-031): shown only when little is left or nothing is. */
export function quotaSlot(vm: DockVM): 'zero' | 'low' | null {
  const quota = vm.quota;
  if (quota === null) return null;
  if (quota.remaining === 0) return 'zero';
  return quota.low && quota.remaining !== null ? 'low' : null;
}

/**
 * The reading of ui-design §4.8 for an error view that does not say its dot
 * itself (`toneOf`): codes that are a state, not a failure of our work, carry
 * a ring instead of the red dot — quota 0, the limit of three generations, a
 * busy chat, a lease, «расширение обновилось», no sign-in, no binding, no
 * persona, ChatSpace updated, a gate (a blocked fan, no draft…). Everything
 * else is red.
 */
const STATE_CODES: ReadonlySet<string> = new Set([
  'CG-QUOTA-DAILY',
  'CG-OP-TAB-LIMIT',
  'CG-OP-CHAT-BUSY',
  'CG-OP-COACH-BUSY',
  'CG-RUNTIME-RELOADED',
  'CG-AUTH-REQUIRED',
  'CG-FEATURE-DISABLED',
  'CG-HOST-CONTRACT',
  'CG-HOST-COMPOSER-MISSING',
  'CG-RECAP-NOT-FOUND',
]);
const STATE_PREFIXES = ['CG-GATE-', 'CG-BINDING-', 'CG-PERSONA-', 'CG-CLAIM-'] as const;

export function errorToneOf(code: string): CgErrorTone {
  return STATE_CODES.has(code) || STATE_PREFIXES.some((prefix) => code.startsWith(prefix)) ? 'state' : 'failure';
}

/**
 * The dot of an error card: red — our operation failed, a ring — a state
 * (ui-design §4.8). The view carries it when its producer decided it
 * (`CgErrorView.tone`, contracts 1.2.0) and that is final; only a view
 * without it is read by the code list above.
 */
export function toneOf(error: Pick<CgErrorView, 'code' | 'tone'>): CgErrorTone {
  return error.tone ?? errorToneOf(error.code);
}

/** The name of a function as the strip and a result head print it (Latin, never translated). */
export function featureKey(feature: FeatureId): I18nKey {
  return feature === 'recap-short' ? 'dock.action.recap' : `dock.action.${feature}`;
}

/** The strip button of a feature; both Recap lengths belong to Recap. */
export function actionOf(feature: FeatureId): DockActionId {
  return feature === 'recap-short' ? 'recap' : feature;
}

export const isRunning = (state: ResultVM['state']): boolean => state === 'admitted' || state === 'requesting' || state === 'streaming';

/**
 * Header meta as printed (ui-design §4.2): the controller's lines, with the
 * tone by its catalog name («тон: Flirt», never the id), «для Tomasz» in front
 * for Hi, and «3 варианта» + «по 2 части» as one phrase.
 */
export function metaTexts(i18n: I18n, result: Pick<ResultVM, 'meta' | 'toneUsed' | 'feature' | 'targetName'>): string[] {
  const texts: string[] = [];
  const has = (key: I18nKey): boolean => result.meta.some((line) => line.key === key);
  if (result.feature === 'hi' && result.targetName !== null && !has('result.meta.forFan')) texts.push(i18n.t('result.meta.forFan', { name: result.targetName }));
  result.meta.forEach((line, index) => {
    const text =
      line.key === 'result.meta.tone' && result.toneUsed !== null ? i18n.t('result.meta.tone', { tone: i18n.t(`dock.tone.${result.toneUsed}`) }) : i18n.text(line);
    // «3 варианта» and «по 2 части» read as one phrase.
    if (line.key === 'result.meta.partsEach' && result.meta[index - 1]?.key === 'result.meta.variants') texts[texts.length - 1] = `${texts[texts.length - 1] ?? ''} ${text}`;
    else texts.push(text);
  });
  return texts;
}

/** A banner's or a card's error with another explanation (the banner texts of ui-design §4.10). */
export function withBody(error: CgErrorView, body: string): CgErrorView {
  return { ...error, body };
}

/** What a strip button asks for (docs/protocols/ui-contract.md п. 12). */
export function stripAction(id: DockActionId, vm: DockVM): UiAction | null {
  if (id === 'coach') return { type: 'Navigate', to: { kind: 'surface', surface: 'coach', open: !vm.actions.coach.active } };
  // Recap never generates from the strip: the sheet shows what is saved or the picker.
  if (id === 'recap') return { type: 'ShowAnalysis', view: 'recap', mode: 'sheet' };
  if (vm.targetHandle === null) return null;
  return { type: 'Generate', targetHandle: vm.targetHandle, feature: id, options: {} };
}

export const msgOf = (key: I18nKey, params?: Msg['params']): Msg => (params === undefined ? { key } : { key, params });
