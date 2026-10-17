// R20 P12a: Fansly's drivers, in its own chunk. These are generation
// operations, not paid voice attempts (P12b1/P12b2).
import { HubStreamRequestSchema, hasCapability, type HubStreamRequest } from '@cg/contracts/hub';
import { FANSLY_OP_DRIVERS, FANSLY_OP_LIMITS, FanslyOpViewSchema, FanslyStartOpSchema, VoiceScriptResultSchema, type FanslyOp } from '@cg/contracts/ops-fansly';
import type { SiteStartOp } from '@cg/contracts/ops';
import type { BuildResult, StreamRequestContext } from '../../../domain/ops';
import { stableDigest } from '../../../domain/ops/digest';
import type { ScheduledStart, SiteOpDriver, SiteOperations } from '../../../domain/ops/site';
import { parseNoteFillAnswer } from './notes-fill-answer';

const UNUSABLE = { ok: false, code: 'CG-OUTPUT-UNUSABLE' } as const;

function prepare(start: SiteStartOp): ScheduledStart {
  const checked = FanslyStartOpSchema.parse(start);
  return {
    feature: checked.feature, target: checked.target, cause: checked.cause,
    surface: 'dock', split: false, window: checked.window,
    tone: checked.feature === 'voice-script' ? checked.tone : null,
    // The values are part of what is asked: another value is another request, never a kept result of the old one.
    ...(checked.feature === 'voice-script' ? { draft: checked.draft } : { parametersDigest: stableDigest(checked.values === undefined ? checked.fields : { fields: checked.fields, values: checked.values }) }),
    ...(checked.force === undefined ? {} : { force: checked.force }),
    ...(checked.regenerateOf === undefined ? {} : { regenerateOf: checked.regenerateOf }),
    site: checked,
  };
}

function build(feature: FanslyOp, start: ScheduledStart, ctx: StreamRequestContext): BuildResult {
  const parsed = FanslyStartOpSchema.safeParse(start.site);
  if (!parsed.success || parsed.data.feature !== feature) return { ok: false, issues: 'invalid site operation start' };
  const input = parsed.data;
  // HF-6 (R20 P11c): the notes fill reads the whole chat — never fewer than 3000 messages, the owner's deeper setting
  // above it; the hub's reader takes the same (`max(3000, deepMax)` with `context-v1`). The rest — up to `deepMax`.
  const depth = input.feature === 'notes-fill' ? Math.max(FANSLY_OP_LIMITS.notesFillDepthMin, ctx.bootstrap.limits.deepMax) : ctx.bootstrap.limits.deepMax;
  const capabilities: HubStreamRequest['capabilities'][number][] = [];
  if (hasCapability(ctx.bootstrap.capabilities, 'context-v1')) capabilities.push('context-v1');
  if (ctx.debug) capabilities.push('debug-input-v1');
  const request = HubStreamRequestSchema.safeParse({
    feature: FANSLY_OP_DRIVERS[feature].hub,
    capabilities,
    body: {
      clientRequestId: ctx.opId, platform: input.target.binding.platform,
      pageLabel: input.target.binding.pageLabel,
      conversationRef: input.target.conversationRef, fanRef: input.target.fanRef,
      personaKey: ctx.persona.key, expectedPersonaDefinitionId: ctx.persona.definitionId,
      messageCount: Math.min(input.window, depth),
      isRegeneration: input.regenerateOf !== undefined,
      // R20 P11b2, X43 (the owner's ruling of 2026-10-17): the notes fill asks the hub's merge mode — the fan's words,
      // the month of a stale fact, `=` for a field the chat adds nothing to — with the questionnaire's values. They go
      // in this body and nowhere else: no log, diagnostics or `client_health` names them (FS-NOTE-5).
      ...(input.feature === 'voice-script' ? { draftText: input.draft.text, replyTone: input.tone ?? 'none' } : { noteFields: input.fields, noteValues: input.values ?? input.fields.map(() => '') }),
    },
  });
  return request.success ? { ok: true, request: request.data } : { ok: false, issues: request.error.issues.map((issue) => issue.message).join('; ') };
}

/** The panel consumes the script only after the stream ended, with its generationRef (HF-4а). */
export function createFanslyOperations(done: SiteOperations['done']): SiteOperations {
  const driver = (feature: FanslyOp): SiteOpDriver => ({
    ...FANSLY_OP_DRIVERS[feature],
    prepare,
    build: (start, ctx) => build(feature, start, ctx),
    parse(text, ctx) {
      if (ctx.generationRef === null || ctx.stopReason === 'max_tokens' || ctx.stopReason === 'length') return UNUSABLE;
      if (feature === 'voice-script') {
        const result = VoiceScriptResultSchema.safeParse({ kind: 'voice-script', script: text.trim() });
        return result.success ? { ok: true, result: result.data } : UNUSABLE;
      }
      const start = ctx.start.site;
      if (start?.feature !== 'notes-fill') return UNUSABLE;
      const result = parseNoteFillAnswer(text, start.fields);
      return result === null ? UNUSABLE : { ok: true, result };
    },
  });
  return {
    host: 'fansly-web',
    drivers: { 'voice-script': driver('voice-script'), 'notes-fill': driver('notes-fill') },
    readView(value) { const parsed = FanslyOpViewSchema.safeParse(value); return parsed.success ? parsed.data : null; },
    done,
  };
}
