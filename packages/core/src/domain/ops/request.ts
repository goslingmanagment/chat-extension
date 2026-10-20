// The AI stream request of an operation (architecture.md §8.4, D-14, D-15,
// Б5, AI-134): our feature → the hub feature and its fields, the common
// fields (clientRequestId = opId, pageLabel, conversationRef — the fan on
// OnlyFans, the group on Fansly — and fanRef,
// persona key + expected definition, messageCount, isRegeneration), fresh
// text only for draft features in the open chat under the freshText switch —
// and for Review and Coach where the hub lists `live-text-review-coach-v1`
// and Recap with `live-text-recap-v1` (X52, X70; `LIVE_TEXT_HUB_NEEDS`) —
// the known fan ids of a preview checkpoint, and the capability header. The
// result is checked against the contracts' schema: a request the hub would
// refuse with 400 is our bug and never leaves the background.
//
// A start with a proof (1.15.0, R20 P8b1: a host whose tab observes its chats —
// Fansly's snapshot; «Новые» — the pass) is asked about it: its window and its
// deleted ids as `coverageCheck` under `coverage-check-v1` (with `context-v1`:
// the answer rides in the context frame; a hub before HF-8в refuses the field),
// the fan's known ids, a draft's texts as `liveTextContext` under the same
// freshText switch, and a messageCount never below the check window — the hub
// serves at least what it is asked about (FS-TAIL-1, HF-8г).
//
// Hi where the hub decides it by the client's start proof (1.15.0, R20 P8c: Fansly, HF-5) names
// `hi-start-proof-v1` to a hub that declared it and carries the proof, its count and the fan's avatar.
//
// The open chat's PPV state (1.27.0, X54) goes as `livePpvContext` where fresh text may go, to a hub that lists
// `live-ppv-v1`: the hub's body is strict, so a hub without it is never sent the field.

import { type FeatureId } from '@cg/contracts/features';
import { type LiveTextTail } from '@cg/contracts/host';
import { HI_BY_START_PROOF } from '@cg/contracts/ids';
import {
  HUB_FEATURE_MAP,
  HubStreamRequestSchema,
  LIVE_TEXT_HUB_NEEDS,
  hasCapability,
  type AiFeatureStreamBody,
  type AiStreamCapability,
  type Bootstrap,
  type HubStreamRequest,
  type LiveTextContext,
} from '@cg/contracts/hub';
import { AI_REQUEST_LIMITS } from '@cg/contracts/limits';
import { type StartOp } from '@cg/contracts/ops';
import { type SettingsV1 } from '@cg/contracts/settings';
import { type SettingsExt } from '@cg/contracts/settings-ext';

import { type PersonaChoice } from './environment';
import { flagUsable } from './flags';

/** Fixed windows that are not settings (Fansly: Hi reads one page, a short recap 300 messages). */
export const FIXED_WINDOWS = { hi: 25, recapShort: 300 } as const;

/**
 * Б5 / AI-134: the messageCount of a feature from the settings windows
 * (quick: Reply, Coach; improve: Fix; ping: Ping; deep: Review, full Recap),
 * the deep wish from settings.ext when present, otherwise v1; never above
 * the hub's `limits.deepMax`. Storage itself is left unchanged.
 */
export function messageWindowFor(feature: FeatureId, windows: SettingsV1['generation']['windows'], deepMax: number, extendedWindows?: SettingsExt['windows']): number {
  const cap = Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(AI_REQUEST_LIMITS.messageCountMax, deepMax));
  const raw = (() => {
    switch (feature) {
      case 'reply':
      case 'coach':
        return windows.quick;
      case 'fix':
        return windows.improve;
      case 'ping':
        return windows.ping;
      case 'hi':
        return FIXED_WINDOWS.hi;
      case 'review':
      case 'recap':
        return extendedWindows?.deep ?? windows.deep;
      case 'recap-short':
        return Math.min(windows.deep, FIXED_WINDOWS.recapShort);
    }
  })();
  return Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(cap, raw));
}

export interface StreamRequestContext {
  readonly opId: string;
  readonly persona: PersonaChoice;
  readonly bootstrap: Bootstrap;
  readonly debug: boolean;
  /** D-14: the page admits fresh page text — the manifest's `fresh-text` (`freshTextAdmitted`). */
  readonly freshText: boolean;
}

export type BuildResult = { readonly ok: true; readonly request: HubStreamRequest } | { readonly ok: false; readonly issues: string };

function liveTextOf(tail: LiveTextTail): LiveTextContext {
  return {
    capturedAt: tail.capturedAt,
    items: tail.messages.map((m) => ({ platformMessageId: m.platformMessageId, direction: m.direction, occurredAt: m.sentAt, text: m.text })),
  };
}

/** Whether `replyMode: 'preferSplit'` may be asked for this feature on this page (D-15, H-10). */
export function splitAllowed(feature: FeatureId, bootstrap: Bootstrap, pageId: number): boolean {
  const mode = HUB_FEATURE_MAP[feature].replyMode;
  if (mode === 'always') return true;
  if (mode === 'split-all-v1') return flagUsable(bootstrap, pageId, 'splitAll');
  return false;
}

