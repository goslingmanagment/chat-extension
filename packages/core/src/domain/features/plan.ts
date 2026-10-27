// From a click to a StartOp (architecture.md §5.5, §7, §8.4, §10.2
// «UserOptions — разрешённый список»; D-14, D-15, Б1, Б5, Б7; AI-001…AI-039,
// AI-134). The UI names a feature and, at most, the options of the
// allowlist; the controller supplies the target and this module the policy:
// the tone only for Reply, the Split snapshot only where the page may ask
// for parts, the window from the settings (the deep one never above the
// hub's `limits.deepMax`), three Hi variants in the dock and one in «Новые»,
// the draft for Fix and for Coach's «приложить мой ответ», and fresh page
// text only for the four draft features in the open chat, Review and Coach
// (X52), while the page admits it (the manifest's `fresh-text`: the owner's
// switch and the hub's `context-v1`). The result is checked
// against the frozen StartOp schema: a start the background would refuse is
// never sent.

import { type CgCode } from '@cg/contracts/errors';
import { freshTextSurface, type FeatureId, type Surface, type Tone } from '@cg/contracts/features';
import { type DraftMedia, type LiveTextTail } from '@cg/contracts/host';
import { LIVE_TEXT_HUB_NEEDS, hasCapability, type Bootstrap } from '@cg/contracts/hub';
import { type DraftSnapshot, type HumanCause, type Target } from '@cg/contracts/ids';
import { AI_REQUEST_LIMITS, COACH_LIMITS, LIVE_TEXT_LIMITS } from '@cg/contracts/limits';
import { DRAFT_MEDIA_FEATURES, StartOpSchema, type AiStartFields, type CoachTurn, type StartOp } from '@cg/contracts/ops';
import { type FreshnessCheckpoint } from '@cg/contracts/send';
import { type SettingsV1 } from '@cg/contracts/settings';
import { type SettingsExt } from '@cg/contracts/settings-ext';
import { type UserOptions } from '@cg/contracts/vm';

import { coachWindowOf } from '../coach/depth';
import { messageWindowFor, splitAllowed } from '../ops/request';
import { policyOf } from './policy';

/** Hi: three variants to choose from in the dock and previews, one in «Новые» (AI-030, NF-013). */
export function hiVariantCount(surface: Surface): 1 | 3 {
  return surface === 'newcomers' ? 1 : 3;
}

/**
 * Б5: the message window of a start — the person's option within bounds, else the settings window; never above
 * `limits.deepMax`. 2026-10-27: Coach has a number of its own (`generation.coach.window`, 300), no longer Reply's.
 */
export function windowFor(feature: FeatureId, requested: number | undefined, settings: SettingsV1, bootstrap: Bootstrap, extendedWindows?: SettingsExt['windows']): number {
  const cap = Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(AI_REQUEST_LIMITS.messageCountMax, bootstrap.limits.deepMax));
  const wanted = requested ?? (feature === 'coach' ? coachWindowOf(settings) : undefined);
  if (wanted === undefined) return messageWindowFor(feature, settings.generation.windows, bootstrap.limits.deepMax, extendedWindows);
  return Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(cap, Math.trunc(wanted)));
}

/**
 * Б7: the Split snapshot of a start. On only for a feature whose output is
 * a message to the fan AND on a page that may ask the hub for parts (Reply
 * and Fix always; Hi, Ping and Coach drafts with `split-all-v1`, H-10).
 * Otherwise false, so «получилась одна часть» is never said about a
 * request that did not ask for parts.
 */
export function splitFor(feature: FeatureId, wanted: boolean, bootstrap: Bootstrap, pageId: number): boolean {
  return wanted && policyOf(feature).split && splitAllowed(feature, bootstrap, pageId);
}

export interface FreshTextLimits {
  /** N of `readVisibleTail(N)`: the bootstrap limit, never above the hub body's. */
  readonly maxItems: number;
  readonly maxChars: number;
}

