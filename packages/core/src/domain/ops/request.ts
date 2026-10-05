// The AI stream request of an operation (architecture.md §8.4, D-14, D-15,
// Б5, AI-134): our feature → the hub feature and its fields, the common
// fields (clientRequestId = opId, pageLabel, conversationRef = fanRef,
// persona key + expected definition, messageCount, isRegeneration), fresh
// text only for draft features in the open chat under the freshText switch,
// the known fan ids of a preview checkpoint, and the capability header. The
// result is checked against the contracts' schema: a request the hub would
// refuse with 400 is our bug and never leaves the background.

import { type FeatureId } from '@cg/contracts/features';
import { type LiveTextTail } from '@cg/contracts/host';
import {
  HUB_FEATURE_MAP,
  HubStreamRequestSchema,
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

import { flagUsable, type PersonaChoice } from './environment';

/** Fixed windows that are not settings (Fansly: Hi reads one page, a short recap 300 messages). */
export const FIXED_WINDOWS = { hi: 25, recapShort: 300 } as const;

/**
 * Б5 / AI-134: the messageCount of a feature from the settings windows
 * (quick: Reply, Coach; improve: Fix; ping: Ping; deep: Review, full Recap),
 * the deep one never above the hub's `limits.deepMax`.
 */
export function messageWindowFor(feature: FeatureId, windows: SettingsV1['generation']['windows'], deepMax: number): number {
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
        return windows.deep;
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

/** Whether fresh page text may go with this start (D-14: flag freshText + hub context-v1). */
export function freshTextAllowed(start: StartOp, bootstrap: Bootstrap): boolean {
  return start.fresh !== undefined && flagUsable(bootstrap, start.target.binding.pageId, 'freshText') && hasCapability(bootstrap.capabilities, 'context-v1');
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

  const window = Math.min(start.window, Math.max(AI_REQUEST_LIMITS.messageCountMin, ctx.bootstrap.limits.deepMax));
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
  if (start.feature === 'recap-short') body.summaryMode = 'short';
  if (start.feature === 'coach' && start.coach !== undefined) {
    // A preset's question lives on the hub: the hub refuses a body that names both («coach-chat preset forbids
    // chatterQuestion», 400). The words the start carries beside a preset are the chip's label for our dialog.
    if (start.coach.preset !== undefined) body.preset = start.coach.preset;
    else if (start.coach.question !== undefined) body.chatterQuestion = start.coach.question;
    if (start.coach.history.length > 0) body.coachHistory = start.coach.history.map((turn) => ({ question: turn.question, answer: turn.answer }));
    if (start.coach.attachDraft !== undefined) body.draftText = start.coach.attachDraft;
  }
  if (contextV1 && start.checkpoint !== undefined && start.checkpoint.knownFanMessageIds.length > 0) {
    body.knownFanMessageIds = [...start.checkpoint.knownFanMessageIds];
  }
  if (start.fresh !== undefined && freshTextAllowed(start, ctx.bootstrap)) body.liveTextContext = liveTextOf(start.fresh);

  const request: HubStreamRequest = { feature: spec.hub, body, capabilities };
  const parsed = HubStreamRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => issue.message).join('; ') };
  return { ok: true, request: parsed.data };
}
