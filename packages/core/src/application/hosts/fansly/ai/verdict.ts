// The verdict on a generation of Fansly (docs/project-unite/spec.md §3.5,
// FS-TAIL-1, FS-TAIL-7, FS-TAIL-8; architecture §1.6, §9.1; R20 P8b2): ONE pure
// function of the spec's table — what the tab kept of the start's proof (its
// fingerprint: ids and flags, never a text) against what the hub said it built
// the generation on (`context_v1`: the window check, the fan's known ids, the
// page text it served). No port, no clock.
//
// Each asked id has exactly one answer, read by the table the hub and this
// client share (`COVERAGE_CHECK_CLASSES`, the matrix of HF-8в, through
// `coverageCheckVerdict`): the window's ids and the deleted ones each by their
// own list. The verdict is the first condition that holds:
//
// | # | condition                                                              | verdict          |
// |---|------------------------------------------------------------------------|------------------|
// | 1 | no `context_v1`; no snapshot; observation `unknown`; snapshot          | `unverified`     |
// |   | `truncated`; an id not checked (no answer, two, an unknown state, an   |                  |
// |   | answer to an id not asked)                                             |                  |
// | 2 | a miss of the window; a draft's non-empty page text the hub did not    | `window-miss`    |
// |   | serve (`live.status` not `served`, or `rejected > 0`)                  |                  |
// | 3 | a message the tab saw deleted is in the context                        | `deleted-served` |
// | 4 | otherwise: every id counted, the observation `complete` — an empty     | `fresh`          |
// |   | window (no conversation) only under it                                 |                  |
//
// The fan's known ids (`knownFanMessageIds`) are ids of the window: the window
// check answers each of them once. The hub answers them a second time
// (`knownFanMessages`) only when the background asked (the page's
// `freshText`); such an answer can only add a condition — an unknown or a
// repeated one, or one to an id not asked, is «не проверено», `absent` a miss
// —, never stand in for the window's.
//
// The mark over the result (`ResultMarkVM`) is the verdict's reason; a fresh
// generation still takes the background's «фан написал новое» (a fan message
// after it, §6.7.5). A send of THIS generation's unchanged result (FS-TAIL-8:
// a preview, «Новые» — P10c) needs a fresh verdict and no mark at all
// (`freshForSend`); inserting in the dock never waits for one.

import { coverageCheckVerdict, type CoverageProof, type CoverageWindowEntry, type OpView, type ResultMarkVM, type ServedContext } from '@cg/contracts/ops';

/** The verdict of the table: `fresh`, or the reason of the mark (`StaleReason`). */
export type FreshnessVerdict = 'fresh' | 'unverified' | 'window-miss' | 'deleted-served';

/**
 * What the tab keeps of a start's proof for as long as its result lives (`AiHostPolicy.fingerprint`): the ids the hub
 * is asked about and the flags of the observation — never a text (R20 F8).
 */
export interface ProofFingerprint {
  readonly completeness: CoverageProof['completeness'];
  /** Old texts were dropped to keep the snapshot in its frame (FS-TAIL-6). */
  readonly truncated: boolean;
  readonly window: readonly CoverageWindowEntry[];
  readonly knownFanMessageIds: readonly string[];
  readonly deletedIds: readonly string[];
  /** A draft's page text went with the start (a non-empty tail, FS-TAIL-6): the hub had to serve it. */
  readonly text: boolean;
}

export function fingerprintOf(proof: CoverageProof): ProofFingerprint {
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

/** The hub's second answer about the fan's known ids, when it gave one: `counted`, a `miss`, or not checked. */
function knownAnswers(asked: readonly string[], answers: ServedContext['knownFanMessages']): 'counted' | 'miss' | 'unverified' {
  const seen = new Set<string>();
  let miss = false;
  for (const answer of answers ?? []) {
    if (seen.has(answer.id) || !asked.includes(answer.id) || answer.state === null || answer.state === 'unknown') return 'unverified';
    seen.add(answer.id);
    if (answer.state === 'absent') miss = true;
  }
  return miss ? 'miss' : 'counted';
}

/** Spec §3.5: the verdict on one generation — what the tab kept of its proof against the hub's `context_v1`. */
export function freshnessVerdict(fingerprint: ProofFingerprint | null, served: ServedContext | null | undefined): FreshnessVerdict {
  if (served === null || served === undefined || fingerprint === null || fingerprint.completeness !== 'complete' || fingerprint.truncated) return 'unverified';
  const check = coverageCheckVerdict(fingerprint, served.coverageCheck);
  const known = knownAnswers(fingerprint.knownFanMessageIds, served.knownFanMessages);
  if (check === 'unverified' || known === 'unverified') return 'unverified';
  if (check === 'miss' || known === 'miss' || (fingerprint.text && (served.live.status !== 'served' || served.live.rejected > 0))) return 'window-miss';
  return check === 'stale' ? 'deleted-served' : 'fresh';
}

/**
 * The mark over a finished result (`AiHostPolicy.verdict`): the verdict's reason; a fresh one takes the background's
 * «фан написал новое» when it came; none — nothing to mark. A result still running, failed or canceled has none.
 */
export function verdictMark(view: OpView, fingerprint: ProofFingerprint | null): ResultMarkVM | null {
  if (view.state !== 'done') return null;
  const verdict = freshnessVerdict(fingerprint, view.servedContext);
  return verdict === 'fresh' ? (view.stale ?? null) : { reason: verdict, at: null };
}

/** FS-TAIL-8: this generation's unchanged result may be sent only on its own fresh verdict — else only a new generation. */
export function freshForSend(view: OpView, fingerprint: ProofFingerprint | null): boolean {
  return view.state === 'done' && verdictMark(view, fingerprint) === null;
}