/**
 * D-14: whether this start may carry fresh page text, and how much. Reply,
 * Fix, Hi and Ping in the open chat (surface `dock`); since decision X52 also
 * Review in the dock and Coach on its panel (`freshTextSurface`), on a hub that
 * takes it there (`LIVE_TEXT_HUB_NEEDS`), including both Recap lengths. Only where the page
 * admits it — `admitted`, the admission of the manifest's `fresh-text`
 * (`freshTextAdmitted`: the owner's `freshText` of the page and the hub's
 * `context-v1`). null — the generation runs on the hub archive alone.
 */
export function freshTextLimits(feature: FeatureId, surface: Surface, bootstrap: Bootstrap, admitted: boolean): FreshTextLimits | null {
  if (!admitted || !policyOf(feature).freshText || freshTextSurface(feature) !== surface) return null;
  const need = LIVE_TEXT_HUB_NEEDS[feature];
  if (need !== undefined && !hasCapability(bootstrap.capabilities, need)) return null;
  const maxItems = Math.min(LIVE_TEXT_LIMITS.maxItems, bootstrap.limits.freshTextMaxItems);
  const maxChars = Math.min(LIVE_TEXT_LIMITS.maxChars, bootstrap.limits.freshTextMaxChars);
  return maxItems >= 1 && maxChars >= 1 ? { maxItems, maxChars } : null;
}

/** The tail as it may go with a start: the newest `maxItems` messages, each within `maxChars`; null when nothing is left. */
export function trimFreshTail(tail: LiveTextTail | null | undefined, limits: FreshTextLimits | null): LiveTextTail | null {
  if (tail === null || tail === undefined || limits === null) return null;
  const messages = tail.messages
    .filter((message) => message.text.length > 0)
    .slice(-limits.maxItems)
    .map((message) => (message.text.length > limits.maxChars ? { ...message, text: message.text.slice(0, limits.maxChars) } : message));
  return messages.length === 0 ? null : { capturedAt: tail.capturedAt, messages };
}

export interface StartPlanInput {
  readonly feature: FeatureId;
  readonly surface: Surface;
  readonly target: Target;
  readonly cause: HumanCause;
  /** What the person chose for this one generation (the allowlist). */
  readonly options: UserOptions;
  readonly settings: SettingsV1;
  /** R20 §12: the wish from settings.ext, when available; never written into or repaired as settings v1. */
  readonly extendedWindows?: SettingsExt['windows'] | undefined;
  readonly bootstrap: Bootstrap;
  /** The one-off tone chosen for this chat (Б1); used by Reply only. */
  readonly tone: Tone | null;
  /** The composer's draft as read right before: Fix's source, Coach's «приложить мой ответ». */
  readonly draft?: Pick<DraftSnapshot, 'plainText' | 'revision' | 'digest'> | null;
  /**
   * The site's own fields of the start, from its proof (`AiHostPolicy.fields`, R20 F10): the visible tail as the host
   * gave it — dropped unless D-14 allows it — and whatever else the site sets, checked by the schema with the rest.
   */
  readonly fields?: AiStartFields;
  /** The page admits fresh page text (`freshTextAdmitted`); absent — it does not. */
  readonly freshText?: boolean;
  readonly coachHistory?: readonly CoachTurn[] | undefined;
  /** Previews: the freshness checkpoint of the Generate click (X8). */
  readonly checkpoint?: FreshnessCheckpoint;
  /** «Ещё раз»: the operation this one repeats. */
  readonly regenerateOf?: string | undefined;
  /** Bypass the result cache (Regenerate, Refresh, every Recap build). */
  readonly force?: boolean;
  /** «Ещё раз» keeps the Split snapshot of the original instead of the setting. */
  readonly splitWanted?: boolean | undefined;
  /** AI-096: the recap a Coach turn builds first — the same start, one admission (§7 «один составной слот»). */
  readonly autoRecap?: 'short' | 'full' | undefined;
  /** «с Recap» unticked in the chat, to a hub that can leave the Recap out (`StartOp.recap`); a Recap build ignores it. */
  readonly recapOff?: boolean | undefined;
  /** The media attached to the message being written, as the open chat's composer showed it at the click (`StartOp.draftMedia`). */
  readonly draftMedia?: DraftMedia | null | undefined;
}

