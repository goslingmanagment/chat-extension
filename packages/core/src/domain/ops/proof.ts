import type { CoverageFingerprint, CoverageProof } from '@cg/contracts/ops';

/** What survives the start with the result: ids and flags, never a text or a timestamp. */
export function coverageFingerprintOf(proof: CoverageProof): CoverageFingerprint {
  const snapshot = proof.kind === 'tab-snapshot';
  return {
    completeness: proof.completeness,
    truncated: snapshot && proof.truncated,
    window: proof.window.map((entry) => ({ id: entry.id, dir: entry.dir })),
    knownFanMessageIds: [...proof.knownFanMessageIds],
    deletedIds: [...proof.deletedIds],
    text: snapshot && (proof.tail?.length ?? 0) > 0,
  };
}
