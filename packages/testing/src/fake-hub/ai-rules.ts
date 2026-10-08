// What the hub's own handler refuses in an AI body AFTER its schema accepted
// it — the rules of `prepareAiFeatureStream` (hub
// apps/runtime/src/modules/ai/features/index.ts as it stands at c8514c5c,
// hub `main` and the commit the SDK is vendored from. The hub's AI module is
// the same there as at e7e1037b, where these rules were first read),
// in the hub's order and with the hub's own messages. They are code on the hub, not schema, so the body schema of
// the vendored SDK cannot show them: the first live check met one of them
// (the Coach preset sent with our own question → 400 in 10 ms) only on the
// real hub. Modelled here so that a body the hub would refuse fails on the
// fake hub too, in unit tests and in e2e.
//
// The body schema itself is the hub's: `FakeHubOptions.streamBodySchema`
// takes the vendored SDK's `routeSchemas.aiFeatureStream.body` (the e2e
// harness and the wiring tests pass it; this package's shipped-side code
// never imports the SDK).

import { type AiFeatureStreamBody } from '@cg/contracts';

export interface StreamBodyRefusal {
  /** The hub's error code: a gate (`gate_draft_required`) or the plain `bad_request`. */
  readonly error: 'gate_draft_required' | 'bad_request';
  /** The hub's own message, word for word. */
  readonly message: string;
}

/** Hub features whose policy says `requiresDraft` (feature-policies.ts). */
const REQUIRES_DRAFT: readonly string[] = ['improve-draft'];

const blank = (value: string | undefined): boolean => value === undefined || value.trim() === '';

export function streamBodyRefusal(feature: string, body: Partial<AiFeatureStreamBody>): StreamBodyRefusal | null {
  if (REQUIRES_DRAFT.includes(feature) && blank(body.draftText)) return { error: 'gate_draft_required', message: `${feature} requires draftText` };
  // Coach feature isolation: coach-chat needs a question — its own, or the preset's, which lives on the hub.
  if (feature === 'coach-chat') {
    if (body.preset !== undefined) {
      if (!blank(body.chatterQuestion)) return { error: 'bad_request', message: 'coach-chat preset forbids chatterQuestion' };
    } else if (blank(body.chatterQuestion)) {
      return { error: 'bad_request', message: 'coach-chat requires chatterQuestion' };
    }
  } else if (body.chatterQuestion !== undefined || body.coachHistory !== undefined || body.preset !== undefined) {
    return { error: 'bad_request', message: `${feature} does not accept coach fields` };
  }
  if (body.summaryMode !== undefined && feature !== 'fan-summary') return { error: 'bad_request', message: `${feature} does not accept summaryMode` };
  return null;
}

/** A schema as the fake hub needs it: the vendored SDK's zod schema fits. */
export interface BodySchemaLike {
  safeParse(value: unknown): { readonly success: boolean };
}
