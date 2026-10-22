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
// | 2 | the model did not read one of the chat's LATEST messages: a miss of    | `window-miss`    |
// |   | the window (or a known id `absent`) newer than the newest message it   |                  |
// |   | read (`included`), or it read none of the window                       |                  |
// | 3 | a message the tab saw deleted is in the context                        | `deleted-served` |
// | 4 | otherwise: every id counted, the observation `complete` — an empty     | `fresh`          |
// |   | window (no conversation) only under it                                 |                  |
//
// The mark says «ответ мог не учесть последние сообщения чата», so only a miss
// of the latest messages is one (owner, 2026-10-20: the mark only when messages
// were really missed). An older gap — a message the prompt budget cut
// (`outside_window`), a media message the archive does not hold, a side the hub
// reads otherwise — leaves what the fan said last read, and it was on nearly
// every answer. The page's text is not a condition of its own: the hub merges
// what it serves of it into the window it answers about, so an unserved text
// of a message the model did not read is that message's miss.
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

import { COVERAGE_CHECK_CLASSES, coverageCheckVerdict, type CoverageProof, type CoverageWindowEntry, type OpView, type ResultMarkVM, type ServedContext } from '@cg/contracts/ops';
import { coverageFingerprintOf } from '../../ops/proof';

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
  return coverageFingerprintOf(proof);
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

const DECIMAL = /^\d+$/;

/** Fansly's ids grow with time (snowflakes): the larger is the newer; an id that is not decimal goes by the window's order (oldest first). */
function newer(a: string, b: string, order: ReadonlyMap<string, number>): boolean {
  if (DECIMAL.test(a) && DECIMAL.test(b)) return BigInt(a) > BigInt(b);
  return (order.get(a) ?? -1) > (order.get(b) ?? -1);
}

/**
 * Whether the model missed one of the chat's latest messages: a missed id (a window answer read as a miss, a known id
 * `absent`) newer than the newest one it read (`included`), or any miss when it read none. Called on a check already
 * read as verified: every asked id has its one answer.
 */
function latestMissed(fingerprint: ProofFingerprint, served: ServedContext): boolean {
  const order = new Map(fingerprint.window.map((entry, index) => [entry.id, index]));
  const read: string[] = [];
  const missed: string[] = [];
  for (const answer of served.coverageCheck?.window ?? []) {
    if (answer.state === 'included') read.push(answer.id);
    else if (answer.state !== null && COVERAGE_CHECK_CLASSES.window[answer.state] === 'miss') missed.push(answer.id);
  }
  for (const answer of served.knownFanMessages ?? []) {
    if (answer.state === 'included') read.push(answer.id);
    else if (answer.state === 'absent') missed.push(answer.id);
  }
  // An id the hub answers both ways is a miss: it never stands for what the model read.
  const newest = read.filter((id) => !missed.includes(id)).reduce<string | null>((best, id) => (best === null || newer(id, best, order) ? id : best), null);
  return missed.some((id) => newest === null || newer(id, newest, order));
}

/** Whether a message the tab saw deleted was in the context: the deleted list's own part of the check. */
function deletedServed(served: ServedContext): boolean {
  return (served.coverageCheck?.deleted ?? []).some((answer) => answer.state !== null && COVERAGE_CHECK_CLASSES.deleted[answer.state] === 'stale');
}

/** Spec §3.5: the verdict on one generation — what the tab kept of its proof against the hub's `context_v1`. */
export function freshnessVerdict(fingerprint: ProofFingerprint | null, served: ServedContext | null | undefined): FreshnessVerdict {
  if (served === null || served === undefined || fingerprint === null || fingerprint.completeness !== 'complete' || fingerprint.truncated) return 'unverified';
  const check = coverageCheckVerdict(fingerprint, served.coverageCheck);
  const known = knownAnswers(fingerprint.knownFanMessageIds, served.knownFanMessages);
  if (check === 'unverified' || known === 'unverified') return 'unverified';
  if ((check === 'miss' || known === 'miss') && latestMissed(fingerprint, served)) return 'window-miss';
  return deletedServed(served) ? 'deleted-served' : 'fresh';
}

/**
 * The result's own evidence and its current window (P8b3), each against THIS result's hub answer. Current evidence
 * may add a condition, never clear an original miss. A fresh result takes the background's «фан написал новое».
 * A result still running, failed or canceled has no mark.
 */
export function verdictMark(view: OpView, fingerprint: ProofFingerprint | null): ResultMarkVM | null {
  return markOf(view, fingerprint, ['unverified', 'window-miss', 'deleted-served']);
}

/**
 * The mark a result SHOWS (the dock, Recap, Review, Coach): the verdict without `unverified` (the owner, 2026-10-22,
 * «правь все»): «Свежесть не проверена» came on the first chat after every reload or reconnect and said nothing the
 * chatter could act on. A real miss of the latest messages (`window-miss`) and a deleted message served stay; the
 * send's own check (`freshForSend`) still reads `unverified`.
 */
export function shownMark(view: OpView, fingerprint: ProofFingerprint | null): ResultMarkVM | null {
  return markOf(view, fingerprint, ['window-miss', 'deleted-served']);
}

function markOf(view: OpView, fingerprint: ProofFingerprint | null, reasons: readonly Exclude<FreshnessVerdict, 'fresh'>[]): ResultMarkVM | null {
  if (view.state !== 'done') return null;
  // The current window can only add a condition. It never replaces the evidence of the generation itself:
  // a miss cannot become fresh just because the hub caught up or a different start checked another window.
  const own = view.freshnessProof?.fingerprint ?? fingerprint;
  const original = freshnessVerdict(own, view.servedContext);
  const current = freshnessVerdict(fingerprint === null ? null : { ...fingerprint, text: own?.text ?? false }, view.servedContext);
  const verdict = reasons.find((reason) => original === reason || current === reason) ?? 'fresh';
  return verdict === 'fresh' ? (view.stale ?? null) : { reason: verdict, at: null };
}

/** FS-TAIL-8: this generation's unchanged result may be sent only on its own fresh verdict — else only a new generation. */
export function freshForSend(view: OpView, fingerprint: ProofFingerprint | null): boolean {
  return view.state === 'done' && verdictMark(view, fingerprint) === null;
}
