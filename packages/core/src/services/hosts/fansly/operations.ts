// R20 P12a: Fansly's own operation driver, in its own chunk — «Заполнить из
// чата» (`notes-fill`). The voice script is every site's since 1.47.0
// (services/voice/script-driver.ts); the background's core adds it to each
// site's operations.
import { HubStreamRequestSchema, hasCapability, type HubStreamRequest } from '@cg/contracts/hub';
import { FANSLY_OP_DRIVERS, FANSLY_OP_LIMITS, FanslyOpViewSchema, FanslyStartOpSchema, type FanslyOp } from '@cg/contracts/ops-fansly';
import type { SiteStartOp } from '@cg/contracts/ops';
import type { BuildResult, StreamRequestContext } from '../../../domain/ops';
import { stableDigest } from '../../../domain/ops/digest';
import type { ScheduledStart, SiteOpDriver, SiteOperations } from '../../../domain/ops/site';
import { parseNoteFillAnswer } from '../../../domain/notes/fill-answer';

const UNUSABLE = { ok: false, code: 'CG-OUTPUT-UNUSABLE' } as const;

function prepare(start: SiteStartOp): ScheduledStart {
  const checked = FanslyStartOpSchema.parse(start);
  return {
    feature: checked.feature, target: checked.target, cause: checked.cause,
    surface: 'dock', split: false, window: checked.window, tone: null,
    ...(checked.fresh === undefined ? {} : { fresh: checked.fresh }),
    // The values are part of what is asked: another value is another request, never a kept result of the old one.
    parametersDigest: stableDigest(checked.values === undefined ? checked.fields : { fields: checked.fields, values: checked.values }),
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
  // above it; the hub's reader takes the same (`max(3000, deepMax)` with `context-v1`).
  const depth = Math.max(FANSLY_OP_LIMITS.notesFillDepthMin, ctx.bootstrap.limits.deepMax);
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
      ...(input.fresh !== undefined && ctx.freshText && hasCapability(ctx.bootstrap.capabilities, 'live-text-fansly-tools-v1') ? {
        liveTextContext: {
          capturedAt: input.fresh.capturedAt,
          items: input.fresh.messages.map((message) => ({
            platformMessageId: message.platformMessageId, direction: message.direction,
            occurredAt: message.sentAt, text: message.text,
          })),
        },
      } : {}),
      // R20 P11b2, X43 (the owner's ruling of 2026-10-17): the notes fill asks the hub's merge mode — the fan's words,
      // the month of a stale fact, `=` for a field the chat adds nothing to — with the questionnaire's values. They go
      // in this body and nowhere else: no log, diagnostics or `client_health` names them (FS-NOTE-5).
      noteFields: input.fields, noteValues: input.values ?? input.fields.map(() => ''),
    },
  });
  return request.success ? { ok: true, request: request.data } : { ok: false, issues: request.error.issues.map((issue) => issue.message).join('; ') };
}

/** Fansly's operations: «Заполнить из чата». The core adds the voice script to them, as to every site's. */
export function createFanslyOperations(done: SiteOperations['done']): SiteOperations {
  const driver = (feature: FanslyOp): SiteOpDriver => ({
    ...FANSLY_OP_DRIVERS[feature],
    prepare,
    build: (start, ctx) => build(feature, start, ctx),
    parse(text, ctx) {
      if (ctx.generationRef === null || ctx.stopReason === 'max_tokens' || ctx.stopReason === 'length') return UNUSABLE;
      const start = ctx.start.site;
      if (start?.feature !== 'notes-fill') return UNUSABLE;
      const result = parseNoteFillAnswer(text, start.fields);
      return result === null ? UNUSABLE : { ok: true, result };
    },
  });
  return {
    host: 'fansly-web',
    drivers: { 'notes-fill': driver('notes-fill') },
    readView(value) { const parsed = FanslyOpViewSchema.safeParse(value); return parsed.success ? parsed.data : null; },
    done,
  };
}
