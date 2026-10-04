// Freshness of a preview send (architecture.md §6.7.5): «the fan wrote
// something new» is decided by comparing the checkpoint taken on the
// Generate click with the counters now — never by unread counters, the DOM or
// hub webhooks. A new fan message after the checkpoint holds the send
// (CG-SEND-STALE, a repeat click does not lift it); an observation that cannot
// prove «nothing new» — another document or socket, a lost subscription,
// coverage unknown — holds it as CG-SEND-FRESHNESS. The served-context check
// covers fan messages the page saw before Generate: every named id must be
// `included` in what actually served the generation.

import { type CgCode } from '@cg/contracts/errors';
import { type ServedContext } from '@cg/contracts/ops';
import { checkpointMatches, type FreshnessCheckpoint } from '@cg/contracts/send';
import { servedContextCovers } from '@cg/contracts/send-rules';

export type FreshnessVerdict = 'fresh' | 'stale' | 'unknown';

/** Compares the checkpoint of Generate with a later one of the same chat. */
export function compareCheckpoints(atGenerate: FreshnessCheckpoint, now: FreshnessCheckpoint): FreshnessVerdict {
  if (!checkpointMatches(now, atGenerate.hostAccountId, atGenerate.platformFanId)) return 'unknown';
  if (atGenerate.coverage !== 'ok' || now.coverage !== 'ok') return 'unknown';
  if (now.documentEpoch !== atGenerate.documentEpoch || now.socketEpoch !== atGenerate.socketEpoch || now.subscriptionEpoch !== atGenerate.subscriptionEpoch) {
    return 'unknown';
  }
  if (now.fanSequence < atGenerate.fanSequence) return 'unknown';
  if (now.fanSequence > atGenerate.fanSequence || now.lastFanMessageId !== atGenerate.lastFanMessageId) return 'stale';
  return 'fresh';
}

export function freshnessCode(verdict: FreshnessVerdict): CgCode | null {
  return verdict === 'fresh' ? null : verdict === 'stale' ? 'CG-SEND-STALE' : 'CG-SEND-FRESHNESS';
}

/**
 * The served-context hold (§6.7.5 «Дополнительно — обслуженный контекст»):
 * no checkpoint or coverage unknown → CG-SEND-FRESHNESS; known fan ids and
 * no `context_v1` (or an unknown reader) → CG-SEND-FRESHNESS; a known id
 * `absent` or `deleted` → CG-SEND-STALE (a new generation once the archive
 * has it); `unknown` or a missing answer → CG-SEND-FRESHNESS; all `included`
 * (or nothing to prove) → null.
 */
export function servedContextHold(checkpoint: FreshnessCheckpoint | undefined, served: ServedContext | null | undefined): CgCode | null {
  if (checkpoint === undefined || checkpoint.coverage !== 'ok') return 'CG-SEND-FRESHNESS';
  const known = checkpoint.knownFanMessageIds;
  if (known.length === 0) return null;
  if (served === undefined || served === null || served.source === null) return 'CG-SEND-FRESHNESS';
  if (servedContextCovers(known, served.knownFanMessages)) return null;
  const answers = served.knownFanMessages ?? [];
  const staleAnswer = known.some((id) => answers.some((answer) => answer.id === id && (answer.state === 'absent' || answer.state === 'deleted')));
  return staleAnswer ? 'CG-SEND-STALE' : 'CG-SEND-FRESHNESS';
}
