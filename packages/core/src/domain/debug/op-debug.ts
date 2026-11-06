// The debug view of one operation (architecture.md §5.5 `OpView.debug`,
// §9.3): what a generation proved and what the hub served, put into
// OpView.debug only while debug mode is on (the scheduler builds the rest of
// the view). Never a log or a diagnostics export.

import { type CoverageProof, type ServedContext, type GenerationDebug } from '@cg/contracts/ops';

/** One generation's exact proof and the hub's answers. Debug only, never a log or a diagnostics export. */
export function generationDebug(proof: CoverageProof | undefined, served: ServedContext | null | undefined): GenerationDebug | undefined {
  return proof === undefined ? undefined : { proof, served: served ?? null };
}
