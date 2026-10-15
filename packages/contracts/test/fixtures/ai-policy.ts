// Fixtures of the site's AI policy (1.15.0, R20 F10; src/ops.ts `AiHostPolicy`): what fits the ports and what does
// not. A policy is code the site's application half hands the shared AI controller — nothing crosses a boundary as
// `unknown` — so the invalid samples are refused by the compiler (`@ts-expect-error`), as the profile's are.

import type * as C from '../../src/index';

/** A second site's proof and fingerprint, as a site would define them (Fansly: its snapshot, the ids it checked). */
interface SiteProof {
  readonly personal: number;
  readonly windowIds: readonly string[];
}

const SAMPLE_TAIL: C.LiveTextTail = { capturedAt: '2026-10-03T10:00:00.000Z', messages: [{ platformMessageId: '4004', direction: 'fan', sentAt: '2026-10-03T09:59:00.000Z', text: 'hey' }] };

export const AI_POLICY_SAMPLES: { readonly valid: readonly C.AiHostPolicy[]; readonly invalid: readonly unknown[] } = {
  valid: [
    // ChatSpace's shape: the tail as the proof, `fresh` as its field, no fingerprint, the background's mark.
    {
      preflight: (feature, window) => (feature === 'hi' && window.loaded > 10 ? 'hi-gate' : null),
      proof: (host, ask) => (ask.fresh === null ? null : host.readVisibleTail(ask.identity, ask.fresh.maxItems)),
      fields: (fresh) => ({ fresh }),
      fingerprint: () => null,
      verdict: (view) => view.stale ?? null,
    } satisfies C.AiHostPolicy<C.LiveTextTail, null>,
    // A second site: its own proof and fingerprint, a pre-check that needs the proof, a verdict read against what was kept.
    {
      preflight: (feature, _window, proof) => (feature === 'ping' ? 'ping-gate' : feature === 'hi' && proof !== null && proof.personal > 10 ? 'hi-gate' : null),
      proof: () => Promise.resolve({ personal: 0, windowIds: ['4001'] }),
      fields: () => ({}),
      fingerprint: (proof) => (proof === null ? null : proof.windowIds.join(',')),
      verdict: (_view, fingerprint) => (fingerprint === null ? null : { reason: 'archive-moved', at: null }),
    } satisfies C.AiHostPolicy<SiteProof, string>,
    // A site with nothing to prove: no proof is ever gathered.
    { preflight: () => null, proof: () => null, fields: () => ({}), fingerprint: () => null, verdict: () => null },
  ],
  invalid: [
    // @ts-expect-error the pre-check names a reason of the action catalog (`UnavailableReasonId`), with its code
    { preflight: () => 'too-many-messages', proof: () => null, fields: () => ({}), fingerprint: () => null, verdict: () => null } satisfies C.AiHostPolicy,
    // @ts-expect-error a reason without a CG code is not one a start can fail with (`AiGateReason`)
    { preflight: () => 'locked-during-generation', proof: () => null, fields: () => ({}), fingerprint: () => null, verdict: () => null } satisfies C.AiHostPolicy,
    // @ts-expect-error the proof is asked for asynchronously or not at all: a value answered at once is neither
    { preflight: () => null, proof: () => SAMPLE_TAIL, fields: () => ({}), fingerprint: () => null, verdict: () => null } satisfies C.AiHostPolicy,
    // @ts-expect-error the site's fields are fields of the start (`AiStartFields`): a field it does not have is refused here
    { preflight: () => null, proof: () => null, fields: () => ({ coverageCheck: [] }), fingerprint: () => null, verdict: () => null } satisfies C.AiHostPolicy,
    // @ts-expect-error the fresh text of a start is a tail, not a string
    { preflight: () => null, proof: () => null, fields: () => ({ fresh: 'hey' }), fingerprint: () => null, verdict: () => null } satisfies C.AiHostPolicy,
    // @ts-expect-error the verdict is the ready mark model (`ResultMarkVM`): its reasons are a closed list
    { preflight: () => null, proof: () => null, fields: () => ({}), fingerprint: () => null, verdict: () => ({ reason: 'fan-replied', at: null }) } satisfies C.AiHostPolicy,
    // @ts-expect-error every port is there: a policy without a verdict is not one
    { preflight: () => null, proof: () => null, fields: () => ({}), fingerprint: () => null } satisfies C.AiHostPolicy,
  ],
};
