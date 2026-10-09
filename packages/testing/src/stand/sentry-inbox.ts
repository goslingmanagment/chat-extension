// The stand's Sentry collector (decision X22; fixture-chatspace/src/sentry.ts).
// The page's Sentry reports to its own loopback origin, `/sentry/api/<project>/envelope/`;
// the server keeps each envelope as the browser sent it, for the sentry-gate
// e2e to read through the control API (`/__stand/sentry`). An envelope is the
// SDK's newline-separated JSON: a header, then each item's header and payload.
// Never journaled: it is the page's own telemetry, not a call of its client.

export interface SentryEnvelope {
  readonly seq: number;
  /** When it came, ms since the epoch. */
  readonly at: number;
  readonly path: string;
  readonly raw: string;
}

export interface SentryPage {
  readonly envelopes: readonly SentryEnvelope[];
  /** Read from here next time. */
  readonly next: number;
}

/** The collector's own path under the Sentry prefix: `api/<project>/envelope/`. */
export const SENTRY_ENVELOPE_PATH = /^api\/\d+\/envelope\/?$/;

/** Envelopes kept; the oldest go first. */
const MAX_ENVELOPES = 500;

export class SentryInbox {
  private readonly envelopes: SentryEnvelope[] = [];
  private seq = 0;

  add(path: string, raw: string): void {
    this.envelopes.push({ seq: this.seq++, at: Date.now(), path, raw });
    if (this.envelopes.length > MAX_ENVELOPES) this.envelopes.shift();
  }

  read(since = 0): SentryPage {
    return { envelopes: this.envelopes.filter((envelope) => envelope.seq >= since), next: this.seq };
  }

  clear(): number {
    this.envelopes.length = 0;
    return this.seq;
  }
}
