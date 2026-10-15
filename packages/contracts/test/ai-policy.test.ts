// The site's AI policy (src/ops.ts `AiHostPolicy`, 1.15.0, R20 F10; docs/project-unite/architecture.md §1.6, §9.1):
// the five ports the shared AI controller calls, and the ready mark model of the shared result.

import { describe, expect, expectTypeOf, it } from 'vitest';

import * as C from '../src/index';
import { AI_POLICY_SAMPLES, AI_PROOF_ASK_SAMPLES } from './fixtures/ai-policy';

describe('[R20-F10] the site’s AI policy', () => {
  it('the proof ask may carry the effective count; older callers remain valid', () => {
    expectTypeOf<C.AiProofAsk['messageCount']>().toEqualTypeOf<number | undefined>();
    expect(AI_PROOF_ASK_SAMPLES.valid.map((ask: C.AiProofAsk) => ask.messageCount)).toEqual([undefined, 100]);
    expect(AI_PROOF_ASK_SAMPLES.invalid).toHaveLength(1);
  });
  it('the samples: ChatSpace’s shape, a second site with its own proof and fingerprint, a site with nothing to prove', () => {
    expect(AI_POLICY_SAMPLES.valid).toHaveLength(3);
    for (const policy of AI_POLICY_SAMPLES.valid) expect(Object.keys(policy).sort()).toEqual(['fields', 'fingerprint', 'preflight', 'proof', 'verdict']);
    // The compiler refuses each invalid sample (`@ts-expect-error` in the fixture); here, that there are some.
    expect(AI_POLICY_SAMPLES.invalid.length).toBeGreaterThanOrEqual(7);
  });

  it('the shared result draws the mark the policy gives: `ResultVM.stale` is the ready mark model', () => {
    expectTypeOf<C.ResultVM['stale']>().toEqualTypeOf<C.ResultMarkVM | null>();
    expectTypeOf<ReturnType<C.AiHostPolicy['verdict']>>().toEqualTypeOf<C.ResultMarkVM | null>();
    // ChatSpace's verdict is the background's mark as it is: the mark model and the view's `stale` have one shape.
    expectTypeOf<NonNullable<C.OpView['stale']>>().toExtend<C.ResultMarkVM>();
  });

  it('the pre-check names a reason of the action catalog that carries a code, the fields are fields of the start', () => {
    expectTypeOf<ReturnType<C.AiHostPolicy['preflight']>>().toEqualTypeOf<C.AiGateReason | null>();
    const coded = C.UNAVAILABLE_REASON_IDS.filter((id) => C.UNAVAILABLE_REASONS[id].code !== null);
    for (const reason of ['hi-gate', 'ping-gate', 'no-history', 'chat-loading', 'needs-draft', 'language'] satisfies C.AiGateReason[]) expect(coded).toContain(reason);
    // A reason without a code is not one a start can fail with.
    expectTypeOf<'locked-during-generation'>().not.toExtend<C.AiGateReason>();
    expectTypeOf<'hi-gate'>().toExtend<C.AiGateReason>();
    expectTypeOf<keyof C.AiStartFields>().toExtend<keyof C.StartOp>();
    expectTypeOf<C.AiStartFields['fresh']>().toEqualTypeOf<C.LiveTextTail | null | undefined>();
    // The fresh limits a proof is asked with are D-14's: what `freshTextLimits` gives, or none.
    expectTypeOf<C.AiProofAsk['fresh']>().toEqualTypeOf<{ readonly maxItems: number; readonly maxChars: number } | null>();
  });
});
