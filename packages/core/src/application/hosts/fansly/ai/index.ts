// Fansly's AI policy and what it needs (R20 P8b1–P8c; docs/project-unite/architecture.md §1.6, §9.1): the policy in
// Fansly's lazy chunk `ai-fansly`, the windows its proof is cut by, the proof of a snapshot, the verdict on a result.

export { createFanslyAi, type FanslyAiDeps, type FanslyStartProof } from './policy';
export { hiFieldsOf, hiPingGate } from './hi-ping';
export { checkWindowOf, startProofOf } from './proof';
export { withFanslyOpText } from './site-text';
export { freshForSend, freshnessVerdict, fingerprintOf, verdictMark, type FreshnessVerdict, type ProofFingerprint } from './verdict';