/** The default request of a start (R11 drivers may build their own over the same rules). */
export function buildStreamRequest(start: StartOp, ctx: StreamRequestContext): BuildResult {
  const spec = HUB_FEATURE_MAP[start.feature];
  const pageId = start.target.binding.pageId;
  const contextV1 = hasCapability(ctx.bootstrap.capabilities, 'context-v1');
  const capabilities: AiStreamCapability[] = [];
  if (ctx.debug) capabilities.push('debug-input-v1');
  if (contextV1) capabilities.push('context-v1');
  const split = splitAllowed(start.feature, ctx.bootstrap, pageId);
  if (spec.replyMode === 'split-all-v1' && split) capabilities.push('split-all-v1');

  const proof = start.proof;
  // HF-8в: the window check only to a hub that declared it, beside the context frame its answer rides in.
  const coverageCheck = proof !== undefined && contextV1 && hasCapability(ctx.bootstrap.capabilities, 'coverage-check-v1');
  if (coverageCheck) capabilities.push('coverage-check-v1');
  // HF-5: where the hub decides Hi by the start proof, every Hi names `hi-start-proof-v1` to a hub that declared it —
  // without a proof too, so the hub refuses `history_unproven` instead of counting its archive (fail closed).
  const hiByProof = start.feature === 'hi' && HI_BY_START_PROOF[start.target.binding.platform] && hasCapability(ctx.bootstrap.capabilities, 'hi-start-proof-v1');
  if (hiByProof) capabilities.push('hi-start-proof-v1');

  const window = Math.max(Math.min(start.window, Math.max(AI_REQUEST_LIMITS.messageCountMin, ctx.bootstrap.limits.deepMax)), proof?.window.length ?? 0);
  const body: { -readonly [K in keyof AiFeatureStreamBody]: AiFeatureStreamBody[K] } = {
    clientRequestId: ctx.opId,
    pageLabel: start.target.binding.pageLabel,
    platform: start.target.binding.platform,
    conversationRef: start.target.conversationRef,
    fanRef: start.target.fanRef,
    personaKey: ctx.persona.key,
    expectedPersonaDefinitionId: ctx.persona.definitionId,
    messageCount: window,
    isRegeneration: start.regenerateOf !== undefined,
  };
  if (spec.replyMode !== null && split) body.replyMode = start.split ? 'preferSplit' : 'default';
  if (start.feature === 'reply') body.replyTone = start.tone ?? 'none';
  if (start.feature === 'fix' && start.draft !== undefined) body.draftText = start.draft.text;
  if (start.feature === 'hi' && start.variantCount !== undefined) body.variantCount = start.variantCount;
  // The proof of the start, its count and the fan's avatar (FX-018) ride only on that lane: ids and an address, no text.
  if (hiByProof && start.startProof !== undefined) body.startProof = start.startProof;
  if (hiByProof && start.personalMessageCount !== undefined) body.personalMessageCount = start.personalMessageCount;
  // 2026-10-20 audit, row 6: Hi on OnlyFans tells the hub its personal messages (no mass ones); the hub counts them instead of its archive.
  else if (start.feature === 'hi' && start.target.binding.platform === 'onlyfans' && start.personalMessageCount !== undefined) body.personalMessageCount = start.personalMessageCount;
  if (hiByProof && start.fanAvatarUrl !== undefined) body.fanAvatarUrl = start.fanAvatarUrl;
  if (start.feature === 'recap-short') body.summaryMode = 'short';
  if (start.feature === 'coach' && start.coach !== undefined) {
    // A preset's question lives on the hub: the hub refuses a body that names both («coach-chat preset forbids
    // chatterQuestion», 400). The words the start carries beside a preset are the chip's label for our dialog.
    if (start.coach.preset !== undefined) body.preset = start.coach.preset;
    else if (start.coach.question !== undefined) body.chatterQuestion = start.coach.question;
    if (start.coach.history.length > 0) body.coachHistory = start.coach.history.map((turn) => ({ question: turn.question, answer: turn.answer }));
    if (start.coach.attachDraft !== undefined) body.draftText = start.coach.attachDraft;
  }
  // A start carries one of the two (StartOp: a proof never beside a checkpoint): the ids come from where it was taken.
  const known = start.checkpoint?.knownFanMessageIds ?? (ctx.freshText ? proof?.knownFanMessageIds : undefined) ?? [];
  if (contextV1 && known.length > 0) body.knownFanMessageIds = [...known];
  if (coverageCheck && proof !== undefined) body.coverageCheck = { window: proof.window.map((entry) => ({ id: entry.id, dir: entry.dir })), deletedIds: [...proof.deletedIds] };
  // D-14: fresh page text goes only where the page admits it (the owner's `freshText` and the hub's `context-v1`) —
  // ChatSpace's tail, or a proof's texts taken in the same instant as its window.
  const tail = start.fresh ?? (proof !== undefined && proof.tail !== undefined && proof.tail.length > 0 ? { capturedAt: proof.takenAt, messages: proof.tail } : undefined);
  const liveNeed = LIVE_TEXT_HUB_NEEDS[start.feature];
  if (tail !== undefined && ctx.freshText && (liveNeed === undefined || hasCapability(ctx.bootstrap.capabilities, liveNeed))) body.liveTextContext = liveTextOf(tail);
  if (start.livePpv !== undefined && ctx.freshText && hasCapability(ctx.bootstrap.capabilities, 'live-ppv-v1')) body.livePpvContext = start.livePpv;

  const request: HubStreamRequest = { feature: spec.hub, body, capabilities };
  const parsed = HubStreamRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => issue.message).join('; ') };
  return { ok: true, request: parsed.data };
}
