// The voice script as the shared scheduler runs it (1.47.0): an operation of
// every site's slice (`voice-script`), admitted like Reply — one per chat,
// three per tab, its timeouts, cancel and kept result — and streamed from the
// hub's `voice-script` feature. One driver for ChatSpace and Fansly: the
// target says the platform, and the ids are its own (on OnlyFans the chat is
// the fan, on Fansly the group named apart from the fan). No `clientContext`:
// the hub reads the chat itself, and the open chat's fresh text rides along
// where the page allows it (`liveTextContext`, X70).

import { HubStreamRequestSchema, hasCapability, type HubStreamRequest } from '@cg/contracts/hub';
import type { SiteStartOp } from '@cg/contracts/ops';
import { VOICE_OP_DRIVER, VoiceOpViewSchema, VoiceScriptResultSchema, VoiceScriptStartSchema, type VoiceOpView } from '@cg/contracts/voice';
import type { BuildResult, StreamRequestContext } from '../../domain/ops';
import type { ScheduledStart, SiteOpDriver } from '../../domain/ops/site';

const UNUSABLE = { ok: false, code: 'CG-OUTPUT-UNUSABLE' } as const;

function prepare(start: SiteStartOp): ScheduledStart {
  const checked = VoiceScriptStartSchema.parse(start);
  return {
    feature: checked.feature,
    target: checked.target,
    cause: checked.cause,
    surface: 'dock',
    split: false,
    window: checked.window,
    tone: checked.tone,
    // The draft is part of what is asked: another draft is another request, never a kept result of the old one.
    draft: checked.draft,
    ...(checked.fresh === undefined ? {} : { fresh: checked.fresh }),
    ...(checked.force === undefined ? {} : { force: checked.force }),
    ...(checked.regenerateOf === undefined ? {} : { regenerateOf: checked.regenerateOf }),
    site: checked,
  };
}

function build(start: ScheduledStart, ctx: StreamRequestContext): BuildResult {
  const parsed = VoiceScriptStartSchema.safeParse(start.site);
  if (!parsed.success) return { ok: false, issues: 'invalid voice script start' };
  const input = parsed.data;
  const capabilities: HubStreamRequest['capabilities'][number][] = [];
  if (hasCapability(ctx.bootstrap.capabilities, 'context-v1')) capabilities.push('context-v1');
  if (ctx.debug) capabilities.push('debug-input-v1');
  const request = HubStreamRequestSchema.safeParse({
    feature: VOICE_OP_DRIVER.hub,
    capabilities,
    body: {
      clientRequestId: ctx.opId,
      platform: input.target.binding.platform,
      pageLabel: input.target.binding.pageLabel,
      conversationRef: input.target.conversationRef,
      fanRef: input.target.fanRef,
      personaKey: ctx.persona.key,
      expectedPersonaDefinitionId: ctx.persona.definitionId,
      messageCount: Math.min(input.window, ctx.bootstrap.limits.deepMax),
      isRegeneration: input.regenerateOf !== undefined,
      // The open chat's newest messages, where the page lets fresh text in and the hub reads it for the script
      // (`live-text-fansly-tools-v1`, a token of every platform's hub since hub#681).
      ...(input.fresh !== undefined && ctx.freshText && hasCapability(ctx.bootstrap.capabilities, 'live-text-fansly-tools-v1')
        ? {
            liveTextContext: {
              capturedAt: input.fresh.capturedAt,
              items: input.fresh.messages.map((message) => ({
                platformMessageId: message.platformMessageId,
                direction: message.direction,
                occurredAt: message.sentAt,
                text: message.text,
              })),
            },
          }
        : {}),
      draftText: input.draft.text,
      replyTone: input.tone ?? 'none',
    },
  });
  return request.success ? { ok: true, request: request.data } : { ok: false, issues: request.error.issues.map((issue) => issue.message).join('; ') };
}

/** The driver of `voice-script`: the studio takes the script only after the stream ended, with its `generationRef` (HF-4а). */
export const VOICE_SCRIPT_DRIVER: SiteOpDriver = {
  feature: VOICE_OP_DRIVER.feature,
  timeouts: VOICE_OP_DRIVER.timeouts,
  prepare,
  build,
  parse(text, ctx) {
    // A script cut by the token limit, or one with no source, never becomes the source of a paid voicing.
    if (ctx.generationRef === null || ctx.stopReason === 'max_tokens' || ctx.stopReason === 'length') return UNUSABLE;
    const result = VoiceScriptResultSchema.safeParse({ kind: 'voice-script', script: text.trim() });
    return result.success ? { ok: true, result: result.data } : UNUSABLE;
  },
};

/** A kept view of the voice script, from storage or the scheduler: strict, any site's. */
export function readVoiceOpView(value: unknown): VoiceOpView | null {
  const parsed = VoiceOpViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