export type StartPlan = { readonly ok: true; readonly start: StartOp } | { readonly ok: false; readonly code: CgCode };

const refuse = (code: CgCode): StartPlan => ({ ok: false, code });

export function planStart(input: StartPlanInput): StartPlan {
  const { feature, surface, target, options, settings, bootstrap } = input;
  const rule = policyOf(feature);
  const pageId = target.binding.pageId;
  const draftText = input.draft?.plainText ?? '';
  const hasDraft = input.draft !== null && input.draft !== undefined && draftText.trim().length > 0;

  const start: { -readonly [K in keyof StartOp]: StartOp[K] } = {
    feature,
    surface,
    target,
    cause: input.cause,
    // Б1: a tone belongs to Reply only; an explicit choice of this click wins over the chat's one-off tone.
    tone: rule.tone ? (options.tone !== undefined ? options.tone : input.tone) : null,
    split: splitFor(feature, options.split ?? input.splitWanted ?? settings.generation.split, bootstrap, pageId),
    window: windowFor(feature, options.window, settings, bootstrap, input.extendedWindows),
  };

  if (rule.requiresDraft) {
    // AI-021: «сначала напишите черновик».
    if (!hasDraft || input.draft === null || input.draft === undefined) return refuse('CG-GATE-DRAFT');
    start.draft = { text: draftText, revision: input.draft.revision, digest: input.draft.digest };
  }
  if (feature === 'hi') start.variantCount = options.variants ?? hiVariantCount(surface);
  if (feature === 'coach') {
    const question = options.question?.trim() ?? '';
    if (question.length === 0 && options.preset === undefined) return refuse('CG-UI-FAILED');
    start.coach = {
      ...(question.length === 0 ? {} : { question }),
      ...(options.preset === undefined ? {} : { preset: options.preset }),
      history: [...(input.coachHistory ?? [])].slice(-COACH_LIMITS.historyMaxTurns),
      // AI-091: the draft goes with this one turn only; it is not fresh text.
      ...(options.attachMyDraft === true && hasDraft ? { attachDraft: draftText } : {}),
      // The recap has its own window: the deep one for the full recap, the fixed one for the short.
      ...(input.autoRecap === undefined ? {} : { autoRecap: { length: input.autoRecap, window: windowFor(input.autoRecap === 'full' ? 'recap' : 'recap-short', undefined, settings, bootstrap, input.extendedWindows) } }),
    };
  }
  const { fresh: tail, ...site } = input.fields ?? {};
  const fresh = trimFreshTail(tail, freshTextLimits(feature, surface, bootstrap, input.freshText === true));
  if (fresh !== null) start.fresh = fresh;
  Object.assign(start, site);
  if (input.checkpoint !== undefined && (surface === 'preview' || surface === 'newcomers')) start.checkpoint = input.checkpoint;
  if (input.regenerateOf !== undefined) start.regenerateOf = input.regenerateOf;
  if (input.force === true || input.regenerateOf !== undefined) start.force = true;
  if (input.recapOff === true && feature !== 'recap' && feature !== 'recap-short') start.recap = 'off';
  if (input.draftMedia !== null && input.draftMedia !== undefined && DRAFT_MEDIA_FEATURES.has(feature) && freshTextSurface(feature) === surface) start.draftMedia = input.draftMedia;

  const parsed = StartOpSchema.safeParse(start);
  return parsed.success ? { ok: true, start: parsed.data } : refuse('CG-UI-FAILED');
}
