// AI-142: the body of a generation request (architecture.md §8.4 table and
// «Общие поля»; hub `aiFeatureStreamBodySchema` + H-4/H-10). One pure
// function from the operation (StartOp) and what the hub and the transport
// can do now to a HubStreamRequest the contract accepts:
// - clientRequestId = opId; conversationRef = fanRef = the OF fan id; on
//   OnlyFans no Fansly `clientContext`;
// - personaKey + expectedPersonaDefinitionId (AI-140);
// - replyTone only for Reply (`none` without a tone, Б1); replyMode
//   `preferSplit` by the Split snapshot — for Hi/Ping/Coach only with
//   `split-all-v1` and the page's `splitAll` flag (H-10), else omitted;
// - messageCount from the window, capped by `limits.deepMax`;
// - fresh text only for Reply/Fix/Hi/Ping in the dock, with the freshText
//   flag and `context-v1` (D-14), cut to the bootstrap limits;
// - the freshness checkpoint's known fan ids only with `context-v1`;
// - capability header: `debug-input-v1` in debug mode, `context-v1` when
//   available (the frame tells what served this generation), `split-all-v1`
//   when Split was asked of a split-all feature.

import {
  AI_REQUEST_LIMITS,
  HUB_FEATURE_MAP,
  HubStreamRequestSchema,
  isFreshTextFeature,
  type AiFeatureStreamBody,
  type AiStreamCapability,
  type Bootstrap,
  type HubStreamRequest,
  type LiveTextContext,
  type StartOp,
} from '@cg/contracts';

import { flagState } from './bootstrap-rules';

export interface StreamRequestContext {
  readonly opId: string;
  /** The page's persona assignment (settings `personas.byPageId`): a reference, never a body. */
  readonly persona: { readonly key: string; readonly definitionId: string };
  readonly bootstrap: Bootstrap;
  /** StreamService.available(): declared by the hub ∩ carried by the transport. */
  readonly capabilities: readonly AiStreamCapability[];
  /** settings.debug.enabled: ask for the prompt echo. */
  readonly debug: boolean;
}

export type StreamRequestResult = { readonly ok: true; readonly request: HubStreamRequest } | { readonly ok: false; readonly problem: string };

/** The last `freshTextMaxItems` messages, each cut to `freshTextMaxChars`; a zero limit from the hub means no fresh text at all. */
function freshContext(op: StartOp, bootstrap: Bootstrap): LiveTextContext | undefined {
  const fresh = op.fresh;
  if (fresh === undefined) return undefined;
  const { freshTextMaxItems, freshTextMaxChars } = bootstrap.limits;
  if (freshTextMaxItems <= 0 || freshTextMaxChars <= 0) return undefined;
  const items = fresh.messages.slice(Math.max(0, fresh.messages.length - freshTextMaxItems)).map((message) => ({
    platformMessageId: message.platformMessageId,
    direction: message.direction,
    occurredAt: message.sentAt,
    text: message.text.slice(0, freshTextMaxChars),
  }));
  return items.length === 0 ? undefined : { capturedAt: fresh.capturedAt, items };
}

export function buildStreamRequest(op: StartOp, context: StreamRequestContext): StreamRequestResult {
  const spec = HUB_FEATURE_MAP[op.feature];
  const { bootstrap } = context;
  const pageLabel = op.target.binding.pageLabel;
  const can = (capability: AiStreamCapability) => context.capabilities.includes(capability);
  const capabilities = new Set<AiStreamCapability>();
  if (context.debug && can('debug-input-v1')) capabilities.add('debug-input-v1');
  if (can('context-v1')) capabilities.add('context-v1');

  const body: AiFeatureStreamBody = {
    clientRequestId: context.opId,
    pageLabel,
    platform: op.target.binding.platform,
    conversationRef: op.target.fanRef,
    fanRef: op.target.fanRef,
    personaKey: context.persona.key,
    expectedPersonaDefinitionId: context.persona.definitionId,
    messageCount: Math.max(AI_REQUEST_LIMITS.messageCountMin, Math.min(op.window, bootstrap.limits.deepMax, AI_REQUEST_LIMITS.messageCountMax)),
    isRegeneration: op.regenerateOf !== undefined,
  };
  if (op.feature === 'reply') body.replyTone = op.tone ?? 'none';
  if (spec.replyMode === 'always') body.replyMode = op.split ? 'preferSplit' : 'default';
  if (spec.replyMode === 'split-all-v1' && op.split && can('split-all-v1') && flagState(bootstrap, 'splitAll', pageLabel).usable) {
    body.replyMode = 'preferSplit';
    capabilities.add('split-all-v1');
  }
  if ('summaryMode' in spec) body.summaryMode = spec.summaryMode;
  if (op.feature === 'fix' && op.draft !== undefined) body.draftText = op.draft.text;
  if (op.feature === 'hi' && op.variantCount !== undefined) body.variantCount = op.variantCount;
  if (op.feature === 'coach' && op.coach !== undefined) {
    // A preset's question lives on the hub, which refuses a body that names both (400): with a preset the
    // operation's own question is the chip's label for the dialog and stays here.
    if (op.coach.preset !== undefined) body.preset = op.coach.preset;
    else if (op.coach.question !== undefined) body.chatterQuestion = op.coach.question;
    body.coachHistory = op.coach.history.map((turn) => ({ question: turn.question, answer: turn.answer }));
    if (op.coach.attachDraft !== undefined) body.draftText = op.coach.attachDraft;
  }
  if (capabilities.has('context-v1')) {
    if (isFreshTextFeature(op.feature) && op.surface === 'dock' && flagState(bootstrap, 'freshText', pageLabel).usable) {
      const live = freshContext(op, bootstrap);
      if (live !== undefined) body.liveTextContext = live;
    }
    const known = op.checkpoint?.knownFanMessageIds ?? [];
    if (known.length > 0) body.knownFanMessageIds = [...new Set(known)];
  }

  const request = { feature: spec.hub, body, capabilities: [...capabilities] };
  const parsed = HubStreamRequestSchema.safeParse(request);
  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, problem: parsed.error.issues.map((issue) => issue.message).join('; ') };
}
