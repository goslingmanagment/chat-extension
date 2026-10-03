// From an acceptance outcome to the queue (architecture.md §9.6; TL-001…
// TL-008, LG-015): a built event is queued, an operation without its
// generation link is logged (never guessed), a duplicate or an invalid
// event is only counted. The tracker itself is core/domain/telemetry.

import { type AcceptanceEvent } from '@cg/contracts/telemetry';

import { logEvent, type Logger } from '../../domain/logging';
import { type AcceptanceOutcome } from '../../domain/telemetry';
import { type EnqueueOutcome } from './queue';

export interface AcceptanceCounts {
  queued: number;
  unlinked: number;
  duplicate: number;
  invalid: number;
  /** Built but not queued: no consent, signed out. */
  refused: number;
}

export class AcceptanceReporter {
  private readonly counts: AcceptanceCounts = { queued: 0, unlinked: 0, duplicate: 0, invalid: 0, refused: 0 };

  constructor(
    private readonly enqueue: (event: AcceptanceEvent) => EnqueueOutcome,
    private readonly logger: Logger,
  ) {}

  /** `lifecycle` and `opId` name the event in the log when it could not be linked; never any text. */
  report(outcome: AcceptanceOutcome, facts: { readonly lifecycle: AcceptanceEvent['payload']['lifecycle']; readonly opId: string }): EnqueueOutcome | null {
    if (outcome.ok) {
      const queued = this.enqueue(outcome.event);
      if (queued === 'queued') this.counts.queued += 1;
      else this.counts.refused += 1;
      return queued;
    }
    switch (outcome.reason) {
      case 'unlinked':
        this.counts.unlinked += 1;
        logEvent(this.logger, 'acceptanceUnlinked', { fields: { lifecycle: facts.lifecycle }, ctx: { opId: facts.opId } });
        break;
      case 'duplicate':
        this.counts.duplicate += 1;
        break;
      case 'invalid':
        this.counts.invalid += 1;
        break;
    }
    return null;
  }

  stats(): Readonly<AcceptanceCounts> {
    return { ...this.counts };
  }
}
