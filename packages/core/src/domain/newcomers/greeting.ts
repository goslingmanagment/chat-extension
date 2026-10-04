// What makes a greeting usable (NF-014, NF-017, NF-018; architecture.md
// §6.7.1): the parts of a finished Hi are sent as they are, so an answer
// that is empty, longer than a preview draft may be, or still carries the
// model's part markers is not a message to a fan. And a draft made on one
// state of the fan's thread is stale on another: it has to be confirmed
// again, never sent on.

import { type CgCode } from '@cg/contracts/errors';
import { SEND_LIMITS } from '@cg/contracts/limits';

/** The markers the hub's Split puts between parts and variants: a part that still shows one was not parsed. */
const MARKER = /\[(?:VARIANT|NEXT)\]/;

/** NF-017: why the parts of a result cannot be sent, or null. */
export function greetingOutputProblem(parts: readonly string[]): CgCode | null {
  if (parts.length === 0) return 'CG-OUTPUT-UNUSABLE';
  let total = 0;
  for (const part of parts) {
    const text = part.trim();
    if (text.length === 0 || MARKER.test(text)) return 'CG-OUTPUT-UNUSABLE';
    total += text.length;
  }
  return total > SEND_LIMITS.previewDraftMaxChars ? 'CG-OUTPUT-UNUSABLE' : null;
}

/** NF-018: a draft made when the thread looked different (`revision` — threadRevision of the row then). */
export function draftStale(savedRevision: string | null, currentRevision: string): boolean {
  return savedRevision !== null && savedRevision !== currentRevision;
}
