// «Заполнить из чата» (`notes-fill`) as the shared scheduler runs it for a site with no driver of its own (2026-10-28:
// ChatSpace, whose notes are OnlyMonster's fan notes). Admitted like Reply — one per chat, three per tab, its
// timeouts, cancel and kept result — and streamed from the hub's `fan-notes-fill`. The same request as Fansly's own
// driver (services/hosts/fansly/operations.ts): the deep window (never fewer than 3000 messages, the owner's deeper
// setting above it), the questionnaire's labels and values in the body and nowhere else (FS-NOTE-5), the open chat's
// fresh text where the page lets it in. The target says the platform and its ids (on OnlyFans the chat is the fan).

import { HubStreamRequestSchema, hasCapability, type HubStreamRequest } from '@cg/contracts/hub';
import { NOTES_FILL_OP_DRIVER, NOTES_FILL_OP_LIMITS, NotesFillOpViewSchema, NotesFillStartSchema, type NotesFillOpView } from '@cg/contracts/notes-fill';
import type { SiteStartOp } from '@cg/contracts/ops';

import type { BuildResult, StreamRequestContext } from '../../domain/ops';
import { stableDigest } from '../../domain/ops/digest';
import type { ScheduledStart, SiteOpDriver } from '../../domain/ops/site';
import { parseNoteFillAnswer } from '../../domain/notes/fill-answer';

const UNUSABLE = { ok: false, code: 'CG-OUTPUT-UNUSABLE' } as const;

function prepare(start: SiteStartOp): ScheduledStart {
  const checked = NotesFillStartSchema.parse(start);
  return {
    feature: checked.feature,
    target: checked.target,
    cause: checked.cause,
    surface: 'dock',
    split: false,
    window: checked.window,
    tone: null,
    ...(checked.fresh === undefined ? {} : { fresh: checked.fresh }),
    // The values are part of what is asked: another value is another request, never a kept result of the old one.
    parametersDigest: stableDigest(checked.values === undefined ? checked.fields : { fields: checked.fields, values: checked.values }),
    ...(checked.force === undefined ? {} : { force: checked.force }),
    ...(checked.regenerateOf === undefined ? {} : { regenerateOf: checked.regenerateOf }),
    site: checked,
  };
}

function build(start: ScheduledStart, ctx: StreamRequestContext): BuildResult {
  const parsed = NotesFillStartSchema.safeParse(start.site);
  if (!parsed.success) return { ok: false, issues: 'invalid notes fill start' };
  const input = parsed.data;
  // HF-6: the fill reads the whole chat, never fewer than 3000 messages; the owner's deeper setting above it.
  const depth = Math.max(NOTES_FILL_OP_LIMITS.notesFillDepthMin, ctx.bootstrap.limits.deepMax);
  const capabilities: HubStreamRequest['capabilities'][number][] = [];
  if (hasCapability(ctx.bootstrap.capabilities, 'context-v1')) capabilities.push('context-v1');
  if (ctx.debug) capabilities.push('debug-input-v1');
  const request = HubStreamRequestSchema.safeParse({
    feature: NOTES_FILL_OP_DRIVER.hub,
    capabilities,
    body: {
      clientRequestId: ctx.opId,
      platform: input.target.binding.platform,
      pageLabel: input.target.binding.pageLabel,
      conversationRef: input.target.conversationRef,
      fanRef: input.target.fanRef,
      personaKey: ctx.persona.key,
      expectedPersonaDefinitionId: ctx.persona.definitionId,
      messageCount: Math.min(input.window, depth),
      isRegeneration: input.regenerateOf !== undefined,
      // The open chat's newest messages, where the page lets fresh text in (`live-text-fansly-tools-v1`, a token of
      // every platform's hub since hub#681, as the voice script reads it).
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
      // X43 (the owner's ruling of 2026-10-17): the hub's merge mode — the fan's words, the month of a stale fact, `=`
      // for a field the chat adds nothing to — with the questionnaire's values, in this body and nowhere else.
      noteFields: input.fields,
      noteValues: input.values ?? input.fields.map(() => ''),
    },
  });
  return request.success ? { ok: true, request: request.data } : { ok: false, issues: request.error.issues.map((issue) => issue.message).join('; ') };
}

/** The driver of `notes-fill` for a site with none of its own. */
export const NOTES_FILL_DRIVER: SiteOpDriver = {
  feature: NOTES_FILL_OP_DRIVER.feature,
  timeouts: NOTES_FILL_OP_DRIVER.timeouts,
  prepare,
  build,
  parse(text, ctx) {
    if (ctx.generationRef === null || ctx.stopReason === 'max_tokens' || ctx.stopReason === 'length') return UNUSABLE;
    const start = NotesFillStartSchema.safeParse(ctx.start.site);
    if (!start.success) return UNUSABLE;
    const result = parseNoteFillAnswer(text, start.data.fields);
    return result === null ? UNUSABLE : { ok: true, result };
  },
};

/** A kept view of the fill, from storage or the scheduler: strict, any site's. */
export function readNotesFillOpView(value: unknown): NotesFillOpView | null {
  const parsed = NotesFillOpViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
